import {
	resolveConfig,
	type ConnectionOptions,
	type ResolvedConfig,
} from './config.js';
import { openConnection, preloadSockets } from './connect.js';
import type { Connection, CursorOptions, QueryOptions } from './connection.js';
import { RowStream } from './row-stream.js';
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
	 * share connections, pipelining several queries on each. Beyond that,
	 * queries wait in line and take the next free slot.
	 *
	 * By default the depth adapts per connection: it starts at 100 and,
	 * while queries are waiting and finish nearly as fast as the round trip
	 * allows (the network, not the server, is the bottleneck), grows up to
	 * 1000; it shrinks back once queries queue on the server. A number fixes
	 * the depth; 0 or false gives every query a connection to itself.
	 *
	 * Reserved clients, transactions, cursors and COPY always get their own
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

/** The pool's bookkeeping for one open connection. */
interface Slot {
	readonly connection: Connection;
	/** Lent out, for `query` or to one caller. */
	busy: boolean;
	/** Queries in flight while lent out for `query` (shareable); -1 otherwise. */
	shared: number;
	/** When its lifetime ends (ms since epoch); infinite without one. */
	readonly expiresAt: number;
	/** When it was last parked idle (ms since epoch). */
	idleSince: number;
	/** Its adaptive pipeline depth, once a query was timed on it. */
	depth: Depth | undefined;
	/** End an untimed query's turn on the connection; made once per connection, not per query. */
	readonly settled: () => void;
	readonly fulfilled: (value: unknown) => unknown;
	readonly rejected: (error: unknown) => never;
}

function unref(timer: ReturnType<typeof setTimeout>): void {
	if (typeof timer === 'object' && timer !== null && 'unref' in timer)
		timer.unref();
}

/** The adaptive pipeline depth's starting point and floor, and its ceiling. */
const PIPELINE_FLOOR = 100;
const PIPELINE_CEILING = 1000;
/** One shared query in this many is timed for the adaptive depth (a power of two). */
const SAMPLE_EVERY = 8;

/**
 * The adaptive pipeline depth of one connection. A query's latency is at
 * least one round trip, which the fastest one seen estimates. Each round
 * (about `limit` queries, one round trip's worth once the pipeline is
 * full) compares the average latency of the queries timed in it (one in
 * `SAMPLE_EVERY`) with it:
 *
 * - near it, queries aren't queueing on the server, so the round trip
 *   caps throughput; if callers are waiting, a deeper pipeline helps;
 * - far above it, the server (or the client) is the bottleneck and more
 *   depth would only queue more queries behind each other, so it shrinks.
 *
 * The minimum only ever decreases, so if the round trip grows, the depth
 * errs towards shallow.
 */
class Depth {
	limit = PIPELINE_FLOOR;
	#fastest = Number.POSITIVE_INFINITY;
	#sum = 0;
	#count = 0;

	/** Records a query's latency, and whether queries are waiting for a slot. */
	sample(latency: number, waiting: boolean): void {
		if (latency < this.#fastest) this.#fastest = latency;
		this.#sum += latency;
		if (++this.#count * SAMPLE_EVERY < this.limit) return;
		const ratio = this.#sum / this.#count / this.#fastest;
		this.#sum = 0;
		this.#count = 0;
		if (ratio < 1.5 && waiting)
			this.limit = Math.min(PIPELINE_CEILING, Math.ceil(this.limit * 1.5));
		else if (ratio > 3)
			this.limit = Math.max(PIPELINE_FLOOR, Math.floor(this.limit * 0.75));
	}
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
	): RowStream<R> {
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
	/** The fixed pipeline depth, or the adaptive one's floor; 0 when off. */
	readonly #pipeline: number;
	/** Whether each connection's depth adapts (`pipeline` wasn't given). */
	readonly #adaptive: boolean;
	#timed = 0;
	/**
	 * Every open connection's bookkeeping. Kept in fields rather than in
	 * sets of busy or shared connections: adding and deleting a connection
	 * on every query makes those rehash, garbage that adds up to GC pauses.
	 */
	readonly #slots = new Map<Connection, Slot>();
	readonly #idle: Slot[] = [];
	#busy = 0;
	/** One timer for every idle connection's timeout, at the earliest one. */
	#sweep: ReturnType<typeof setTimeout> | undefined;
	#sweepAt = Number.POSITIVE_INFINITY;
	/** Callers waiting for a connection of their own (acquire, transaction, cursor, COPY). */
	readonly #waiters: Waiter[] = [];
	/** Queries waiting for a pipeline slot on a shared connection. */
	readonly #sharedWaiters: Waiter[] = [];
	/** Shared connections taking no new queries, to be handed to a waiter of `#waiters` once idle. */
	readonly #draining = new Set<Slot>();
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
		this.#pipeline = o.pipeline === false ? 0 : (o.pipeline ?? PIPELINE_FLOOR);
		this.#adaptive = o.pipeline === undefined;
		if (this.#max < 1) throw new DriverError('max must be at least 1');
		this.#fillMin();
		// in the background: no cost to createPool, a faster first query
		unref(setTimeout(() => preloadSockets(this.#config), 0));
	}

	get stats(): PoolStats {
		return {
			total: this.#idle.length + this.#busy + this.#opening,
			idle: this.#idle.length,
			busy: this.#busy,
			waiting: this.#waiters.length + this.#sharedWaiters.length,
		};
	}

	get ended(): boolean {
		return this.#ended;
	}

	#total(): number {
		return this.#idle.length + this.#busy + this.#opening;
	}

	#expired(slot: Slot): boolean {
		return (
			slot.expiresAt !== Number.POSITIVE_INFINITY &&
			Date.now() >= slot.expiresAt
		);
	}

	#lend(slot: Slot): void {
		if (slot.busy) return;
		slot.busy = true;
		this.#busy++;
	}

	#unlend(slot: Slot): void {
		if (!slot.busy) return;
		slot.busy = false;
		this.#busy--;
	}

	async #open(): Promise<Slot> {
		this.#opening++;
		try {
			const connection = await openConnection(this.#config);
			try {
				await this.#onConnect?.(connection);
			} catch (error) {
				connection.destroy();
				throw error;
			}
			const slot: Slot = {
				connection,
				busy: false,
				shared: -1,
				expiresAt:
					this.#maxLifetime > 0
						? Date.now() + this.#maxLifetime * (1 - Math.random() * 0.1)
						: Number.POSITIVE_INFINITY,
				idleSince: 0,
				depth: undefined,
				settled: () => this.#done(slot, -1),
				fulfilled: (value) => {
					this.#done(slot, -1);
					return value;
				},
				rejected: (error) => {
					this.#done(slot, -1);
					throw error;
				},
			};
			this.#slots.set(connection, slot);
			connection.onClose(() => this.#forget(slot));
			return slot;
		} finally {
			this.#opening--;
		}
	}

	/** Drops a connection that closed on its own (server restart, network loss, idle timeout). */
	#forget(slot: Slot): void {
		this.#slots.delete(slot.connection);
		const index = this.#idle.indexOf(slot);
		if (index >= 0) this.#idle.splice(index, 1);
		this.#unlend(slot);
		slot.shared = -1;
		this.#draining.delete(slot);
		this.#serveWaiters();
		this.#rebalance();
		this.#fillMin();
		this.#checkDrained();
	}

	#fillMin(): void {
		if (this.#ended) return;
		while (this.#total() < this.#min) {
			this.#open().then(
				(slot) => this.#giveBack(slot),
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
	#giveBack(slot: Slot): void {
		const { connection } = slot;
		if (connection.closed) {
			this.#serveWaiters();
			this.#checkDrained();
			return;
		}
		const waiter = this.#waiters.shift();
		if (waiter !== undefined) {
			waiter.cleanup();
			this.#lend(slot);
			waiter.resolve(connection);
			this.#rebalance();
			return;
		}
		if (this.#sharedWaiters.length > 0 && this.#shareable(slot)) {
			this.#lend(slot);
			slot.shared = 0;
			// share the queue with connections still opening, so a burst spreads out
			this.#fillShared(
				slot,
				Math.ceil(this.#sharedWaiters.length / (this.#opening + 1)),
			);
			return;
		}
		if (this.#ended) {
			this.#closing.push(connection.close().catch(() => {}));
			this.#checkDrained();
			return;
		}
		slot.idleSince = Date.now();
		this.#idle.push(slot);
		this.#armSweep(this.#idleDeadline(slot));
	}

	/** When an idle connection is due: its idle timeout, or the end of its lifetime if that comes first. */
	#idleDeadline(slot: Slot): number {
		return Math.min(
			this.#idleTimeout > 0
				? slot.idleSince + this.#idleTimeout
				: Number.POSITIVE_INFINITY,
			slot.expiresAt,
		);
	}

	/**
	 * Makes sure the sweep runs by `deadline`. Parking a connection doesn't
	 * start a timer of its own: one already due sooner covers it, and the
	 * sweep re-arms itself for whatever is left.
	 */
	#armSweep(deadline: number): void {
		if (deadline === Number.POSITIVE_INFINITY || deadline >= this.#sweepAt)
			return;
		if (this.#sweep !== undefined) clearTimeout(this.#sweep);
		this.#sweepAt = deadline;
		this.#sweep = setTimeout(
			() => this.#sweepIdle(),
			Math.max(0, deadline - Date.now()),
		);
		unref(this.#sweep);
	}

	/** Closes (or, below `min`, keeps) the idle connections that are due, and re-arms for the rest. */
	#sweepIdle(): void {
		this.#sweep = undefined;
		this.#sweepAt = Number.POSITIVE_INFINITY;
		const now = Date.now();
		const due = this.#idle.filter((slot) => this.#idleDeadline(slot) <= now);
		for (const slot of due) {
			const index = this.#idle.indexOf(slot);
			if (index < 0) continue;
			this.#idle.splice(index, 1);
			if (this.#expired(slot)) {
				// replaced even when that leaves fewer than min
				void slot.connection.close();
				this.#fillMin();
			} else if (this.#total() < this.#min) {
				this.#giveBack(slot);
			} else {
				void slot.connection.close();
			}
		}
		let next = Number.POSITIVE_INFINITY;
		for (const slot of this.#idle)
			next = Math.min(next, this.#idleDeadline(slot));
		this.#armSweep(next);
	}

	/** Lets `end` finish once nothing is waiting and nothing is lent out. */
	#checkDrained(): void {
		if (
			!this.#ended ||
			this.#waiters.length > 0 ||
			this.#sharedWaiters.length > 0 ||
			this.#busy > 0 ||
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
				(slot) => this.#giveBack(slot),
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
	#shareable(slot: Slot): boolean {
		const { connection } = slot;
		return (
			!connection.closed &&
			connection.transactionStatus === 'idle' &&
			!this.#expired(slot)
		);
	}

	/** How many queries a shared connection may have in flight. */
	#depth(slot: Slot): number {
		return slot.depth?.limit ?? this.#pipeline;
	}

	/** Gives free pipeline slots on a shared connection to queued queries, up to `limit` in flight. */
	#fillShared(slot: Slot, limit = Number.POSITIVE_INFINITY): void {
		if (this.#sharedWaiters.length === 0) return;
		const cap = Math.min(limit, this.#depth(slot));
		while (
			slot.shared < cap &&
			this.#sharedWaiters.length > 0 &&
			!this.#draining.has(slot) &&
			this.#shareable(slot)
		) {
			const waiter = this.#sharedWaiters.shift();
			if (waiter === undefined) break;
			waiter.cleanup();
			slot.shared = Math.max(0, slot.shared) + 1;
			waiter.resolve(slot.connection);
		}
	}

	/**
	 * Keeps one shared connection draining for each caller waiting for a
	 * connection of their own that no opening connection will serve. A
	 * draining connection takes no new queries, so the waiter gets it once
	 * the queries already in flight on it finish (at most its pipeline
	 * depth), however many queries keep arriving. The other connections keep
	 * pipelining.
	 */
	#rebalance(): void {
		const target =
			this.#ended || this.#total() < this.#max
				? 0
				: Math.max(0, this.#waiters.length - this.#opening);
		for (const slot of this.#draining) {
			if (this.#draining.size <= target) break;
			this.#draining.delete(slot);
			this.#fillShared(slot);
		}
		while (this.#draining.size < target) {
			let best: Slot | undefined;
			let fewest = Number.POSITIVE_INFINITY;
			for (const slot of this.#slots.values()) {
				if (
					slot.shared >= 0 &&
					slot.shared < fewest &&
					!this.#draining.has(slot)
				) {
					best = slot;
					fewest = slot.shared;
				}
			}
			if (best === undefined) break;
			this.#draining.add(best);
		}
	}

	/** An idle connection, marked busy, or undefined; most recently used first, so surplus connections time out. */
	#takeIdle(): Slot | undefined {
		if (this.#ended) return undefined;
		while (this.#idle.length > 0) {
			const slot = this.#idle.pop();
			if (slot === undefined) break;
			if (slot.connection.closed || this.#expired(slot)) {
				void slot.connection.close();
				continue;
			}
			this.#lend(slot);
			return slot;
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
		if (idle !== undefined) return Promise.resolve(idle.connection);
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
		const slot = this.#slots.get(connection);
		if (slot !== undefined) this.#releaseSlot(slot, discard);
	};

	#releaseSlot(slot: Slot, discard: boolean): void {
		if (!slot.busy) return;
		const { connection } = slot;
		const reusable = !discard && !connection.closed && !this.#expired(slot);
		if (!reusable) {
			this.#unlend(slot);
			const closing = connection.close().catch(() => {});
			if (this.#ended) this.#closing.push(closing);
			this.#serveWaiters();
			this.#fillMin();
			this.#checkDrained();
			return;
		}
		if (connection.pending > 0 || connection.transactionStatus !== 'idle') {
			this.#releaseWhenIdle(slot);
			return;
		}
		this.#unlend(slot);
		this.#giveBack(slot);
	}

	/**
	 * Queries still running, or a transaction left open: never hand that to
	 * someone else; it stays lent out until its queries finish. (A method of
	 * its own: a closure in `#releaseSlot` would cost every release a context.)
	 */
	#releaseWhenIdle(slot: Slot): void {
		const { connection } = slot;
		void connection.idle().then(() => {
			if (connection.transactionStatus === 'idle') {
				this.#releaseSlot(slot, false);
			} else {
				this.#unlend(slot);
				connection.destroy(new DriverError('Released with a transaction open'));
				this.#serveWaiters();
				this.#checkDrained();
			}
			return undefined;
		});
	}

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
	#pickShared(): Slot | undefined {
		if (
			this.#pipeline <= 1 ||
			this.#idle.length > 0 ||
			this.#sharedWaiters.length > 0 ||
			this.#total() < this.#max
		) {
			return undefined;
		}
		let best: Slot | undefined;
		let fewest = Number.POSITIVE_INFINITY;
		for (const slot of this.#slots.values()) {
			const count = slot.shared;
			if (
				count >= 0 &&
				count < fewest &&
				// below the floor, without a lookup: this runs per connection per query
				(count < this.#pipeline || count < this.#depth(slot)) &&
				!this.#draining.has(slot) &&
				this.#shareable(slot)
			) {
				best = slot;
				fewest = count;
			}
		}
		return best;
	}

	/**
	 * A shareable connection for a query, counted in: an idle one, else a
	 * busy one to pipeline onto when the pool is full. Undefined when the
	 * query must take the slow path: no pipelining, or it waits in line.
	 */
	#claimShared(signal: AbortSignal | undefined): Slot | undefined {
		if (this.#pipeline <= 1 || signal?.aborted || this.#ended) return undefined;
		// claimed before any await, so queries issued in the same tick see it
		const slot = this.#takeIdle() ?? this.#pickShared();
		if (slot !== undefined) slot.shared = Math.max(0, slot.shared) + 1;
		return slot;
	}

	/** Whether the next shared query is timed for the adaptive depth: the start time, or -1. */
	#timing(): number {
		return this.#adaptive && (++this.#timed & (SAMPLE_EVERY - 1)) === 0
			? performance.now()
			: -1;
	}

	/** Ends a claimed query's turn on its connection once `result` settles. */
	#track<T>(slot: Slot, started: number, result: Promise<T>): Promise<T> {
		if (started < 0) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `fulfilled` returns its argument
			return result.then(slot.fulfilled, slot.rejected) as Promise<T>;
		}
		return result.then(
			(value) => {
				this.#done(slot, started);
				return value;
			},
			(error: unknown) => {
				this.#done(slot, started);
				throw error;
			},
		);
	}

	/** Runs `run` on a claimed connection, and ends its turn when it settles. */
	#runShared<T>(
		slot: Slot,
		run: (connection: Connection) => Promise<T>,
	): Promise<T> {
		const started = this.#timing();
		let result: Promise<T>;
		try {
			result = run(slot.connection);
		} catch (error) {
			this.#done(slot, started);
			return Promise.reject(error);
		}
		return this.#track(slot, started, result);
	}

	/**
	 * Runs `fn` on a shareable connection: an idle one, else pipelined onto a
	 * busy one when the pool is full, else the next free slot in line.
	 */
	#withShared<T>(
		signal: AbortSignal | undefined,
		fn: (connection: Connection) => Promise<T>,
	): Promise<T> {
		if (this.#pipeline <= 1 || signal?.aborted || this.#ended)
			return this.#with(signal, fn);
		const slot = this.#claimShared(signal);
		if (slot !== undefined) return this.#runShared(slot, fn);
		return this.#waitShared(signal, fn);
	}

	/** Waits in line for a pipeline slot, then runs `fn` there. */
	async #waitShared<T>(
		signal: AbortSignal | undefined,
		fn: (connection: Connection) => Promise<T>,
	): Promise<T> {
		// a slot handed over by #fillShared is already counted
		const waiting = this.#wait(this.#sharedWaiters, signal);
		this.#serveWaiters();
		const connection = await waiting;
		const slot = this.#slots.get(connection);
		// closed in the meantime: the query fails on its own
		if (slot === undefined) return fn(connection);
		return this.#runShared(slot, fn);
	}

	/** Feeds a timed query's latency to its connection's adaptive depth. */
	#sample(slot: Slot, latency: number): void {
		if (!this.#adaptive) return;
		slot.depth ??= new Depth();
		slot.depth.sample(latency, this.#sharedWaiters.length > 0);
	}

	/** Frees a query's slot: straight to the next queued query, or back to the pool when the last one ends. */
	#done(slot: Slot, started: number): void {
		slot.shared = slot.shared > 0 ? slot.shared - 1 : 0;
		if (started >= 0) this.#sample(slot, performance.now() - started);
		this.#fillShared(slot);
		if (slot.shared > 0) return;
		slot.shared = -1;
		this.#draining.delete(slot);
		this.#releaseSlot(slot, false);
	}

	query<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: QueryOptions,
	): Promise<QueryResult<R>> {
		// no closures in this function: one would cost every query a context
		const slot = this.#claimShared(options?.signal);
		if (slot === undefined) return this.#queryShared(sql, params, options);
		const started = this.#timing();
		return slot.connection.queryThen<R>(
			sql,
			params,
			options,
			started < 0 ? slot.settled : this.#settledTimed(slot, started),
		);
	}

	#queryShared<R>(
		sql: string,
		params: readonly unknown[] | undefined,
		options: QueryOptions | undefined,
	): Promise<QueryResult<R>> {
		return this.#withShared(options?.signal, (connection) =>
			connection.query<R>(sql, params, options),
		);
	}

	/** Ends a timed query's turn on its connection, sampling its latency. */
	#settledTimed(slot: Slot, started: number): () => void {
		return () => this.#done(slot, started);
	}

	simpleQuery<R = Record<string, unknown>>(
		sql: string,
		options?: Pick<QueryOptions, 'rowMode' | 'codecs' | 'signal' | 'timeout'>,
	): Promise<QueryResult<R>[]> {
		return this.#withShared(options?.signal, (connection) =>
			connection.simpleQuery<R>(sql, options),
		);
	}

	/**
	 * Looks up the types the pool's and queries' codecs name in `pg_type`,
	 * once for the pool; see `Connection.loadTypes`.
	 */
	loadTypes(): Promise<void> {
		if (this.#config.catalog.loaded) return Promise.resolve();
		return this.#withShared(undefined, (connection) => connection.loadTypes());
	}

	/** Looks up the types again, for the whole pool; see `Connection.reloadTypes`. */
	reloadTypes(): Promise<void> {
		return this.#withShared(undefined, (connection) =>
			connection.reloadTypes(),
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

	/**
	 * @internal Runs `fn` on a shareable connection as one query of its
	 * pipeline, like `query`: how quarry sends a batch's independent
	 * statements together on one connection without reserving it. `fn` must
	 * only issue queries, all before its promise settles, and leave no
	 * session or transaction state behind.
	 */
	withShared<T>(
		fn: (connection: Connection) => Promise<T>,
		options?: { signal?: AbortSignal | undefined },
	): Promise<T> {
		return this.#withShared(options?.signal, fn);
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

	/**
	 * Streams batches on a connection of its own, taken by the first batch
	 * and held until the iteration ends: read to the end, broken out of, or
	 * failed.
	 */
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

	/** Like `cursor`, one row at a time. */
	stream<R = Record<string, unknown>>(
		sql: string,
		params?: readonly unknown[],
		options?: CursorOptions,
	): RowStream<R> {
		return new RowStream(this.cursor<R>(sql, params, options));
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
		if (this.#sweep !== undefined) clearTimeout(this.#sweep);
		this.#sweep = undefined;
		this.#sweepAt = Number.POSITIVE_INFINITY;
		const closing = this.#idle
			.splice(0)
			.map(({ connection }) => connection.close());
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
				for (const slot of this.#slots.values())
					if (slot.busy) closing.push(slot.connection.close({ timeout: 0 }));
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
			// sent together: the connection pipelines them in one round trip
			await Promise.all(
				Array.from(this.#channels.keys(), (channel) =>
					connection.query(`listen ${quote(channel)}`, [], { prepare: false }),
				),
			);
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
