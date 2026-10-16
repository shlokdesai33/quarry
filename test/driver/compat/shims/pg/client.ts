// A pg-like Client over quarry's Connection, for running node-postgres's
// tests against quarry's driver. It maps pg's API (callbacks, events,
// config names, result and error shapes) onto the driver and nothing more:
// queries, decoding, errors and timing come from quarry.
import { EventEmitter } from 'node:events';
import {
	AbortError,
	connect,
	ConnectionError,
	PostgresError,
	QueryCanceled,
	quoteIdentifier,
	resolveConfig,
	type Connection,
	type ConnectionOptions,
	type Field,
	type Notice,
	type Notification,
	type QueryResult,
	type SslOptions,
} from '../../../../../src/driver/index.js';
import { defaults } from './defaults.js';
import { codecsFor, pgTypes, TypeOverrides, type TypeSource } from './types.js';

type Callback = (error: Error | null | undefined, result?: any) => void;

/** pg-protocol's DatabaseError: every field as a string, as pg reports them. */
export class DatabaseError extends Error {
	length: number;
	severity: string | undefined;
	code: string | undefined;
	detail: string | undefined;
	hint: string | undefined;
	position: string | undefined;
	internalPosition: string | undefined;
	internalQuery: string | undefined;
	where: string | undefined;
	schema: string | undefined;
	table: string | undefined;
	column: string | undefined;
	dataType: string | undefined;
	constraint: string | undefined;
	file: string | undefined;
	line: string | undefined;
	routine: string | undefined;

	constructor(message: string, length = 0, name = 'error') {
		super(message);
		this.length = length;
		this.name = name;
		this.severity = undefined;
		this.code = undefined;
		this.detail = undefined;
		this.hint = undefined;
		this.position = undefined;
		this.internalPosition = undefined;
		this.internalQuery = undefined;
		this.where = undefined;
		this.schema = undefined;
		this.table = undefined;
		this.column = undefined;
		this.dataType = undefined;
		this.constraint = undefined;
		this.file = undefined;
		this.line = undefined;
		this.routine = undefined;
	}
}

/** Copies the protocol fields (`S`, `C`, `M`, …) onto a pg-shaped message. */
function assignFields(target: any, fields: Readonly<Record<string, string>>) {
	target.severity = fields['S'];
	target.code = fields['C'];
	target.detail = fields['D'];
	target.hint = fields['H'];
	target.position = fields['P'];
	target.internalPosition = fields['p'];
	target.internalQuery = fields['q'];
	target.where = fields['W'];
	target.schema = fields['s'];
	target.table = fields['t'];
	target.column = fields['c'];
	target.dataType = fields['d'];
	target.constraint = fields['n'];
	target.file = fields['F'];
	target.line = fields['L'];
	target.routine = fields['R'];
	return target;
}

/**
 * Calls a user callback from a promise reaction the way pg calls it from an
 * event: an exception it throws is uncaught rather than a rejected promise.
 */
export function callback(
	fn: (...args: any[]) => unknown,
	...args: any[]
): void {
	try {
		fn(...args);
	} catch (error) {
		process.nextTick(() => {
			throw error;
		});
	}
}

/** quarry's errors in pg's shape: server errors become DatabaseErrors, the rest pass through. */
export function toPgError(error: unknown): Error {
	// pg's query_timeout reports this message (quarry cancels the query on the server)
	if (
		(error instanceof QueryCanceled && error.reason === 'timeout') ||
		(error instanceof AbortError && error.message.includes('timed out'))
	)
		return new Error('Query read timeout', { cause: error });
	if (error instanceof PostgresError) {
		const converted = assignFields(
			new DatabaseError(error.message, 0, 'error'),
			error.fields,
		);
		converted.cause = error;
		// quarry's stack, with the caller's appended (captureStack)
		if (error.stack)
			converted.stack = error.stack.replace(/^\w*Error/, 'error');
		return converted;
	}
	return error instanceof Error ? error : new Error(String(error));
}

export function toPgNotice(notice: Notice): any {
	const message: any = { name: 'notice', length: 0, message: notice.message };
	return assignFields(message, notice.fields);
}

export function toPgNotification(n: Notification): any {
	return {
		name: 'notification',
		length: 0,
		processId: n.pid,
		channel: n.channel,
		payload: n.payload,
	};
}

export function toPgField(field: Field): any {
	return {
		name: field.name,
		tableID: field.tableOid,
		columnID: field.columnId,
		dataTypeID: field.typeOid,
		dataTypeSize: field.typeSize,
		dataTypeModifier: field.typeModifier,
		format: field.format === 1 ? 'binary' : 'text',
	};
}

const TAG = /^([A-Za-z]+)(?: (\d+))?(?: (\d+))?/;

/** pg's Result: `command` is the tag's first word, `oid` is set for INSERT. */
export class Result {
	command: string | null = null;
	rowCount: number | null = null;
	oid: number | null = null;
	rows: any[] = [];
	fields: any[] = [];
	rowAsArray: boolean;
	_types: TypeSource | undefined;
	_parsers: unknown[] | undefined;
	RowCtor = null;

	constructor(rowMode?: string, types?: TypeSource) {
		this.rowAsArray = rowMode === 'array';
		this._types = types;
	}

	static from(result: QueryResult<any>, rowMode: string | undefined): Result {
		const out = new Result(rowMode);
		const match = TAG.exec(result.command);
		out.command = match?.[1] ?? (result.command || null);
		out.rowCount = result.rowCount;
		if (out.command === 'INSERT') out.oid = 0;
		out.rows = result.rows;
		out.fields = result.fields.map(toPgField);
		return out;
	}

	addRow(row: unknown): void {
		this.rows.push(row);
	}
}

/** pg's `toPostgres` protocol: custom objects encode themselves. Everything else is left to quarry. */
export function prepareValue(value: unknown, seen: unknown[] = []): unknown {
	if (value !== null && typeof value === 'object') {
		const custom = (value as { toPostgres?: unknown }).toPostgres;
		if (typeof custom === 'function') {
			if (seen.includes(value))
				throw new Error(
					`circular reference detected while preparing "${String(value)}" for query`,
				);
			return prepareValue(
				custom.call(value, (v: unknown) => prepareValue(v)),
				[...seen, value],
			);
		}
		if (Array.isArray(value)) return value.map((v) => prepareValue(v, seen));
	}
	return value;
}

export interface QueryConfig {
	text?: string;
	values?: unknown;
	name?: string;
	rowMode?: string;
	types?: TypeSource;
	rows?: number;
	queryMode?: string;
	binary?: boolean;
	portal?: string;
	callback?: Callback;
	query_timeout?: number;
}

function normalize(config: any, values: any, cb: any): QueryConfig {
	const out: QueryConfig =
		typeof config === 'string' ? { text: config } : { ...config };
	if (values !== undefined) {
		if (typeof values === 'function') out.callback = values;
		else out.values = values;
	}
	if (cb) out.callback = cb;
	return out;
}

/** pg's Query: an EventEmitter (`row`, `end`, `error`) that can also take a callback. */
export class Query extends EventEmitter {
	text: string | undefined;
	values: unknown;
	rows: number | undefined;
	types: TypeSource | undefined;
	name: string | undefined;
	queryMode: string | undefined;
	binary: boolean | undefined;
	portal: string;
	callback: Callback | undefined;
	query_timeout: number | undefined;
	_rowMode: string | undefined;
	_result: Result;

	constructor(config?: any, values?: any, cb?: any) {
		super();
		const c = normalize(config ?? {}, values, cb);
		this.text = c.text;
		this.values = c.values;
		this.rows = c.rows;
		this.types = c.types;
		this.name = c.name;
		this.queryMode = c.queryMode;
		this.binary = c.binary;
		this.portal = c.portal ?? '';
		this.callback = c.callback;
		this.query_timeout = c.query_timeout;
		this._rowMode = c.rowMode;
		this._result = new Result(c.rowMode, c.types);
	}

	/** Marks this as submittable, so `client.query(new Query(…))` returns it. */
	submit(): void {}

	requiresPreparation(): boolean {
		if (this.queryMode === 'extended' || this.name || this.rows) return true;
		if (!this.text || !this.values) return false;
		return (this.values as unknown[]).length > 0;
	}

	handleResults(results: Result[]): void {
		for (const result of results) {
			this._result = result;
			for (const row of result.rows) this.emit('row', row, result);
		}
		const value = results.length === 1 ? results[0] : results;
		if (this.callback) {
			try {
				this.callback(null, value);
			} catch (error) {
				process.nextTick(() => {
					throw error;
				});
			}
		}
		this.emit('end', value);
	}

	handleError(error: Error): void {
		if (this.callback) {
			callback(this.callback, error);
			return;
		}
		this.emit('error', error);
	}
}

/**
 * What the shim passes to a submittable's `submit()` in place of pg's
 * Connection: the shim's Cursor runs on it (pg-query-stream's QueryStream
 * hands it to its Cursor). Submittables that drive pg's Connection
 * themselves (pg-copy-streams) are not supported.
 */
export class Submission {
	readonly connection: Connection;
	readonly client: Client;
	/** Tells the client the submittable is finished (for its `drain` event). */
	readonly done: () => void;

	constructor(connection: Connection, client: Client, done: () => void) {
		this.connection = connection;
		this.client = client;
		this.done = done;
	}
}

interface Submittable {
	submit(submission: Submission): void;
	handleError?(error: Error, connection?: unknown): void;
	callback?: Callback;
}

/** pg's client options, mapped to quarry's connection options. */
export function connectionOptions(config: any): ConnectionOptions {
	const c: any = { ...config };
	const params: Record<string, string> = {};
	for (const key of [
		'statement_timeout',
		'lock_timeout',
		'idle_in_transaction_session_timeout',
	]) {
		const value = c[key] ?? (defaults as any)[key];
		if (value) params[key] = String(Number.parseInt(String(value), 10));
	}
	// pg's order: the option, then the connection string, then PG* variables, then pg.defaults
	const val = (key: string, env: string) =>
		c[key] ??
		(c.connectionString || process.env[env] !== undefined
			? undefined
			: (defaults[key] ?? undefined));
	const options: Record<string, unknown> = {
		connectionString: c.connectionString,
		host: val('host', 'PGHOST'),
		port: val('port', 'PGPORT'),
		user: val('user', 'PGUSER'),
		password: val('password', 'PGPASSWORD'),
		database: val('database', 'PGDATABASE'),
		applicationName: c.application_name ?? c.fallback_application_name,
		ssl: sslOptions(
			c.ssl ?? defaults.ssl,
			c.connectionString,
			c.sslnegotiation,
		),
		connectTimeout: c.connectionTimeoutMillis ?? 0,
		keepAlive: c.keepAlive,
		keepAliveInitialDelay: c.keepAliveInitialDelayMillis,
		options: c.options,
		params,
		// pg's errors carry the caller's async stack; quarry appends it on request
		captureStack: true,
	};
	for (const key of Object.keys(options))
		if (options[key] === undefined || options[key] === null)
			delete options[key];
	return options as ConnectionOptions;
}

function sslOptions(
	ssl: any,
	connectionString: string | undefined,
	negotiation: string | undefined,
): ConnectionOptions['ssl'] {
	if (ssl === undefined || ssl === false) {
		// pg doesn't use TLS unless asked; libpq's env and URL settings still apply
		if (process.env['PGSSLMODE'] || connectionString?.includes('sslmode'))
			return undefined;
		return 'disable';
	}
	const options: any = ssl === true ? {} : ssl;
	if (typeof options === 'string') return options as SslOptions['mode'];
	// pg verifies the chain and host name unless rejectUnauthorized is false
	const out: Record<string, unknown> = {
		mode:
			ssl === true || options.rejectUnauthorized === false
				? 'require'
				: 'verify-full',
		ca: options.ca,
		cert: options.cert,
		key: options.key,
		passphrase: options.passphrase,
		negotiation: negotiation === 'direct' ? 'direct' : undefined,
	};
	for (const key of Object.keys(out))
		if (out[key] === undefined) delete out[key];
	return out as SslOptions;
}

/** What runs a Query: a quarry Connection or Pool. */
export interface QueryTarget {
	query: Connection['query'];
	simpleQuery: Connection['simpleQuery'];
	cursor: Connection['cursor'];
}

export interface ExecuteContext {
	/** Named statements seen on this client, as pg tracks them. */
	readonly named: Map<string, string> | undefined;
	readonly types: TypeSource;
	readonly timeout: number | undefined;
}

/**
 * Runs a pg Query on quarry: the extended protocol when pg would prepare
 * (parameters, a name, `rows`, `queryMode: 'extended'`), the simple
 * protocol otherwise, as pg does.
 */
export function execute(
	target: QueryTarget | undefined,
	query: Query,
	ctx: ExecuteContext,
	settled: () => void = () => {},
	convert: (error: unknown) => Error = toPgError,
): void {
	const done = (results: Result[] | undefined, error?: unknown) => {
		if (error === undefined && results) query.handleResults(results);
		else query.handleError(convert(error));
		settled();
	};
	if (target === undefined) {
		done(
			undefined,
			new Error(
				'Client has encountered a connection error and is not queryable',
			),
		);
		return;
	}
	if (typeof query.text !== 'string' && typeof query.name !== 'string') {
		done(
			undefined,
			new Error(
				'A query must have either text or a name. Supplying neither is unsupported.',
			),
		);
		return;
	}
	if (
		query.values !== undefined &&
		query.values !== null &&
		!Array.isArray(query.values)
	) {
		done(undefined, new Error('Query values must be an array'));
		return;
	}
	const name = query.name;
	// pg sends a missing text as the empty query
	let text = query.text === null && name ? '' : query.text;
	if (name && ctx.named) {
		const previous = ctx.named.get(name);
		if (text && previous !== undefined && previous !== text) {
			done(
				undefined,
				new Error(
					`Prepared statements must be unique - '${name}' was used for a different statement`,
				),
			);
			return;
		}
		text ??= previous;
	}
	if (text === undefined) {
		done(undefined, new Error(`Prepared statement "${name}" does not exist`));
		return;
	}
	const sql = text;
	const rowMode = query._rowMode === 'array' ? 'array' : 'object';
	const codecs = codecsFor(query.types ?? ctx.types);
	const timeout = query.query_timeout ?? ctx.timeout;
	const options: Record<string, unknown> = { rowMode, codecs };
	if (timeout) options['timeout'] = timeout;
	let values: unknown[];
	try {
		values = ((query.values as unknown[] | undefined) ?? []).map((v) =>
			prepareValue(v),
		);
	} catch (error) {
		process.nextTick(() => done(undefined, error));
		return;
	}
	// pg remembers a named statement once it is submitted, and forgets it if it fails
	if (name) ctx.named?.set(name, sql);
	const ok = (r: QueryResult<any>) => done([Result.from(r, query._rowMode)]);
	const fail = (error: unknown) => {
		if (name && ctx.named?.get(name) === sql) ctx.named.delete(name);
		done(undefined, error);
	};
	if (!query.requiresPreparation()) {
		target
			.simpleQuery(sql, options)
			.then(
				(results) =>
					done(
						results.length === 0
							? [new Result(query._rowMode)]
							: results.map((r) => Result.from(r, query._rowMode)),
					),
				fail,
			);
	} else if (query.rows) {
		portal(target, sql, values, options, query.rows).then(ok, fail);
	} else {
		target.query(sql, values, options).then(ok, fail);
	}
}

/** pg's `rows` option: the portal is read `rows` at a time; the result has every row. */
async function portal(
	target: QueryTarget,
	sql: string,
	values: unknown[],
	options: Record<string, unknown>,
	rows: number,
): Promise<QueryResult<any>> {
	const all: unknown[] = [];
	for await (const batch of target.cursor(sql, values, {
		...options,
		batchSize: rows,
	}))
		all.push(...batch);
	return { command: 'SELECT', rowCount: all.length, rows: all, fields: [] };
}

export const kConnection = Symbol('connection');
/** For pooled clients: how the pool wants unexpected closes reported. */
export const kOnClose = Symbol('onClose');

/** pg's Client, over a quarry Connection opened on `connect()` (or handed over by the pool). */
export class Client extends EventEmitter {
	static Query = Query;

	readonly connectionParameters: any;
	user: string | undefined;
	database: string | undefined;
	host: string | undefined;
	port: number | string | undefined;
	declare password: unknown;
	ssl: unknown;
	processID: number | null = null;
	secretKey: Uint8Array | null = null;
	readonly _types: TypeOverrides;
	readonly _Promise: PromiseConstructor;
	declare readonly _config: any;
	_connection: Connection | undefined;
	_connecting = false;
	_connected = false;
	_ending = false;
	_ended = false;
	_queryable = true;
	_hasExecuted = false;
	_pending = 0;
	readonly _waiting: (() => void)[] = [];
	readonly _named = new Map<string, string>();
	readonly _queryTimeout: number | undefined;

	constructor(config: any = {}) {
		super();
		const c =
			typeof config === 'string' ? { connectionString: config } : config;
		// secrets stay off enumerable properties, as pg keeps them
		Object.defineProperty(this, '_config', { value: c, enumerable: false });
		const { password: _password, ...visible } = c;
		this.connectionParameters = visible;
		Object.defineProperty(this.connectionParameters, 'password', {
			value: c.password,
			enumerable: false,
			writable: true,
		});
		// what quarry will connect with: libpq's resolution of options, URL and PG* variables
		let resolved: ReturnType<typeof resolveConfig> | undefined;
		try {
			resolved = resolveConfig(connectionOptions(c));
		} catch {
			resolved = undefined;
		}
		this.user = resolved?.user ?? c.user ?? defaults.user;
		this.database = resolved?.database ?? c.database ?? defaults.database;
		this.host = resolved?.hosts[0]?.host ?? c.host ?? defaults.host;
		this.port = resolved?.hosts[0]?.port ?? c.port ?? defaults.port;
		this.connectionParameters.user = this.user;
		this.connectionParameters.database = this.database;
		this.connectionParameters.host = this.host;
		this.connectionParameters.port = this.port;
		Object.defineProperty(this, 'password', {
			configurable: true,
			enumerable: false,
			writable: true,
			value: c.password ?? defaults.password,
		});
		this.ssl = c.ssl ?? false;
		if (c.ssl?.key) Object.defineProperty(c.ssl, 'key', { enumerable: false });
		this._Promise = c.Promise ?? Promise;
		this._types = new TypeOverrides(c.types);
		this._queryTimeout = c.query_timeout || defaults.query_timeout || undefined;
		const connection: Connection | undefined = c[kConnection];
		if (connection) this.#attach(connection);
	}

	#attach(connection: Connection): void {
		this._connection = connection;
		this._connected = true;
		this.processID = connection.processId;
		connection.onNotice((notice) => this.emit('notice', toPgNotice(notice)));
		connection.onNotification((n) =>
			this.emit('notification', toPgNotification(n)),
		);
		const onClose: ((error: Error) => void) | undefined =
			this._config[kOnClose];
		connection.onClose((error) => {
			this._queryable = false;
			this._ended = true;
			// quarry reports a close it initiated (end, idle timeout, lifetime) without
			// an error, and one destroyed deliberately (a failed connect hook) with
			// the generic "connection is closed"
			const deliberate =
				(error instanceof ConnectionError &&
					error.message === 'The connection is closed' &&
					error.cause === undefined) ||
				// the pool discards a connection released mid-transaction
				error?.message === 'Released with a transaction open';
			if (error && !deliberate && !this._ending) {
				const converted = toPgError(error);
				if (onClose) onClose(converted);
				else this.emit('error', converted);
			}
			process.nextTick(() => this.emit('end'));
		});
	}

	connect(cb?: Callback): Promise<this> | undefined {
		const promise: Promise<this> = new this._Promise((resolve, reject) => {
			this.#connect().then(resolve, reject);
		});
		if (cb) {
			promise.then(
				() => callback(cb, null, this),
				(error: Error) => callback(cb, error),
			);
			return undefined;
		}
		return promise;
	}

	async #connect(): Promise<this> {
		if (this._connecting || this._connected)
			throw new Error(
				'Client has already been connected. You cannot reuse a client.',
			);
		this._connecting = true;
		let connection: Connection;
		try {
			connection = await connect(connectionOptions(this._config));
		} catch (error) {
			this._connecting = false;
			this._queryable = false;
			// pg's message for a connect timeout (its tests match on it)
			const converted =
				error instanceof ConnectionError && error.code === 'ETIMEDOUT'
					? new Error(
							'Connection terminated due to connection timeout: timeout expired',
							{
								cause: error,
							},
						)
					: toPgError(error);
			for (const run of this._waiting.splice(0)) run();
			throw converted;
		} finally {
			this._connecting = false;
		}
		this.#attach(connection);
		for (const run of this._waiting.splice(0)) run();
		this.emit('connect');
		return this;
	}

	query(config: any, values?: any, cb?: any): any {
		if (config === null || config === undefined)
			throw new TypeError('Client was passed a null or undefined query');
		let query: Query;
		let result: any;
		if (config instanceof Query) {
			query = config;
			result = query;
			if (!query.callback) {
				if (typeof values === 'function') query.callback = values;
				else if (cb) query.callback = cb;
			}
		} else if (typeof config.submit === 'function') {
			const submittable: Submittable = config;
			if (!submittable.callback) {
				if (typeof values === 'function') submittable.callback = values;
				else if (cb) submittable.callback = cb;
			}
			this.#whenConnected(() => this.#submit(submittable));
			return config;
		} else {
			query = new Query(config, values, cb);
			if (!query.callback) {
				result = new this._Promise((resolve, reject) => {
					query.callback = (error, res) =>
						error ? reject(error) : resolve(res);
				});
			} else if (typeof query.callback !== 'function') {
				throw new TypeError('callback is not a function');
			}
		}
		if (!this._queryable) {
			process.nextTick(() =>
				query.handleError(
					new Error(
						this._ending
							? 'Client was closed and is not queryable'
							: 'Client has encountered a connection error and is not queryable',
					),
				),
			);
			return result;
		}
		if (this._ending) {
			process.nextTick(() =>
				query.handleError(new Error('Client was closed and is not queryable')),
			);
			return result;
		}
		this._pending++;
		this.#whenConnected(() => this.#run(query));
		return result;
	}

	#whenConnected(run: () => void): void {
		if (this._connection !== undefined) run();
		else this._waiting.push(run);
	}

	#settled(): void {
		this._pending--;
		if (this._pending === 0) process.nextTick(() => this.emit('drain'));
	}

	#submit(submittable: Submittable): void {
		const connection = this._connection;
		const fail = (error: Error) =>
			process.nextTick(() => submittable.handleError?.(error, undefined));
		if (connection === undefined || !this._queryable) {
			fail(
				new Error(
					this._ending
						? 'Client was closed and is not queryable'
						: 'Client has encountered a connection error and is not queryable',
				),
			);
			return;
		}
		this._pending++;
		let finished = false;
		const done = () => {
			if (finished) return;
			finished = true;
			this.#settled();
		};
		try {
			submittable.submit(new Submission(connection, this, done));
		} catch (error) {
			done();
			fail(
				new Error(
					`This submittable drives pg's Connection directly, which the quarry shim does not provide: ${String(error)}`,
				),
			);
		}
	}

	#run(query: Query): void {
		const connection = this._connection;
		this._hasExecuted = true;
		execute(
			connection,
			query,
			{ named: this._named, types: this._types, timeout: this._queryTimeout },
			() => this.#settled(),
		);
	}

	end(cb?: (error?: Error) => void): Promise<void> | undefined {
		this._ending = true;
		const promise: Promise<void> = new this._Promise((resolve, reject) => {
			this.#end().then(resolve, reject);
		});
		if (cb) {
			promise.then(
				() => callback(cb),
				(error: Error) => callback(cb, error),
			);
			return undefined;
		}
		return promise;
	}

	async #end(): Promise<void> {
		if (this._connecting) {
			await new Promise<void>((resolve) => this._waiting.push(resolve));
		}
		const connection = this._connection;
		if (connection === undefined || this._ended) return;
		if (connection.closed) {
			await new Promise<void>((resolve) => this.once('end', () => resolve()));
			return;
		}
		const ended = new Promise<void>((resolve) =>
			this.once('end', () => resolve()),
		);
		await connection.close();
		await ended;
	}

	getTransactionStatus(): 'I' | 'T' | 'E' | null {
		const connection = this._connection;
		if (connection === undefined) return null;
		const status = connection.transactionStatus;
		return status === 'idle' ? 'I' : status === 'transaction' ? 'T' : 'E';
	}

	setTypeParser(oid: number, format: any, parser?: any): void {
		this._types.setTypeParser(oid, format, parser);
	}

	getTypeParser(oid: number, format?: string): (value: string) => unknown {
		return this._types.getTypeParser(oid, format);
	}

	escapeIdentifier(value: string): string {
		return escapeIdentifier(value);
	}

	escapeLiteral(value: string): string {
		return escapeLiteral(value);
	}

	ref(): void {}
	unref(): void {}
}

export function escapeIdentifier(value: string): string {
	return quoteIdentifier(value);
}

export function escapeLiteral(value: string): string {
	let backslash = false;
	let out = "'";
	for (const ch of value) {
		if (ch === "'") out += "''";
		else if (ch === '\\') {
			out += '\\\\';
			backslash = true;
		} else out += ch;
	}
	out += "'";
	return backslash ? ` E${out}` : out;
}

export { pgTypes };
