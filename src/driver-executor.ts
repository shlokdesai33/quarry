import {
	budgetsOf,
	endQuery,
	runBudget,
	startQueries,
	startQuery,
	type Budget,
	type BudgetUsage,
	type QueryBudget,
	type QueryBudgetError,
} from './budget.js';
import { type CompiledQuery, redactedParams } from './compile.js';
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
import { redactError } from './redact.js';

/** One query, reported to `onQuery` when it settles. */
export interface QueryEvent {
	readonly kind: 'execute' | 'stream' | 'describe';
	readonly sql: string;
	/** The values sent, those bound against `sensitive()` columns as `'[redacted]'`. */
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
	 * Reports the queries that take at least `thresholdMs` (failed ones
	 * included) to `onSlow`, with the same event `onQuery` gets.
	 *
	 * @example slowQuery: { thresholdMs: 200, onSlow: (e) => log.warn(e.tag ?? e.sql, e.durationMs) }
	 */
	readonly slowQuery?: SlowQueryOptions | undefined;
	/** Append the stack of the code that ran a query to its error (default true). */
	readonly callsites?: boolean | undefined;
	/** Use cached prepared statements (default: the connection's setting). */
	readonly prepare?: boolean | undefined;
}

/** Where `slowQuery` reports, and from what duration. */
export interface SlowQueryOptions {
	/** The duration, in milliseconds, from which a query is slow. */
	readonly thresholdMs: number;
	readonly onSlow: (event: QueryEvent) => void;
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

/** Adds the query and its tag to a server error, and the caller's stack to any error. */
function decorate(
	error: unknown,
	query: CompiledQuery | undefined,
	callsite: Error | undefined,
): void {
	if (!(error instanceof Error)) return;
	if (query !== undefined) redactError(error, query);
	if (error instanceof PostgresError && query !== undefined) {
		Object.defineProperty(error, 'query', {
			value: { sql: query.sql, params: redactedParams(query), tag: query.tag },
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
	/**
	 * What identifies the database to `db.budget`: shared with the
	 * executors of its transactions, and no other database's.
	 */
	readonly #owner: object;
	/** Whether the catalog was looked up (or isn't to be). */
	#ready: boolean;

	constructor(
		source: DriverSource,
		options: DatabaseOptions = {},
		owned = false,
		registry?: CodecRegistry,
		owner: object = {},
	) {
		this.#source = source;
		this.#options = options;
		this.#owned = owned;
		this.#owner = owner;
		this.#registry =
			registry ??
			(options.codecs === undefined || options.codecs.length === 0
				? quarryRegistry
				: createCodecRegistry(options.codecs, quarryRegistry));
		this.#ready = options.catalog === false;
	}

	/** Looks up the types codecs name, once per pool; a failure leaves them to the driver. */
	async #prepare(runner: Runner): Promise<void> {
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
		const { paramCodecs, resultCodecs, tag } = query;
		if (options.keepRows !== undefined) out.keepRows = options.keepRows;
		if (paramCodecs !== undefined) out.paramCodecs = paramCodecs;
		if (resultCodecs !== undefined) out.resultCodecs = resultCodecs;
		if (this.#options.prepare !== undefined)
			out.prepare = this.#options.prepare;
		if (options.signal !== undefined) out.signal = options.signal;
		if (options.timeout !== undefined) out.statementTimeout = options.timeout;
		if (onTiming !== undefined) out.onTiming = onTiming;
		if (tag !== undefined) out.tag = tag;
		return out;
	}

	/** Runs `fn` on a connection: borrowed from the pool, or the source itself. */
	async #run<T>(
		signal: AbortSignal | undefined,
		fn: (runner: Runner) => Promise<T>,
	): Promise<T> {
		const source = this.#source;
		if (!(source instanceof Pool)) {
			const runner = source instanceof PoolClient ? source.connection : source;
			await this.#prepare(runner);
			return fn(runner);
		}
		const client = await source.acquire(signal === undefined ? {} : { signal });
		try {
			await this.#prepare(client.connection);
			return await fn(client.connection);
		} finally {
			client.release();
		}
	}

	/** Whether queries are timed: for `onQuery`, `slowQuery` or a budget. */
	#observing(budgets: readonly Budget[]): boolean {
		return (
			this.#options.onQuery !== undefined ||
			this.#options.slowQuery !== undefined ||
			budgets.length > 0
		);
	}

	#emit(event: QueryEvent): void {
		const { onQuery, slowQuery } = this.#options;
		const listeners = [
			onQuery,
			slowQuery !== undefined && event.durationMs >= slowQuery.thresholdMs
				? slowQuery.onSlow
				: undefined,
		];
		for (const listener of listeners) {
			try {
				listener?.(event);
			} catch (error) {
				queueMicrotask(() => {
					throw error;
				});
			}
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
	): number {
		const end = performance.now();
		const durationMs = end - start;
		if (
			this.#options.onQuery === undefined &&
			this.#options.slowQuery === undefined
		)
			return durationMs;
		this.#emit({
			kind,
			sql: query.sql,
			params: redactedParams(query),
			tag: query.tag,
			command,
			rowCount,
			durationMs,
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
		return durationMs;
	}

	#callsite(): Error | undefined {
		return this.#options.callsites === false ? undefined : new Error();
	}

	async execute(
		query: CompiledQuery,
		options: ExecuteOptions = {},
	): Promise<ExecuteResult> {
		const callsite = this.#callsite();
		const budgets = budgetsOf(this.#owner);
		try {
			if (budgets.length > 0) startQuery(budgets, query);
		} catch (error) {
			decorate(error, query, callsite);
			throw error;
		}
		const observe = this.#observing(budgets);
		const start = observe ? performance.now() : 0;
		let acquired = start;
		let timing: OpTiming | undefined;
		let result: QueryResult<unknown>;
		try {
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
		} catch (error) {
			decorate(error, query, callsite);
			if (observe) {
				const durationMs = this.#report(
					'execute',
					query,
					start,
					acquired,
					timing,
					undefined,
					undefined,
					error,
				);
				endQuery(budgets, query, durationMs);
			}
			throw error;
		}
		if (observe) {
			const durationMs = this.#report(
				'execute',
				query,
				start,
				acquired,
				timing,
				result.command,
				result.rowCount ?? result.rows.length,
			);
			const over = endQuery(budgets, query, durationMs);
			if (over !== undefined) {
				decorate(over, query, callsite);
				throw over;
			}
		}
		return {
			rows: result.rows,
			rowCount: result.rowCount,
			command: result.command,
		};
	}

	/**
	 * Reads the result in batches through a cursor. On a pool, the cursor
	 * has a connection of its own, taken by the first batch and released
	 * when the iteration ends however it ends; inside a transaction, other
	 * queries of the transaction run between its batches. A `timeout`
	 * outside a transaction runs the cursor in a transaction of its own,
	 * so the setting can't leak.
	 */
	async *stream(
		query: CompiledQuery,
		options: StreamOptions = {},
	): AsyncGenerator<unknown[], void, undefined> {
		const callsite = this.#callsite();
		const budgets = budgetsOf(this.#owner);
		try {
			if (budgets.length > 0) startQuery(budgets, query);
		} catch (error) {
			decorate(error, query, callsite);
			throw error;
		}
		const start = performance.now();
		let acquired = start;
		let rows = 0;
		let failure: unknown;
		const source = this.#source;
		let client: PoolClient | undefined;
		let over: QueryBudgetError | undefined;
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
			const durationMs = this.#report(
				'stream',
				query,
				start,
				acquired,
				undefined,
				failure === undefined ? 'SELECT' : undefined,
				rows,
				failure,
			);
			over = endQuery(budgets, query, durationMs);
		}
		if (over !== undefined) {
			decorate(over, query, callsite);
			throw over;
		}
	}

	async describe(query: CompiledQuery): Promise<QueryDescription> {
		const callsite = this.#callsite();
		try {
			const description = await this.#run(undefined, (runner) =>
				runner.describe(query.sql),
			);
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
		const callsite = this.#callsite();
		const queries = batch.map(({ query }) => query);
		const budgets = budgetsOf(this.#owner);
		try {
			if (budgets.length > 0) startQueries(budgets, queries);
		} catch (error) {
			decorate(error, undefined, callsite);
			throw error;
		}
		const observe = this.#observing(budgets);
		const start = observe ? performance.now() : 0;
		let acquired = start;
		const statements = batch.map(({ query, rowMode, keepRows }) => ({
			sql: query.sql,
			params: query.params,
			options: this.#queryOptions({ rowMode, keepRows }, undefined, query),
		}));
		/** Each query's outcome, reported to `onQuery`; `shared` when a failure skipped the rest with its error. */
		const settle = async (
			results: readonly Promise<QueryResult<unknown>>[],
			shared: boolean,
		) => {
			const settled = await Promise.allSettled(results);
			let decorated = false;
			return queries.map((query, i) => {
				const outcome = settled[i]!;
				if (outcome.status === 'rejected') {
					if (!shared || !decorated) decorate(outcome.reason, query, callsite);
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
				decorate(error, undefined, callsite);
				throw error;
			}
			return settled;
		};
		const settled = await this.#run(signal, async (runner) => {
			if (observe) acquired = performance.now();
			if (inTransaction) {
				return verified(
					await settle(runner.queryGroup(statements, { signal }), true),
				);
			}
			if (transaction === undefined) {
				return settle(
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
					false,
				);
			}
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
			const outcomes = await settle(results, true);
			try {
				await done;
			} catch (error) {
				decorate(error, undefined, callsite);
				throw error;
			}
			return outcomes;
		}).catch((error: unknown) => {
			if (budgets.length > 0)
				endQuery(budgets, queries[0]!, performance.now() - start);
			throw error;
		});
		if (budgets.length > 0) {
			// one round trip: its time counts once
			const over = endQuery(
				budgets,
				queries.at(-1)!,
				performance.now() - start,
			);
			if (over !== undefined) {
				decorate(over, undefined, callsite);
				throw over;
			}
		}
		return settled;
	}

	transaction<T>(
		fn: (executor: TransactionExecutor) => Promise<T>,
		options: TransactionOptions = {},
	): Promise<T> {
		const run = (tx: Transaction) =>
			fn(
				new DriverExecutor(
					tx,
					this.#options,
					false,
					this.#registry,
					this.#owner,
				),
			);
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

	budget<T>(
		limits: QueryBudget,
		fn: (usage: BudgetUsage) => Promise<T>,
	): Promise<T> {
		return runBudget(this.#owner, limits, fn);
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
