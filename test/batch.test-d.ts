import { describe, expectTypeOf, it } from 'vitest';
import { BatchError, type BatchResults } from '../src/batch.js';
import { integer, text } from '../src/column-factories.js';
import type { CompiledQuery } from '../src/compile.js';
import { databaseWith, type DatabaseTransaction } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import type { Query } from '../src/query.js';
import { selectFrom } from '../src/select-query-builder.js';
import type { WriteResult } from '../src/write-query.js';
import { fakeExecutor } from './helpers/executor.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text(),
		name: text().nullable(),
	},
});

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		title: text(),
	},
});

const db = databaseWith(fakeExecutor().executor);
const people = db.selectFrom(users).select(['users.id', 'users.email']);
type Person = { id: number; email: string };
const insert = db.insertInto(users).values({ email: 'a@x', name: null });

describe('write queries', () => {
	it('shape their returning rows', () => {
		expectTypeOf(insert.returning(['users.id']).one()).toEqualTypeOf<
			Query<{ id: number }>
		>();
		const rename = db
			.update(users)
			.set({ name: 'Ada' })
			.where('users.id', 1)
			.returning(['users.name']);
		expectTypeOf(rename.all()).toEqualTypeOf<
			Query<{ name: string | null }[]>
		>();
	});

	it('run with execute: the returning rows, or the row count', () => {
		expectTypeOf(insert.execute()).toEqualTypeOf<Promise<WriteResult>>();
		expectTypeOf(insert.returning(['users.id']).execute()).toEqualTypeOf<
			Promise<{ id: number }[]>
		>();
		expectTypeOf(
			db.deleteFrom(users).where('users.id', 1).execute(),
		).toEqualTypeOf<Promise<WriteResult>>();
		expectTypeOf(insert.toQuery()).toEqualTypeOf<Query<WriteResult>>();
	});

	it('need their clauses before they run', () => {
		// @ts-expect-error no values yet
		void db.insertInto(users).execute();
		// @ts-expect-error no where yet
		void db.update(users).set({ name: 'Ada' }).execute();
		// @ts-expect-error no where yet
		void db.deleteFrom(users).execute();
		// @ts-expect-error no returning list
		void insert.one();
	});

	it('show their SQL, with the shape’s limit', () => {
		expectTypeOf(people.one().toSQL()).toEqualTypeOf<CompiledQuery>();
		expectTypeOf(insert.toSQL()).toEqualTypeOf<CompiledQuery>();
	});
});

describe('db.batch', () => {
	it('resolves to a tuple of results, by position', async () => {
		const results = await db.batch([
			people.one(),
			db
				.selectFrom(posts)
				.select(['posts.title'])
				.where('posts.userId', 1)
				.all(),
			db.insertInto(users).values({ email: 'b@x', name: null }),
			db
				.update(users)
				.set({ name: 'Ada' })
				.where('users.id', 1)
				.returning(['users.id'])
				.maybeOne(),
			people,
		]);
		expectTypeOf(results).toEqualTypeOf<
			[
				Person,
				{ title: string }[],
				WriteResult,
				{ id: number } | undefined,
				Person[],
			]
		>();
	});

	it('takes queries built on their own, and arrays of one shape', async () => {
		expectTypeOf(
			await db.batch([selectFrom(users).select(['users.id']).first()]),
		).toEqualTypeOf<[{ id: number } | undefined]>();
		const lookups: Query<Person>[] = [1, 2, 3].map((id) =>
			people.where('users.id', id).one(),
		);
		expectTypeOf(await db.batch(lookups)).toEqualTypeOf<Person[]>();
		expectTypeOf(await db.batch([])).toEqualTypeOf<[]>();
	});

	it('refuses a builder that still needs clauses, and a running query', () => {
		// @ts-expect-error no values yet
		void db.batch([db.insertInto(users)]);
		// @ts-expect-error no where yet
		void db.batch([db.deleteFrom(users)]);
		// @ts-expect-error already running
		void db.batch([people.one().execute()]);
	});

	it('maps a tuple type to its results', () => {
		expectTypeOf<
			BatchResults<readonly [Query<number>, Query<string | undefined>]>
		>().toEqualTypeOf<[number, string | undefined]>();
	});

	it('takes run options and a transaction', () => {
		const controller = new AbortController();
		void db.batch([people.all()], {
			signal: controller.signal,
			timeout: '2s',
			transaction: true,
		});
		void db.batch([people.all()], {
			transaction: { isolation: 'serializable', settings: { 'app.x': 1 } },
		});
		// @ts-expect-error a batch runs once, so it isn't retried
		void db.batch([people.all()], { transaction: { retries: 3 } });
	});

	it('runs in a transaction too', async () => {
		await db.transaction(async (tx) => {
			expectTypeOf(tx).toEqualTypeOf<DatabaseTransaction>();
			expectTypeOf(
				await tx.batch([people.one(), people.all()], { transaction: true }),
			).toEqualTypeOf<[Person, Person[]]>();
		});
	});

	it('fails with every outcome', () => {
		expectTypeOf<BatchError>().toExtend<AggregateError>();
		expectTypeOf<BatchError['results']>().toEqualTypeOf<
			readonly PromiseSettledResult<unknown>[]
		>();
	});
});
