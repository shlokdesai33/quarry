import { describe, expect, it } from 'vitest';
import {
	bigint,
	decimal,
	doublePrecision,
	integer,
	text,
} from '../src/column-factories.js';
import { compile } from '../src/compile.js';
import { databaseWith } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import { dec, inc } from '../src/increment.js';
import { insertInto } from '../src/insert-query-builder.js';
import { update, updateMany } from '../src/update-query-builder.js';
import { fakeExecutor } from './helpers/executor.js';

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		key: text(),
		views: integer(),
		likes: integer().nullable(),
		visits: bigint().name('visit_count'),
		balance: decimal(10, 2),
		score: doublePrecision().nullable(),
		title: text(),
	},
});

/** Breaks the types, as a plain JavaScript caller can. */
const untyped = (value: unknown): never =>
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- what a JS caller passes
	value as never;

describe('inc and dec in an update', () => {
	it('add to and subtract from the column’s current value', () => {
		expect(
			compile(
				update(posts)
					.set({ views: inc(1), balance: dec('2.50') })
					.where('posts.id', 7)
					.toNode(),
			),
		).toEqual({
			sql: 'update "posts" set "views" = "views" + $1, "balance" = "balance" - $2 where "posts"."id" = $3',
			params: [1, '2.50', 7],
		});
	});

	it('use the column’s database name, and its encoding for the amount', () => {
		expect(
			compile(
				update(posts)
					.set({ visits: inc('9007199254740993') })
					.allRows()
					.toNode(),
			),
		).toEqual({
			sql: 'update "posts" set "visit_count" = "visit_count" + $1',
			params: ['9007199254740993'],
		});
	});

	it('leave a null column null, unless `coalesce` counts it as 0', () => {
		expect(
			compile(
				update(posts)
					.set({
						likes: inc(1),
						score: dec(0.5, { coalesce: true }),
					})
					.allRows()
					.toNode(),
			).sql,
		).toBe(
			'update "posts" set "likes" = "likes" + $1, "score" = coalesce("score", 0) - $2',
		);
	});

	it('take an expression as the amount', () => {
		expect(
			compile(
				update(posts)
					.set((eb) => ({ likes: inc(eb.ref('posts.views')) }))
					.allRows()
					.toNode(),
			).sql,
		).toBe('update "posts" set "likes" = "likes" + "posts"."views"');
	});

	it('mix with plain values, returning and expectRows', () => {
		expect(
			update(posts)
				.set({ title: 'Hello', views: inc(1) })
				.where('posts.id', 7)
				.returning(['posts.views'])
				.expectRows(1)
				.toSQL(),
		).toEqual({
			sql: 'update "posts" set "title" = $1, "views" = "views" + $2 where "posts"."id" = $3 returning "posts"."views" as "views"',
			params: ['Hello', 1, 7],
		});
	});

	it('qualify nothing but the current value when the table is aliased', () => {
		expect(
			compile(
				update(posts.as('p'))
					.set({ views: inc(1) })
					.where('p.id', 7)
					.toNode(),
			).sql,
		).toBe(
			'update "posts" as "p" set "views" = "views" + $1 where "p"."id" = $2',
		);
	});

	it('replace, and are replaced by, a value set again', () => {
		const query = update(posts)
			.set({ views: 5 })
			.set({ views: inc(1) });
		expect(compile(query.allRows().toNode()).sql).toBe(
			'update "posts" set "views" = "views" + $1',
		);
		expect(compile(query.set({ views: 0 }).allRows().toNode()).sql).toBe(
			'update "posts" set "views" = $1',
		);
	});

	it('refuse a non-numeric column, or no amount, from a JavaScript caller', () => {
		expect(() => update(posts).set({ title: untyped(inc(1)) })).toThrow(
			'inc() and dec() need a numeric column, and "posts"."title" is text',
		);
		expect(() => inc(untyped(null))).toThrow('inc() needs an amount, not null');
		expect(() => dec(untyped(undefined))).toThrow(
			'dec() needs an amount, not undefined',
		);
		expect(() =>
			insertInto(posts).values(untyped({ key: 'a', views: inc(1) })),
		).toThrow(/only work in an update’s set/);
	});
});

describe('inc and dec in an upsert', () => {
	const query = insertInto(posts).values({
		key: 'a',
		views: 1,
		likes: null,
		visits: '1',
		balance: '0',
		score: null,
		title: 'A',
	});

	it('add to the existing row, qualified by the table', () => {
		expect(
			compile(
				query
					.onConflict('key')
					.doUpdate((excluded) => ({
						views: inc(excluded.views),
						likes: inc(excluded.likes, { coalesce: true }),
						visits: dec('1'),
					}))
					.returning(['posts.views'])
					.toNode(),
			),
		).toEqual({
			sql: 'insert into "posts" ("key", "views", "likes", "visit_count", "balance", "score", "title") values ($1, $2, $3, $4, $5, $6, $7) on conflict ("key") do update set "views" = "posts"."views" + "excluded"."views", "likes" = coalesce("posts"."likes", 0) + "excluded"."likes", "visit_count" = "posts"."visit_count" - $8 returning "posts"."views" as "views"',
			params: ['a', 1, null, '1', '0', null, 'A', '1'],
		});
	});

	it('qualify by the alias of an aliased table', () => {
		const sql = compile(
			insertInto(posts.as('p'))
				.values({
					key: 'a',
					views: 1,
					likes: null,
					visits: '1',
					balance: '0',
					score: null,
					title: 'A',
				})
				.onConflict('key')
				.doUpdate(() => ({ views: inc(1) }))
				.toNode(),
		).sql;
		expect(sql).toContain(
			'on conflict ("key") do update set "views" = "p"."views" + $8',
		);
	});
});

describe('inc and dec in updateMany', () => {
	it('add each row’s own amount, qualified apart from the rows', () => {
		expect(
			compile(
				updateMany(
					posts,
					[
						{ id: 1, title: 'A', views: inc(1), visits: dec('2') },
						{ id: 2, title: 'B', views: inc(5), visits: dec('3') },
					],
					{ by: 'id' },
				)
					.returning(['posts.id', 'posts.views'])
					.toNode(),
			),
		).toEqual({
			sql: 'update "posts" set "title" = "quarry_rows"."title", "views" = "posts"."views" + "quarry_rows"."views", "visit_count" = "posts"."visit_count" - "quarry_rows"."visit_count" from unnest($1::integer[], $2::text[], $3::integer[], $4::bigint[]) as "quarry_rows"("id", "title", "views", "visit_count") where "posts"."id" = "quarry_rows"."id" returning "posts"."id" as "id", "posts"."views" as "views"',
			params: [
				[1, 2],
				['A', 'B'],
				[1, 5],
				['2', '3'],
			],
			paramTypes: [1007, 1009, 1007, 1016],
		});
	});

	it('count null as 0 with `coalesce`', () => {
		expect(
			compile(
				updateMany(
					posts,
					[
						{ id: 1, likes: inc(1, { coalesce: true }) },
						{ id: 2, likes: inc(2, { coalesce: true }) },
					],
					{ by: 'id' },
				).toNode(),
			).sql,
		).toBe(
			'update "posts" set "likes" = coalesce("posts"."likes", 0) + "quarry_rows"."likes" from unnest($1::integer[], $2::integer[]) as "quarry_rows"("id", "likes") where "posts"."id" = "quarry_rows"."id"',
		);
	});

	it('combine with an increment shared by every row', () => {
		expect(
			compile(
				updateMany(posts, [{ id: 1, title: 'A' }], { by: 'id' })
					.set({ views: inc(1) })
					.toNode(),
			).sql,
		).toBe(
			'update "posts" set "views" = "views" + $1, "title" = "quarry_rows"."title" from unnest($2::integer[], $3::text[]) as "quarry_rows"("id", "title") where "posts"."id" = "quarry_rows"."id"',
		);
	});

	it('need every row to change a column alike', () => {
		expect(() =>
			updateMany(
				posts,
				[
					{ id: 1, views: inc(1) },
					{ id: 2, views: dec(1) },
				],
				{ by: 'id' },
			),
		).toThrow('updateMany needs every row to change "views" alike');
		expect(() =>
			updateMany(
				posts,
				[
					{ id: 1, views: inc(1) },
					{ id: 2, views: inc(1, { coalesce: true }) },
				],
				{ by: 'id' },
			),
		).toThrow('updateMany needs every row to change "views" alike');
		expect(() =>
			updateMany(
				posts,
				[
					{ id: 1, views: 3 },
					{ id: 2, views: inc(1) },
				],
				{ by: 'id' },
			),
		).toThrow(/some rows set it to a value and others inc\(\) or dec\(\) it/);
		expect(() =>
			updateMany(posts, untyped([{ key: inc(1), views: 1 }]), { by: 'key' }),
		).toThrow('The `by` column "key" of updateMany matches rows');
		expect(() =>
			updateMany(posts, [{ id: 1, title: untyped(inc(1)) }], { by: 'id' }),
		).toThrow('inc() and dec() need a numeric column');
	});
});

describe('running an increment', () => {
	it('sends the compiled statement and returns its rows', async () => {
		const { executor, ran } = fakeExecutor([{ views: 8 }]);
		const db = databaseWith(executor);
		expect(
			await db
				.update(posts)
				.set({ views: inc(1) })
				.where('posts.id', 7)
				.returning(['posts.views'])
				.expectOne()
				.execute(),
		).toEqual({ views: 8 });
		expect(ran[0]?.sql).toBe(
			'update "posts" set "views" = "views" + $1 where "posts"."id" = $2 returning "posts"."views" as "views"',
		);
	});
});
