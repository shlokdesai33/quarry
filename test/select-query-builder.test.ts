import { describe, expect, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { compile } from '../src/compile.js';
import { plain } from './helpers/compiled.js';
import { defineTable } from '../src/define-table.js';
import { expressionBuilder } from '../src/expression-builder.js';
import {
	fragment,
	type SelectQueryBuilder,
	selectFrom,
} from '../src/select-query-builder.js';

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
	return node === undefined ? undefined : plain(compile(node));
};

// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the undefined a plain JS caller, or an `as` cast, can pass
const missing = undefined as never;
const message = (reference: string) =>
	`${reference} is compared with undefined. For an optional filter, use .when(): .when(value !== undefined, (qb) => qb.where('${reference}', value)). For SQL NULL, use isNull().`;

describe('undefined in a comparison', () => {
	it('throws for `where(column, undefined)`, naming the column as written', () => {
		expect(() => selectFrom(users).where('users.email', missing)).toThrow(
			new TypeError(message('users.email')),
		);
		expect(() =>
			selectFrom(contacts).where('contacts.userId', missing),
		).toThrow(message('contacts.userId'));
	});

	it('throws for comparison methods, lists, ranges and arrays', () => {
		const eb = expressionBuilder(users);
		expect(() => eb.ref('users.age').gt(missing)).toThrow(message('users.age'));
		expect(() => eb.ref('users.age').in([1, missing])).toThrow(
			message('users.age'),
		);
		expect(() => eb.ref('users.age').in(eb.val([1, missing]))).toThrow(
			message('users.age'),
		);
		expect(() => eb.ref('users.age').between([1, missing])).toThrow(
			message('users.age'),
		);
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the types only take an array parameter here
		expect(() => eb.ref('users.age').eq(eb.val(missing) as never)).toThrow(
			message('users.age'),
		);
		expect(() => eb.fn.lower('users.email').eq(missing)).toThrow(
			/^An expression is compared with undefined\. .*qb\.where\(…\)/,
		);
	});

	it('still compares with null, and skips an optional filter through `when`', () => {
		const role = missing as 'admin' | undefined;
		expect(
			where(
				selectFrom(users)
					.where('users.age', 1)
					.when(role !== undefined, (qb) => qb.where('users.role', role!)),
			),
		).toEqual({ sql: '"users"."age" = $1', params: [1] });
		expect(
			where(selectFrom(users).where((eb) => eb.ref('users.email').isNull())),
		).toEqual({ sql: '"users"."email" is null', params: [] });
	});
});

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
		expect(plain(compile(query.toNode()))).toEqual({
			sql: 'select "users"."id" as "id", "contacts"."email" as "email" from "users" inner join "contacts" on "contacts"."user_id" = "users"."id" where "users"."age" >= $1',
			params: [18],
		});
	});
});

describe('tag', () => {
	it('is stored on the query and compiled beside its SQL, not into it', () => {
		const query = selectFrom(users).select(['users.id']).tag('users.ids');
		expect(query.toNode().tag).toBe('users.ids');
		expect(plain(compile(query.toNode()))).toEqual({
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

const sql = (query: { toNode(): Parameters<typeof compile>[0] }) =>
	compile(query.toNode()).sql;

describe('locking', () => {
	it('renders each strength', () => {
		const query = selectFrom(users).select(['users.id']);
		expect(sql(query.forUpdate())).toBe(
			'select "users"."id" as "id" from "users" for update',
		);
		expect(sql(query.forNoKeyUpdate())).toMatch(/ for no key update$/);
		expect(sql(query.forShare())).toMatch(/ for share$/);
		expect(sql(query.forKeyShare())).toMatch(/ for key share$/);
	});

	it('renders `of` and the wait policy after the where clause', () => {
		expect(
			plain(
				compile(
					selectFrom(users)
						.select(['users.id'])
						.where('users.role', 'admin')
						.forUpdate()
						.of(users)
						.skipLocked()
						.toNode(),
				),
			),
		).toEqual({
			sql: 'select "users"."id" as "id" from "users" where "users"."role" = $1 for update of "users" skip locked',
			params: ['admin'],
		});
		expect(sql(selectFrom(users).forShare().noWait())).toBe(
			'select from "users" for share nowait',
		);
	});

	it('renders after the limit', () => {
		expect(
			compile(selectFrom(users).forUpdate().skipLocked().limit(1).toNode()),
		).toEqual({
			sql: 'select from "users" limit $1 for update skip locked',
			params: [1],
		});
		expect(sql(selectFrom(users).limit(1).forUpdate().skipLocked())).toBe(
			'select from "users" limit $1 for update skip locked',
		);
	});

	it('names tables in `of` as the query references them', () => {
		const managers = users.as('managers');
		const query = selectFrom(contacts)
			.innerJoin(managers)
			.on('managers.id', 'contacts.userId');
		expect(sql(query.forUpdate().of(managers, 'contacts'))).toBe(
			'select from "contacts" inner join "users" as "managers" on "managers"."id" = "contacts"."user_id" for update of "managers", "contacts"',
		);
	});

	it('takes several clauses, in order', () => {
		expect(
			sql(
				selectFrom(users)
					.innerJoin(contacts)
					.on('contacts.userId', 'users.id')
					.forUpdate()
					.of(contacts)
					.noWait()
					.forKeyShare()
					.of(users),
			),
		).toMatch(/ for update of "contacts" nowait for key share of "users"$/);
	});

	it('keeps the clause through later methods, joins, `when` and `pipe`', () => {
		const query = selectFrom(users)
			.forUpdate()
			.where('users.role', 'admin')
			.innerJoin(contacts)
			.on('contacts.userId', 'users.id')
			.of(contacts)
			.select(['users.id'])
			.tag('locked')
			.skipLocked()
			.when(true, (qb) => qb.where('users.age', 1))
			.pipe(adults);
		expect(query.toNode().locks).toEqual([
			{ strength: 'update', of: ['contacts'], wait: 'skip locked' },
		]);
	});

	it('can be added inside `when` and fragments', () => {
		expect(
			selectFrom(users)
				.when(true, (qb) => qb.forShare().skipLocked())
				.toNode().locks,
		).toEqual([{ strength: 'share', of: [], wait: 'skip locked' }]);
		expect(
			selectFrom(users)
				.when(false, (qb) => qb.forShare())
				.toNode().locks,
		).toEqual([]);
		const locked = fragment(users, (qb) => qb.forUpdate().of(users));
		expect(selectFrom(users).pipe(locked).toNode().locks).toEqual([
			{ strength: 'update', of: ['users'], wait: undefined },
		]);
	});

	it('throws for modifiers in the wrong place, as a cast or plain JS call can make them', () => {
		type Open = SelectQueryBuilder<[typeof users], unknown, 'strength'>;
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the methods' `this` types rule these calls out
		const unlocked = selectFrom(users) as unknown as Open;
		expect(() => unlocked.skipLocked()).toThrow(
			'skipLocked() needs a locking clause first: forUpdate(), forNoKeyUpdate(), forShare() or forKeyShare()',
		);
		expect(() => unlocked.of(users)).toThrow(
			'of() needs a locking clause first',
		);
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- as above
		const waited = selectFrom(users).forUpdate().noWait() as unknown as Open;
		expect(() => waited.skipLocked()).toThrow(
			'A locking clause takes one of skipLocked() and noWait()',
		);
		expect(() => waited.of(users)).toThrow(
			'of() comes right after forUpdate(), forNoKeyUpdate(), forShare() or forKeyShare()',
		);
	});

	it('refuses aggregates in the select list when compiling', () => {
		const query = selectFrom(users)
			.select((eb) => [eb.fn.count().as('n')])
			.forUpdate();
		expect(() => compile(query.toNode())).toThrow(
			'A locking clause (forUpdate() and the like) cannot be used with aggregate functions',
		);
		expect(() =>
			compile(
				selectFrom(users)
					.select((eb) => [
						eb.fn.coalesce(eb.fn.max('users.age'), eb.val(0)).as('n'),
					])
					.forShare()
					.toNode(),
			),
		).toThrow('aggregate functions');
		expect(
			sql(
				selectFrom(users)
					.select((eb) => [eb.fn.lower('users.role').as('role')])
					.forUpdate(),
			),
		).toMatch(/ for update$/);
	});

	it('refuses every aggregate eb.fn builds', () => {
		const base = selectFrom(users);
		const aggregated = {
			count: base.select((eb) => [eb.fn.count().as('n')]),
			countDistinct: base.select((eb) => [
				eb.fn.countDistinct('users.age').as('n'),
			]),
			min: base.select((eb) => [eb.fn.min('users.age').as('n')]),
			max: base.select((eb) => [eb.fn.max('users.age').as('n')]),
			sum: base.select((eb) => [eb.fn.sum('users.age').as('n')]),
			avg: base.select((eb) => [eb.fn.avg('users.age').as('n')]),
			arrayAgg: base.select((eb) => [eb.fn.arrayAgg('users.age').as('n')]),
			stringAgg: base.select((eb) => [
				eb.fn.stringAgg('users.role', ', ').as('n'),
			]),
			boolAnd: base.select((eb) => [
				eb.fn.boolAnd(eb.ref('users.age').gt(18)).as('n'),
			]),
			boolOr: base.select((eb) => [
				eb.fn.boolOr(eb.ref('users.age').gt(18)).as('n'),
			]),
			jsonbAgg: base.select((eb) => [eb.fn.jsonbAgg('users.age').as('n')]),
		};
		for (const [name, query] of Object.entries(aggregated)) {
			expect(() => compile(query.forUpdate().toNode()), name).toThrow(
				'A locking clause (forUpdate() and the like) cannot be used with aggregate functions',
			);
		}
	});

	it('leaves the builder it was called on unchanged', () => {
		const query = selectFrom(users);
		query.forUpdate();
		const locked = query.forUpdate();
		locked.skipLocked();
		expect(query.toNode().locks).toEqual([]);
		expect(locked.toNode().locks).toEqual([
			{ strength: 'update', of: [], wait: undefined },
		]);
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
