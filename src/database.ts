import {
	type DeleteQueryBuilder,
	deleteFromWith,
} from './delete-query-builder.js';
import {
	createPool,
	type Connection,
	type Pool,
	type PoolClient,
	type PoolOptions,
} from './driver/index.js';
import {
	DriverExecutor,
	isDriverSource,
	type DatabaseOptions,
} from './driver-executor.js';
import type {
	Executor,
	TransactionExecutor,
	TransactionOptions,
} from './executor.js';
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
import type { VerifyOptions, VerifyReport } from './verify/report.js';
import { verifyWith } from './verify/verify.js';
import type { ColumnKey, UpdateManyRow } from './write-query.js';

/** Queries that run on one database. */
export interface Database extends AsyncDisposable {
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

	/**
	 * Runs `fn` in a transaction: committed when it resolves, rolled back
	 * when it throws. `tx` runs queries inside it; `tx.transaction` nests a
	 * savepoint, unless it is `durable`, which throws instead. With
	 * `retries`, serialization failures and deadlocks re-run `fn`, so put side
	 * effects in `tx.afterCommit`.
	 *
	 * @example
	 * await db.transaction(async (tx) => {
	 *   const order = await tx.insertInto(orders).values(row).returning(['orders.id']).one();
	 *   tx.afterCommit(() => queue.publish('order.created', order.id));
	 * }, { isolation: 'serializable', retries: 3 });
	 */
	transaction<T>(
		fn: (tx: DatabaseTransaction) => Promise<T>,
		options?: TransactionOptions,
	): Promise<T>;

	/** Closes the connection pool, if this database opened it. */
	close(): Promise<void>;
}

/** The database inside a transaction. */
export interface DatabaseTransaction extends Omit<
	Database,
	'close' | typeof Symbol.asyncDispose
> {
	/** Runs `callback` once the outermost transaction commits; dropped if it rolls back or is retried. */
	afterCommit(callback: () => unknown): void;
	/** Runs `callback` if this transaction (or savepoint) rolls back. */
	afterRollback(callback: () => unknown): void;
	/** Sets a run-time parameter until the end of the transaction, with a bound value. */
	setLocal(name: string, value: string | number | boolean): Promise<void>;
}

/** What a database runs on: a connection string, driver options, or a driver pool, client or connection. */
export type DatabaseSource =
	| string
	| PoolOptions
	| Pool
	| PoolClient
	| Connection;

/**
 * A database on PostgreSQL 18+, through quarry's driver. Give it a
 * connection string or pool options to open a pool it owns (and `close()`
 * ends), or a pool, client or connection you manage.
 *
 * @example
 * const db = database(process.env.DATABASE_URL);
 * const user = await db.selectFrom(users).where('users.id', id).one();
 */
export function database(
	source: DatabaseSource,
	options: DatabaseOptions = {},
): Database {
	const executor = isDriverSource(source)
		? new DriverExecutor(source, options)
		: new DriverExecutor(createPool(source), options, true);
	return databaseWith(executor);
}

/**
 * @internal A database on any executor: mocks, SQL recorders, other
 * backends. Not part of the public API.
 */
export function databaseWith(executor: Executor): Database {
	return {
		...queries(executor),
		close: () => executor.close(),
		[Symbol.asyncDispose]: () => executor.close(),
	};
}

function transactionWith(executor: TransactionExecutor): DatabaseTransaction {
	return {
		...queries(executor),
		afterCommit: (callback) => executor.afterCommit(callback),
		afterRollback: (callback) => executor.afterRollback(callback),
		setLocal: (name, value) => executor.setLocal(name, value),
	};
}

function queries(
	executor: Executor,
): Omit<Database, 'close' | typeof Symbol.asyncDispose> {
	return {
		verify: (tables, options) => verifyWith(executor, tables, options),
		selectFrom: (table) => selectFromWith(table, executor),
		insertInto: (table) => insertIntoWith(table, executor),
		update: (table) => updateWith(table, executor),
		updateMany: (table, rows, options) =>
			updateManyWith(table, rows, options, executor),
		deleteFrom: (table) => deleteFromWith(table, executor),
		transaction: (fn, options) =>
			executor.transaction((tx) => fn(transactionWith(tx)), options),
	};
}
