import { describe, expect, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { compile } from '../src/compile.js';
import { defineTable } from '../src/define-table.js';
import { expressionBuilder } from '../src/expression-builder.js';
import { fragment, selectFrom } from '../src/select-query-builder.js';

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
						eb.or([eb.ref('users.age').lt(13), eb.ref('users.age').gt(65)]),
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

	it('flattens nested and / or of the same kind', () => {
		expect(
			where(
				selectFrom(users).where((eb) =>
					eb.and([
						eb.and([eb.ref('users.age').gt(1), eb.ref('users.age').lt(9)]),
						eb.ref('users.role').eq('admin'),
					]),
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

describe('when', () => {
	const byRole = (role: 'admin' | 'member' | undefined) =>
		selectFrom(users)
			.where((eb) => eb.ref('users.age').gte(18))
			.when(role !== undefined, (qb) => qb.where('users.role', role!));

	it('applies the build when the condition holds', () => {
		expect(where(byRole('admin'))).toEqual({
			sql: '("users"."age" >= $1 and "users"."role" = $2)',
			params: [18, 'admin'],
		});
	});

	it('leaves the query as it is otherwise', () => {
		expect(where(byRole(undefined))).toEqual({
			sql: '"users"."age" >= $1',
			params: [18],
		});
	});
});

const adults = fragment(users, (qb) =>
	qb.where((eb) => eb.ref('users.age').gte(18)),
);
const contactEmail = fragment(contacts, (qb) => qb.select(['contacts.email']));

describe('pipe', () => {
	it('applies the fragment to the query', () => {
		expect(where(selectFrom(users).pipe(adults))).toEqual({
			sql: '"users"."age" >= $1',
			params: [18],
		});
	});

	it('keeps what the query had, after a join', () => {
		const query = selectFrom(users)
			.select(['users.id'])
			.innerJoin(contacts)
			.on('contacts.userId', 'users.id')
			.pipe(adults)
			.pipe(contactEmail);
		expect(compile(query.toNode())).toEqual({
			sql: 'select "users"."id" as "id", "contacts"."email" as "email" from "users" inner join "contacts" on "contacts"."user_id" = "users"."id" where "users"."age" >= $1',
			params: [18],
		});
	});
});

describe('tag', () => {
	it('is stored on the query and compiled beside its SQL, not into it', () => {
		const query = selectFrom(users).select(['users.id']).tag('users.ids');
		expect(query.toNode().tag).toBe('users.ids');
		expect(compile(query.toNode())).toEqual({
			sql: 'select "users"."id" as "id" from "users"',
			params: [],
			tag: 'users.ids',
		});
	});

	it('is absent until set', () => {
		const query = selectFrom(users).select(['users.id']);
		expect(query.toNode().tag).toBeUndefined();
		expect(compile(query.toNode())).not.toHaveProperty('tag');
	});

	it('survives chaining, joins, `when` and `pipe`', () => {
		const query = selectFrom(users)
			.tag('users.withContacts')
			.where('users.role', 'admin')
			.innerJoin(contacts)
			.on('contacts.userId', 'users.id')
			.when(true, (qb) => qb.select(['contacts.email']))
			.pipe(adults)
			.select(['users.id']);
		expect(query.toNode().tag).toBe('users.withContacts');
	});

	it('can be set inside `when` and fragments', () => {
		expect(
			selectFrom(users)
				.when(true, (qb) => qb.tag('inWhen'))
				.toNode().tag,
		).toBe('inWhen');
		const tagged = fragment(users, (qb) => qb.tag('inFragment'));
		expect(selectFrom(users).pipe(tagged).toNode().tag).toBe('inFragment');
	});

	it('is replaced by a later call', () => {
		expect(selectFrom(users).tag('first').tag('second').toNode().tag).toBe(
			'second',
		);
	});

	it('leaves the builder it was called on unchanged', () => {
		const query = selectFrom(users);
		query.tag('ignored');
		expect(query.toNode().tag).toBeUndefined();
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
