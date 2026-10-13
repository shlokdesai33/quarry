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
	/** Runs statements under one Sync; once one fails the rest are skipped and reject with its error. */
	queryGroup(
		statements: readonly {
			sql: string;
			params?: readonly unknown[] | undefined;
			options?: TxQueryOptions | undefined;
		}[],
	): Promise<QueryResult<unknown>>[];
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

const noop = () => {};

type GroupStatement = Parameters<
	TransactionConnection['queryGroup']
>[0][number];

/** Query options that need the statement's own Sync, so BEGIN can't share it. */
const OWN_SYNC = ['signal', 'timeout', 'statementTimeout', 'onTiming'];

interface Waiter {
	readonly run: () => void;
	readonly fail: (error: unknown) => void;
}

/** Connections running `Transaction.run`, which may not have sent BEGIN yet. */
const running = new WeakSet<TransactionConnection>();

/**
 * The connection as one transaction and its savepoints use it, saving
 * round trips without changing what runs:
 *
 * - BEGIN and the settings wait for the first statement and share its
 *   Sync, so a failed BEGIN makes the server skip that statement instead
 *   of running it outside the transaction. Statements issued before BEGIN's
 *   outcome is known wait for it, and fail with its error.
 * - `sendDeferred` sends a statement (`release savepoint`) without waiting
 *   for its answer; the next statement reports its error.
 *
 * @internal
 */
export class Session {
	readonly #conn: TransactionConnection;
	/** BEGIN and the settings, until sent. */
	#opening: readonly GroupStatement[] | undefined;
	/** Whether BEGIN is in flight. */
	#beginning = false;
	/** Sends waiting for BEGIN's outcome. */
	#waiting: Waiter[] | undefined;
	/** Settles (never rejects) once BEGIN's outcome is known. */
	#opened: Promise<void> | undefined;
	/** Why the transaction never began. */
	#failure: { error: unknown } | undefined;
	/** A statement sent without waiting for its answer; the next one reports its error. */
	#deferred: Promise<unknown> | undefined;

	constructor(conn: TransactionConnection, opening: readonly GroupStatement[]) {
		this.#conn = conn;
		this.#opening = opening;
	}

	/** `transaction` from the start: BEGIN may not have been sent or answered yet. */
	get transactionStatus(): 'idle' | 'transaction' | 'failed' {
		return this.#opening !== undefined || this.#beginning
			? 'transaction'
			: this.#conn.transactionStatus;
	}

	query<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions,
	): Promise<QueryResult<R>> {
		if (
			this.#opening !== undefined &&
			(options === undefined ||
				OWN_SYNC.every((key) => options[key] === undefined))
		) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rows are typed by the caller, as in `asResult`
			return this.#begin({ sql, params, options }) as Promise<QueryResult<R>>;
		}
		return this.#send(() => this.#conn.query<R>(sql, params, options));
	}

	/** Sends `sql` without waiting for its answer: the next statement reports its error. */
	sendDeferred(sql: string): void {
		const result = this.query(sql);
		result.catch(noop);
		this.#deferred = result;
	}

	cursor<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions & { batchSize?: number },
	): AsyncIterable<R[]> {
		return this.#iterate(() => this.#conn.cursor<R>(sql, params, options));
	}

	stream<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions & { batchSize?: number },
	): AsyncIterable<R> {
		return this.#iterate(() => this.#conn.stream<R>(sql, params, options));
	}

	describe(
		sql: string,
		options?: { paramTypes?: readonly number[] },
	): Promise<Description> {
		return this.#send(() => this.#conn.describe(sql, options));
	}

	copyFrom(
		sql: string,
		source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
	): Promise<number> {
		return this.#send(() => this.#conn.copyFrom(sql, source));
	}

	copyTo(sql: string): AsyncIterable<Uint8Array> {
		return this.#iterate(() => this.#conn.copyTo(sql));
	}

	/** Waits for BEGIN's outcome (dropping it if never sent); its error, if it failed. */
	async end(): Promise<{ error: unknown } | undefined> {
		this.#opening = undefined;
		if (this.#opened !== undefined) await this.#opened;
		return this.#failure;
	}

	/** Sends BEGIN and the settings, with `first` under the same Sync; `first`'s result. */
	#begin(first?: GroupStatement): Promise<QueryResult<unknown>> | undefined {
		const opening = this.#opening ?? [];
		this.#opening = undefined;
		const results = this.#conn.queryGroup(
			first === undefined ? opening : [...opening, first],
		);
		// a failed statement skips the rest, so the last opening one reports for all
		for (let i = 0; i < opening.length - 1; i++) results[i]?.catch(noop);
		this.#beginning = true;
		this.#opened = (results[opening.length - 1] ?? Promise.resolve()).then(
			() => this.#began(undefined),
			(error: unknown) => this.#began({ error }),
		);
		return results[opening.length];
	}

	/** Sends what waited for BEGIN, in order, or fails it with BEGIN's error. */
	#began(failure: { error: unknown } | undefined): void {
		this.#beginning = false;
		this.#failure = failure;
		const waiting = this.#waiting;
		this.#waiting = undefined;
		if (waiting === undefined) return;
		for (const { run, fail } of waiting) {
			if (failure === undefined) run();
			else fail(failure.error);
		}
	}

	/** Sends once BEGIN succeeded, reporting a deferred statement's error instead of the result. */
	#send<T>(send: () => Promise<T>): Promise<T> {
		if (this.#opening !== undefined) void this.#begin();
		if (this.#failure !== undefined) return Promise.reject(this.#failure.error);
		const result = !this.#beginning
			? send()
			: new Promise<T>((resolve, reject) => {
					(this.#waiting ??= []).push({
						run: () => void send().then(resolve, reject),
						fail: reject,
					});
				});
		const deferred = this.#deferred;
		if (deferred === undefined) return result;
		this.#deferred = undefined;
		result.catch(noop);
		return deferred.then(() => result);
	}

	#iterate<T>(make: () => AsyncIterable<T>): AsyncIterable<T> {
		if (
			this.#opening === undefined &&
			!this.#beginning &&
			this.#failure === undefined &&
			this.#deferred === undefined
		)
			return make();
		const ready = this.#send(() => Promise.resolve());
		ready.catch(noop);
		return {
			async *[Symbol.asyncIterator]() {
				await ready;
				yield* make();
			},
		};
	}
}

/**
 * A transaction in progress. Queries go to its connection; `transaction`
 * nests a savepoint. It is finished when the callback that received it
 * settles, and must not be used afterwards.
 */
export class Transaction {
	readonly #conn: Session;
	readonly #depth: number;
	#finished = false;
	readonly #afterCommit: Callback[] = [];
	readonly #afterRollback: Callback[] = [];
	#savepoints = 0;

	/** @internal */
	constructor(conn: Session, depth: number) {
		this.#conn = conn;
		this.#depth = depth;
	}

	/** The connection's transaction status: `transaction`, or `failed` after an error. */
	get transactionStatus(): 'idle' | 'transaction' | 'failed' {
		return this.#conn.transactionStatus;
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
			if (this.#conn.transactionStatus === 'failed') {
				// fails, so the savepoint is rolled back to, as when fn throws
				await this.#conn.query(`release savepoint ${name}`);
			} else {
				this.#conn.sendDeferred(`release savepoint ${name}`);
			}
			inner.#finished = true;
			this.#afterCommit.push(...inner.#afterCommit);
			this.#afterRollback.push(...inner.#afterRollback);
			return result;
		} catch (error) {
			inner.#finished = true;
			if (this.#conn.transactionStatus !== 'idle') {
				await Promise.all([
					this.#conn.query(`rollback to savepoint ${name}`).catch(noop),
					this.#conn.query(`release savepoint ${name}`).catch(noop),
				]);
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
		if (conn.transactionStatus !== 'idle' || running.has(conn)) {
			throw new DriverError(
				options.durable
					? 'A durable transaction cannot run inside another transaction'
					: 'The connection is already in a transaction; use tx.transaction() to nest',
			);
		}
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
		// unprepared: they run once per transaction, and can't go stale
		const opening: GroupStatement[] = [
			{ sql: beginStatement(options), options: { prepare: false } },
		];
		if (settings) opening.push({ ...settings, options: { prepare: false } });
		const retries = options.retries ?? 0;
		running.add(conn);
		try {
			for (let attempt = 0; ; attempt++) {
				const session = new Session(conn, opening);
				const tx = new Transaction(session, 0);
				let result: T;
				try {
					result = await fn(tx);
					tx.#finished = true;
					const commit = await session.query('commit');
					if (commit.command === 'ROLLBACK') throw new TransactionRolledBack();
				} catch (caught) {
					tx.#finished = true;
					// when BEGIN or the settings failed, fn's statements were skipped: that error is the one to report
					const failure = await session.end();
					const error = failure === undefined ? caught : failure.error;
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
		} finally {
			running.delete(conn);
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
