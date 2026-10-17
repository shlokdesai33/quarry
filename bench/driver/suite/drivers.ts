/**
 * One adapter per client configuration, all with the same small interface.
 * Every adapter uses the client's public, documented API, configured as its
 * documentation recommends for production; variants (`-named`, `-noprep`,
 * …) cover the knobs that matter for speed. See README.md for the table.
 */
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PORTS, USERS } from './env.ts';

export type Row = Record<string, unknown>;

export interface Tx {
	query(sql: string, params?: unknown[]): Promise<readonly Row[]>;
	savepoint(fn: (tx: Tx) => Promise<void>): Promise<void>;
}

export interface Driver {
	readonly name: string;
	query(sql: string, params?: unknown[]): Promise<readonly Row[]>;
	/**
	 * A query with declared parameter type OIDs, as quarry's query builder
	 * sends them (JS arrays included). Clients without it get `query`.
	 */
	queryTyped?(
		sql: string,
		params: unknown[],
		paramTypes: number[],
	): Promise<readonly Row[]>;
	transaction(fn: (tx: Tx) => Promise<void>): Promise<void>;
	/**
	 * quarry's query builder only: three statements (a lookup, an insert,
	 * an update) run one after another, with `Promise.all`, or with
	 * `db.batch`, outside or inside a transaction.
	 */
	builderBatch?(
		mode: 'seq' | 'all' | 'batch',
		inTransaction: boolean,
		i: number,
	): Promise<unknown>;
	/** COPY … FROM STDIN with pre-encoded text chunks. */
	copyFrom?(sql: string, chunks: readonly string[]): Promise<void>;
	/** Cursor streaming: calls `onBatch` per batch, awaiting it (backpressure). */
	stream?(
		sql: string,
		params: unknown[],
		batchSize: number,
		onBatch: (rows: readonly Row[]) => unknown,
	): Promise<void>;
	listen?(
		channel: string,
		handler: (payload: string) => void,
	): Promise<() => Promise<void>>;
	/** Starts `sql` on its own connection; `cancel()` uses the client's cancel API. */
	cancellable?(
		sql: string,
	): Promise<{ done: Promise<unknown>; cancel(): void }>;
	end(): Promise<void>;
}

export interface Target {
	/** Host and port of the server, pooler or proxy. */
	readonly host: string;
	readonly port: number;
	readonly user: string;
	readonly password?: string | undefined;
	readonly database: string;
	/** verify-full TLS with this CA (PEM file); plain TCP when undefined. */
	readonly caFile?: string | undefined;
}

export interface DriverOptions {
	readonly target: Target;
	readonly max: number;
	/** quarry only: queries per shared connection (`pipeline` option). */
	readonly pipeline?: number | false | undefined;
}

export const targetUrl = (t: Target, params = '') =>
	`postgres://${t.user}${t.password ? `:${t.password}` : ''}@${t.host}:${t.port}/${t.database}${params}`;

/** `QUARRY_DIST` points at another build of the driver, for A/B runs of a change. */
const QUARRY_DIST =
	process.env['QUARRY_DIST'] ??
	new URL('../../../dist/driver/index.js', import.meta.url).href;

export type DriverFactory = (o: DriverOptions) => Promise<Driver>;

/** Client configurations, by name. `runtimes` lists where each runs. */
export const DRIVERS: Record<
	string,
	{ runtimes: readonly string[]; describe: string; make: DriverFactory }
> = {
	quarry: {
		runtimes: ['node', 'bun', 'deno'],
		describe:
			'quarry/driver (built dist). Like-for-like decoding (int8/numeric as string, timestamptz as Date, as pg does: `codecs: [codecs.int8AsString, codecs.timestamptz]`). Defaults: prepared statements (LRU 100), binary results for hot types, pipelining onto shared connections when the pool is busy (50 per connection).',
		make: (o) => quarry(o, { decode: 'compat' }),
	},
	'quarry-candidate': {
		runtimes: ['node', 'bun', 'deno'],
		describe:
			'quarry (like-for-like decoding) from the build at `QUARRY_DIST_CANDIDATE`, for A/B runs of a driver change against `quarry`. Only in the matrix when that variable is set.',
		make: (o) =>
			quarry(o, { decode: 'compat' }, process.env['QUARRY_DIST_CANDIDATE']),
	},
	'quarry-db': {
		runtimes: ['node'],
		describe:
			"quarry's query builder (`database()` from the built `dist/index.js`) on its default driver pool, for the `db.batch` scenarios only.",
		make: (o) => quarryDb(o),
	},
	'quarry-lossless': {
		runtimes: ['node', 'bun', 'deno'],
		describe:
			'quarry/driver with its standalone lossless defaults: int8 as bigint, timestamptz/date as text (no Date construction).',
		make: (o) => quarry(o, { decode: 'lossless' }),
	},
	'quarry-noprep': {
		runtimes: ['node', 'bun', 'deno'],
		describe:
			'quarry/driver with `prepare: false` (unnamed statements; text results).',
		make: (o) => quarry(o, { decode: 'compat', prepare: false }),
	},
	'quarry-nopipe': {
		runtimes: ['node'],
		describe:
			'quarry/driver with `pipeline: false` (exclusive connection checkout, like pg).',
		make: (o) => quarry({ ...o, pipeline: false }, { decode: 'compat' }),
	},
	pg: {
		runtimes: ['node', 'bun', 'deno'],
		describe:
			'node-postgres 8.23 Pool, `pool.query(text, values)`: unnamed statements (Parse every time), text results, default type parsers.',
		make: (o) => pgDriver(o, { named: false }),
	},
	'pg-named': {
		runtimes: ['node', 'bun', 'deno'],
		describe:
			'node-postgres 8.23 Pool with named prepared statements (`{ name, text, values }`, one name per distinct SQL text): its fastest documented mode for repeated queries.',
		make: (o) => pgDriver(o, { named: true }),
	},
	'pg-native': {
		runtimes: ['node'],
		describe:
			'node-postgres 8.23 `pg.native` Pool over libpq (pg-native 3.9, libpq 18 client), unnamed statements.',
		make: (o) => pgDriver(o, { named: false, native: true }),
	},
	'pg-native-named': {
		runtimes: ['node'],
		describe: 'pg.native Pool with named prepared statements.',
		make: (o) => pgDriver(o, { named: true, native: true }),
	},
	'postgres.js': {
		runtimes: ['node', 'bun', 'deno'],
		describe:
			'postgres.js 3.4.9 defaults: `prepare: true` (named statements), `sql.unsafe(text, params)`, implicit pipelining on each connection, `fetch_types: true`.',
		make: (o) => postgresJs(o, { prepare: true }),
	},
	'postgres.js-noprep': {
		runtimes: ['node', 'bun', 'deno'],
		describe:
			'postgres.js 3.4.9 with `prepare: false` (unnamed statements, for transaction poolers without prepared-statement support).',
		make: (o) => postgresJs(o, { prepare: false }),
	},
	'bun.sql': {
		runtimes: ['bun'],
		describe:
			'Bun.sql (built-in Zig client) defaults: `prepare: true`, `sql.unsafe(text, params)`, pipelining.',
		make: (o) => bunSql(o, { prepare: true }),
	},
	'bun.sql-noprep': {
		runtimes: ['bun'],
		describe: 'Bun.sql with `prepare: false`.',
		make: (o) => bunSql(o, { prepare: false }),
	},
	neon: {
		runtimes: ['node'],
		describe:
			"@neondatabase/serverless 1.2 Pool (bundled pg over WebSocket) through Neon's Go wsproxy on localhost; unnamed statements; `coalesceWrites: false` (the default batches writes with setTimeout(0), ≥1 ms per round trip on Node); `pipelineConnect: false` (needs cleartext password auth).",
		make: (o) => neon(o, { coalesceWrites: false }),
	},
	'neon-default': {
		runtimes: ['node'],
		describe:
			'@neondatabase/serverless 1.2 Pool with its default `coalesceWrites: true`.',
		make: (o) => neon(o, { coalesceWrites: true }),
	},
	'deno-postgres': {
		runtimes: ['deno'],
		describe:
			'deno-postgres (jsr:@db/postgres 0.19.5) Pool, lazy connections, `queryObject(text, args)`, as shipped: it writes Parse/Bind/Describe/Execute/Sync as separate socket writes without TCP_NODELAY, so each query waits for a delayed ACK (~40 ms on Linux).',
		make: (o) => denoPostgres(o),
	},
	'deno-postgres-nodelay': {
		runtimes: ['deno'],
		describe:
			'deno-postgres with `Deno.connect` patched to call `setNoDelay(true)` on every socket: its best case (not configurable through its API).',
		make: (o) => {
			noDelayDenoConnect();
			return denoPostgres(o);
		},
	},
};

// ---------------------------------------------------------------- quarry

const quarryTx = (tx: any): Tx => ({
	query: async (sql, params) => (await tx.query(sql, params)).rows,
	savepoint: (fn) => tx.transaction((sp: any) => fn(quarryTx(sp))),
});

async function quarry(
	o: DriverOptions,
	v: { decode: 'compat' | 'lossless'; prepare?: boolean },
	dist = QUARRY_DIST,
): Promise<Driver> {
	if (dist === undefined) throw new Error('QUARRY_DIST_CANDIDATE is not set');
	const d = await import(
		dist.startsWith('/') ? new URL(`file://${dist}`).href : dist
	);
	// int8 as digits and timestamptz as Date, for parity with pg (numeric already stays text)
	const compat = [d.codecs.int8AsString, d.codecs.timestamptz];
	const t = o.target;
	const pool = d.createPool({
		host: t.host,
		port: t.port,
		user: t.user,
		password: t.password,
		database: t.database,
		ssl: t.caFile
			? { mode: 'verify-full', ca: readFileSync(t.caFile, 'utf8') }
			: 'disable',
		env: {},
		max: o.max,
		...(o.pipeline === undefined ? {} : { pipeline: o.pipeline }),
		...(v.decode === 'compat' ? { codecs: compat } : {}),
		...(v.prepare === undefined ? {} : { prepare: v.prepare }),
	});
	return {
		name: 'quarry',
		query: async (sql, params) => (await pool.query(sql, params)).rows,
		queryTyped: async (sql, params, paramTypes) =>
			(await pool.query(sql, params, { paramTypes })).rows,
		transaction: (fn) => pool.transaction((tx: any) => fn(quarryTx(tx))),
		copyFrom: async (sql, chunks) => {
			await pool.copyFrom(sql, chunks);
		},
		stream: async (sql, params, batchSize, onBatch) => {
			for await (const batch of pool.cursor(sql, params, { batchSize }))
				await onBatch(batch);
		},
		listen: async (channel, handler) =>
			pool.listen(channel, (n: { payload: string }) => handler(n.payload)),
		cancellable: async (sql) => {
			const ac = new AbortController();
			return {
				done: pool.query(sql, [], { signal: ac.signal }),
				cancel: () => ac.abort(),
			};
		},
		end: () => pool.end(),
	};
}

async function quarryDb(o: DriverOptions): Promise<Driver> {
	const q = await import(
		process.env['QUARRY_DIST'] === undefined
			? new URL('../../../dist/index.js', import.meta.url).href
			: new URL('../index.js', `file://${process.env['QUARRY_DIST']}`).href
	);
	const users = q.defineTable('bench_users', {
		columns: {
			id: q.integer(),
			name: q.text(),
			email: q.text(),
			score: q.doublePrecision(),
			created: q.timestamptz(),
			active: q.boolean(),
		},
	});
	const writes = q.defineTable('bench_writes', {
		columns: {
			id: q.bigint().identity(),
			name: q.text().nullable(),
			score: q.doublePrecision().nullable(),
			created: q.timestamptz().nullable(),
		},
	});
	const upd = q.defineTable('bench_upd', {
		columns: { id: q.integer(), score: q.doublePrecision(), name: q.text() },
	});
	const t = o.target;
	const db = q.database({
		host: t.host,
		port: t.port,
		user: t.user,
		password: t.password,
		database: t.database,
		ssl: 'disable',
		env: {},
		max: o.max,
	});
	const statements = (d: any, i: number) => [
		d
			.selectFrom(users)
			.where('bench_users.id', ((i * 7919) % 1_000_000) + 1)
			.select(['bench_users.name'])
			.takeFirst(),
		d.insertInto(writes).values({ name: `batch ${i}`, score: 1 }),
		d
			.update(upd)
			.set({ score: i })
			.where('bench_upd.id', ((i * 7919) % 100_000) + 1),
	];
	const run = async (d: any, mode: 'seq' | 'all' | 'batch', i: number) => {
		const qs = statements(d, i);
		if (mode === 'batch') return d.batch(qs);
		if (mode === 'all') return Promise.all(qs.map((x: any) => x.execute()));
		const out = [];
		for (const x of qs) out.push(await x.execute());
		return out;
	};
	return {
		name: 'quarry-db',
		query: () =>
			Promise.reject(new Error('quarry-db runs builder scenarios only')),
		transaction: () =>
			Promise.reject(new Error('quarry-db runs builder scenarios only')),
		builderBatch: (mode, inTransaction, i) =>
			!inTransaction
				? run(db, mode, i)
				: mode === 'batch'
					? db.batch(statements(db, i), { transaction: true })
					: db.transaction((tx: any) => run(tx, mode, i)),
		end: () => db.close(),
	};
}

// ---------------------------------------------------------------- pg, pg-native

async function pgDriver(
	o: DriverOptions,
	v: { named: boolean; native?: boolean },
): Promise<Driver> {
	const pg = (await import('pg')).default;
	const Pool = v.native ? pg.native!.Pool : pg.Pool;
	const t = o.target;
	const config: Record<string, unknown> = v.native
		? {
				connectionString: targetUrl(
					t,
					t.caFile
						? `?sslmode=verify-full&sslrootcert=${t.caFile}`
						: '?sslmode=disable',
				),
			}
		: {
				host: t.host,
				port: t.port,
				user: t.user,
				password: t.password,
				database: t.database,
				ssl: t.caFile ? { ca: readFileSync(t.caFile, 'utf8') } : false,
			};
	const pool = new Pool({ ...config, max: o.max });
	pool.on('error', () => {});
	const names = new Map<string, string>();
	const q = (
		client: { query: (...a: any[]) => Promise<any> },
		text: string,
		values?: unknown[],
	) => {
		if (!v.named) return client.query(text, values);
		let name = names.get(text);
		if (name === undefined) names.set(text, (name = `q${names.size}`));
		return client.query({ name, text, values });
	};
	let sp = 0;
	const wrap = (client: any): Tx => ({
		query: async (sql, params) => (await q(client, sql, params)).rows,
		savepoint: async (fn) => {
			const name = `sp${sp++}`;
			await client.query(`savepoint ${name}`);
			try {
				await fn(wrap(client));
				await client.query(`release savepoint ${name}`);
			} catch (error) {
				await client.query(`rollback to savepoint ${name}`);
				throw error;
			}
		},
	});
	const driver: Driver = {
		name: v.native ? 'pg-native' : 'pg',
		query: async (sql, params) => (await q(pool, sql, params)).rows,
		transaction: async (fn) => {
			const client = await pool.connect();
			try {
				await client.query('begin');
				await fn(wrap(client));
				await client.query('commit');
			} catch (error) {
				await client.query('rollback').catch(() => {});
				throw error;
			} finally {
				client.release();
			}
		},
		listen: async (channel, handler) => {
			const client = await pool.connect();
			client.on('notification', (n: { payload?: string }) =>
				handler(n.payload ?? ''),
			);
			await client.query(`listen ${channel}`);
			return async () => {
				await client.query(`unlisten ${channel}`);
				client.release();
			};
		},
		end: () => pool.end(),
	};
	if (v.native) {
		return {
			...driver,
			cancellable: async (sql) => {
				const client: any = await pool.connect();
				const done = client.query(sql).finally(() => client.release());
				return { done, cancel: () => client.native.cancel(() => {}) };
			},
		};
	}
	return {
		...driver,
		copyFrom: async (sql, chunks) => {
			const { from } = await import('pg-copy-streams');
			const client = await pool.connect();
			try {
				await pipeline(Readable.from(chunks), client.query(from(sql)));
			} finally {
				client.release();
			}
		},
		stream: async (sql, params, batchSize, onBatch) => {
			const Cursor = (await import('pg-cursor')).default;
			const client = await pool.connect();
			const cursor = client.query(new Cursor(sql, params));
			try {
				for (;;) {
					const rows = await cursor.read(batchSize);
					if (rows.length === 0) break;
					await onBatch(rows);
				}
			} finally {
				await cursor.close();
				client.release();
			}
		},
		cancellable: async (sql) => {
			const client: any = await pool.connect();
			const done = client.query(sql).finally(() => client.release());
			// pg's cancel API: Client#cancel(client, query) opens a connection and sends CancelRequest
			return {
				done,
				cancel: () => new pg.Client(config).cancel(client, client.activeQuery),
			};
		},
	};
}

// ---------------------------------------------------------------- postgres.js

async function postgresJs(
	o: DriverOptions,
	v: { prepare: boolean },
): Promise<Driver> {
	const postgres = (await import('postgres')).default;
	const t = o.target;
	const sql = postgres({
		host: t.host,
		port: t.port,
		user: t.user,
		...(t.password ? { password: t.password } : {}),
		database: t.database,
		ssl: t.caFile ? { ca: readFileSync(t.caFile, 'utf8') } : false,
		max: o.max,
		prepare: v.prepare,
		onnotice: () => {},
	});
	const wrap = (tx: any): Tx => ({
		query: (s, p) => tx.unsafe(s, p ?? [], { prepare: v.prepare }),
		savepoint: (fn) => tx.savepoint((sp: any) => fn(wrap(sp))),
	});
	return {
		name: 'postgres.js',
		query: (s, p) =>
			sql.unsafe(s, (p ?? []) as never[], {
				prepare: v.prepare,
			}) as unknown as Promise<Row[]>,
		transaction: async (fn) => {
			await sql.begin((tx) => fn(wrap(tx)));
		},
		copyFrom: async (s, chunks) => {
			const writable = await sql.unsafe(s).writable();
			await pipeline(Readable.from(chunks), writable);
		},
		stream: async (s, params, batchSize, onBatch) => {
			for await (const rows of sql
				.unsafe(s, params as never[], { prepare: v.prepare })
				.cursor(batchSize))
				await onBatch(rows);
		},
		listen: async (channel, handler) => {
			const subscription = await sql.listen(channel, (payload) =>
				handler(payload),
			);
			return () => subscription.unlisten();
		},
		cancellable: async (s) => {
			const query = sql.unsafe(s);
			const done = query.then((r) => r);
			return {
				done,
				cancel: () => {
					query.cancel();
				},
			};
		},
		end: () => sql.end({ timeout: 5 }),
	};
}

// ---------------------------------------------------------------- Bun.sql

const bunTx = (tx: any): Tx => ({
	query: (s, p) => tx.unsafe(s, p ?? []),
	savepoint: (fn) => tx.savepoint((sp: any) => fn(bunTx(sp))),
});

async function bunSql(
	o: DriverOptions,
	v: { prepare: boolean },
): Promise<Driver> {
	const { SQL } = Reflect.get(globalThis, 'Bun') as { SQL: any };
	const t = o.target;
	const sql = new SQL({
		hostname: t.host,
		port: t.port,
		username: t.user,
		...(t.password ? { password: t.password } : {}),
		database: t.database,
		...(t.caFile
			? {
					tls: { ca: readFileSync(t.caFile, 'utf8'), rejectUnauthorized: true },
				}
			: { tls: false }),
		max: o.max,
		prepare: v.prepare,
	});
	const driver: Driver = {
		name: 'bun.sql',
		query: (s, p) => sql.unsafe(s, p ?? []),
		// JS arrays through sql.array(); int4[] as a literal, since
		// sql.array(…, 'int4') fails with "insufficient data left in message"
		queryTyped: (s, p, types) =>
			sql.unsafe(
				s,
				p.map((value, i) =>
					!Array.isArray(value)
						? value
						: types[i] === 1007
							? `{${value.join(',')}}`
							: sql.array(
									value,
									({ 1009: 'text', 1022: 'float8' } as Record<number, string>)[
										types[i]!
									],
								),
				),
			),
		transaction: async (fn) => {
			await sql.begin((tx: any) => fn(bunTx(tx)));
		},
		listen: async (channel, handler) => {
			const subscription = await sql.listen(channel, (payload: string) =>
				handler(payload),
			);
			return () => subscription.unlisten();
		},
		cancellable: async (s) => {
			const query = sql.unsafe(s);
			const done = query.then((r: unknown) => r);
			return { done, cancel: () => query.cancel() };
		},
		end: () => sql.close({ timeout: 5 }),
	};
	return driver;
}

// ---------------------------------------------------------------- @neondatabase/serverless

async function neon(
	o: DriverOptions,
	v: { coalesceWrites: boolean },
): Promise<Driver> {
	const { Pool, neonConfig } = await import('@neondatabase/serverless');
	const ws = (await import('ws')).default;
	neonConfig.webSocketConstructor = ws;
	neonConfig.coalesceWrites = v.coalesceWrites;
	neonConfig.wsProxy = (host: string, port: number | string) =>
		`127.0.0.1:${PORTS.wsproxy}/v1?address=${host}:${port}`;
	neonConfig.useSecureWebSocket = false;
	neonConfig.pipelineTLS = false;
	neonConfig.pipelineConnect = false;
	neonConfig.forceDisablePgSSL = true;
	const t = o.target;
	const pool = new Pool({
		host: t.host,
		port: t.port,
		user: t.user,
		password: t.password ?? '',
		database: t.database,
		max: o.max,
	});
	pool.on('error', () => {});
	let sp = 0;
	const wrap = (client: any): Tx => ({
		query: async (s, p) => (await client.query(s, p)).rows,
		savepoint: async (fn) => {
			const name = `sp${sp++}`;
			await client.query(`savepoint ${name}`);
			await fn(wrap(client));
			await client.query(`release savepoint ${name}`);
		},
	});
	return {
		name: 'neon',
		query: async (s, p) => (await pool.query(s, p)).rows,
		transaction: async (fn) => {
			const client = await pool.connect();
			try {
				await client.query('begin');
				await fn(wrap(client));
				await client.query('commit');
			} catch (error) {
				await client.query('rollback').catch(() => {});
				throw error;
			} finally {
				client.release();
			}
		},
		listen: async (channel, handler) => {
			const client = await pool.connect();
			client.on('notification', (n: { payload?: string }) =>
				handler(n.payload ?? ''),
			);
			await client.query(`listen ${channel}`);
			return async () => {
				await client.query(`unlisten ${channel}`);
				client.release();
			};
		},
		end: () => pool.end(),
	};
}

// ---------------------------------------------------------------- deno-postgres

function noDelayDenoConnect(): void {
	const deno = Reflect.get(globalThis, 'Deno') as {
		connect: (o: unknown) => Promise<{ setNoDelay(on: boolean): void }>;
	};
	const original = deno.connect.bind(deno);
	Object.defineProperty(deno, 'connect', {
		configurable: true,
		value: async (options: unknown) => {
			const conn = await original(options);
			conn.setNoDelay(true);
			return conn;
		},
	});
}

async function denoPostgres(o: DriverOptions): Promise<Driver> {
	const spec = 'jsr:@db/postgres@0.19.5';
	const { Pool } = await import(spec);
	const t = o.target;
	const pool = new Pool(
		{
			hostname: t.host,
			port: t.port,
			user: t.user,
			password: t.password,
			database: t.database,
			tls: t.caFile
				? {
						enabled: true,
						enforce: true,
						caCertificates: [readFileSync(t.caFile, 'utf8')],
					}
				: { enabled: false },
		},
		o.max,
		true,
	);
	let n = 0;
	const wrap = (tx: any): Tx => ({
		query: async (s, p) => (await tx.queryObject(s, p)).rows,
		savepoint: async (fn) => {
			const sp = await tx.savepoint(`sp${n++}`);
			await fn(wrap(tx));
			await sp.release();
		},
	});
	return {
		name: 'deno-postgres',
		query: async (s, p) => {
			const client = await pool.connect();
			try {
				return (await client.queryObject(s, p)).rows;
			} finally {
				client.release();
			}
		},
		transaction: async (fn) => {
			const client = await pool.connect();
			try {
				const tx = client.createTransaction(`t${n++}`);
				await tx.begin();
				await fn(wrap(tx));
				await tx.commit();
			} finally {
				client.release();
			}
		},
		end: () => pool.end(),
	};
}

// ---------------------------------------------------------------- single connections

/** Opens one connection, runs `select 1`, closes it: the connect cost of each client. */
export async function connectOnce(name: string, t: Target): Promise<void> {
	const base = name.replace(
		/-(named|noprep|lossless|nopipe|default|candidate)$/,
		'',
	);
	const ca = t.caFile ? readFileSync(t.caFile, 'utf8') : undefined;
	switch (base) {
		case 'quarry': {
			const dist =
				name === 'quarry-candidate'
					? process.env['QUARRY_DIST_CANDIDATE']
					: QUARRY_DIST;
			if (dist === undefined)
				throw new Error('QUARRY_DIST_CANDIDATE is not set');
			const d = await import(
				dist.startsWith('/') ? new URL(`file://${dist}`).href : dist
			);
			const conn = await d.connect({
				host: t.host,
				port: t.port,
				user: t.user,
				password: t.password,
				database: t.database,
				env: {},
				ssl: ca ? { mode: 'verify-full', ca } : 'disable',
			});
			await conn.query('select 1');
			await conn.close();
			return;
		}
		case 'pg':
		case 'pg-native': {
			const pg = (await import('pg')).default;
			const Client = base === 'pg-native' ? pg.native!.Client : pg.Client;
			const client =
				base === 'pg-native'
					? new Client({
							connectionString: targetUrl(
								t,
								ca
									? `?sslmode=verify-full&sslrootcert=${t.caFile}`
									: '?sslmode=disable',
							),
						})
					: new Client({
							host: t.host,
							port: t.port,
							user: t.user,
							password: t.password,
							database: t.database,
							ssl: ca ? { ca } : false,
						});
			await client.connect();
			await client.query('select 1');
			await client.end();
			return;
		}
		case 'postgres.js': {
			const postgres = (await import('postgres')).default;
			const sql = postgres({
				host: t.host,
				port: t.port,
				user: t.user,
				...(t.password ? { password: t.password } : {}),
				database: t.database,
				ssl: ca ? { ca } : false,
				max: 1,
				onnotice: () => {},
			});
			await sql`select 1`;
			await sql.end();
			return;
		}
		case 'bun.sql': {
			const { SQL } = Reflect.get(globalThis, 'Bun') as { SQL: any };
			const sql = new SQL({
				hostname: t.host,
				port: t.port,
				username: t.user,
				...(t.password ? { password: t.password } : {}),
				database: t.database,
				...(ca ? { tls: { ca, rejectUnauthorized: true } } : { tls: false }),
				max: 1,
			});
			await sql`select 1`;
			await sql.close();
			return;
		}
		case 'neon': {
			const { Client, neonConfig } = await import('@neondatabase/serverless');
			neonConfig.webSocketConstructor = (await import('ws')).default;
			neonConfig.wsProxy = (host: string, port: number | string) =>
				`127.0.0.1:${PORTS.wsproxy}/v1?address=${host}:${port}`;
			neonConfig.useSecureWebSocket = false;
			neonConfig.coalesceWrites = false;
			neonConfig.pipelineConnect = false;
			neonConfig.forceDisablePgSSL = true;
			const client = new Client({
				host: t.host,
				port: t.port,
				user: t.user,
				password: t.password ?? '',
				database: t.database,
			});
			await client.connect();
			await client.query('select 1');
			await client.end();
			return;
		}
		case 'deno-postgres':
		case 'deno-postgres-nodelay': {
			if (base === 'deno-postgres-nodelay') noDelayDenoConnect();
			const spec = 'jsr:@db/postgres@0.19.5';
			const { Client } = await import(spec);
			const client = new Client({
				hostname: t.host,
				port: t.port,
				user: t.user,
				password: t.password,
				database: t.database,
				tls: ca
					? { enabled: true, enforce: true, caCertificates: [ca] }
					: { enabled: false },
			});
			await client.connect();
			await client.queryArray('select 1');
			await client.end();
			return;
		}
		default:
			throw new Error(`no connectOnce for ${name}`);
	}
}

export const defaultTarget = (port = PORTS.postgres): Target => ({
	host: '127.0.0.1',
	port,
	user: USERS.trust,
	database: USERS.database,
});
