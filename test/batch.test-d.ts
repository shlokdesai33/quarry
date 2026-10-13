import { describe, expectTypeOf, it } from 'vitest';
import { BatchError, type BatchResults } from '../src/batch.js';
import { integer, text } from '../src/column-factories.js';
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

describe('shape-only methods', () => {
	it('type a select like the methods that run it', () => {
		expectTypeOf(people.asAll()).toEqualTypeOf<Query<Person[]>>();
		expectTypeOf(people.asFirst()).toEqualTypeOf<Query<Person | undefined>>();
		expectTypeOf(people.asOne()).toEqualTypeOf<Query<Person>>();
		expectTypeOf(people.asMaybeOne()).toEqualTypeOf<
			Query<Person | undefined>
		>();
		expectTypeOf(people.asOne().execute()).toEqualTypeOf<Promise<Person>>();
	});

	it('type writes by their returning list, or their row count', () => {
		const insert = db.insertInto(users).values({ email: 'a@x', name: null });
		expectTypeOf(insert.asExecute()).toEqualTypeOf<Query<WriteResult>>();
		expectTypeOf(insert.returning(['users.id']).asOne()).toEqualTypeOf<
			Query<{ id: number }>
		>();
		const rename = db
			.update(users)
			.set({ name: 'Ada' })
			.where('users.id', 1)
			.returning(['users.name']);
		expectTypeOf(rename.asAll()).toEqualTypeOf<
			Query<{ name: string | null }[]>
		>();
		expectTypeOf(
			db.deleteFrom(users).where('users.id', 1).asExecute(),
		).toEqualTypeOf<Query<WriteResult>>();
	});

	it('need what the running methods need', () => {
		// @ts-expect-error no values yet
		void db.insertInto(users).asExecute();
		// @ts-expect-error no returning list
		void db.insertInto(users).values({ email: 'a@x', name: null }).asOne();
		// @ts-expect-error no where yet
		void db.update(users).set({ name: 'Ada' }).asExecute();
		// @ts-expect-error no where yet
		void db.deleteFrom(users).asExecute();
	});
});

describe('db.batch', () => {
	it('resolves to a tuple of results, by position', async () => {
		const results = await db.batch([
			people.asOne(),
			db
				.selectFrom(posts)
				.select(['posts.title'])
				.where('posts.userId', 1)
				.asAll(),
			db.insertInto(users).values({ email: 'b@x', name: null }).asExecute(),
			db
				.update(users)
				.set({ name: 'Ada' })
				.where('users.id', 1)
				.returning(['users.id'])
				.asMaybeOne(),
		]);
		expectTypeOf(results).toEqualTypeOf<
			[Person, { title: string }[], WriteResult, { id: number } | undefined]
		>();
		const [person, titles] = results;
		expectTypeOf(person.email).toEqualTypeOf<string>();
		expectTypeOf(titles).toEqualTypeOf<{ title: string }[]>();
	});

	it('takes queries built on their own, and arrays of one shape', async () => {
		expectTypeOf(
			await db.batch([selectFrom(users).select(['users.id']).asFirst()]),
		).toEqualTypeOf<[{ id: number } | undefined]>();
		const lookups: Query<Person>[] = [1, 2, 3].map((id) =>
			people.where('users.id', id).asOne(),
		);
		expectTypeOf(await db.batch(lookups)).toEqualTypeOf<Person[]>();
		expectTypeOf(await db.batch([])).toEqualTypeOf<[]>();
	});

	it('maps a tuple type to its results', () => {
		expectTypeOf<
			BatchResults<readonly [Query<number>, Query<string | undefined>]>
		>().toEqualTypeOf<[number, string | undefined]>();
	});

	it('takes run options and a transaction', () => {
		const controller = new AbortController();
		void db.batch([people.asAll()], {
			signal: controller.signal,
			timeout: '2s',
			transaction: true,
		});
		void db.batch([people.asAll()], {
			transaction: { isolation: 'serializable', settings: { 'app.x': 1 } },
		});
		// @ts-expect-error a batch runs once, so it isn't retried
		void db.batch([people.asAll()], { transaction: { retries: 3 } });
		// @ts-expect-error a running query isn't a batch item
		void db.batch([people.one()]);
		// @ts-expect-error nor is a builder
		void db.batch([people]);
	});

	it('runs in a transaction too', async () => {
		await db.transaction(async (tx) => {
			expectTypeOf(tx).toEqualTypeOf<DatabaseTransaction>();
			expectTypeOf(
				await tx.batch([people.asOne(), people.asAll()], {
					transaction: true,
				}),
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
