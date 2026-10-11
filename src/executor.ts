import type { CompiledQuery } from './compile.js';

/** Per-query options an executor may honour. */
export interface ExecuteOptions {
	/** Cancels the query on the server when aborted. */
	readonly signal?: AbortSignal | undefined;
	/**
	 * A server-side statement timeout for this query: milliseconds, or a
	 * Postgres interval such as `'2s'`.
	 */
	readonly timeout?: number | string | undefined;
	/** `array` asks for positional rows, for decoding by position. */
	readonly rowMode?: 'object' | 'array' | undefined;
}

/** A query's parameter and result types, as the server reports them without running it. */
export interface QueryDescription {
	/** Type OIDs of the parameters, in order. */
	readonly params: readonly number[];
	readonly columns: readonly {
		readonly name: string;
		readonly typeOid: number;
		/** The type modifier, e.g. a varchar length or numeric precision; -1 for none. */
		readonly typeModifier: number;
		/** The source table's OID and the column's attribute number, or 0 for computed columns. */
		readonly tableOid: number;
		readonly columnNumber: number;
	}[];
}

export interface TransactionOptions {
	readonly isolation?:
		| 'read uncommitted'
		| 'read committed'
		| 'repeatable read'
		| 'serializable'
		| undefined;
	readonly readOnly?: boolean | undefined;
	readonly deferrable?: boolean | undefined;
	/** Re-runs the callback on serialization failures and deadlocks, up to this many times. */
	readonly retries?: number | undefined;
	/** Transaction-local settings, applied with bound parameters (`set_config`). */
	readonly settings?:
		| Readonly<Record<string, string | number | boolean>>
		| undefined;
}

/**
 * Runs compiled queries: the bridge to a driver. `rows` are the result rows
 * as the driver returns them, already parsed into JavaScript values.
 *
 * Only `execute` is required. The optional members let a driver adapter
 * offer cancellation, timeouts, streaming, describing and transactions.
 *
 * @example
 * const executor: Executor = {
 *   execute: async ({ sql, params }) => ({ rows: (await pool.query(sql, params)).rows }),
 * };
 */
export interface Executor {
	execute(
		query: CompiledQuery,
		options?: ExecuteOptions,
	): Promise<{ readonly rows: readonly unknown[] }>;
	/** Reads the rows in batches, without holding the whole result in memory. */
	stream?(
		query: CompiledQuery,
		options?: ExecuteOptions & { readonly batchSize?: number | undefined },
	): AsyncIterable<readonly unknown[]>;
	/** The query's parameter and result types, without running it. */
	describe?(query: CompiledQuery): Promise<QueryDescription>;
	/**
	 * Runs `fn` in a transaction, passing an executor whose queries run
	 * inside it. Inside a transaction, this nests a savepoint.
	 */
	transaction?<T>(
		fn: (executor: Executor) => Promise<T>,
		options?: TransactionOptions,
	): Promise<T>;
}

/** The query returned no row where `one` expects exactly one. */
export class NoRowError extends Error {
	/** The query that returned no row. */
	readonly query: CompiledQuery;

	constructor(query: CompiledQuery) {
		super('The query returned no row, where exactly one was expected');
		this.name = 'NoRowError';
		this.query = query;
	}
}

/**
 * The query returned several rows where `one` or `maybeOne` expects at most
 * one.
 */
export class TooManyRowsError extends Error {
	/** The query that returned several rows. */
	readonly query: CompiledQuery;

	constructor(query: CompiledQuery) {
		super('The query returned several rows, where at most one was expected');
		this.name = 'TooManyRowsError';
		this.query = query;
	}
}
