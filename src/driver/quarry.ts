import type { CompiledQuery } from '../compile.js';
import type {
	ExecuteOptions,
	Executor,
	QueryDescription,
	TransactionOptions,
} from '../executor.js';
import { Connection } from './connection.js';
import { DriverError, PostgresError } from './errors.js';
import type { Description, OpTiming, QueryResult } from './ops.js';
import { createPool, Pool, PoolClient, type PoolOptions } from './pool.js';
import type { RowMode } from './rows.js';
import { Transaction, type SettingValue } from './transaction.js';
import {
	catalogQuery,
	catalogTypes,
	quarryTypes,
	type CatalogType,
} from './quarry-types.js';
import {
	arrayOids,
	defaultTypes,
	oids,
	rawTypes,
	type TypeParsers,
} from './types.js';

const knownOids: Readonly<Record<string, number>> = oids;
const knownArrayOids: Readonly<Record<string, number>> = arrayOids;

/** What a quarry executor can run on. */
export type ExecutorSource = Pool | PoolClient | Connection | Transaction;

/** One query, reported to `onQuery` when it settles. */
export interface QueryEvent {
	readonly kind: 'execute' | 'stream' | 'describe';
	readonly sql: string;
	readonly params: readonly unknown[];
	/** The label from quarry's `tag()`. */
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

export interface PgExecutorOptions {
	/**
	 * Text parsers by type OID. Defaults to `quarryTypes`, which decode to
	 * the TypeScript types quarry's columns declare.
	 */
	readonly types?: TypeParsers | undefined;
	/**
	 * Leaves values as the server's text for quarry's codecs to decode:
	 * `true` for every type, or a list of type names or OIDs (their array
	 * types stay raw too).
	 */
	readonly raw?:
		| boolean
		| readonly (keyof typeof oids | 'vector' | 'halfvec' | number)[]
		| undefined;
	/**
	 * Look up array and pgvector types in `pg_type` once, before the first
	 * query, so arrays of any type (enums included) and vectors are decoded
	 * (default true, unless `raw` is `true`).
	 */
	readonly catalog?: boolean | undefined;
	/** Called once per query with its SQL, timings, row count and error. */
	readonly onQuery?: ((event: QueryEvent) => void) | undefined;
	/** Append the stack of the code that ran the query to errors (default true). */
	readonly callsites?: boolean | undefined;
	/** Use cached prepared statements (default: the connection's setting). */
	readonly prepare?: boolean | undefined;
	/** Options applied to every query, overridden per call. */
	readonly defaults?: ExecuteOptions | undefined;
}

/** Removes the `raw` types (and their arrays) from `parsers`. */
function withoutRaw(
	parsers: TypeParsers,
	raw: PgExecutorOptions['raw'],
	catalog: readonly CatalogType[] = [],
): TypeParsers {
	if (raw === true) return rawTypes;
	if (!raw || raw.length === 0) return parsers;
	const out: Record<number, TypeParsers[number]> = { ...parsers };
	for (const type of raw) {
		const oid = typeof type === 'number' ? type : knownOids[type];
		const named =
			typeof type === 'string'
				? catalog.find((t) => t.name === type && t.elem === 0)?.oid
				: undefined;
		for (const base of [oid, named]) {
			if (base === undefined) continue;
			delete out[base];
			for (const t of catalog) if (t.elem === base) delete out[t.oid];
		}
		const array = typeof type === 'string' ? knownArrayOids[type] : undefined;
		if (array !== undefined) delete out[array];
	}
	return Object.freeze(out);
}

/** The parsers an executor starts with, before any catalog lookup. */
export function executorTypes(
	options: Pick<PgExecutorOptions, 'types' | 'raw'>,
): TypeParsers {
	return withoutRaw(options.types ?? quarryTypes, options.raw);
}

/** Parsers shared by an executor and those derived from it, completed from the catalog once. */
interface TypeState {
	parsers: TypeParsers;
	loading: Promise<void> | undefined;
	loaded: boolean;
}

const CALLSITE = Symbol('quarry.callsite');

/** Adds the query and its tag to a server error, and the caller's stack to any error. */
function decorate(
	error: unknown,
	query: CompiledQuery,
	callsite: Error | undefined,
): void {
	if (!(error instanceof Error)) return;
	if (error instanceof PostgresError) {
		Object.defineProperty(error, 'query', {
			value: { sql: query.sql, params: query.params, tag: query.tag },
		});
	}
	if (callsite?.stack && error.stack && !Reflect.has(error, CALLSITE)) {
		Object.defineProperty(error, CALLSITE, { value: true });
		const frames = callsite.stack.slice(callsite.stack.indexOf('\n') + 1);
		error.stack = `${error.stack}\n    --- query issued at ---\n${frames}`;
	}
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
}

/**
 * Runs quarry queries on this driver: a pool, a reserved client, a single
 * connection, or a transaction. Implements every optional `Executor`
 * member: cancellation through `signal`, server-side `timeout`, positional
 * rows, streaming, describing and transactions (savepoints when nested).
 *
 * @example
 * const executor = pgExecutor(createPool(process.env.DATABASE_URL));
 * const db = database(executor);
 * await executor.transaction(async (tx) => {
 *   const user = await database(tx).selectFrom(users).where('users.id', id).one();
 * });
 */
export class PgExecutor implements Executor, AsyncDisposable {
	readonly #source: ExecutorSource;
	readonly #options: PgExecutorOptions;
	readonly #types: TypeState;
	readonly #owned: boolean;

	constructor(
		source: ExecutorSource,
		options: PgExecutorOptions = {},
		owned = false,
		types?: TypeState,
	) {
		this.#source = source;
		this.#options = options;
		this.#types = types ?? {
			parsers: executorTypes(options),
			loading: undefined,
			loaded: options.raw === true || options.catalog === false,
		};
		this.#owned = owned;
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
					state.parsers = withoutRaw(
						catalogTypes(this.#options.types ?? quarryTypes, rows),
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

	/** What this executor runs on. */
	get source(): ExecutorSource {
		return this.#source;
	}

	/** An executor with these options applied to every query (e.g. a request's signal). */
	with(defaults: ExecuteOptions): PgExecutor {
		return new PgExecutor(this.#source, {
			...this.#options,
			defaults: { ...this.#options.defaults, ...defaults },
		});
	}

	#queryOptions(
		options: ExecuteOptions,
		onTiming: ((t: OpTiming) => void) | undefined,
	): Record<string, unknown> {
		const rowMode: RowMode = options.rowMode ?? 'object';
		return {
			types: this.#types.parsers,
			rowMode,
			...(this.#options.prepare === undefined
				? {}
				: { prepare: this.#options.prepare }),
			...(options.signal === undefined ? {} : { signal: options.signal }),
			...(options.timeout === undefined
				? {}
				: { statementTimeout: options.timeout }),
			...(onTiming === undefined ? {} : { onTiming }),
		};
	}

	/** Runs `fn` on a connection: borrowed from the pool, or the source itself. */
	async #run<T>(
		signal: AbortSignal | undefined,
		fn: (runner: Runner) => Promise<T>,
	): Promise<T> {
		const source = this.#source;
		if (!(source instanceof Pool)) {
			await this.#ready(source);
			return fn(source);
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

	async execute(
		query: CompiledQuery,
		options: ExecuteOptions = {},
	): Promise<QueryResult<unknown>> {
		const merged = { ...this.#options.defaults, ...options };
		const callsite =
			this.#options.callsites === false ? undefined : new Error();
		const observe = this.#options.onQuery !== undefined;
		const start = observe ? performance.now() : 0;
		let acquired = start;
		let timing: OpTiming | undefined;
		try {
			const result = await this.#run(merged.signal, (runner) => {
				if (observe) acquired = performance.now();
				return runner.query<unknown>(
					query.sql,
					query.params,
					this.#queryOptions(merged, observe ? (t) => (timing = t) : undefined),
				);
			});
			if (observe)
				this.#report(
					'execute',
					query,
					start,
					acquired,
					timing,
					result.command,
					result.rowCount ?? result.rows.length,
				);
			return result;
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

	/** Reads the result in batches of `batchSize` rows (default 1000) through a cursor. */
	async *stream(
		query: CompiledQuery,
		options: ExecuteOptions & { readonly batchSize?: number | undefined } = {},
	): AsyncGenerator<unknown[], void, undefined> {
		const merged = { ...this.#options.defaults, ...options };
		if (
			merged.timeout !== undefined &&
			!(this.#source instanceof Transaction)
		) {
			throw new DriverError(
				'A statement timeout on a stream needs a transaction; run it inside executor.transaction()',
			);
		}
		const callsite =
			this.#options.callsites === false ? undefined : new Error();
		const start = performance.now();
		let acquired = start;
		let rows = 0;
		const source = this.#source;
		let client: PoolClient | undefined;
		let runner: Runner;
		if (source instanceof Pool) {
			client = await source.acquire(
				merged.signal === undefined ? {} : { signal: merged.signal },
			);
			runner = client.connection;
		} else {
			runner = source;
		}
		acquired = performance.now();
		let failure: unknown;
		try {
			await this.#ready(runner);
			if (merged.timeout !== undefined && source instanceof Transaction) {
				await source.setLocal(
					'statement_timeout',
					typeof merged.timeout === 'number'
						? `${merged.timeout}ms`
						: merged.timeout,
				);
			}
			const cursorOptions = {
				...this.#queryOptions(merged, undefined),
				...(merged.batchSize === undefined
					? {}
					: { batchSize: merged.batchSize }),
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

	/** The query's parameter and result types, without running it. */
	async describe(query: CompiledQuery): Promise<QueryDescription> {
		const callsite =
			this.#options.callsites === false ? undefined : new Error();
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
	 * Runs `fn` in a transaction, passing an executor bound to it. Nested
	 * calls (on that executor) are savepoints. Retries, isolation and
	 * settings apply to the outermost transaction.
	 */
	transaction<T>(
		fn: (executor: PgExecutor) => Promise<T>,
		options: TransactionOptions = {},
	): Promise<T> {
		const run = (tx: Transaction) =>
			fn(new PgExecutor(tx, this.#options, false, this.#types));
		const source = this.#source;
		if (source instanceof Transaction)
			return source.transaction(
				run,
				options.settings ? { settings: options.settings } : {},
			);
		return source.transaction(run, options);
	}

	#transaction(): Transaction {
		if (!(this.#source instanceof Transaction))
			throw new DriverError('This executor is not inside a transaction');
		return this.#source;
	}

	/** Runs `callback` after the outermost transaction commits (only inside `transaction`). */
	afterCommit(callback: () => unknown): void {
		this.#transaction().afterCommit(callback);
	}

	/** Runs `callback` if this transaction or savepoint rolls back (only inside `transaction`). */
	afterRollback(callback: () => unknown): void {
		this.#transaction().afterRollback(callback);
	}

	/** Sets a run-time parameter for the rest of the transaction, with a bound value. */
	setLocal(name: string, value: SettingValue): Promise<void> {
		return this.#transaction().setLocal(name, value);
	}

	/** Ends the pool, if this executor created it from options or a connection string. */
	async close(): Promise<void> {
		if (this.#owned && this.#source instanceof Pool) await this.#source.end();
	}

	[Symbol.asyncDispose](): Promise<void> {
		return this.close();
	}
}

/**
 * A quarry executor. Pass a pool, client, connection or transaction to run
 * on it, or pool options / a connection string to create a pool that
 * `close()` ends.
 */
export function pgExecutor(
	source: ExecutorSource | PoolOptions | string,
	options: PgExecutorOptions = {},
): PgExecutor {
	if (typeof source === 'string' || !isSource(source))
		return new PgExecutor(createPool(source), options, true);
	return new PgExecutor(source, options);
}

function isSource(
	value: ExecutorSource | PoolOptions,
): value is ExecutorSource {
	return (
		value instanceof Pool ||
		value instanceof PoolClient ||
		value instanceof Transaction ||
		value instanceof Connection
	);
}
