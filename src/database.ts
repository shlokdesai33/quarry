import {
	type DeleteQueryBuilder,
	deleteFromWith,
} from './delete-query-builder.js';
import type { Executor } from './executor.js';
import {
	type InsertQueryBuilder,
	insertIntoWith,
} from './insert-query-builder.js';
import {
	type SelectQueryBuilder,
	selectFromWith,
} from './select-query-builder.js';
import type { AnyTable } from './table.js';
import {
	type UpdateManyOptions,
	type UpdateQueryBuilder,
	updateManyWith,
	updateWith,
} from './update-query-builder.js';
import type { ColumnKey, UpdateManyRow } from './write-query.js';

/** Queries that run on one executor. */
export interface Database {
	/**
	 * Starts a `select` from `table`, run on this database by `all`, `first`,
	 * `one` and `maybeOne`.
	 */
	selectFrom<T extends AnyTable>(
		table: T,
	): SelectQueryBuilder<[T], Record<never, never>>;

	/** Starts an `insert` into `table`; see `insertInto`. */
	insertInto<T extends AnyTable>(
		table: T,
	): InsertQueryBuilder<T, undefined, 'values'>;

	/** Starts an `update` of `table`; see `update`. */
	update<T extends AnyTable>(
		table: T,
	): UpdateQueryBuilder<T, undefined, 'set' | 'where'>;

	/** Updates many rows, each to its own values; see `updateMany`. */
	updateMany<T extends AnyTable, const B extends ColumnKey<T>>(
		table: T,
		rows: readonly NoInfer<UpdateManyRow<T, B>>[],
		options: UpdateManyOptions<B>,
	): UpdateQueryBuilder<T, undefined, never>;

	/** Starts a `delete` from `table`; see `deleteFrom`. */
	deleteFrom<T extends AnyTable>(
		table: T,
	): DeleteQueryBuilder<T, undefined, 'where'>;
}

/**
 * A database whose queries run on `executor`.
 *
 * @example
 * const db = database(executor);
 * const user = await db.selectFrom(users).where('users.id', id).one();
 */
export function database(executor: Executor): Database {
	return {
		selectFrom: (table) => selectFromWith(table, executor),
		insertInto: (table) => insertIntoWith(table, executor),
		update: (table) => updateWith(table, executor),
		updateMany: (table, rows, options) =>
			updateManyWith(table, rows, options, executor),
		deleteFrom: (table) => deleteFromWith(table, executor),
	};
}
