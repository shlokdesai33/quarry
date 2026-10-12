import {
	resolveConfig,
	type ConnectionOptions,
	type ResolvedConfig,
} from './config.js';
import { openConnection, preloadSockets } from './connect.js';
import type { Connection, CursorOptions, QueryOptions } from './connection.js';
import { AbortError, ConnectionError, DriverError } from './errors.js';
import type { Notification } from './notice.js';
import type { Description, QueryResult } from './ops.js';
import type { Transaction, TransactionOptions } from './transaction.js';

export interface PoolOptions extends ConnectionOptions {
	/** The most connections open at once (default 10). */
	readonly max?: number | undefined;
	/** Connections kept open even when idle (default 0). */
	readonly min?: number | undefined;
	/** Closes connections idle this long, in milliseconds (default 30s; 0 never). */
	readonly idleTimeout?: number | undefined;
	/**
	 * Replaces connections older than this, in milliseconds (default 1 hour,
	 * with up to 10% random jitter so they don't all recycle at once; 0 never).
	 */
	readonly maxLifetime?: number | undefined;
	/** How long `acquire` waits for a free connection, in milliseconds (default 30s; 0 forever). */
	readonly acquireTimeout?: number | undefined;
	/** The most callers waiting for a connection before `acquire` fails fast (default unlimited). */
	readonly maxWaiting?: number | undefined;
	/**
	 * Once every connection is in use, `query`, `simpleQuery` and `describe`
	 * share connections, pipelining up to this many queries on each (default
	 * 50; 0 or false to give every query a connection to itself). Beyond
	 * that, queries wait in line and take the next free slot. Reserved
	 * clients, transactions, cursors and COPY always get their own
	 * connection: while one waits, a shared connection takes no new queries
	 * and is handed over as soon as the ones in flight finish.
	 */
	readonly pipeline?: number | false | undefined;
	/** Runs on each new connection before it is used, e.g. to set session state. */
	readonly onConnect?:
		| ((connection: Connection) => Promise<void> | void)
		| undefined;
}

/** A point-in-time view of the pool. */
export interface PoolStats {
	/** Connections open or being opened. */
	readonly total: number;
	readonly idle: number;
	/** Connections handed out. */
	readonly busy: number;
	/** Callers waiting for a connection or a pipeline slot. */
	readonly waiting: number;
}

interface Waiter {
	resolve(connection: Connection): void;
	reject(error: Error): void;
	cleanup(): void;
}

interface Idle {
	readonly connection: Connection;
	readonly timer: ReturnType<typeof setTimeout> | undefined;
}

function unref(timer: ReturnType<typeof setTimeout>): void {
	if (typeof timer === 'object' && timer !== null && 'unref' in timer)
		timer.unref();
}

/**
 * A connection reserved from a pool. Release it when done, or let
 * `await using` do it.
 */
export class PoolClient implements AsyncDisposable {
	readonly #pool: Pool;
	readonly #release: (connection: Connection, discard: boolean) => void;
	#connection: Connection | undefined;

	/** @internal */
	constructor(
		pool: Pool,
		connection: Connection,
		release: (connection: Connection, discard: boolean) => void,
	) {
		this.#pool = pool;
		this.#connection = connection;
		this.#release = release;
	}

	/** The underlying connection, for everything the client doesn't wrap. */
	get connection(): Connection {
		if (this.#connection === undefined)
			throw new DriverError('This client has been released');
		return this.#connection;
	}

	get pool(): Pool {
		return this.#pool;
	}

	query<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: QueryOptions,
	): Promise<QueryResult<R>> {
		return this.connection.query<R>(sql, params, options);
	}

	cursor<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: CursorOptions,
	): AsyncIterable<R[]> {
		return this.connection.cursor<R>(sql, params, options);
	}

	stream<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: CursorOptions,
	): AsyncIterable<R> {
		return this.connection.stream<R>(sql, params, options);
	}

	describe(
		sql: string,
		options?: Pick<QueryOptions, 'paramTypes'>,
	): Promise<Description> {
		return this.connection.describe(sql, options);
	}

	transaction<T>(
		fn: (tx: Transaction) => Promise<T>,
		options?: TransactionOptions,
	): Promise<T> {
		return this.connection.transaction(fn, options);
	}

	/**
	 * Returns the connection to the pool. Pass `true` (or an error) to close
	 * it instead, e.g. after leaving session state behind.
	 */
	release(discard: boolean | Error = false): void {
		const connection = this.#connection;
		if (connection === undefined) return;
		this.#connection = undefined;
		this.#release(connection, discard !== false);
	}

	[Symbol.asyncDispose](): Promise<void> {
		this.release();
		return Promise.resolve();
	}
}

/**
 * A pool of connections. `query` and friends borrow a connection for one
 * call; `acquire` reserves one; `transaction` runs a callback on one.
 *
 * @example
 * const pool = createPool({ connectionString: process.env.DATABASE_URL, max: 20 });
 * const { rows } = await pool.query('select * from users where id = $1', [id]);
 */
export class Pool implements AsyncDisposable {
	readonly #config: ResolvedConfig;
	readonly #max: number;
	readonly #min: number;
	readonly #idleTimeout: number;
	readonly #maxLifetime: number;
	readonly #acquireTimeout: number;
	readonly #maxWaiting: number;
	readonly #onConnect: PoolOptions['onConnect'];
	readonly #pipeline: number;
	/** Queries in flight on each connection lent out for `query` (shareable). */
	readonly #shared = new Map<Connection, number>();
	readonly #idle: Idle[] = [];
	readonly #busy = new Set<Connection>();
	readonly #expiresAt = new WeakMap<Connection, number>();
	/** Callers waiting for a connection of their own (acquire, transaction, cursor, COPY). */
	readonly #waiters: Waiter[] = [];
	/** Queries waiting for a pipeline slot on a shared connection. */
	readonly #sharedWaiters: Waiter[] = [];
	/** Shared connections taking no new queries, to be handed to a waiter of `#waiters` once idle. */
	readonly #draining = new Set<Connection>();
	#opening = 0;
	#ended = false;
	#ending: Promise<void> | undefined;
	/** Resolved once an ending pool has no waiters and no connections lent out. */
	readonly #drainWaiters: (() => void)[] = [];
	/** Connections closed after being given back to an ending pool. */
	readonly #closing: Promise<void>[] = [];
	#listener: Listener | undefined;

	constructor(options: PoolOptions | string = {}) {
		const o: PoolOptions =
			typeof options === 'string' ? { connectionString: options } : options;
		this.#config = resolveConfig(o);
		this.#max = o.max ?? 10;
		this.#min = Math.min(o.min ?? 0, this.#max);
		this.#idleTimeout = o.idleTimeout ?? 30_000;
		this.#maxLifetime = o.maxLifetime ?? 3_600_000;
		this.#acquireTimeout = o.acquireTimeout ?? 30_000;
		this.#maxWaiting = o.maxWaiting ?? Number.POSITIVE_INFINITY;
		this.#onConnect = o.onConnect;
		this.#pipeline = o.pipeline === false ? 0 : (o.pipeline ?? 50);
		if (this.#max < 1) throw new DriverError('max must be at least 1');
		this.#fillMin();
		// in the background: no cost to createPool, a faster first query
		unref(setTimeout(() => preloadSockets(this.#config), 0));
	}

	get stats(): PoolStats {
		return {
			total: this.#idle.length + this.#busy.size + this.#opening,
			idle: this.#idle.length,
			busy: this.#busy.size,
			waiting: this.#waiters.length + this.#sharedWaiters.length,
		};
	}

	get ended(): boolean {
		return this.#ended;
	}

	#total(): number {
		return this.#idle.length + this.#busy.size + this.#opening;
	}

	#expired(connection: Connection): boolean {
		const expiresAt = this.#expiresAt.get(connection);
		return expiresAt !== undefined && Date.now() >= expiresAt;
	}

	async #open(): Promise<Connection> {
		this.#opening++;
		try {
			const connection = await openConnection(this.#config);
			try {
				await this.#onConnect?.(connection);
			} catch (error) {
				connection.destroy();
				throw error;
			}
			if (this.#maxLifetime > 0) {
				this.#expiresAt.set(
					connection,
					Date.now() + this.#maxLifetime * (1 - Math.random() * 0.1),
				);
			}
			connection.onClose(() => this.#forget(connection));
			return connection;
		} finally {
			this.#opening--;
		}
	}

	/** Drops a connection that closed on its own (server restart, network loss, idle timeout). */
	#forget(connection: Connection): void {
		const index = this.#idle.findIndex(
			(idle) => idle.connection === connection,
		);
		if (index >= 0) {
			const [idle] = this.#idle.splice(index, 1);
			if (idle?.timer !== undefined) clearTimeout(idle.timer);
		}
		this.#busy.delete(connection);
		this.#shared.delete(connection);
		this.#draining.delete(connection);
		this.#serveWaiters();
		this.#rebalance();
		this.#fillMin();
		this.#checkDrained();
	}

	#fillMin(): void {
		if (this.#ended) return;
		while (this.#total() < this.#min) {
			this.#open().then(
				(connection) => this.#giveBack(connection),
				() => {
					// retried on the next acquire or release
				},
			);
		}
	}

	/**
	 * Hands an available connection to the first caller waiting for one of
	 * their own, else to queries waiting for a slot, or parks it idle. Once
	 * the pool is ending, waiters are still served, and connections nobody
	 * waits for are closed.
	 */
	#giveBack(connection: Connection): void {
		if (connection.closed) {
			this.#serveWaiters();
			this.#checkDrained();
			return;
		}
		const waiter = this.#waiters.shift();
		if (waiter !== undefined) {
			waiter.cleanup();
			this.#busy.add(connection);
			waiter.resolve(connection);
			this.#rebalance();
			return;
		}
		if (this.#sharedWaiters.length > 0 && this.#shareable(connection)) {
			this.#busy.add(connection);
			this.#shared.set(connection, 0);
			// share the queue with connections still opening, so a burst spreads out
			this.#fillShared(
				connection,
				Math.ceil(this.#sharedWaiters.length / (this.#opening + 1)),
			);
			return;
		}
		if (this.#ended) {
			this.#closing.push(connection.close().catch(() => {}));
			this.#checkDrained();
			return;
		}
		// the idle timeout, or the end of the connection's lifetime if that comes first
		const expiresAt = this.#expiresAt.get(connection);
		const delay = Math.min(
			this.#idleTimeout > 0 ? this.#idleTimeout : Number.POSITIVE_INFINITY,
			expiresAt === undefined
				? Number.POSITIVE_INFINITY
				: Math.max(0, expiresAt - Date.now()),
		);
		const timer = Number.isFinite(delay)
			? setTimeout(() => {
					const index = this.#idle.findIndex(
						(idle) => idle.connection === connection,
					);
					if (index < 0) return;
					this.#idle.splice(index, 1);
					if (this.#expired(connection)) {
						// replaced even when that leaves fewer than min
						void connection.close();
						this.#fillMin();
					} else if (this.#total() < this.#min) {
						this.#giveBack(connection);
					} else {
						void connection.close();
					}
				}, delay)
			: undefined;
		if (timer !== undefined) unref(timer);
		this.#idle.push({ connection, timer });
	}

	/** Lets `end` finish once nothing is waiting and nothing is lent out. */
	#checkDrained(): void {
		if (
			!this.#ended ||
			this.#waiters.length > 0 ||
			this.#sharedWaiters.length > 0 ||
			this.#busy.size > 0 ||
			this.#opening > 0
		)
			return;
		for (const resolve of this.#drainWaiters.splice(0)) resolve();
	}

	/** Opens connections for waiters while there is room. */
	#serveWaiters(): void {
		while (
			this.#waiters.length + this.#sharedWaiters.length > this.#opening &&
			this.#total() < this.#max
		) {
			this.#open().then(
				(connection) => this.#giveBack(connection),
				(error: unknown) => {
					const waiter = this.#waiters.shift() ?? this.#sharedWaiters.shift();
					if (waiter) {
						waiter.cleanup();
						waiter.reject(
							error instanceof Error
								? error
								: new ConnectionError(String(error)),
						);
					}
					this.#rebalance();
					// one failed attempt per waiter: the others get attempts of their own
					this.#serveWaiters();
					this.#checkDrained();
				},
			);
		}
	}

	/** Whether a connection can take more pipelined queries. */
	#shareable(connection: Connection): boolean {
		return (
			!connection.closed &&
			connection.transactionStatus === 'idle' &&
			!this.#expired(connection)
		);
	}

	/** Gives free pipeline slots on a shared connection to queued queries, up to `limit` in flight. */
	#fillShared(connection: Connection, limit = this.#pipeline): void {
		let count = this.#shared.get(connection) ?? 0;
		const cap = Math.min(limit, this.#pipeline);
		while (
			count < cap &&
			this.#sharedWaiters.length > 0 &&
			!this.#draining.has(connection) &&
			this.#shareable(connection)
		) {
			const waiter = this.#sharedWaiters.shift();
			if (waiter === undefined) break;
			waiter.cleanup();
			this.#shared.set(connection, ++count);
			waiter.resolve(connection);
		}
	}

	/**
	 * Keeps one shared connection draining for each caller waiting for a
	 * connection of their own that no opening connection will serve. A
	 * draining connection takes no new queries, so the waiter gets it once
	 * the queries already in flight on it finish (at most `pipeline`), however
	 * many queries keep arriving. The other connections keep pipelining.
	 */
	#rebalance(): void {
		const target =
			this.#ended || this.#total() < this.#max
				? 0
				: Math.max(0, this.#waiters.length - this.#opening);
		for (const connection of this.#draining) {
			if (this.#draining.size <= target) break;
			this.#draining.delete(connection);
			this.#fillShared(connection);
		}
		while (this.#draining.size < target) {
			let best: Connection | undefined;
			let fewest = Number.POSITIVE_INFINITY;
			for (const [connection, count] of this.#shared) {
				if (count < fewest && !this.#draining.has(connection)) {
					best = connection;
					fewest = count;
				}
			}
			if (best === undefined) break;
			this.#draining.add(best);
		}
	}

	/** An idle connection, marked busy, or undefined; most recently used first, so surplus connections time out. */
	#takeIdle(): Connection | undefined {
		if (this.#ended) return undefined;
		while (this.#idle.length > 0) {
			const idle = this.#idle.pop();
			if (idle === undefined) break;
			if (idle.timer !== undefined) clearTimeout(idle.timer);
			if (idle.connection.closed || this.#expired(idle.connection)) {
				void idle.connection.close();
				continue;
			}
			this.#busy.add(idle.connection);
			return idle.connection;
		}
		return undefined;
	}

	#take(signal?: AbortSignal): Promise<Connection> {
		if (this.#ended)
			return Promise.reject(new DriverError('The pool has ended'));
		if (signal?.aborted)
			return Promise.reject(
				new AbortError('Acquiring a connection was aborted', {
					cause: signal.reason,
				}),
			);
		const idle = this.#takeIdle();
		if (idle !== undefined) return Promise.resolve(idle);
		const waiting = this.#wait(this.#waiters, signal);
		this.#serveWaiters();
		this.#rebalance();
		return waiting;
	}

	/** Queues a caller; it is resolved with a connection by `#giveBack` or `#fillShared`. */
	#wait(queue: Waiter[], signal: AbortSignal | undefined): Promise<Connection> {
		if (this.#waiters.length + this.#sharedWaiters.length >= this.#maxWaiting) {
			return Promise.reject(
				new DriverError(
					`Too many callers waiting for a connection (maxWaiting ${this.#maxWaiting})`,
				),
			);
		}
		return new Promise((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const waiter: Waiter = {
				resolve,
				reject,
				cleanup: () => {
					if (timer !== undefined) clearTimeout(timer);
					signal?.removeEventListener('abort', onAbort);
				},
			};
			const remove = (error: Error) => {
				const index = queue.indexOf(waiter);
				if (index < 0) return;
				queue.splice(index, 1);
				waiter.cleanup();
				reject(error);
				this.#rebalance();
				this.#checkDrained();
			};
			const onAbort = () =>
				remove(
					new AbortError('Acquiring a connection was aborted', {
						cause: signal?.reason,
					}),
				);
			if (this.#acquireTimeout > 0) {
				timer = setTimeout(
					() =>
						remove(
							new ConnectionError(
								`Timed out after ${this.#acquireTimeout}ms waiting for a connection`,
								{ code: 'ETIMEDOUT' },
							),
						),
					this.#acquireTimeout,
				);
			}
			signal?.addEventListener('abort', onAbort, { once: true });
			queue.push(waiter);
		});
	}

	#release = (connection: Connection, discard: boolean): void => {
		if (!this.#busy.has(connection)) return;
		const reusable =
			!discard && !connection.closed && !this.#expired(connection);
		if (!reusable) {
			this.#busy.delete(connection);
			const closing = connection.close().catch(() => {});
			if (this.#ended) this.#closing.push(closing);
			this.#serveWaiters();
			this.#fillMin();
			this.#checkDrained();
			return;
		}
		if (connection.pending > 0 || connection.transactionStatus !== 'idle') {
			// queries still running, or a transaction left open: never hand that
			// to someone else; it stays lent out until its queries finish
			void connection.idle().then(() => {
				if (connection.transactionStatus === 'idle') {
					this.#release(connection, false);
				} else {
					this.#busy.delete(connection);
					connection.destroy(
						new DriverError('Released with a transaction open'),
					);
					this.#serveWaiters();
					this.#checkDrained();
				}
				return undefined;
			});
			return;
		}
		this.#busy.delete(connection);
		this.#giveBack(connection);
	};

	/** Reserves a connection until `release` is called. */
	async acquire(options: { signal?: AbortSignal } = {}): Promise<PoolClient> {
		const connection = await this.#take(options.signal);
		return new PoolClient(this, connection, this.#release);
	}

	async #with<T>(
		signal: AbortSignal | undefined,
		fn: (connection: Connection) => Promise<T>,
	): Promise<T> {
		const connection = await this.#take(signal);
		try {
			return await fn(connection);
		} finally {
			this.#release(connection, false);
		}
	}

	/**
	 * A connection already lent out for queries that can take one more: the
	 * least loaded, once the pool is full and no query is queued ahead.
	 */
	#pickShared(): Connection | undefined {
		if (
			this.#pipeline <= 1 ||
			this.#idle.length > 0 ||
			this.#sharedWaiters.length > 0 ||
			this.#total() < this.#max
		) {
			return undefined;
		}
		let best: Connection | undefined;
		let fewest = this.#pipeline;
		for (const [connection, count] of this.#shared) {
			if (
				count < fewest &&
				!this.#draining.has(connection) &&
				this.#shareable(connection)
			) {
				best = connection;
				fewest = count;
			}
		}
		return best;
	}

	/**
	 * Runs `fn` on a shareable connection: an idle one, else pipelined onto a
	 * busy one when the pool is full, else the next free slot in line.
	 */
	async #withShared<T>(
		signal: AbortSignal | undefined,
		fn: (connection: Connection) => Promise<T>,
	): Promise<T> {
		if (this.#pipeline <= 1 || signal?.aborted || this.#ended)
			return this.#with(signal, fn);
		// claimed before any await, so queries issued in the same tick see it
		let connection = this.#takeIdle() ?? this.#pickShared();
		if (connection !== undefined) {
			this.#shared.set(connection, (this.#shared.get(connection) ?? 0) + 1);
		} else {
			// a slot handed over by #fillShared is already counted
			const waiting = this.#wait(this.#sharedWaiters, signal);
			this.#serveWaiters();
			connection = await waiting;
		}
		try {
			return await fn(connection);
		} finally {
			this.#done(connection);
		}
	}

	/** Frees a query's slot: straight to the next queued query, or back to the pool when the last one ends. */
	#done(connection: Connection): void {
		const left = (this.#shared.get(connection) ?? 1) - 1;
		this.#shared.set(connection, left);
		this.#fillShared(connection);
		if ((this.#shared.get(connection) ?? 0) > 0) return;
		this.#shared.delete(connection);
		this.#draining.delete(connection);
		this.#release(connection, false);
	}

	query<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: QueryOptions,
	): Promise<QueryResult<R>> {
		return this.#withShared(options?.signal, (connection) =>
			connection.query<R>(sql, params, options),
		);
	}

	simpleQuery<R = Record<string, unknown>>(
		sql: string,
		options?: Pick<QueryOptions, 'rowMode' | 'types' | 'signal' | 'timeout'>,
	): Promise<QueryResult<R>[]> {
		return this.#withShared(options?.signal, (connection) =>
			connection.simpleQuery<R>(sql, options),
		);
	}

	describe(
		sql: string,
		options?: Pick<QueryOptions, 'paramTypes' | 'signal' | 'timeout'>,
	): Promise<Description> {
		return this.#withShared(options?.signal, (connection) =>
			connection.describe(sql, options),
		);
	}

	/** Runs `fn` in a transaction on one connection; see `Connection.transaction`. */
	transaction<T>(
		fn: (tx: Transaction) => Promise<T>,
		options?: TransactionOptions & { signal?: AbortSignal },
	): Promise<T> {
		return this.#with(options?.signal, (connection) =>
			connection.transaction(fn, options),
		);
	}

	/** Streams batches on a connection held for the whole iteration. */
	async *cursor<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: CursorOptions,
	): AsyncGenerator<R[], void, undefined> {
		const connection = await this.#take(options?.signal);
		try {
			yield* connection.cursor<R>(sql, params, options);
		} finally {
			this.#release(connection, false);
		}
	}

	async *stream<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: CursorOptions,
	): AsyncGenerator<R, void, undefined> {
		for await (const batch of this.cursor<R>(sql, params, options))
			yield* batch;
	}

	copyFrom(
		sql: string,
		source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
		options?: Pick<QueryOptions, 'signal' | 'timeout'>,
	): Promise<number> {
		return this.#with(options?.signal, (connection) =>
			connection.copyFrom(sql, source, options),
		);
	}

	/** Bulk-loads rows with COPY; see `Connection.copyRows`. */
	copyRows(
		sql: string,
		rows: AsyncIterable<readonly unknown[]> | Iterable<readonly unknown[]>,
		options?: Pick<QueryOptions, 'signal' | 'timeout'>,
	): Promise<number> {
		return this.#with(options?.signal, (connection) =>
			connection.copyRows(sql, rows, options),
		);
	}

	async *copyTo(
		sql: string,
		options?: Pick<QueryOptions, 'signal' | 'timeout'>,
	): AsyncGenerator<Uint8Array, void, undefined> {
		const connection = await this.#take(options?.signal);
		try {
			yield* connection.copyTo(sql, options);
		} finally {
			this.#release(connection, false);
		}
	}

	/**
	 * Subscribes to a channel on a dedicated connection (outside `max`). If
	 * that connection drops, it reconnects and subscribes again; notifications
	 * sent while it was down are lost, as Postgres doesn't queue them.
	 */
	listen(
		channel: string,
		handler: (notification: Notification) => void,
	): Promise<() => Promise<void>> {
		if (this.#ended)
			return Promise.reject(new DriverError('The pool has ended'));
		this.#listener ??= new Listener(this.#config);
		return this.#listener.listen(channel, handler);
	}

	/**
	 * Stops taking new work and closes the pool once the work already issued
	 * is done: queries and callers already waiting for a connection still get
	 * one, and reserved clients and transactions keep theirs until they are
	 * released. With `timeout` (milliseconds), whatever is still waiting or
	 * running after that long is failed and its connection closed.
	 */
	end(options: { timeout?: number } = {}): Promise<void> {
		if (this.#ending === undefined) {
			this.#ended = true;
			this.#ending = this.#end(options.timeout);
		}
		return this.#ending;
	}

	async #end(timeout: number | undefined): Promise<void> {
		const closing = this.#idle.splice(0).map(({ connection, timer }) => {
			if (timer !== undefined) clearTimeout(timer);
			return connection.close();
		});
		const drained = new Promise<void>((resolve) => {
			this.#drainWaiters.push(resolve);
			this.#checkDrained();
		});
		if (timeout === undefined) {
			await drained;
		} else {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const expired = await Promise.race([
				drained.then(() => false),
				new Promise<boolean>((resolve) => {
					timer = setTimeout(() => resolve(true), timeout);
				}),
			]);
			clearTimeout(timer);
			if (expired) {
				this.#draining.clear();
				for (const waiter of [
					...this.#waiters.splice(0),
					...this.#sharedWaiters.splice(0),
				]) {
					waiter.cleanup();
					waiter.reject(new DriverError('The pool has ended'));
				}
				for (const connection of this.#busy)
					closing.push(connection.close({ timeout: 0 }));
			}
		}
		await Promise.all([
			...closing,
			...this.#closing.splice(0),
			this.#listener?.close(),
		]);
	}

	[Symbol.asyncDispose](): Promise<void> {
		return this.end();
	}
}

/** The pool's LISTEN connection: reconnects with backoff and re-subscribes every channel. */
class Listener {
	readonly #config: ResolvedConfig;
	readonly #channels = new Map<
		string,
		Set<(notification: Notification) => void>
	>();
	#connection: Promise<Connection> | undefined;
	#closed = false;
	#attempt = 0;

	constructor(config: ResolvedConfig) {
		this.#config = config;
	}

	#connect(): Promise<Connection> {
		this.#connection ??= (async () => {
			const connection = await openConnection(this.#config);
			connection.onNotification((notification) => {
				for (const handler of this.#channels.get(notification.channel) ?? [])
					handler(notification);
			});
			connection.onClose(() => {
				this.#connection = undefined;
				if (!this.#closed && this.#channels.size > 0) this.#reconnect();
			});
			for (const channel of this.#channels.keys()) {
				// oxlint-disable-next-line no-await-in-loop
				await connection.query(`listen ${quote(channel)}`, [], {
					prepare: false,
				});
			}
			this.#attempt = 0;
			return connection;
		})();
		this.#connection.catch(() => {
			this.#connection = undefined;
		});
		return this.#connection;
	}

	#reconnect(): void {
		const delay = Math.min(5000, 100 * 2 ** this.#attempt++);
		const timer = setTimeout(() => {
			if (this.#closed || this.#channels.size === 0) return;
			this.#connect().catch(() => this.#reconnect());
		}, delay);
		unref(timer);
	}

	async listen(
		channel: string,
		handler: (notification: Notification) => void,
	): Promise<() => Promise<void>> {
		let handlers = this.#channels.get(channel);
		const isNew = handlers === undefined;
		if (handlers === undefined) {
			handlers = new Set();
			this.#channels.set(channel, handlers);
		}
		handlers.add(handler);
		try {
			const connection = await this.#connect();
			if (isNew)
				await connection.query(`listen ${quote(channel)}`, [], {
					prepare: false,
				});
		} catch (error) {
			handlers.delete(handler);
			if (handlers.size === 0) this.#channels.delete(channel);
			throw error;
		}
		const set = handlers;
		return async () => {
			set.delete(handler);
			if (set.size > 0 || this.#channels.get(channel) !== set) return;
			this.#channels.delete(channel);
			const connection = await this.#connection?.catch(() => undefined);
			if (connection && !connection.closed)
				await connection.query(`unlisten ${quote(channel)}`, [], {
					prepare: false,
				});
		};
	}

	/** @internal For tests: the current connection, if open. */
	get connection(): Promise<Connection> | undefined {
		return this.#connection;
	}

	async close(): Promise<void> {
		this.#closed = true;
		const connection = await this.#connection?.catch(() => undefined);
		await connection?.close();
	}
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Creates a pool. Options can be a connection string. */
export function createPool(options?: PoolOptions | string): Pool {
	return new Pool(options);
}
