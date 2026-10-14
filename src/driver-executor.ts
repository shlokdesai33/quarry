import type { CompiledQuery } from './compile.js';
import { completedTypes, initialTypes, type RawTypes } from './decode.js';
import {
	catalogQuery,
	Connection,
	defaultTypes,
	DriverError,
	Pool,
	PoolClient,
	PostgresError,
	Transaction,
	type CatalogType,
	type Description,
	type OpTiming,
	type QueryResult,
	type TypeParsers,
} from './driver/index.js';
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
	 * Text parsers by type OID. Defaults to parsers that decode to the
	 * TypeScript types quarry's columns declare: int8 and numeric as strings,
	 * timestamptz as a Date, ranges as `Range`, pgvector as `number[]` (of
	 * the float32 values stored).
	 */
	readonly types?: TypeParsers | undefined;
	/** Leave these types (or all, with `true`) as the server's text, for your own codecs. */
	readonly raw?: RawTypes | undefined;
	/**
	 * Look up array and pgvector types in `pg_type` once, before the first
	 * query, so arrays of any type (enums included) and vectors are decoded
	 * (default true, unless `raw` is `true`).
	 */
	readonly catalog?: boolean | undefined;
	/** Called once per query with its SQL, tag, timings, row count and error. */
	readonly onQuery?: ((event: QueryEvent) => void) | undefined;
	/** Append the stack of the code that ran a query to its error (default true). */
	readonly callsites?: boolean | undefined;
	/** Use cached prepared statements (default: the connection's setting). */
	readonly prepare?: boolean | undefined;
}

/** What a `DriverExecutor` runs on. */
export type DriverSource = Pool | PoolClient | Connection | Transaction;

/** Parsers shared by an executor and those derived from it, completed from the catalog once. */
interface TypeState {
	parsers: TypeParsers;
	loading: Promise<void> | undefined;
	loaded: boolean;
}

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
 * Runs quarry's queries on the driver: a pool, a reserved client, a single
 * connection, or a driver transaction. Decodes values to quarry's types,
 * reports `onQuery` events, and adds the query, tag and caller's stack to
 * errors.
 */
export class DriverExecutor implements TransactionExecutor {
	readonly #source: DriverSource;
	readonly #options: DatabaseOptions;
	readonly #types: TypeState;
	readonly #owned: boolean;

	constructor(
		source: DriverSource,
		options: DatabaseOptions = {},
		owned = false,
		types?: TypeState,
	) {
		this.#source = source;
		this.#options = options;
		this.#owned = owned;
		this.#types = types ?? {
			parsers: initialTypes(options.types, options.raw),
			loading: undefined,
			loaded: options.raw === true || options.catalog === false,
		};
	}

	/** Completes the parsers from the catalog, once; on failure the static parsers stay. */
	async #ready(runner: Runner): Promise<void> {
		const state = this.#types;
		if (state.loaded) return;
		state.loading ??= runner
			.query<CatalogType>(catalogQuery, [], {
				types: defaultTypes,
				prepare: false,
			})
			.then(
				({ rows }) => {
					state.parsers = completedTypes(
						this.#options.types,
						this.#options.raw,
						rows,
					);
					return undefined;
				},
				() => undefined,
			)
			.finally(() => {
				state.loaded = true;
			});
		await state.loading;
	}

	#queryOptions(
		options: ExecuteOptions,
		onTiming: ((t: OpTiming) => void) | undefined,
		{ tag, paramTypes }: CompiledQuery,
	) {
		return {
			types: this.#types.parsers,
			rowMode: options.rowMode ?? 'object',
			...(options.keepRows === undefined ? {} : { keepRows: options.keepRows }),
			...(paramTypes === undefined ? {} : { paramTypes }),
			...(this.#options.prepare === undefined
				? {}
				: { prepare: this.#options.prepare }),
			...(options.signal === undefined ? {} : { signal: options.signal }),
			...(options.timeout === undefined
				? {}
				: { statementTimeout: options.timeout }),
			...(onTiming === undefined ? {} : { onTiming }),
			...(tag === undefined ? {} : { tag }),
		};
	}

	/** Runs `fn` on a connection: borrowed from the pool, or the source itself. */
	async #run<T>(
		signal: AbortSignal | undefined,
		fn: (runner: Runner) => Promise<T>,
	): Promise<T> {
		const source = this.#source;
		if (!(source instanceof Pool)) {
			const runner = source instanceof PoolClient ? source.connection : source;
			await this.#ready(runner);
			return fn(runner);
		}
		const client = await source.acquire(signal === undefined ? {} : { signal });
		try {
			await this.#ready(client.connection);
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

	#callsite(): Error | undefined {
		return this.#options.callsites === false ? undefined : new Error();
	}

	async execute(
		query: CompiledQuery,
		options: ExecuteOptions = {},
	): Promise<ExecuteResult> {
		const callsite = this.#callsite();
		const observe = this.#options.onQuery !== undefined;
		const start = observe ? performance.now() : 0;
		let acquired = start;
		let timing: OpTiming | undefined;
		try {
			const result = await this.#run(options.signal, (runner) => {
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
			decorate(error, query, callsite);
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
	 * Reads the result in batches through a cursor, on one connection held
	 * for the whole iteration. A `timeout` outside a transaction opens one
	 * on that connection, so the setting can't leak.
	 */
	async *stream(
		query: CompiledQuery,
		options: StreamOptions = {},
	): AsyncGenerator<unknown[], void, undefined> {
		const callsite = this.#callsite();
		const start = performance.now();
		let rows = 0;
		const source = this.#source;
		const client =
			source instanceof Pool
				? await source.acquire(
						options.signal === undefined ? {} : { signal: options.signal },
					)
				: undefined;
		let runner: Runner;
		if (client !== undefined) runner = client.connection;
		else if (source instanceof PoolClient) runner = source.connection;
		else if (source instanceof Pool)
			throw new DriverError('A pool must lend a connection');
		else runner = source;
		const acquired = performance.now();
		let failure: unknown;
		let opened = false;
		try {
			await this.#ready(runner);
			if (options.timeout !== undefined) {
				if (runner.transactionStatus === 'idle') {
					await runner.query('begin');
					opened = true;
				}
				await runner.query("select set_config('statement_timeout', $1, true)", [
					interval(options.timeout),
				]);
			}
			const cursorOptions = {
				...this.#queryOptions(
					{ ...options, timeout: undefined },
					undefined,
					query,
				),
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
			if (opened) await runner.query('commit');
		} catch (error) {
			failure = error;
			decorate(error, query, callsite);
			throw error;
		} finally {
			if (opened && runner.transactionStatus !== 'idle')
				await runner.query('rollback').catch(() => {});
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
		return this.#run(signal, async (runner) => {
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
			const settled = await settle(results, true);
			try {
				await done;
			} catch (error) {
				decorate(error, undefined, callsite);
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
			fn(new DriverExecutor(tx, this.#options, false, this.#types));
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
