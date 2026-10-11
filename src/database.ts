import type { Executor } from './executor.js';
import {
	type SelectQueryBuilder,
	selectFromWith,
} from './select-query-builder.js';
import type { AnyTable } from './table.js';
import type { VerifyOptions, VerifyReport } from './verify/report.js';
import { verifyWith } from './verify/verify.js';

/** Queries that run on one executor. */
export interface Database {
	/**
	 * Compares `tables` with the database: missing tables and columns, SQL
	 * types (with modifiers, arrays and enums), nullability, defaults,
	 * identities and generated columns, enum labels, and columns only the
	 * database has. It runs one read-only catalog query, resolving names
	 * through the session's `search_path` as queries do.
	 *
	 * Use it as a boot check or a CI test; `report.ok` is `false` when there
	 * are errors. `formatVerifyReport` renders the report for a terminal.
	 *
	 * @example
	 * const report = await db.verify([users, posts], { strict: true });
	 * if (!report.ok) throw new Error(formatVerifyReport(report));
	 */
	verify(
		tables: readonly AnyTable[],
		options?: VerifyOptions,
	): Promise<VerifyReport>;

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
	return {
		verify: (tables, options) => verifyWith(executor, tables, options),
		selectFrom: (table) => selectFromWith(table, executor),
	};
}
