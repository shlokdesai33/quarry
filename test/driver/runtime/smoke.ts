/* oxlint-disable no-console, no-await-in-loop -- a script that reports to the console */
/**
 * Runtime smoke test: the same checks under Node, Bun and Deno. Starts a
 * throwaway cluster with the test harness, or uses a running one described
 * by a JSON file (`TestCluster`). `pnpm test:runtimes` runs all three.
 *
 *   node --import ./bench/driver/register.mjs test/driver/runtime/smoke.ts [info.json]
 *   bun test/driver/runtime/smoke.ts [info.json]
 *   deno run -A --sloppy-imports --no-lock test/driver/runtime/smoke.ts [info.json]
 *
 * Exits non-zero if any check fails.
 */
import { readFileSync } from 'node:fs';
import { connect } from '../../../src/driver/connect.js';
import { QueryCanceled } from '../../../src/driver/errors.js';
import { createPool } from '../../../src/driver/pool.js';
import type { ConnectionOptions } from '../../../src/driver/config.js';
import {
	findBinDir,
	startCluster,
	type TestCluster,
} from '../setup/cluster.js';

const runtime =
	'Bun' in globalThis ? 'bun' : 'Deno' in globalThis ? 'deno' : 'node';
const file = process.argv[2];
let stop: (() => Promise<void>) | undefined;
let c: TestCluster;
if (file === undefined) {
	const bin = findBinDir();
	if (bin === undefined)
		throw new Error('No PostgreSQL found; pass a cluster info file');
	const cluster = await startCluster(bin);
	stop = () => cluster.stop();
	c = cluster.info;
} else {
	c = JSON.parse(readFileSync(file, 'utf8'));
}
const base: ConnectionOptions = {
	host: c.host,
	port: c.port,
	database: c.database,
	user: c.users.scram.user,
	password: c.users.scram.password,
	ssl: 'disable',
	env: {},
};

let failed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
		console.log(`ok   ${name}`);
	} catch (error) {
		failed++;
		console.log(
			`FAIL ${name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
		);
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

console.log(`runtime: ${runtime}`);

await check('SCRAM over TCP, typed rows', async () => {
	await using conn = await connect(base);
	const { rows } = await conn.query<{ n: number; t: string }>(
		'select $1::int + 1 as n, $2::text as t',
		[41, 'é😀'],
	);
	assert(rows[0]?.n === 42 && rows[0].t === 'é😀', JSON.stringify(rows));
	assert(conn.protocol === '3.2', conn.protocol);
});

await check(
	'TLS with SCRAM-SHA-256-PLUS (channel binding required)',
	async () => {
		await using conn = await connect({
			...base,
			ssl: { mode: 'verify-full', ca: c.ca },
			host: 'localhost',
			channelBinding: 'require',
		});
		const { rows } = await conn.query<{ ssl: boolean }>(
			'select ssl from pg_stat_ssl where pid = pg_backend_pid()',
		);
		assert(rows[0]?.ssl === true, 'not encrypted');
	},
);

await check('direct TLS', async () => {
	await using conn = await connect({
		...base,
		ssl: { mode: 'require', negotiation: 'direct' },
	});
	await conn.query('select 1');
});

await check('client certificate', async () => {
	await using conn = await connect({
		...base,
		user: c.users.cert.user,
		password: undefined,
		ssl: { mode: 'require', cert: c.client.cert, key: c.client.key },
	});
	const { rows } = await conn.query<{ u: string }>('select current_user as u');
	assert(rows[0]?.u === 'cert_user', JSON.stringify(rows));
});

await check('cancel with an AbortSignal', async () => {
	await using conn = await connect(base);
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 100);
	const error = await conn
		.query('select pg_sleep(5)', [], { signal: controller.signal })
		.catch((e: unknown) => e);
	assert(
		error instanceof QueryCanceled && error.reason === 'abort',
		String(error),
	);
	await conn.query('select 1');
});

await check('cursor, COPY in and out', async () => {
	await using conn = await connect(base);
	let total = 0;
	for await (const batch of conn.cursor<{ n: number }>(
		'select generate_series(1, 2500) as n',
		[],
		{ batchSize: 1000 },
	)) {
		total += batch.length;
	}
	assert(total === 2500, String(total));
	await conn.query('create temp table smoke (id int, v text)');
	const copied = await conn.copyFrom('copy smoke from stdin', [
		'1\ta\n',
		'2\tb\n',
	]);
	assert(copied === 2, String(copied));
	let out = '';
	for await (const chunk of conn.copyTo('copy smoke to stdout'))
		out += new TextDecoder().decode(chunk);
	assert(out === '1\ta\n2\tb\n', JSON.stringify(out));
});

await check('pool with pipelining', async () => {
	await using pool = createPool({ ...base, max: 2 });
	const results = await Promise.all(
		Array.from({ length: 200 }, (_, i) =>
			pool.query<{ v: number }>('select $1::int as v', [i]),
		),
	);
	assert(
		results.every((r, i) => r.rows[0]?.v === i),
		'wrong results',
	);
	assert(pool.stats.total <= 2, String(pool.stats.total));
});

await check('LISTEN / NOTIFY', async () => {
	await using listener = await connect(base);
	await using notifier = await connect(base);
	const received = new Promise<string>(
		(resolve) => void listener.listen('smoke', (n) => resolve(n.payload)),
	);
	await new Promise((r) => setTimeout(r, 50));
	await notifier.notify('smoke', 'hi');
	assert((await received) === 'hi', 'no notification');
});

await stop?.();
console.log(failed === 0 ? 'all passed' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
