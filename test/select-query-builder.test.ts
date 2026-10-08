import { describe, expect, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { compile } from '../src/compile.js';
import { defineTable } from '../src/define-table.js';
import { expressionBuilder } from '../src/expression-builder.js';
import { selectFrom } from '../src/select-query-builder.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text().nullable(),
		age: integer(),
		role: text<'admin' | 'member'>(),
	},
});

const contacts = defineTable('contacts', {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		email: text(),
	},
});

const where = (query: {
	toWhereNode(): Parameters<typeof compile>[0] | undefined;
}) => {
	const node = query.toWhereNode();
	return node === undefined ? undefined : compile(node);
};

describe('where', () => {
	it('starts empty', () => {
		expect(selectFrom(users).toWhereNode()).toBeUndefined();
	});

	it('adds `column = value`', () => {
		expect(where(selectFrom(users).where('users.role', 'admin'))).toEqual({
			sql: '"users"."role" = $1',
			params: ['admin'],
		});
	});

	it('adds a condition built in a callback', () => {
		expect(
			where(selectFrom(users).where((eb) => eb.ref('users.age').gte(18))),
		).toEqual({ sql: '"users"."age" >= $1', params: [18] });
	});

	it('joins conditions with and', () => {
		expect(
			where(
				selectFrom(users)
					.where((eb) => eb.ref('users.age').gte(18))
					.where('users.role', 'admin'),
			),
		).toEqual({
			sql: '("users"."age" >= $1 and "users"."role" = $2)',
			params: [18, 'admin'],
		});
	});

	it('takes a predicate', () => {
		const eb = expressionBuilder(users);
		expect(where(selectFrom(users).where(eb.ref('users.age').gt(1)))).toEqual({
			sql: '"users"."age" > $1',
			params: [1],
		});
	});

	it('takes or as one condition, parenthesised among the others', () => {
		expect(
			where(
				selectFrom(users)
					.where((eb) =>
						eb.ref('users.age').lt(13).or(eb.ref('users.age').gt(65)),
					)
					.where('users.role', 'member'),
			),
		).toEqual({
			sql: '(("users"."age" < $1 or "users"."age" > $2) and "users"."role" = $3)',
			params: [13, 65, 'member'],
		});
		expect(
			where(
				selectFrom(users).where((eb) =>
					eb.or([eb.ref('users.age').lt(13), eb.ref('users.email').isNull()]),
				),
			),
		).toEqual({
			sql: '("users"."age" < $1 or "users"."email" is null)',
			params: [13],
		});
	});

	it('flattens chained and / or of the same kind', () => {
		expect(
			where(
				selectFrom(users).where((eb) =>
					eb
						.ref('users.age')
						.gt(1)
						.and(eb.ref('users.age').lt(9))
						.and(eb.ref('users.role').eq('admin')),
				),
			),
		).toEqual({
			sql: '("users"."age" > $1 and "users"."age" < $2 and "users"."role" = $3)',
			params: [1, 9, 'admin'],
		});
	});

	it('destructures the builder', () => {
		expect(
			where(
				selectFrom(users).where(({ ref }) => ref('users.email').isNotNull()),
			),
		).toEqual({ sql: '"users"."email" is not null', params: [] });
	});

	it('leaves the builder it was called on unchanged', () => {
		const query = selectFrom(users);
		query.where('users.age', 18);
		expect(query.toWhereNode()).toBeUndefined();
	});
});

describe('innerJoin', () => {
	it('puts the joined table in scope, keeping earlier conditions', () => {
		const query = selectFrom(users)
			.where((eb) => eb.ref('users.age').gte(18))
			.innerJoin(contacts)
			.on((eb) => eb.ref('contacts.userId').eq(eb.ref('users.id')))
			.where((eb) => eb.ref('contacts.email').like('%@example.com'));

		expect(where(query)).toEqual({
			sql: '("users"."age" >= $1 and "contacts"."email" like $2)',
			params: [18, '%@example.com'],
		});
	});
});
