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
import { arrayOf, typed } from '../../../src/driver/codec.js';
import { codecs } from '../../../src/driver/codecs.js';
import { connect } from '../../../src/driver/connect.js';
import { QueryCanceled } from '../../../src/driver/errors.js';
import { createPool } from '../../../src/driver/pool.js';
import type { ConnectionOptions } from '../../../src/driver/config.js';
import { nodeSockets } from '../../../src/driver/node-socket.js';
import type {
	DriverSocket,
	SocketFactory,
} from '../../../src/driver/socket.js';
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
	'codecs: typed parameters, binary results from the first run',
	async () => {
		await using conn = await connect(base);
		const range = {
			empty: false,
			lower: new Date(Date.UTC(2024, 0, 1)),
			upper: new Date(Date.UTC(10000, 0, 1)),
			bounds: '[)',
		} as const;
		const { rows, fields } = await conn.query<{
			ids: number[];
			at: Date;
			r: unknown;
			inside: boolean;
			tags: string[];
			bytes: Uint8Array;
		}>(
			'select $1::int4[] as ids, $2::timestamptz as at, $3::tstzrange as r, $3 @> $2 as inside, $4::text[] as tags, $5::bytea as bytes',
			[
				typed([1, null, 3], arrayOf(codecs.int4)),
				typed(new Date(Date.UTC(2024, 5, 1)), codecs.timestamptz),
				typed(range, codecs.tstzrange),
				typed(['a', 'b c', 'é😀'], arrayOf(codecs.text)),
				typed(new Uint8Array([0, 255]), codecs.bytea),
			],
			{
				resultCodecs: [
					arrayOf(codecs.int4),
					codecs.timestamptz,
					codecs.tstzrange,
					codecs.bool,
					arrayOf(codecs.text),
					codecs.bytea,
				],
			},
		);
		const row = rows[0];
		assert(
			JSON.stringify(row?.ids) === '[1,null,3]' &&
				row?.at.getTime() === Date.UTC(2024, 5, 1) &&
				JSON.stringify(row.r) === JSON.stringify(range) &&
				row.inside === true &&
				JSON.stringify(row.tags) === '["a","b c","é😀"]' &&
				row.bytes[1] === 255,
			JSON.stringify(row),
		);
		assert(
			fields.map((f) => f.format).join() === '1,1,0,1,1,1',
			fields.map((f) => f.format).join(),
		);
	},
);

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

/**
 * Wraps the runtime's sockets to watch backpressure (writes made while the
 * buffer is full) and, with `delay`, to simulate a round trip and count the
 * queries in flight.
 */
function watched(delay = 0) {
	const stats = {
		full: 0,
		drains: 0,
		writtenWhileFull: 0,
		largestWrite: 0,
		maxInFlight: 0,
	};
	const factory: SocketFactory = {
		async connect(o) {
			const socket = await nodeSockets.connect(o);
			let started = false;
			let ready = false;
			let full = false;
			let inFlight = 0;
			let pending = new Uint8Array(0);
			const wrapped: DriverSocket = {
				get encrypted() {
					return socket.encrypted;
				},
				write(data) {
					if (full) stats.writtenWhileFull += data.length;
					stats.largestWrite = Math.max(stats.largestWrite, data.length);
					// the startup message has no type byte
					if (started)
						messageTypes(data, (type) => {
							if (type === 0x53) inFlight++;
						});
					started = true;
					stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
					const ok = socket.write(data);
					if (!ok) {
						full = true;
						stats.full++;
					}
					return ok;
				},
				startTls: (t) => socket.startTls(t),
				peerCertificate: () => socket.peerCertificate(),
				pause: () => socket.pause(),
				resume: () => socket.resume(),
				end: () => socket.end(),
				destroy: () => socket.destroy(),
				onData: (h) =>
					socket.onData((data) => {
						const copy = data.slice();
						const deliver = () => {
							const all = new Uint8Array(pending.length + copy.length);
							all.set(pending);
							all.set(copy, pending.length);
							pending = all.slice(
								messageTypes(all, (type) => {
									if (type !== 0x5a) return;
									if (ready) inFlight--;
									ready = true;
								}),
							);
							h(copy);
						};
						if (delay > 0) setTimeout(deliver, delay);
						else deliver();
					}),
				onClose: (h) => socket.onClose(() => setTimeout(h, delay)),
				onError: (h) => socket.onError(h),
				onDrain: (h) =>
					socket.onDrain(() => {
						full = false;
						stats.drains++;
						h();
					}),
			};
			return wrapped;
		},
	};
	return { factory, stats };
}

/** Calls `visit` with each complete message's type; returns where the incomplete tail starts. */
function messageTypes(data: Uint8Array, visit: (type: number) => void): number {
	let i = 0;
	while (i + 5 <= data.length) {
		const length = new DataView(
			data.buffer,
			data.byteOffset + i + 1,
			4,
		).getUint32(0);
		if (i + 1 + length > data.length) break;
		visit(data[i]!);
		i += 1 + length;
	}
	return i;
}

await check(
	'backpressure: nothing written while the socket is full',
	async () => {
		const { factory, stats } = watched();
		await using conn = await connect({ ...base, socket: factory });
		const big = 'x'.repeat(512 * 1024);
		// one query per tick, so most are issued while earlier ones fill the buffer
		const pending: Promise<{ rows: { n: number; i: number }[] }>[] = [];
		for (let i = 0; i < 32; i++) {
			pending.push(
				conn.query<{ n: number; i: number }>(
					'select length($1)::int as n, $2::int as i',
					[big, i],
				),
			);
			await Promise.resolve();
		}
		const results = await Promise.all(pending);
		assert(
			results.every((r, i) => r.rows[0]?.n === big.length && r.rows[0].i === i),
			'wrong results',
		);
		assert(stats.full > 0 && stats.drains > 0, JSON.stringify(stats));
		assert(stats.writtenWhileFull === 0, JSON.stringify(stats));
		assert(stats.largestWrite < 1024 * 1024, JSON.stringify(stats));
	},
);

await check('pool deepens its pipeline at a simulated round trip', async () => {
	const { factory, stats } = watched(10);
	await using pool = createPool({ ...base, max: 1, socket: factory });
	const values = await Promise.all(
		Array.from({ length: 600 }, async (_, caller) => {
			const seen: (number | undefined)[] = [];
			for (let k = 0; k < 4; k++) {
				const v = caller * 4 + k;
				const { rows } = await pool.query<{ v: number }>(
					'select $1::int as v',
					[v],
				);
				seen.push(rows[0]?.v);
			}
			return seen;
		}),
	);
	assert(
		values.flat().every((v, i) => v === i),
		'wrong results',
	);
	assert(stats.maxInFlight > 300, JSON.stringify(stats));
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
