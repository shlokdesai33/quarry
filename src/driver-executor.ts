import { type CompiledQuery, isDataStatement } from './compile.js';
import {
	Connection,
	createCodecRegistry,
	DriverError,
	Pool,
	PoolClient,
	PostgresError,
	Transaction,
	type Codec,
	type CodecRegistry,
	type Description,
	type OpTiming,
	type QueryOptions,
	type QueryResult,
} from './driver/index.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
import { quarryRegistry } from './kind-codecs.js';
import type {
	BatchQuery,
	ExecuteBatchOptions,
	ExecuteOptions,
	ExecuteResult,
	QueryDescription,
	StreamOptions,
	TransactionExecutor,
	TransactionOptions,
} from './executor.js';

/** One query, reported to `onQuery` when it settles. */
export interface QueryEvent {
	readonly kind: 'execute' | 'stream' | 'describe';
	readonly sql: string;
	readonly params: readonly unknown[];
	/** The label from `tag()`. */
	readonly tag: string | undefined;
	/** The command tag's verb (`SELECT`, `INSERT`, …), when it succeeded. */
	readonly command: string | undefined;
	/** Rows returned or affected, when known. */
	readonly rowCount: number | undefined;
	/** Total time, in milliseconds. */
	readonly durationMs: number;
	readonly phases: {
		/** Waiting for a pool connection. */
		readonly acquireMs: number;
		/** Waiting on the connection behind other pipelined queries. */
		readonly queuedMs: number;
		/** From being sent until the server finished, including decoding. */
		readonly execMs: number;
	};
	readonly error: Error | undefined;
}

/** How a database decodes, reports and annotates its queries. */
export interface DatabaseOptions {
	/**
	 * Codecs for result columns no query types: raw SQL, expressions whose
	 * SQL type isn't known. Columns and typed expressions are always read
	 * with their own codec (set with `useCodec` or `defineType`), so their
	 * TypeScript types hold. By default: the driver's codecs, with int8 and
	 * numeric as strings, timestamptz as a Date, ranges as `Range`, and
	 * pgvector as `number[]` (of the float32 values stored).
	 */
	readonly codecs?: readonly Codec[] | undefined;
	/**
	 * Look up the types codecs name (enums, pgvector, custom types and
	 * their arrays) in `pg_type` once per pool, before the first query
	 * (default true). Without it, the driver looks them up behind the
	 * first query that needs one.
	 */
	readonly catalog?: boolean | undefined;
	/** Called once per query with its SQL, tag, timings, row count and error. */
	readonly onQuery?: ((event: QueryEvent) => void) | undefined;
	/**
	 * Append the stack of the code awaiting a failed query to its error,
	 * captured when it fails (default true).
	 */
	readonly callsites?: boolean | undefined;
	/** Use cached prepared statements (default: the connection's setting). */
	readonly prepare?: boolean | undefined;
}

/** What a `DriverExecutor` runs on. */
export type DriverSource = Pool | PoolClient | Connection | Transaction;

interface Runner {
	query<R>(
		sql: string,
		params?: readonly unknown[],
		options?: Record<string, unknown>,
	): Promise<QueryResult<R>>;
	cursor<R>(
		sql: string,
		params?: readonly unknown[],
		options?: Record<string, unknown>,
	): AsyncIterable<R[]>;
	describe(sql: string): Promise<Description>;
	loadTypes?(): Promise<void>;
	queryGroup(
		statements: readonly GroupStatement[],
		options?: { signal?: AbortSignal | undefined },
	): Promise<QueryResult<unknown>>[];
	readonly transactionStatus: 'idle' | 'transaction' | 'failed';
}

type GroupStatement = Parameters<Transaction['queryGroup']>[0][number];

const executeResult = (result: QueryResult<unknown>): ExecuteResult => ({
	rows: result.rows,
	rowCount: result.rowCount,
	command: result.command,
});

const CALLSITE = Symbol('quarry.callsite');

/**
 * The stack of the code awaiting a query, captured once the query has
 * failed. It must be called in the executor method's own continuation (its
 * `catch`, after an `await`), where the engine's async stack trace lists
 * the async functions awaiting it, the caller's included: nothing is
 * captured for queries that succeed. Every link up to the caller has to
 * be an `await` for the chain to reach it. `undefined` with `callsites: false`.
 */
function issuedAt(options: DatabaseOptions): Error | undefined {
	if (options.callsites === false) return undefined;
	const site = new Error();
	if (typeof Error.captureStackTrace === 'function')
		Error.captureStackTrace(site, issuedAt);
	return site;
}

/** Adds the query and its tag to a server error, and the caller's stack to any error. */
function decorate(
	error: unknown,
	query: CompiledQuery | undefined,
	callsite: Error | undefined,
): void {
	if (!(error instanceof Error)) return;
	if (error instanceof PostgresError && query !== undefined) {
		Object.defineProperty(error, 'query', {
			value: { sql: query.sql, params: query.params, tag: query.tag },
		});
	}
	if (callsite?.stack && error.stack && !Reflect.has(error, CALLSITE)) {
		Object.defineProperty(error, CALLSITE, { value: true });
		error.stack = `${error.stack}\n    --- query issued at ---\n${callsite.stack.slice(callsite.stack.indexOf('\n') + 1)}`;
	}
}

const interval = (timeout: number | string) =>
	typeof timeout === 'number' ? `${timeout}ms` : timeout;

/**
 * Hand-written statements (`db.sql`) that change the transaction or
 * session state, by their first keyword. On a shared connection, queries
 * other callers pipelined behind them would run in that state.
 */
const SESSION_STATEMENT =
	/^\s*(?:begin|start|commit|end|rollback|abort|savepoint|release|prepare|set|reset|discard|listen|unlisten|declare|fetch|move|close|create\s+(?:temp|temporary|local\s+temp|local\s+temporary)\b)\b/i;

/** Whether `query` may change the session or transaction state: only SQL written by hand is read. */
const changesSession = (query: CompiledQuery): boolean =>
	!isDataStatement(query) && SESSION_STATEMENT.test(query.sql);

/**
 * Runs quarry's queries on the driver: a pool, a reserved client, a single
 * connection, or a driver transaction. Decodes values to quarry's types,
 * reports `onQuery` events, and adds the query, tag and caller's stack to
 * errors.
 */
export class DriverExecutor implements TransactionExecutor {
	readonly #source: DriverSource;
	readonly #options: DatabaseOptions;
	readonly #registry: CodecRegistry;
	readonly #owned: boolean;
	/** Whether the catalog was looked up (or isn't to be). */
	#ready: boolean;

	constructor(
		source: DriverSource,
		options: DatabaseOptions = {},
		owned = false,
		registry?: CodecRegistry,
	) {
		this.#source = source;
		this.#options = options;
		this.#owned = owned;
		this.#registry =
			registry ??
			(options.codecs === undefined || options.codecs.length === 0
				? quarryRegistry
				: createCodecRegistry(options.codecs, quarryRegistry));
		this.#ready = options.catalog === false;
	}

	/** Looks up the types codecs name, once per pool; a failure leaves them to the driver. */
	async #prepare(runner: Runner | Pool): Promise<void> {
		if (this.#ready || runner.loadTypes === undefined) return;
		await runner.loadTypes();
		this.#ready = true;
	}

	#queryOptions(
		options: ExecuteOptions,
		onTiming: ((t: OpTiming) => void) | undefined,
		query: CompiledQuery,
	) {
		// one object, filled in: this runs per query
		const out: Mutable<QueryOptions> = {
			codecs: this.#registry,
			rowMode: options.rowMode ?? 'object',
		};
		const { paramCodecs, resultCodecs, nested, tag } = query;
		if (options.keepRows !== undefined) out.keepRows = options.keepRows;
		if (paramCodecs !== undefined) out.paramCodecs = paramCodecs;
		if (resultCodecs !== undefined) out.resultCodecs = resultCodecs;
		if (nested !== undefined) out.nested = nested;
		if (this.#options.prepare !== undefined)
			out.prepare = this.#options.prepare;
		if (options.signal !== undefined) out.signal = options.signal;
		if (options.timeout !== undefined) out.statementTimeout = options.timeout;
		if (onTiming !== undefined) out.onTiming = onTiming;
		if (tag !== undefined) out.tag = tag;
		return out;
	}

	/**
	 * The pool, when the operation can share its connections with other
	 * callers' queries, pipelined: not for a statement that changes the
	 * session or transaction state. A `timeout` shares too: the driver sends
	 * it with its query under one Sync, bounding that query alone.
	 */
	#shared(
		queries: CompiledQuery | readonly CompiledQuery[] | undefined,
	): Pool | undefined {
		const source = this.#source;
		if (!(source instanceof Pool)) return undefined;
		if (queries === undefined) return source;
		if ('sql' in queries) return changesSession(queries) ? undefined : source;
		for (const query of queries) if (changesSession(query)) return undefined;
		return source;
	}

	/** Runs `fn` on a connection of its own: reserved from the pool, or the source itself. */
	async #run<T>(
		signal: AbortSignal | undefined,
		fn: (runner: Runner) => Promise<T>,
	): Promise<T> {
		const source = this.#source;
		if (!(source instanceof Pool)) {
			const runner = source instanceof PoolClient ? source.connection : source;
			await this.#prepare(runner);
			// awaited, so a failure's call site traces back through it
			return await fn(runner);
		}
		const client = await source.acquire(signal === undefined ? {} : { signal });
		try {
			await this.#prepare(client.connection);
			return await fn(client.connection);
		} finally {
			client.release();
		}
	}

	#emit(event: QueryEvent): void {
		try {
			this.#options.onQuery?.(event);
		} catch (error) {
			queueMicrotask(() => {
				throw error;
			});
		}
	}

	#report(
		kind: QueryEvent['kind'],
		query: CompiledQuery,
		start: number,
		acquired: number,
		timing: OpTiming | undefined,
		command: string | undefined,
		rowCount: number | undefined,
		error?: unknown,
	): void {
		const end = performance.now();
		this.#emit({
			kind,
			sql: query.sql,
			params: query.params,
			tag: query.tag,
			command,
			rowCount,
			durationMs: end - start,
			phases: {
				acquireMs: acquired - start,
				queuedMs: timing?.queuedMs ?? 0,
				execMs: timing?.execMs ?? end - acquired,
			},
			error:
				error === undefined
					? undefined
					: error instanceof Error
						? error
						: new DriverError('A non-Error value was thrown', { cause: error }),
		});
	}

	/**
	 * The call site captured up front, for the operations that run once per
	 * stream or description rather than per query.
	 */
	#callsite(): Error | undefined {
		return this.#options.callsites === false ? undefined : new Error();
	}

	async execute(
		query: CompiledQuery,
		options: ExecuteOptions = {},
	): Promise<ExecuteResult> {
		const observe = this.#options.onQuery !== undefined;
		const start = observe ? performance.now() : 0;
		let acquired = start;
		let timing: OpTiming | undefined;
		try {
			const pool = this.#shared(query);
			let result: QueryResult<unknown>;
			if (pool !== undefined) {
				if (!this.#ready) await this.#prepare(pool);
				// the pool picks the connection: the time before the query
				// reached it is the wait for a connection or a pipeline slot
				result = await pool.query<unknown>(
					query.sql,
					query.params,
					this.#queryOptions(
						options,
						observe
							? (t) => {
									timing = t;
									acquired = performance.now() - t.queuedMs - t.execMs;
								}
							: undefined,
						query,
					),
				);
			} else {
				result = await this.#run(options.signal, (runner) => {
					if (observe) acquired = performance.now();
					return runner.query<unknown>(
						query.sql,
						query.params,
						this.#queryOptions(
							options,
							observe ? (t) => (timing = t) : undefined,
							query,
						),
					);
				});
			}
			if (observe) {
				this.#report(
					'execute',
					query,
					start,
					acquired,
					timing,
					result.command,
					result.rowCount ?? result.rows.length,
				);
			}
			return {
				rows: result.rows,
				rowCount: result.rowCount,
				command: result.command,
			};
		} catch (error) {
			decorate(error, query, issuedAt(this.#options));
			if (observe)
				this.#report(
					'execute',
					query,
					start,
					acquired,
					timing,
					undefined,
					undefined,
					error,
				);
			throw error;
		}
	}

	/**
	 * Reads the result in batches through a cursor. On a pool, the cursor
	 * has a connection of its own, taken by the first batch and released
	 * when the iteration ends however it ends; inside a transaction, other
	 * queries of the transaction run between its batches. A `timeout`
	 * outside a transaction is the cursor's `statementTimeout`, set before
	 * its portal and restored before its Sync, so the setting can't leak;
	 * inside one it is refused.
	 */
	async *stream(
		query: CompiledQuery,
		options: StreamOptions = {},
	): AsyncGenerator<unknown[], void, undefined> {
		const callsite = this.#callsite();
		const start = performance.now();
		let acquired = start;
		let rows = 0;
		let failure: unknown;
		const source = this.#source;
		let client: PoolClient | undefined;
		try {
			if (options.timeout !== undefined && source instanceof Transaction) {
				throw new DriverError(
					'A stream inside a transaction takes no timeout: set statement_timeout with setLocal',
				);
			}
			let runner: Runner;
			if (source instanceof Pool) {
				client = await source.acquire(
					options.signal === undefined ? {} : { signal: options.signal },
				);
				runner = client.connection;
			} else {
				runner = source instanceof PoolClient ? source.connection : source;
			}
			acquired = performance.now();
			await this.#prepare(runner);
			const cursorOptions = {
				...this.#queryOptions(options, undefined, query),
				...(options.batchSize === undefined
					? {}
					: { batchSize: options.batchSize }),
			};
			for await (const batch of runner.cursor<unknown>(
				query.sql,
				query.params,
				cursorOptions,
			)) {
				rows += batch.length;
				yield batch;
			}
		} catch (error) {
			failure = error;
			decorate(error, query, callsite);
			throw error;
		} finally {
			client?.release();
			if (this.#options.onQuery !== undefined) {
				this.#report(
					'stream',
					query,
					start,
					acquired,
					undefined,
					failure === undefined ? 'SELECT' : undefined,
					rows,
					failure,
				);
			}
		}
	}

	async describe(query: CompiledQuery): Promise<QueryDescription> {
		const callsite = this.#callsite();
		try {
			const pool = this.#shared(undefined);
			let description: Description;
			if (pool !== undefined) {
				if (!this.#ready) await this.#prepare(pool);
				description = await pool.describe(query.sql);
			} else {
				description = await this.#run(undefined, (runner) =>
					runner.describe(query.sql),
				);
			}
			return {
				params: description.paramTypes,
				columns: description.fields.map((field) => ({
					name: field.name,
					typeOid: field.typeOid,
					typeModifier: field.typeModifier,
					tableOid: field.tableOid,
					columnNumber: field.columnId,
				})),
			};
		} catch (error) {
			decorate(error, query, callsite);
			throw error;
		}
	}

	/**
	 * Runs the queries on one connection, in one write. Outside a
	 * transaction, each has its own Sync, so each succeeds or fails on its
	 * own. With `transaction`, `Transaction.batch` sends BEGIN, the queries
	 * and COMMIT together. Inside a transaction, the queries share one Sync
	 * (and BEGIN's, if it wasn't sent yet), and `transaction` makes them a
	 * savepoint.
	 */
	async batch(
		batch: readonly BatchQuery[],
		options: ExecuteBatchOptions = {},
	): Promise<readonly PromiseSettledResult<ExecuteResult>[]> {
		const { transaction, verify, signal, timeout } = options;
		const source = this.#source;
		const inTransaction = source instanceof Transaction;
		if (inTransaction && transaction !== undefined) {
			return this.transaction(
				(tx) => tx.batch(batch, { ...options, transaction: undefined }),
				transaction,
			);
		}
		if (inTransaction && timeout !== undefined) {
			throw new DriverError(
				'A batch inside a transaction takes no timeout: set statement_timeout with setLocal',
			);
		}
		let site: Error | undefined;
		/** Captured by the first failure; every caller of it runs in this method's chain of awaits. */
		const callsite = () => (site ??= issuedAt(this.#options));
		const observe = this.#options.onQuery !== undefined;
		const start = observe ? performance.now() : 0;
		let acquired = start;
		const queries = batch.map(({ query }) => query);
		const statements = batch.map(({ query, rowMode, keepRows }) => ({
			sql: query.sql,
			params: query.params,
			options: this.#queryOptions({ rowMode, keepRows }, undefined, query),
		}));
		/** Each query's outcome, reported to `onQuery`; `shared` when a failure skipped the rest with its error. */
		const settle = (
			settled: readonly PromiseSettledResult<QueryResult<unknown>>[],
			shared: boolean,
		) => {
			let decorated = false;
			return queries.map((query, i) => {
				const outcome = settled[i]!;
				if (outcome.status === 'rejected') {
					if (!shared || !decorated)
						decorate(outcome.reason, query, callsite());
					decorated = true;
					if (observe) {
						this.#report(
							'execute',
							query,
							start,
							acquired,
							undefined,
							undefined,
							undefined,
							outcome.reason,
						);
					}
					return outcome;
				}
				const value = executeResult(outcome.value);
				if (observe) {
					this.#report(
						'execute',
						query,
						start,
						acquired,
						undefined,
						value.command,
						value.rowCount ?? value.rows.length,
					);
				}
				return { status: 'fulfilled', value } as const;
			});
		};
		/** The results of a batch that ran all or nothing, checked by `verify`. */
		const verified = (settled: PromiseSettledResult<ExecuteResult>[]) => {
			const values: ExecuteResult[] = [];
			for (const outcome of settled) {
				if (outcome.status === 'rejected') throw outcome.reason;
				values.push(outcome.value);
			}
			try {
				verify?.(values);
			} catch (error) {
				decorate(error, undefined, callsite());
				throw error;
			}
			return settled;
		};
		/** Each query with its own Sync, all in one write, settled. */
		const independent = (runner: Pick<Runner, 'query'>) =>
			Promise.allSettled(
				batch.map(({ query, rowMode, keepRows }) =>
					runner.query<unknown>(
						query.sql,
						query.params,
						this.#queryOptions(
							{ ...options, rowMode, keepRows },
							undefined,
							query,
						),
					),
				),
			);
		if (!inTransaction && transaction === undefined) {
			const pool = this.#shared(queries);
			if (pool !== undefined) {
				if (!this.#ready) await this.#prepare(pool);
				const settled = await pool.withShared(
					(connection) => {
						if (observe) acquired = performance.now();
						return independent(connection);
					},
					{ signal },
				);
				return settle(settled, false);
			}
		}
		return await this.#run(signal, async (runner) => {
			if (observe) acquired = performance.now();
			if (inTransaction) {
				return verified(
					settle(
						await Promise.allSettled(runner.queryGroup(statements, { signal })),
						true,
					),
				);
			}
			if (transaction === undefined)
				return settle(await independent(runner), false);
			const { results, done } = Transaction.batch(runner, statements, {
				...transaction,
				...(timeout === undefined
					? {}
					: {
							settings: {
								...transaction.settings,
								statement_timeout: interval(timeout),
							},
						}),
				signal,
				...(verify === undefined
					? {}
					: {
							verify: (rows: readonly QueryResult<unknown>[]) =>
								verify(rows.map(executeResult)),
						}),
			});
			done.catch(() => {});
			const settled = settle(await Promise.allSettled(results), true);
			try {
				await done;
			} catch (error) {
				decorate(error, undefined, callsite());
				throw error;
			}
			return settled;
		});
	}

	transaction<T>(
		fn: (executor: TransactionExecutor) => Promise<T>,
		options: TransactionOptions = {},
	): Promise<T> {
		const run = (tx: Transaction) =>
			fn(new DriverExecutor(tx, this.#options, false, this.#registry));
		const source = this.#source;
		if (source instanceof Transaction) {
			for (const key of [
				'isolation',
				'readOnly',
				'deferrable',
				'retries',
				'timeout',
			] as const) {
				if (options[key] !== undefined) {
					return Promise.reject(
						new DriverError(
							`${key} can only be set on the outermost transaction`,
						),
					);
				}
			}
			return source.transaction(run, {
				...(options.durable === undefined ? {} : { durable: options.durable }),
				...(options.settings === undefined
					? {}
					: { settings: options.settings }),
			});
		}
		return source.transaction(run, options);
	}

	#transaction(): Transaction {
		if (!(this.#source instanceof Transaction))
			throw new DriverError('Not inside a transaction');
		return this.#source;
	}

	afterCommit(callback: () => unknown): void {
		this.#transaction().afterCommit(callback);
	}

	afterRollback(callback: () => unknown): void {
		this.#transaction().afterRollback(callback);
	}

	setLocal(name: string, value: string | number | boolean): Promise<void> {
		return this.#transaction().setLocal(name, value);
	}

	async close(): Promise<void> {
		if (this.#owned && this.#source instanceof Pool) await this.#source.end();
	}
}

/** Whether `value` is something the driver runs queries on, rather than options for a new pool. */
export function isDriverSource(value: unknown): value is DriverSource {
	return (
		value instanceof Pool ||
		value instanceof PoolClient ||
		value instanceof Connection ||
		value instanceof Transaction
	);
}
