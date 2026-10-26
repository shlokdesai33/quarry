import {
	AbortError,
	ConnectionError,
	DecodeError,
	DriverError,
	PostgresError,
	ProtocolError,
	QueryCanceled,
	postgresError,
} from './errors.js';
import * as fe from './protocol/frontend.js';
import { allocate } from './protocol/text.js';
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
import type { NestedObject, RowDecoder, RowMode } from './rows.js';
import type { QueryOptions } from './connection.js';

/**
 * With $1, sets `statement_timeout` to it until the transaction ends,
 * keeping the value it replaces in a custom setting,
 * `quarry.statement_timeout` (transaction-local too; `||` evaluates its
 * left side first). With null, puts that value back.
 *
 * One statement for both, so a group's only Parse of it comes first,
 * where nothing can make the server skip it: groups pipelined behind
 * bind its name before it is answered. Its parameter is text (OID 25).
 */
/**
 * A statement that opens a transaction block, by its first word (after
 * comments): the only ones that leave one open behind their Sync.
 */
const BEGINS = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(?:begin|start)\b/i;

export const opensTransactionBlock = (sql: string): boolean =>
	BEGINS.test(sql);

/**
 * Sets `statement_timeout` to $1 until the transaction ends: with its
 * query under one Sync, outside a transaction block, the implicit
 * transaction ends it at the Sync. Its parameter is text (OID 25).
 */
export const STATEMENT_TIMEOUT_LOCAL =
	"select set_config('statement_timeout', $1, true)";

export const STATEMENT_TIMEOUT =
	"select case when $1::text is null then set_config('statement_timeout', current_setting('quarry.statement_timeout'), true) else set_config('quarry.statement_timeout', current_setting('statement_timeout'), true) || set_config('statement_timeout', $1, true) end";

/** A statement cached on a connection. */
export interface Statement {
	/** The server-side name; '' for SQL only ever sent unnamed, whose columns are still cached. */
	readonly name: string;
	/** Its key in the connection's cache: the SQL, or with other types than the SQL's first statement, types and SQL. */
	readonly key: string;
	readonly sql: string;
	/** The declared parameter types (OIDs; 0 for none). */
	readonly types: readonly number[];
	/** When the statement was last looked up, on the connection's counter: the cache evicts the lowest. */
	used: number;
	/** How often its SQL was parsed unnamed (ParseComplete), towards the connection's `prepareThreshold`. */
	seen: number;
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
	 * its Parse is written). With `named`, one run often enough
	 * (`prepareThreshold`) has a name, to be parsed, replacing its unnamed
	 * entry; until then, and without `named`, it is unnamed (name '').
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
	/** Set once a message for it arrived: the server read all of it and is running it. */
	answered = false;
	/**
	 * Whether later operations must wait until this one completes (it keeps
	 * talking after being written); read once it is written.
	 */
	exclusive = false;
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

	/**
	 * Stops a written operation the server isn't running, without a cancel
	 * request: true when it did. Otherwise the connection asks the server to
	 * cancel it.
	 */
	interrupt(_reason: 'abort' | 'timeout', _cause: unknown): boolean {
		return false;
	}

	/** How many statements it writes that may be named; more than one is pipelining. */
	get prepares(): number {
		return 0;
	}

	/** The server's error for it, once one arrived. */
	get failure(): Error | undefined {
		return undefined;
	}

	/** Whether it surely leaves no transaction block open behind it (see `opensNoBlock`). */
	get opensNoBlock(): boolean {
		return false;
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

/**
 * Tags parsed lately: a transaction alternates BEGIN, its statements and
 * COMMIT, which a cache of the last tag alone would parse every time.
 */
const parsedTags = new Map<string, ParsedTag>();

export function parseTag(tag: string): ParsedTag {
	let parsed = parsedTags.get(tag);
	if (parsed !== undefined) return parsed;
	const space = tag.lastIndexOf(' ');
	let digits = space > 0 && space < tag.length - 1;
	for (let i = space + 1; digits && i < tag.length; i++) {
		const code = tag.charCodeAt(i);
		digits = code >= 0x30 && code <= 0x39;
	}
	parsed = digits
		? {
				command: tag.slice(0, tag.indexOf(' ')),
				rowCount: Number(tag.slice(space + 1)),
			}
		: { command: tag, rowCount: null };
	// row counts make many distinct tags: start over rather than grow
	if (parsedTags.size >= 64) parsedTags.clear();
	parsedTags.set(tag, parsed);
	return parsed;
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
	/** Columns read into objects of the row. */
	readonly nested: readonly NestedObject[] | undefined;
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
	requested: readonly number[] | 0 | undefined,
): ResultPlan {
	if (statement === undefined)
		return resultPlan(fields, spec, requested ?? 'fields');
	const plan = cachedPlan(statement.plans, fields, spec);
	if (requested === undefined) return plan;
	return sameFormats(plan.formats, requested)
		? plan
		: resultPlan(fields, spec, requested);
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
	/**
	 * The query's options as given, when it may run again on another
	 * connection if it provably never ran on its own (see `Connection.rerun`).
	 */
	rerunOptions: QueryOptions | null | undefined;
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

	get sql(): string {
		return this.#sql;
	}

	get params(): readonly unknown[] {
		return this.#params;
	}

	/** Settles with what `run` settles with instead: the query never ran here. */
	redirect(
		run: (
			resolve: (result: QueryResult<unknown>) => void,
			reject: (error: Error) => void,
		) => void,
	): void {
		this.settle();
		run(this.#resolve, this.#reject);
	}

	/** The server's error for this statement, once it arrived. */
	get error(): PostgresError | undefined {
		return this.#error;
	}

	override get failure(): Error | undefined {
		return this.#error;
	}

	override get opensNoBlock(): boolean {
		return !opensTransactionBlock(this.#sql);
	}

	/** Writes the statement; without `sync` it ends with the next one's Sync (see `SyncGroupOp`). */
	write(ctx: OpContext, sync = true): void {
		const w = ctx.writer;
		const spec = specOf(this.#options, ctx);
		this.#spec = spec;
		const types = this.#paramTypes;
		if (this.#options.prepare && ctx.preparable(this.#sql, types)) {
			const statement = ctx.statement(this.#sql, types, ctx.named());
			this.#statement = statement;
			if (statement.name === '') {
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
				? planDecoder(plan, this.#options.rowMode, this.#options.nested)
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
			decoder = planDecoder(
				this.#current!,
				this.#options.rowMode,
				this.#options.nested,
			);
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
				if (this.#statement === undefined) return false;
				if (this.#createdStatement) this.#statement.parsed = true;
				// its SQL parsed, run unnamed: one more run towards preparing it
				else if (this.#unnamed) this.#statement.seen++;
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

	override get failure(): Error | undefined {
		return this.#failed ? this.#ops[this.#current]?.error : undefined;
	}

	override get opensNoBlock(): boolean {
		for (const op of this.#ops) if (!op.opensNoBlock) return false;
		return true;
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

/** A batch of a cursor's rows, and whether its portal may have more. */
export interface CursorBatch {
	readonly rows: unknown[];
	readonly more: boolean;
}

/** Why an aborted cursor stopped: its `AbortSignal`, or its client-side timeout. */
export function cursorAborted(
	reason: 'abort' | 'timeout',
	cause: unknown,
): AbortError {
	return new AbortError(
		reason === 'timeout' ? 'The cursor timed out' : 'The cursor was aborted',
		cause === undefined ? undefined : { cause },
	);
}

/**
 * Opens a portal and reads its rows in batches of `batchSize`, each one
 * fetched only when `next` asks for it.
 *
 * The columns are known before Bind, so each comes in the format its codec
 * reads (binary where it can): from the cached statement, or else from a
 * Describe of the statement first, one more round trip per statement and
 * connection.
 *
 * - Not `held` (outside a transaction): the portal lives in the implicit
 *   transaction of one Sync, so the operation is exclusive until it ends:
 *   Execute + Flush per batch, then Close + Sync.
 * - `held` (inside a transaction, where a named portal outlives Sync): the
 *   first batch's Execute ends with Sync, and the operation is done once
 *   that batch is read; `FetchOp` reads the next ones, so other queries
 *   run between batches. Exclusive only while it describes the statement.
 *
 * With a `statementTimeout` (not held), `STATEMENT_TIMEOUT` sets it before
 * the portal and restores it before the Sync: outside a transaction block
 * the implicit transaction ends the setting anyway, inside one the restore
 * does. The Sync (with Close and the restore) then waits until nothing the
 * portal asked for is unanswered, so the restore's answers come last.
 */
export class CursorOp extends Op {
	readonly #sql: string;
	readonly #params: readonly unknown[];
	readonly #values: readonly WireValue[];
	readonly #paramTypes: readonly number[];
	#options: QueryOpOptions;
	readonly #batchSize: number;
	readonly #portal: string;
	readonly #held: boolean;
	/** Fetch the next batch as soon as one is handed out, rather than when it is asked for. */
	readonly #readAhead: boolean;
	/** The `statement_timeout` for the portal, as an interval. */
	readonly #statementTimeout: string | undefined;
	/** The setting statement is unanswered: its answers come before the portal's. */
	#setting = false;
	/** The restore was written: the rest before ReadyForQuery is its answers. */
	#restoring = false;
	/** The server failed a statement, so it skips the rest until Sync, the restore included. */
	#serverFailed = false;
	/** Parts of the portal unanswered: the Describe of its statement, and each Execute. */
	#unanswered = 0;
	/** A Sync waiting for them, with the restore; whether to close the portal first. */
	#deferred: boolean | undefined;
	#ctx: OpContext | undefined;
	#spec: ResultSpec | undefined;
	#statement: Statement | undefined;
	/** The name the statement was parsed (or found) under: '' for the unnamed one. */
	#name = '';
	#created = false;
	/** Bound unnamed with its cached statement's columns, which the portal's description must match. */
	#expected: readonly Field[] | undefined;
	#decoder: RowDecoder | undefined;
	#phase: 'describing' | 'fetching' | 'suspended' | 'ended' = 'fetching';
	#batch: unknown[] = [];
	/** Batches read and not yet taken. */
	readonly #unread: unknown[][] = [];
	readonly #waiters: Waiter<unknown[] | undefined>[] = [];
	/** Batches read so far: a stale statement is retried only before the first. */
	#batches = 0;
	#more = true;
	#synced = false;
	/** Rows still to come are dropped: the portal is being closed, or failed. */
	#discarding = false;
	#closing = false;
	/** Aborted while the server ran a batch: the cursor fails with it if the batch completes anyway. */
	#interrupted: Error | undefined;
	#error: Error | undefined;
	/** Whether a consumer was handed the error: `next` then reports the end. */
	#reported = false;
	#retried = false;
	#finished = false;
	readonly #finishWaiters: (() => void)[] = [];

	constructor(
		sql: string,
		params: readonly unknown[],
		values: readonly WireValue[],
		paramTypes: readonly number[],
		options: QueryOpOptions,
		batchSize: number,
		portal: string,
		held: boolean,
		statementTimeout?: string,
		readAhead = false,
	) {
		super();
		this.#sql = sql;
		this.#params = params;
		this.#values = values;
		this.#paramTypes = paramTypes;
		this.#options = options;
		this.#batchSize = batchSize;
		this.#portal = portal;
		this.#held = held;
		this.#readAhead = readAhead && !held;
		this.#statementTimeout = held ? undefined : statementTimeout;
		this.exclusive = true;
	}

	override get prepares(): number {
		return this.#options.prepare ? 1 : 0;
	}

	/** Whether the portal may have more rows than the batches read. */
	get more(): boolean {
		return this.#more;
	}

	/** How the portal's rows are decoded, once its columns are known: for the `FetchOp`s of a held cursor. */
	get decoder(): RowDecoder | undefined {
		return this.#decoder;
	}

	write(ctx: OpContext): void {
		this.#ctx = ctx;
		if (this.#discarding) {
			// closed before it was written: nothing to open
			fe.sync(ctx.writer);
			this.#synced = true;
			this.#phase = 'ended';
			return;
		}
		this.#setTimeout(ctx.writer);
		this.#open(ctx);
		this.exclusive = !this.#held || this.#phase === 'describing';
	}

	/** Writes the statement setting the timeout, unnamed: it shares the portal's implicit transaction. */
	#setTimeout(w: Writer): void {
		const timeout = this.#statementTimeout;
		if (timeout === undefined) return;
		fe.parse(w, '', STATEMENT_TIMEOUT, [25]);
		fe.bind(w, '', '', [timeout]);
		fe.execute(w, '', 0);
		this.#setting = true;
	}

	#open(ctx: OpContext): void {
		const w = ctx.writer;
		this.#spec = specOf(this.#options, ctx);
		const types = this.#paramTypes;
		if (!this.#options.prepare || !ctx.preparable(this.#sql, types)) {
			fe.parse(w, '', this.#sql, types);
			this.#describe(w);
			return;
		}
		const statement = ctx.statement(this.#sql, types, ctx.named());
		this.#statement = statement;
		if (statement.name === '') {
			// not prepared (yet), or behind a pooler that rewrites named statements: parsed unnamed, with the cached columns
			fe.parse(w, '', this.#sql, types);
			if (statement.fields === undefined) this.#describe(w);
			else this.#bind(w, statement.fields, true);
			return;
		}
		this.#name = statement.name;
		const created = statement.unwritten;
		statement.unwritten = false;
		this.#created = created;
		if (created) fe.parse(w, statement.name, this.#sql, types);
		if (created || statement.fields === undefined) this.#describe(w);
		else this.#bind(w, statement.fields);
	}

	#describe(w: Writer): void {
		fe.describe(w, 'S', this.#name);
		fe.flush(w);
		this.#phase = 'describing';
		this.#unanswered++;
	}

	/** Binds the portal with each column in the format its codec reads, and fetches the first batch. */
	#bind(w: Writer, fields: readonly Field[], verify = false): void {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- set by #open
		const spec = this.#spec!;
		const plan =
			this.#statement === undefined
				? resultPlan(fields, spec)
				: cachedPlan(this.#statement.plans, fields, spec);
		fe.bind(w, this.#portal, this.#name, this.#values, plan.formats);
		if (verify) {
			fe.describe(w, 'P', this.#portal);
			this.#expected = plan.fields;
		}
		this.#execute(w);
		this.#use(plan);
	}

	#execute(w: Writer): void {
		this.#unanswered++;
		fe.execute(w, this.#portal, this.#batchSize);
		if (this.#held) {
			fe.sync(w);
			this.#synced = true;
		} else {
			fe.flush(w);
		}
		this.#phase = 'fetching';
	}

	#use(plan: ResultPlan): void {
		if (plan.unreadable !== undefined) {
			this.#fail(
				new DecodeError(
					plan.unreadable.name,
					plan.unreadable.typeOid,
					new DriverError(
						'The column is not of the type the query expected, and came in binary',
					),
				),
			);
			return;
		}
		this.#decoder = planDecoder(
			plan,
			this.#options.rowMode,
			this.#options.nested,
		);
	}

	/**
	 * The statement's columns, before Bind; or, for an unnamed statement
	 * bound with its cached columns, the portal's, which must be those.
	 */
	#described(fields: readonly Field[], ctx: OpContext): void {
		const statement = this.#statement;
		if (this.#phase !== 'describing') {
			const expected = this.#expected;
			if (expected === undefined || sameColumns(fields, expected)) return;
			// the schema changed since the columns were cached: read what came
			if (statement !== undefined) ctx.forget(statement);
			// oxlint-disable-next-line typescript/no-non-null-assertion -- set by #open
			this.#use(resultPlan(fields, this.#spec!, 'fields'));
			return;
		}
		if (statement !== undefined) {
			if (this.#created) statement.fields = fields;
			else statement.fields ??= fields;
		}
		if (this.#discarding) {
			// closed or aborted while describing: nothing was bound
			this.#sync(false);
			return;
		}
		const w = ctx.writer;
		this.#bind(w, statement?.fields ?? fields);
		ctx.send(w.take());
	}

	/** Fails with a value it can't read: the rows still to come are dropped, and the portal closed. */
	#fail(error: Error): void {
		this.#error ??= error;
		this.#batch = [];
		this.#discarding = true;
		this.#sync(true);
	}

	#endBatch(more: boolean): void {
		const rows = this.#batch;
		this.#batch = [];
		if (this.#discarding) return;
		if (this.#interrupted !== undefined) {
			this.#fail(this.#interrupted);
			return;
		}
		this.#more = more;
		this.#batches++;
		if (this.#held) {
			// handed over with ReadyForQuery, once the connection is free of it
			this.#unread.push(rows);
			this.#phase = 'ended';
			return;
		}
		if (more) {
			this.#phase = 'suspended';
		} else {
			this.#phase = 'ended';
			this.#sync(false);
		}
		// a portal whose size is a multiple of the batch size ends with an empty batch
		if (more || rows.length > 0) this.#unread.push(rows);
		this.#pump();
	}

	#fetch(): void {
		const ctx = this.#ctx;
		if (ctx === undefined) return;
		const w = ctx.writer;
		this.#execute(w);
		ctx.send(w.take());
	}

	#sync(closePortal: boolean): void {
		if (this.#synced || this.#ctx === undefined) return;
		const restore = this.#statementTimeout !== undefined && !this.#serverFailed;
		if (restore && (this.#setting || this.#unanswered > 0)) {
			// the server finishes a running batch anyway: nothing is lost by waiting
			this.#deferred = this.#deferred === true || closePortal;
			return;
		}
		this.#synced = true;
		const w = this.#ctx.writer;
		if (closePortal) fe.close(w, 'P', this.#portal);
		if (restore) {
			fe.parse(w, '', STATEMENT_TIMEOUT, [25]);
			fe.bind(w, '', '', [null]);
			fe.execute(w, '', 0);
			this.#restoring = true;
		}
		fe.sync(w);
		this.#ctx.send(w.take());
	}

	/** Writes a Sync that waited for the portal's answers, once they all came. */
	#syncDeferred(): void {
		const closePortal = this.#deferred;
		if (closePortal === undefined || this.#setting || this.#unanswered > 0)
			return;
		this.#deferred = undefined;
		this.#sync(closePortal);
	}

	/**
	 * Hands batches to waiting consumers, fetching one when they wait for
	 * it, or with `readAhead`, as soon as none is left unread.
	 */
	#pump(): void {
		this.#handOut();
		if (
			this.#readAhead &&
			this.#unread.length === 0 &&
			this.#phase === 'suspended' &&
			!this.#discarding &&
			!this.#finished
		)
			this.#fetch();
	}

	#handOut(): void {
		while (this.#waiters.length > 0) {
			const batch = this.#unread.shift();
			// oxlint-disable-next-line typescript/no-non-null-assertion -- the loop checks there is one
			if (batch !== undefined) this.#waiters.shift()!.resolve(batch);
			else if (!this.#finished) {
				if (this.#phase === 'suspended' && !this.#discarding) this.#fetch();
				return;
			} else {
				// oxlint-disable-next-line typescript/no-non-null-assertion -- the loop checks there is one
				const waiter = this.#waiters.shift()!;
				if (this.#error !== undefined && !this.#reported) {
					this.#reported = true;
					waiter.reject(this.#error);
				} else {
					waiter.resolve(undefined);
				}
			}
		}
	}

	/** The next batch of rows, or undefined once there are none. */
	next(): Promise<unknown[] | undefined> {
		return new Promise((resolve, reject) => {
			this.#waiters.push({ resolve, reject });
			this.#pump();
		});
	}

	/** Stops early: closes the portal and waits until the connection is free of it. */
	async close(): Promise<void> {
		if (this.#finished) return;
		this.#closing = true;
		this.#unread.length = 0;
		this.#batch = [];
		this.#discarding = true;
		this.#sync(this.#phase !== 'describing');
		await new Promise<void>((resolve) => this.#finishWaiters.push(resolve));
	}

	override interrupt(reason: 'abort' | 'timeout', cause: unknown): boolean {
		if (this.#finished) return true;
		const error = cursorAborted(reason, cause);
		this.#unread.length = 0;
		if (this.#phase === 'fetching' && !this.#discarding) {
			// the server is running a batch: cancel it
			this.#interrupted = error;
			return false;
		}
		this.#error ??= error;
		this.#batch = [];
		this.#discarding = true;
		this.#sync(this.#phase === 'suspended');
		this.#pump();
		return true;
	}

	override dataRow(bytes: Uint8Array, start: number, end: number): boolean {
		// the setting's and the restore's rows, or rows dropped
		if (this.#discarding || this.#setting || this.#restoring) return true;
		const decoder = this.#decoder;
		if (decoder === undefined)
			throw new ProtocolError('DataRow before RowDescription');
		try {
			this.#batch.push(decoder(bytes, start, end));
		} catch (error) {
			if (!(error instanceof DecodeError)) throw error;
			this.#fail(error);
		}
		return true;
	}

	handle(msg: BackendMessage, ctx: OpContext): boolean {
		switch (msg.type) {
			case 'DataRow':
				return !this.dataRow(msg.payload, 0, msg.payload.length);
			case 'ParseComplete':
				if (this.#setting || this.#restoring) return false;
				if (this.#statement && this.#created) this.#statement.parsed = true;
				else if (this.#statement?.name === '') this.#statement.seen++;
				return false;
			case 'ParameterDescription':
			case 'BindComplete':
			case 'CloseComplete':
				return false;
			case 'RowDescription':
				if (this.#phase === 'describing') this.#unanswered--;
				this.#described(msg.fields, ctx);
				this.#syncDeferred();
				return false;
			case 'NoData':
				if (this.#phase === 'describing') this.#unanswered--;
				this.#described([], ctx);
				this.#syncDeferred();
				return false;
			case 'PortalSuspended':
				this.#unanswered--;
				this.#endBatch(true);
				this.#syncDeferred();
				return false;
			case 'CommandComplete':
			case 'EmptyQueryResponse':
				if (this.#restoring) return false;
				if (this.#setting) this.#setting = false;
				else {
					this.#unanswered--;
					this.#endBatch(false);
				}
				this.#syncDeferred();
				return false;
			case 'ErrorResponse': {
				const error = postgresError(msg.fields, {
					sql: this.#sql,
					params: this.#params,
				});
				this.#serverFailed = true;
				if (this.#restoring) this.#error ??= this.classify(error);
				else if (this.#setting) this.#onSettingError(error, ctx);
				else this.#onError(error, ctx);
				return false;
			}
			case 'ReadyForQuery':
				return this.#onReady(msg.status, ctx);
			default:
				return this.unexpected(msg);
		}
	}

	/** The timeout couldn't be set (an invalid interval): the server skipped the portal, whose Parse never ran. */
	#onSettingError(error: PostgresError, ctx: OpContext): void {
		this.#setting = false;
		const statement = this.#statement;
		if (statement && this.#created && !statement.parsed) ctx.forget(statement);
		this.#error ??= error;
		this.#batch = [];
		this.#discarding = true;
		this.#sync(false);
	}

	#onError(error: PostgresError, ctx: OpContext): void {
		const statement = this.#statement;
		if (statement && this.#created && !statement.parsed) {
			statement.error = error;
			ctx.forget(statement);
		} else if (
			statement &&
			!this.#created &&
			statement.error !== undefined &&
			error.code === '26000'
		) {
			// an earlier pipelined Parse of the same SQL failed; report its error
			error = postgresError(statement.error.fields, {
				sql: this.#sql,
				params: this.#params,
			});
		}
		this.#error ??= this.classify(error);
		this.#batch = [];
		this.#discarding = true;
		this.#sync(false);
	}

	#onReady(status: 'I' | 'T' | 'E', ctx: OpContext): boolean {
		const error = this.#error;
		const statement = this.#statement;
		if (
			error instanceof PostgresError &&
			statement !== undefined &&
			this.#name !== '' &&
			!this.#held &&
			!this.#retried &&
			!this.#closing &&
			this.#interrupted === undefined &&
			this.#batches === 0 &&
			status === 'I' &&
			staleStatement(error, statement, this.#created)
		) {
			this.#retry(statement, ctx);
			return false;
		}
		if (this.#held && error === undefined && this.#more && status !== 'T') {
			// the portal ended with the implicit transaction: there was no other
			this.#error = new DriverError(
				'The cursor was opened outside a transaction, and closed with its first batch',
			);
		}
		this.#finished = true;
		this.#phase = 'ended';
		this.settle();
		this.#pump();
		for (const resolve of this.#finishWaiters.splice(0)) resolve();
		return true;
	}

	/**
	 * Opens the portal again, unnamed, after its cached statement went
	 * stale: it is still the connection's operation, so nothing else ran.
	 */
	#retry(statement: Statement, ctx: OpContext): void {
		ctx.forget(statement);
		if (this.#created) ctx.unprepare(statement);
		this.#retried = true;
		this.#options = { ...this.#options, prepare: false };
		this.#statement = undefined;
		this.#name = '';
		this.#created = false;
		this.#expected = undefined;
		this.#decoder = undefined;
		this.#batch = [];
		this.#more = true;
		this.#synced = false;
		this.#discarding = false;
		this.#error = undefined;
		// the implicit transaction ended with the failure, and the setting with it
		this.#restoring = false;
		this.#serverFailed = false;
		this.#unanswered = 0;
		this.#deferred = undefined;
		this.#setTimeout(ctx.writer);
		this.#open(ctx);
		ctx.send(ctx.writer.take());
	}

	fail(error: Error): void {
		// closed before it was sent: it ends without an error
		if (!this.#closing) this.#error ??= error;
		this.#finished = true;
		this.#phase = 'ended';
		this.settle();
		this.#pump();
		for (const resolve of this.#finishWaiters.splice(0)) resolve();
	}
}

/** Reads the next batch of a held cursor's portal: Execute + Sync, inside its transaction. */
export class FetchOp extends Op {
	readonly #sql: string;
	readonly #params: readonly unknown[];
	readonly #portal: string;
	readonly #batchSize: number;
	readonly #decoder: RowDecoder | undefined;
	readonly #resolve: (batch: CursorBatch) => void;
	readonly #reject: (error: Error) => void;
	#rows: unknown[] = [];
	#more = false;
	#error: Error | undefined;

	constructor(
		sql: string,
		params: readonly unknown[],
		portal: string,
		batchSize: number,
		decoder: RowDecoder | undefined,
		resolve: (batch: CursorBatch) => void,
		reject: (error: Error) => void,
	) {
		super();
		this.#sql = sql;
		this.#params = params;
		this.#portal = portal;
		this.#batchSize = batchSize;
		this.#decoder = decoder;
		this.#resolve = resolve;
		this.#reject = reject;
	}

	write(ctx: OpContext): void {
		fe.execute(ctx.writer, this.#portal, this.#batchSize);
		fe.sync(ctx.writer);
	}

	override dataRow(bytes: Uint8Array, start: number, end: number): boolean {
		if (this.#error !== undefined) return true;
		const decoder = this.#decoder;
		if (decoder === undefined)
			throw new ProtocolError('DataRow before RowDescription');
		try {
			this.#rows.push(decoder(bytes, start, end));
		} catch (error) {
			if (!(error instanceof DecodeError)) throw error;
			this.#error = error;
			this.#rows = [];
		}
		return true;
	}

	handle(msg: BackendMessage): boolean {
		switch (msg.type) {
			case 'DataRow':
				return !this.dataRow(msg.payload, 0, msg.payload.length);
			case 'PortalSuspended':
				this.#more = true;
				return false;
			case 'CommandComplete':
			case 'EmptyQueryResponse':
				return false;
			case 'ErrorResponse':
				this.#error ??= this.classify(
					postgresError(msg.fields, { sql: this.#sql, params: this.#params }),
				);
				this.#rows = [];
				return false;
			case 'ReadyForQuery':
				this.settle();
				if (this.#error !== undefined) this.#reject(this.#error);
				else if (this.#more && msg.status !== 'T')
					this.#reject(
						new DriverError('The cursor’s transaction ended while it was open'),
					);
				else this.#resolve({ rows: this.#rows, more: this.#more });
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

/**
 * Closes a held cursor's portal: Close + Sync. Its outcome is ignored: the
 * transaction may have ended already, and the portal with it.
 */
export class ClosePortalOp extends Op {
	readonly #portal: string;

	constructor(portal: string) {
		super();
		this.#portal = portal;
	}

	write(ctx: OpContext): void {
		fe.close(ctx.writer, 'P', this.#portal);
		fe.sync(ctx.writer);
	}

	handle(msg: BackendMessage): boolean {
		if (msg.type !== 'ReadyForQuery') return false;
		this.settle();
		return true;
	}

	fail(): void {
		this.settle();
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

/**
 * COPY … TO STDOUT, read as chunks with backpressure. Each CopyData (a
 * row, in text format) is kept as a view of the read buffer until `next`
 * takes it, and `next` copies every one received by then into one chunk:
 * one allocation per read rather than per row, and no view keeps a read
 * buffer alive.
 */
export class CopyToOp extends Op {
	override readonly exclusive = true;
	readonly #sql: string;
	readonly #highWaterMark: number;
	#ctx: OpContext | undefined;
	readonly #chunks: Uint8Array[] = [];
	#buffered = 0;
	/** Rows copied, from the command tag. */
	rowCount = 0;
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
		const chunks = this.#chunks;
		if (chunks.length > 0) {
			this.#waiter = undefined;
			// a copy: the views are of the read buffer (Buffer#slice would be a view too)
			const chunk = allocate(this.#buffered);
			let at = 0;
			for (const part of chunks) {
				chunk.set(part, at);
				at += part.length;
			}
			chunks.length = 0;
			this.#buffered = 0;
			if (this.#paused) {
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
				const chunk = msg.data;
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
				this.rowCount = parseTag(msg.tag).rowCount ?? 0;
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
