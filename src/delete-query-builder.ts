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
import { WriteQueryBuilder } from './write-query.js';

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
export class DeleteQueryBuilder<
	T extends AnyTable,
	O,
	M extends 'where',
> extends WriteQueryBuilder<O, M> {
	readonly #state: DeleteState<T>;

	constructor(state: DeleteState<T>) {
		super(state.executor);
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

	override toNode(): DeleteNode {
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
