import { describe, expectTypeOf, it } from 'vitest';
import { BatchError, type BatchResults } from '../src/batch.js';
import { integer, text } from '../src/column-factories.js';
import type { CompiledQuery } from '../src/compile.js';
import { databaseWith, type DatabaseTransaction } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import type {
	NoRowError,
	RowCountError,
	TooManyRowsError,
} from '../src/executor.js';
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
const names = db.selectFrom(users).select(['users.name']);
const insert = db.insertInto(users).values({ email: 'a@x', name: null });
const inserted = insert.returning(['users.id']);
const rename = db.update(users).set({ name: 'Ada' }).where('users.id', 1);
const remove = db.deleteFrom(users).where('users.id', 1);

describe('select shapes', () => {
	it('take: never throw', () => {
		expectTypeOf(people.execute()).toEqualTypeOf<Promise<Person[]>>();
		expectTypeOf(people.takeFirst()).toEqualTypeOf<Query<Person | undefined>>();
		expectTypeOf(names.takeValue()).toEqualTypeOf<
			Query<string | null | undefined>
		>();
		expectTypeOf(
			db
				.selectFrom(users)
				.select((eb) => [eb.fn.count().as('count')])
				.takeValue(),
		).toEqualTypeOf<Query<string | undefined>>();
	});

	it('expect: throw when the rows are not as expected', () => {
		expectTypeOf(people.expectNonEmpty()).toEqualTypeOf<
			Query<[Person, ...Person[]]>
		>();
		expectTypeOf(people.expectFirst()).toEqualTypeOf<Query<Person>>();
		expectTypeOf(people.expectOne()).toEqualTypeOf<Query<Person>>();
		expectTypeOf(people.expectAtMostOne()).toEqualTypeOf<
			Query<Person | undefined>
		>();
		expectTypeOf(names.expectValue()).toEqualTypeOf<Query<string | null>>();
	});

	it('expect: take a function making the error to throw', () => {
		expectTypeOf<Parameters<typeof people.expectOne>[0]>().toEqualTypeOf<
			((error: NoRowError | TooManyRowsError) => Error) | undefined
		>();
		expectTypeOf<Parameters<typeof people.expectAtMostOne>[0]>().toEqualTypeOf<
			((error: TooManyRowsError) => Error) | undefined
		>();
		expectTypeOf<Parameters<typeof people.expectFirst>[0]>().toEqualTypeOf<
			((error: NoRowError) => Error) | undefined
		>();
		expectTypeOf<Parameters<typeof people.expectNonEmpty>[0]>().toEqualTypeOf<
			((error: NoRowError) => Error) | undefined
		>();
		void names.expectValue(() => new Error('no user'));
		void people.expectOne(() => new Error('no user'));
	});

	it('read a value only from a row of one column', () => {
		// @ts-expect-error two columns: which is first isn't in the row type
		void people.takeValue();
		// @ts-expect-error two columns
		void people.expectValue();
		// @ts-expect-error no column
		void db.selectFrom(users).takeValue();
	});

	it('are separate: a shaped query takes no other shape', () => {
		// @ts-expect-error a take shape can't be made to throw
		void people.takeFirst().expectOne();
		// @ts-expect-error nor an expect shape chained
		void people.expectOne().takeFirst();
		// @ts-expect-error
		void people.takeFirst().orThrow();
	});

	it('keep the builder’s SQL', () => {
		expectTypeOf(people.expectOne().toSQL()).toEqualTypeOf<CompiledQuery>();
		expectTypeOf(people.limit(1)).toEqualTypeOf<typeof people>();
	});
});

describe('write shapes', () => {
	it('run with execute: the returning rows, or the row count', () => {
		expectTypeOf(insert.execute()).toEqualTypeOf<Promise<WriteResult>>();
		expectTypeOf(inserted.execute()).toEqualTypeOf<Promise<{ id: number }[]>>();
		expectTypeOf(remove.execute()).toEqualTypeOf<Promise<WriteResult>>();
		expectTypeOf(insert.toQuery()).toEqualTypeOf<Query<WriteResult>>();
	});

	it('take the first returning row or value', () => {
		expectTypeOf(inserted.takeFirst()).toEqualTypeOf<
			Query<{ id: number } | undefined>
		>();
		expectTypeOf(inserted.takeValue()).toEqualTypeOf<
			Query<number | undefined>
		>();
		expectTypeOf(rename.returning(['users.name']).takeValue()).toEqualTypeOf<
			Query<string | null | undefined>
		>();
		expectTypeOf(remove.returning(['users.id']).takeFirst()).toEqualTypeOf<
			Query<{ id: number } | undefined>
		>();
	});

	it('expect returning rows', () => {
		expectTypeOf(inserted.expectOne()).toEqualTypeOf<Query<{ id: number }>>();
		expectTypeOf(inserted.expectFirst()).toEqualTypeOf<Query<{ id: number }>>();
		expectTypeOf(
			rename.returning(['users.id']).expectAtMostOne(),
		).toEqualTypeOf<Query<{ id: number } | undefined>>();
		expectTypeOf(remove.returning(['users.id']).expectValue()).toEqualTypeOf<
			Query<number>
		>();
	});

	it('expect a row count, with or without returning', () => {
		expectTypeOf(insert.expectNonEmpty()).toEqualTypeOf<Query<WriteResult>>();
		// branded: the plain check rejects a rest tuple of `{ id: number }`
		expectTypeOf(inserted.expectNonEmpty()).branded.toEqualTypeOf<
			Query<[{ id: number }, ...{ id: number }[]]>
		>();
		expectTypeOf(rename.expectRows(1)).toEqualTypeOf<Query<WriteResult>>();
		expectTypeOf(rename.returning(['users.id']).expectRows(2)).toEqualTypeOf<
			Query<{ id: number }[]>
		>();
		expectTypeOf<Parameters<typeof remove.expectRows>[1]>().toEqualTypeOf<
			((error: RowCountError) => Error) | undefined
		>();
	});

	it('need their clauses before they run or take a shape', () => {
		// @ts-expect-error no values yet
		void db.insertInto(users).execute();
		// @ts-expect-error no where yet
		void db.update(users).set({ name: 'Ada' }).execute();
		// @ts-expect-error no where yet
		void db.deleteFrom(users).expectRows(1);
		// @ts-expect-error no where yet
		void db.deleteFrom(users).expectNonEmpty();
		// @ts-expect-error no values yet
		void db.insertInto(users).returning(['users.id']).takeFirst();
	});

	it('read rows only with a returning list', () => {
		// @ts-expect-error no returning list
		void insert.expectOne();
		// @ts-expect-error no returning list
		void insert.takeFirst();
		// @ts-expect-error no returning list
		void remove.takeValue();
		// @ts-expect-error two returning columns
		void rename.returning(['users.id', 'users.name']).expectValue();
		// @ts-expect-error expectRows is a shape: nothing follows it
		void rename.expectRows(1).returning(['users.id']);
	});
});

describe('db.batch', () => {
	it('resolves to a tuple of results, by position', async () => {
		const results = await db.batch([
			people.expectOne(),
			db.selectFrom(posts).select(['posts.title']).where('posts.userId', 1),
			db.insertInto(users).values({ email: 'b@x', name: null }),
			rename.returning(['users.id']).expectAtMostOne(),
			people,
			people.takeFirst(),
			names.takeValue(),
			people.expectNonEmpty(),
			people.expectFirst(),
			names.expectValue(),
		]);
		expectTypeOf(results).toEqualTypeOf<
			[
				Person,
				{ title: string }[],
				WriteResult,
				{ id: number } | undefined,
				Person[],
				Person | undefined,
				string | null | undefined,
				[Person, ...Person[]],
				Person,
				string | null,
			]
		>();
	});

	it('resolves write shapes in a tuple', async () => {
		const results = await db.batch([
			insert,
			inserted,
			inserted.takeFirst(),
			inserted.takeValue(),
			inserted.expectOne(),
			inserted.expectValue(),
			insert.expectNonEmpty(),
			inserted.expectNonEmpty(),
			rename.expectRows(1),
			remove.returning(['users.id']).expectRows(1),
		]);
		expectTypeOf(results).branded.toEqualTypeOf<
			[
				WriteResult,
				{ id: number }[],
				{ id: number } | undefined,
				number | undefined,
				{ id: number },
				number,
				WriteResult,
				[{ id: number }, ...{ id: number }[]],
				WriteResult,
				{ id: number }[],
			]
		>();
	});

	it('takes queries built on their own, and arrays of one shape', async () => {
		expectTypeOf(
			await db.batch([selectFrom(users).select(['users.id']).takeFirst()]),
		).toEqualTypeOf<[{ id: number } | undefined]>();
		const lookups: Query<Person>[] = [1, 2, 3].map((id) =>
			people.where('users.id', id).expectOne(),
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
		void db.batch([people.expectOne().execute()]);
	});

	it('maps a tuple type to its results', () => {
		expectTypeOf<
			BatchResults<readonly [Query<number>, Query<string | undefined>]>
		>().toEqualTypeOf<[number, string | undefined]>();
	});

	it('takes run options and a transaction', () => {
		const controller = new AbortController();
		void db.batch([people], {
			signal: controller.signal,
			timeout: '2s',
			transaction: true,
		});
		void db.batch([people], {
			transaction: { isolation: 'serializable', settings: { 'app.x': 1 } },
		});
		// @ts-expect-error a batch runs once, so it isn't retried
		void db.batch([people], { transaction: { retries: 3 } });
	});

	it('runs in a transaction too', async () => {
		await db.transaction(async (tx) => {
			expectTypeOf(tx).toEqualTypeOf<DatabaseTransaction>();
			expectTypeOf(
				await tx.batch([people.expectOne(), people], { transaction: true }),
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
