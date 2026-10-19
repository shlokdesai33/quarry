/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineCodec } from '../../../src/driver/codec.js';
import type { Connection } from '../../../src/driver/connection.js';
import {
	AbortError,
	DecodeError,
	PostgresError,
	QueryCanceled,
} from '../../../src/driver/errors.js';
import type { Notification } from '../../../src/driver/notice.js';
import { noPg, open, rejection, roundTripSockets, table } from './helpers.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const iterate = <T>(iterable: AsyncIterable<T>) =>
	iterable[Symbol.asyncIterator]();

describe.skipIf(noPg)('cancellation and timeouts', () => {
	it('cancels a running query with cancel() and keeps the connection', async () => {
		await using conn = await open();
		const running = rejection(conn.query('select pg_sleep(10)'), QueryCanceled);
		await sleep(100);
		await conn.cancel();
		const error = await running;
		expect(error.reason).toBe('user');
		expect((await conn.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});

	it('cancels with an AbortSignal (protocol 3.2 key)', async () => {
		await using conn = await open();
		expect(conn.protocol).toBe('3.2');
		const controller = new AbortController();
		const running = rejection(
			conn.query('select pg_sleep(10)', [], { signal: controller.signal }),
			QueryCanceled,
		);
		const after = conn.query('select 2 as x');
		await sleep(100);
		const started = Date.now();
		controller.abort();
		const error = await running;
		expect(error.reason).toBe('abort');
		expect(Date.now() - started).toBeLessThan(2000);
		expect((await after).rows).toEqual([{ x: 2 }]);
	});

	it('cancels over protocol 3.0 and over TLS', async () => {
		for (const overrides of [
			{ protocol: '3.0' as const },
			{ ssl: 'require' as const },
			{ ssl: { mode: 'require' as const, negotiation: 'direct' as const } },
		]) {
			await using conn = await open(overrides);
			const running = conn.query('select pg_sleep(10)', [], { timeout: 150 });
			const error = await rejection(running, QueryCanceled);
			expect(error.reason).toBe('timeout');
		}
	});

	it('drops a query aborted before it is sent', async () => {
		await using conn = await open();
		const controller = new AbortController();
		controller.abort(new Error('nope'));
		await expect(
			conn.query('select 1', [], { signal: controller.signal }),
		).rejects.toBeInstanceOf(AbortError);
		const blocker = conn.cursor('select generate_series(1, 3)', [], {
			batchSize: 1,
		});
		const iterator = blocker[Symbol.asyncIterator]();
		await iterator.next();
		// the cursor holds the connection, so this query waits unsent and can be dropped
		const late = new AbortController();
		const queued = conn.query('select 1', [], { signal: late.signal });
		late.abort();
		await expect(queued).rejects.toBeInstanceOf(AbortError);
		await iterator.return?.();
		expect((await conn.query('select 3 as x')).rows).toEqual([{ x: 3 }]);
	});

	it('reports statement_timeout as its own reason', async () => {
		await using conn = await open({ params: { statement_timeout: '100ms' } });
		const error = await rejection(
			conn.query('select pg_sleep(5)'),
			QueryCanceled,
		);
		expect(error.reason).toBe('statement_timeout');
	});
});

describe.skipIf(noPg)('LISTEN / NOTIFY', () => {
	it('delivers notifications to listeners and stops after unlisten', async () => {
		await using listener = await open();
		await using notifier = await open();
		const received: Notification[] = [];
		const unlisten = await listener.listen('Quarry Events', (n) =>
			received.push(n),
		);
		expect(listener.channels).toEqual(['Quarry Events']);
		await notifier.notify('Quarry Events', 'hello');
		await notifier.query(`notify "Quarry Events", 'é😀'`);
		await sleep(100);
		expect(received.map((n) => n.payload)).toEqual(['hello', 'é😀']);
		expect(received[0]?.pid).toBe(notifier.processId);
		await unlisten();
		await notifier.notify('Quarry Events', 'ignored');
		await sleep(100);
		expect(received).toHaveLength(2);
	});

	it('delivers a burst across channels in order, past a throwing listener', async () => {
		await using listener = await open();
		await using notifier = await open();
		const N = 5000;
		const channels = ['a', 'b', 'Quarry Events', 'é😀'];
		const perChannel = new Map<string, string[]>();
		const all: Notification[] = [];
		const errors: unknown[] = [];
		const onError = (error: unknown) => errors.push(error);
		process.on('uncaughtException', onError);
		try {
			listener.onNotification(() => {
				throw new Error('listener failed');
			});
			listener.onNotification((n) => all.push(n));
			for (const channel of channels) {
				const got: string[] = [];
				perChannel.set(channel, got);
				await listener.listen(channel, (n) => got.push(n.payload));
			}
			const done = new Promise<void>((resolve) =>
				listener.onNotification(() => {
					if (all.length === N) resolve();
				}),
			);
			await notifier.query(
				`select pg_notify(($1::text[])[1 + g % 4], repeat('é', g % 9) || g)
				from generate_series(1, ${N}) g`,
				[channels],
			);
			await done;
			expect(all.map((n) => n.payload)).toEqual(
				Array.from({ length: N }, (_, i) => 'é'.repeat((i + 1) % 9) + (i + 1)),
			);
			expect(new Set(all.map((n) => n.pid))).toEqual(
				new Set([notifier.processId]),
			);
			for (const [i, channel] of channels.entries()) {
				expect(perChannel.get(channel)).toEqual(
					all.filter((_, j) => (j + 1) % 4 === i).map((n) => n.payload),
				);
			}
			await sleep(10);
			expect(errors).toHaveLength(N);
			expect((await listener.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
		} finally {
			process.off('uncaughtException', onError);
		}
	});
});

describe.skipIf(noPg)('cursors', () => {
	let conn: Connection;
	beforeAll(async () => {
		conn = await open();
	});
	afterAll(async () => {
		await conn?.close();
	});

	it('streams rows in batches', async () => {
		const sizes: number[] = [];
		let total = 0;
		for await (const batch of conn.cursor<{ n: number }>(
			'select n from generate_series(1, $1::int) n',
			[10_500],
			{ batchSize: 1000 },
		)) {
			sizes.push(batch.length);
			total += batch.reduce((sum, row) => sum + row.n, 0);
		}
		expect(sizes).toEqual([...Array.from({ length: 10 }, () => 1000), 500]);
		expect(total).toBe((10_500 * 10_501) / 2);
	});

	it('streams rows one at a time and stops early', async () => {
		const seen: number[] = [];
		for await (const row of conn.stream<{ n: number }>(
			'select n from generate_series(1, 1000000) n',
			[],
			{ batchSize: 100 },
		)) {
			seen.push(row.n);
			if (row.n === 250) break;
		}
		expect(seen).toHaveLength(250);
		expect((await conn.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});

	it('reports errors in the middle of a stream and recovers', async () => {
		const rows: unknown[] = [];
		const error = await rejection(
			(async () => {
				for await (const batch of conn.cursor(
					'select 10 / (5 - n) as v from generate_series(1, 10) n',
					[],
					{ batchSize: 2 },
				)) {
					rows.push(...batch);
				}
			})(),
			PostgresError,
		);
		expect(error.code).toBe('22012');
		expect(rows).toEqual([{ v: 2 }, { v: 3 }, { v: 5 }, { v: 10 }]);
		expect((await conn.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});

	it('queues other queries behind an open cursor', async () => {
		const cursor = conn.cursor('select generate_series(1, 4) as n', [], {
			batchSize: 2,
		});
		const iterator = cursor[Symbol.asyncIterator]();
		const first = await iterator.next();
		const other = conn.query('select 99 as x');
		const second = await iterator.next();
		const end = await iterator.next();
		expect([first.value, second.value, end.done]).toEqual([
			[{ n: 1 }, { n: 2 }],
			[{ n: 3 }, { n: 4 }],
			true,
		]);
		expect((await other).rows).toEqual([{ x: 99 }]);
	});

	it('streams inside a transaction', async () => {
		await using tx = await open();
		await tx.query('begin');
		const ns: number[] = [];
		for await (const row of tx.stream<{ n: number }>(
			'select generate_series(1, 5) as n',
			[],
			{ batchSize: 2 },
		))
			ns.push(row.n);
		expect(ns).toEqual([1, 2, 3, 4, 5]);
		expect(tx.transactionStatus).toBe('transaction');
		await tx.query('commit');
	});

	it('sends the next Execute only when the next batch is asked for', async () => {
		const net = roundTripSockets();
		await using c = await open({ socket: net.factory });
		const iterator = iterate(
			c.cursor('select generate_series(1, 100) as n', [], { batchSize: 10 }),
		);
		await iterator.next();
		const after = net.writes();
		await sleep(30);
		expect(net.writes()).toBe(after);
		await iterator.next();
		expect(net.writes()).toBe(after + 1);
		await iterator.return?.();
	});

	it('runs other queries of the transaction between its batches', async () => {
		await using c = await open();
		const rows = await c.transaction(async (tx) => {
			const seen: [number, number][] = [];
			for await (const row of tx.stream<{ n: number }>(
				'select generate_series(1, 25) as n',
				[],
				{ batchSize: 4 },
			)) {
				const { rows: inner } = await tx.query<{ m: number }>(
					'select $1::int * 2 as m',
					[row.n],
				);
				seen.push([row.n, inner[0]?.m ?? 0]);
			}
			// two cursors of one transaction, read in step
			const a = iterate(
				tx.cursor<{ n: number }>('select generate_series(1, 6) as n', [], {
					batchSize: 2,
				}),
			);
			const b = iterate(
				tx.cursor<{ n: number }>('select generate_series(10, 15) as n', [], {
					batchSize: 3,
				}),
			);
			const [x, y] = await Promise.all([a.next(), b.next()]);
			const [z] = await Promise.all([a.next(), b.return?.()]);
			expect([x.value, y.value, z.value]).toEqual([
				[{ n: 1 }, { n: 2 }],
				[{ n: 10 }, { n: 11 }, { n: 12 }],
				[{ n: 3 }, { n: 4 }],
			]);
			await a.return?.();
			return seen;
		});
		expect(rows).toEqual(
			Array.from({ length: 25 }, (_, i) => [i + 1, (i + 1) * 2]),
		);
		expect(c.transactionStatus).toBe('idle');
		const { rows: portals } = await c.query<{ n: number }>(
			`select count(*)::int as n from pg_cursors where name <> ''`,
		);
		expect(portals).toEqual([{ n: 0 }]);
	});

	it('fails a cursor inside a transaction with the error, and the transaction with it', async () => {
		await using c = await open();
		const error = await rejection(
			c.transaction(async (tx) => {
				for await (const _ of tx.stream(
					'select 10 / (3 - n) as v from generate_series(1, 5) n',
					[],
					{ batchSize: 1 },
				));
			}),
			PostgresError,
		);
		expect(error.code).toBe('22012');
		expect(c.transactionStatus).toBe('idle');
	});

	it('bounds a cursor with statementTimeout, and refuses one inside a transaction', async () => {
		await using c = await open();
		const error = await rejection(
			(async () => {
				for await (const _ of c.cursor(
					'select generate_series(1, 1000000) as n',
					[],
					{ batchSize: 10, statementTimeout: 100 },
				))
					await sleep(10);
			})(),
			QueryCanceled,
		);
		expect(error.reason).toBe('statement_timeout');
		expect(c.transactionStatus).toBe('idle');
		expect((await c.query('show statement_timeout')).rows).toEqual([
			{ statement_timeout: '0' },
		]);
		let n = 0;
		for await (const batch of c.cursor('select generate_series(1, 50)', [], {
			batchSize: 20,
			statementTimeout: '5s',
		}))
			n += batch.length;
		expect(n).toBe(50);
		const bad = await rejection(
			iterate(c.cursor('select 1', [], { statementTimeout: 'soon' })).next(),
			PostgresError,
		);
		expect(bad.code).toBe('22023');
		await expect(
			c.transaction(async (tx) => {
				for await (const _ of tx.cursor('select 1', [], {
					statementTimeout: '1s',
				}));
			}),
		).rejects.toThrow(/statementTimeout/);
	});

	it('stops on a signal or a client timeout, whether a batch is running or not', async () => {
		await using c = await open();
		const idle = new AbortController();
		const iterator = iterate(
			c.cursor('select generate_series(1, 1000) as n', [], {
				batchSize: 10,
				signal: idle.signal,
			}),
		);
		await iterator.next();
		idle.abort();
		await expect(iterator.next()).rejects.toThrow('The cursor was aborted');
		expect((await c.query('select 1 as x')).rows).toEqual([{ x: 1 }]);

		const timedOut = await rejection(
			(async () => {
				for await (const _ of c.cursor(
					'select pg_sleep(0.02) from generate_series(1, 100)',
					[],
					{ batchSize: 5, timeout: 150 },
				));
			})(),
			QueryCanceled,
		);
		expect(timedOut.reason).toBe('timeout');

		await c.transaction(async (tx) => {
			const signal = new AbortController();
			const inner = iterate(
				tx.cursor('select generate_series(1, 1000) as n', [], {
					batchSize: 10,
					signal: signal.signal,
				}),
			);
			await inner.next();
			signal.abort();
			await expect(inner.next()).rejects.toBeInstanceOf(AbortError);
			// aborted between batches, nothing failed on the server
			expect(tx.transactionStatus).toBe('transaction');
			expect((await tx.query('select 2 as x')).rows).toEqual([{ x: 2 }]);
		});
	});

	it('reads binary from the first run, unprepared and in transactions too', async () => {
		let binary = 0;
		const counted = defineCodec({
			name: 'int8',
			oid: 20,
			encode: (value: bigint) => String(value),
			decodeText: (value: string) => BigInt(value),
			decodeBinary: (bytes: Uint8Array, start: number) => {
				binary++;
				return new DataView(bytes.buffer, bytes.byteOffset + start).getBigInt64(
					0,
				);
			},
		});
		for (const prepare of [true, false]) {
			await using c = await open({ prepare });
			const read = async (source: Pick<Connection, 'cursor'>) => {
				const ns: bigint[] = [];
				for await (const batch of source.cursor<{ n: bigint }>(
					'select n::int8 as n from generate_series(1, 3) n',
					[],
					{ codecs: [counted], batchSize: 2 },
				))
					ns.push(...batch.map((row) => row.n));
				return ns;
			};
			binary = 0;
			expect(await read(c)).toEqual([1n, 2n, 3n]);
			expect(await read(c)).toEqual([1n, 2n, 3n]);
			expect(await c.transaction((tx) => read(tx))).toEqual([1n, 2n, 3n]);
			expect({ prepare, binary }).toEqual({ prepare, binary: 9 });
		}
	});

	it('runs a cached statement again when the schema changed under it', async () => {
		await using c = await open();
		const name = table('stale');
		await c.query(`create temp table ${name} (id int, v int)`);
		await c.query(`insert into ${name} values (1, 10), (2, 20)`);
		const read = async () => {
			const rows: unknown[] = [];
			for await (const batch of c.cursor(`select * from ${name} order by id`))
				rows.push(...batch);
			return rows;
		};
		expect(await read()).toEqual([
			{ id: 1, v: 10 },
			{ id: 2, v: 20 },
		]);
		await c.query(`alter table ${name} alter column v type text`);
		expect(await read()).toEqual([
			{ id: 1, v: '10' },
			{ id: 2, v: '20' },
		]);
	});

	it('opens with its first next(), ahead of the queries issued after it', async () => {
		for (const inTransaction of [false, true]) {
			await using c = await open();
			if (inTransaction) await c.query('begin');
			const settled: string[] = [];
			const cursor = iterate(
				c.cursor('select 1 / (n - 3) as v from generate_series(1, 5) n'),
			);
			const first = cursor.next().then(
				() => settled.push('cursor'),
				() => settled.push('cursor failed'),
			);
			const after = c
				.query(inTransaction ? 'rollback' : 'select 2')
				.then(() => settled.push('query'));
			await Promise.all([first, after]);
			expect(settled).toEqual(['cursor failed', 'query']);
			expect(c.transactionStatus).toBe('idle');
		}
		const bad = iterate(conn.cursor('select $1::int', [undefined]));
		const next = bad.next();
		const later = conn.query('select 3 as x');
		await expect(next).rejects.toThrow(/undefined/);
		expect((await later).rows).toEqual([{ x: 3 }]);
		const timed = iterate(
			conn.cursor('select $1::int', [undefined], { statementTimeout: '1s' }),
		);
		await expect(timed.next()).rejects.toThrow(/undefined/);
		expect(conn.transactionStatus).toBe('idle');
	});

	it('takes next() calls in order, and a return() before it is sent', async () => {
		const iterator = iterate(
			conn.cursor<{ n: number }>('select generate_series(1, 5) as n', [], {
				batchSize: 2,
			}),
		);
		const results = await Promise.all([
			iterator.next(),
			iterator.next(),
			iterator.next(),
			iterator.next(),
		]);
		expect(results.map((r) => r.value)).toEqual([
			[{ n: 1 }, { n: 2 }],
			[{ n: 3 }, { n: 4 }],
			[{ n: 5 }],
			undefined,
		]);
		const held = iterate(
			conn.cursor('select generate_series(1, 3)', [], { batchSize: 1 }),
		);
		await held.next();
		const queued = conn.cursor('select 1')[Symbol.asyncIterator]();
		const first = queued.next();
		await queued.return?.();
		await held.return?.();
		expect((await first).done).toBe(true);
		expect((await conn.query('select 4 as x')).rows).toEqual([{ x: 4 }]);
	});

	it('fails on a value it cannot decode and keeps the connection', async () => {
		const picky = defineCodec({
			name: 'int4',
			oid: 23,
			encode: (value: number) => String(value),
			decodeText: (value: string) => {
				if (value === '7') throw new Error('no sevens');
				return Number(value);
			},
		});
		await using c = await open();
		const consume = async (source: Pick<Connection, 'cursor'>) => {
			const seen: number[] = [];
			const error = await rejection(
				(async () => {
					for await (const batch of source.cursor<{ n: number }>(
						'select generate_series(1, 20)::int4 as n',
						[],
						{ batchSize: 3, codecs: [picky] },
					))
						seen.push(...batch.map((row) => row.n));
				})(),
				DecodeError,
			);
			throw Object.assign(error, { seen });
		};
		for (const run of [
			() => consume(c),
			() => c.transaction((tx) => consume(tx)),
		]) {
			const error = await rejection(run(), DecodeError);
			expect(Reflect.get(error, 'seen')).toEqual([1, 2, 3, 4, 5, 6]);
			expect((await c.query('select 5 as x')).rows).toEqual([{ x: 5 }]);
			expect(c.transactionStatus).toBe('idle');
		}
	});
});

async function* copyRows() {
	for (let i = 0; i < 100_000; i += 1000) {
		let chunk = '';
		for (let j = i; j < i + 1000; j++) chunk += `${j}\tlabel ${j} é\n`;
		yield chunk;
	}
}

async function* failing() {
	yield '1\n';
	throw new Error('source broke');
}

describe.skipIf(noPg)('COPY', () => {
	it('copies rows in from an async source and out again', async () => {
		await using conn = await open();
		const name = table('copy');
		await conn.query(`create temp table ${name} (id int, label text)`);
		expect(await conn.copyFrom(`copy ${name} from stdin`, copyRows())).toBe(
			100_000,
		);
		const { rows: count } = await conn.query<{ n: number }>(
			`select count(*)::int as n, sum(id)::int8 as s from ${name}`,
		);
		expect(count[0]?.n).toBe(100_000);

		const decoder = new TextDecoder();
		let text = '';
		for await (const chunk of conn.copyTo(
			`copy (select * from ${name} order by id limit 3) to stdout with (format csv)`,
		)) {
			text += decoder.decode(chunk, { stream: true });
		}
		expect(text).toBe('0,label 0 é\n1,label 1 é\n2,label 2 é\n');
	});

	it('bulk-loads rows with copyRows, round-tripping awkward values', async () => {
		await using conn = await open();
		const name = table('copyrows');
		await conn.query(
			`create temp table ${name} (id int, t text, b bytea, j jsonb, a text[], ts timestamptz, f float8)`,
		);
		const tricky = [
			'tab\there\tand\tthere',
			'line\nbreak\n\\',
			'back\\slash',
			'\\N',
			'cr\rlf',
			'',
			'é😀',
		];
		const rows = Array.from({ length: 20_000 }, (_, i) => [
			i,
			i < tricky.length ? tricky[i] : i % 5 === 0 ? null : `row ${i}`,
			new Uint8Array([i % 256, 0, 255]),
			{ i, s: 'q"uote' },
			['x', null, 'y,z'],
			new Date(Date.UTC(2024, 0, 1) + i * 1000),
			i / 3,
		]);
		expect(
			await conn.copyRows(
				`copy ${name} (id, t, b, j, a, ts, f) from stdin`,
				rows,
			),
		).toBe(20_000);
		const back = await conn.query(
			`select id, t, b, j, a, ts::text as ts, f from ${name} order by id`,
		);
		expect(back.rows.length).toBe(20_000);
		back.rows.forEach((row, i) => {
			const [id, t, b, j, a, ts, f] = rows[i] ?? [];
			expect(row).toEqual({
				id,
				t,
				b,
				j,
				a,
				ts:
					ts instanceof Date
						? ts.toISOString().replace('T', ' ').replace('.000Z', '+00')
						: ts,
				f,
			});
		});
	});

	it('reports bad COPY data and keeps the connection usable', async () => {
		await using conn = await open();
		const name = table('copy');
		await conn.query(`create temp table ${name} (id int)`);
		const error = await rejection(
			conn.copyFrom(`copy ${name} from stdin`, ['1\n', 'oops\n', '3\n']),
			PostgresError,
		);
		expect(error.code).toBe('22P02');
		expect(
			(await conn.query(`select count(*)::int as n from ${name}`)).rows,
		).toEqual([{ n: 0 }]);
	});

	it('aborts COPY when the source throws', async () => {
		await using conn = await open();
		const name = table('copy');
		await conn.query(`create temp table ${name} (id int)`);
		await expect(
			conn.copyFrom(`copy ${name} from stdin`, failing()),
		).rejects.toThrow(/COPY source failed/);
		expect((await conn.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});

	it('stops COPY TO early when the consumer breaks', async () => {
		await using conn = await open();
		let chunks = 0;
		for await (const _ of conn.copyTo(
			'copy (select generate_series(1, 5000000)) to stdout',
			{ highWaterMark: 1 << 16 },
		)) {
			if (++chunks === 3) break;
		}
		expect((await conn.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});

	it('refuses COPY FROM STDIN through query() without hanging', async () => {
		await using conn = await open();
		const name = table('copy');
		await conn.query(`create temp table ${name} (id int)`);
		await expect(conn.query(`copy ${name} from stdin`)).rejects.toThrow(
			/copyFrom/,
		);
		expect((await conn.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});
});
