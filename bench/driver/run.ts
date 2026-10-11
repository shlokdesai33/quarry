/**
 * Driver benchmark: quarry's driver against pg and postgres.js, on the same
 * server, with the same pool size. Run with:
 *
 *   node --import ./bench/driver/register.mjs bench/driver/run.ts [--url postgres://…] [--runs 3] [--only quarry,pg]
 *
 * Without `--url` it starts a throwaway cluster with the test harness
 * (PG_VERSION / PG_BIN pick the server). Prints a markdown table of the
 * median of `--runs` runs per scenario. Under Bun it adds `Bun.sql`; with
 * `PG_NATIVE_FROM=<dir>` (a directory where `pg` and `pg-native` are
 * installed and built) it adds pg-native.
 */
import { createRequire } from 'node:module';
import { Pool as PgPool } from 'pg';
import postgres from 'postgres';
import { createPool } from '../../src/driver/pool.ts';
import { quarryTypes } from '../../src/driver/quarry-types.ts';
import { findBinDir, startCluster } from '../../test/driver/setup/cluster.ts';

const args = process.argv.slice(2);
const arg = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const runs = Number(arg('runs') ?? 3);
const only = arg('only')?.split(',');
const POOL = 10;

interface Adapter {
	readonly name: string;
	query(sql: string, params?: unknown[]): Promise<unknown[]>;
	end(): Promise<void>;
}

function adapters(url: string): Adapter[] {
	const ours = createPool({
		connectionString: url,
		max: POOL,
		ssl: 'disable',
		env: {},
	});
	// decodes timestamptz to Date, as pg and postgres.js do, for a like-for-like comparison
	const oursDates = createPool({
		connectionString: url,
		max: POOL,
		ssl: 'disable',
		env: {},
		types: quarryTypes,
	});
	const pgPool = new PgPool({ connectionString: url, max: POOL });
	const sql = postgres(url, { max: POOL, prepare: true, onnotice: () => {} });
	const all: Adapter[] = [
		{
			name: 'quarry',
			query: async (text, params = []) => (await ours.query(text, params)).rows,
			end: () => ours.end(),
		},
		{
			name: 'quarry (Dates)',
			query: async (text, params = []) =>
				(await oursDates.query(text, params)).rows,
			end: () => oursDates.end(),
		},
		{
			name: 'pg',
			query: async (text, params = []) =>
				(await pgPool.query(text, params)).rows,
			end: () => pgPool.end(),
		},
		{
			name: 'postgres.js',
			query: async (text, params = []) => [
				...(await sql.unsafe(text, params as never[], { prepare: true })),
			],
			end: () => sql.end(),
		},
	];
	// pg-native (libpq), from wherever it was built: it needs a native toolchain
	const nativeFrom = process.env['PG_NATIVE_FROM'];
	if (nativeFrom !== undefined) {
		const NativePool = createRequire(`${nativeFrom}/`)('pg').native
			.Pool as typeof PgPool;
		const nativePool = new NativePool({ connectionString: url, max: POOL });
		all.push({
			name: 'pg-native',
			query: async (text, params = []) =>
				(await nativePool.query(text, params)).rows,
			end: () => nativePool.end(),
		});
	}
	// Bun's built-in client, when running under Bun
	const bun: unknown = Reflect.get(globalThis, 'Bun');
	if (bun !== undefined) {
		const BunSQL = Reflect.get(bun as object, 'SQL') as new (
			url: string,
			options: object,
		) => {
			unsafe(text: string, params: unknown[]): Promise<unknown[]>;
			close(): Promise<void>;
		};
		const bunSql = new BunSQL(url, { max: POOL });
		all.push({
			name: 'Bun.sql',
			query: async (text, params = []) => [
				...(await bunSql.unsafe(text, params)),
			],
			end: () => bunSql.close(),
		});
	}
	return all.filter((a) => only === undefined || only.includes(a.name));
}

interface Scenario {
	readonly name: string;
	/** What one unit of work is, for the table: singular and plural. */
	readonly unit: readonly [string, string];
	/** Runs the scenario; returns how many units it did. */
	run(adapter: Adapter): Promise<number>;
	/** Report time per unit (latency) rather than units per second. */
	readonly latency?: boolean;
}

const ROWS = 100_000;
let seq = 0;

async function concurrent(
	adapter: Adapter,
	workers: number,
	total: number,
	work: (i: number) => Promise<unknown>,
) {
	let next = 0;
	await Promise.all(
		Array.from({ length: workers }, async () => {
			while (next < total) {
				const i = next++;
				// oxlint-disable-next-line no-await-in-loop
				await work(i);
			}
		}),
	);
	return total;
}

const scenarios: Scenario[] = [
	{
		name: 'select 1, sequential',
		unit: ['query', 'queries'],
		latency: true,
		run: (a) => concurrent(a, 1, 3000, () => a.query('select 1 as x')),
	},
	{
		name: 'point lookup, sequential',
		unit: ['query', 'queries'],
		latency: true,
		run: (a) =>
			concurrent(a, 1, 3000, (i) =>
				a.query('select * from bench_users where id = $1', [
					((i * 7919) % ROWS) + 1,
				]),
			),
	},
	...[1, 10, 100].map((c): Scenario => ({
		name: `point lookup, concurrency ${c}`,
		unit: ['query', 'queries'],
		run: (a) =>
			concurrent(a, c, c === 1 ? 3000 : 20_000, (i) =>
				a.query('select * from bench_users where id = $1', [
					((i * 7919) % ROWS) + 1,
				]),
			),
	})),
	{
		name: 'fetch 1k rows',
		unit: ['fetch', 'fetches'],
		run: (a) =>
			concurrent(a, 1, 200, () =>
				a.query('select * from bench_users where id <= 1000'),
			),
	},
	{
		name: 'fetch 1k rows, concurrency 10',
		unit: ['fetch', 'fetches'],
		run: (a) =>
			concurrent(a, 10, 1000, () =>
				a.query('select * from bench_users where id <= 1000'),
			),
	},
	{
		name: 'fetch 100k rows',
		unit: ['fetch', 'fetches'],
		latency: true,
		run: (a) => concurrent(a, 1, 5, () => a.query('select * from bench_users')),
	},
	{
		name: 'insert one row, sequential',
		unit: ['insert', 'inserts'],
		latency: true,
		run: (a) =>
			concurrent(a, 1, 2000, () =>
				a.query(
					'insert into bench_writes (name, score, created) values ($1, $2, $3)',
					[`n${seq++}`, 1.5, '2024-01-01 00:00:00+00'],
				),
			),
	},
	{
		name: 'insert one row, concurrency 100',
		unit: ['insert', 'inserts'],
		run: (a) =>
			concurrent(a, 100, 20_000, () =>
				a.query(
					'insert into bench_writes (name, score, created) values ($1, $2, $3)',
					[`n${seq++}`, 1.5, '2024-01-01 00:00:00+00'],
				),
			),
	},
	{
		name: 'bulk insert 10k rows (unnest)',
		unit: ['batch', 'batches'],
		latency: true,
		run: (a) =>
			concurrent(a, 1, 5, () => {
				const names = Array.from(
					{ length: 10_000 },
					(_, i) => `bulk ${seq}-${i}`,
				);
				const scores = names.map((_, i) => String(i / 10));
				seq++;
				return a.query(
					'insert into bench_writes (name, score, created) select n, s, now() from unnest($1::text[], $2::float8[]) as t(n, s)',
					[
						`{${names.map((n) => `"${n}"`).join(',')}}`,
						`{${scores.join(',')}}`,
					],
				);
			}),
	},
];

async function setup(url: string) {
	const conn = createPool({
		connectionString: url,
		max: 1,
		ssl: 'disable',
		env: {},
	});
	await conn.simpleQuery(`
		drop table if exists bench_users, bench_writes;
		create table bench_users (id int primary key, name text not null, email text not null, score float8 not null, created timestamptz not null, active bool not null);
		insert into bench_users select i, 'user ' || i, 'user' || i || '@example.com', i / 7.0, '2024-01-01'::timestamptz + i * interval '1 minute', i % 2 = 0 from generate_series(1, ${ROWS}) i;
		create table bench_writes (id bigint generated always as identity primary key, name text, score float8, created timestamptz);
	`);
	// a multi-statement query runs in one implicit transaction, which vacuum refuses
	await conn.simpleQuery('vacuum analyze bench_users');
	await conn.end();
}

const median = (values: number[]) =>
	values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

async function main() {
	let url = arg('url');
	let stop: (() => Promise<void>) | undefined;
	if (url === undefined) {
		const bin = findBinDir();
		if (bin === undefined) throw new Error('No PostgreSQL found; pass --url');
		const cluster = await startCluster(bin);
		stop = () => cluster.stop();
		const c = cluster.info;
		url = `postgres://${c.users.trust.user}@${c.host}:${c.port}/${c.database}?sslmode=disable`;
	}
	try {
		await setup(url);
		const list = adapters(url);
		const results = new Map<string, Map<string, number>>();
		for (const scenario of scenarios) {
			const row = new Map<string, number>();
			for (const adapter of list) {
				await scenario.run(adapter); // warm up
				const samples: number[] = [];
				for (let r = 0; r < runs; r++) {
					const start = performance.now();
					const units = await scenario.run(adapter);
					const ms = performance.now() - start;
					samples.push(scenario.latency ? ms / units : (units / ms) * 1000);
				}
				row.set(adapter.name, median(samples));
			}
			results.set(scenario.name, row);
			console.error(`done: ${scenario.name}`);
		}
		await Promise.all(list.map((a) => a.end()));

		const names = list.map((a) => a.name);
		const lines = [
			`| Scenario | ${names.join(' | ')} |`,
			`|---|${names.map(() => '---:').join('|')}|`,
		];
		for (const scenario of scenarios) {
			const row = results.get(scenario.name);
			const values = names.map((n) => row?.get(n) ?? Number.NaN);
			const best = scenario.latency ? Math.min(...values) : Math.max(...values);
			const cells = values.map((v) => {
				const text = scenario.latency
					? v < 1
						? `${(v * 1000).toFixed(0)} µs`
						: `${v.toFixed(2)} ms`
					: `${Math.round(v).toLocaleString('en-US')}/s`;
				return v === best ? `**${text}**` : text;
			});
			lines.push(
				`| ${scenario.name} (${scenario.latency ? `per ${scenario.unit[0]}` : `${scenario.unit[1]}/s`}) | ${cells.join(' | ')} |`,
			);
		}
		console.log(lines.join('\n'));
	} finally {
		await stop?.();
	}
}

await main();
