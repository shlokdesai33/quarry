import { describe, expect, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import type { CompiledQuery } from '../src/compile.js';
import { database } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import {
	type Executor,
	NoRowError,
	TooManyRowsError,
} from '../src/executor.js';
import { selectFrom } from '../src/select-query-builder.js';

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
	const ran: CompiledQuery[] = [];
	const executor: Executor = {
		execute: async (query) => {
			ran.push(query);
			return { rows };
		},
	};
	return { db: database(executor), ran };
}

describe('the query', () => {
	it('keys each column by its name, aliasing database names', async () => {
		const { db, ran } = fake([]);
		await db
			.selectFrom(users)
			.select(['users.id', 'users.firstName'])
			.where('users.email', 'ada@example.com')
			.all();
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
			.all();
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
			.all();
		expect(ran[0]?.sql).toBe(
			'select "users"."id" as "id", "contacts"."phone" as "phone", "managers"."email" as "email" from "users" inner join "contacts" on "contacts"."user_id" = "users"."id" inner join "users" as "managers" on "managers"."id" = "users"."manager_id"',
		);
	});

	it('selects no columns until told to', async () => {
		const { db, ran } = fake([]);
		await db.selectFrom(users).all();
		expect(ran[0]?.sql).toBe('select from "users"');
	});

	it('runs only when started from a database', async () => {
		await expect(selectFrom(users).all()).rejects.toThrow(
			'The query has no database to run on',
		);
	});
});

describe('all', () => {
	it('returns every row', async () => {
		const rows = [{ id: 1 }, { id: 2 }];
		expect(
			await fake(rows).db.selectFrom(users).select(['users.id']).all(),
		).toEqual(rows);
	});
});

describe('first', () => {
	it('fetches with `limit 1` and returns the row', async () => {
		const { db, ran } = fake([{ id: 1 }]);
		expect(await db.selectFrom(users).select(['users.id']).first()).toEqual({
			id: 1,
		});
		expect(ran[0]).toEqual({
			sql: 'select "users"."id" as "id" from "users" limit $1',
			params: [1],
		});
	});

	it('returns undefined when there is none', async () => {
		expect(await fake([]).db.selectFrom(users).first()).toBeUndefined();
	});
});

describe('one', () => {
	it('fetches with `limit 2` and returns the one row', async () => {
		const { db, ran } = fake([{ id: 1 }]);
		expect(await db.selectFrom(users).select(['users.id']).one()).toEqual({
			id: 1,
		});
		expect(ran[0]?.params).toEqual([2]);
	});

	it('throws when there is none', async () => {
		const failure = fake([]).db.selectFrom(users).one();
		await expect(failure).rejects.toBeInstanceOf(NoRowError);
		await expect(failure).rejects.toMatchObject({
			query: { sql: 'select from "users" limit $1', params: [2] },
		});
	});

	it('throws when there are several', async () => {
		await expect(
			fake([{ id: 1 }, { id: 2 }])
				.db.selectFrom(users)
				.one(),
		).rejects.toBeInstanceOf(TooManyRowsError);
	});
});

describe('maybeOne', () => {
	it('returns the row, or undefined when there is none', async () => {
		expect(
			await fake([{ id: 1 }])
				.db.selectFrom(users)
				.maybeOne(),
		).toEqual({
			id: 1,
		});
		expect(await fake([]).db.selectFrom(users).maybeOne()).toBeUndefined();
	});

	it('throws when there are several', async () => {
		await expect(
			fake([{ id: 1 }, { id: 2 }])
				.db.selectFrom(users)
				.maybeOne(),
		).rejects.toBeInstanceOf(TooManyRowsError);
	});
});
