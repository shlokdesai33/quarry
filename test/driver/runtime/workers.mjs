/* oxlint-disable no-console -- a script that reports to the console */
/**
 * Runs the built driver (dist/driver/index.js) inside workerd, Cloudflare
 * Workers' runtime, through Miniflare, against the test cluster. Needs
 * `pnpm build` first and Miniflare installed somewhere (MINIFLARE_FROM, a
 * directory where `miniflare` is installed):
 *
 *   MINIFLARE_FROM=/tmp/cf node test/driver/runtime/workers.mjs [info.json]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const from = process.env.MINIFLARE_FROM;
if (!from)
	throw new Error(
		'Set MINIFLARE_FROM to a directory where miniflare is installed',
	);
const { Miniflare } = await import(
	pathToFileURL(createRequire(`${from}/`).resolve('miniflare')).href
);

let info;
let stop;
if (process.argv[2]) {
	info = JSON.parse(readFileSync(process.argv[2], 'utf8'));
} else {
	await import('../../../bench/driver/register.mjs');
	const { findBinDir, startCluster } = await import('../setup/cluster.ts');
	const cluster = await startCluster(findBinDir());
	info = cluster.info;
	stop = () => cluster.stop();
}

const worker = `
import { connect, createPool, QueryCanceled } from './driver/index.js';

async function check(results, name, fn) {
	try { await fn(); results.push(['ok', name]); }
	catch (error) { results.push(['FAIL', name, String(error && error.stack || error)]); }
}
function assert(c, m) { if (!c) throw new Error(m); }

export default {
	async fetch(request) {
		const c = JSON.parse(new URL(request.url).searchParams.get('cfg'));
		const base = { host: c.host, port: c.port, database: c.database, user: c.users.scram.user, password: c.users.scram.password, ssl: 'disable', env: {} };
		const results = [];
		await check(results, 'navigator.userAgent picks cloudflare:sockets', async () => {
			assert(navigator.userAgent === 'Cloudflare-Workers', navigator.userAgent);
		});
		await check(results, 'SCRAM and typed rows', async () => {
			const conn = await connect(base);
			const { rows } = await conn.query('select $1::int + 1 as n, $2::text as t, now() as ts', [41, 'é']);
			assert(rows[0].n === 42 && rows[0].t === 'é', JSON.stringify(rows));
			assert(conn.protocol === '3.2', conn.protocol);
			await conn.close();
		});
		await check(results, 'pool with pipelining (rows built without new Function)', async () => {
			const pool = createPool({ ...base, max: 2 });
			const all = await Promise.all(Array.from({ length: 100 }, (_, i) => pool.query('select $1::int as v', [i])));
			assert(all.every((r, i) => r.rows[0].v === i), 'wrong rows');
			await pool.end();
		});
		await check(results, 'cursor and COPY', async () => {
			const conn = await connect(base);
			let n = 0;
			for await (const batch of conn.cursor('select generate_series(1, 2500) as n', [], { batchSize: 1000 })) n += batch.length;
			assert(n === 2500, String(n));
			await conn.query('create temp table w (id int)');
			assert((await conn.copyRows('copy w from stdin', [[1], [2], [3]])) === 3, 'copy');
			await conn.close();
		});
		await check(results, 'cancel with an AbortSignal', async () => {
			const conn = await connect(base);
			const controller = new AbortController();
			setTimeout(() => controller.abort(), 100);
			const error = await conn.query('select pg_sleep(5)', [], { signal: controller.signal }).catch((e) => e);
			assert(error instanceof QueryCanceled, String(error));
			await conn.query('select 1');
			await conn.close();
		});
		await check(results, 'LISTEN / NOTIFY', async () => {
			const listener = await connect(base);
			const notifier = await connect(base);
			const received = new Promise((resolve) => listener.listen('cf', (n) => resolve(n.payload)));
			await new Promise((r) => setTimeout(r, 50));
			await notifier.notify('cf', 'hi');
			assert((await received) === 'hi', 'no notification');
			await listener.close();
			await notifier.close();
		});
		await check(results, 'clear errors for what Workers cannot do', async () => {
			const error = await connect({ ...base, ssl: { mode: 'verify-full', ca: 'x' } }).catch((e) => e);
			assert(/Custom CA certificates are not supported/.test(String(error)), String(error));
		});
		return Response.json(results);
	},
};
`;

// every built module, since the driver entry shares chunks with the others
const dist = new URL('../../../dist/', import.meta.url);
const builtModules = readdirSync(dist, { recursive: true })
	.filter((file) => String(file).endsWith('.js'))
	.map((file) => ({
		type: 'ESModule',
		path: String(file),
		contents: readFileSync(new URL(String(file), dist), 'utf8'),
	}));
const mf = new Miniflare({
	modules: [
		{ type: 'ESModule', path: 'worker.mjs', contents: worker },
		...builtModules,
	],
	compatibilityDate: '2025-09-01',
});
let failed = 0;
try {
	const response = await mf.dispatchFetch(
		`http://localhost/?cfg=${encodeURIComponent(JSON.stringify(info))}`,
	);
	const text = await response.text();
	let results;
	try {
		results = JSON.parse(text);
	} catch {
		throw new Error(`The worker failed: ${text.slice(0, 2000)}`);
	}
	console.log('runtime: workerd (Cloudflare Workers)');
	for (const [status, name, detail] of results) {
		console.log(
			`${status === 'ok' ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`,
		);
		if (status !== 'ok') failed++;
	}
} finally {
	await mf.dispose();
	await stop?.();
}
console.log(failed === 0 ? 'all passed' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
