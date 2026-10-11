import { DriverError, PostgresError } from './errors.js';
import type { Description, QueryResult } from './ops.js';

/** What a transaction needs from the connection it runs on. */
export interface TransactionConnection {
	readonly transactionStatus: 'idle' | 'transaction' | 'failed';
	query<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions,
	): Promise<QueryResult<R>>;
	cursor<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions & { batchSize?: number },
	): AsyncIterable<R[]>;
	stream<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions & { batchSize?: number },
	): AsyncIterable<R>;
	describe(
		sql: string,
		options?: { paramTypes?: readonly number[] },
	): Promise<Description>;
	copyFrom(
		sql: string,
		source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
	): Promise<number>;
	copyTo(sql: string): AsyncIterable<Uint8Array>;
}

/** Query options accepted inside a transaction (the connection's own options). */
export type TxQueryOptions = Readonly<Record<string, unknown>>;

export type IsolationLevel =
	| 'read uncommitted'
	| 'read committed'
	| 'repeatable read'
	| 'serializable';

/** A run-time setting value for `set_config`. */
export type SettingValue = string | number | boolean;

export interface TransactionOptions {
	readonly isolation?: IsolationLevel | undefined;
	readonly readOnly?: boolean | undefined;
	/** Only meaningful with `serializable` and `readOnly`. */
	readonly deferrable?: boolean | undefined;
	/**
	 * Re-runs the whole callback this many times when the transaction fails
	 * with a serialization failure (40001) or deadlock (40P01). The callback
	 * must be safe to re-run; put side effects in `afterCommit`.
	 */
	readonly retries?: number | undefined;
	/** Milliseconds to wait before retry `attempt` (1-based); defaults to jittered exponential backoff. */
	readonly retryDelay?: ((attempt: number) => number) | undefined;
	/**
	 * Transaction-local settings, applied with `set_config(name, value, true)`
	 * so values are bound parameters, never interpolated SQL. E.g.
	 * `{ 'app.tenant_id': id, statement_timeout: '5s' }` for row-level security.
	 */
	readonly settings?: Readonly<Record<string, SettingValue>> | undefined;
	/**
	 * Ends the transaction if it runs longer than this (milliseconds, or an
	 * interval such as `'5s'`), with `transaction_timeout`. The server then
	 * closes the session and the call fails with `TransactionTimeout`.
	 */
	readonly timeout?: number | string | undefined;
	/** Throw if a transaction is already open, instead of nesting as a savepoint. */
	readonly durable?: boolean | undefined;
}

const SETTING_NAME = /^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$/;

/** The `select set_config(…)` statement and parameters for some settings. */
export function settingsQuery(
	settings: Readonly<Record<string, SettingValue>>,
): { sql: string; params: string[] } | undefined {
	const entries = Object.entries(settings);
	if (entries.length === 0) return undefined;
	const params: string[] = [];
	const calls = entries.map(([name, value]) => {
		if (!SETTING_NAME.test(name))
			throw new DriverError(`Invalid setting name ${JSON.stringify(name)}`);
		params.push(name, String(value));
		return `set_config($${params.length - 1}, $${params.length}, true)`;
	});
	return { sql: `select ${calls.join(', ')}`, params };
}

function beginStatement(options: TransactionOptions): string {
	let sql = 'begin';
	if (options.isolation) sql += ` isolation level ${options.isolation}`;
	if (options.readOnly !== undefined)
		sql += options.readOnly ? ' read only' : ' read write';
	if (options.deferrable !== undefined)
		sql += options.deferrable ? ' deferrable' : ' not deferrable';
	return sql;
}

const ISOLATION_LEVELS: ReadonlySet<string> = new Set([
	'read uncommitted',
	'read committed',
	'repeatable read',
	'serializable',
]);

const defaultDelay = (attempt: number) =>
	Math.min(1000, 10 * 2 ** attempt) * (0.5 + Math.random());

/** The transaction committed nothing: COMMIT reported ROLLBACK because an earlier statement failed. */
export class TransactionRolledBack extends DriverError {
	constructor() {
		super(
			'The transaction was rolled back because an earlier statement in it failed',
		);
		this.name = 'TransactionRolledBack';
	}
}

type Callback = () => unknown;

const finishedError = () =>
	new DriverError('This transaction has already finished');

/**
 * A transaction in progress. Queries go to its connection; `transaction`
 * nests a savepoint. It is finished when the callback that received it
 * settles, and must not be used afterwards.
 */
export class Transaction {
	readonly #conn: TransactionConnection;
	readonly #depth: number;
	#finished = false;
	readonly #afterCommit: Callback[] = [];
	readonly #afterRollback: Callback[] = [];
	#savepoints = 0;

	/** @internal */
	constructor(conn: TransactionConnection, depth: number) {
		this.#conn = conn;
		this.#depth = depth;
	}

	/** 0 for the outermost transaction, 1+ for savepoints. */
	get depth(): number {
		return this.#depth;
	}

	#check(): void {
		if (this.#finished)
			throw new DriverError('This transaction has already finished');
	}

	query<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions,
	): Promise<QueryResult<R>> {
		if (this.#finished) return Promise.reject(finishedError());
		return this.#conn.query<R>(sql, params, options);
	}

	cursor<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions & { batchSize?: number },
	): AsyncIterable<R[]> {
		this.#check();
		return this.#conn.cursor<R>(sql, params, options);
	}

	stream<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions & { batchSize?: number },
	): AsyncIterable<R> {
		this.#check();
		return this.#conn.stream<R>(sql, params, options);
	}

	describe(
		sql: string,
		options?: { paramTypes?: readonly number[] },
	): Promise<Description> {
		if (this.#finished) return Promise.reject(finishedError());
		return this.#conn.describe(sql, options);
	}

	copyFrom(
		sql: string,
		source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
	): Promise<number> {
		if (this.#finished) return Promise.reject(finishedError());
		return this.#conn.copyFrom(sql, source);
	}

	copyTo(sql: string): AsyncIterable<Uint8Array> {
		this.#check();
		return this.#conn.copyTo(sql);
	}

	/** Sets a run-time parameter until the end of the transaction (`set_config(name, value, true)`). */
	async setLocal(name: string, value: SettingValue): Promise<void> {
		this.#check();
		const query = settingsQuery({ [name]: value });
		if (query) await this.#conn.query(query.sql, query.params);
	}

	/**
	 * Runs `callback` once the outermost transaction commits; dropped if
	 * this transaction or savepoint rolls back, or the attempt is retried.
	 */
	afterCommit(callback: Callback): void {
		this.#check();
		this.#afterCommit.push(callback);
	}

	/** Runs `callback` if this transaction (or savepoint) rolls back. */
	afterRollback(callback: Callback): void {
		this.#check();
		this.#afterRollback.push(callback);
	}

	/** Runs `fn` in a savepoint: rolled back to on error, released on success. */
	async transaction<T>(
		fn: (tx: Transaction) => Promise<T>,
		options: Pick<TransactionOptions, 'durable' | 'settings'> &
			Record<string, unknown> = {},
	): Promise<T> {
		this.#check();
		if (options.durable)
			throw new DriverError(
				'A durable transaction cannot run inside another transaction',
			);
		for (const key of ['isolation', 'readOnly', 'deferrable', 'retries']) {
			if (options[key] !== undefined)
				throw new DriverError(
					`${key} can only be set on the outermost transaction`,
				);
		}
		const name = `quarry_sp_${this.#depth + 1}_${++this.#savepoints}`;
		await this.#conn.query(`savepoint ${name}`);
		const inner = new Transaction(this.#conn, this.#depth + 1);
		try {
			if (options.settings) {
				const query = settingsQuery(options.settings);
				if (query) await this.#conn.query(query.sql, query.params);
			}
			const result = await fn(inner);
			await this.#conn.query(`release savepoint ${name}`);
			inner.#finished = true;
			this.#afterCommit.push(...inner.#afterCommit);
			this.#afterRollback.push(...inner.#afterRollback);
			return result;
		} catch (error) {
			inner.#finished = true;
			if (this.#conn.transactionStatus !== 'idle') {
				await this.#conn.query(`rollback to savepoint ${name}`).catch(() => {});
				await this.#conn.query(`release savepoint ${name}`).catch(() => {});
			}
			runCallbacks(inner.#afterRollback);
			throw error;
		}
	}

	/** @internal */
	/* oxlint-disable no-await-in-loop -- each attempt runs after the previous one failed */
	static async run<T>(
		conn: TransactionConnection,
		fn: (tx: Transaction) => Promise<T>,
		options: TransactionOptions = {},
	): Promise<T> {
		if (
			options.isolation !== undefined &&
			!ISOLATION_LEVELS.has(options.isolation)
		) {
			throw new DriverError(
				`Invalid isolation level ${JSON.stringify(options.isolation)}`,
			);
		}
		if (conn.transactionStatus !== 'idle') {
			throw new DriverError(
				options.durable
					? 'A durable transaction cannot run inside another transaction'
					: 'The connection is already in a transaction; use tx.transaction() to nest',
			);
		}
		const retries = options.retries ?? 0;
		const timeout =
			options.timeout === undefined
				? undefined
				: typeof options.timeout === 'number'
					? `${options.timeout}ms`
					: options.timeout;
		const settings = settingsQuery({
			...options.settings,
			...(timeout === undefined ? {} : { transaction_timeout: timeout }),
		});
		for (let attempt = 0; ; attempt++) {
			const tx = new Transaction(conn, 0);
			// begin and settings are pipelined into one round trip
			const begin = conn.query(beginStatement(options));
			const applied = settings
				? conn.query(settings.sql, settings.params)
				: undefined;
			let result: T;
			try {
				await begin;
				await applied;
				result = await fn(tx);
				tx.#finished = true;
				const commit = await conn.query('commit');
				if (commit.command === 'ROLLBACK') throw new TransactionRolledBack();
			} catch (error) {
				tx.#finished = true;
				if (conn.transactionStatus !== 'idle')
					await conn.query('rollback').catch(() => {});
				runCallbacks(tx.#afterRollback);
				if (
					error instanceof PostgresError &&
					error.isRetryable &&
					attempt < retries
				) {
					await new Promise((resolve) =>
						setTimeout(
							resolve,
							(options.retryDelay ?? defaultDelay)(attempt + 1),
						),
					);
					continue;
				}
				throw error;
			}
			runCallbacks(tx.#afterCommit);
			return result;
		}
	}
	/* oxlint-enable no-await-in-loop */
}

/** Runs callbacks, reporting (not throwing) their errors: the transaction outcome is already decided. */
function runCallbacks(callbacks: readonly Callback[]): void {
	for (const callback of callbacks) {
		try {
			const result = callback();
			if (result instanceof Promise) result.catch(report);
		} catch (error) {
			report(error);
		}
	}
}

function report(error: unknown): void {
	queueMicrotask(() => {
		throw error;
	});
}
