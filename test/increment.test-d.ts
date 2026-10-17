import { describe, expectTypeOf, it } from 'vitest';
import {
	array,
	bigint,
	boolean,
	decimal,
	doublePrecision,
	integer,
	jsonb,
	real,
	smallint,
	text,
	timestamptz,
	uuid,
} from '../src/column-factories.js';
import { databaseWith } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import { dec, inc, type Increment } from '../src/index.js';
import { insertInto } from '../src/insert-query-builder.js';
import { update } from '../src/update-query-builder.js';
import { fakeExecutor } from './helpers/executor.js';

type UserId = number & { readonly __brand: 'UserId' };
declare const ownerId: UserId;

const stats = defineTable('stats', {
	columns: {
		id: integer().identity(),
		small: smallint(),
		views: integer(),
		likes: integer().nullable(),
		visits: bigint(),
		hits: bigint().nullable().default(),
		balance: decimal(10, 2),
		ratio: real(),
		score: doublePrecision().nullable(),
		level: smallint<1 | 2 | 3>(),
		owner: integer<UserId>(),
		total: integer().generated(),
		name: text(),
		flag: boolean(),
		key: uuid(),
		at: timestamptz(),
		data: jsonb<{ n: number }>(),
		counts: array(integer()),
	},
});

const where = 'stats.id';

describe('inc and dec', () => {
	it('return an increment of the amount’s type', () => {
		expectTypeOf(inc(1)).toEqualTypeOf<Increment<1>>();
		expectTypeOf(dec('2.50')).toEqualTypeOf<Increment<'2.50'>>();

		// @ts-expect-error an amount is required
		inc();
		// @ts-expect-error null is no amount
		inc(null);
		// @ts-expect-error nor is a boolean
		dec(true);
		// @ts-expect-error nor a JavaScript bigint: bigint columns take strings
		inc(1n);
	});

	it('are accepted in `set` on every numeric column, nullable or not', () => {
		update(stats)
			.set({
				small: inc(1),
				views: inc(1),
				likes: dec(2),
				visits: inc('9007199254740993'),
				hits: dec('1'),
				balance: inc('10.50'),
				ratio: dec(0.5),
				score: inc(1.5, { coalesce: true }),
				level: inc(1),
				owner: inc(ownerId),
			})
			.where(where, 1);
		const amount: number = 3;
		update(stats)
			.set({ views: inc(amount) })
			.where(where, 1);
	});

	it('take the column’s update type as the amount', () => {
		// @ts-expect-error a bigint is a string, not a number
		update(stats).set({ visits: inc(1) });
		// @ts-expect-error a decimal is a string
		update(stats).set({ balance: dec(1) });
		// @ts-expect-error an integer is a number, not a string
		update(stats).set({ views: inc('1') });
		// @ts-expect-error a branded column takes its brand
		update(stats).set({ owner: inc(1) });
		// @ts-expect-error not one of the column's values
		update(stats).set({ level: inc(4) });
	});

	it('are rejected on non-numeric and read-only columns', () => {
		// @ts-expect-error text is not numeric
		update(stats).set({ name: inc(1) });
		// @ts-expect-error even by a string
		update(stats).set({ name: inc('a') });
		// @ts-expect-error nor is a boolean
		update(stats).set({ flag: inc(1) });
		// @ts-expect-error nor a uuid
		update(stats).set({ key: dec('1') });
		// @ts-expect-error nor a timestamp
		update(stats).set({ at: inc(1) });
		// @ts-expect-error nor jsonb
		update(stats).set({ data: inc(1) });
		// @ts-expect-error nor an array of numbers
		update(stats).set({ counts: inc(1) });
		// @ts-expect-error a generated column is never written
		update(stats).set({ total: inc(1) });
		// @ts-expect-error nor an identity
		update(stats).set({ id: inc(1) });
	});

	it('take a numeric expression of the column’s type', () => {
		update(stats)
			.set((eb) => ({
				views: inc(eb.ref('stats.small')),
				likes: inc(eb.ref('stats.views')),
				hits: dec(eb.ref('stats.visits')),
			}))
			.where(where, 1);

		update(stats)
			// @ts-expect-error a nullable amount could make a non-null column null
			.set((eb) => ({ visits: dec(eb.ref('stats.hits')) }))
			.where(where, 1);
		update(stats)
			// @ts-expect-error an integer expression is no bigint amount
			.set((eb) => ({ visits: inc(eb.ref('stats.views')) }))
			.where(where, 1);
		update(stats)
			// @ts-expect-error a text expression is no amount, though a bigint is a string too
			.set((eb) => ({ visits: inc(eb.ref('stats.name')) }))
			.where(where, 1);
	});

	it('work in an upsert’s doUpdate, by `excluded` or a value', () => {
		const query = insertInto(stats).values({
			small: 1,
			views: 1,
			likes: null,
			visits: '1',
			balance: '0',
			ratio: 1,
			score: null,
			level: 1,
			owner: ownerId,
			name: 'a',
			flag: true,
			key: 'k',
			at: new Date(),
			data: { n: 1 },
			counts: [],
		});
		query.onConflict('key').doUpdate((excluded) => ({
			views: inc(excluded.views),
			likes: inc(excluded.likes, { coalesce: true }),
			visits: dec(excluded.visits),
			balance: inc('1'),
		}));

		query
			.onConflict('key')
			// @ts-expect-error a text column can't be incremented
			.doUpdate((excluded) => ({ name: inc(excluded.name) }));
		query
			.onConflict('key')
			// @ts-expect-error an integer is no bigint amount
			.doUpdate((excluded) => ({ visits: inc(excluded.views) }));
	});

	it('are not insert values', () => {
		// @ts-expect-error an insert has no current value to add to
		insertInto(stats).values({ views: inc(1) });
	});

	it('work in the rows of setEach, by values', () => {
		update(stats).setEach(
			[
				{ id: 1, views: inc(1), visits: inc('2') },
				{ id: 2, views: inc(5), visits: inc('3') },
			],
			{ key: 'id' },
		);

		// @ts-expect-error a text column can't be incremented
		update(stats).setEach([{ id: 1, name: inc(1) }], { key: 'id' });
		// @ts-expect-error a bigint is a string
		update(stats).setEach([{ id: 1, visits: inc(1) }], { key: 'id' });
		// @ts-expect-error the key matches rows
		update(stats).setEach([{ id: inc(1), views: 1 }], { key: 'id' });
	});

	it('keep returning, expectRows and running typed', () => {
		const db = databaseWith(fakeExecutor().executor);
		expectTypeOf(
			db
				.update(stats)
				.set({ views: inc(1), visits: inc('1') })
				.where(where, 1)
				.returning(['stats.views', 'stats.visits'])
				.expectOne()
				.execute(),
		).toEqualTypeOf<Promise<{ views: number; visits: string }>>();
		expectTypeOf(
			db
				.update(stats)
				.set({ views: inc(1) })
				.where(where, 1)
				.returning(['stats.views'])
				.expectRows(1)
				.execute(),
		).toEqualTypeOf<Promise<{ views: number }[]>>();
	});
});
