import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	bigint,
	decimal,
	doublePrecision,
	integer,
	real,
	text,
} from '../../../src/column-factories.js';
import { database, type Database } from '../../../src/database.js';
import { defineTable } from '../../../src/define-table.js';
import { createPool, type Pool } from '../../../src/driver/pool.js';
import { RowCountError } from '../../../src/executor.js';
import { dec, inc } from '../../../src/increment.js';
import { noPg, options, table } from './helpers.js';

const schema = table('quarry_inc');

const counters = defineTable('counters', {
	columns: {
		id: integer().identity(),
		key: text(),
		hits: integer(),
		likes: integer().nullable(),
		visits: bigint().name('visit_count'),
		balance: decimal(12, 2),
		ratio: real(),
		score: doublePrecision().nullable(),
	},
});

const fresh = {
	hits: 0,
	likes: null,
	visits: '9007199254740990',
	balance: '100.00',
	ratio: 1,
	score: null,
};

describe.skipIf(noPg)('inc and dec on PostgreSQL', () => {
	let pool: Pool;
	let db: Database;

	beforeAll(async () => {
		pool = createPool({
			...options(),
			max: 8,
			params: { search_path: `${schema},public` },
		});
		db = database(pool);
		await pool.simpleQuery(`
			create schema ${schema};
			create table ${schema}.counters (
				id int generated always as identity primary key,
				key text unique not null,
				hits int not null,
				likes int,
				visit_count bigint not null,
				balance numeric(12, 2) not null,
				ratio real not null,
				score double precision
			);
		`);
	});

	afterAll(async () => {
		await pool
			?.query(`drop schema if exists ${schema} cascade`)
			.catch(() => {});
		await pool?.end();
	});

	const create = (key: string) =>
		db
			.insertInto(counters)
			.values({ key, ...fresh })
			.returning(['counters.id'])
			.expectOne()
			.execute()
			.then((row) => row.id);

	it('adds and subtracts exactly on every numeric type, returning the new values', async () => {
		const id = await create('types');
		const row = await db
			.update(counters)
			.set({
				hits: inc(2),
				visits: inc('5'),
				balance: dec('0.10'),
				ratio: inc(0.5),
			})
			.where('counters.id', id)
			.returning([
				'counters.hits',
				'counters.visits',
				'counters.balance',
				'counters.ratio',
			])
			.expectOne()
			.execute();
		expect(row).toEqual({
			hits: 2,
			// past Number.MAX_SAFE_INTEGER, kept exact as a string
			visits: '9007199254740995',
			balance: '99.90',
			ratio: 1.5,
		});
	});

	it('runs in an atomic batch, rolling back when a check fails', async () => {
		const [from, to] = [await create('batch-from'), await create('batch-to')];
		const move = (amount: string, check: number) =>
			db.batch(
				[
					db
						.update(counters)
						.set({ balance: dec(amount) })
						.where('counters.id', from)
						.returning(['counters.balance'])
						.expectValue(),
					db
						.update(counters)
						.set({ balance: inc(amount) })
						.where('counters.id', check)
						.expectNonEmpty(),
				],
				{ transaction: true },
			);
		expect(await move('25.00', to)).toEqual(['75.00', { rowCount: 1 }]);
		await expect(move('25.00', -1)).rejects.toThrow('affected no row');
		const balances = await db
			.selectFrom(counters)
			.select(['counters.balance'])
			.where((eb) => eb.ref('counters.id').in([from, to]))
			.execute();
		expect(balances.map((row) => row.balance).toSorted()).toEqual([
			'125.00',
			'75.00',
		]);
	});

	it('leaves a null column null, unless `coalesce` counts it as 0', async () => {
		const id = await create('nulls');
		const plain = await db
			.update(counters)
			.set({ likes: inc(1), score: dec(1) })
			.where('counters.id', id)
			.returning(['counters.likes', 'counters.score'])
			.expectOne()
			.execute();
		expect(plain).toEqual({ likes: null, score: null });
		const coalesced = await db
			.update(counters)
			.set({
				likes: inc(1, { coalesce: true }),
				score: dec(1.5, { coalesce: true }),
			})
			.where('counters.id', id)
			.returning(['counters.likes', 'counters.score'])
			.expectOne()
			.execute();
		expect(coalesced).toEqual({ likes: 1, score: -1.5 });
	});

	it('checks expectRows after the increment', async () => {
		await expect(
			db
				.update(counters)
				.set({ hits: inc(1) })
				.where('counters.key', 'missing')
				.expectRows(1)
				.execute(),
		).rejects.toBeInstanceOf(RowCountError);
	});

	it('upserts by adding the proposed row to the existing one', async () => {
		const upsert = (key: string, hits: number) =>
			db
				.insertInto(counters)
				.values({ key, ...fresh, hits, likes: hits })
				.onConflict('key')
				.doUpdate((excluded) => ({
					hits: inc(excluded.hits),
					likes: inc(excluded.likes, { coalesce: true }),
					visits: inc('1'),
				}))
				.returning(['counters.hits', 'counters.likes', 'counters.visits'])
				.expectOne()
				.execute();
		expect(await upsert('page', 3)).toEqual({
			hits: 3,
			likes: 3,
			visits: '9007199254740990',
		});
		expect(await upsert('page', 4)).toEqual({
			hits: 7,
			likes: 7,
			visits: '9007199254740991',
		});
	});

	it('updates many rows, each by its own amount', async () => {
		const a = await create('many-a');
		const b = await create('many-b');
		const rows = await db
			.updateMany(
				counters,
				[
					{ id: a, hits: inc(1), balance: dec('1.25') },
					{ id: b, hits: inc(10), balance: dec('50') },
				],
				{ by: 'id' },
			)
			.set({ visits: inc('10') })
			.returning([
				'counters.key',
				'counters.hits',
				'counters.balance',
				'counters.visits',
			])
			.expectRows(2)
			.execute();
		expect(rows.toSorted((x, y) => x.key.localeCompare(y.key))).toEqual([
			{
				key: 'many-a',
				hits: 1,
				balance: '98.75',
				visits: '9007199254741000',
			},
			{
				key: 'many-b',
				hits: 10,
				balance: '50.00',
				visits: '9007199254741000',
			},
		]);
	});

	it('loses no update when many connections increment the same row at once', async () => {
		const id = await create('concurrent');
		const count = 200;
		await Promise.all(
			Array.from({ length: count }, (_, i) =>
				db
					.update(counters)
					.set({
						hits: inc(1),
						visits: dec('1'),
						balance: i % 2 === 0 ? inc('0.01') : dec('0.02'),
					})
					.where('counters.id', id)
					.expectRows(1)
					.execute(),
			),
		);
		const row = await db
			.selectFrom(counters)
			.select(['counters.hits', 'counters.visits', 'counters.balance'])
			.where('counters.id', id)
			.expectOne()
			.execute();
		expect(row).toEqual({
			hits: count,
			visits: '9007199254740790',
			balance: '99.00',
		});
	});

	it('loses no update when many connections upsert the same key at once', async () => {
		const count = 100;
		await Promise.all(
			Array.from({ length: count }, () =>
				db
					.insertInto(counters)
					.values({ key: 'concurrent-upsert', ...fresh, hits: 1 })
					.onConflict('key')
					.doUpdate((excluded) => ({ hits: inc(excluded.hits) }))
					.execute(),
			),
		);
		const row = await db
			.selectFrom(counters)
			.select(['counters.hits'])
			.where('counters.key', 'concurrent-upsert')
			.expectOne()
			.execute();
		expect(row.hits).toBe(count);
	});

	it('adds to the value a concurrent transaction committed while it waited', async () => {
		const id = await create('interleaved');
		const held = Promise.withResolvers<void>();
		const updated = Promise.withResolvers<void>();
		const first = db.transaction(async (tx) => {
			await tx
				.update(counters)
				.set({ hits: inc(1) })
				.where('counters.id', id)
				.execute();
			updated.resolve();
			await held.promise;
		});
		await updated.promise;
		let secondDone = false;
		const second = db
			.update(counters)
			.set({ hits: inc(1) })
			.where('counters.id', id)
			.returning(['counters.hits'])
			.expectOne()
			.execute()
			.finally(() => {
				secondDone = true;
			});
		// the row is locked by the first transaction, so the second waits
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(secondDone).toBe(false);
		held.resolve();
		await first;
		expect(await second).toEqual({ hits: 2 });
	});
});
