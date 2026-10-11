import type { Executor } from './executor.js';
import {
	type ExpressionBuilder,
	expressionBuilder,
} from './expression-builder.js';
import type { DeleteNode, SelectionNode } from './node.js';
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
import { notImplemented, rowCount, type WriteResult } from './write-query.js';

/** What a `delete` from `T` has recorded so far. */
interface DeleteState<T extends AnyTable> {
	readonly table: T;
	readonly where: WhereBuilder<RefsOf<[T]>>;
	readonly allRows: boolean;
	readonly returning: readonly SelectionNode[];
	readonly expectRows: number | undefined;
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
		expectRows: undefined,
		tag: undefined,
		executor,
	});
}

/**
 * A `delete` from `T` whose `returning` rows are `O` (`undefined` without
 * `returning`). `M` is `'where'` until `where` or `allRows` is called;
 * running it is a type error until then.
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

	/** Requires the query to delete exactly `count` rows. */
	expectRows(count: number): DeleteQueryBuilder<T, O, M> {
		return new DeleteQueryBuilder({
			...this.#state,
			expectRows: rowCount(count),
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

	/** Runs the query, resolving to the number of rows deleted. Not implemented yet. */
	execute(this: DeleteQueryBuilder<T, unknown, never>): Promise<WriteResult> {
		return notImplemented('delete');
	}

	/** Runs the query and returns every `returning` row. Not implemented yet. */
	all(this: DeleteQueryBuilder<T, O & object, never>): Promise<O[]> {
		return notImplemented('delete');
	}

	/** Runs the query and returns its first `returning` row, if any. Not implemented yet. */
	first(
		this: DeleteQueryBuilder<T, O & object, never>,
	): Promise<O | undefined> {
		return notImplemented('delete');
	}

	/** Runs the query and returns its one `returning` row. Not implemented yet. */
	one(this: DeleteQueryBuilder<T, O & object, never>): Promise<O> {
		return notImplemented('delete');
	}

	/** Runs the query and returns its `returning` row, if any. Not implemented yet. */
	maybeOne(
		this: DeleteQueryBuilder<T, O & object, never>,
	): Promise<O | undefined> {
		return notImplemented('delete');
	}

	/** The whole query as one node. */
	toNode(): DeleteNode {
		const { table, where, allRows, returning, expectRows, tag } = this.#state;
		return {
			kind: 'delete',
			table: tableNode(table),
			where: where.toNode(),
			allRows,
			returning,
			expectRows,
			tag,
		};
	}
}
