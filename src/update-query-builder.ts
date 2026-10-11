import type { Executor } from './executor.js';
import {
	type ExpressionBuilder,
	expressionBuilder,
} from './expression-builder.js';
import type { SelectionNode, SetNode, UpdateNode } from './node.js';
import type { RefsOf } from './refs.js';
import {
	type AddRow,
	type RowOf,
	type Selection,
	selectionNodes,
} from './row.js';
import { type AnyTable, tableNode } from './table.js';
import {
	type Condition,
	type ConditionArgs,
	WhereBuilder,
} from './where-builder.js';
import {
	type ColumnKey,
	columnOf,
	notImplemented,
	rowCount,
	rowsNode,
	type SetValues,
	setNodes,
	type UpdateManyRow,
	type WriteResult,
} from './write-query.js';

/** What an `update` of `T` has recorded so far. */
interface UpdateState<T extends AnyTable> {
	readonly table: T;
	readonly set: readonly SetNode[];
	readonly many: UpdateNode['many'];
	readonly where: WhereBuilder<RefsOf<[T]>>;
	readonly allRows: boolean;
	readonly returning: readonly SelectionNode[];
	readonly expectRows: number | undefined;
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
		expectRows: undefined,
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

	/**
	 * Requires the query to update exactly `count` rows: with a `where` on a
	 * version column, an optimistic lock.
	 *
	 * @example .where('docs.id', id).where('docs.version', version).expectRows(1)
	 */
	expectRows(count: number): UpdateQueryBuilder<T, O, M> {
		return new UpdateQueryBuilder({
			...this.#state,
			expectRows: rowCount(count),
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

	/** Runs the query, resolving to the number of rows updated. Not implemented yet. */
	execute(this: UpdateQueryBuilder<T, unknown, never>): Promise<WriteResult> {
		return notImplemented('update');
	}

	/** Runs the query and returns every `returning` row. Not implemented yet. */
	all(this: UpdateQueryBuilder<T, O & object, never>): Promise<O[]> {
		return notImplemented('update');
	}

	/** Runs the query and returns its first `returning` row, if any. Not implemented yet. */
	first(
		this: UpdateQueryBuilder<T, O & object, never>,
	): Promise<O | undefined> {
		return notImplemented('update');
	}

	/** Runs the query and returns its one `returning` row. Not implemented yet. */
	one(this: UpdateQueryBuilder<T, O & object, never>): Promise<O> {
		return notImplemented('update');
	}

	/** Runs the query and returns its `returning` row, if any. Not implemented yet. */
	maybeOne(
		this: UpdateQueryBuilder<T, O & object, never>,
	): Promise<O | undefined> {
		return notImplemented('update');
	}

	/** The whole query as one node. */
	toNode(): UpdateNode {
		const { table, set, many, where, allRows, returning, expectRows, tag } =
			this.#state;
		return {
			kind: 'update',
			table: tableNode(table),
			set,
			many,
			where: where.toNode(),
			allRows,
			returning,
			expectRows,
			tag,
		};
	}
}
