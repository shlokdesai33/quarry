import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BatchError } from '../src/batch.js';
import { integer, text } from '../src/column-factories.js';
import { databaseWith } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import { NoRowError, TooManyRowsError } from '../src/executor.js';
import type { AnyQuery } from '../src/query.js';
import { selectFrom } from '../src/select-query-builder.js';
import { executorFrom, fakeExecutor } from './helpers/executor.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		firstName: text().name('first_name').nullable(),
		email: text(),
		managerId: integer().name('manager_id').nullable(),
	},
});

const contacts = defineTable('contacts', {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		phone: text().nullable(),
	},
});

/** A database returning `rows`, recording the queries it ran. */
function fake(rows: readonly unknown[]) {
	const { executor, ran } = fakeExecutor(rows);
	return { db: databaseWith(executor), ran };
}

describe('the query', () => {
	it('keys each column by its name, aliasing database names', async () => {
		const { db, ran } = fake([]);
		await db
			.selectFrom(users)
			.select(['users.id', 'users.firstName'])
			.where('users.email', 'ada@example.com')
			.execute();
		expect(ran).toEqual([
			{
				sql: 'select "users"."id" as "id", "users"."first_name" as "firstName" from "users" where "users"."email" = $1',
				params: ['ada@example.com'],
			},
		]);
	});

	it('keys an expression by its alias', async () => {
		const { db, ran } = fake([]);
		await db
			.selectFrom(users)
			.select((eb) => [eb.fn.lower('users.email').as('lowerEmail')])
			.execute();
		expect(ran[0]?.sql).toBe(
			'select lower("users"."email") as "lowerEmail" from "users"',
		);
	});

	it('renders joins with their conditions, and aliased tables', async () => {
		const { db, ran } = fake([]);
		await db
			.selectFrom(users)
			.innerJoin(contacts)
			.on('contacts.userId', 'users.id')
			.innerJoin(users.as('managers'))
			.on((eb) => eb.ref('managers.id').eq(eb.ref('users.managerId')))
			.select(['users.id', 'contacts.phone', 'managers.email'])
			.execute();
		expect(ran[0]?.sql).toBe(
			'select "users"."id" as "id", "contacts"."phone" as "phone", "managers"."email" as "email" from "users" inner join "contacts" on "contacts"."user_id" = "users"."id" inner join "users" as "managers" on "managers"."id" = "users"."manager_id"',
		);
	});

	it('selects no columns until told to', async () => {
		const { db, ran } = fake([]);
		await db.selectFrom(users).execute();
		expect(ran[0]?.sql).toBe('select from "users"');
	});

	it('passes the tag to the executor beside the SQL', async () => {
		const { db, ran } = fake([]);
		await db
			.selectFrom(users)
			.select(['users.id'])
			.tag('users.ids')
			.takeFirst()
			.execute();
		expect(ran).toEqual([
			{
				sql: 'select "users"."id" as "id" from "users"',
				params: [],
				tag: 'users.ids',
			},
		]);
	});

	it('passes no tag when none was set', async () => {
		const { db, ran } = fake([]);
		await db.selectFrom(users).execute();
		expect(ran[0]).not.toHaveProperty('tag');
	});

	it('runs only when started from a database', async () => {
		await expect(selectFrom(users).execute()).rejects.toThrow(
			'The query has no database to run on',
		);
	});

	it('limits the rows only with `limit`', async () => {
		const { db, ran } = fake([]);
		await db.selectFrom(users).select(['users.id']).limit(1).execute();
		expect(ran[0]).toEqual({
			sql: 'select "users"."id" as "id" from "users" limit $1',
			params: [1],
		});
		expect(() => db.selectFrom(users).limit(-1)).toThrow(RangeError);
		expect(() => db.selectFrom(users).limit(1.5)).toThrow(RangeError);
	});
});

/** What `shape` reads from `rows`: its result, or the name of the error it throws. */
const read = (rows: unknown[], shape: AnyQuery) =>
	databaseWith(fakeExecutor(rows).executor)
		.batch([shape])
		.then(([value]) => value)
		.catch((error: unknown) =>
			error instanceof BatchError ? error.errors[0] : error,
		)
		.then((outcome) => (outcome instanceof Error ? outcome.name : outcome));

const notFound = (error: Error) => new Error(`not found: ${error.name}`);

describe('result shapes', () => {
	const query = selectFrom(users).select(['users.id']);
	const shapes = {
		execute: query.toQuery(),
		takeFirst: query.takeFirst(),
		takeValue: query.takeValue(),
		expectNonEmpty: query.expectNonEmpty(),
		expectFirst: query.expectFirst(),
		expectOne: query.expectOne(),
		expectAtMostOne: query.expectAtMostOne(),
		expectValue: query.expectValue(),
	};

	it('never change the SQL', () => {
		for (const shape of Object.values(shapes)) {
			expect(shape.toSQL()).toEqual(query.toSQL());
		}
		expect(query.limit(5).expectOne().toSQL()).toEqual(query.limit(5).toSQL());
	});

	it('ask the executor to decode only the rows they read', async () => {
		const asked: Record<string, unknown> = {};
		await Promise.all(
			Object.entries(shapes).map(([name, shape]) =>
				databaseWith(
					executorFrom(async (_query, options) => {
						asked[name] = {
							rowMode: options?.rowMode,
							keepRows: options?.keepRows,
						};
						return { rows: [{ id: 1 }] };
					}),
				).batch([shape]),
			),
		);
		const value = { rowMode: 'array', keepRows: 1 };
		expect(asked).toEqual({
			execute: {},
			takeFirst: { keepRows: 1 },
			takeValue: value,
			expectNonEmpty: {},
			expectFirst: { keepRows: 1 },
			expectOne: { keepRows: 2 },
			expectAtMostOne: { keepRows: 2 },
			expectValue: value,
		});
	});

	it('read what the shape says from no row, one or several', async () => {
		const results = Object.fromEntries(
			await Promise.all(
				Object.entries(shapes).map(async ([name, shape]) => [
					name,
					await Promise.all(
						[[], [{ id: 1 }], [{ id: 1 }, { id: 2 }, { id: 3 }]].map((rows) =>
							read(rows, shape),
						),
					),
				]),
			),
		);
		const three = [{ id: 1 }, { id: 2 }, { id: 3 }];
		expect(results).toEqual({
			execute: [[], [{ id: 1 }], three],
			takeFirst: [undefined, { id: 1 }, { id: 1 }],
			takeValue: [undefined, 1, 1],
			expectNonEmpty: ['NoRowError', [{ id: 1 }], three],
			expectFirst: ['NoRowError', { id: 1 }, { id: 1 }],
			expectOne: ['NoRowError', { id: 1 }, 'TooManyRowsError'],
			expectAtMostOne: [undefined, { id: 1 }, 'TooManyRowsError'],
			expectValue: ['NoRowError', 1, 1],
		});
	});

	it('read a null value as null, and no row as undefined', async () => {
		const names = (rows: unknown[]) =>
			databaseWith(fakeExecutor(rows).executor)
				.selectFrom(users)
				.select(['users.firstName']);
		expect(
			await names([{ firstName: null }])
				.takeValue()
				.execute(),
		).toBeNull();
		expect(
			await names([{ firstName: null }])
				.expectValue()
				.execute(),
		).toBeNull();
		expect(await names([]).takeValue().execute()).toBeUndefined();
		expect(
			await databaseWith(fakeExecutor([{ count: '3' }]).executor)
				.selectFrom(users)
				.select((eb) => [eb.fn.count().as('count')])
				.takeValue()
				.execute(),
		).toBe('3');
	});

	it('throw what `err` makes of the error instead', async () => {
		const { db } = fake([]);
		const several = fake([{ id: 1 }, { id: 2 }]).db;
		await expect(
			db.selectFrom(users).expectOne(notFound).execute(),
		).rejects.toThrow('not found: NoRowError');
		await expect(
			several.selectFrom(users).expectOne(notFound).execute(),
		).rejects.toThrow('not found: TooManyRowsError');
		await expect(
			several.selectFrom(users).expectAtMostOne(notFound).execute(),
		).rejects.toThrow('not found: TooManyRowsError');
		await expect(
			db.selectFrom(users).expectFirst(notFound).execute(),
		).rejects.toThrow('not found: NoRowError');
		await expect(
			db.selectFrom(users).expectNonEmpty(notFound).execute(),
		).rejects.toThrow('not found: NoRowError');
		await expect(
			db.selectFrom(users).select(['users.id']).expectValue(notFound).execute(),
		).rejects.toThrow('not found: NoRowError');
	});
});

describe('expectOne', () => {
	it('throws when there is none', async () => {
		const failure = fake([]).db.selectFrom(users).expectOne().execute();
		await expect(failure).rejects.toBeInstanceOf(NoRowError);
		await expect(failure).rejects.toMatchObject({
			table: 'users',
			message:
				'The query on "users" returned no row, where exactly one was expected',
			query: { sql: 'select from "users"', params: [] },
		});
	});

	it('keeps the params out of logs and JSON', async () => {
		const error = await fake([])
			.db.selectFrom(users)
			.where('users.email', 'secret-param')
			.expectOne()
			.execute()
			.catch((e: unknown) => e);
		if (!(error instanceof NoRowError)) throw new Error('expected NoRowError');
		expect(error.query.params).toContain('secret-param');
		expect(inspect(error)).not.toContain('secret-param');
		expect(JSON.stringify(error)).not.toContain('secret-param');
		expect(JSON.parse(JSON.stringify(error))).toEqual({
			name: 'NoRowError',
			table: 'users',
		});
	});

	it('keeps the tag on the query it throws with', async () => {
		await expect(
			fake([]).db.selectFrom(users).tag('users.one').expectOne().execute(),
		).rejects.toMatchObject({ query: { tag: 'users.one' } });
	});

	it('throws when there are several, with how many', async () => {
		const failure = fake([{ id: 1 }, { id: 2 }, { id: 3 }])
			.db.selectFrom(users)
			.expectOne()
			.execute();
		await expect(failure).rejects.toBeInstanceOf(TooManyRowsError);
		await expect(failure).rejects.toMatchObject({
			table: 'users',
			count: 3,
			message:
				'The query on "users" returned 3 rows, where exactly one was expected',
		});
	});

	it('counts the rows from the row count, beyond those decoded', async () => {
		const db = databaseWith(
			executorFrom(async () => ({
				rows: [{ id: 1 }, { id: 2 }],
				rowCount: 40,
			})),
		);
		await expect(
			db.selectFrom(users).expectAtMostOne().execute(),
		).rejects.toMatchObject({
			count: 40,
			message:
				'The query on "users" returned 40 rows, where at most one was expected',
		});
	});
});

describe('expectFirst and expectNonEmpty', () => {
	it('say at least one row was expected', async () => {
		await expect(
			fake([]).db.selectFrom(users).expectFirst().execute(),
		).rejects.toThrow(
			'The query on "users" returned no row, where at least one was expected',
		);
		await expect(
			fake([]).db.selectFrom(users).expectNonEmpty().execute(),
		).rejects.toThrow(
			'The query on "users" returned no row, where at least one was expected',
		);
	});
});
