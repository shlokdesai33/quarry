/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '../../../src/driver/connection.js';
import {
	AbortError,
	PostgresError,
	QueryCanceled,
} from '../../../src/driver/errors.js';
import type { Notification } from '../../../src/driver/notice.js';
import { noPg, open, pgAtLeast, rejection, table } from './helpers.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
		expect(conn.protocol).toBe(pgAtLeast(18) ? '3.2' : '3.0');
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
			...(pgAtLeast(17)
				? [
						{
							ssl: { mode: 'require' as const, negotiation: 'direct' as const },
						},
					]
				: []),
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
