import type { Executor } from './executor.js';
import {
	type SelectQueryBuilder,
	selectFromWith,
} from './select-query-builder.js';
import type { AnyTable } from './table.js';

/** Queries that run on one executor. */
export interface Database {
	/**
	 * Starts a `select` from `table`, run on this database by `all`, `first`,
	 * `one` and `maybeOne`.
	 */
	selectFrom<T extends AnyTable>(
		table: T,
	): SelectQueryBuilder<[T], Record<never, never>>;
}

/**
 * A database whose queries run on `executor`.
 *
 * @example
 * const db = database(executor);
 * const user = await db.selectFrom(users).where('users.id', id).one();
 */
export function database(executor: Executor): Database {
	return { selectFrom: (table) => selectFromWith(table, executor) };
}
