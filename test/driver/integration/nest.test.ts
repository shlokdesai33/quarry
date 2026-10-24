import {
	afterAll,
	beforeAll,
	describe,
	expect,
	expectTypeOf,
	it,
} from 'vitest';
import { integer, text, timestamptz } from '../../../src/column-factories.js';
import { database, type Database } from '../../../src/database.js';
import { defineTable } from '../../../src/define-table.js';
import { createPool, type Pool } from '../../../src/driver/pool.js';
import { noPg, options, table } from './helpers.js';

const schema = table('nest');

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		name: text(),
		managerId: integer().name('manager_id').nullable(),
	},
});

const bookings = defineTable('bookings', {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		note: text().nullable(),
		at: timestamptz().nullable(),
	},
});

describe.skipIf(noPg)('nest on PostgreSQL', () => {
	let pool: Pool;
	let db: Database;

	beforeAll(async () => {
		pool = createPool({
			...options(),
			max: 2,
			params: { search_path: `${schema},public` },
		});
		db = database(pool);
		await pool.simpleQuery(`
			create schema ${schema};
			create table users (
				id int generated always as identity primary key, name text not null, manager_id int
			);
			create table bookings (
				id int generated always as identity primary key, user_id int not null,
				note text, at timestamptz
			);
		`);
		await db
			.insertInto(users)
			.values([
				{ name: 'Ada', managerId: null },
				{ name: 'Alan', managerId: 1 },
				{ name: 'Grace', managerId: 1 },
			])
			.execute();
		await db
			.insertInto(bookings)
			.values([
				{ userId: 1, note: 'window', at: new Date('2026-01-02T03:04:05Z') },
				// a row whose picked columns are all null
				{ userId: 2, note: null, at: null },
			])
			.execute();
	});

	afterAll(async () => {
		await pool
			?.query(`drop schema if exists ${schema} cascade`)
			.catch(() => {});
		await pool?.end();
	});

	const withBookings = () =>
		db
			.selectFrom(users)
			.leftJoin(bookings)
			.on('bookings.userId', 'users.id')
			.select(({ nest }) => ['users.id', nest('bookings', ['note', 'at'])]);

	const expected = [
		{
			id: 1,
			bookings: { note: 'window', at: new Date('2026-01-02T03:04:05Z') },
		},
		{ id: 2, bookings: { note: null, at: null } },
		{ id: 3, bookings: null },
	];

	it('is null without a match, an object of nulls with one whose columns are null', async () => {
		const query = withBookings().orderBy('users.id');
		// the first run reads text; the cached statement's next runs read binary
		for (let run = 0; run < 3; run++) {
			// oxlint-disable-next-line no-await-in-loop -- one run after another
			const rows = await query.execute();
			expect(rows).toEqual(expected);
			expect(Object.keys(rows[2] ?? {})).toEqual(['id', 'bookings']);
		}
		expectTypeOf(await query.execute()).toEqualTypeOf<
			{
				id: number;
				bookings: { note: string | null; at: Date | null } | null;
			}[]
		>();
	});

	it('reads the same without prepared statements', async () => {
		const unprepared = database(pool, { prepare: false });
		const rows = await unprepared
			.selectFrom(users)
			.leftJoin(bookings)
			.on('bookings.userId', 'users.id')
			.select(({ nest }) => ['users.id', nest('bookings', ['note', 'at'])])
			.orderBy('users.id')
			.execute();
		expect(rows).toEqual(expected);
	});

	it('is never null on an inner join, and takes every column without a list', async () => {
		const rows = await db
			.selectFrom(users)
			.innerJoin(bookings)
			.on('bookings.userId', 'users.id')
			.select(({ nest }) => [nest('users', ['name']), nest('bookings')])
			.orderBy('users.id')
			.execute();
		expect(rows).toEqual([
			{
				users: { name: 'Ada' },
				bookings: {
					id: 1,
					userId: 1,
					note: 'window',
					at: new Date('2026-01-02T03:04:05Z'),
				},
			},
			{
				users: { name: 'Alan' },
				bookings: { id: 2, userId: 2, note: null, at: null },
			},
		]);
	});

	it('nests several tables, an alias and a rename', async () => {
		const managers = users.as('managers');
		const rows = await db
			.selectFrom(users)
			.leftJoin(managers)
			.on('managers.id', 'users.managerId')
			.leftJoin(bookings)
			.on('bookings.userId', 'users.id')
			.select(({ nest }) => [
				'users.name',
				nest('managers', ['name']).as('manager'),
				nest('bookings', ['id']),
			])
			.orderBy('users.id')
			.execute();
		expect(rows).toEqual([
			{ name: 'Ada', manager: null, bookings: { id: 1 } },
			{ name: 'Alan', manager: { name: 'Ada' }, bookings: { id: 2 } },
			{ name: 'Grace', manager: { name: 'Ada' }, bookings: null },
		]);
	});

	it('follows a right join', async () => {
		const rows = await db
			.selectFrom(bookings)
			.rightJoin(users)
			.on('users.id', 'bookings.userId')
			.select(({ nest }) => ['users.id', nest('bookings', ['id'])])
			.orderBy('users.id')
			.execute();
		expect(rows).toEqual([
			{ id: 1, bookings: { id: 1 } },
			{ id: 2, bookings: { id: 2 } },
			{ id: 3, bookings: null },
		]);
	});

	it('reads the object with every result shape', async () => {
		const query = withBookings().where('users.id', 3);
		expect(await query.takeFirst().execute()).toEqual({
			id: 3,
			bookings: null,
		});
		expect(await query.expectOne().execute()).toEqual({
			id: 3,
			bookings: null,
		});
		expect(await query.expectAtMostOne().execute()).toEqual({
			id: 3,
			bookings: null,
		});
		const value = db
			.selectFrom(users)
			.leftJoin(bookings)
			.on('bookings.userId', 'users.id')
			.select(({ nest }) => [nest('bookings', ['note'])])
			.orderBy('users.id');
		expect(await value.takeValue().execute()).toEqual({ note: 'window' });
		expect(await value.where('users.id', 3).expectValue().execute()).toBe(null);
	});

	it('streams', async () => {
		const rows: unknown[] = [];
		for await (const row of withBookings()
			.orderBy('users.id')
			.stream({ batchSize: 2 }))
			rows.push(row);
		expect(rows).toEqual(expected);
	});

	it('paginates', async () => {
		const pages: unknown[][] = [];
		for await (const batch of withBookings().iterateChunks(2, {
			by: 'users.id',
		}))
			pages.push(batch);
		expect(pages).toEqual([expected.slice(0, 2), expected.slice(2)]);

		const first = await withBookings().paginateByCursor({
			perPage: 2,
			by: 'users.id',
		});
		expect(first.rows).toEqual(expected.slice(0, 2));
		const second = await withBookings().paginateByCursor({
			perPage: 2,
			by: 'users.id',
			after: first.nextCursor,
		});
		expect(second.rows).toEqual(expected.slice(2));

		const page = await withBookings().paginateByOffset({
			page: 2,
			perPage: 2,
			by: 'users.id',
			countTotal: true,
		});
		expect(page).toEqual({
			rows: expected.slice(2),
			page: 2,
			perPage: 2,
			hasMore: false,
			total: 3,
		});
	});

	it('runs in db.batch, alone and in a transaction', async () => {
		const query = withBookings().orderBy('users.id');
		const [all, one] = await db.batch([
			query,
			withBookings().where('users.id', 3).expectOne(),
		]);
		expect(all).toEqual(expected);
		expect(one).toEqual({ id: 3, bookings: null });
		const [inTransaction] = await db.batch([query], { transaction: true });
		expect(inTransaction).toEqual(expected);
		const inside = await db.transaction((tx) =>
			tx
				.selectFrom(users)
				.leftJoin(bookings)
				.on('bookings.userId', 'users.id')
				.select(({ nest }) => ['users.id', nest('bookings', ['note', 'at'])])
				.orderBy('users.id')
				.execute(),
		);
		expect(inside).toEqual(expected);
	});
});
