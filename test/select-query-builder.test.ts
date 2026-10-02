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

	it('adds a comparison', () => {
		expect(where(selectFrom(users).where('users.age', '>=', 18))).toEqual({
			sql: '"users"."age" >= $1',
			params: [18],
		});
	});

	it('joins conditions with and', () => {
		expect(
			where(
				selectFrom(users)
					.where('users.age', '>=', 18)
					.where('users.role', '=', 'admin'),
			),
		).toEqual({
			sql: '("users"."age" >= $1 and "users"."role" = $2)',
			params: [18, 'admin'],
		});
	});

	it('takes a predicate', () => {
		const eb = expressionBuilder(users);
		expect(where(selectFrom(users).where(eb('users.age', '>', 1)))).toEqual({
			sql: '"users"."age" > $1',
			params: [1],
		});
	});

	it('compares columns through q.ref', () => {
		expect(
			where(
				selectFrom(users).where((q) =>
					q.where('users.age', '>', q.ref('users.id')),
				),
			),
		).toEqual({ sql: '"users"."age" > "users"."id"', params: [] });
	});

	it('leaves the builder it was called on unchanged', () => {
		const query = selectFrom(users);
		query.where('users.age', '>=', 18);
		expect(query.toWhereNode()).toBeUndefined();
	});
});

describe('orWhere', () => {
	it('binds looser than and, as in SQL', () => {
		expect(
			where(
				selectFrom(users)
					.where('users.age', '>=', 18)
					.orWhere('users.role', '=', 'admin')
					.where('users.email', 'is', null),
			),
		).toEqual({
			sql: '("users"."age" >= $1 or ("users"."role" = $2 and "users"."email" is null))',
			params: [18, 'admin'],
		});
	});

	it('acts like where when it comes first', () => {
		expect(where(selectFrom(users).orWhere('users.age', '>=', 18))).toEqual({
			sql: '"users"."age" >= $1',
			params: [18],
		});
	});

	it('parenthesises a group', () => {
		expect(
			where(
				selectFrom(users)
					.where((q) =>
						q.where('users.age', '<', 13).orWhere('users.age', '>', 65),
					)
					.where('users.role', '=', 'member'),
			),
		).toEqual({
			sql: '(("users"."age" < $1 or "users"."age" > $2) and "users"."role" = $3)',
			params: [13, 65, 'member'],
		});
	});

	it('skips an empty group', () => {
		expect(
			where(
				selectFrom(users)
					.where((q) => q)
					.orWhere('users.age', '>=', 18),
			),
		).toEqual({ sql: '"users"."age" >= $1', params: [18] });
	});
});

describe('innerJoin', () => {
	it('puts the joined table in scope, keeping earlier conditions', () => {
		const query = selectFrom(users)
			.where('users.age', '>=', 18)
			.innerJoin(contacts)
			.on((q) => q.where('contacts.userId', '=', q.ref('users.id')))
			.where('contacts.email', 'like', '%@example.com');

		expect(where(query)).toEqual({
			sql: '("users"."age" >= $1 and "contacts"."email" like $2)',
			params: [18, '%@example.com'],
		});
	});
});
