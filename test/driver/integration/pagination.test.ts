/* oxlint-disable no-await-in-loop -- pages and batches run one after another */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	bigint,
	bytea,
	decimal,
	integer,
	text,
	timestamptz,
	uuid,
} from '../../../src/column-factories.js';
import { database, type Database } from '../../../src/database.js';
import { defineTable } from '../../../src/define-table.js';
import type { QueryEvent } from '../../../src/driver-executor.js';
import { LockNotAvailable } from '../../../src/driver/errors.js';
import { createPool, type Pool } from '../../../src/driver/pool.js';
import { InvalidCursorError } from '../../../src/pagination.js';
import { noPg, options, rejection, table } from './helpers.js';

const schema = table('pagination');

const items = defineTable('items', {
	columns: { id: integer(), n: integer() },
});

/** Few distinct `at` values, so a composite key's first column ties across batch boundaries. */
const events = defineTable('events', {
	columns: {
		at: timestamptz(),
		id: bigint(),
		label: text(),
	},
});

const empty = defineTable('empty', { columns: { id: integer() } });

const typed = defineTable('typed', {
	columns: { u: uuid(), t: text(), num: decimal(), b: bytea() },
});

async function chunks<T>(iterable: AsyncIterable<T[]>): Promise<T[][]> {
	const out: T[][] = [];
	for await (const batch of iterable) out.push(batch);
	return out;
}

const ROWS = 25_000;
const EVENTS = 1_000;

describe.skipIf(noPg)('keyset chunks and pagination on PostgreSQL', () => {
	let pool: Pool;
	let db: Database;
	const ran: QueryEvent[] = [];

	beforeAll(async () => {
		pool = createPool({
			...options(),
			max: 4,
			params: { search_path: schema },
		});
		db = database(pool, { onQuery: (e) => ran.push(e) });
		await pool.simpleQuery(`
			create schema ${schema};
			set search_path = ${schema};
			create table items (id int primary key, n int not null);
			insert into items select i, i % 10 from generate_series(1, ${ROWS}) i;
			create table events (at timestamptz not null, id bigint not null, label text not null, primary key (at, id));
			insert into events
				select timestamptz '2026-01-01' + (i % 7) * interval '1 hour' + interval '0.000123 seconds',
					i * 10000000000, 'e' || i
				from generate_series(1, ${EVENTS}) i;
			create table empty (id int primary key);
			create table typed (u uuid not null unique, t text not null unique, num numeric not null unique, b bytea not null unique);
			insert into typed
				select md5(i::text)::uuid, 'ü ' || md5(i::text), i / 7.0, decode(md5(i::text), 'hex')
				from generate_series(1, 200) i;
			analyze;
		`);
	});

	afterAll(async () => {
		await pool
			?.query(`drop schema if exists ${schema} cascade`)
			.catch(() => {});
		await pool?.end();
	});

	/** The queries `fn` runs. */
	async function queriesOf(fn: () => Promise<unknown>): Promise<QueryEvent[]> {
		const from = ran.length;
		await fn();
		return ran.slice(from);
	}

	const allIds = Array.from({ length: ROWS }, (_, i) => i + 1);

	it('iterates a large table in exact multiples of the batch size, with one empty query at the end', async () => {
		let batches: { id: number }[][] = [];
		const queries = await queriesOf(async () => {
			batches = await chunks(
				db
					.selectFrom(items)
					.select(['items.id'])
					.iterateChunks(1000, { by: 'items.id' }),
			);
		});
		expect(batches).toHaveLength(25);
		expect(batches.every((batch) => batch.length === 1000)).toBe(true);
		expect(batches.flat().map((row) => row.id)).toEqual(allIds);
		expect(queries).toHaveLength(26);
		expect(queries.at(-1)?.rowCount).toBe(0);
		expect(queries[1]?.sql).toBe(
			'select "items"."id" as "id" from "items" where "items"."id" > $1 order by "items"."id" asc limit $2',
		);
	});

	it('stops at a short batch without another query', async () => {
		let batches: { id: number }[][] = [];
		const queries = await queriesOf(async () => {
			batches = await chunks(
				db
					.selectFrom(items)
					.select(['items.id'])
					.iterateChunks(999, { by: 'items.id' }),
			);
		});
		expect(batches).toHaveLength(26);
		expect(batches.at(-1)).toHaveLength(ROWS - 25 * 999);
		expect(batches.flat().map((row) => row.id)).toEqual(allIds);
		expect(queries).toHaveLength(26);
	});

	it('iterates descending, with a where, and uses the primary key index for the seek', async () => {
		const batches = await chunks(
			db
				.selectFrom(items)
				.select(['items.id', 'items.n'])
				.where('items.n', 3)
				.iterateChunks(400, { by: 'items.id', direction: 'desc' }),
		);
		const expected = allIds.filter((id) => id % 10 === 3).toReversed();
		expect(batches.flat().map((row) => row.id)).toEqual(expected);
		expect(batches.flat().every((row) => row.n === 3)).toBe(true);
		const plan = await pool.query(
			'explain select id from items where id > $1 order by id asc limit $2',
			[ROWS - 100, 10],
		);
		expect(JSON.stringify(plan.rows)).toContain('items_pkey');
	});

	it('iterates a composite key whose first column ties across batches, both directions', async () => {
		const ordered = await pool.query<{ id: string }>(
			'select id::text as id from events order by events.at, events.id',
		);
		const ascending = ordered.rows.map((row) => row.id);
		for (const direction of ['asc', 'desc'] as const) {
			const batches = await chunks(
				db
					.selectFrom(events)
					.select(['events.at', 'events.id', 'events.label'])
					.iterateChunks(7, { by: ['events.at', 'events.id'], direction }),
			);
			expect(batches.flat().map((row) => row.id)).toEqual(
				direction === 'asc' ? ascending : ascending.toReversed(),
			);
			expect(batches.flat()[0]?.at).toBeInstanceOf(Date);
		}
	});

	it('keys by uuid, text, numeric and bytea columns, seeking by their text', async () => {
		for (const column of ['u', 't', 'num', 'b'] as const) {
			const expected = await pool.query<{ k: string }>(
				`select ${column}::text as k from typed order by typed.${column} desc`,
			);
			const seen: string[] = [];
			let after: string | null = null;
			do {
				const page: { rows: unknown[]; nextCursor: string | null } = await db
					.selectFrom(typed)
					.select([`typed.${column}`])
					.paginateByCursor({
						perPage: 30,
						by: `typed.${column}`,
						direction: 'desc',
						after,
					});
				seen.push(
					...(page.rows as Record<string, unknown>[]).map((row) => {
						const value = row[column];
						return value instanceof Uint8Array
							? `\\x${Buffer.from(value).toString('hex')}`
							: String(value);
					}),
				);
				({ nextCursor: after } = page);
			} while (after !== null);
			expect(seen).toEqual(expected.rows.map((row) => row.k));
			const chunked = await chunks(
				db
					.selectFrom(typed)
					.select([`typed.${column}`])
					.iterateChunks(64, { by: `typed.${column}` }),
			);
			expect(chunked.flat()).toHaveLength(200);
		}
	});

	it('yields nothing for an empty table, or a where matching nothing', async () => {
		expect(
			await chunks(
				db
					.selectFrom(empty)
					.select(['empty.id'])
					.iterateChunks(10, { by: 'empty.id' }),
			),
		).toEqual([]);
		expect(
			await chunks(
				db
					.selectFrom(items)
					.select(['items.id'])
					.where('items.n', 42)
					.iterateChunks(10, { by: 'items.id' }),
			),
		).toEqual([]);
	});

	it('sees rows inserted ahead of the key during the iteration, never those behind, and reads none twice', async () => {
		await pool.simpleQuery(
			`create table ${schema}.moving (like ${schema}.items including all);
			 insert into ${schema}.moving select * from ${schema}.items`,
		);
		const moving = defineTable('moving', {
			columns: { id: integer(), n: integer() },
		});
		const seen: number[] = [];
		let round = 0;
		for await (const batch of db
			.selectFrom(moving)
			.select(['moving.id'])
			.iterateChunks(1000, { by: 'moving.id' })) {
			seen.push(...batch.map((row) => row.id));
			round++;
			// another session commits between batches: behind the key, ahead of it, and deletes ahead
			await pool.query('insert into moving (id, n) values ($1, 0), ($2, 0)', [
				-round,
				ROWS + round,
			]);
			if (round === 3) await pool.query('delete from moving where id = 20000');
		}
		expect(new Set(seen).size).toBe(seen.length);
		expect(seen.filter((id) => id < 1)).toEqual([]);
		const original = allIds.filter((id) => id !== 20000);
		const ahead = seen.filter((id) => id > ROWS);
		expect(seen.filter((id) => id >= 1 && id <= ROWS)).toEqual(original);
		// each batch inserts one row past the end, all of which the iteration reaches
		expect(ahead).toEqual(
			Array.from({ length: ahead.length }, (_, i) => ROWS + i + 1),
		);
		expect(ahead.length).toBeGreaterThan(0);
	});

	it('runs every batch in the transaction: with repeatable read, one snapshot', async () => {
		const seen = await db.transaction(
			async (tx) => {
				const ids: number[] = [];
				for await (const batch of tx
					.selectFrom(items)
					.select(['items.id'])
					.where('items.n', 1)
					.iterateChunks(500, { by: 'items.id' })) {
					ids.push(...batch.map((row) => row.id));
					if (ids.length === 500) {
						await pool.query('insert into items (id, n) values ($1, 1)', [
							ROWS + 1,
						]);
					}
				}
				return ids;
			},
			{ isolation: 'repeatable read' },
		);
		expect(seen).toEqual(allIds.filter((id) => id % 10 === 1));
		await pool.query('delete from items where id > $1', [ROWS]);
	});

	it('keeps the locks of every batch until the transaction ends', async () => {
		await db.transaction(async (tx) => {
			let count = 0;
			for await (const batch of tx
				.selectFrom(items)
				.select(['items.id'])
				.where((eb) => eb.ref('items.id').lte(5000))
				.forUpdate()
				.iterateChunks(1000, { by: 'items.id' })) {
				count += batch.length;
			}
			expect(count).toBe(5000);
			await rejection(
				pool.query('select id from items where id = 1234 for update nowait'),
				LockNotAvailable,
			);
		});
		await pool.query('select id from items where id = 1234 for update nowait');
	});

	it('pages through with cursors to the same rows as one ordered query, on a composite timestamptz and bigint key', async () => {
		const ordered = await pool.query<{ id: string }>(
			'select id::text as id from events where label like $1 order by events.at desc, events.id desc',
			['e1%'],
		);
		const expected = ordered.rows.map((row) => row.id);
		const q = db
			.selectFrom(events)
			.select(['events.id', 'events.at'])
			.where((eb) => eb.ref('events.label').like('e1%'));
		const seen: string[] = [];
		let after: string | null = null;
		let pages = 0;
		do {
			const page: Awaited<ReturnType<typeof q.paginateByCursor>> =
				await q.paginateByCursor({
					perPage: 13,
					by: ['events.at', 'events.id'],
					direction: 'desc',
					after,
				});
			seen.push(...page.rows.map((row) => row.id));
			expect(page.hasMore).toBe(page.nextCursor !== null);
			({ nextCursor: after } = page);
			pages++;
		} while (after !== null);
		expect(seen).toEqual(expected);
		expect(pages).toBe(Math.ceil(expected.length / 13));
	});

	it('ends on an exact multiple of the page size without an empty page', async () => {
		const q = db
			.selectFrom(items)
			.select(['items.id'])
			.where((eb) => eb.ref('items.id').lte(20));
		const first = await q.paginateByCursor({ perPage: 10, by: 'items.id' });
		expect(first.hasMore).toBe(true);
		const second = await q.paginateByCursor({
			perPage: 10,
			by: 'items.id',
			after: first.nextCursor,
		});
		expect(second.rows.map((row) => row.id)).toEqual(allIds.slice(10, 20));
		expect(second).toMatchObject({ hasMore: false, nextCursor: null });
		expect(
			await db
				.selectFrom(empty)
				.select(['empty.id'])
				.paginateByCursor({ perPage: 10, by: 'empty.id' }),
		).toEqual({ rows: [], nextCursor: null, hasMore: false });
	});

	it('rejects a cursor of another direction with InvalidCursorError, before running anything', async () => {
		const q = db.selectFrom(items).select(['items.id']);
		const { nextCursor } = await q.paginateByCursor({
			perPage: 10,
			by: 'items.id',
		});
		const queries = await queriesOf(async () => {
			await rejection(
				q.paginateByCursor({
					perPage: 10,
					by: 'items.id',
					direction: 'desc',
					after: nextCursor,
				}),
				InvalidCursorError,
			);
		});
		expect(queries).toEqual([]);
	});

	it('pages by offset, counting the total in the same round trip when asked', async () => {
		const q = db.selectFrom(items).select(['items.id']).where('items.n', 7);
		const total = ROWS / 10;
		const page = await q.paginateByOffset({
			page: 3,
			perPage: 100,
			by: 'items.id',
			countTotal: true,
		});
		expect(page.rows.map((row) => row.id)).toEqual(
			allIds.filter((id) => id % 10 === 7).slice(200, 300),
		);
		expect(page).toMatchObject({ page: 3, perPage: 100, hasMore: true, total });
		const last = await q.paginateByOffset({
			page: total / 100,
			perPage: 100,
			by: 'items.id',
		});
		expect(last.rows).toHaveLength(100);
		expect(last.hasMore).toBe(false);
		expect('total' in last).toBe(false);
		const beyond = await q.paginateByOffset({
			page: 1000,
			perPage: 100,
			by: 'items.id',
			direction: 'desc',
			countTotal: true,
		});
		expect(beyond).toEqual({
			rows: [],
			page: 1000,
			perPage: 100,
			hasMore: false,
			total,
		});
	});
});
