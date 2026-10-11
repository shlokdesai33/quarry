import type { CompiledQuery } from './compile.js';

/**
 * Per-query options of the result methods (`all`, `first`, `one`,
 * `maybeOne`, `execute`, `stream`).
 */
export interface RunOptions {
	/** Cancels the query on the server when aborted. */
	readonly signal?: AbortSignal | undefined;
	/**
	 * A server-side statement timeout for this query: milliseconds, or a
	 * Postgres interval such as `'2s'`.
	 */
	readonly timeout?: number | string | undefined;
}

/** What an executor is asked to do besides the query itself. */
export interface ExecuteOptions extends RunOptions {
	/** `array` asks for positional rows, for decoding by position. */
	readonly rowMode?: 'object' | 'array' | undefined;
}

export interface StreamOptions extends RunOptions {
	/** Rows fetched per round trip (default 1000). */
	readonly batchSize?: number | undefined;
}

/** The outcome of one statement. */
export interface ExecuteResult {
	readonly rows: readonly unknown[];
	/** Rows returned or affected, from the command tag; null for commands without a count. */
	readonly rowCount: number | null;
	/** The command tag's verb: `SELECT`, `INSERT`, … */
	readonly command: string;
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
	/**
	 * Re-runs the callback on serialization failures and deadlocks, up to
	 * this many times. The callback must be safe to re-run; put side effects
	 * in `afterCommit`.
	 */
	readonly retries?: number | undefined;
	/** Transaction-local settings, applied with bound parameters (`set_config`). */
	readonly settings?:
		| Readonly<Record<string, string | number | boolean>>
		| undefined;
	/** Ends the transaction (and its session) if it runs longer than this: milliseconds or an interval. */
	readonly timeout?: number | string | undefined;
}

/**
 * Runs compiled queries. The driver implements it; so can a mock, a SQL
 * snapshot recorder, or another backend (HTTP, PGlite). Not part of the
 * public API: `database()` builds one over the driver, and `databaseWith`
 * (internal) takes any.
 */
export interface Executor {
	execute(
		query: CompiledQuery,
		options?: ExecuteOptions,
	): Promise<ExecuteResult>;
	/** Reads the rows in batches, without holding the whole result in memory. */
	stream(
		query: CompiledQuery,
		options?: StreamOptions,
	): AsyncIterable<readonly unknown[]>;
	/** The query's parameter and result types, without running it. */
	describe(query: CompiledQuery): Promise<QueryDescription>;
	/**
	 * Runs `fn` in a transaction, passing an executor whose queries run
	 * inside it. Inside a transaction, this nests a savepoint.
	 */
	transaction<T>(
		fn: (executor: TransactionExecutor) => Promise<T>,
		options?: TransactionOptions,
	): Promise<T>;
	/** Releases what the executor owns (e.g. a pool it created). */
	close(): Promise<void>;
}

/** An executor inside a transaction. */
export interface TransactionExecutor extends Executor {
	/** Runs `callback` once the outermost transaction commits. */
	afterCommit(callback: () => unknown): void;
	/** Runs `callback` if this transaction (or savepoint) rolls back. */
	afterRollback(callback: () => unknown): void;
	/** Sets a run-time parameter until the end of the transaction, with a bound value. */
	setLocal(name: string, value: string | number | boolean): Promise<void>;
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

/**
 * A write query affected a different number of rows than `expectRows`
 * required. The statement has run; inside a transaction, the error rolls
 * it back.
 */
export class RowCountError extends Error {
	readonly expected: number;
	readonly actual: number;
	/** The query that ran. */
	readonly query: CompiledQuery;

	constructor(query: CompiledQuery, expected: number, actual: number) {
		super(
			`The query affected ${actual} row${actual === 1 ? '' : 's'}, where ${expected} ${expected === 1 ? 'was' : 'were'} expected`,
		);
		this.name = 'RowCountError';
		this.expected = expected;
		this.actual = actual;
		this.query = query;
	}
}
