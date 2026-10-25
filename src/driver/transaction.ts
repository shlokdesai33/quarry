import { DriverError, PostgresError } from './errors.js';
import type { Description, QueryResult } from './ops.js';
import { RowStream } from './row-stream.js';

/** What a transaction needs from the connection it runs on. */
export interface TransactionConnection {
	readonly transactionStatus: 'idle' | 'transaction' | 'failed';
	/** The error that failed the transaction, once one did (kept until the next transaction or savepoint rollback). */
	readonly transactionError?: Error | undefined;
	query<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions,
	): Promise<QueryResult<R>>;
	cursor<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxCursorOptions,
	): AsyncIterable<R[]>;
	stream<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxCursorOptions,
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
		options?: GroupOptions,
	): Promise<QueryResult<unknown>>[];
}

/** Options of a group of statements under one Sync. */
export interface GroupOptions {
	/** Cancels the whole group. */
	readonly signal?: AbortSignal | undefined;
}

/** What `Transaction.batch` needs from the connection. */
export type BatchConnection = Pick<
	TransactionConnection,
	'transactionStatus' | 'query' | 'queryGroup'
>;

/** Options of `Transaction.batch`: a transaction's, but it runs once. */
export interface TransactionBatchOptions
	extends
		Omit<TransactionOptions, 'retries' | 'retryDelay' | 'durable'>,
		GroupOptions {
	/**
	 * Checks the results before COMMIT is sent; throwing rolls the
	 * transaction back. COMMIT then waits for the results: a second round
	 * trip.
	 */
	readonly verify?:
		| ((results: readonly QueryResult<unknown>[]) => void)
		| undefined;
}

/** A batch running in its own transaction. */
export interface TransactionBatch {
	/** Each statement's result; once one fails, the rest reject with its error. */
	readonly results: readonly Promise<QueryResult<unknown>>[];
	/** The results once committed; rejects with why the transaction rolled back. */
	readonly done: Promise<QueryResult<unknown>[]>;
}

/** Query options accepted inside a transaction (the connection's own options). */
export type TxQueryOptions = Readonly<Record<string, unknown>>;
/** A cursor's options inside a transaction: no `keepRows`, as on a connection. */
type TxCursorOptions = TxQueryOptions & {
	readonly batchSize?: number;
	readonly keepRows?: never;
};

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
function settingsQuery(
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
	/** @param cause the error of the statement that failed the transaction, when known */
	constructor(cause?: Error) {
		super(
			'The transaction was rolled back because an earlier statement in it failed',
			cause === undefined ? undefined : { cause },
		);
		this.name = 'TransactionRolledBack';
	}
}

/**
 * The error to report for a scope that failed with `error`: a statement
 * refused because the transaction had already failed (25P02) reports the
 * error that failed it instead, which the code may have caught and gone on.
 */
function firstError(error: unknown, first: Error | undefined): unknown {
	return first !== undefined &&
		error instanceof PostgresError &&
		error.code === '25P02'
		? first
		: error;
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

/** Statements that wait to go out with the next statement, under its Sync (see `Session.queue`). */
export interface Pending {
	readonly statements: readonly GroupStatement[];
	sent: boolean;
}

const UNPREPARED = { prepare: false } as const;

/** Connections running `Transaction.run` or `batch`, which may not have sent BEGIN yet. */
const running = new WeakSet<BatchConnection>();

/**
 * BEGIN and the settings that open a transaction on `conn`, unprepared:
 * they run once per transaction, and can't go stale. Throws when the
 * options are invalid or `conn` is already in a transaction.
 */
function openingStatements(
	conn: BatchConnection,
	options: TransactionOptions,
): GroupStatement[] {
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
	const opening: GroupStatement[] = [
		{ sql: beginStatement(options), options: { prepare: false } },
	];
	if (settings) opening.push({ ...settings, options: { prepare: false } });
	return opening;
}

/**
 * The connection as one transaction and its savepoints use it, saving
 * round trips without changing what runs:
 *
 * - BEGIN and the settings wait for the first statement and share its
 *   Sync, so a failed BEGIN makes the server skip that statement instead
 *   of running it outside the transaction. Statements issued before BEGIN's
 *   outcome is known wait for it, and fail with its error.
 * - `queue` holds statements (`savepoint`, `release savepoint`, a
 *   savepoint's settings) until the next statement, which goes out with
 *   them under one Sync: once one fails, the server skips the rest, which
 *   reject with its error. Statements that need a Sync of their own send
 *   them first, without waiting for their answer; the next statement then
 *   reports their error. Queued statements nothing followed are dropped.
 * - `commitWith` sends COMMIT right behind a statement, without waiting.
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
	/** Statements waiting for the next one, to share its Sync. */
	#prefix: Pending[] | undefined;
	/** COMMIT, once sent behind the transaction's last statement. */
	#commit: Promise<QueryResult<unknown>> | undefined;

	constructor(conn: TransactionConnection, opening: readonly GroupStatement[]) {
		this.#conn = conn;
		this.#opening = opening;
	}

	/** The error that failed the transaction, while it is failed. */
	get transactionError(): Error | undefined {
		return this.#conn.transactionError;
	}

	/** COMMIT, if `commitWith` sent it. */
	get committed(): Promise<QueryResult<unknown>> | undefined {
		return this.#commit;
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
			(this.#opening !== undefined || this.#prefix !== undefined) &&
			(options === undefined ||
				OWN_SYNC.every((key) => options[key] === undefined))
		) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rows are typed by the caller, as in `asResult`
			return this.#group([{ sql, params, options }])[0] as Promise<
				QueryResult<R>
			>;
		}
		return this.#send(() => this.#conn.query<R>(sql, params, options));
	}

	/**
	 * Runs `sql` and sends COMMIT right behind it, under a Sync of its own,
	 * without waiting: the transaction is one round trip shorter. If the
	 * statement fails, COMMIT reports ROLLBACK. If BEGIN failed, the
	 * statement was skipped, and COMMIT, outside a transaction, does nothing.
	 */
	commitWith<R>(
		sql: string,
		params: readonly unknown[] | undefined,
		options: TxQueryOptions | undefined,
	): Promise<QueryResult<R>> {
		const result = this.query<R>(sql, params, options);
		// behind the statement, which may wait for BEGIN's answer: only then
		// does COMMIT wait too, to keep the order
		const commit =
			this.#waiting === undefined
				? this.#conn.query('commit')
				: this.#send(() => this.#conn.query('commit'));
		commit.catch(noop);
		this.#commit = commit;
		return result;
	}

	/**
	 * Holds `statements` to go out with the next statement, under its Sync;
	 * dropped if nothing follows (`drop`).
	 */
	queue(statements: readonly GroupStatement[]): Pending {
		const pending: Pending = { statements, sent: false };
		(this.#prefix ??= []).push(pending);
		return pending;
	}

	/** Drops queued statements not sent yet; false when they were sent. */
	drop(pending: Pending): boolean {
		if (pending.sent) return false;
		const prefix = this.#prefix;
		const index = prefix?.indexOf(pending) ?? -1;
		if (prefix !== undefined && index >= 0) {
			prefix.splice(index, 1);
			if (prefix.length === 0) this.#prefix = undefined;
		}
		return true;
	}

	/** Runs statements under one Sync, which BEGIN shares if not yet sent: once one fails, the rest reject with its error. */
	queryGroup(
		statements: readonly GroupStatement[],
		options?: GroupOptions,
	): Promise<QueryResult<unknown>>[] {
		if (this.#opening !== undefined || this.#prefix !== undefined)
			return this.#group(statements, options);
		const group = this.#send(() => {
			const results = this.#conn.queryGroup(statements, options);
			// read below once the group was sent; it may never be, if a deferred statement failed
			for (const result of results) result.catch(noop);
			return Promise.resolve(results);
		});
		return statements.map((_, i) => group.then((results) => results[i]!));
	}

	cursor<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxCursorOptions,
	): AsyncIterable<R[]> {
		if (options?.['statementTimeout'] !== undefined) {
			// it would run the cursor as one operation, with no queries between its batches
			const refused = new DriverError(
				'A cursor inside a transaction takes no statementTimeout, since other queries run between its batches: set statement_timeout with set_config(…, true)',
			);
			return {
				[Symbol.asyncIterator]: () => ({
					next: () => Promise.reject(refused),
				}),
			};
		}
		return this.#iterate(() => this.#conn.cursor<R>(sql, params, options));
	}

	stream<R>(
		sql: string,
		params?: readonly unknown[],
		options?: TxCursorOptions,
	): RowStream<R> {
		return new RowStream(this.cursor<R>(sql, params, options));
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

	/** Waits for BEGIN's outcome (dropping it, and anything queued, if never sent); its error, if it failed. */
	async end(): Promise<{ error: unknown } | undefined> {
		this.#opening = undefined;
		this.#prefix = undefined;
		if (this.#opened !== undefined) await this.#opened;
		return this.#failure;
	}

	/** The queued statements, now being sent. */
	#takePrefix(): GroupStatement[] {
		const prefix = this.#prefix;
		if (prefix === undefined) return [];
		this.#prefix = undefined;
		const statements: GroupStatement[] = [];
		for (const pending of prefix) {
			pending.sent = true;
			statements.push(...pending.statements);
		}
		return statements;
	}

	/** Sends `statements` with BEGIN (if not sent yet) and the queued statements, under one Sync; their results. */
	#group(
		statements: readonly GroupStatement[],
		options?: GroupOptions,
	): Promise<QueryResult<unknown>>[] {
		const prefix = this.#takePrefix();
		if (this.#opening !== undefined) {
			const results = this.#begin([...prefix, ...statements], options);
			// a failed statement skips the rest, which report its error
			for (let i = 0; i < prefix.length; i++) results[i]?.catch(noop);
			return results.slice(prefix.length);
		}
		const all = [...prefix, ...statements];
		const group = this.#send(() => {
			const results = this.#conn.queryGroup(all, options);
			// read below once the group was sent; it may never be, if a deferred statement failed
			for (const result of results) result.catch(noop);
			return Promise.resolve(results);
		});
		return statements.map((_, i) =>
			group.then((results) => results[prefix.length + i]!),
		);
	}

	/** Sends the queued statements without waiting for their answer: the next statement reports their error. */
	#sendPrefix(): void {
		const prefix = this.#takePrefix();
		const sent = this.#send(() => {
			const results = this.#conn.queryGroup(prefix);
			for (const result of results) result.catch(noop);
			// oxlint-disable-next-line typescript/no-non-null-assertion -- never empty
			return results.at(-1)!;
		});
		sent.catch(noop);
		this.#deferred = sent;
	}

	/** Sends BEGIN and the settings, with `statements` under the same Sync; their results. */
	#begin(
		statements: readonly GroupStatement[] = [],
		options?: GroupOptions,
	): Promise<QueryResult<unknown>>[] {
		const opening = this.#opening ?? [];
		this.#opening = undefined;
		const results = this.#conn.queryGroup([...opening, ...statements], options);
		// a failed statement skips the rest, so the last opening one reports for all
		for (let i = 0; i < opening.length - 1; i++) results[i]?.catch(noop);
		this.#beginning = true;
		this.#opened = (results[opening.length - 1] ?? Promise.resolve()).then(
			() => this.#began(undefined),
			(error: unknown) => this.#began({ error }),
		);
		return results.slice(opening.length);
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
		if (this.#prefix !== undefined) this.#sendPrefix();
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
			this.#prefix === undefined &&
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

	/**
	 * Runs the transaction's last statement and commits: COMMIT goes out
	 * right behind it, without waiting for its answer, and the transaction
	 * then takes no more statements. A callback whose only statement this
	 * is runs in one round trip (BEGIN shares its Sync). If it fails, the
	 * transaction rolls back (COMMIT reports ROLLBACK); once it succeeded,
	 * nothing the callback does after it can roll the transaction back.
	 * Only in the outermost transaction, not a savepoint.
	 */
	queryAndCommit<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: TxQueryOptions,
	): Promise<QueryResult<R>> {
		if (this.#finished) return Promise.reject(finishedError());
		if (this.#depth > 0)
			return Promise.reject(
				new DriverError(
					'queryAndCommit() ends the outermost transaction, not a savepoint',
				),
			);
		this.#finished = true;
		return this.#conn.commitWith<R>(sql, params, options);
	}

	/**
	 * @internal Runs statements under one Sync, in one round trip (with
	 * BEGIN, if it wasn't sent yet): once one fails, the server skips the
	 * rest, and they reject with its error.
	 */
	queryGroup(
		statements: readonly GroupStatement[],
		options?: GroupOptions,
	): Promise<QueryResult<unknown>>[] {
		if (this.#finished) {
			const error = finishedError();
			return statements.map(() => Promise.reject(error));
		}
		return this.#conn.queryGroup(statements, options);
	}

	cursor<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: TxCursorOptions,
	): AsyncIterable<R[]> {
		this.#check();
		return this.#conn.cursor<R>(sql, params, options);
	}

	/**
	 * Like `cursor`, one row at a time. Other queries of the transaction
	 * run between its batches, so the loop can run them.
	 */
	stream<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: TxCursorOptions,
	): RowStream<R> {
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

	/**
	 * Runs `fn` in a savepoint: rolled back to on error, released on success.
	 * The `savepoint` (and its settings) go out with `fn`'s first statement,
	 * and the release with the statement after the savepoint, each under
	 * that statement's Sync, so a savepoint adds no round trip; one in which
	 * `fn` runs no statement sends nothing. An error `fn` caught and went on
	 * after makes the savepoint fail with that error, not with the "current
	 * transaction is aborted" (25P02) of the statements after it.
	 */
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
		const opening: GroupStatement[] = [
			{ sql: `savepoint ${name}`, options: UNPREPARED },
		];
		const settings =
			options.settings === undefined
				? undefined
				: settingsQuery(options.settings);
		if (settings) opening.push({ ...settings, options: UNPREPARED });
		const conn = this.#conn;
		const savepoint = conn.queue(opening);
		const inner = new Transaction(conn, this.#depth + 1);
		try {
			const result = await fn(inner);
			if (conn.transactionStatus === 'failed') {
				// fn caught a database error and went on: fails as if it threw it
				throw (
					conn.transactionError ??
					new DriverError('A statement in the savepoint failed')
				);
			}
			inner.#finished = true;
			if (!conn.drop(savepoint))
				conn.queue([{ sql: `release savepoint ${name}`, options: UNPREPARED }]);
			this.#afterCommit.push(...inner.#afterCommit);
			this.#afterRollback.push(...inner.#afterRollback);
			return result;
		} catch (caught) {
			inner.#finished = true;
			let error = caught;
			if (!conn.drop(savepoint) && conn.transactionStatus !== 'idle') {
				error = firstError(caught, conn.transactionError);
				await Promise.all(
					conn
						.queryGroup([
							{ sql: `rollback to savepoint ${name}`, options: UNPREPARED },
							{ sql: `release savepoint ${name}`, options: UNPREPARED },
						])
						.map((result) => result.catch(noop)),
				);
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
		const opening = openingStatements(conn, options);
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
					const commit = await (session.committed ?? session.query('commit'));
					if (commit.command === 'ROLLBACK')
						throw new TransactionRolledBack(session.transactionError);
				} catch (caught) {
					tx.#finished = true;
					// when BEGIN or the settings failed, fn's statements were skipped: that error is the one to report
					const failure = await session.end();
					const committed = await session.committed?.then(
						(commit) => commit.command === 'COMMIT',
						() => false,
					);
					if (committed === true && failure === undefined) {
						// COMMIT went out behind the last statement, which succeeded: fn's error came after
						runCallbacks(tx.#afterCommit);
						throw caught;
					}
					const error =
						failure === undefined
							? firstError(caught, session.transactionError)
							: failure.error;
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

	/**
	 * @internal Runs `statements` as one transaction, in one round trip:
	 * BEGIN and the settings share the statements' Sync, and COMMIT follows
	 * with its own without waiting. A failed statement makes the server skip
	 * the rest, so COMMIT reports ROLLBACK; if BEGIN itself failed, nothing
	 * ran, and COMMIT, outside a transaction, does nothing.
	 *
	 * Without `verify`, COMMIT is sent before any result is read: a result
	 * the client can't decode fails the batch, but its transaction has
	 * committed. Throws when the options are invalid or `conn` is already in
	 * a transaction.
	 */
	static batch(
		conn: BatchConnection,
		statements: readonly GroupStatement[],
		options: TransactionBatchOptions = {},
	): TransactionBatch {
		const opening = openingStatements(conn, options);
		const { verify, signal } = options;
		running.add(conn);
		const all = conn.queryGroup([...opening, ...statements], { signal });
		// a failed statement skips the rest, so the statements report for BEGIN too
		for (const result of all) result.catch(noop);
		const results = all.slice(opening.length);
		// nothing is sent once aborted, so nothing needs committing
		const pipelined =
			verify === undefined && !signal?.aborted
				? conn.query('commit')
				: undefined;
		pipelined?.catch(noop);
		const done = (async () => {
			try {
				let failure: { error: unknown } | undefined;
				let rows: QueryResult<unknown>[] = [];
				try {
					rows = (await Promise.all(all)).slice(opening.length);
					verify?.(rows);
				} catch (error) {
					failure = { error };
				}
				if (failure !== undefined) {
					await pipelined?.catch(noop);
					throw failure.error;
				}
				const commit = await (pipelined ?? conn.query('commit'));
				if (commit.command === 'ROLLBACK') throw new TransactionRolledBack();
				return rows;
			} finally {
				if (conn.transactionStatus !== 'idle')
					await conn.query('rollback').catch(noop);
				running.delete(conn);
			}
		})();
		return { results, done };
	}
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
