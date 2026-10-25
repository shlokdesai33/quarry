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
	 * Replaces a connection once it has served this many queries and
	 * borrowers (default unlimited): e.g. to spread load again after a
	 * failover, or to bound per-session memory on the server.
	 */
	readonly maxUses?: number | undefined;
	/**
	 * After a failed connection attempt, waits about this long (milliseconds,
	 * ±50% jitter) before the next one, instead of retrying at once (default
	 * 0). The delay doesn't grow with consecutive failures, so the pool is
	 * back within about one delay once the server is; waiting callers keep
	 * waiting meanwhile (up to `acquireTimeout`), and `min` connections are
	 * opened again after it.
	 */
	readonly connectRetryDelay?: number | undefined;
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

/** What the pool has done since it was created, counted. */
export interface PoolMetrics {
	/** Connections opened (and through `onConnect`). */
	readonly opened: number;
	/** Connection attempts that failed. */
	readonly openFailed: number;
	/** Connections closed, for any reason. */
	readonly closed: number;
	/** Callers that had to wait for a connection or a pipeline slot. */
	readonly waited: number;
	/** Waits that ended with `acquireTimeout`. */
	readonly waitTimeouts: number;
	/** Callers refused at once because `maxWaiting` callers were waiting. */
	readonly waitRefusals: number;
}

/** Why the pool closed a connection. */
export type PoolCloseReason =
	/** Idle longer than `idleTimeout`. */
	| 'idle'
	/** Older than `maxLifetime`. */
	| 'lifetime'
	/** Used `maxUses` times. */
	| 'maxUses'
	/** Released with `release(true)` or an error. */
	| 'discarded'
	/** Released with a transaction still open. */
	| 'transaction'
	/** Closed by the server or the network, or failed. */
	| 'lost'
	/** The pool ended. */
	| 'end';

/** Something that happened to the pool's connections or callers; see `Pool.onEvent`. */
export type PoolEvent =
	| { readonly type: 'open'; readonly connection: Connection }
	| { readonly type: 'openFailed'; readonly error: Error }
	| {
			readonly type: 'close';
			readonly connection: Connection;
			readonly reason: PoolCloseReason;
	  }
	| { readonly type: 'waitTimeout' }
	| { readonly type: 'waitRefused' };

interface Waiter {
	resolve(connection: Connection): void;
	reject(error: Error): void;
	/** When it times out (`performance.now()`), or infinity. */
	readonly deadline: number;
	cleanup(): void;
}

const noop = () => {};

/** The pool's bookkeeping for one open connection. */
interface Slot {
	readonly connection: Connection;
	/** Lent out, for `query` or to one caller. */
	busy: boolean;
	/** Queries in flight while lent out for `query` (shareable); -1 otherwise. */
	shared: number;
	/** When its lifetime ends (ms since epoch); infinite without one. */
	readonly expiresAt: number;
	/** Why it takes no new work, once its lifetime ended or it was used `maxUses` times. */
	expired: 'lifetime' | 'maxUses' | undefined;
	/** Queries and borrowers it has served, for `maxUses`. */
	uses: number;
	/** Sets `expired` when its lifetime ends. */
	lifetime: ReturnType<typeof setTimeout> | undefined;
	/** Why the pool is closing it, once it is. */
	closing: PoolCloseReason | undefined;
	/** When it was last parked idle (ms since epoch). */
	idleSince: number;
	/** Its adaptive pipeline depth, once a query was timed on it. */
	depth: Depth | undefined;
	/** The pool's completion count at its last completion, or when it started taking queries. */
	lastDone: number;
	/** Taking no new queries since the width narrowed; idle once its queries finish. */
	retiring: boolean;
	/** End an untimed query's turn on the connection; made once per connection, not per query. */
	readonly settled: () => void;
	readonly fulfilled: (value: unknown) => unknown;
	readonly rejected: (error: unknown) => never;
}

/** The longest delay a timer takes. */
const MAX_TIMER = 2_147_483_647;

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

/** Completions per adjustment of the adaptive width. */
const WIDTH_EPOCH = 4096;
/** Above this share of stalled time, the width shrinks; below the other, it may grow. */
const STALLED_HIGH = 0.25;
const STALLED_LOW = 0.05;
/** A narrower pool is kept unless queries then take this many times longer on average. */
const NARROWER_WORSE = 2;
/**
 * The most epochs to wait before trying again after a change that didn't
 * help: a growth (doubling the wait each time), or a narrowing
 * (quadrupling it: a narrowing tried behind slow queries disturbs the
 * pool for a while, so trying again soon costs more than it can win).
 */
const GROW_BACKOFF = 64;
const NARROW_BACKOFF = 1024;

/**
 * How many connections `query` spreads its queries across: up to `max`,
 * fewer when the server can't run that many at once.
 *
 * A pipelined connection always has work queued, so its backend never
 * sleeps: with more such backends than the server has CPUs, the
 * scheduler time-slices them, and a backend that loses its CPU holds
 * every query pipelined on it for a whole slice (milliseconds, more with
 * more backends) while the others carry on. Throughput doesn't improve
 * (the CPUs were already busy) but the tail does: those queries wait
 * many times the average.
 *
 * The pool sees that as stalls: a connection completing nothing while the
 * rest of the pool completes everything in flight. Counted in
 * completions rather than time, it needs no clock, ignores client pauses
 * (GC stops every connection at once), and doesn't fire on a round trip,
 * which by Little's law takes about one turnover. With W such backends
 * sharing C CPUs, each is descheduled about 1 − C/W of the time, so the
 * stalled share of connections' time also tells how many the server
 * runs at once: W × (1 − stalled). Each epoch of `WIDTH_EPOCH`
 * completions:
 *
 * - above `STALLED_HIGH` two epochs in a row, the width narrows to that
 *   estimate (not below 2 in one step). A slow query stalls its
 *   connection too, and there fewer connections would only queue more
 *   queries behind it, so the epoch after next judges the change: unless
 *   stalls fell by a quarter (or below `STALLED_HIGH`) and the mean
 *   latency (queries in flight and queued over the completion rate,
 *   Little's law again: one clock read per epoch) grew less than
 *   `NARROWER_WORSE` times, the width goes back, and the next try waits
 *   four times as long (up to `NARROW_BACKOFF` epochs). It goes back at once
 *   if, once it settled, completions come at under three fifths of the
 *   rate before, overall and in each of the last four windows of 256
 *   completions (a clock read per window while judged), so a client pause
 *   that slows one window doesn't undo it: under
 *   CPU contention the CPUs stay busy, so that only happens behind slow
 *   queries, and the next try waits `NARROW_BACKOFF` epochs;
 * - below `STALLED_LOW`, while queries are pipelined or queued at the
 *   width, it grows by one. A growth that brings stalls back makes the
 *   next one wait twice as long (up to `GROW_BACKOFF`); one that holds halves the wait.
 *
 * So the pool settles at the widest the server runs without stalls.
 * Queries beyond the width's pipelines wait in the shared queue, in
 * order, for whichever connection frees a slot first. The epoch after a
 * change, in which the pool ran out of queries, or in which a connection
 * took queries for the first time, isn't judged.
 */
/** What `Width` tracks of a connection. */
export interface WidthSlot {
	/** Queries in flight while lent for queries; -1 otherwise. */
	readonly shared: number;
	/** Being dropped after a narrowing: not counted. */
	readonly retiring?: boolean;
	lastDone: number;
}

/** @internal Exported for tests. */
export class Width {
	limit: number;
	readonly #max: number;
	readonly #now: () => number;
	#ticks = 0;
	/** The completion count when the epoch began, and when it ends. */
	#first = 0;
	#end = WIDTH_EPOCH;
	#started = 0;
	#gaps = 0;
	#stalled = 0;
	/** Queries in flight or queued, summed over the epoch's completions. */
	#load = 0;
	#demand = false;
	#settling = true;
	/** The width before the narrowing being judged (0: none), and its stalls and mean latency. */
	#from = 0;
	#before = 0;
	#stalledBefore = 0;
	#growHoldoff = 0;
	#growBackoff = 1;
	#probing = false;
	#narrowHoldoff = 0;
	#narrowBackoff = 4;
	/** The previous epoch's stalled share, as narrowing takes two in a row. */
	#lastStalled = 0;
	/** When the narrowing being judged settled (time and completion count), and the time per completion before it. */
	#trialStart = 0;
	#trialTick = 0;
	#trialPace = 0;
	/** The last pace check (time and completion count), and how many in a row found completions slower. */
	#checkTime = 0;
	#checkTick = 0;
	#slowChecks = 0;

	constructor(max: number, now: () => number = () => performance.now()) {
		this.limit = max;
		this.#max = max;
		this.#now = now;
	}

	/** A connection starts taking queries; `first` when no other has any. */
	start(slot: WidthSlot, first: boolean): void {
		// while the pool fills up, not every connection is busy yet: stalls would read low
		if (first || slot.lastDone === 0) this.#settling = true;
		slot.lastDone = this.#ticks;
	}

	/** Whether a connection has completed nothing while the rest of the pool completed everything in flight. */
	stalls(slot: WidthSlot, inFlight: number): boolean {
		return slot.shared > 0 && slot.lastDone < this.stalledBefore(inFlight);
	}

	/** A connection with queries in flight whose last completion came before this count stalls. */
	stalledBefore(inFlight: number): number {
		return this.#ticks - inFlight - 16;
	}

	/** Queries are pipelined, or queued, because every connection the width allows is in use. */
	demand(): void {
		this.#demand = true;
	}

	/**
	 * Records a completion on `slot`, with `inFlight` queries still in
	 * flight on `shared` of the pool's `slots` and `waiting` queued; true
	 * when the width grew.
	 */
	done(
		slot: WidthSlot,
		inFlight: number,
		waiting: number,
		shared: number,
		slots: ReadonlyMap<unknown, WidthSlot>,
	): boolean {
		const tick = ++this.#ticks;
		if (slot.retiring !== true) {
			// its own completion is a tick of its time too
			this.#gaps++;
			this.#gap(tick - slot.lastDone - 1, inFlight);
		}
		slot.lastDone = tick;
		this.#load += inFlight + waiting;
		// a narrowing that slows completions down by two fifths is undone without waiting for its epochs
		if (this.#from > 0 && !this.#settling && (tick & 255) === 0) {
			const now = this.#now();
			// in every window since the last check, not only overall: a client
			// pause (GC, the process descheduled) slows the one it falls in
			const slow =
				(now - this.#checkTime) * 0.6 >
				(tick - this.#checkTick) * this.#trialPace;
			this.#checkTime = now;
			this.#checkTick = tick;
			this.#slowChecks = slow ? this.#slowChecks + 1 : 0;
			if (
				this.#slowChecks >= 4 &&
				tick - this.#trialTick >= 1024 &&
				(now - this.#trialStart) * 0.6 >
					(tick - this.#trialTick) * this.#trialPace
			)
				return this.#revert(now, true);
		}
		if (tick < this.#end) return false;
		// stalls still going on count too: a backend can be off its CPU for longer than an epoch
		for (const other of slots.values())
			if (other.shared > 0 && other.retiring !== true)
				this.#gap(tick - other.lastDone, inFlight);
		return this.#adjust(shared);
	}

	/** Counts the part of a connection's gap between completions that falls in this epoch, as stalled if it is longer than a turnover. */
	#gap(gap: number, inFlight: number): void {
		const counted = Math.min(gap, this.#ticks - 1 - this.#first);
		this.#gaps += counted;
		if (gap > inFlight + 16) this.#stalled += counted;
	}

	/** Starts a new epoch: a half one while a change settles, as it only has to let dropped connections finish. */
	#epoch(now: number): void {
		this.#first = this.#ticks;
		this.#end = this.#ticks + (this.#settling ? WIDTH_EPOCH / 2 : WIDTH_EPOCH);
		this.#started = now;
		this.#gaps = 0;
		this.#stalled = 0;
		this.#load = 0;
		this.#demand = false;
	}

	/** Goes back to the width before a narrowing that didn't help; the next try waits four times as long, or the longest if it slowed completions down. */
	#revert(now: number, slower = false): true {
		this.limit = this.#from;
		this.#from = 0;
		// slowing completions down is what narrowing behind slow queries does, never under CPU contention
		this.#narrowBackoff = slower
			? NARROW_BACKOFF
			: Math.min(NARROW_BACKOFF, this.#narrowBackoff * 4);
		this.#narrowHoldoff = this.#narrowBackoff;
		this.#settling = true;
		this.#epoch(now);
		return true;
	}

	#adjust(shared: number): boolean {
		const now = this.#now();
		const elapsed = now - this.#started;
		// Little's law: mean queries in the pool over the completion rate
		const latency = (this.#load / WIDTH_EPOCH) * (elapsed / WIDTH_EPOCH);
		const stalled = this.#gaps > 0 ? this.#stalled / this.#gaps : 0;
		const demand = this.#demand;
		if (this.#settling) {
			this.#settling = false;
			this.#epoch(now);
			// a narrowing's pace is judged from here: dropped connections compete for the CPUs until they finish
			this.#trialStart = now;
			this.#trialTick = this.#ticks;
			this.#checkTime = now;
			this.#checkTick = this.#ticks;
			this.#slowChecks = 0;
			return false;
		}
		this.#epoch(now);
		const lastStalled = this.#lastStalled;
		this.#lastStalled = stalled;
		if (this.#from > 0) {
			if (
				stalled >= Math.max(STALLED_HIGH, this.#stalledBefore * 0.75) ||
				latency > this.#before * NARROWER_WORSE
			)
				return this.#revert(now);
			this.#from = 0;
			this.#narrowBackoff = Math.max(4, this.#narrowBackoff >> 1);
		}
		if (stalled > STALLED_HIGH) {
			if (this.#narrowHoldoff > 0) {
				this.#narrowHoldoff--;
				return false;
			}
			if (lastStalled <= STALLED_HIGH) return false;
			const width = Math.min(this.limit, shared);
			const runs = Math.round(width * (1 - (stalled + lastStalled) / 2));
			// one step at a time below 2: a single connection is the costliest guess
			const narrower = Math.min(width - 1, width > 2 ? Math.max(2, runs) : 1);
			if (narrower < 1) return false;
			if (this.#probing)
				this.#growBackoff = Math.min(GROW_BACKOFF, this.#growBackoff * 2);
			this.#probing = false;
			this.#growHoldoff = this.#growBackoff;
			this.#from = this.limit;
			this.#before = latency;
			this.#stalledBefore = (stalled + lastStalled) / 2;
			this.#trialStart = now;
			this.#trialTick = this.#ticks;
			this.#trialPace = elapsed / WIDTH_EPOCH;
			this.#settling = true;
			this.#epoch(now);
			this.limit = narrower;
			return false;
		}
		if (this.#narrowHoldoff > 0) this.#narrowHoldoff--;
		if (this.#growHoldoff > 0) {
			this.#growHoldoff--;
			return false;
		}
		if (stalled >= STALLED_LOW || !demand || this.limit >= this.#max)
			return false;
		// the last try held: try again sooner
		if (this.#probing) this.#growBackoff = Math.max(1, this.#growBackoff >> 1);
		this.#probing = true;
		this.#settling = true;
		this.#epoch(now);
		this.limit++;
		return true;
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
	readonly #maxUses: number;
	readonly #connectRetryDelay: number;
	/** No connection attempt before this (ms since epoch), after one failed. */
	#retryAt = 0;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	/** One timer for every waiter's `acquireTimeout`, at the earliest. */
	#waitTimer: ReturnType<typeof setTimeout> | undefined;
	readonly #onConnect: PoolOptions['onConnect'];
	readonly #eventListeners = new Set<(event: PoolEvent) => void>();
	readonly #metrics = {
		opened: 0,
		openFailed: 0,
		closed: 0,
		waited: 0,
		waitTimeouts: 0,
		waitRefusals: 0,
	};
	/** The fixed pipeline depth, or the adaptive one's floor; 0 when off. */
	readonly #pipeline: number;
	/** Whether each connection's depth adapts (`pipeline` wasn't given). */
	readonly #adaptive: boolean;
	#timed = 0;
	/** How many connections queries spread across, when adaptive. */
	readonly #width: Width | undefined;
	/** Connections lent out for queries. */
	#sharedSlots = 0;
	/** Of those, the ones taking no new queries since the width narrowed (`retiring`). */
	#retiring = 0;
	/** Queries in flight on them. */
	#inFlight = 0;
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
		this.#maxUses = o.maxUses ?? Number.POSITIVE_INFINITY;
		this.#connectRetryDelay = o.connectRetryDelay ?? 0;
		this.#onConnect = o.onConnect;
		this.#pipeline = o.pipeline === false ? 0 : (o.pipeline ?? PIPELINE_FLOOR);
		this.#adaptive = o.pipeline === undefined;
		if (this.#max < 1) throw new DriverError('max must be at least 1');
		this.#width =
			this.#adaptive && this.#max > 1 ? new Width(this.#max) : undefined;
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

	/** Counts of what the pool has done since it was created. */
	get metrics(): PoolMetrics {
		return { ...this.#metrics };
	}

	/**
	 * Calls `listener` when the pool opens or closes a connection, fails to
	 * open one, or times out or refuses a waiting caller (never per query).
	 * Returns a function that removes it.
	 */
	onEvent(listener: (event: PoolEvent) => void): () => void {
		this.#eventListeners.add(listener);
		return () => this.#eventListeners.delete(listener);
	}

	#emit(event: PoolEvent): void {
		for (const listener of this.#eventListeners) {
			try {
				listener(event);
			} catch (error) {
				queueMicrotask(() => {
					throw error;
				});
			}
		}
	}

	get ended(): boolean {
		return this.#ended;
	}

	#total(): number {
		return this.#idle.length + this.#busy + this.#opening;
	}

	/** Closes a connection the pool is done with, for `reason`. */
	#close(slot: Slot, reason: PoolCloseReason): Promise<void> {
		slot.closing ??= reason;
		return slot.connection.close().catch(noop);
	}

	/** Counts a query or borrower on a connection: past `maxUses`, it takes no more. */
	#use(slot: Slot): void {
		if (++slot.uses >= this.#maxUses) slot.expired ??= 'maxUses';
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
			let connection: Connection;
			try {
				connection = await openConnection(this.#config);
				try {
					await this.#onConnect?.(connection);
				} catch (error) {
					connection.destroy();
					throw error;
				}
			} catch (error) {
				this.#failedOpen(error);
				throw error;
			}
			this.#retryAt = 0;
			const lifetime =
				this.#maxLifetime > 0
					? this.#maxLifetime * (1 - Math.random() * 0.1)
					: Number.POSITIVE_INFINITY;
			const slot: Slot = {
				connection,
				busy: false,
				shared: -1,
				expiresAt: Date.now() + lifetime,
				expired: undefined,
				uses: 0,
				lifetime: undefined,
				closing: undefined,
				idleSince: 0,
				depth: undefined,
				lastDone: 0,
				retiring: false,
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
			// a flag set once, so taking and sharing a connection read no clock
			if (lifetime !== Number.POSITIVE_INFINITY) this.#expireAt(slot);
			this.#slots.set(connection, slot);
			connection.onClose(() => this.#forget(slot));
			connection.rerun = this.#rerun;
			this.#metrics.opened++;
			if (this.#eventListeners.size > 0)
				this.#emit({ type: 'open', connection });
			return slot;
		} finally {
			this.#opening--;
		}
	}

	/** Sets `expired` once a connection's lifetime ends (in steps: a timer waits at most 2^31 − 1 ms). */
	#expireAt(slot: Slot): void {
		const left = slot.expiresAt - Date.now();
		slot.lifetime = setTimeout(
			() => {
				if (left > MAX_TIMER) this.#expireAt(slot);
				else slot.expired ??= 'lifetime';
			},
			Math.max(0, Math.min(left, MAX_TIMER)),
		);
		unref(slot.lifetime);
	}

	/** Counts a failed attempt and, with `connectRetryDelay`, holds the next one back. */
	#failedOpen(error: unknown): void {
		this.#metrics.openFailed++;
		if (this.#connectRetryDelay > 0)
			this.#retryAt =
				Date.now() + this.#connectRetryDelay * (0.5 + Math.random());
		if (this.#eventListeners.size > 0)
			this.#emit({
				type: 'openFailed',
				error:
					error instanceof Error ? error : new ConnectionError(String(error)),
			});
	}

	/** Whether a connection attempt must wait for `connectRetryDelay`; if so, retries once it has passed. */
	#holdingBack(): boolean {
		if (this.#retryAt === 0) return false;
		const wait = this.#retryAt - Date.now();
		if (wait <= 0) {
			this.#retryAt = 0;
			return false;
		}
		if (this.#retryTimer === undefined) {
			this.#retryTimer = setTimeout(() => {
				this.#retryTimer = undefined;
				this.#serveWaiters();
				this.#fillMin();
			}, wait);
			// waiters keep the process alive with their own timeout; `min` alone doesn't
			if (this.#waiters.length + this.#sharedWaiters.length === 0)
				unref(this.#retryTimer);
		}
		return true;
	}

	/** Drops a connection that closed on its own (server restart, network loss, idle timeout). */
	#forget(slot: Slot): void {
		if (slot.lifetime !== undefined) clearTimeout(slot.lifetime);
		this.#metrics.closed++;
		if (this.#eventListeners.size > 0)
			this.#emit({
				type: 'close',
				connection: slot.connection,
				reason: slot.closing ?? 'lost',
			});
		this.#slots.delete(slot.connection);
		const index = this.#idle.indexOf(slot);
		if (index >= 0) this.#idle.splice(index, 1);
		this.#unlend(slot);
		this.#unshare(slot);
		this.#draining.delete(slot);
		this.#serveWaiters();
		this.#rebalance();
		this.#fillMin();
		this.#checkDrained();
	}

	#fillMin(): void {
		if (this.#ended) return;
		while (this.#total() < this.#min && !this.#holdingBack()) {
			this.#open().then(
				(slot) => this.#giveBack(slot),
				() => {
					// retried on the next acquire or release, or after connectRetryDelay
					if (this.#connectRetryDelay > 0) this.#fillMin();
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
			this.#use(slot);
			waiter.resolve(connection);
			this.#rebalance();
			return;
		}
		if (
			this.#sharedWaiters.length > 0 &&
			this.#taking() < this.#widthLimit() &&
			this.#shareable(slot)
		) {
			this.#lend(slot);
			this.#share(slot);
			// share the queue with connections still opening, so a burst spreads out
			this.#fillShared(
				slot,
				Math.ceil(this.#sharedWaiters.length / (this.#opening + 1)),
			);
			return;
		}
		if (this.#ended) {
			this.#closing.push(this.#close(slot, 'end'));
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
			if (slot.expired !== undefined || now >= slot.expiresAt) {
				// replaced even when that leaves fewer than min
				void this.#close(slot, slot.expired ?? 'lifetime');
				this.#fillMin();
			} else if (this.#total() < this.#min) {
				this.#giveBack(slot);
			} else {
				void this.#close(slot, 'idle');
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

	/** How many connections the pool may lend for queries at once. */
	#widthLimit(): number {
		return this.#width?.limit ?? this.#max;
	}

	/** Connections lent for queries that take new ones. */
	#taking(): number {
		return this.#sharedSlots - this.#retiring;
	}

	/** Queued queries a new connection would serve: none once the width is reached. */
	#sharedWanted(): number {
		return Math.min(
			this.#sharedWaiters.length,
			Math.max(0, this.#widthLimit() - this.#taking()),
		);
	}

	/** Opens connections for waiters while there is room. */
	#serveWaiters(): void {
		while (
			this.#waiters.length + this.#sharedWanted() > this.#opening &&
			this.#total() < this.#max &&
			!this.#holdingBack()
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
			slot.expired === undefined &&
			!connection.closed &&
			connection.transactionStatus === 'idle'
		);
	}

	/** How many queries a shared connection may have in flight. */
	#depth(slot: Slot): number {
		return slot.depth?.limit ?? this.#pipeline;
	}

	/** Gives free pipeline slots on a shared connection to queued queries, up to `limit` in flight. */
	#fillShared(slot: Slot, limit = Number.POSITIVE_INFINITY): void {
		if (this.#sharedWaiters.length === 0 || slot.retiring) return;
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
			this.#claim(slot);
			waiter.resolve(slot.connection);
		}
	}

	/** Lends an idle connection for queries, unless it is already. */
	#share(slot: Slot): void {
		if (slot.shared >= 0) return;
		slot.shared = 0;
		this.#width?.start(slot, this.#sharedSlots === 0);
		this.#sharedSlots++;
	}

	/** Counts one more query in flight on a connection lent for queries. */
	#claim(slot: Slot): void {
		this.#share(slot);
		slot.shared++;
		this.#inFlight++;
		this.#use(slot);
	}

	/** The connection is no longer lent for queries. */
	#unshare(slot: Slot): void {
		if (slot.shared < 0) return;
		this.#inFlight -= slot.shared;
		this.#sharedSlots--;
		if (slot.retiring) {
			slot.retiring = false;
			this.#retiring--;
		}
		slot.shared = -1;
	}

	/**
	 * After the width narrowed: picks connections to take no new queries
	 * until it holds, stalled ones first, then the least loaded (the
	 * quickest to finish). The others keep pipelining meanwhile.
	 */
	#retire(): void {
		const width = this.#widthLimit();
		while (this.#taking() > width) {
			let pick: Slot | undefined;
			let pickStalled = false;
			for (const slot of this.#slots.values()) {
				if (slot.shared < 0 || slot.retiring) continue;
				const stalled = this.#width?.stalls(slot, this.#inFlight) === true;
				if (
					pick === undefined ||
					(stalled && !pickStalled) ||
					(stalled === pickStalled && slot.shared < pick.shared)
				) {
					pick = slot;
					pickStalled = stalled;
				}
			}
			if (pick === undefined) return;
			pick.retiring = true;
			this.#retiring++;
		}
	}

	/** The width grew: every connection lent for queries takes them again. */
	#unretire(): void {
		if (this.#retiring === 0) return;
		for (const slot of this.#slots.values()) slot.retiring = false;
		this.#retiring = 0;
	}

	/** Lends idle connections to queued queries while the width allows more, then opens what's still needed. */
	#serveShared(): void {
		while (
			this.#sharedWaiters.length > 0 &&
			this.#taking() < this.#widthLimit()
		) {
			const slot = this.#takeIdle();
			if (slot === undefined) break;
			this.#share(slot);
			this.#fillShared(slot);
		}
		this.#serveWaiters();
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
			if (slot.connection.closed || slot.expired !== undefined) {
				void this.#close(slot, slot.expired ?? 'lost');
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
		if (idle !== undefined) {
			this.#use(idle);
			return Promise.resolve(idle.connection);
		}
		const waiting = this.#wait(this.#waiters, signal);
		this.#serveWaiters();
		this.#rebalance();
		return waiting;
	}

	/** Queues a caller; it is resolved with a connection by `#giveBack` or `#fillShared`. */
	#wait(queue: Waiter[], signal: AbortSignal | undefined): Promise<Connection> {
		if (this.#waiters.length + this.#sharedWaiters.length >= this.#maxWaiting) {
			this.#metrics.waitRefusals++;
			if (this.#eventListeners.size > 0) this.#emit({ type: 'waitRefused' });
			return Promise.reject(
				new DriverError(
					`Too many callers waiting for a connection (maxWaiting ${this.#maxWaiting})`,
				),
			);
		}
		this.#metrics.waited++;
		return new Promise((resolve, reject) => {
			const waiter: Waiter = {
				resolve,
				reject,
				deadline:
					this.#acquireTimeout > 0
						? performance.now() + this.#acquireTimeout
						: Number.POSITIVE_INFINITY,
				cleanup: noop,
			};
			if (signal !== undefined) this.#abortWait(queue, waiter, signal);
			queue.push(waiter);
			// for the full timeout from now, as a timer of its own would be: it
			// fires before a connect timeout of the same length started after it
			if (waiter.deadline !== Number.POSITIVE_INFINITY)
				this.#waitTimer ??= setTimeout(
					() => this.#timeOutWaiters(),
					this.#acquireTimeout,
				);
		});
	}

	#abortWait(queue: Waiter[], waiter: Waiter, signal: AbortSignal): void {
		const onAbort = () =>
			this.#unwait(
				queue,
				waiter,
				new AbortError('Acquiring a connection was aborted', {
					cause: signal.reason,
				}),
			);
		signal.addEventListener('abort', onAbort, { once: true });
		waiter.cleanup = () => signal.removeEventListener('abort', onAbort);
	}

	/** Takes a waiter out of its queue and fails it. */
	#unwait(queue: Waiter[], waiter: Waiter, error: Error): void {
		const index = queue.indexOf(waiter);
		if (index < 0) return;
		queue.splice(index, 1);
		waiter.cleanup();
		waiter.reject(error);
		this.#rebalance();
		this.#checkDrained();
	}

	/**
	 * The timer for waiters' `acquireTimeout`: one for every waiter, at the
	 * earliest deadline. Every waiter waits as long, so each queue is in
	 * deadline order: the timer only looks at their heads, and a waiter
	 * served before its deadline needs no timer cleared.
	 */
	#armWaitTimer(deadline: number): ReturnType<typeof setTimeout> {
		return setTimeout(
			() => this.#timeOutWaiters(),
			Math.max(0, deadline - performance.now()),
		);
	}

	#timeOutWaiters(): void {
		this.#waitTimer = undefined;
		// timers fire on the event loop's millisecond clock, up to one early
		const now = performance.now() + 1;
		let next = Number.POSITIVE_INFINITY;
		for (const queue of [this.#waiters, this.#sharedWaiters]) {
			for (let head = queue[0]; head !== undefined; head = queue[0]) {
				if (head.deadline > now) {
					next = Math.min(next, head.deadline);
					break;
				}
				queue.shift();
				head.cleanup();
				this.#metrics.waitTimeouts++;
				if (this.#eventListeners.size > 0) this.#emit({ type: 'waitTimeout' });
				head.reject(
					new ConnectionError(
						`Timed out after ${this.#acquireTimeout}ms waiting for a connection`,
						{ code: 'ETIMEDOUT' },
					),
				);
			}
		}
		this.#rebalance();
		this.#checkDrained();
		if (next !== Number.POSITIVE_INFINITY && this.#waitTimer === undefined)
			this.#waitTimer = this.#armWaitTimer(next);
	}

	#release = (connection: Connection, discard: boolean): void => {
		const slot = this.#slots.get(connection);
		if (slot !== undefined) this.#releaseSlot(slot, discard);
	};

	#releaseSlot(slot: Slot, discard: boolean): void {
		if (!slot.busy) return;
		const { connection } = slot;
		const reusable =
			!discard && !connection.closed && slot.expired === undefined;
		if (!reusable) {
			this.#unlend(slot);
			const closing = this.#close(
				slot,
				discard ? 'discarded' : (slot.expired ?? 'lost'),
			);
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
				slot.closing = 'transaction';
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
		const width = this.#widthLimit();
		if (
			this.#pipeline <= 1 ||
			this.#sharedWaiters.length > 0 ||
			(this.#taking() < width &&
				(this.#idle.length > 0 || this.#total() < this.#max))
		) {
			return undefined;
		}
		let best: Slot | undefined;
		let fewest = Number.POSITIVE_INFINITY;
		// a stalled connection (behind a slow query, or a backend off its CPU) only if every one is
		let stalled: Slot | undefined;
		let fewestStalled = Number.POSITIVE_INFINITY;
		const stalledBefore =
			this.#width?.stalledBefore(this.#inFlight) ?? Number.NEGATIVE_INFINITY;
		for (const slot of this.#slots.values()) {
			const count = slot.shared;
			if (count < 0) continue;
			const fresh = count === 0 || slot.lastDone >= stalledBefore;
			// the cheap checks first: this runs per connection per query
			if (
				fresh ? count >= fewest : best !== undefined || count >= fewestStalled
			)
				continue;
			if (
				// below the floor, without a lookup
				(count < this.#pipeline || count < this.#depth(slot)) &&
				!this.#draining.has(slot) &&
				!slot.retiring &&
				this.#shareable(slot)
			) {
				if (fresh) {
					best = slot;
					fewest = count;
				} else {
					stalled = slot;
					fewestStalled = count;
				}
			}
		}
		return best ?? stalled;
	}

	/**
	 * A shareable connection for a query, counted in: an idle one, else a
	 * busy one to pipeline onto when the pool is full. Undefined when the
	 * query must take the slow path: no pipelining, or it waits in line.
	 */
	#claimShared(signal: AbortSignal | undefined): Slot | undefined {
		if (this.#pipeline <= 1 || signal?.aborted || this.#ended) return undefined;
		// claimed before any await, so queries issued in the same tick see it
		const slot =
			this.#taking() < this.#widthLimit()
				? (this.#takeIdle() ?? this.#pickShared())
				: this.#pickShared();
		if (slot === undefined) return undefined;
		this.#claim(slot);
		if (slot.shared > 1) this.#width?.demand();
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
		this.#width?.demand();
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
		let wider = false;
		if (slot.shared > 0) {
			slot.shared--;
			this.#inFlight--;
			const width = this.#width;
			if (width !== undefined) {
				const before = width.limit;
				wider = width.done(
					slot,
					this.#inFlight,
					this.#sharedWaiters.length,
					this.#taking(),
					this.#slots,
				);
				if (wider) this.#unretire();
				else if (width.limit < before) this.#retire();
			}
		}
		if (started >= 0) this.#sample(slot, performance.now() - started);
		this.#fillShared(slot);
		if (slot.shared <= 0) {
			this.#unshare(slot);
			this.#draining.delete(slot);
			this.#releaseSlot(slot, false);
		}
		// fewer connections than the width allows (it grew, or one left), and queries waiting
		if (
			(wider || slot.shared < 0) &&
			this.#sharedWaiters.length > 0 &&
			this.#taking() < this.#widthLimit()
		)
			this.#serveShared();
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
			true,
		);
	}

	/**
	 * Runs once more a query that provably never ran on its connection: the
	 * connection failed before writing it, or the server ended the session
	 * before answering it (e.g. it terminated an idle connection the query
	 * was then sent on). From the next turn of the event loop, once other
	 * connections the server ended at the same time have read that too, so
	 * it goes to a live one; it isn't run a third time.
	 */
	readonly #rerun = (
		sql: string,
		params: readonly unknown[],
		options: QueryOptions | undefined,
		resolve: (result: QueryResult<unknown>) => void,
		reject: (error: Error) => void,
	): void => {
		setTimeout(() => {
			let result: Promise<QueryResult<unknown>>;
			const slot = this.#claimShared(options?.signal);
			if (slot === undefined)
				result = this.#withShared(options?.signal, (connection) =>
					connection.query(sql, params, options),
				);
			else {
				const started = this.#timing();
				result = slot.connection.queryThen(
					sql,
					params,
					options,
					started < 0 ? slot.settled : this.#settledTimed(slot, started),
				);
			}
			result.then(resolve, reject);
		}, 0);
	};

	#queryShared<R>(
		sql: string,
		params: readonly unknown[] | undefined,
		options: QueryOptions | undefined,
	): Promise<QueryResult<R>> {
		return this.#withShared(options?.signal, (connection) =>
			connection.queryThen<R>(sql, params, options, noop, true),
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
		if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
		const closing = this.#idle
			.splice(0)
			.map((slot) => this.#close(slot, 'end'));
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
				for (const slot of this.#slots.values()) {
					if (!slot.busy) continue;
					slot.closing ??= 'end';
					closing.push(slot.connection.close({ timeout: 0 }));
				}
			}
		}
		if (this.#waitTimer !== undefined) clearTimeout(this.#waitTimer);
		this.#waitTimer = undefined;
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
