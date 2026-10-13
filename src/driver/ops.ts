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
import {
	binaryIsText,
	binaryParser,
	formatPlan,
	type FormatPlan,
} from './binary.js';
import { rowDecoder, type RowDecoder, type RowMode } from './rows.js';
import type { TypeParsers } from './types.js';

/** A statement cached on a connection. */
export interface Statement {
	/** The server-side name; '' for SQL only ever sent unnamed, whose columns are still cached. */
	readonly name: string;
	readonly key: string;
	/** Set once ParseComplete arrives. */
	parsed: boolean;
	fields: readonly Field[] | undefined;
	paramTypes: readonly number[] | undefined;
	/** The Parse error, when parsing failed; later binds of it report this. */
	error: PostgresError | undefined;
	/** Decoders by types and row mode, so rows of a cached statement skip rebuilding one. */
	/** Decoders by result fields (text or binary plan), types and row mode, so rows of a cached statement skip rebuilding one. */
	readonly decoders: Map<
		readonly Field[],
		Map<TypeParsers, Map<RowMode, RowDecoder>>
	>;
	/** Result format plans by types, once the result columns are known. */
	readonly plans: Map<TypeParsers, FormatPlan>;
}

/** What an operation may use on its connection. */
export interface OpContext {
	readonly writer: Writer;
	readonly types: TypeParsers;
	/**
	 * The cached statement for this SQL, created if new. A `named` one is
	 * created with a name, to be parsed; an unnamed entry is then replaced.
	 */
	statement(
		sql: string,
		types: readonly number[],
		named: boolean,
	): { statement: Statement; created: boolean };
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
	queuedAt = 0;
	writtenAt = 0;
	readonly #cleanups: (() => void)[] = [];

	onSettle(cleanup: () => void): void {
		this.#cleanups.push(cleanup);
	}

	protected settle(): void {
		this.done = true;
		for (const cleanup of this.#cleanups.splice(0)) cleanup();
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
	/** Ask for binary results for columns with a matching binary decoder. */
	readonly binary: boolean;
}

/** The result format plan for a described statement, cached per types. */
function planFor(
	statement: Statement,
	fields: readonly Field[],
	types: TypeParsers,
): FormatPlan {
	let plan = statement.plans.get(types);
	if (plan === undefined) {
		plan = formatPlan(fields, types);
		statement.plans.set(types, plan);
	}
	return plan;
}

function decoderFor(
	statement: Statement | undefined,
	fields: readonly Field[],
	types: TypeParsers,
	mode: RowMode,
): RowDecoder {
	if (statement === undefined) return rowDecoder(fields, types, mode);
	let byTypes = statement.decoders.get(fields);
	if (byTypes === undefined) {
		byTypes = new Map();
		statement.decoders.set(fields, byTypes);
	}
	let byMode = byTypes.get(types);
	if (byMode === undefined) {
		byMode = new Map();
		byTypes.set(types, byMode);
	}
	let decoder = byMode.get(mode);
	if (decoder === undefined) {
		decoder = rowDecoder(fields, types, mode);
		byMode.set(mode, decoder);
	}
	return decoder;
}

/** Whether a portal's columns are a cached statement's: the same names, types and formats. */
function sameColumns(
	fields: readonly Field[],
	cached: readonly Field[],
): boolean {
	if (fields.length !== cached.length) return false;
	for (let i = 0; i < fields.length; i++) {
		const a = fields[i];
		const b = cached[i];
		if (
			a?.name !== b?.name ||
			a?.typeOid !== b?.typeOid ||
			a?.format !== b?.format
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
	readonly #options: QueryOpOptions;
	readonly #resolve: (result: QueryResult<unknown>) => void;
	readonly #reject: (error: Error) => void;
	#planFields: readonly Field[] | undefined;
	#statement: Statement | undefined;
	#createdStatement = false;
	/** Sent unnamed with its cached statement's columns, which the portal's description must match. */
	#unnamed = false;
	/** Those columns, with the formats asked for; undefined when not known yet. */
	#expected: readonly Field[] | undefined;
	#types: TypeParsers | undefined;
	#fields: readonly Field[] | undefined;
	#decoder: RowDecoder | undefined;
	#rows: unknown[] = [];
	#tag = '';
	#error: PostgresError | undefined;
	/** A value that failed to decode: the query fails with it, the rest of its rows are skipped. */
	#decodeError: DecodeError | undefined;
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
		this.#types = this.#options.types ?? ctx.types;
		if (
			this.#options.prepare &&
			ctx.preparable(this.#sql, this.#options.paramTypes)
		) {
			const named = ctx.named();
			const { statement, created } = ctx.statement(
				this.#sql,
				this.#options.paramTypes,
				named,
			);
			this.#statement = statement;
			if (!named) {
				this.#unnamed = true;
				let formats: readonly number[] | 0 = 0;
				const known = statement.fields;
				if (known !== undefined && this.#options.binary) {
					const plan = planFor(statement, known, this.#types);
					formats = plan.formats;
					this.#expected = plan.fields;
				} else {
					this.#expected = known;
				}
				fe.parse(w, '', this.#sql, this.#options.paramTypes);
				fe.bind(w, '', '', this.#values, formats);
				fe.describe(w, 'P', '');
				fe.execute(w, '', 0);
				if (sync) fe.sync(w);
				return;
			}
			this.#createdStatement = created;
			if (created) {
				fe.parse(w, statement.name, this.#sql, this.#options.paramTypes);
				fe.describe(w, 'S', statement.name);
			}
			const known = statement.fields;
			if (!created && this.#options.binary && known !== undefined) {
				// columns already known: ask for binary where a decoder matches
				const plan = planFor(statement, known, this.#types);
				this.#planFields = plan.fields;
				fe.bind(w, '', statement.name, this.#values, plan.formats);
			} else {
				fe.bind(w, '', statement.name, this.#values);
			}
		} else {
			fe.parse(w, '', this.#sql, this.#options.paramTypes);
			fe.bind(w, '', '', this.#values);
			fe.describe(w, 'P', '');
		}
		fe.execute(w, '', 0);
		if (sync) fe.sync(w);
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

	override dataRow(bytes: Uint8Array, start: number, end: number): boolean {
		if (this.#decodeError !== undefined) return true;
		let decoder = this.#decoder;
		if (decoder === undefined) {
			const fields = this.#unnamed
				? this.#fields
				: (this.#planFields ?? this.#statement?.fields);
			if (fields === undefined)
				throw new ProtocolError('DataRow before RowDescription');
			this.#setFields(fields);
			decoder = this.#decoder;
		}
		try {
			// oxlint-disable-next-line typescript/no-non-null-assertion
			this.#rows.push(decoder!(bytes, start, end));
		} catch (error) {
			if (!(error instanceof DecodeError)) throw error;
			this.#decodeError = error;
			this.#rows = [];
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
				if (this.#unnamed) return false;
				const fields = this.#planFields ?? this.#statement?.fields;
				if (this.#fields === undefined && fields !== undefined)
					this.#setFields(fields);
				return false;
			}
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
				if (this.#unnamed) {
					this.#describedUnnamed(msg.fields, ctx);
					return false;
				}
				if (this.#statement && this.#createdStatement)
					this.#statement.fields = msg.fields;
				this.#setFields(msg.fields);
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
	 * sent, unless a column asked for in binary changed to a type without a
	 * binary decoder (and whose binary isn't its text): the statement has
	 * run, but its rows can't be read.
	 */
	#describedUnnamed(fields: readonly Field[], ctx: OpContext): void {
		const statement = this.#statement;
		const expected = this.#expected;
		const types = this.#types ?? {};
		if (statement === undefined) return;
		let columns = fields;
		if (expected === undefined) {
			// asked for in text, as a statement describes them
			statement.fields ??= fields;
		} else if (sameColumns(fields, expected)) {
			columns = expected;
		} else {
			ctx.forget(statement);
			let unreadable: Field | undefined;
			columns = fields.map((field) => {
				if (
					field.format !== 1 ||
					binaryParser(field.typeOid, types[field.typeOid]) !== undefined
				)
					return field;
				if (binaryIsText(field.typeOid)) return { ...field, format: 0 };
				unreadable ??= field;
				return field;
			});
			if (unreadable !== undefined) {
				this.#decodeError = new DecodeError(
					unreadable.name,
					unreadable.typeOid,
					new DriverError(
						'The column changed type since the statement was cached, and came in binary',
					),
				);
			}
			this.#fields = columns;
			if (columns.length > 0)
				this.#decoder = rowDecoder(columns, types, this.#options.rowMode);
			return;
		}
		this.#fields = columns;
		// no decoder for no columns until a row comes (building one compiles a function)
		if (columns.length > 0) this.#setFields(columns);
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
				rows: this.#rows,
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
			ctx.retry(
				new QueryOp(
					this.#sql,
					this.#params,
					this.#values,
					{ ...this.#options, prepare: false },
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
	readonly #types: TypeParsers | undefined;
	readonly #rowMode: RowMode;
	readonly #resolve: (results: QueryResult<unknown>[]) => void;
	readonly #reject: (error: Error) => void;
	readonly #results: QueryResult<unknown>[] = [];
	#fields: readonly Field[] = [];
	#decoder: RowDecoder | undefined;
	#rows: unknown[] = [];
	#error: PostgresError | DecodeError | undefined;
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
				this.#decoder = rowDecoder(msg.fields, this.#ctxTypes, this.#rowMode);
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
		if (this.#options.prepare && ctx.named()) {
			const { statement, created } = ctx.statement(
				this.#sql,
				this.#options.paramTypes,
				true,
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
