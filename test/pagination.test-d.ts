import { describe, expectTypeOf, it } from 'vitest';
import { integer, text, timestamptz } from '../src/column-factories.js';
import { databaseWith } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import type { CursorPage, KeyColumn, OffsetPage } from '../src/pagination.js';
import { executorFrom } from './helpers/executor.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text(),
		nickname: text().nullable(),
		createdAt: timestamptz().name('created_at'),
	},
});

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		title: text(),
	},
});

const db = databaseWith(executorFrom(async () => ({ rows: [] })));
const q = db
	.selectFrom(users)
	.select(['users.id', 'users.email', 'users.nickname', 'users.createdAt']);
type Row = {
	id: number;
	email: string;
	nickname: string | null;
	createdAt: Date;
};

describe('iterateChunks', () => {
	it('yields batches of the typed rows', () => {
		expectTypeOf(q.iterateChunks(10, { by: 'users.id' })).toEqualTypeOf<
			AsyncGenerator<Row[], void, undefined>
		>();
	});

	it('keys by selected, non-null columns, one or several', () => {
		q.iterateChunks(10, { by: ['users.createdAt', 'users.id'] });
		q.iterateChunks(10, { by: 'users.email', direction: 'desc' });
		q.iterateChunks(10, { by: 'users.id', signal: AbortSignal.timeout(1) });

		// @ts-expect-error nullable: a null key can't be sought past
		q.iterateChunks(10, { by: 'users.nickname' });
		const emails = db.selectFrom(users).select(['users.email']);
		// @ts-expect-error not selected
		emails.iterateChunks(10, { by: 'users.id' });
		// @ts-expect-error not a column in scope
		q.iterateChunks(10, { by: 'posts.id' });
		// @ts-expect-error an empty key
		q.iterateChunks(10, { by: [] });
		// @ts-expect-error a direction is asc or desc
		q.iterateChunks(10, { by: 'users.id', direction: 'up' });
		// @ts-expect-error `by` is required
		q.iterateChunks(10, {});
	});

	it("takes the joined tables' columns, once selected", () => {
		const joined = db
			.selectFrom(posts)
			.innerJoin(users)
			.on('users.id', 'posts.userId')
			.select(['posts.id', 'posts.title', 'users.createdAt']);
		joined.iterateChunks(10, { by: ['users.createdAt', 'posts.id'] });
		expectTypeOf<
			KeyColumn<[typeof posts, typeof users], { id: number; createdAt: Date }>
		>().toEqualTypeOf<'posts.id' | 'users.id' | 'users.createdAt'>();
	});
});

describe('paginateByCursor', () => {
	it('returns a page of the typed rows', async () => {
		const page = await q.paginateByCursor({
			perPage: 20,
			by: 'users.id',
			after: undefined,
		});
		expectTypeOf(page).toEqualTypeOf<CursorPage<Row>>();
		expectTypeOf(page.nextCursor).toEqualTypeOf<string | null>();
		await q.paginateByCursor({
			perPage: 20,
			by: 'users.id',
			after: page.nextCursor,
		});

		// @ts-expect-error nullable key
		await q.paginateByCursor({ perPage: 20, by: 'users.nickname' });
		// @ts-expect-error perPage is required
		await q.paginateByCursor({ by: 'users.id' });
	});
});

describe('paginateByOffset', () => {
	it('adds total only with countTotal: true', async () => {
		expectTypeOf(
			await q.paginateByOffset({ page: 1, perPage: 20, by: 'users.id' }),
		).toEqualTypeOf<OffsetPage<Row>>();
		expectTypeOf(
			await q.paginateByOffset({
				page: 1,
				perPage: 20,
				by: 'users.id',
				countTotal: false,
			}),
		).toEqualTypeOf<OffsetPage<Row>>();
		const counted = await q.paginateByOffset({
			page: 1,
			perPage: 20,
			by: 'users.id',
			countTotal: true,
		});
		expectTypeOf(counted.total).toEqualTypeOf<number>();
		expectTypeOf(counted.rows).toEqualTypeOf<Row[]>();
	});

	it('orders by any column in scope, selected or not, nullable or not', async () => {
		await db
			.selectFrom(users)
			.select(['users.email'])
			.paginateByOffset({
				page: 2,
				perPage: 20,
				by: ['users.nickname', 'users.id'],
			});

		// @ts-expect-error not a column in scope
		await q.paginateByOffset({ page: 1, perPage: 20, by: 'posts.id' });
	});
});
