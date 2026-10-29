// A pg-pool-like Pool over quarry's Pool. Sizing, idle and lifetime
// timeouts, acquire timeouts, connect hooks and connection health are
// quarry's; this maps pg-pool's options, callbacks, counters and events
// onto them.
import { EventEmitter } from 'node:events';
import {
	ConnectionError,
	createPool,
	type Connection,
	type Pool as QuarryPool,
	type PoolClient as QuarryPoolClient,
} from '../../../../../src/driver/index.js';
import {
	Client,
	callback,
	connectionOptions,
	execute,
	kConnection,
	kOnClose,
	Query,
	toPgError,
} from './client.js';
import { TypeOverrides } from './types.js';

type Callback = (error: Error | null | undefined, ...rest: any[]) => void;
type PooledClient = Client & { release: (error?: Error | boolean) => void };

interface Pooled {
	readonly client: PooledClient;
	held: QuarryPoolClient | undefined;
	/** pg-pool's listener for errors while the client sits idle. */
	readonly idleListener: (error: Error) => void;
}

/** quarry's acquire timeout, with pg-pool's message (its tests match on it). */
function poolError(error: unknown): Error {
	if (
		error instanceof ConnectionError &&
		error.code === 'ETIMEDOUT' &&
		error.message.includes('waiting for a connection')
	) {
		return new Error('timeout exceeded when trying to connect', {
			cause: error,
		});
	}
	return toPgError(error);
}

export class Pool extends EventEmitter {
	readonly options: any;
	readonly Promise: PromiseConstructor;
	ending = false;
	ended = false;
	readonly #pool: QuarryPool;
	readonly #clients = new Map<Connection, Pooled>();
	readonly #types: TypeOverrides;

	constructor(options: any = {}, _Client?: unknown) {
		super();
		this.options = { ...options };
		if (options && 'password' in options) {
			Object.defineProperty(this.options, 'password', {
				configurable: true,
				enumerable: false,
				writable: true,
				value: options.password,
			});
		}
		if (options?.ssl?.key)
			Object.defineProperty(this.options.ssl, 'key', { enumerable: false });
		const o = this.options;
		o.max = o.max || o.poolSize || 10;
		o.min = o.min || 0;
		o.maxUses = o.maxUses || Infinity;
		o.allowExitOnIdle = o.allowExitOnIdle || false;
		o.maxLifetimeSeconds = o.maxLifetimeSeconds || 0;
		if (o.idleTimeoutMillis === undefined) o.idleTimeoutMillis = 10000;
		this.Promise = o.Promise ?? Promise;
		this.#types = new TypeOverrides(o.types);
		const onConnect = o.onConnect;
		const verify = o.verify;
		this.#pool = createPool({
			...connectionOptions({ ...o, password: options?.password }),
			max: o.max,
			min: o.min,
			idleTimeout: o.idleTimeoutMillis,
			maxLifetime: o.maxLifetimeSeconds * 1000,
			maxUses: o.maxUses,
			acquireTimeout: o.connectionTimeoutMillis ?? 0,
			onConnect: async (connection) => {
				const { client } = this.#wrap(connection);
				if (verify)
					await new Promise<void>((resolve, reject) =>
						verify(client, (error?: Error) =>
							error ? reject(error) : resolve(),
						),
					);
				if (onConnect) await onConnect(client);
				this.emit('connect', client);
			},
		});
	}

	get totalCount(): number {
		return this.#pool.stats.total;
	}

	get idleCount(): number {
		return this.#pool.stats.idle;
	}

	get waitingCount(): number {
		return this.#pool.stats.waiting;
	}

	get expiredCount(): number {
		return 0;
	}

	#wrap(connection: Connection): Pooled {
		const existing = this.#clients.get(connection);
		if (existing) return existing;
		const client = new Client({
			...this.options,
			[kConnection]: connection,
			[kOnClose]: (error: Error) => client.emit('error', error),
		}) as PooledClient;
		const pooled: Pooled = {
			client,
			held: undefined,
			idleListener: (error: Error) => {
				(error as any).client = client;
				client.on('error', () => {});
				connection.destroy();
				this.emit('error', error, client);
			},
		};
		client.once('error', pooled.idleListener);
		client.release = () => {
			throw new Error(
				'Release called on client which has already been released to the pool.',
			);
		};
		connection.onClose(() => {
			this.#clients.delete(connection);
			this.emit('remove', client);
		});
		this.#clients.set(connection, pooled);
		return pooled;
	}

	connect(cb?: Callback): any {
		const promise = this.#connect();
		if (cb) {
			promise.then(
				(client) => callback(cb, undefined, client, client.release),
				(error: Error) => callback(cb, error),
			);
			return undefined;
		}
		return new this.Promise((resolve, reject) => {
			promise.then(resolve, reject);
		});
	}

	async #connect(): Promise<PooledClient> {
		if (this.ending)
			throw new Error('Cannot use a pool after calling end on the pool');
		let held: QuarryPoolClient;
		try {
			held = await this.#pool.acquire();
		} catch (error) {
			throw poolError(error);
		}
		const pooled = this.#wrap(held.connection);
		pooled.held = held;
		const client = pooled.client;
		client.removeListener('error', pooled.idleListener);
		let released = false;
		client.release = (error?: Error | boolean) => {
			if (released)
				throw new Error(
					'Release called on client which has already been released to the pool.',
				);
			released = true;
			pooled.held = undefined;
			const discard = error === true || error instanceof Error;
			if (!discard && !held.connection.closed)
				client.once('error', pooled.idleListener);
			this.emit('release', error, client);
			held.release(discard);
		};
		this.emit('acquire', client);
		return client;
	}

	query(text: any, values?: any, cb?: any): any {
		if (typeof text === 'function') {
			const error = new Error(
				'Passing a function as the first parameter to pool.query is not supported',
			);
			process.nextTick(() => text(error));
			return undefined;
		}
		if (typeof text?.submit === 'function' && !(text instanceof Query))
			return this.#submit(text, typeof values === 'function' ? values : cb);
		const query = new Query(text, values, cb);
		let result: any;
		if (query.callback) {
			// pg-pool calls back with `undefined`, not `null`, for no error
			const user = query.callback;
			query.callback = (error, res) => user(error ?? undefined, res);
		} else {
			result = new this.Promise((resolve, reject) => {
				query.callback = (error, res) => (error ? reject(error) : resolve(res));
			});
		}
		if (this.ending) {
			process.nextTick(() =>
				query.handleError(
					new Error('Cannot use a pool after calling end on the pool'),
				),
			);
			return result;
		}
		execute(
			this.#pool,
			query,
			{
				named: undefined,
				types: this.#types,
				timeout: this.options.query_timeout || undefined,
			},
			undefined,
			poolError,
		);
		return result;
	}

	/** pg-pool runs a submittable on a client it checks out, released when the submittable calls back. */
	#submit(submittable: any, cb: Callback | undefined): any {
		let result: any;
		let done = cb;
		if (!done) {
			result = new this.Promise((resolve, reject) => {
				done = (error, res) => (error ? reject(error) : resolve(res));
			});
		}
		this.connect((error, client) => {
			if (error) {
				callback(done as Callback, error);
				return;
			}
			client.query(submittable, (err: Error | undefined, res: unknown) => {
				client.release(err);
				callback(done as Callback, err, res);
			});
		});
		return result;
	}

	end(cb?: (error?: Error) => void): any {
		if (this.ending) {
			const error = new Error('Called end on pool more than once');
			if (cb) {
				callback(cb, error);
				return undefined;
			}
			return this.Promise.reject(error);
		}
		this.ending = true;
		const promise = this.#pool.end().then(() => {
			this.ended = true;
			this.emit('end');
		});
		if (cb) {
			promise.then(
				() => callback(cb),
				(error: Error) => callback(cb, error),
			);
			return undefined;
		}
		return new this.Promise((resolve, reject) => {
			promise.then(resolve, reject);
		});
	}
}

export default Pool;
