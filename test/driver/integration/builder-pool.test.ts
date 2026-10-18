/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BatchError } from '../../../src/batch.js';
import { integer, text } from '../../../src/column-factories.js';
import { database, type Database } from '../../../src/database.js';
import { defineTable } from '../../../src/define-table.js';
import type { QueryEvent } from '../../../src/driver-executor.js';
import { defineCodec } from '../../../src/driver/codec.js';
import { codecs } from '../../../src/driver/codecs.js';
import { PostgresError, QueryCanceled } from '../../../src/driver/errors.js';
import { createPool, type PoolOptions } from '../../../src/driver/pool.js';
import { sql } from '../../../src/sql.js';
import {
	noPg,
	options,
	rejection,
	slowSockets,
	table,
	timeSlicedSockets,
} from './helpers.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const schema = table('builder_pool');

let binary = 0;
const countedInt4 = defineCodec({
	name: 'int4',
	oid: 23,
	encode: (value: number) => String(value),
	decodeText: Number,
	decodeBinary: (bytes, start, end) => {
		binary++;
		return codecs.int4.decodeBinary?.(bytes, start, end) ?? 0;
	},
});

const items = defineTable('items', {
	columns: {
		id: integer().useCodec(countedInt4),
		name: text(),
	},
});

const pool = (overrides: PoolOptions = {}) =>
	createPool({
		...options(),
		params: { search_path: `${schema},public` },
		...overrides,
	});

const lookup = (db: Database, id: number) =>
	db
		.selectFrom(items)
		.where('items.id', id)
		.select(['items.id', 'items.name'])
		.expectOne();

const backendPid = (db: Pick<Database, 'sql'>) =>
	db.sql<{ pid: number }>`select pg_backend_pid() as pid`
		.expectValue()
		.execute();

/** The backends `n` concurrent queries ran on. */
const sharedPids = async (db: Database, n = 40) =>
	new Set(await Promise.all(Array.from({ length: n }, () => backendPid(db))));

describe.skipIf(noPg)('builder queries on a pool', () => {
	beforeAll(async () => {
		await using p = pool();
		await p.simpleQuery(`
			create schema ${schema};
			create table ${schema}.items (id int primary key, name text not null);
			insert into ${schema}.items select g, 'item ' || g from generate_series(1, 1000) g;
		`);
	});

	afterAll(async () => {
		await using p = pool();
		await p.query(`drop schema if exists ${schema} cascade`);
	});

	it('pipelines concurrent queries onto shared connections', async () => {
		const net = slowSockets(10);
		await using p = pool({ max: 2, pipeline: 10, socket: net.factory });
		const db = database(p);
		await Promise.all([lookup(db, 1).execute(), lookup(db, 2).execute()]);
		while (p.stats.idle < 2) await sleep(5);
		const acquire = vi.spyOn(p, 'acquire');
		net.reset();
		const started = performance.now();
		const rows = await Promise.all(
			Array.from({ length: 400 }, (_, i) => lookup(db, i + 1).execute()),
		);
		const elapsed = performance.now() - started;
		expect(rows).toEqual(
			Array.from({ length: 400 }, (_, i) => ({
				id: i + 1,
				name: `item ${i + 1}`,
			})),
		);
		expect(net.maxInFlight()).toBe(10);
		// 10 in flight on each of 2 connections, per 10 ms round trip: ~200 ms;
		// a connection per query would take 200 round trips, ~2 s
		expect(elapsed).toBeLessThan(1000);
		expect(acquire).not.toHaveBeenCalled();
		expect(p.stats).toMatchObject({ total: 2, busy: 0, waiting: 0 });
	});

	it('keeps codecs, binary results, tags, onQuery, errors and signals on a shared connection', async () => {
		const net = slowSockets(5);
		const events: QueryEvent[] = [];
		await using p = pool({ max: 1, pipeline: 50, socket: net.factory });
		const db = database(p, { onQuery: (e) => events.push(e) });
		const first = () =>
			db
				.selectFrom(items)
				.select(['items.id'])
				.orderBy('items.id')
				.takeFirst()
				.execute();
		await Promise.all([lookup(db, 1).execute(), first()]);
		// described by their first run: binary from now on
		binary = 0;
		net.reset();
		const controller = new AbortController();
		const aborted = rejection(
			db.sql`select pg_sleep(5)`.execute({ signal: controller.signal }),
			QueryCanceled,
		);
		const failed = rejection(
			db
				.selectFrom(items)
				.select(() => [sql<number>`1 / ${0}::int`.as('x')])
				.tag('divide')
				.execute(),
			PostgresError,
		);
		const rows = Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				db
					.selectFrom(items)
					.where('items.id', i + 1)
					.select(['items.id', 'items.name'])
					.tag('lookup')
					.expectOne()
					.execute(),
			),
		);
		const one = first();
		setTimeout(() => controller.abort(), 50);
		expect((await aborted).reason).toBe('abort');
		expect(await rows).toEqual(
			Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				name: `item ${i + 1}`,
			})),
		);
		expect(await one).toEqual({ id: 1 });
		// keepRows: the takeFirst decodes one of its 1000 rows
		expect(binary).toBe(21);
		const error = await failed;
		expect(error.code).toBe('22012');
		expect(error.query?.tag).toBe('divide');
		expect(error.stack).toContain('query issued at');
		// the call site is the code awaiting the query when it failed: here
		// `rejection`, which this test awaits only later (call-sites.test.ts)
		expect(error.stack).toContain('helpers.ts');
		expect(net.maxInFlight()).toBeGreaterThan(20);
		const lookups = events.filter((e) => e.tag === 'lookup');
		expect(lookups).toHaveLength(20);
		for (const event of lookups) {
			expect(event).toMatchObject({
				kind: 'execute',
				command: 'SELECT',
				rowCount: 1,
				error: undefined,
			});
			const { acquireMs, queuedMs, execMs } = event.phases;
			expect(acquireMs).toBeGreaterThanOrEqual(0);
			expect(execMs).toBeGreaterThan(0);
			// the rest is the wait for the caller's continuation to run
			expect(acquireMs + queuedMs + execMs).toBeLessThanOrEqual(
				event.durationMs + 0.001,
			);
		}
		expect(events.find((e) => e.tag === 'divide')?.error).toBe(error);
		expect(p.stats).toMatchObject({ total: 1, busy: 0, waiting: 0 });
	});

	it('runs a batch on one shared connection, in one write, alongside other queries', async () => {
		const net = slowSockets(5);
		await using p = pool({ max: 4, socket: net.factory });
		const db = database(p);
		const acquire = vi.spyOn(p, 'acquire');
		const withShared = vi.spyOn(p, 'withShared');
		const [a, b, c] = await db.batch([
			lookup(db, 1),
			lookup(db, 2),
			db.sql<{ n: string }>`select count(*) as n from items`.expectValue(),
		]);
		expect([a, b, c]).toEqual([
			{ id: 1, name: 'item 1' },
			{ id: 2, name: 'item 2' },
			'1000',
		]);
		expect(net.maxInFlight()).toBe(3);
		expect(withShared).toHaveBeenCalledTimes(1);
		expect(p.stats.total).toBe(1);
		const failed = await rejection(
			db.batch([lookup(db, 3), db.sql`select 1 / ${0}::int`, lookup(db, 4)]),
			BatchError,
		);
		expect(failed.results.map((r) => r.status)).toEqual([
			'fulfilled',
			'rejected',
			'fulfilled',
		]);
		expect(acquire).not.toHaveBeenCalled();
		// on a full pool, the batch pipelines with the other queries
		await using one = pool({ max: 1, socket: net.factory });
		const onOne = database(one);
		await lookup(onOne, 1).execute();
		net.reset();
		const [before, batch, after] = await Promise.all([
			Promise.all(
				Array.from({ length: 10 }, (_, i) => lookup(onOne, i + 1).execute()),
			),
			onOne.batch([lookup(onOne, 11), lookup(onOne, 12)]),
			Promise.all(
				Array.from({ length: 10 }, (_, i) => lookup(onOne, i + 13).execute()),
			),
		]);
		expect([...before, ...batch, ...after].map((row) => row.id)).toEqual(
			Array.from({ length: 22 }, (_, i) => i + 1),
		);
		expect(net.maxInFlight()).toBe(22);
		expect(one.stats).toMatchObject({ total: 1, busy: 0, waiting: 0 });
	});

	it('narrows builder queries and batches to the connections the server runs at once', async () => {
		// one CPU time-slicing every backend with replies waiting (see pool.test.ts)
		const net = timeSlicedSockets(1, 5);
		await using p = pool({ max: 4, socket: net.factory });
		const db = database(p);
		const state = { running: true };
		const load = Promise.all(
			Array.from({ length: 200 }, async (_, i) => {
				for (let n = 0; state.running; n++)
					await (n % 10 === 0
						? db.batch([lookup(db, 1 + (i % 1000)), lookup(db, 2)])
						: lookup(db, 1 + ((i + n) % 1000)).execute());
			}),
		);
		try {
			let wide = false;
			let streak = 0;
			for (let i = 0; i < 200 && streak < 4; i++) {
				await sleep(50);
				const sending = net.sending(100);
				if (sending === 4) wide = true;
				streak = wide && sending <= 2 ? streak + 1 : 0;
			}
			expect(wide).toBe(true);
			expect(streak).toBe(4);
		} finally {
			net.stop();
			state.running = false;
			await load;
		}
	});

	it('pipelines queries and batches with a timeout on the shared connections, each bounding only itself', async () => {
		const net = slowSockets(5);
		await using p = pool({ max: 1, pipeline: 20, socket: net.factory });
		const db = database(p);
		await backendPid(db);
		const acquire = vi.spyOn(p, 'acquire');
		const withShared = vi.spyOn(p, 'withShared');
		net.reset();
		const [slow, canceled, untimed, batch, failed] = await Promise.all([
			db.sql<{
				pid: number;
			}>`select pg_backend_pid() as pid, pg_sleep(0.2)::text as slept`
				.expectOne()
				.execute({ timeout: '5s' }),
			rejection(
				db.sql`select pg_sleep(3)`.execute({ timeout: 100 }),
				QueryCanceled,
			),
			// behind both, without a timeout: runs past the 100 ms
			db.sql<{
				slept: string;
			}>`select pg_sleep(0.3)::text as slept`
				.expectValue()
				.execute(),
			db.batch([lookup(db, 1), lookup(db, 2)], { timeout: '5s' }),
			rejection(
				db.batch([lookup(db, 3), db.sql`select pg_sleep(3)`], { timeout: 100 }),
				BatchError,
			),
		]);
		expect(slow.pid).toBe(await backendPid(db));
		expect(canceled.reason).toBe('statement_timeout');
		expect(untimed).toBe('');
		expect(batch).toEqual([
			{ id: 1, name: 'item 1' },
			{ id: 2, name: 'item 2' },
		]);
		expect(failed.results.map((r) => r.status)).toEqual([
			'fulfilled',
			'rejected',
		]);
		const reason: unknown =
			failed.results[1]?.status === 'rejected' && failed.results[1].reason;
		expect(reason).toBeInstanceOf(QueryCanceled);
		expect(reason instanceof QueryCanceled && reason.reason).toBe(
			'statement_timeout',
		);
		// all in flight together on the one connection
		expect(net.maxInFlight()).toBeGreaterThanOrEqual(7);
		expect(withShared).toHaveBeenCalledTimes(2);
		expect(acquire).not.toHaveBeenCalled();
		expect(
			await db.sql<{
				t: string;
			}>`select current_setting('statement_timeout') as t`
				.expectValue()
				.execute(),
		).toBe('0');
	});

	it('gives transactions, streams, atomic batches and session statements a connection of their own', async () => {
		await using p = pool({ max: 2 });
		const db = database(p);
		await Promise.all([backendPid(db), backendPid(db)]);
		while (p.stats.idle < 2) await sleep(5);
		const acquire = vi.spyOn(p, 'acquire');

		await db.transaction(async (tx) => {
			const own = await backendPid(tx);
			expect(await sharedPids(db)).not.toContain(own);
		});

		for await (const row of db
			.selectFrom(items)
			.select(() => [sql<number>`pg_backend_pid()`.as('pid')])
			.limit(3)
			.stream({ batchSize: 1 })) {
			expect(await sharedPids(db)).not.toContain(row.pid);
		}
		expect(acquire).toHaveBeenCalledTimes(1);

		const atomic = db.batch(
			[
				db.sql<{
					pid: number;
				}>`select pg_backend_pid() as pid, pg_sleep(0.2)::text as slept`.expectOne(),
			],
			{ transaction: true },
		);
		await sleep(50);
		const duringAtomic = await sharedPids(db);
		expect(duringAtomic).not.toContain((await atomic)[0].pid);
		expect(acquire).toHaveBeenCalledTimes(2);

		for (const statement of [
			db.sql`set application_name = 'quarry_session'`,
			db.sql`  RESET application_name`,
			db.sql`
				begin`,
			db.sql`create temp table scratch (id int)`,
		])
			await statement.execute();
		expect(acquire).toHaveBeenCalledTimes(6);
		// a connection left in a transaction is closed, not shared
		await sharedPids(db);
		expect(acquire).toHaveBeenCalledTimes(6);
		expect(
			await db.sql<{
				n: string;
			}>`select count(*) as n from items where ${sql.id('id')} <= ${10}`
				.expectValue()
				.execute(),
		).toBe('10');
		expect(acquire).toHaveBeenCalledTimes(6);
	});
});

describe.skipIf(noPg)('builder queries on a reserved client', () => {
	it('run on that one connection, pipelined by it', async () => {
		await using p = pool({ max: 2 });
		await using client = await p.acquire();
		const db = database(client);
		const pids = await sharedPids(db, 20);
		expect([...pids]).toEqual([await backendPid(database(client))]);
	});
});
