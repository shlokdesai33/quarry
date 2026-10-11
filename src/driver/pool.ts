import {
	resolveConfig,
	type ConnectionOptions,
	type ResolvedConfig,
} from './config.js';
import { openConnection } from './connect.js';
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
	/** Callers waiting for a connection. */
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
	readonly #idle: Idle[] = [];
	readonly #busy = new Set<Connection>();
	readonly #expiresAt = new WeakMap<Connection, number>();
	readonly #waiters: Waiter[] = [];
	#opening = 0;
	#ended = false;
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
		if (this.#max < 1) throw new DriverError('max must be at least 1');
		this.#fillMin();
	}

	get stats(): PoolStats {
		return {
			total: this.#idle.length + this.#busy.size + this.#opening,
			idle: this.#idle.length,
			busy: this.#busy.size,
			waiting: this.#waiters.length,
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
		this.#serveWaiters();
		this.#fillMin();
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

	/** Hands an available connection to the first waiter, or parks it idle. */
	#giveBack(connection: Connection): void {
		if (this.#ended || connection.closed) {
			connection.destroy();
			this.#serveWaiters();
			return;
		}
		const waiter = this.#waiters.shift();
		if (waiter !== undefined) {
			waiter.cleanup();
			this.#busy.add(connection);
			waiter.resolve(connection);
			return;
		}
		const timer =
			this.#idleTimeout > 0
				? setTimeout(() => {
						const index = this.#idle.findIndex(
							(idle) => idle.connection === connection,
						);
						if (index < 0 || this.#total() <= this.#min) return;
						this.#idle.splice(index, 1);
						void connection.close();
					}, this.#idleTimeout)
				: undefined;
		if (timer !== undefined) unref(timer);
		this.#idle.push({ connection, timer });
	}

	/** Opens connections for waiters while there is room. */
	#serveWaiters(): void {
		while (
			!this.#ended &&
			this.#waiters.length > this.#opening &&
			this.#total() < this.#max
		) {
			this.#open().then(
				(connection) => this.#giveBack(connection),
				(error: unknown) => {
					const waiter = this.#waiters.shift();
					if (waiter) {
						waiter.cleanup();
						waiter.reject(
							error instanceof Error
								? error
								: new ConnectionError(String(error)),
						);
					}
				},
			);
		}
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
		while (this.#idle.length > 0) {
			// most recently used first, so surplus connections go idle and time out
			const idle = this.#idle.pop();
			if (idle === undefined) break;
			if (idle.timer !== undefined) clearTimeout(idle.timer);
			if (idle.connection.closed || this.#expired(idle.connection)) {
				void idle.connection.close();
				continue;
			}
			this.#busy.add(idle.connection);
			return Promise.resolve(idle.connection);
		}
		if (this.#waiters.length >= this.#maxWaiting) {
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
				const index = this.#waiters.indexOf(waiter);
				if (index < 0) return;
				this.#waiters.splice(index, 1);
				waiter.cleanup();
				reject(error);
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
			this.#waiters.push(waiter);
			this.#serveWaiters();
		});
	}

	#release = (connection: Connection, discard: boolean): void => {
		if (!this.#busy.delete(connection)) return;
		const reusable =
			!discard && !connection.closed && !this.#expired(connection);
		if (!reusable) {
			void connection.close().catch(() => {});
			this.#serveWaiters();
			this.#fillMin();
			return;
		}
		if (connection.pending > 0 || connection.transactionStatus !== 'idle') {
			// queries still running, or a transaction left open: never hand that to someone else
			void connection.idle().then(() => {
				if (connection.transactionStatus === 'idle') {
					this.#busy.add(connection);
					this.#release(connection, false);
				} else {
					connection.destroy(
						new DriverError('Released with a transaction open'),
					);
					this.#serveWaiters();
				}
				return undefined;
			});
			return;
		}
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

	query<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: QueryOptions,
	): Promise<QueryResult<R>> {
		return this.#with(options?.signal, (connection) =>
			connection.query<R>(sql, params, options),
		);
	}

	simpleQuery<R = Record<string, unknown>>(
		sql: string,
		options?: Pick<QueryOptions, 'rowMode' | 'types' | 'signal' | 'timeout'>,
	): Promise<QueryResult<R>[]> {
		return this.#with(options?.signal, (connection) =>
			connection.simpleQuery<R>(sql, options),
		);
	}

	describe(
		sql: string,
		options?: Pick<QueryOptions, 'paramTypes' | 'signal' | 'timeout'>,
	): Promise<Description> {
		return this.#with(options?.signal, (connection) =>
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

	/** Closes every connection once it is released, and fails waiters. */
	async end(): Promise<void> {
		if (this.#ended) return;
		this.#ended = true;
		for (const waiter of this.#waiters.splice(0)) {
			waiter.cleanup();
			waiter.reject(new DriverError('The pool has ended'));
		}
		const idle = this.#idle.splice(0);
		await Promise.all([
			...idle.map(async ({ connection, timer }) => {
				if (timer !== undefined) clearTimeout(timer);
				await connection.close();
			}),
			...[...this.#busy].map((connection) => connection.close()),
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
