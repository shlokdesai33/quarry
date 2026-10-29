// A postgres.js facade over quarry's driver, for running postgres.js's
// tests. postgres.js's own query building is reused as is (tagged
// templates, helpers, escaping, type inference: its types.js and
// query.js); everything that talks to the server is quarry's Pool,
// transactions, cursors, COPY and LISTEN. postgres.js's connection.js and
// its connection queues are not used.
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import {
	AbortError,
	ConnectionError,
	createPool,
	DecodeError,
	DriverError,
	UndefinedParameterError,
	CodecRegistry,
	createCodecRegistry,
	parseArray,
	PostgresError as QuarryPostgresError,
	type Connection,
	type Field,
	type Pool,
	type QueryResult,
	type Codec,
	type TypeCatalog,
	type DriverSocket,
	type Notice,
	type SocketFactory,
	type Transaction,
} from '../../../../../src/driver/index.js';

// postgres.js's own modules, from the checkout under test
const root = process.env['QUARRY_COMPAT_POSTGRES'] ?? '';
const typesModule: any = await import(`${root}/src/types.js`);
const { Query, CLOSE }: any = await import(`${root}/src/query.js`);
const { Errors, PostgresError }: any = await import(`${root}/src/errors.js`);
const { default: Result }: any = await import(`${root}/src/result.js`);
const { default: largeObject }: any = await import(`${root}/src/large.js`);
const {
	mergeUserTypes,
	inferType,
	Parameter,
	Identifier,
	Builder,
	stringify,
	handleValue,
	toPascal,
	pascal,
	toCamel,
	camel,
	toKebab,
	kebab,
	fromPascal,
	fromCamel,
	fromKebab,
} = typesModule;

const errorFields: Record<string, string> = {
	S: 'severity_local',
	V: 'severity',
	C: 'code',
	M: 'message',
	D: 'detail',
	H: 'hint',
	P: 'position',
	p: 'internal_position',
	q: 'internal_query',
	W: 'where',
	s: 'schema_name',
	t: 'table_name',
	c: 'column_name',
	d: 'data type_name',
	n: 'constraint_name',
	F: 'file',
	L: 'line',
	R: 'routine',
};

const fieldsToObject = (fields: Readonly<Record<string, string>>) => {
	const out: Record<string, string> = {};
	for (const [code, value] of Object.entries(fields)) {
		const name = errorFields[code];
		if (name) out[name] = value;
	}
	return out;
};

type TextParser = (text: string) => unknown;

/** Every value as the server's text, for postgres.js's raw queries. */
const rawCodecs = createCodecRegistry([], null);

/** A registry reading each type with the parser `parsers` has for it as a value is read: they change once postgres.js fetches types. */
class ParserRegistry extends CodecRegistry {
	readonly #parsers: Record<number, TextParser>;
	readonly #codecs = new Map<number, Codec>();

	constructor(parsers: Record<number, TextParser>) {
		super([]);
		this.#parsers = parsers;
	}

	override codecFor(oid: number, _catalog: TypeCatalog): Codec {
		let codec = this.#codecs.get(oid);
		if (codec === undefined) {
			const parsers = this.#parsers;
			codec = {
				name: '',
				oid,
				paramFormat: 'text',
				resultFormat: 'text',
				encode: String,
				decodeText: (text) => {
					const parse = parsers[oid];
					return parse === undefined ? text : parse(text);
				},
			};
			this.#codecs.set(oid, codec);
		}
		return codec;
	}
}

/** postgres.js's JSON types: quarry can't tell a string meant as JSON from text. */
const JSON_TYPES = new Set([114, 3802]);

let connectionIds = 0;

export default function Postgres(a?: any, b?: any): any {
	const options = parseOptions(a, b);
	const userTypes = new Set<number>();
	for (const type of Object.values<any>(options.types ?? {})) {
		if (type.to) userTypes.add(type.to);
		for (const from of [].concat(type.from ?? [])) userTypes.add(from);
	}
	let ending: Promise<void> | undefined;
	let ended = false;
	let destroying = false;
	let pool: Pool | undefined;
	let catalog: Promise<void> | undefined;
	let catalogLoaded = false;
	const id = connectionIds++;
	const parsers: Record<number, TextParser> = {};

	/** quarry's codecs from postgres.js's parsers, arrays decoded by quarry's parseArray. */
	const table = new ParserRegistry(parsers);

	function rebuildParsers(
		arrays: { oid: number; typarray: number; typdelim: string }[],
	) {
		for (const [oid, parse] of Object.entries<any>(options.parsers)) {
			if (parse) parsers[Number(oid)] = parse;
		}
		for (const { oid, typarray, typdelim } of arrays) {
			if (!typarray || (parsers[typarray] && !options.parsers[typarray]?.array))
				continue;
			options.shared.typeArrayMap[oid] = typarray;
			const element = options.parsers[oid];
			parsers[typarray] = (text: string) => parseArray(text, element, typdelim);
		}
	}
	rebuildParsers([]);

	function quarryPool(): Pool {
		if (pool) return pool;
		const hosts = options.path
			? [options.path.slice(0, options.path.lastIndexOf('/'))]
			: options.host;
		pool = createPool({
			host: hosts.join(','),
			port: options.path ? options.port[0] : options.port.join(','),
			user: options.user,
			password: options.pass || undefined,
			database: options.database,
			ssl: sslMode(options.ssl, options.sslnegotiation),
			max: options.max,
			idleTimeout: options.idle_timeout ? options.idle_timeout * 1000 : 0,
			maxLifetime: options.max_lifetime ? options.max_lifetime * 1000 : 0,
			connectTimeout: options.connect_timeout
				? options.connect_timeout * 1000
				: 0,
			acquireTimeout: 0,
			prepare: options.prepare,
			// postgres.js prepares a statement on its first use
			prepareThreshold: 1,
			keepAlive: !!options.keep_alive,
			keepAliveInitialDelay: options.keep_alive
				? options.keep_alive * 1000
				: undefined,
			targetSessionAttrs: options.target_session_attrs ?? undefined,
			params: { ...options.connection },
			codecs: table,
			captureStack: true,
			env: process.env,
			...(options.socket ? { socket: customSockets(options) } : {}),
			onNotice: (notice: Notice) => {
				const x = fieldsToObject(notice.fields);
				if (options.onnotice) options.onnotice(x);
				// postgres.js logs notices when there is no handler
				else console.log(x); // oxlint-disable-line no-console
			},
			onConnect: (connection: Connection) => {
				for (const [k, v] of connection.parameters) {
					if (options.parameters[k] !== v) {
						options.parameters[k] = v;
						options.onparameter?.(k, v);
					}
				}
				connection.onClose(() => options.onclose?.(id));
			},
		} as any);
		return pool;
	}

	/** postgres.js's fetch_types: array types from pg_type, once. */
	function ready(target: { query: Connection['query'] }): Promise<void> {
		if (!options.fetch_types) return Promise.resolve();
		catalog ??= target
			.query<{ oid: string; typarray: string; typdelim: string }>(
				`select b.oid, b.typarray, b.typdelim
				from pg_catalog.pg_type a
				left join pg_catalog.pg_type b on b.oid = a.typelem
				where a.typcategory = 'A'
				group by b.oid, b.typarray, b.typdelim
				order by b.oid`,
				[],
				{ codecs: rawCodecs },
			)
			.then(({ rows }) => {
				catalogLoaded = true;
				rebuildParsers(
					rows.map((r) => ({
						oid: Number(r.oid),
						typarray: Number(r.typarray),
						typdelim: r.typdelim,
					})),
				);
			})
			.catch((error: unknown) => {
				catalog = undefined;
				throw error;
			});
		return catalog;
	}

	const sql = Sql(handler(() => ({ pool: quarryPool() })));
	Object.assign(sql, {
		get parameters() {
			return options.parameters;
		},
		largeObject: (...args: unknown[]) => largeObject(sql, ...args),
		subscribe: () => {
			throw new Error(
				'Logical replication (subscribe) is not supported by quarry',
			);
		},
		CLOSE,
		END: CLOSE,
		PostgresError,
		options,
		reserve,
		listen,
		begin,
		close: end,
		end,
	});
	return sql;

	function Sql(run: (q: any) => void) {
		(run as any).debug = options.debug;
		const typed: any = (value: unknown, type: number) =>
			new Parameter(value, type);
		for (const [name, type] of Object.entries<any>(options.types))
			typed[name] = (x: unknown) => new Parameter(x, type.to);

		function tagged(strings: any, ...args: unknown[]): any {
			return strings && Array.isArray(strings.raw)
				? new Query(strings, args, run, cancel)
				: typeof strings === 'string' && !args.length
					? new Identifier(
							options.transform.column.to
								? options.transform.column.to(strings)
								: strings,
						)
					: new Builder(strings, args);
		}

		function unsafe(string: string, args: any = [], opts: any = {}) {
			if (arguments.length === 2 && !Array.isArray(args)) {
				opts = args;
				args = [];
			}
			return new Query([string], args, run, cancel, {
				prepare: false,
				...opts,
				simple: 'simple' in opts ? opts.simple : args.length === 0,
			});
		}

		function file(path: string, args: any = [], opts: any = {}) {
			if (arguments.length === 2 && !Array.isArray(args)) {
				opts = args;
				args = [];
			}
			return new Query(
				[],
				args,
				(query: any) => {
					fs.readFile(path, 'utf8', (err, string) => {
						if (err) {
							query.reject(err);
							return;
						}
						query.strings = [string];
						run(query);
					});
				},
				cancel,
				{ ...opts, simple: 'simple' in opts ? opts.simple : args.length === 0 },
			);
		}

		Object.assign(tagged, {
			types: typed,
			typed,
			unsafe,
			notify,
			array,
			json,
			file,
		});
		return tagged as any;
	}

	function json(x: unknown) {
		return new Parameter(x, 3802);
	}

	function array(x: any, type?: number): any {
		if (!Array.isArray(x)) return array(Array.from(arguments));
		return new Parameter(
			x,
			type || (x.length ? inferType(x) || 25 : 0),
			options.shared.typeArrayMap,
		);
	}

	async function notify(channel: string, payload: unknown) {
		return await sql`select pg_notify(${channel}, ${'' + payload})`;
	}

	function cancel(query: any): Promise<void> {
		return new Promise((resolve) => {
			if (query.controller) {
				query.cancelRequested = true;
				query.controller.abort();
				resolve();
				return;
			}
			query.cancelled = true;
			query.reject(
				Errors.generic('57014', 'canceling statement due to user request'),
			);
			resolve();
		});
	}

	/** Where queries go: the pool, or one connection (a transaction or reserved client). */
	interface Target {
		pool?: Pool;
		connection?: Connection;
		tx?: Transaction;
	}

	function handler(target: () => Target) {
		return (q: any) => {
			if (ended && !target().connection) {
				q.reject(Errors.connection('CONNECTION_ENDED', options, options));
				return;
			}
			if (q.cancelled) return;
			void execute(q, target());
		};
	}

	function build(q: any) {
		const parameters: unknown[] = [];
		const inferred: number[] = [];
		// postgres.js writes the text with string concatenation, so anything is coerced
		const string =
			'' + stringify(q, q.strings[0], q.args[0], parameters, inferred, options);
		if (!q.tagged)
			for (const x of q.args) handleValue(x, parameters, inferred, options);
		q.string = string;
		q.parameters = parameters;
		// quarry names its statements itself; postgres.js reports a name when it prepares
		const prepare =
			options.prepare &&
			('prepare' in q.options ? q.options.prepare : true) &&
			!q.options.simple;
		q.statement = { string, types: inferred, name: prepare ? 'quarry' : '' };
		if (typeof options.debug === 'function')
			options.debug(id, string, parameters, inferred);
		return { string, parameters, types: inferred };
	}

	/** Values as quarry gets them: postgres.js's serializers only where quarry can't know the type. */
	function encode(parameters: unknown[], inferred: number[]) {
		const paramTypes: number[] = [];
		/** Elements typed with sql.types / sql.json, serialized as postgres.js's array serializer does. */
		const unwrap = (value: unknown): unknown => {
			if (value instanceof Parameter) {
				const p = value as any;
				const serialize = options.serializers[p.type];
				return serialize && (JSON_TYPES.has(p.type) || userTypes.has(p.type))
					? serialize(p.value)
					: unwrap(p.value);
			}
			// postgres.js's transform.undefined applies inside arrays too
			if (value === undefined && options.transform.undefined !== undefined)
				return options.transform.undefined;
			return Array.isArray(value) ? value.map(unwrap) : value;
		};
		const values = parameters.map((raw, i) => {
			const value = Array.isArray(raw) ? unwrap(raw) : raw;
			let type = inferred[i] ?? 0;
			const serialize = options.serializers[type];
			if (
				value !== null &&
				value !== undefined &&
				serialize &&
				(JSON_TYPES.has(type) || userTypes.has(type))
			) {
				paramTypes.push(type);
				return serialize(value);
			}
			// postgres.js types a plain array by its first element; quarry sends it as an array literal
			const arrayOid = new Set(
				Object.values<number>(options.shared.typeArrayMap),
			).has(type);
			if (Array.isArray(value) && !arrayOid) type = 0;
			paramTypes.push(type);
			return value ?? null;
		});
		return { values, paramTypes };
	}

	function toResult(r: QueryResult<any>, q: any, connection?: Connection): any {
		const result = new Result();
		result.count = r.rowCount;
		result.command = r.command;
		result.columns = r.fields.map((f: Field) => column(f));
		result.statement = { ...q.statement, columns: result.columns };
		result.state = connection
			? { pid: connection.processId, secret: null }
			: null;
		const t = options.transform;
		for (const raw of r.rows) {
			let row: any;
			if (q.isRaw) {
				row = (raw as unknown[]).map((v) =>
					q.isRaw === true ? (v === null ? null : Buffer.from(String(v))) : v,
				);
				if (q.isRaw === 'values' && t.value.from)
					row = row.map((v: unknown, i: number) =>
						t.value.from(v, result.columns[i]),
					);
			} else {
				row = {};
				for (const [k, v] of Object.entries(raw)) {
					const name = t.column.from ? t.column.from(k) : k;
					row[name] = t.value.from
						? t.value.from(v, columnFor(result, name))
						: v;
				}
				if (t.row.from) row = t.row.from(row);
			}
			result.push(row);
		}
		return result;
	}

	function column(f: Field) {
		return {
			name: options.transform.column.from
				? options.transform.column.from(f.name)
				: f.name,
			parser: options.parsers[f.typeOid],
			table: f.tableOid,
			number: f.columnId,
			type: f.typeOid,
		};
	}

	function toError(error: unknown, q: any): Error {
		let out: any;
		if (error instanceof AbortError && q.cancelRequested) {
			// canceled before it reached the server (waiting for a connection)
			out = Errors.generic('57014', 'canceling statement due to user request');
		} else if (error instanceof DecodeError && error.cause instanceof Error) {
			// postgres.js surfaces the parser's own error
			out = error.cause;
		} else if (error instanceof UndefinedParameterError) {
			out = Errors.generic(
				'UNDEFINED_VALUE',
				'Undefined values are not allowed',
			);
			out.cause = error;
		} else if (error instanceof QuarryPostgresError) {
			out = new PostgresError(fieldsToObject(error.fields));
			if (error.stack)
				out.stack = error.stack.replace(/^\w*Error/, 'PostgresError');
		} else if (error instanceof ConnectionError && error.code === 'ETIMEDOUT') {
			out = Errors.connection('CONNECT_TIMEOUT', options);
		} else if (
			(error instanceof ConnectionError || error instanceof DriverError) &&
			/server closed the connection|connection is closed|closed after waiting|terminated|pool has ended/i.test(
				error.message,
			)
		) {
			out = Errors.connection(
				destroying
					? 'CONNECTION_DESTROYED'
					: ended
						? 'CONNECTION_ENDED'
						: 'CONNECTION_CLOSED',
				options,
			);
			out.cause = error;
		} else {
			out = error instanceof Error ? error : new Error(String(error));
		}
		if (!('query' in out) && !('parameters' in out)) {
			Object.defineProperties(out, {
				// postgres.js appends where the query was written
				stack: {
					value: `${out.stack}${String(q.origin ?? '').replace(/.*\n/, '\n')}`,
					enumerable: !!options.debug,
				},
				query: { value: q.string, enumerable: !!options.debug },
				parameters: { value: q.parameters, enumerable: !!options.debug },
				args: { value: q.args, enumerable: !!options.debug },
				types: { value: q.statement?.types, enumerable: !!options.debug },
			});
		}
		return out;
	}

	async function execute(q: any, target: Target): Promise<void> {
		if (target.pool && options.fetch_types && !catalogLoaded) {
			// the type catalog loads first; reserving a connection (synchronously)
			// keeps the query issued before anything that comes after it, like end()
			const reserving = target.pool.acquire();
			let client;
			try {
				client = await reserving;
				await ready(client.connection);
			} catch (error) {
				client?.release();
				q.reject(toError(error, q));
				return;
			}
			try {
				await execute(q, { connection: client.connection });
			} finally {
				client.release();
			}
			return;
		}
		try {
			if (q.strings.length === 0) return; // sql.file before its text arrives
			const { string, parameters, types: inferred } = build(q);
			if (parameters.length >= 65534)
				throw Errors.generic(
					'MAX_PARAMETERS_EXCEEDED',
					'Max number of parameters (65534) exceeded',
				);
			const { values, paramTypes } = encode(parameters, inferred);
			const conn = target.connection;
			const runner: any = target.tx ?? conn ?? target.pool;
			await ready(conn ?? (target.pool as Pool));
			const controller = new AbortController();
			q.controller = controller;
			q.active = true;
			const signal = controller.signal;
			const prepare =
				options.prepare && ('prepare' in q.options ? q.options.prepare : true);
			const base = {
				codecs: q.isRaw === true ? rawCodecs : table,
				rowMode: q.isRaw ? 'array' : 'object',
				signal,
			};
			if (q.onlyDescribe) {
				const d = await runner.describe(string, { paramTypes });
				q.resolve({
					string,
					types: d.paramTypes,
					name: '',
					columns: d.fields.map((f: Field) => column(f)),
				});
				return;
			}
			if (q.streaming) {
				q.resolve(copyStream(q, string, target));
				return;
			}
			if (q.cursorFn) {
				await cursor(q, string, values, paramTypes, base, runner);
				return;
			}
			if (q.options.simple) {
				const simple = conn ?? (target.pool as Pool);
				const results = await simple.simpleQuery(string, base as any);
				const converted = results.map((r) => toResult(r, q, conn));
				if (q.forEachFn) {
					for (const result of converted)
						for (const row of result) await q.forEachFn(row, result);
					const last = converted.at(-1);
					const empty = new Result();
					empty.count = last?.count ?? null;
					empty.command = last?.command ?? null;
					q.resolve(empty);
					return;
				}
				q.resolve(
					converted.length === 1
						? converted[0]
						: converted.length === 0
							? new Result()
							: converted,
				);
				return;
			}
			const r: QueryResult<any> = await runner.query(string, values, {
				...base,
				paramTypes,
				prepare,
			});
			if (q.forEachFn) {
				const result = toResult(r, q, conn);
				for (const row of result) await q.forEachFn(row, result);
				const empty = new Result();
				empty.count = result.count;
				empty.command = result.command;
				empty.columns = result.columns;
				q.resolve(empty);
				return;
			}
			q.resolve(toResult(r, q, conn));
		} catch (error) {
			q.reject(toError(error, q));
		} finally {
			q.controller = undefined;
		}
	}

	async function cursor(
		q: any,
		string: string,
		values: unknown[],
		paramTypes: number[],
		base: Record<string, unknown>,
		runner: any,
	): Promise<void> {
		const source = runner.cursor(string, values, {
			...base,
			paramTypes,
			batchSize: q.cursorRows,
		});
		const iterator = source[Symbol.asyncIterator]();
		let last: any = new Result();
		try {
			for (;;) {
				// oxlint-disable-next-line no-await-in-loop
				const next = await iterator.next();
				if (next.done) break;
				const result = toResult(
					{
						command: 'SELECT',
						rowCount: next.value.length,
						rows: next.value,
						fields: [],
					},
					q,
				);
				last = result;
				// oxlint-disable-next-line no-await-in-loop
				const x = await q.cursorFn(result);
				if (x === CLOSE) {
					// oxlint-disable-next-line no-await-in-loop
					await iterator.return?.();
					break;
				}
			}
		} catch (error) {
			await iterator.return?.().catch(() => {});
			throw error;
		}
		q.resolve(last);
	}

	/** postgres.js's COPY streams: readable() for COPY … TO STDOUT, writable() for FROM STDIN. */
	function copyStream(
		q: any,
		string: string,
		target: Target,
	): Readable | Writable {
		const copier: any = target.tx ?? target.connection ?? target.pool;
		if (/\bfrom\s+stdin\b/i.test(string)) {
			const chunks: Buffer[] = [];
			let wake: (() => void) | undefined;
			let finished = false;
			let failure: Error | undefined;
			async function* source() {
				for (;;) {
					if (failure) throw failure;
					const chunk = chunks.shift();
					if (chunk) {
						yield chunk;
						continue;
					}
					if (finished) return;
					// oxlint-disable-next-line no-await-in-loop
					await new Promise<void>((resolve) => (wake = resolve));
				}
			}
			const done = copier.copyFrom(string, source());
			const poke = () => {
				const w = wake;
				wake = undefined;
				w?.();
			};
			const stream = new Writable({
				write(chunk, _encoding, callback) {
					chunks.push(Buffer.from(chunk));
					poke();
					callback();
				},
				final(callback) {
					finished = true;
					poke();
					done.then(
						() => callback(),
						(error: unknown) => callback(toError(error, q)),
					);
				},
				destroy(error, callback) {
					if (error) {
						failure = error;
						poke();
						done.catch(() => {});
					}
					callback(error);
				},
			});
			done.catch((error: unknown) => stream.destroy(toError(error, q)));
			return stream;
		}
		const iterator = copier.copyTo(string)[Symbol.asyncIterator]();
		return new Readable({
			read() {
				iterator.next().then(
					(next: IteratorResult<Uint8Array>) =>
						this.push(next.done ? null : Buffer.from(next.value)),
					(error: unknown) => this.destroy(toError(error, q)),
				);
			},
			destroy(error, callback) {
				iterator.return?.().then(
					() => callback(error),
					() => callback(error),
				);
			},
		});
	}

	async function reserve() {
		const client = await quarryPool().acquire();
		const connection = client.connection;
		const reserved = Sql(handler(() => ({ connection })));
		reserved.release = () => client.release();
		return reserved;
	}

	async function begin(opts: any, fn?: (sql: any) => unknown) {
		if (!fn) {
			fn = opts;
			opts = '';
		}
		const txOptions = parseBegin(String(opts));
		const client = await quarryPool().acquire();
		const connection = client.connection;
		let prepared: string | undefined;
		try {
			return await connection.transaction(async (tx) => {
				const result = await scope(tx, fn as (sql: any) => unknown);
				if (prepared !== undefined)
					await tx.query(`prepare transaction '${prepared}'`);
				return result;
			}, txOptions);
		} catch (error) {
			throw toError(error, {});
		} finally {
			client.release();
		}

		async function scope(
			tx: Transaction,
			body: (sql: any) => unknown,
		): Promise<unknown> {
			let uncaught: unknown;
			const scoped = Sql((q: any) => {
				q.catch((e: unknown) => {
					uncaught ??= e;
				});
				void execute(q, { connection, tx });
			});
			scoped.savepoint = (name: any, inner?: (sql: any) => unknown) => {
				if (name && Array.isArray(name.raw)) {
					const args = arguments;
					return scoped.savepoint((s: any) => s(...args));
				}
				if (typeof name === 'function') inner = name;
				return tx.transaction((sp) =>
					scope(sp, inner as (sql: any) => unknown),
				);
			};
			scoped.prepare = (x: string) => {
				prepared = x.replace(/[^a-z0-9$-_. ]/gi, '');
			};
			const x = body(scoped);
			const result = await (Array.isArray(x) ? Promise.all(x) : x);
			if (uncaught) throw uncaught;
			return result;
		}
	}

	async function listen(
		name: string,
		fn: (payload: string) => void,
		onlisten?: () => void,
	) {
		const unlistenFn = await quarryPool().listen(name, (n) => fn(n.payload));
		onlisten?.();
		return { state: { pid: null, secret: null }, unlisten: unlistenFn };
	}

	function end({
		timeout = null,
	}: { timeout?: number | null } = {}): Promise<void> {
		if (ending) return ending;
		ending = (async () => {
			// as postgres.js: queries issued in the same tick still run
			await Promise.resolve();
			ended = true;
			destroying = timeout !== null;
			await pool?.end(timeout === null ? {} : { timeout: timeout * 1000 });
		})();
		return ending;
	}
}

function columnFor(result: any, name: string) {
	return result.columns.find((c: any) => c.name === name);
}

Object.assign(Postgres, {
	PostgresError,
	toPascal,
	pascal,
	toCamel,
	camel,
	toKebab,
	kebab,
	fromPascal,
	fromCamel,
	fromKebab,
	BigInt: {
		to: 20,
		from: [20],
		parse: (x: string) => BigInt(x),
		serialize: (x: bigint) => x.toString(),
	},
});

function sslMode(ssl: any, negotiation: string | null): any {
	if (ssl === false || ssl === undefined || ssl === null || ssl === 'disable')
		return 'disable';
	const direct = negotiation === 'direct' ? { negotiation: 'direct' } : {};
	if (ssl === true) return { mode: 'verify-full', ...direct };
	if (typeof ssl === 'string') return { mode: ssl, ...direct };
	return {
		mode: ssl.rejectUnauthorized === false ? 'require' : 'verify-full',
		...(ssl.ca ? { ca: ssl.ca } : {}),
		...(ssl.cert ? { cert: ssl.cert } : {}),
		...(ssl.key ? { key: ssl.key } : {}),
		...direct,
	};
}

/** postgres.js's free-form `begin` options, as quarry's transaction options. */
function parseBegin(text: string): Record<string, unknown> {
	const options: Record<string, unknown> = {};
	const s = text
		.toLowerCase()
		.replace(/[^a-z ]/g, '')
		.trim();
	const isolation =
		/isolation level (read uncommitted|read committed|repeatable read|serializable)/.exec(
			s,
		);
	if (isolation) options['isolation'] = isolation[1];
	if (/\bread only\b/.test(s)) options['readOnly'] = true;
	if (/\bread write\b/.test(s)) options['readOnly'] = false;
	if (/\bnot deferrable\b/.test(s)) options['deferrable'] = false;
	else if (/\bdeferrable\b/.test(s)) options['deferrable'] = true;
	return options;
}

// postgres.js's parseOptions, as published (it isn't exported)
function parseOptions(a: any, b: any): any {
	if (a && a.shared) return a;
	const env = process.env;
	const o = (!a || typeof a === 'string' ? b : a) || {};
	const { url, multihost } = parseUrl(a);
	const query = [...url.searchParams].reduce(
		(acc: any, [k, v]: any) => ((acc[k] = v), acc),
		{},
	);
	const host =
		o.hostname ||
		o.host ||
		multihost ||
		url.hostname ||
		env['PGHOST'] ||
		'localhost';
	const port = o.port || url.port || env['PGPORT'] || 5432;
	const user =
		o.user ||
		o.username ||
		url.username ||
		env['PGUSERNAME'] ||
		env['PGUSER'] ||
		osUsername();
	if (o.no_prepare) o.prepare = false;
	if (query.sslmode) {
		query.ssl = query.sslmode;
		delete query.sslmode;
	}
	if ('timeout' in o) o.idle_timeout = o.timeout;
	if (query.sslrootcert === 'system') query.ssl = 'verify-full';
	const ints = new Set([
		'idle_timeout',
		'connect_timeout',
		'max_lifetime',
		'max_pipeline',
		'backoff',
		'keep_alive',
	]);
	const defaults: Record<string, unknown> = {
		max: 10,
		ssl: false,
		sslnegotiation: null,
		idle_timeout: null,
		connect_timeout: 30,
		max_lifetime: 60 * (30 + Math.random() * 30),
		max_pipeline: 100,
		backoff: (retries: number) =>
			(0.5 + Math.random() / 2) * Math.min(3 ** retries / 100, 20),
		keep_alive: 60,
		prepare: true,
		debug: false,
		fetch_types: true,
		publications: 'alltables',
		target_session_attrs: null,
	};
	return {
		host: Array.isArray(host)
			? host
			: host.split(',').map((x: string) => x.split(':')[0]),
		port: Array.isArray(port)
			? port
			: host
					.split(',')
					.map((x: string) => Number.parseInt(x.split(':')[1] || port)),
		path: o.path || (host.indexOf('/') > -1 && `${host}/.s.PGSQL.${port}`),
		database:
			o.database ||
			o.db ||
			(url.pathname || '').slice(1) ||
			env['PGDATABASE'] ||
			user,
		user,
		pass: o.pass || o.password || url.password || env['PGPASSWORD'] || '',
		...Object.entries(defaults).reduce((acc: any, [k, d]) => {
			const value =
				k in o
					? o[k]
					: k in query
						? query[k] === 'disable' || query[k] === 'false'
							? false
							: query[k]
						: env[`PG${k.toUpperCase()}`] || d;
			acc[k] = typeof value === 'string' && ints.has(k) ? +value : value;
			return acc;
		}, {}),
		connection: {
			application_name: env['PGAPPNAME'] || 'postgres.js',
			...o.connection,
			...Object.entries(query).reduce(
				(acc: any, [k, v]) => (k in defaults || (acc[k] = v), acc),
				{},
			),
		},
		types: o.types || {},
		target_session_attrs:
			o.target_session_attrs ||
			url.searchParams.get('target_session_attrs') ||
			env['PGTARGETSESSIONATTRS'],
		onnotice: o.onnotice,
		onnotify: o.onnotify,
		onclose: o.onclose,
		onparameter: o.onparameter,
		socket: o.socket,
		transform: parseTransform(o.transform || { undefined: undefined }),
		parameters: {},
		shared: { retries: 0, typeArrayMap: {} },
		...mergeUserTypes(o.types),
	};
}

function parseTransform(x: any) {
	return {
		undefined: x.undefined,
		column: {
			from:
				typeof x.column === 'function' ? x.column : x.column && x.column.from,
			to: x.column && x.column.to,
		},
		value: {
			from: typeof x.value === 'function' ? x.value : x.value && x.value.from,
			to: x.value && x.value.to,
		},
		row: {
			from: typeof x.row === 'function' ? x.row : x.row && x.row.from,
			to: x.row && x.row.to,
		},
	};
}

function parseUrl(url: unknown): any {
	if (!url || typeof url !== 'string')
		return { url: { searchParams: new Map() } };
	let host = url;
	host = host.slice(host.indexOf('://') + 3).split(/[?/]/)[0] ?? '';
	host = decodeURIComponent(host.slice(host.indexOf('@') + 1));
	const urlObj = new URL(url.replace(host, host.split(',')[0] ?? ''));
	return {
		url: {
			username: decodeURIComponent(urlObj.username),
			password: decodeURIComponent(urlObj.password),
			host: urlObj.host,
			hostname: urlObj.hostname,
			port: urlObj.port,
			pathname: urlObj.pathname,
			searchParams: urlObj.searchParams,
		},
		multihost: host.indexOf(',') > -1 && host,
	};
}

function osUsername(): string {
	try {
		return os.userInfo().username;
	} catch {
		return (
			process.env['USERNAME'] ||
			process.env['USER'] ||
			process.env['LOGNAME'] ||
			''
		);
	}
}

const noop = () => {};

/** postgres.js's `socket` option (a function returning a connected Node socket) as a quarry SocketFactory. */
function customSockets(options: any): SocketFactory {
	return {
		async connect() {
			let socket: any;
			try {
				socket = await options.socket(options);
			} catch (error) {
				throw error instanceof Error ? error : new Error(String(error));
			}
			if (socket.connecting)
				await new Promise<void>((resolve, reject) => {
					socket.once('connect', resolve);
					socket.once('error', reject);
				});
			let onData: (chunk: Uint8Array) => void = noop;
			let onClose: () => void = noop;
			let onError: (error: Error) => void = noop;
			let onDrain: () => void = noop;
			socket.on('data', (chunk: Uint8Array) => onData(chunk));
			socket.on('close', () => onClose());
			socket.on('error', (error: Error) => onError(error));
			socket.on('drain', () => onDrain());
			const driver: DriverSocket = {
				get encrypted() {
					return false;
				},
				write: (data) => socket.write(data),
				startTls: () =>
					Promise.reject(
						new Error('TLS over a custom socket is not supported by the shim'),
					),
				peerCertificate: () => undefined,
				pause: () => socket.pause(),
				resume: () => socket.resume(),
				end: () => socket.end(),
				destroy: () => socket.destroy(),
				onData: (h) => (onData = h),
				onClose: (h) => (onClose = h),
				onError: (h) => (onError = h),
				onDrain: (h) => (onDrain = h),
			};
			return driver;
		},
	};
}
