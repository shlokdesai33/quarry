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
import type { DeleteNode, SelectionNode } from './node.js';
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
	type NonEmptyOutput,
	writeExpectRows,
	writeNonEmpty,
	writeOutput,
	type WriteOutput,
	writeQuery,
} from './write-query.js';

/** What a `delete` from `T` has recorded so far. */
interface DeleteState<T extends AnyTable> {
	readonly table: T;
	readonly where: WhereBuilder<RefsOf<[T]>>;
	readonly allRows: boolean;
	readonly returning: readonly SelectionNode[];
	readonly tag: string | undefined;
	/** What the query runs on; `undefined` when it was built on its own. */
	readonly executor: Executor | undefined;
}

/**
 * Starts a `delete` from `table`, built without a database. It needs a
 * `where` (or `allRows()`) before it can run.
 *
 * @example deleteFrom(users).where('users.id', id)
 */
export function deleteFrom<T extends AnyTable>(
	table: T,
): DeleteQueryBuilder<T, undefined, 'where'> {
	return deleteFromWith(table, undefined);
}

/** `deleteFrom`, with the executor the query runs on. */
export function deleteFromWith<T extends AnyTable>(
	table: T,
	executor: Executor | undefined,
): DeleteQueryBuilder<T, undefined, 'where'> {
	return new DeleteQueryBuilder({
		table,
		where: new WhereBuilder(expressionBuilder(table)),
		allRows: false,
		returning: [],
		tag: undefined,
		executor,
	});
}

/**
 * A `delete` from `T` whose `returning` rows are `O` (`undefined` without
 * `returning`). `M` is `'where'` until `where` or `allRows` is called;
 * running it is a type error until then.
 *
 * It runs with `execute()` (or in `db.batch`), never when awaited;
 * the `take…` and `expect…` shapes read its `returning` rows (and
 * `expectNonEmpty` and `expectRows` its row count).
 *
 * Immutable: every method returns a new builder.
 */
export class DeleteQueryBuilder<T extends AnyTable, O, M extends 'where'> {
	/** The type of a `returning` row. Never set. */
	declare readonly $output: O;

	/** What the query still needs before it can run. Never set. */
	declare readonly $missing: M;

	readonly #state: DeleteState<T>;

	constructor(state: DeleteState<T>) {
		this.#state = state;
	}

	/**
	 * Adds a condition the deleted rows must meet, in any form a select's
	 * `where` takes, joined to the others by `and`.
	 *
	 * @example .where('users.id', id)
	 */
	readonly where: Condition<RefsOf<[T]>, DeleteQueryBuilder<T, O, never>> = (
		...args: ConditionArgs<RefsOf<[T]>>
	) =>
		new DeleteQueryBuilder<T, O, never>({
			...this.#state,
			where: this.#state.where.add(args),
		});

	/** Deletes every row of the table: what the query needs instead of a `where`. */
	allRows(): DeleteQueryBuilder<T, O, never> {
		return new DeleteQueryBuilder({ ...this.#state, allRows: true });
	}

	/**
	 * Adds to the `returning` list, typed like a `select` list.
	 *
	 * @example .returning(['users.id'])
	 */
	returning<const S extends readonly Selection<RefsOf<[T]>>[]>(
		selections: S | ((eb: ExpressionBuilder<RefsOf<[T]>>) => S),
	): DeleteQueryBuilder<T, AddRow<O, RowOf<RefsOf<[T]>, S[number]>>, M> {
		const eb = expressionBuilder(this.#state.table);
		const list = typeof selections === 'function' ? selections(eb) : selections;
		return new DeleteQueryBuilder({
			...this.#state,
			returning: [...this.#state.returning, ...selectionNodes(eb, list)],
		});
	}

	/** Labels the query; see `SelectQueryBuilder.tag`. */
	tag(name: string): DeleteQueryBuilder<T, O, M> {
		return new DeleteQueryBuilder({ ...this.#state, tag: name });
	}

	/**
	 * Applies `build` only when `condition` holds. A `where` in it doesn't
	 * stand in for the required one, since it may not have run.
	 */
	when(
		condition: boolean,
		build: (qb: DeleteQueryBuilder<T, O, M>) => DeleteQueryBuilder<T, O, M>,
	): DeleteQueryBuilder<T, O, M> {
		return condition ? build(this) : this;
	}

	/**
	 * The first `returning` row, if any; runs with `execute()`. Never
	 * throws for the number of rows, and doesn't change the SQL: the
	 * statement writes every row it matches, and only the first is decoded.
	 */
	takeFirst(
		this: DeleteQueryBuilder<T, O & object, never>,
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
		this: DeleteQueryBuilder<T, O & object, never>,
		..._oneColumn: ValueArgs<O, []>
	): Query<ColumnValue<O> | undefined> {
		return writeQuery(
			this.#state.executor,
			this.toNode(),
			takeValue<ColumnValue<O>>(),
		);
	}

	/**
	 * Requires the statement to delete one or more rows; runs with
	 * `execute()`, which resolves to the `returning` rows, as a non-empty
	 * array, or without `returning`, to the row count. Throws `NoRowError`
	 * (or what `err` makes of it) after the statement ran, when it deleted
	 * none; inside a transaction, that rolls it back.
	 */
	expectNonEmpty(
		this: DeleteQueryBuilder<T, O, never>,
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
		this: DeleteQueryBuilder<T, O & object, never>,
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
		this: DeleteQueryBuilder<T, O & object, never>,
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
		this: DeleteQueryBuilder<T, O & object, never>,
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
		this: DeleteQueryBuilder<T, O & object, never>,
		...args: ValueArgs<O, [err?: ErrorFor<NoRowError>]>
	): Query<ColumnValue<O>> {
		return writeQuery(
			this.#state.executor,
			this.toNode(),
			expectValue<ColumnValue<O>>(errorArg(args)),
		);
	}

	/**
	 * Requires the statement to delete exactly `count` rows; runs with
	 * `execute()`, which resolves as it does without a shape, and throws
	 * `RowCountError` (or what `err` makes of it) after the statement ran,
	 * when it deleted a different number; inside a transaction, that rolls
	 * it back.
	 */
	expectRows(
		this: DeleteQueryBuilder<T, O, never>,
		count: number,
		err?: ErrorFor<RowCountError>,
	): Query<WriteOutput<O>> {
		return writeExpectRows<O>(this.#state.executor, this.toNode(), count, err);
	}

	/**
	 * Runs the query, resolving to every `returning` row, or without
	 * `returning`, to the number of rows deleted. Never throws for the
	 * number of rows: the `expect` shapes do.
	 */
	execute(
		this: DeleteQueryBuilder<T, O, never>,
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
	toNode(): DeleteNode {
		const { table, where, allRows, returning, tag } = this.#state;
		return {
			kind: 'delete',
			table: tableNode(table),
			where: where.toNode(),
			allRows,
			returning,
			tag,
		};
	}
}
