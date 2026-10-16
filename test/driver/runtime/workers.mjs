/* oxlint-disable no-console -- a script that reports to the console */
/**
 * Runs the built driver (dist/driver/index.js) inside workerd, Cloudflare
 * Workers' runtime, through Miniflare, against the test cluster. Needs
 * `pnpm build` first and Miniflare 4 installed somewhere (MINIFLARE_FROM, a
 * directory where `miniflare@4` is installed; the 5.x alphas take
 * different options):
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
import { arrayOf, cloudflareSockets, codecs, connect, createPool, QueryCanceled, typed } from './driver/index.js';

async function check(results, name, fn) {
	try { await fn(); results.push(['ok', name]); }
	catch (error) { results.push(['FAIL', name, String(error && error.stack || error)]); }
}
function assert(c, m) { if (!c) throw new Error(m); }

// message types in data, calling visit for each complete one; returns where the incomplete tail starts
function messageTypes(data, visit) {
	let i = 0;
	while (i + 5 <= data.length) {
		const length = new DataView(data.buffer, data.byteOffset + i + 1, 4).getUint32(0);
		if (i + 1 + length > data.length) break;
		visit(data[i]);
		i += 1 + length;
	}
	return i;
}

// cloudflare:sockets, watched for writes made while the buffer is full and, with delay, a simulated round trip
function watched(delay = 0) {
	const stats = { full: 0, drains: 0, writtenWhileFull: 0, largestWrite: 0, maxInFlight: 0 };
	const factory = {
		async connect(o) {
			const socket = await cloudflareSockets.connect(o);
			let started = false, ready = false, full = false, inFlight = 0;
			let pending = new Uint8Array(0);
			return {
				get encrypted() { return socket.encrypted; },
				write(data) {
					if (full) stats.writtenWhileFull += data.length;
					stats.largestWrite = Math.max(stats.largestWrite, data.length);
					if (started) messageTypes(data, (type) => { if (type === 0x53) inFlight++; });
					started = true;
					stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
					const ok = socket.write(data);
					if (!ok) { full = true; stats.full++; }
					return ok;
				},
				startTls: (t) => socket.startTls(t),
				peerCertificate: () => socket.peerCertificate(),
				pause: () => socket.pause(),
				resume: () => socket.resume(),
				end: () => socket.end(),
				destroy: () => socket.destroy(),
				onData: (h) => socket.onData((data) => {
					const copy = data.slice();
					const deliver = () => {
						const all = new Uint8Array(pending.length + copy.length);
						all.set(pending);
						all.set(copy, pending.length);
						pending = all.slice(messageTypes(all, (type) => {
							if (type !== 0x5a) return;
							if (ready) inFlight--;
							ready = true;
						}));
						h(copy);
					};
					if (delay > 0) setTimeout(deliver, delay);
					else deliver();
				}),
				onClose: (h) => socket.onClose(() => setTimeout(h, delay)),
				onError: (h) => socket.onError(h),
				onDrain: (h) => socket.onDrain(() => { full = false; stats.drains++; h(); }),
			};
		},
	};
	return { factory, stats };
}

export default {
	async fetch(request) {
		const c = JSON.parse(new URL(request.url).searchParams.get('cfg'));
		const base = { host: c.host, port: c.port, database: c.database, user: c.users.scram.user, password: c.users.scram.password, ssl: 'disable', env: {} };
		const results = [];
		await check(results, 'navigator.userAgent picks cloudflare:sockets', async () => {
			assert(navigator.userAgent === 'Cloudflare-Workers', navigator.userAgent);
		});
		await check(results, 'codecs: typed parameters, binary results from the first run, without generated code', async () => {
			const conn = await connect(base);
			const { rows, fields } = await conn.query(
				'select $1::int4[] as ids, $2::timestamptz as at, $3::text[] as tags',
				[typed([1, null, 3], arrayOf(codecs.int4)), typed(new Date(Date.UTC(2024, 5, 1)), codecs.timestamptz), typed(['a', 'b c'], arrayOf(codecs.text))],
				{ resultCodecs: [arrayOf(codecs.int4), codecs.timestamptz, arrayOf(codecs.text)] },
			);
			const row = rows[0];
			assert(JSON.stringify(row.ids) === '[1,null,3]' && row.at.getTime() === Date.UTC(2024, 5, 1) && JSON.stringify(row.tags) === '["a","b c"]', JSON.stringify(row));
			assert(fields.map((f) => f.format).join() === '1,1,1', fields.map((f) => f.format).join());
			await conn.close();
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
		await check(results, 'backpressure: nothing written while the socket is full', async () => {
			const { factory, stats } = watched();
			const conn = await connect({ ...base, socket: factory });
			const big = 'x'.repeat(512 * 1024);
			const pending = [];
			for (let i = 0; i < 32; i++) {
				pending.push(conn.query('select length($1)::int as n, $2::int as i', [big, i]));
				await Promise.resolve();
			}
			const rows = (await Promise.all(pending)).map((r) => r.rows[0]);
			assert(rows.every((r, i) => r.n === big.length && r.i === i), 'wrong rows');
			assert(stats.full > 0 && stats.drains > 0, JSON.stringify(stats));
			assert(stats.writtenWhileFull === 0, JSON.stringify(stats));
			assert(stats.largestWrite < 1024 * 1024, JSON.stringify(stats));
			await conn.close();
		});
		await check(results, 'pool deepens its pipeline at a simulated round trip', async () => {
			const { factory, stats } = watched(10);
			const pool = createPool({ ...base, max: 1, socket: factory });
			const values = await Promise.all(Array.from({ length: 600 }, async (_, caller) => {
				const seen = [];
				for (let k = 0; k < 4; k++) seen.push((await pool.query('select $1::int as v', [caller * 4 + k])).rows[0].v);
				return seen;
			}));
			assert(values.flat().every((v, i) => v === i), 'wrong rows');
			assert(stats.maxInFlight > 300, JSON.stringify(stats));
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
