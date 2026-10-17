/* oxlint-disable no-await-in-loop -- iterations run one batch after another */
import { describe, expect, it } from 'vitest';
import { bytea, integer, text, timestamptz } from '../src/column-factories.js';
import type { CompiledQuery } from '../src/compile.js';
import { databaseWith } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import { InvalidCursorError } from '../src/pagination.js';
import { selectFrom } from '../src/select-query-builder.js';
import { codecNames, plain } from './helpers/compiled.js';
import { executorFrom } from './helpers/executor.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text(),
		nickname: text().nullable(),
		createdAt: timestamptz().name('created_at'),
		avatar: bytea(),
	},
});

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		title: text(),
	},
});

/** A database answering each query with the next of `results`, recording the queries. */
function scripted(...results: (readonly unknown[])[]) {
	const ran: CompiledQuery[] = [];
	const db = databaseWith(
		executorFrom(async (query) => {
			ran.push(query);
			return { rows: results.shift() ?? [] };
		}),
	);
	return { db, ran, sql: () => ran.map(plain) };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const item of iterable) out.push(item);
	return out;
}

describe('iterateChunks', () => {
	it('runs one query per batch, seeking past the last key, until a short batch', async () => {
		const { db, sql } = scripted(
			[{ id: 1 }, { id: 2 }],
			[{ id: 3 }, { id: 4 }],
			[{ id: 5 }],
		);
		const batches = await collect(
			db
				.selectFrom(users)
				.select(['users.id'])
				.iterateChunks(2, { by: 'users.id' }),
		);
		expect(batches).toEqual([
			[{ id: 1 }, { id: 2 }],
			[{ id: 3 }, { id: 4 }],
			[{ id: 5 }],
		]);
		expect(sql()).toEqual([
			{
				sql: 'select "users"."id" as "id" from "users" order by "users"."id" asc limit $1',
				params: [2],
			},
			{
				sql: 'select "users"."id" as "id" from "users" where "users"."id" > $1 order by "users"."id" asc limit $2',
				params: ['2', 2],
			},
			{
				sql: 'select "users"."id" as "id" from "users" where "users"."id" > $1 order by "users"."id" asc limit $2',
				params: ['4', 2],
			},
		]);
	});

	it('runs one more, empty, query when the rows are an exact multiple of the size', async () => {
		const { db, ran } = scripted([{ id: 1 }, { id: 2 }], []);
		const batches = await collect(
			db
				.selectFrom(users)
				.select(['users.id'])
				.iterateChunks(2, { by: 'users.id' }),
		);
		expect(batches).toEqual([[{ id: 1 }, { id: 2 }]]);
		expect(ran).toHaveLength(2);
	});

	it('yields nothing for an empty result', async () => {
		const { db, ran } = scripted([]);
		expect(
			await collect(
				db
					.selectFrom(users)
					.select(['users.id'])
					.iterateChunks(10, { by: 'users.id' }),
			),
		).toEqual([]);
		expect(ran).toHaveLength(1);
	});

	it('compares a composite key as a row, descending, seeking by the key exactly as the server wrote it', async () => {
		// the driver returns the key columns as text: they're read with `codecs.raw`
		const at = '2026-01-01 00:00:00.000123+00';
		const { db, ran } = scripted(
			[{ createdAt: at, id: '7', email: 'a@x' }],
			[],
		);
		const batches = await collect(
			db
				.selectFrom(users)
				.select(['users.createdAt', 'users.id', 'users.email'])
				.iterateChunks(1, {
					by: ['users.createdAt', 'users.id'],
					direction: 'desc',
				}),
		);
		expect(batches).toEqual([
			[{ createdAt: new Date(Date.UTC(2026, 0, 1)), id: 7, email: 'a@x' }],
		]);
		expect(plain(ran[1]!)).toEqual({
			sql: 'select "users"."created_at" as "createdAt", "users"."id" as "id", "users"."email" as "email" from "users" where ("users"."created_at", "users"."id") < ($1, $2) order by "users"."created_at" desc, "users"."id" desc limit $3',
			params: [at, '7', 1],
		});
		expect(codecNames(ran[1]!)).toEqual({
			params: ['timestamptz', 'int4', undefined],
			results: ['', '', 'text'],
		});
		expect(ran[1]!.paramCodecs?.[0]?.paramFormat).toBe('text');
	});

	it('encodes the key back to text when an executor decoded it anyway', async () => {
		const at = new Date(Date.UTC(2026, 0, 1, 2, 3, 4, 5));
		const { db, ran } = scripted([{ createdAt: at, id: 7 }], []);
		await collect(
			db
				.selectFrom(users)
				.select(['users.createdAt', 'users.id'])
				.iterateChunks(1, { by: ['users.createdAt', 'users.id'] }),
		);
		const [createdAt, id] = ran[1]!.params;
		expect(new Date(String(createdAt)).getTime()).toBe(at.getTime());
		expect(id).toBe('7');
	});

	it('keeps the where, joins, locks and tag, adding the seek to the where', async () => {
		const { db, sql } = scripted([{ id: 1, title: 't' }], []);
		await collect(
			db
				.selectFrom(posts)
				.innerJoin(users)
				.on('users.id', 'posts.userId')
				.where('users.email', 'a@x')
				.where((eb) =>
					eb.or([eb.ref('posts.title').eq('a'), eb.ref('posts.title').eq('b')]),
				)
				.select(['posts.id', 'posts.title'])
				.forUpdate()
				.of(posts)
				.skipLocked()
				.tag('posts.batch')
				.iterateChunks(1, { by: 'posts.id' }),
		);
		expect(sql()[1]).toEqual({
			sql: 'select "posts"."id" as "id", "posts"."title" as "title" from "posts" inner join "users" on "users"."id" = "posts"."user_id" where ("users"."email" = $1 and ("posts"."title" = $2 or "posts"."title" = $3) and "posts"."id" > $4) order by "posts"."id" asc limit $5 for update of "posts" skip locked',
			params: ['a@x', 'a', 'b', '1', 1],
			tag: 'posts.batch',
		});
	});

	it('reads the key from the next batch only after computing it, so the consumer may change the rows', async () => {
		const { db, ran } = scripted([{ id: 1 }], []);
		for await (const batch of db
			.selectFrom(users)
			.select(['users.id'])
			.iterateChunks(1, { by: 'users.id' })) {
			for (const row of batch) Object.assign(row, { id: 99 });
		}
		expect(ran[1]?.params).toEqual(['1', 1]);
	});

	it('stops querying when the loop breaks', async () => {
		const { db, ran } = scripted([{ id: 1 }], [{ id: 2 }]);
		for await (const _ of db
			.selectFrom(users)
			.select(['users.id'])
			.iterateChunks(1, { by: 'users.id' })) {
			break;
		}
		expect(ran).toHaveLength(1);
	});

	it('rejects keys it cannot seek by, and sizes that are not whole rows', async () => {
		const { db } = scripted();
		const q = db.selectFrom(users).select(['users.id', 'users.email']);
		await expect(
			collect(q.iterateChunks(0, { by: 'users.id' })),
		).rejects.toThrow(RangeError);
		await expect(
			collect(q.iterateChunks(1.5, { by: 'users.id' })),
		).rejects.toThrow(RangeError);
		await expect(
			collect(q.limit(10).iterateChunks(5, { by: 'users.id' })),
		).rejects.toThrow('iterateChunks() adds its own limit: remove limit()');
		await expect(
			// @ts-expect-error the key must be selected
			collect(q.iterateChunks(5, { by: 'users.createdAt' })),
		).rejects.toThrow(
			"iterateChunks() reads the key from each page's last row: select users.createdAt",
		);
		await expect(
			collect(
				db
					.selectFrom(users)
					.select(['users.nickname'])
					// @ts-expect-error the key must be non-null
					.iterateChunks(5, { by: 'users.nickname' }),
			),
		).rejects.toThrow("can't seek past a null: users.nickname is nullable");
		await expect(
			collect(
				db
					.selectFrom(posts)
					.innerJoin(users)
					.on('users.id', 'posts.userId')
					.select(['users.id'])
					// the row's `id` is users.id: the types see only the row's keys
					.iterateChunks(5, { by: 'posts.id' }),
			),
		).rejects.toThrow('select posts.id');
		await expect(
			selectFrom(users)
				.select(['users.id'])
				.iterateChunks(1, { by: 'users.id' })
				.next(),
		).rejects.toThrow('The query has no database to run on');
	});
});

describe('paginateByCursor', () => {
	it('fetches one row more than a page, and gives a cursor only when there is a next page', async () => {
		const { db, sql } = scripted(
			[{ id: 1 }, { id: 2 }, { id: 3 }],
			[{ id: 3 }],
		);
		const q = db.selectFrom(users).select(['users.id']);
		const first = await q.paginateByCursor({ perPage: 2, by: 'users.id' });
		expect(first.rows).toEqual([{ id: 1 }, { id: 2 }]);
		expect(first.hasMore).toBe(true);
		expect(first.nextCursor).toMatch(/^[\w-]+$/);
		const second = await q.paginateByCursor({
			perPage: 2,
			by: 'users.id',
			after: first.nextCursor,
		});
		expect(second).toEqual({
			rows: [{ id: 3 }],
			nextCursor: null,
			hasMore: false,
		});
		expect(sql()).toEqual([
			{
				sql: 'select "users"."id" as "id" from "users" order by "users"."id" asc limit $1',
				params: [3],
			},
			{
				sql: 'select "users"."id" as "id" from "users" where "users"."id" > $1 order by "users"."id" asc limit $2',
				params: ['2', 3],
			},
		]);
	});

	it('returns an empty last page with no cursor', async () => {
		const { db } = scripted([]);
		expect(
			await db
				.selectFrom(users)
				.select(['users.id'])
				.paginateByCursor({ perPage: 5, by: 'users.id', after: null }),
		).toEqual({ rows: [], nextCursor: null, hasMore: false });
	});

	it('sends a cursor value as its codec encoded it, with the column type', async () => {
		const at = new Date(Date.UTC(2026, 4, 6, 7, 8, 9, 10));
		const avatar = new Uint8Array([0, 255, 7]);
		const { db, ran } = scripted(
			[
				{ createdAt: at, avatar, id: 1 },
				{ createdAt: at, avatar, id: 2 },
			],
			[],
		);
		const q = db
			.selectFrom(users)
			.select(['users.createdAt', 'users.avatar', 'users.id']);
		const by = ['users.createdAt', 'users.avatar', 'users.id'] as const;
		const page = await q.paginateByCursor({
			perPage: 1,
			by,
			direction: 'desc',
		});
		await q.paginateByCursor({
			perPage: 1,
			by,
			direction: 'desc',
			after: page.nextCursor,
		});
		const [createdAt, sentAvatar, id] = ran[1]!.params;
		expect(new Date(String(createdAt)).getTime()).toBe(at.getTime());
		expect(sentAvatar).toBe('\\x00ff07');
		expect(id).toBe('1');
		expect(codecNames(ran[1]!).params.slice(0, 3)).toEqual([
			'timestamptz',
			'bytea',
			'int4',
		]);
		expect(ran[1]!.paramCodecs?.[0]?.encode('x')).toBe('x');
	});

	it('rejects a cursor made for another key or direction, or altered, with InvalidCursorError', async () => {
		const { db } = scripted([
			{ id: 1, email: 'a' },
			{ id: 2, email: 'b' },
		]);
		const q = db.selectFrom(users).select(['users.id', 'users.email']);
		const { nextCursor } = await q.paginateByCursor({
			perPage: 1,
			by: 'users.id',
		});
		const cursor = nextCursor!;
		await expect(
			q.paginateByCursor({
				perPage: 1,
				by: 'users.id',
				direction: 'desc',
				after: cursor,
			}),
		).rejects.toThrow(
			new InvalidCursorError('made for by users.id asc, not users.id desc'),
		);
		await expect(
			q.paginateByCursor({ perPage: 1, by: 'users.email', after: cursor }),
		).rejects.toThrow(InvalidCursorError);
		await expect(
			q.paginateByCursor({
				perPage: 1,
				by: ['users.email', 'users.id'],
				after: cursor,
			}),
		).rejects.toThrow(InvalidCursorError);
		for (const bad of ['', 'not a cursor!', `${cursor}x`, 'e30', btoa('[]')]) {
			await expect(
				q.paginateByCursor({ perPage: 1, by: 'users.id', after: bad }),
			).rejects.toThrow(InvalidCursorError);
		}
	});

	it('validates the page size', async () => {
		const { db } = scripted();
		await expect(
			db
				.selectFrom(users)
				.select(['users.id'])
				.paginateByCursor({ perPage: 0, by: 'users.id' }),
		).rejects.toThrow(RangeError);
	});
});

describe('paginateByOffset', () => {
	it('fetches page n with limit perPage + 1 and an offset', async () => {
		const { db, sql } = scripted([
			{ email: 'c' },
			{ email: 'd' },
			{ email: 'e' },
		]);
		const page = await db
			.selectFrom(users)
			.select(['users.email'])
			.where('users.nickname', 'n')
			.paginateByOffset({
				page: 2,
				perPage: 2,
				by: ['users.createdAt', 'users.id'],
				direction: 'desc',
			});
		expect(page).toEqual({
			rows: [{ email: 'c' }, { email: 'd' }],
			page: 2,
			perPage: 2,
			hasMore: true,
		});
		expect(sql()).toEqual([
			{
				sql: 'select "users"."email" as "email" from "users" where "users"."nickname" = $1 order by "users"."created_at" desc, "users"."id" desc limit $2 offset $3',
				params: ['n', 3, 2],
			},
		]);
	});

	it('with countTotal, counts the matching rows in the same batch, without the locks', async () => {
		const ran: CompiledQuery[] = [];
		const db = databaseWith(
			executorFrom(async (query) => {
				ran.push(query);
				return {
					rows: query.sql.startsWith('select count')
						? [{ count: 5n }]
						: [{ id: 5 }],
				};
			}),
		);
		const page = await db
			.selectFrom(users)
			.select(['users.id'])
			.where('users.email', 'a')
			.forUpdate()
			.paginateByOffset({
				page: 3,
				perPage: 2,
				by: 'users.id',
				countTotal: true,
			});
		expect(page).toEqual({
			rows: [{ id: 5 }],
			page: 3,
			perPage: 2,
			hasMore: false,
			total: 5,
		});
		expect(ran.map(plain)).toEqual([
			{
				sql: 'select "users"."id" as "id" from "users" where "users"."email" = $1 order by "users"."id" asc limit $2 offset $3 for update',
				params: ['a', 3, 4],
			},
			{
				sql: 'select count(*) as "count" from "users" where "users"."email" = $1',
				params: ['a'],
			},
		]);
	});

	it('validates the page and page size', async () => {
		const { db } = scripted();
		const q = db.selectFrom(users).select(['users.id']);
		await expect(
			q.paginateByOffset({ page: 0, perPage: 2, by: 'users.id' }),
		).rejects.toThrow('paginateByOffset() takes a page from 1, not 0');
		await expect(
			q.paginateByOffset({ page: 1, perPage: -1, by: 'users.id' }),
		).rejects.toThrow(RangeError);
		await expect(
			q.limit(1).paginateByOffset({ page: 1, perPage: 2, by: 'users.id' }),
		).rejects.toThrow('adds its own limit');
	});
});
