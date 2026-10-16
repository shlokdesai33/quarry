import {
	ConnectionError,
	DecodeError,
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
import type { CodecRegistry, TypeCatalog } from './registry.js';
import {
	cachedPlan,
	planDecoder,
	resultPlan,
	sameFormats,
	type CachedPlan,
	type ResultCodecs,
	type ResultPlan,
	type ResultSpec,
} from './results.js';
import type { RowDecoder, RowMode } from './rows.js';

/** A statement cached on a connection. */
export interface Statement {
	/** The server-side name; '' for SQL only ever sent unnamed, whose columns are still cached. */
	readonly name: string;
	readonly key: string;
	/** When the statement was last looked up, on the connection's counter: the cache evicts the lowest. */
	used: number;
	/** Created, and its Parse not yet written: the operation that finds it so writes it. */
	unwritten: boolean;
	/** Set once ParseComplete arrives. */
	parsed: boolean;
	fields: readonly Field[] | undefined;
	/** The Parse error, when parsing failed; later binds of it report this. */
	error: PostgresError | undefined;
	/**
	 * How its results are read (formats, codecs, row decoders), once the
	 * columns are known: by registry and expected codecs, so rows of a
	 * cached statement skip rebuilding a decoder.
	 */
	readonly plans: CachedPlan[];
}

/** What an operation may use on its connection. */
export interface OpContext {
	readonly writer: Writer;
	/** How result columns are read where a query doesn't say. */
	readonly registry: CodecRegistry;
	/** The types looked up by name, for the pool. */
	readonly catalog: TypeCatalog;
	/** How results are read where a query names no codecs, with and without binary. */
	readonly specs: { readonly binary: ResultSpec; readonly text: ResultSpec };
	/**
	 * The cached statement for this SQL, created if new (`unwritten` until
	 * its Parse is written). A `named` one is created with a name, to be
	 * parsed; an unnamed entry is then replaced.
	 */
	statement(sql: string, types: readonly number[], named: boolean): Statement;
	/**
	 * Whether a statement written now should be named. Behind a pooler that
	 * rewrites named statements, a query pipelined with others is sent
	 * unnamed instead; behind one that can't keep them, every query is.
	 */
	named(): boolean;
	/** Drops a statement from the cache (it failed or went stale). */
	forget(statement: Statement): void;
	/**
	 * Stops preparing a statement's SQL on this connection: even a fresh
	 * Parse of it got a stale plan, which happens when a pooler maps it back
	 * to a server-side statement prepared before a schema change.
	 */
	unprepare(statement: Statement): void;
	/** Whether this SQL may be prepared as a named statement. */
	preparable(sql: string, types: readonly number[]): boolean;
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

/** Where an operation spent its time, in milliseconds. */
export interface OpTiming {
	/** Waiting on the connection behind other operations, before being sent. */
	readonly queuedMs: number;
	/** From being sent until the server finished (server work, transfer and decoding). */
	readonly execMs: number;
}

/** Base for queued operations: written in order, then fed backend messages until ReadyForQuery. */
export abstract class Op {
	written = false;
	done = false;
	/** Whether later operations must wait until this one completes (it keeps talking after being written). */
	readonly exclusive: boolean = false;
	/** Set when this client asked the server to cancel this operation. */
	canceledBy: 'abort' | 'timeout' | undefined;
	/** Receives the operation's timing when it settles, if set. */
	onTiming: ((timing: OpTiming) => void) | undefined;
	/**
	 * Called by the connection once the operation has settled and left its
	 * queue, before callbacks on its result run: a pool frees the connection
	 * before the caller's next query, without a promise of its own per query.
	 */
	onDone: (() => void) | undefined;
	queuedAt = 0;
	writtenAt = 0;
	#cleanups: (() => void)[] | undefined;

	onSettle(cleanup: () => void): void {
		(this.#cleanups ??= []).push(cleanup);
	}

	protected settle(): void {
		this.done = true;
		const cleanups = this.#cleanups;
		if (cleanups !== undefined) {
			this.#cleanups = undefined;
			for (const cleanup of cleanups) cleanup();
		}
		if (this.onTiming !== undefined) {
			const now = performance.now();
			const written = this.writtenAt || now;
			this.onTiming({
				queuedMs: written - this.queuedAt,
				execMs: now - written,
			});
		}
	}

	/**
	 * Takes a DataRow straight from the read buffer, without a message
	 * object; false when this operation doesn't accept rows that way.
	 */
	dataRow(_bytes: Uint8Array, _start: number, _end: number): boolean {
		return false;
	}

	/** How many statements it writes that may be named; more than one is pipelining. */
	get prepares(): number {
		return 0;
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

interface ParsedTag {
	readonly command: string;
	readonly rowCount: number | null;
}

/** The latest tag parsed: a connection mostly sees the same few tags in a row. */
let lastTag = '';
let lastParsed: ParsedTag = { command: '', rowCount: null };

export function parseTag(tag: string): ParsedTag {
	if (tag === lastTag) return lastParsed;
	const space = tag.lastIndexOf(' ');
	let digits = space > 0 && space < tag.length - 1;
	for (let i = space + 1; digits && i < tag.length; i++) {
		const code = tag.charCodeAt(i);
		digits = code >= 0x30 && code <= 0x39;
	}
	lastParsed = digits
		? {
				command: tag.slice(0, tag.indexOf(' ')),
				rowCount: Number(tag.slice(space + 1)),
			}
		: { command: tag, rowCount: null };
	lastTag = tag;
	return lastParsed;
}

export interface QueryOpOptions {
	readonly rowMode: RowMode;
	/** How result columns are read where `resultCodecs` doesn't say; the connection's when undefined. */
	readonly registry: CodecRegistry | undefined;
	/** The codecs the result columns are expected in, by position. */
	readonly resultCodecs: ResultCodecs | undefined;
	readonly prepare: boolean;
	/** Ask for binary results for columns whose codec reads them so. */
	readonly binary: boolean;
	/** The rows kept, from the first; the others aren't decoded. */
	readonly keepRows: number;
}

/** How an operation's results are read on this connection. */
function specOf(options: QueryOpOptions, ctx: OpContext): ResultSpec {
	if (options.registry === undefined && options.resultCodecs === undefined)
		return options.binary ? ctx.specs.binary : ctx.specs.text;
	return {
		registry: options.registry ?? ctx.registry,
		catalog: ctx.catalog,
		expected: options.resultCodecs,
		binary: options.binary,
	};
}

/**
 * The plan for columns now known: the statement's cached one when the
 * formats asked for are its formats, otherwise one for this result alone.
 */
function planOf(
	statement: Statement | undefined,
	fields: readonly Field[],
	spec: ResultSpec,
	requested: readonly number[] | 0 | 'fields' | undefined,
): ResultPlan {
	if (statement === undefined)
		return resultPlan(fields, spec, requested ?? 'fields');
	const plan = cachedPlan(statement.plans, fields, spec);
	if (requested === undefined) return plan;
	const asked = requested === 'fields' ? formatsOf(fields) : requested;
	return sameFormats(plan.formats, asked)
		? plan
		: resultPlan(fields, spec, asked);
}

function formatsOf(fields: readonly Field[]): readonly number[] | 0 {
	return fields.some((field) => field.format === 1)
		? fields.map((field) => field.format)
		: 0;
}

/** Whether a portal's columns are a cached statement's: the same names, types and (unless not `formats`) formats. */
function sameColumns(
	fields: readonly Field[],
	cached: readonly Field[],
	formats = true,
): boolean {
	if (fields.length !== cached.length) return false;
	for (let i = 0; i < fields.length; i++) {
		const a = fields[i];
		const b = cached[i];
		if (
			a?.name !== b?.name ||
			a?.typeOid !== b?.typeOid ||
			(formats && a?.format !== b?.format)
		)
			return false;
	}
	return true;
}

/**
 * Whether an error means a cached statement went stale, so preparing it
 * again (outside a transaction) can succeed: its plan no longer fits a
 * changed schema, a parameter type inferred from a column no longer fits
 * that column, or the server no longer has the statement (DEALLOCATE,
 * DISCARD ALL).
 */
function staleStatement(
	error: PostgresError,
	statement: Statement,
	created: boolean,
): boolean {
	if (error.code === '0A000' && error.routine === 'RevalidateCachedQuery')
		return true;
	if (created) return false;
	if (error.code === '42804' && error.routine === 'transformAssignedExpr')
		return true;
	return (
		error.code === '26000' &&
		error.routine === 'FetchPreparedStatement' &&
		statement.error === undefined
	);
}

/** One statement through the extended protocol: [Parse, Describe] Bind Execute Sync. */
export class QueryOp extends Op {
	readonly #sql: string;
	readonly #params: readonly unknown[];
	readonly #values: readonly WireValue[];
	/** The parameter type OIDs declared at Parse; part of the statement's cache key. */
	readonly #paramTypes: readonly number[];
	readonly #options: QueryOpOptions;
	readonly #resolve: (result: QueryResult<unknown>) => void;
	readonly #reject: (error: Error) => void;
	#spec: ResultSpec | undefined;
	/** The formats asked for before the columns were known; undefined when they came from a plan. */
	#requested: readonly number[] | 0 | undefined;
	/** The cached statement's plan, when its columns were known at write. */
	#plan: ResultPlan | undefined;
	/** The plan the rows are read with, once the columns are known. */
	#current: ResultPlan | undefined;
	#statement: Statement | undefined;
	#createdStatement = false;
	/** Sent unnamed with its cached statement's columns, which the portal's description must match. */
	#unnamed = false;
	/** Those columns, with the formats asked for; undefined when not known yet. */
	#expected: readonly Field[] | undefined;
	#fields: readonly Field[] | undefined;
	#decoder: RowDecoder | undefined;
	/** Created with the first row, sized for it: most queries return one row or none. */
	#rows: unknown[] | undefined;
	#tag = '';
	#error: PostgresError | undefined;
	/** A value that failed to decode: the query fails with it, the rest of its rows are skipped. */
	#decodeError: DecodeError | undefined;
	#retried: boolean;

	constructor(
		sql: string,
		params: readonly unknown[],
		values: readonly WireValue[],
		paramTypes: readonly number[],
		options: QueryOpOptions,
		resolve: (result: QueryResult<unknown>) => void,
		reject: (error: Error) => void,
		retried = false,
	) {
		super();
		this.#sql = sql;
		this.#params = params;
		this.#values = values;
		this.#paramTypes = paramTypes;
		this.#options = options;
		this.#resolve = resolve;
		this.#reject = reject;
		this.#retried = retried;
	}

	override get prepares(): number {
		return this.#options.prepare ? 1 : 0;
	}

	/** The server's error for this statement, once it arrived. */
	get error(): PostgresError | undefined {
		return this.#error;
	}

	/** Writes the statement; without `sync` it ends with the next one's Sync (see `SyncGroupOp`). */
	write(ctx: OpContext, sync = true): void {
		const w = ctx.writer;
		const spec = specOf(this.#options, ctx);
		this.#spec = spec;
		const types = this.#paramTypes;
		if (this.#options.prepare && ctx.preparable(this.#sql, types)) {
			const named = ctx.named();
			const statement = ctx.statement(this.#sql, types, named);
			this.#statement = statement;
			if (!named) {
				this.#unnamed = true;
				// binary only for columns already described
				let formats: readonly number[] | 0 = 0;
				const known = statement.fields;
				if (known !== undefined) {
					const plan = cachedPlan(statement.plans, known, spec);
					formats = plan.formats;
					this.#expected = plan.fields;
				}
				fe.parse(w, '', this.#sql, types);
				fe.bind(w, '', '', this.#values, formats);
				fe.describe(w, 'P', '');
				fe.execute(w, '', 0);
				if (sync) fe.sync(w);
				return;
			}
			const created = statement.unwritten;
			statement.unwritten = false;
			this.#createdStatement = created;
			if (created) {
				fe.parse(w, statement.name, this.#sql, types);
				fe.describe(w, 'S', statement.name);
			}
			const known = statement.fields;
			if (!created && known !== undefined) {
				// columns already known: each in the format its codec reads
				const plan = cachedPlan(statement.plans, known, spec);
				this.#plan = plan;
				fe.bind(w, '', statement.name, this.#values, plan.formats);
			} else {
				// not yet described: text, never a format before the type is known
				this.#requested = 0;
				fe.bind(w, '', statement.name, this.#values);
			}
		} else {
			this.#requested = 0;
			fe.parse(w, '', this.#sql, types);
			fe.bind(w, '', '', this.#values);
			fe.describe(w, 'P', '');
		}
		fe.execute(w, '', 0);
		if (sync) fe.sync(w);
	}

	/** Reads the result through `plan`. */
	#use(plan: ResultPlan): void {
		this.#current = plan;
		this.#fields = plan.fields;
		if (plan.unreadable !== undefined) this.#unreadable(plan.unreadable);
		// no decoder for no columns until a row comes (building one compiles a function)
		this.#decoder =
			plan.fields.length > 0
				? planDecoder(plan, this.#options.rowMode)
				: undefined;
	}

	/** A column came in binary as a type nothing reads: the statement has run, but its rows can't be read. */
	#unreadable(field: Field): void {
		this.#decodeError ??= new DecodeError(
			field.name,
			field.typeOid,
			new DriverError(
				'The column is not of the type the query expected, and came in binary',
			),
		);
	}

	/** The columns, for a named statement: described with it, or known when it was bound. */
	#described(fields: readonly Field[]): void {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- set by write
		const spec = this.#spec!;
		this.#use(planOf(this.#statement, fields, spec, this.#requested));
	}

	override dataRow(bytes: Uint8Array, start: number, end: number): boolean {
		if (this.#decodeError !== undefined) return true;
		if ((this.#rows?.length ?? 0) >= this.#options.keepRows) return true;
		let decoder = this.#decoder;
		if (decoder === undefined) {
			if (this.#current === undefined) {
				if (this.#plan !== undefined) this.#use(this.#plan);
				else {
					const known = this.#unnamed ? undefined : this.#statement?.fields;
					if (known === undefined)
						throw new ProtocolError('DataRow before RowDescription');
					this.#described(known);
				}
				if (this.#decodeError !== undefined) return true;
			}
			// oxlint-disable-next-line typescript/no-non-null-assertion -- set just above
			decoder = planDecoder(this.#current!, this.#options.rowMode);
			this.#decoder = decoder;
		}
		try {
			const row = decoder(bytes, start, end);
			if (this.#rows === undefined) this.#rows = [row];
			else this.#rows.push(row);
		} catch (error) {
			if (!(error instanceof DecodeError)) throw error;
			this.#decodeError = error;
			this.#rows = undefined;
		}
		return true;
	}

	handle(msg: BackendMessage, ctx: OpContext): boolean {
		switch (msg.type) {
			case 'DataRow':
				return !this.dataRow(msg.payload, 0, msg.payload.length);
			case 'ParseComplete':
				if (this.#statement && this.#createdStatement)
					this.#statement.parsed = true;
				return false;
			case 'BindComplete': {
				// an unnamed one's columns come next, from the portal's description
				if (this.#unnamed || this.#current !== undefined) return false;
				if (this.#plan !== undefined) this.#use(this.#plan);
				else if (
					!this.#createdStatement &&
					this.#statement?.fields !== undefined
				)
					this.#described(this.#statement.fields);
				return false;
			}
			case 'CloseComplete':
			case 'EmptyQueryResponse':
			case 'PortalSuspended':
			case 'CopyOutResponse':
			case 'CopyData':
			case 'CopyDone':
			case 'ParameterDescription':
				return false;
			case 'RowDescription':
				if (this.#unnamed) {
					this.#describedUnnamed(msg.fields, ctx);
					return false;
				}
				if (this.#statement === undefined) {
					// unprepared: the portal's description has the formats
					// oxlint-disable-next-line typescript/no-non-null-assertion -- set by write
					this.#use(resultPlan(msg.fields, this.#spec!, 'fields'));
					return false;
				}
				if (this.#createdStatement) this.#statement.fields = msg.fields;
				this.#described(msg.fields);
				return false;
			case 'NoData':
				if (this.#unnamed) {
					this.#describedUnnamed([], ctx);
					return false;
				}
				if (this.#statement && this.#createdStatement)
					this.#statement.fields = [];
				// no rows follow, so no decoder (building one compiles a function)
				this.#fields = [];
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

	/**
	 * The portal's columns, for a statement sent unnamed: decoded with the
	 * cached statement's decoder when they are its columns. A schema change
	 * since it was cached drops it; the rows are decoded by what the server
	 * sent, unless a column asked for in binary changed to a type nothing
	 * reads in binary: the statement has run, but its rows can't be read.
	 */
	#describedUnnamed(fields: readonly Field[], ctx: OpContext): void {
		const statement = this.#statement;
		const expected = this.#expected;
		// oxlint-disable-next-line typescript/no-non-null-assertion -- set by write
		const spec = this.#spec!;
		if (statement === undefined) return;
		if (expected === undefined) {
			// asked for before the columns were known; cached as a statement describes them
			statement.fields ??= fields.some((field) => field.format !== 0)
				? fields.map((field) => ({ ...field, format: 0 }))
				: fields;
			this.#use(
				sameColumns(fields, statement.fields, false)
					? planOf(statement, statement.fields, spec, formatsOf(fields))
					: resultPlan(fields, spec, 'fields'),
			);
			return;
		}
		if (sameColumns(fields, expected)) {
			// oxlint-disable-next-line typescript/no-non-null-assertion -- the plan `expected` came from
			this.#use(planOf(statement, statement.fields!, spec, undefined));
			return;
		}
		ctx.forget(statement);
		this.#use(resultPlan(fields, spec, 'fields'));
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
		if (error === undefined && this.#decodeError !== undefined) {
			this.#reject(this.#decodeError);
			return true;
		}
		if (error === undefined) {
			const { command, rowCount } = parseTag(this.#tag);
			this.#resolve({
				command,
				rowCount,
				rows: this.#rows ?? [],
				fields: this.#fields ?? [],
			});
			return true;
		}
		if (
			this.#statement !== undefined &&
			!this.#unnamed &&
			status === 'I' &&
			!this.#retried &&
			staleStatement(error, this.#statement, this.#createdStatement)
		) {
			ctx.forget(this.#statement);
			if (this.#createdStatement) ctx.unprepare(this.#statement);
			// retried unnamed: a pooler passes that through instead of reusing its stale statement
			const retry = new QueryOp(
				this.#sql,
				this.#params,
				this.#values,
				this.#paramTypes,
				{ ...this.#options, prepare: false },
				this.#resolve,
				this.#reject,
				true,
			);
			// done once the retry is
			retry.onDone = this.onDone;
			this.onDone = undefined;
			ctx.retry(retry);
			return true;
		}
		this.#reject(error);
		return true;
	}

	fail(error: Error): void {
		this.settle();
		this.#reject(this.#error?.isFatal ? this.#error : error);
	}

	/** The server skipped the statement, so a Parse it sent never ran. */
	skip(error: Error, ctx: OpContext): void {
		const statement = this.#statement;
		if (statement && this.#createdStatement && !statement.parsed)
			ctx.forget(statement);
		this.fail(error);
	}
}

/**
 * Statements written under one Sync, so that once one fails the server
 * skips the rest: a BEGIN sent with a transaction's first statement can't
 * let that statement run outside the transaction. Each settles at the
 * ReadyForQuery; the skipped ones reject with the error that skipped them.
 */
export class SyncGroupOp extends Op {
	readonly #ops: readonly QueryOp[];
	/** The statement receiving messages: each ends with CommandComplete, EmptyQueryResponse or ErrorResponse. */
	#current = 0;
	#failed = false;

	constructor(ops: readonly QueryOp[]) {
		super();
		this.#ops = ops;
	}

	override get prepares(): number {
		let count = 0;
		for (const op of this.#ops) count += op.prepares;
		return count;
	}

	write(ctx: OpContext): void {
		for (const op of this.#ops) op.write(ctx, false);
		fe.sync(ctx.writer);
	}

	override dataRow(bytes: Uint8Array, start: number, end: number): boolean {
		return this.#ops[this.#current]?.dataRow(bytes, start, end) ?? false;
	}

	handle(msg: BackendMessage, ctx: OpContext): boolean {
		if (msg.type === 'ReadyForQuery') {
			this.settle();
			const skipped = this.#failed
				? this.#ops[this.#current]?.error
				: undefined;
			for (const [i, op] of this.#ops.entries()) {
				if (i <= this.#current) op.handle(msg, ctx);
				else
					op.skip(skipped ?? new ProtocolError('A statement was skipped'), ctx);
			}
			return true;
		}
		const op = this.#ops[this.#current];
		if (op === undefined || this.#failed) return this.unexpected(msg);
		// a cancel is requested for the group, and hits the statement running
		op.canceledBy = this.canceledBy;
		op.handle(msg, ctx);
		if (msg.type === 'ErrorResponse') this.#failed = true;
		else if (
			msg.type === 'CommandComplete' ||
			msg.type === 'EmptyQueryResponse'
		)
			this.#current++;
		return false;
	}

	fail(error: Error): void {
		this.settle();
		for (const op of this.#ops) if (!op.done) op.fail(error);
	}
}

/** One or more statements through the simple protocol. */
export class SimpleQueryOp extends Op {
	readonly #sql: string;
	readonly #registry: CodecRegistry | undefined;
	readonly #rowMode: RowMode;
	readonly #resolve: (results: QueryResult<unknown>[]) => void;
	readonly #reject: (error: Error) => void;
	readonly #results: QueryResult<unknown>[] = [];
	#fields: readonly Field[] = [];
	#decoder: RowDecoder | undefined;
	#rows: unknown[] = [];
	#error: PostgresError | DecodeError | undefined;
	#spec: ResultSpec | undefined;

	constructor(
		sql: string,
		registry: CodecRegistry | undefined,
		rowMode: RowMode,
		resolve: (results: QueryResult<unknown>[]) => void,
		reject: (error: Error) => void,
	) {
		super();
		this.#sql = sql;
		this.#registry = registry;
		this.#rowMode = rowMode;
		this.#resolve = resolve;
		this.#reject = reject;
	}

	write(ctx: OpContext): void {
		this.#spec = {
			registry: this.#registry ?? ctx.registry,
			catalog: ctx.catalog,
			expected: undefined,
			binary: false,
		};
		fe.query(ctx.writer, this.#sql);
	}

	override dataRow(bytes: Uint8Array, start: number, end: number): boolean {
		if (this.#decoder === undefined)
			throw new ProtocolError('DataRow before RowDescription');
		if (this.#error !== undefined) return true;
		try {
			this.#rows.push(this.#decoder(bytes, start, end));
		} catch (error) {
			if (!(error instanceof DecodeError)) throw error;
			this.#error = error;
		}
		return true;
	}

	handle(msg: BackendMessage, ctx: OpContext): boolean {
		switch (msg.type) {
			case 'RowDescription':
				this.#fields = msg.fields;
				this.#decoder = planDecoder(
					// oxlint-disable-next-line typescript/no-non-null-assertion -- set by write
					resultPlan(msg.fields, this.#spec!, 'fields'),
					this.#rowMode,
				);
				this.#rows = [];
				return false;
			case 'DataRow':
				return !this.dataRow(msg.payload, 0, msg.payload.length);
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
		const own = this.#error;
		this.#reject(own instanceof PostgresError && own.isFatal ? own : error);
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
	readonly #paramTypes: readonly number[];
	#ctx: OpContext | undefined;
	#spec: ResultSpec | undefined;
	#requested: readonly number[] | 0 | undefined;
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
		paramTypes: readonly number[],
		options: QueryOpOptions,
		batchSize: number,
	) {
		super();
		this.#sql = sql;
		this.#params = params;
		this.#values = values;
		this.#paramTypes = paramTypes;
		this.#options = options;
		this.#batchSize = batchSize;
	}

	write(ctx: OpContext): void {
		this.#ctx = ctx;
		const w = ctx.writer;
		const spec = specOf(this.#options, ctx);
		this.#spec = spec;
		const types = this.#paramTypes;
		if (this.#options.prepare && ctx.named()) {
			const statement = ctx.statement(this.#sql, types, true);
			const created = statement.unwritten;
			statement.unwritten = false;
			this.#statement = statement;
			this.#created = created;
			if (created) {
				fe.parse(w, statement.name, this.#sql, types);
				fe.describe(w, 'S', statement.name);
			}
			const known = created ? undefined : statement.fields;
			const formats =
				known === undefined
					? 0
					: cachedPlan(statement.plans, known, spec).formats;
			this.#requested = formats;
			fe.bind(w, '', statement.name, this.#values, formats);
		} else {
			this.#requested = 0;
			fe.parse(w, '', this.#sql, types);
			fe.bind(w, '', '', this.#values);
			fe.describe(w, 'P', '');
		}
		fe.execute(w, '', this.#batchSize);
		fe.flush(w);
		this.#fetching = true;
	}

	/** The columns: from the portal's description (with their formats), or the statement's. */
	#setFields(fields: readonly Field[], portal: boolean): void {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- set by write
		const spec = this.#spec!;
		const plan = portal
			? resultPlan(fields, spec, 'fields')
			: planOf(this.#statement, fields, spec, this.#requested);
		this.#fields = plan.fields;
		if (plan.unreadable !== undefined) {
			this.#error ??= new DecodeError(
				plan.unreadable.name,
				plan.unreadable.typeOid,
				new DriverError(
					'The column is not of the type the query expected, and came in binary',
				),
			);
			this.#sync(true);
		}
		this.#decoder = planDecoder(plan, this.#options.rowMode);
	}

	#deliver(last: boolean): void {
		const rows = this.#batch;
		this.#batch = [];
		this.#fetching = false;
		if (last) this.#exhausted = true;
		// a portal whose size is a multiple of the batch size ends with an empty batch
		if (!last || rows.length > 0) this.#ready.push({ rows, last });
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

	override dataRow(bytes: Uint8Array, start: number, end: number): boolean {
		if (this.#synced) return true;
		if (this.#decoder === undefined)
			throw new ProtocolError('DataRow before RowDescription');
		try {
			this.#batch.push(this.#decoder(bytes, start, end));
		} catch (error) {
			if (!(error instanceof DecodeError)) throw error;
			// the iteration fails with it; the portal is closed so no more rows come
			this.#error ??= error;
			this.#batch = [];
			this.#sync(true);
		}
		return true;
	}

	handle(msg: BackendMessage, ctx: OpContext): boolean {
		switch (msg.type) {
			case 'ParseComplete':
				if (this.#statement && this.#created) this.#statement.parsed = true;
				return false;
			case 'ParameterDescription':
				return false;
			case 'RowDescription':
				if (this.#statement && this.#created)
					this.#statement.fields = msg.fields;
				this.#setFields(msg.fields, this.#statement === undefined);
				return false;
			case 'NoData':
				if (this.#statement && this.#created) this.#statement.fields = [];
				this.#setFields([], false);
				return false;
			case 'BindComplete':
				if (this.#fields === undefined && this.#statement?.fields !== undefined)
					this.#setFields(this.#statement.fields, false);
				if (this.#exhausted && !this.#synced) this.#sync(true);
				return false;
			case 'DataRow':
				return !this.dataRow(msg.payload, 0, msg.payload.length);
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

	constructor(sql: string, highWaterMark: number) {
		super();
		this.#sql = sql;
		this.#highWaterMark = highWaterMark;
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
