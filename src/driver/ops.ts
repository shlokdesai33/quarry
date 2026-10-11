import {
	ConnectionError,
	DriverError,
	PostgresError,
	ProtocolError,
	QueryCanceled,
	postgresError,
} from './errors.js';
import * as fe from './protocol/frontend.js';
import type { WireValue } from './protocol/frontend.js';
import type { BackendMessage, Field } from './protocol/messages.js';
import type { Writer } from './protocol/writer.js';
import { rowDecoder, type RowDecoder, type RowMode } from './rows.js';
import type { TypeParsers } from './types.js';

/** A prepared statement cached on a connection. */
export interface Statement {
	readonly name: string;
	readonly key: string;
	/** Set once ParseComplete arrives. */
	parsed: boolean;
	fields: readonly Field[] | undefined;
	paramTypes: readonly number[] | undefined;
	/** The Parse error, when parsing failed; later binds of it report this. */
	error: PostgresError | undefined;
	/** Decoders by types and row mode, so rows of a cached statement skip rebuilding one. */
	readonly decoders: Map<TypeParsers, Map<RowMode, RowDecoder>>;
}

/** What an operation may use on its connection. */
export interface OpContext {
	readonly writer: Writer;
	readonly types: TypeParsers;
	/** The cached statement for this SQL, created (and to be parsed) if new; undefined when not preparing. */
	statement(
		sql: string,
		types: readonly number[],
	): { statement: Statement; created: boolean };
	/** Drops a statement from the cache (it failed or went stale). */
	forget(statement: Statement): void;
	/** Writes bytes now, for operations that talk after being written (cursors, COPY). */
	send(bytes: Uint8Array): boolean;
	/** Resolves when the socket's write buffer has drained. */
	drain(): Promise<void>;
	pause(): void;
	resume(): void;
	/** Queues an operation again (a statement whose cached plan went stale). */
	retry(op: Op): void;
}

/** The result of one statement. */
export interface QueryResult<R = Record<string, unknown>> {
	/** The command tag's verb: `SELECT`, `INSERT`, `CREATE TABLE`, … */
	readonly command: string;
	/** Rows affected or returned, from the command tag; null for commands without a count. */
	readonly rowCount: number | null;
	readonly rows: R[];
	readonly fields: readonly Field[];
}

/** Base for queued operations: written in order, then fed backend messages until ReadyForQuery. */
export abstract class Op {
	written = false;
	done = false;
	/** Whether later operations must wait until this one completes (it keeps talking after being written). */
	readonly exclusive: boolean = false;
	/** Set when this client asked the server to cancel this operation. */
	canceledBy: 'abort' | 'timeout' | undefined;
	readonly #cleanups: (() => void)[] = [];

	onSettle(cleanup: () => void): void {
		this.#cleanups.push(cleanup);
	}

	protected settle(): void {
		this.done = true;
		for (const cleanup of this.#cleanups.splice(0)) cleanup();
	}

	abstract write(ctx: OpContext): void;
	/** Handles one message; true when the operation is complete. */
	abstract handle(msg: BackendMessage, ctx: OpContext): boolean;
	/** The connection failed before the operation completed. */
	abstract fail(error: Error): void;

	protected unexpected(msg: BackendMessage): never {
		throw new ProtocolError(
			`Unexpected ${msg.type} for ${this.constructor.name}`,
		);
	}

	/** Records that the error came from this client's own cancel request. */
	protected classify(error: PostgresError): PostgresError {
		if (error instanceof QueryCanceled && this.canceledBy !== undefined)
			error.canceledBy(this.canceledBy);
		return error;
	}
}

export function parseTag(tag: string): {
	command: string;
	rowCount: number | null;
} {
	const space = tag.lastIndexOf(' ');
	const last = tag.slice(space + 1);
	if (space > 0 && /^\d+$/.test(last)) {
		return { command: tag.slice(0, tag.indexOf(' ')), rowCount: Number(last) };
	}
	return { command: tag, rowCount: null };
}

export interface QueryOpOptions {
	readonly rowMode: RowMode;
	readonly types: TypeParsers | undefined;
	readonly prepare: boolean;
	readonly paramTypes: readonly number[];
}

function decoderFor(
	statement: Statement | undefined,
	fields: readonly Field[],
	types: TypeParsers,
	mode: RowMode,
): RowDecoder {
	if (statement === undefined) return rowDecoder(fields, types, mode);
	let byMode = statement.decoders.get(types);
	if (byMode === undefined) {
		byMode = new Map();
		statement.decoders.set(types, byMode);
	}
	let decoder = byMode.get(mode);
	if (decoder === undefined) {
		decoder = rowDecoder(fields, types, mode);
		byMode.set(mode, decoder);
	}
	return decoder;
}

/** One statement through the extended protocol: [Parse, Describe] Bind Execute Sync. */
export class QueryOp extends Op {
	readonly #sql: string;
	readonly #params: readonly unknown[];
	readonly #values: readonly WireValue[];
	readonly #options: QueryOpOptions;
	readonly #resolve: (result: QueryResult<unknown>) => void;
	readonly #reject: (error: Error) => void;
	#statement: Statement | undefined;
	#createdStatement = false;
	#types: TypeParsers | undefined;
	#fields: readonly Field[] | undefined;
	#decoder: RowDecoder | undefined;
	#rows: unknown[] = [];
	#tag = '';
	#error: PostgresError | undefined;
	#retried: boolean;

	constructor(
		sql: string,
		params: readonly unknown[],
		values: readonly WireValue[],
		options: QueryOpOptions,
		resolve: (result: QueryResult<unknown>) => void,
		reject: (error: Error) => void,
		retried = false,
	) {
		super();
		this.#sql = sql;
		this.#params = params;
		this.#values = values;
		this.#options = options;
		this.#resolve = resolve;
		this.#reject = reject;
		this.#retried = retried;
	}

	write(ctx: OpContext): void {
		const w = ctx.writer;
		this.#types = this.#options.types ?? ctx.types;
		if (this.#options.prepare) {
			const { statement, created } = ctx.statement(
				this.#sql,
				this.#options.paramTypes,
			);
			this.#statement = statement;
			this.#createdStatement = created;
			if (created) {
				fe.parse(w, statement.name, this.#sql, this.#options.paramTypes);
				fe.describe(w, 'S', statement.name);
			}
			fe.bind(w, '', statement.name, this.#values);
		} else {
			fe.parse(w, '', this.#sql, this.#options.paramTypes);
			fe.bind(w, '', '', this.#values);
			fe.describe(w, 'P', '');
		}
		fe.execute(w, '', 0);
		fe.sync(w);
	}

	#setFields(fields: readonly Field[]): void {
		this.#fields = fields;
		this.#decoder = decoderFor(
			this.#statement,
			fields,
			this.#types ?? {},
			this.#options.rowMode,
		);
	}

	handle(msg: BackendMessage, ctx: OpContext): boolean {
		switch (msg.type) {
			case 'DataRow':
				if (this.#decoder === undefined) {
					const fields = this.#statement?.fields;
					if (fields === undefined)
						throw new ProtocolError('DataRow before RowDescription');
					this.#setFields(fields);
				}
				// oxlint-disable-next-line typescript/no-non-null-assertion
				this.#rows.push(this.#decoder!(msg.payload));
				return false;
			case 'ParseComplete':
				if (this.#statement && this.#createdStatement)
					this.#statement.parsed = true;
				return false;
			case 'BindComplete':
				if (this.#fields === undefined && this.#statement?.fields !== undefined)
					this.#setFields(this.#statement.fields);
				return false;
			case 'CloseComplete':
			case 'EmptyQueryResponse':
			case 'PortalSuspended':
			case 'CopyOutResponse':
			case 'CopyData':
			case 'CopyDone':
				return false;
			case 'ParameterDescription':
				if (this.#statement && this.#createdStatement)
					this.#statement.paramTypes = msg.typeOids;
				return false;
			case 'RowDescription':
				if (this.#statement && this.#createdStatement)
					this.#statement.fields = msg.fields;
				this.#setFields(msg.fields);
				return false;
			case 'NoData':
				if (this.#statement && this.#createdStatement)
					this.#statement.fields = [];
				this.#setFields([]);
				return false;
			case 'CommandComplete':
				this.#tag = msg.tag;
				return false;
			case 'CopyInResponse': {
				// the server ignores Sync during COPY FROM STDIN, so fail it and sync again
				const w = ctx.writer;
				fe.copyFail(
					w,
					'COPY FROM STDIN is not supported by query(); use copyFrom()',
				);
				fe.sync(w);
				ctx.send(w.take());
				return false;
			}
			case 'ErrorResponse':
				this.#onError(
					postgresError(msg.fields, { sql: this.#sql, params: this.#params }),
					ctx,
				);
				return false;
			case 'ReadyForQuery':
				return this.#finish(ctx, msg.status);
			default:
				return this.unexpected(msg);
		}
	}

	#onError(error: PostgresError, ctx: OpContext): void {
		if (this.#error !== undefined) return;
		const statement = this.#statement;
		if (statement && this.#createdStatement && !statement.parsed) {
			statement.error = error;
			ctx.forget(statement);
		} else if (
			statement &&
			!this.#createdStatement &&
			statement.error !== undefined &&
			error.code === '26000'
		) {
			// an earlier pipelined Parse of the same SQL failed; report its error
			error = postgresError(statement.error.fields, {
				sql: this.#sql,
				params: this.#params,
			});
		}
		this.#error = this.classify(error);
	}

	#finish(ctx: OpContext, status: 'I' | 'T' | 'E'): boolean {
		this.settle();
		const error = this.#error;
		if (error === undefined) {
			const { command, rowCount } = parseTag(this.#tag);
			this.#resolve({
				command,
				rowCount,
				rows: this.#rows,
				fields: this.#fields ?? [],
			});
			return true;
		}
		if (
			error.code === '0A000' &&
			error.routine === 'RevalidateCachedQuery' &&
			this.#statement !== undefined &&
			status === 'I' &&
			!this.#retried
		) {
			ctx.forget(this.#statement);
			ctx.retry(
				new QueryOp(
					this.#sql,
					this.#params,
					this.#values,
					this.#options,
					this.#resolve,
					this.#reject,
					true,
				),
			);
			return true;
		}
		this.#reject(error);
		return true;
	}

	fail(error: Error): void {
		this.settle();
		this.#reject(this.#error?.isFatal ? this.#error : error);
	}
}

/** One or more statements through the simple protocol. */
export class SimpleQueryOp extends Op {
	readonly #sql: string;
	readonly #types: TypeParsers | undefined;
	readonly #rowMode: RowMode;
	readonly #resolve: (results: QueryResult<unknown>[]) => void;
	readonly #reject: (error: Error) => void;
	readonly #results: QueryResult<unknown>[] = [];
	#fields: readonly Field[] = [];
	#decoder: RowDecoder | undefined;
	#rows: unknown[] = [];
	#error: PostgresError | undefined;
	#ctxTypes: TypeParsers = {};

	constructor(
		sql: string,
		types: TypeParsers | undefined,
		rowMode: RowMode,
		resolve: (results: QueryResult<unknown>[]) => void,
		reject: (error: Error) => void,
	) {
		super();
		this.#sql = sql;
		this.#types = types;
		this.#rowMode = rowMode;
		this.#resolve = resolve;
		this.#reject = reject;
	}

	write(ctx: OpContext): void {
		this.#ctxTypes = this.#types ?? ctx.types;
		fe.query(ctx.writer, this.#sql);
	}

	handle(msg: BackendMessage, ctx: OpContext): boolean {
		switch (msg.type) {
			case 'RowDescription':
				this.#fields = msg.fields;
				this.#decoder = rowDecoder(msg.fields, this.#ctxTypes, this.#rowMode);
				this.#rows = [];
				return false;
			case 'DataRow':
				if (this.#decoder === undefined)
					throw new ProtocolError('DataRow before RowDescription');
				this.#rows.push(this.#decoder(msg.payload));
				return false;
			case 'CommandComplete': {
				const { command, rowCount } = parseTag(msg.tag);
				this.#results.push({
					command,
					rowCount,
					rows: this.#rows,
					fields: this.#fields,
				});
				this.#fields = [];
				this.#rows = [];
				this.#decoder = undefined;
				return false;
			}
			case 'EmptyQueryResponse':
			case 'CopyOutResponse':
			case 'CopyData':
			case 'CopyDone':
				return false;
			case 'CopyInResponse': {
				const w = ctx.writer;
				fe.copyFail(
					w,
					'COPY FROM STDIN is not supported by simpleQuery(); use copyFrom()',
				);
				ctx.send(w.take());
				return false;
			}
			case 'ErrorResponse':
				this.#error ??= this.classify(
					postgresError(msg.fields, { sql: this.#sql, params: [] }),
				);
				return false;
			case 'ReadyForQuery':
				this.settle();
				if (this.#error) this.#reject(this.#error);
				else this.#resolve(this.#results);
				return true;
			default:
				return this.unexpected(msg);
		}
	}

	fail(error: Error): void {
		this.settle();
		this.#reject(this.#error?.isFatal ? this.#error : error);
	}
}

/** The parameter and result types of a statement, without running it. */
export interface Description {
	/** OIDs of the parameters' types, as the server inferred them. */
	readonly paramTypes: readonly number[];
	/** The result columns; empty for statements that return no rows. */
	readonly fields: readonly Field[];
}

/** Parse + Describe (statement) + Sync on the unnamed statement. */
export class DescribeOp extends Op {
	readonly #sql: string;
	readonly #paramTypes: readonly number[];
	readonly #resolve: (description: Description) => void;
	readonly #reject: (error: Error) => void;
	#params: readonly number[] = [];
	#fields: readonly Field[] = [];
	#error: PostgresError | undefined;

	constructor(
		sql: string,
		paramTypes: readonly number[],
		resolve: (d: Description) => void,
		reject: (e: Error) => void,
	) {
		super();
		this.#sql = sql;
		this.#paramTypes = paramTypes;
		this.#resolve = resolve;
		this.#reject = reject;
	}

	write(ctx: OpContext): void {
		fe.parse(ctx.writer, '', this.#sql, this.#paramTypes);
		fe.describe(ctx.writer, 'S', '');
		fe.sync(ctx.writer);
	}

	handle(msg: BackendMessage): boolean {
		switch (msg.type) {
			case 'ParseComplete':
			case 'NoData':
				return false;
			case 'ParameterDescription':
				this.#params = msg.typeOids;
				return false;
			case 'RowDescription':
				this.#fields = msg.fields;
				return false;
			case 'ErrorResponse':
				this.#error ??= this.classify(
					postgresError(msg.fields, { sql: this.#sql, params: [] }),
				);
				return false;
			case 'ReadyForQuery':
				this.settle();
				if (this.#error) this.#reject(this.#error);
				else this.#resolve({ paramTypes: this.#params, fields: this.#fields });
				return true;
			default:
				return this.unexpected(msg);
		}
	}

	fail(error: Error): void {
		this.settle();
		this.#reject(error);
	}
}

interface Waiter<T> {
	resolve(value: T): void;
	reject(error: Error): void;
}

/**
 * A portal read in batches: Bind, then Execute(batchSize) + Flush per
 * batch, and Sync at the end. Exclusive: nothing else can be written while
 * the portal is open, since another Bind would replace it.
 */
export class CursorOp extends Op {
	override readonly exclusive = true;
	readonly #sql: string;
	readonly #params: readonly unknown[];
	readonly #values: readonly WireValue[];
	readonly #options: QueryOpOptions;
	readonly #batchSize: number;
	#ctx: OpContext | undefined;
	#statement: Statement | undefined;
	#created = false;
	#decoder: RowDecoder | undefined;
	#fields: readonly Field[] | undefined;
	#batch: unknown[] = [];
	/** Batches received but not yet taken: rows, and whether the portal is exhausted. */
	readonly #ready: { rows: unknown[]; last: boolean }[] = [];
	#waiter: Waiter<unknown[] | undefined> | undefined;
	#fetching = false;
	#exhausted = false;
	#synced = false;
	#error: Error | undefined;
	#finished = false;
	#finishWaiters: (() => void)[] = [];

	constructor(
		sql: string,
		params: readonly unknown[],
		values: readonly WireValue[],
		options: QueryOpOptions,
		batchSize: number,
	) {
		super();
		this.#sql = sql;
		this.#params = params;
		this.#values = values;
		this.#options = options;
		this.#batchSize = batchSize;
	}

	get fields(): readonly Field[] | undefined {
		return this.#fields;
	}

	write(ctx: OpContext): void {
		this.#ctx = ctx;
		const w = ctx.writer;
		if (this.#options.prepare) {
			const { statement, created } = ctx.statement(
				this.#sql,
				this.#options.paramTypes,
			);
			this.#statement = statement;
			this.#created = created;
			if (created) {
				fe.parse(w, statement.name, this.#sql, this.#options.paramTypes);
				fe.describe(w, 'S', statement.name);
			}
			fe.bind(w, '', statement.name, this.#values);
		} else {
			fe.parse(w, '', this.#sql, this.#options.paramTypes);
			fe.bind(w, '', '', this.#values);
			fe.describe(w, 'P', '');
		}
		fe.execute(w, '', this.#batchSize);
		fe.flush(w);
		this.#fetching = true;
	}

	#setFields(fields: readonly Field[]): void {
		this.#fields = fields;
		this.#decoder = decoderFor(
			this.#statement,
			fields,
			this.#options.types ?? this.#ctx?.types ?? {},
			this.#options.rowMode,
		);
	}

	#deliver(last: boolean): void {
		const rows = this.#batch;
		this.#batch = [];
		this.#fetching = false;
		if (last) this.#exhausted = true;
		this.#ready.push({ rows, last });
		this.#pump();
	}

	/** Hands a ready batch to a waiting consumer, prefetching the next one. */
	#pump(): void {
		const waiter = this.#waiter;
		if (waiter === undefined) return;
		const batch = this.#ready.shift();
		if (batch !== undefined) {
			this.#waiter = undefined;
			if (!batch.last) this.#fetch();
			waiter.resolve(batch.rows);
			return;
		}
		if (this.#error !== undefined && this.#finished) {
			this.#waiter = undefined;
			waiter.reject(this.#error);
			return;
		}
		if (this.#exhausted && this.#finished) {
			this.#waiter = undefined;
			waiter.resolve(undefined);
		}
	}

	#fetch(): void {
		if (
			this.#fetching ||
			this.#exhausted ||
			this.#synced ||
			this.#ctx === undefined
		)
			return;
		this.#fetching = true;
		const w = this.#ctx.writer;
		fe.execute(w, '', this.#batchSize);
		fe.flush(w);
		this.#ctx.send(w.take());
	}

	#sync(closePortal: boolean): void {
		if (this.#synced || this.#ctx === undefined) return;
		this.#synced = true;
		const w = this.#ctx.writer;
		if (closePortal) fe.close(w, 'P', '');
		fe.sync(w);
		this.#ctx.send(w.take());
	}

	/** The next batch of rows, or undefined once the portal is exhausted. */
	next(): Promise<unknown[] | undefined> {
		return new Promise((resolve, reject) => {
			this.#waiter = { resolve, reject };
			this.#pump();
		});
	}

	/** Stops early: closes the portal and waits for the connection to be free again. */
	async close(): Promise<void> {
		if (!this.#finished) {
			if (this.#ctx === undefined) {
				// not written yet: it will close as soon as it is
				this.#exhausted = true;
			} else {
				this.#sync(true);
			}
			await new Promise<void>((resolve) => this.#finishWaiters.push(resolve));
		}
	}

	handle(msg: BackendMessage, ctx: OpContext): boolean {
		switch (msg.type) {
			case 'ParseComplete':
				if (this.#statement && this.#created) this.#statement.parsed = true;
				return false;
			case 'ParameterDescription':
				if (this.#statement && this.#created)
					this.#statement.paramTypes = msg.typeOids;
				return false;
			case 'RowDescription':
				if (this.#statement && this.#created)
					this.#statement.fields = msg.fields;
				this.#setFields(msg.fields);
				return false;
			case 'NoData':
				if (this.#statement && this.#created) this.#statement.fields = [];
				this.#setFields([]);
				return false;
			case 'BindComplete':
				if (this.#fields === undefined && this.#statement?.fields !== undefined)
					this.#setFields(this.#statement.fields);
				if (this.#exhausted && !this.#synced) this.#sync(true);
				return false;
			case 'DataRow':
				if (this.#synced) return false;
				if (this.#decoder === undefined)
					throw new ProtocolError('DataRow before RowDescription');
				this.#batch.push(this.#decoder(msg.payload));
				return false;
			case 'PortalSuspended':
				if (!this.#synced) this.#deliver(false);
				return false;
			case 'CommandComplete':
			case 'EmptyQueryResponse':
				if (!this.#synced) {
					this.#deliver(true);
					this.#sync(false);
				}
				return false;
			case 'CloseComplete':
				return false;
			case 'ErrorResponse': {
				const error = postgresError(msg.fields, {
					sql: this.#sql,
					params: this.#params,
				});
				if (this.#statement && this.#created && !this.#statement.parsed) {
					this.#statement.error = error;
					ctx.forget(this.#statement);
				}
				this.#error ??= this.classify(error);
				this.#sync(false);
				return false;
			}
			case 'ReadyForQuery':
				this.#finish();
				return true;
			default:
				return this.unexpected(msg);
		}
	}

	#finish(): void {
		this.#finished = true;
		this.#exhausted = true;
		this.settle();
		this.#pump();
		for (const resolve of this.#finishWaiters.splice(0)) resolve();
	}

	fail(error: Error): void {
		this.#error ??= error;
		this.#finish();
	}
}

/** COPY … FROM STDIN, fed from an iterable of chunks. */
export class CopyFromOp extends Op {
	override readonly exclusive = true;
	readonly #sql: string;
	readonly #source:
		| AsyncIterable<Uint8Array | string>
		| Iterable<Uint8Array | string>;
	readonly #resolve: (rowCount: number) => void;
	readonly #reject: (error: Error) => void;
	#error: Error | undefined;
	#rowCount = 0;
	#stopped = false;

	constructor(
		sql: string,
		source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
		resolve: (rowCount: number) => void,
		reject: (error: Error) => void,
	) {
		super();
		this.#sql = sql;
		this.#source = source;
		this.#resolve = resolve;
		this.#reject = reject;
	}

	write(ctx: OpContext): void {
		fe.query(ctx.writer, this.#sql);
	}

	async #pumpSource(ctx: OpContext): Promise<void> {
		const w = ctx.writer;
		try {
			for await (const chunk of this.#source) {
				if (this.#stopped) return;
				fe.copyData(w, chunk);
				if (w.length >= 65536 && !ctx.send(w.take())) await ctx.drain();
			}
			if (this.#stopped) return;
			fe.copyDone(w);
			ctx.send(w.take());
		} catch (error) {
			if (this.#stopped) return;
			w.take();
			fe.copyFail(w, error instanceof Error ? error.message : String(error));
			ctx.send(w.take());
			this.#error = new DriverError('The COPY source failed', { cause: error });
		}
	}

	handle(msg: BackendMessage, ctx: OpContext): boolean {
		switch (msg.type) {
			case 'CopyInResponse':
				void this.#pumpSource(ctx);
				return false;
			case 'CommandComplete':
				this.#rowCount = parseTag(msg.tag).rowCount ?? 0;
				return false;
			case 'ErrorResponse':
				this.#stopped = true;
				this.#error ??= this.classify(
					postgresError(msg.fields, { sql: this.#sql, params: [] }),
				);
				return false;
			case 'RowDescription':
			case 'DataRow':
			case 'EmptyQueryResponse':
				return false;
			case 'CopyOutResponse':
			case 'CopyData':
			case 'CopyDone':
				return false;
			case 'ReadyForQuery':
				this.#stopped = true;
				this.settle();
				if (this.#error) this.#reject(this.#error);
				else this.#resolve(this.#rowCount);
				return true;
			default:
				return this.unexpected(msg);
		}
	}

	fail(error: Error): void {
		this.#stopped = true;
		this.settle();
		this.#reject(error);
	}
}

/** COPY … TO STDOUT, read as chunks with backpressure. */
export class CopyToOp extends Op {
	override readonly exclusive = true;
	readonly #sql: string;
	readonly #highWaterMark: number;
	#ctx: OpContext | undefined;
	readonly #chunks: Uint8Array[] = [];
	#buffered = 0;
	#paused = false;
	#waiter: Waiter<Uint8Array | undefined> | undefined;
	#error: Error | undefined;
	#finished = false;
	#rowCount = 0;

	constructor(sql: string, highWaterMark: number) {
		super();
		this.#sql = sql;
		this.#highWaterMark = highWaterMark;
	}

	get rowCount(): number {
		return this.#rowCount;
	}

	write(ctx: OpContext): void {
		this.#ctx = ctx;
		fe.query(ctx.writer, this.#sql);
	}

	next(): Promise<Uint8Array | undefined> {
		return new Promise((resolve, reject) => {
			this.#waiter = { resolve, reject };
			this.#pump();
		});
	}

	#pump(): void {
		const waiter = this.#waiter;
		if (waiter === undefined) return;
		const chunk = this.#chunks.shift();
		if (chunk !== undefined) {
			this.#waiter = undefined;
			this.#buffered -= chunk.length;
			if (this.#paused && this.#buffered < this.#highWaterMark / 2) {
				this.#paused = false;
				this.#ctx?.resume();
			}
			waiter.resolve(chunk);
		} else if (this.#finished) {
			this.#waiter = undefined;
			if (this.#error) waiter.reject(this.#error);
			else waiter.resolve(undefined);
		}
	}

	handle(msg: BackendMessage, ctx: OpContext): boolean {
		switch (msg.type) {
			case 'CopyOutResponse':
			case 'CopyDone':
				return false;
			case 'CopyData': {
				const chunk = msg.data.slice();
				this.#chunks.push(chunk);
				this.#buffered += chunk.length;
				if (!this.#paused && this.#buffered >= this.#highWaterMark) {
					this.#paused = true;
					ctx.pause();
				}
				this.#pump();
				return false;
			}
			case 'CommandComplete':
				this.#rowCount = parseTag(msg.tag).rowCount ?? 0;
				return false;
			case 'CopyInResponse': {
				const w = ctx.writer;
				fe.copyFail(w, 'copyTo() needs COPY … TO STDOUT');
				ctx.send(w.take());
				return false;
			}
			case 'RowDescription':
			case 'DataRow':
			case 'EmptyQueryResponse':
				return false;
			case 'ErrorResponse':
				this.#error ??= this.classify(
					postgresError(msg.fields, { sql: this.#sql, params: [] }),
				);
				return false;
			case 'ReadyForQuery':
				this.#finished = true;
				if (this.#paused) {
					this.#paused = false;
					ctx.resume();
				}
				this.settle();
				this.#pump();
				return true;
			default:
				return this.unexpected(msg);
		}
	}

	fail(error: Error): void {
		this.#error ??= error;
		this.#finished = true;
		this.settle();
		this.#pump();
	}
}

/** Used when a connection is closed before an operation could be written. */
export const closedError = (cause?: Error): ConnectionError =>
	new ConnectionError(
		'The connection is closed',
		cause ? { cause } : undefined,
	);
