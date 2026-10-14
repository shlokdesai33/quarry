import { compile, type CompiledQuery } from './compile.js';
import type {
	Executor,
	NoRowError,
	RowCountError,
	RunOptions,
	TooManyRowsError,
} from './executor.js';
import {
	type ExpressionBuilder,
	expressionBuilder,
} from './expression-builder.js';
import type { SelectionNode, SetNode, UpdateNode } from './node.js';
import { type Missing, type Query, rejectAwait } from './query.js';
import type { RefsOf } from './refs.js';
import {
	type AddRow,
	type RowOf,
	type Selection,
	selectionNodes,
} from './row.js';
import {
	type ColumnValue,
	type ErrorFor,
	errorArg,
	expectAtMostOne,
	expectFirst,
	expectOne,
	expectValue,
	takeFirst,
	takeValue,
	type ValueArgs,
} from './shape.js';
import { type AnyTable, tableNode } from './table.js';
import {
	type Condition,
	type ConditionArgs,
	WhereBuilder,
} from './where-builder.js';
import {
	type ColumnKey,
	columnOf,
	type NonEmptyOutput,
	rowsNode,
	setNodes,
	type SetValues,
	type UpdateManyRow,
	writeExpectRows,
	writeNonEmpty,
	writeOutput,
	type WriteOutput,
	writeQuery,
} from './write-query.js';

/** What an `update` of `T` has recorded so far. */
interface UpdateState<T extends AnyTable> {
	readonly table: T;
	readonly set: readonly SetNode[];
	readonly many: UpdateNode['many'];
	readonly where: WhereBuilder<RefsOf<[T]>>;
	readonly allRows: boolean;
	readonly returning: readonly SelectionNode[];
	readonly tag: string | undefined;
	/** What the query runs on; `undefined` when it was built on its own. */
	readonly executor: Executor | undefined;
}

/** What an update still needs before it can run. */
type UpdateNeeds = 'set' | 'where';

/**
 * Starts an `update` of `table`, built without a database. It needs `set`
 * and a `where` (or `allRows()`) before it can run.
 *
 * @example update(users).set({ name: 'Ada' }).where('users.id', id)
 */
export function update<T extends AnyTable>(
	table: T,
): UpdateQueryBuilder<T, undefined, UpdateNeeds> {
	return updateWith(table, undefined);
}

/** `update`, with the executor the query runs on. */
export function updateWith<T extends AnyTable>(
	table: T,
	executor: Executor | undefined,
): UpdateQueryBuilder<T, undefined, UpdateNeeds> {
	return new UpdateQueryBuilder(initialState(table, executor));
}

/** An update of `table` that has recorded nothing yet. */
function initialState<T extends AnyTable>(
	table: T,
	executor: Executor | undefined,
): UpdateState<T> {
	return {
		table,
		set: [],
		many: undefined,
		where: new WhereBuilder(expressionBuilder(table)),
		allRows: false,
		returning: [],
		tag: undefined,
		executor,
	};
}

/** How `updateMany` matches its rows to the table's. */
export interface UpdateManyOptions<B extends string> {
	/** The columns that identify a row: its key, or a composite one. */
	readonly by: B | readonly [B, ...B[]];
}

/**
 * Updates many rows at once, each to its own values: each of `rows` is
 * matched to the table's row with the same `by` columns, and sets the other
 * columns it has. The rows are sent with `unnest`, one array parameter per
 * column. Built without a database.
 *
 * @example updateMany(users, [{ id: 1, name: 'Ada' }, { id: 2, name: 'Alan' }], { by: 'id' })
 */
export function updateMany<T extends AnyTable, const B extends ColumnKey<T>>(
	table: T,
	rows: readonly NoInfer<UpdateManyRow<T, B>>[],
	options: UpdateManyOptions<B>,
): UpdateQueryBuilder<T, undefined, never> {
	return updateManyWith(table, rows, options, undefined);
}

/** `updateMany`, with the executor the query runs on. */
export function updateManyWith<
	T extends AnyTable,
	const B extends ColumnKey<T>,
>(
	table: T,
	rows: readonly NoInfer<UpdateManyRow<T, B>>[],
	options: UpdateManyOptions<B>,
	executor: Executor | undefined,
): UpdateQueryBuilder<T, undefined, never> {
	const by: readonly string[] =
		typeof options.by === 'string' ? [options.by] : options.by;
	for (const row of rows) {
		const missing = by.filter(
			(key) => (row as Record<string, unknown>)[key] === undefined,
		);
		if (missing.length > 0) {
			throw new Error(
				`Each row of updateMany needs its \`by\` columns: missing "${missing.join('", "')}"`,
			);
		}
	}
	const values = rowsNode(table, rows, 'unnest');
	return new UpdateQueryBuilder({
		...initialState(table, executor),
		many: { ...values, by: by.map((key) => columnOf(table, key).name) },
	});
}

/**
 * An `update` of `T` whose `returning` rows are `O` (`undefined` without
 * `returning`). `M` is what it still needs before it can run: `'set'` until
 * `set` is called, `'where'` until `where` or `allRows` is. Running it is a
 * type error until `M` is `never`.
 *
 * It runs with `execute()` (or in `db.batch`), never when awaited;
 * the `take…` and `expect…` shapes read its `returning` rows (and
 * `expectNonEmpty` and `expectRows` its row count).
 *
 * Immutable: every method returns a new builder.
 */
export class UpdateQueryBuilder<T extends AnyTable, O, M extends UpdateNeeds> {
	/** The type of a `returning` row. Never set. */
	declare readonly $output: O;

	/** What the query still needs before it can run. Never set. */
	declare readonly $missing: M;

	readonly #state: UpdateState<T>;

	constructor(state: UpdateState<T>) {
		this.#state = state;
	}

	/**
	 * Columns to set, typed by their update types; read-only columns aren't
	 * offered. A value can be an expression. Adds to the columns set before,
	 * replacing a column set again.
	 *
	 * @example .set({ name: 'Ada' })
	 * @example .set((eb) => ({ name: eb.fn.lower('users.name') }))
	 */
	set(
		values:
			| SetValues<T>
			| ((eb: ExpressionBuilder<RefsOf<[T]>>) => SetValues<T>),
	): UpdateQueryBuilder<T, O, Exclude<M, 'set'>> {
		const { table } = this.#state;
		const given =
			typeof values === 'function' ? values(expressionBuilder(table)) : values;
		return new UpdateQueryBuilder({
			...this.#state,
			set: setNodes(table, this.#state.set, given),
		});
	}

	/**
	 * Adds a condition the updated rows must meet, in any form a select's
	 * `where` takes, joined to the others by `and`.
	 *
	 * @example .where('users.id', id)
	 * @example .where((eb) => eb.ref('users.lastSeen').lt(cutoff))
	 */
	readonly where: Condition<
		RefsOf<[T]>,
		UpdateQueryBuilder<T, O, Exclude<M, 'where'>>
	> = (...args: ConditionArgs<RefsOf<[T]>>) =>
		new UpdateQueryBuilder<T, O, Exclude<M, 'where'>>({
			...this.#state,
			where: this.#state.where.add(args),
		});

	/** Updates every row of the table: what the query needs instead of a `where`. */
	allRows(): UpdateQueryBuilder<T, O, Exclude<M, 'where'>> {
		return new UpdateQueryBuilder({ ...this.#state, allRows: true });
	}

	/**
	 * Adds to the `returning` list, typed like a `select` list.
	 *
	 * @example .returning(['users.id', 'users.name'])
	 */
	returning<const S extends readonly Selection<RefsOf<[T]>>[]>(
		selections: S | ((eb: ExpressionBuilder<RefsOf<[T]>>) => S),
	): UpdateQueryBuilder<T, AddRow<O, RowOf<RefsOf<[T]>, S[number]>>, M> {
		const eb = expressionBuilder(this.#state.table);
		const list = typeof selections === 'function' ? selections(eb) : selections;
		return new UpdateQueryBuilder({
			...this.#state,
			returning: [...this.#state.returning, ...selectionNodes(eb, list)],
		});
	}

	/** Labels the query; see `SelectQueryBuilder.tag`. */
	tag(name: string): UpdateQueryBuilder<T, O, M> {
		return new UpdateQueryBuilder({ ...this.#state, tag: name });
	}

	/**
	 * Applies `build` only when `condition` holds. What it does doesn't count
	 * towards what the query needs, since it may not have run: a `where` in
	 * it doesn't stand in for the required one.
	 *
	 * @example .when(onlyActive, (qb) => qb.where('users.active', true))
	 */
	when(
		condition: boolean,
		build: (qb: UpdateQueryBuilder<T, O, M>) => UpdateQueryBuilder<T, O, M>,
	): UpdateQueryBuilder<T, O, M> {
		return condition ? build(this) : this;
	}

	/**
	 * The first `returning` row, if any; runs with `execute()`. Never
	 * throws for the number of rows, and doesn't change the SQL: the
	 * statement writes every row it matches, and only the first is decoded.
	 */
	takeFirst(
		this: UpdateQueryBuilder<T, O & object, never>,
	): Query<O | undefined> {
		return writeQuery(this.#state.executor, this.toNode(), takeFirst<O>());
	}

	/**
	 * The value of the one `returning` column of the first row, if any;
	 * runs with `execute()`. Never throws for the number of rows, and
	 * doesn't change the SQL: the statement writes every row it matches.
	 *
	 * @example .returning(['users.id']).takeValue()
	 */
	takeValue(
		this: UpdateQueryBuilder<T, O & object, never>,
		..._oneColumn: ValueArgs<O, []>
	): Query<ColumnValue<O> | undefined> {
		return writeQuery(
			this.#state.executor,
			this.toNode(),
			takeValue<ColumnValue<O>>(),
		);
	}

	/**
	 * Requires the statement to update one or more rows; runs with
	 * `execute()`, which resolves to the `returning` rows, as a non-empty
	 * array, or without `returning`, to the row count. Throws `NoRowError`
	 * (or what `err` makes of it) after the statement ran, when it updated
	 * none; inside a transaction, that rolls it back.
	 */
	expectNonEmpty(
		this: UpdateQueryBuilder<T, O, never>,
		err?: ErrorFor<NoRowError>,
	): Query<NonEmptyOutput<O>> {
		return writeNonEmpty<O>(this.#state.executor, this.toNode(), err);
	}

	/**
	 * The first `returning` row; runs with `execute()`, which throws
	 * `NoRowError` (or what `err` makes of it) when there is none, after
	 * the statement ran. Other rows are ignored.
	 */
	expectFirst(
		this: UpdateQueryBuilder<T, O & object, never>,
		err?: ErrorFor<NoRowError>,
	): Query<O> {
		return writeQuery(this.#state.executor, this.toNode(), expectFirst<O>(err));
	}

	/**
	 * The one `returning` row; runs with `execute()`, which throws
	 * `NoRowError` when there is none and `TooManyRowsError` (with the
	 * `count`) when there are several, after the statement ran; `err`
	 * makes the error to throw instead.
	 */
	expectOne(
		this: UpdateQueryBuilder<T, O & object, never>,
		err?: ErrorFor<NoRowError | TooManyRowsError>,
	): Query<O> {
		return writeQuery(this.#state.executor, this.toNode(), expectOne<O>(err));
	}

	/**
	 * The `returning` row, if any; runs with `execute()`, which throws
	 * `TooManyRowsError` (or what `err` makes of it) when there are
	 * several, after the statement ran.
	 */
	expectAtMostOne(
		this: UpdateQueryBuilder<T, O & object, never>,
		err?: ErrorFor<TooManyRowsError>,
	): Query<O | undefined> {
		return writeQuery(
			this.#state.executor,
			this.toNode(),
			expectAtMostOne<O>(err),
		);
	}

	/**
	 * The value of the one `returning` column of the first row; runs with
	 * `execute()`, which throws `NoRowError` (or what `err` makes of it)
	 * when there is no row, after the statement ran.
	 */
	expectValue(
		this: UpdateQueryBuilder<T, O & object, never>,
		...args: ValueArgs<O, [err?: ErrorFor<NoRowError>]>
	): Query<ColumnValue<O>> {
		return writeQuery(
			this.#state.executor,
			this.toNode(),
			expectValue<ColumnValue<O>>(errorArg(args)),
		);
	}

	/**
	 * Requires the statement to update exactly `count` rows; runs with
	 * `execute()`, which resolves as it does without a shape, and throws
	 * `RowCountError` (or what `err` makes of it) after the statement ran,
	 * when it updated a different number; inside a transaction, that rolls
	 * it back.
	 *
	 * @example .where('docs.id', id).where('docs.version', version).expectRows(1)
	 */
	expectRows(
		this: UpdateQueryBuilder<T, O, never>,
		count: number,
		err?: ErrorFor<RowCountError>,
	): Query<WriteOutput<O>> {
		return writeExpectRows<O>(this.#state.executor, this.toNode(), count, err);
	}

	/**
	 * Runs the query, resolving to every `returning` row, or without
	 * `returning`, to the number of rows updated. Never throws for the
	 * number of rows: the `expect` shapes do.
	 */
	execute(
		this: UpdateQueryBuilder<T, O, never>,
		options?: RunOptions,
	): Promise<WriteOutput<O>> {
		return writeOutput<O>(this.#state.executor, this.toNode()).execute(options);
	}

	/** The SQL and parameters `execute()` sends. */
	toSQL(): CompiledQuery {
		return compile(this.toNode());
	}

	/** The query `execute()` runs, for `db.batch`; one that still needs clauses has none. */
	toQuery(): [M] extends [never] ? Query<WriteOutput<O>> : Missing<M> {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the type keeps a query that can't run yet out of a batch
		return writeOutput<O>(this.#state.executor, this.toNode()) as [M] extends [
			never,
		]
			? Query<WriteOutput<O>>
			: Missing<M>;
	}

	/** @deprecated A query runs with `execute()`; awaiting one rejects. */
	// oxlint-disable-next-line unicorn/no-thenable -- so that a forgotten execute() fails loudly
	readonly then = rejectAwait;

	/** The whole query as one node. */
	toNode(): UpdateNode {
		const { table, set, many, where, allRows, returning, tag } = this.#state;
		return {
			kind: 'update',
			table: tableNode(table),
			set,
			many,
			where: where.toNode(),
			allRows,
			returning,
			tag,
		};
	}
}
