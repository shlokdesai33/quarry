/* oxlint-disable no-await-in-loop -- tests run their steps in order */
// Scenarios from node-postgres's, pg-copy-streams's and postgres.js's
// suites that drive their libraries' internals (pg's Connection, custom
// submittables), so they can't run through the compatibility shims
// (test/driver/compat), ported to assert the same behaviour on quarry.
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '../../../src/driver/connection.js';
import { PostgresError } from '../../../src/driver/errors.js';
import type { Notice } from '../../../src/driver/notice.js';
import { createPool } from '../../../src/driver/pool.js';
import { noPg, open, options, rejection, table } from './helpers.js';

const text = (chunks: Uint8Array[]) => Buffer.concat(chunks).toString('utf8');

async function collect(
	source: AsyncIterable<Uint8Array>,
): Promise<Uint8Array[]> {
	const out: Uint8Array[] = [];
	for await (const chunk of source) out.push(chunk);
	return out;
}

// oxlint-disable-next-line require-yield
async function* failsAtOnce(): AsyncGenerator<string> {
	throw new Error('source failed');
}

async function* failsLater(): AsyncGenerator<string> {
	yield '10\tten\n';
	await new Promise((resolve) => setTimeout(resolve, 20));
	throw new Error('source failed later');
}

describe.skipIf(noPg)('COPY, as pg-copy-streams tests it', () => {
	let conn: Connection;
	let name: string;
	beforeAll(async () => {
		conn = await open();
		name = table('copy');
		await conn.query(`create table ${name} (id int, word text)`);
	});
	afterAll(async () => {
		await conn?.query(`drop table if exists ${name}`);
		await conn?.close();
	});

	it('copies nothing from an empty source', async () => {
		expect(await conn.copyFrom(`copy ${name} from stdin`, [])).toBe(0);
	});

	it('takes rows split at every byte, through multi-byte characters', async () => {
		await conn.query(`truncate ${name}`);
		const data = new TextEncoder().encode('1\tnaïve\n2\t日本語\n3\t😀\n');
		const bytes = Array.from(data, (_, i) => data.subarray(i, i + 1));
		expect(await conn.copyFrom(`copy ${name} from stdin`, bytes)).toBe(3);
		const { rows } = await conn.query(`select word from ${name} order by id`);
		expect(rows.map((r) => r['word'])).toEqual(['naïve', '日本語', '😀']);
	});

	it('fails when the source fails before or after the server is ready, and stays usable', async () => {
		await conn.query(`truncate ${name}`);
		await expect(
			conn.copyFrom(`copy ${name} from stdin`, failsAtOnce()),
		).rejects.toThrow('The COPY source failed');
		await expect(
			conn.copyFrom(`copy ${name} from stdin`, failsLater()),
		).rejects.toThrow('The COPY source failed');
		expect(
			(await conn.query(`select count(*)::int as n from ${name}`)).rows,
		).toEqual([{ n: 0 }]);
	});

	it('ends COPY TO with the error a row raises midway, and stays usable', async () => {
		const sql =
			'copy (select 10 / (5 - i) as v from generate_series(1, 10) i) to stdout';
		const error = await rejection(collect(conn.copyTo(sql)), PostgresError);
		expect(error.code).toBe('22012');
		expect((await conn.query('select 1 as n')).rows).toEqual([{ n: 1 }]);
	});

	it('delivers notices raised during COPY TO without disturbing the data', async () => {
		const notices: Notice[] = [];
		const off = conn.onNotice((n) => notices.push(n));
		const fn = table('notify_row');
		await conn.query(
			`create function ${fn}(i int) returns int language plpgsql as $$ begin raise notice 'row %', i; return i; end $$`,
		);
		try {
			const chunks = await collect(
				conn.copyTo(
					`copy (select ${fn}(i) from generate_series(1, 3) i) to stdout`,
				),
			);
			expect(text(chunks)).toBe('1\n2\n3\n');
			expect(notices.map((n) => n.message)).toEqual([
				'row 1',
				'row 2',
				'row 3',
			]);
		} finally {
			off();
			await conn.query(`drop function ${fn}`);
		}
	});

	it('copies inside a transaction, between BEGIN and COMMIT', async () => {
		await conn.transaction(async (tx) => {
			await tx.query(`truncate ${name}`);
			await tx.copyFrom(`copy ${name} from stdin`, ['1\tin tx\n']);
			const chunks = await collect(tx.copyTo(`copy ${name} to stdout`));
			expect(text(chunks)).toBe('1\tin tx\n');
		});
		expect(conn.transactionStatus).toBe('idle');
	});

	it('streams one large row in several chunks, intact', async () => {
		const chunks = await collect(
			conn.copyTo(`copy (select repeat('x', 300000) as v) to stdout`),
		);
		expect(text(chunks)).toBe(`${'x'.repeat(300000)}\n`);
	});

	it('copies a table to another in binary format', async () => {
		const target = table('copy_bin');
		await conn.query(`truncate ${name}`);
		await conn.query(
			`insert into ${name} values (1, 'a'), (2, null), (3, 'ünï')`,
		);
		await conn.query(`create table ${target} (like ${name})`);
		try {
			const data = await collect(
				conn.copyTo(`copy ${name} to stdout with (format binary)`),
			);
			expect(
				await conn.copyFrom(
					`copy ${target} from stdin with (format binary)`,
					data,
				),
			).toBe(3);
			const { rows } = await conn.query(`select * from ${target} order by id`);
			expect(rows).toEqual([
				{ id: 1, word: 'a' },
				{ id: 2, word: null },
				{ id: 3, word: 'ünï' },
			]);
		} finally {
			await conn.query(`drop table ${target}`);
		}
	});

	it('hands COPY TO rows over in chunks of everything received by then', async () => {
		const data = conn.copyTo(
			'copy (select generate_series(1, 20000)) to stdout',
		);
		const iterator = data[Symbol.asyncIterator]();
		const first = await iterator.next();
		// rows arrive while the first chunk is being used
		await new Promise((r) => setTimeout(r, 50));
		const chunks: Uint8Array[] = first.done === true ? [] : [first.value];
		for (
			let r = await iterator.next();
			r.done !== true;
			r = await iterator.next()
		)
			chunks.push(r.value);
		expect(text(chunks)).toBe(
			Array.from({ length: 20000 }, (_, i) => `${i + 1}\n`).join(''),
		);
		expect(chunks.length).toBeLessThan(10);
	});

	it('pipes Node streams into COPY FROM and out of COPY TO', async () => {
		await conn.query(`truncate ${name}`);
		const lines = Array.from({ length: 1000 }, (_, i) => `${i}\trow ${i}\n`);
		const into = conn.createCopyFromStream(`copy ${name} from stdin`);
		await pipeline(Readable.from(lines), into);
		expect(into.rowCount).toBe(1000);
		let out = '';
		await pipeline(
			conn.createCopyToStream(`copy ${name} to stdout`),
			new Writable({
				write(chunk: Buffer, _encoding, callback) {
					out += chunk.toString();
					callback();
				},
			}),
		);
		expect(out).toBe(lines.join(''));
		// a failing source fails the COPY, and the connection stays usable
		const failing = conn.createCopyFromStream(`copy ${name} from stdin`);
		await expect(
			pipeline(
				Readable.from(
					(async function* () {
						yield '9999\tlast\n';
						throw new Error('source broke');
					})(),
				),
				failing,
			),
		).rejects.toThrow('source broke');
		// the server's error destroys the stream
		await expect(
			pipeline(
				Readable.from(['not a number\tx\n']),
				conn.createCopyFromStream(`copy ${name} from stdin`),
			),
		).rejects.toBeInstanceOf(PostgresError);
		expect(
			(await conn.query(`select count(*)::int as n from ${name}`)).rows,
		).toEqual([{ n: 1000 }]);
		// on a pool: a connection of its own, freed afterwards
		await using pool = createPool(options());
		let pooled = '';
		for await (const chunk of pool.createCopyToStream(
			`copy (select 1) to stdout`,
		))
			pooled += String(chunk);
		expect(pooled).toBe('1\n');
		expect(pool.stats.busy).toBe(0);
	});
});

async function queryMissingTable(): Promise<void> {
	await using pool = createPool({ ...options(), captureStack: true });
	await pool.query('select test from nonexistent');
}

describe.skipIf(noPg)('errors, as node-postgres tests them', () => {
	it("keeps the caller's async frames in a pooled query's error", async () => {
		const error = await rejection(queryMissingTable(), PostgresError);
		expect(error.stack).toContain('queryMissingTable');
	});
});

describe.skipIf(noPg)('lost connections, as node-postgres tests them', () => {
	it('fails a running query with the server’s error when the backend is terminated', async () => {
		const conn = await open();
		await using admin = await open();
		const running = conn.query('select pg_sleep(5)');
		// handled from the start: its error can come before the terminate's reply
		const failed = rejection(running, PostgresError);
		await new Promise((resolve) => setTimeout(resolve, 100));
		await admin.query('select pg_terminate_backend($1)', [conn.processId]);
		const error = await failed;
		expect(error.code).toBe('57P01');
		expect(conn.closed).toBe(true);
		await expect(conn.query('select 1')).rejects.toThrow(/closed/);
	});

	it('fails a pooled query whose connection dies, then carries on', async () => {
		await using pool = createPool({ ...options(), max: 1 });
		await using admin = await open();
		const pid = (
			await pool.query<{ pid: number }>('select pg_backend_pid() as pid')
		).rows[0]?.pid;
		const running = pool.query('select pg_sleep(5)');
		const failed = expect(running).rejects.toBeInstanceOf(PostgresError);
		await new Promise((resolve) => setTimeout(resolve, 100));
		await admin.query('select pg_terminate_backend($1)', [pid]);
		await failed;
		const { rows } = await pool.query<{ pid: number }>(
			'select pg_backend_pid() as pid',
		);
		expect(rows[0]?.pid).not.toBe(pid);
	});

	it('keeps a connection usable after a cursor closed before its first response', async () => {
		await using conn = await open();
		const cursor = conn.cursor('select generate_series(0, 50) as num', [], {
			batchSize: 100,
		});
		const iterator = cursor[Symbol.asyncIterator]();
		const first = iterator.next();
		await iterator.return?.();
		await first.catch(() => undefined);
		expect((await conn.query('select 1 as value')).rows).toEqual([
			{ value: 1 },
		]);
	});
});
