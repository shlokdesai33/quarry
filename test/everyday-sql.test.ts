import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import {
	array,
	bigint,
	date,
	decimal,
	integer,
	jsonb,
	real,
	text,
	timestamptz,
	vector,
} from '../src/column-factories.js';
import { defineTable } from '../src/define-table.js';
import type { Expression } from '../src/expression.js';
import { expressionBuilder } from '../src/expression-builder.js';
import { deleteFrom } from '../src/delete-query-builder.js';
import { insertInto } from '../src/insert-query-builder.js';
import { selectFrom } from '../src/select-query-builder.js';
import { sql } from '../src/sql.js';
import { update } from '../src/update-query-builder.js';
import { codecNames, plain } from './helpers/compiled.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		name: text(),
		email: text().nullable(),
		age: integer(),
		managerId: integer().name('manager_id').nullable(),
		balance: decimal(),
		score: real(),
		visits: bigint(),
		tags: array(text()),
		settings: jsonb<{ theme: string }>(),
		createdAt: timestamptz().name('created_at'),
		born: date().nullable(),
		embedding: vector().nullable(),
	},
});

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		authorId: integer().name('author_id'),
		title: text(),
	},
});

const ub = expressionBuilder(users);
const compiled = (expression: Expression<unknown>) =>
	plain(compile(expression._quarry.node));

describe('joins', () => {
	it('renders each kind of join', () => {
		const query = selectFrom(users)
			.leftJoin(posts)
			.on('posts.authorId', 'users.id')
			.rightJoin(users.as('m'))
			.on('m.id', 'users.managerId')
			.fullJoin(posts.as('p'))
			.on((eb) => eb.ref('p.id').eq(eb.ref('posts.id')))
			.crossJoin(users.as('c'))
			.select(['users.name', 'p.title']);
		expect(query.toSQL().sql).toBe(
			'select "users"."name" as "name", "p"."title" as "title" from "users" left join "posts" on "posts"."author_id" = "users"."id" right join "users" as "m" on "m"."id" = "users"."manager_id" full join "posts" as "p" on "p"."id" = "posts"."id" cross join "users" as "c"',
		);
	});

	it('rejects a table already in the query, unless aliased', () => {
		// @ts-expect-error users is already in the query
		expect(() => selectFrom(users).leftJoin(users)).toThrow(
			`"users" is already in the query: join it under another name, e.g. users.as('other')`,
		);
		expect(() =>
			selectFrom(users)
				.innerJoin(posts)
				.on('posts.authorId', 'users.id')
				// @ts-expect-error posts is already in the query
				.crossJoin(posts),
		).toThrow('"posts" is already in the query');
	});
});

describe('the select list', () => {
	it('rejects a key selected twice, in one call or across calls', () => {
		const joined = selectFrom(users)
			.innerJoin(posts)
			.on('posts.authorId', 'users.id');
		// @ts-expect-error both are keyed `id`
		expect(() => joined.select(['users.id', 'posts.id'])).toThrow(
			'select each key once: "id" is already in the row; rename one with .as()',
		);
		expect(() =>
			joined
				.select(['users.id'])
				// @ts-expect-error `id` is already selected
				.select((eb) => [eb.fn.lower('posts.title').as('id')]),
		).toThrow('"id" is already in the row');
		expect(
			joined
				.select((eb) => ['users.id', eb.ref('posts.id').as('postId')])
				.toSQL().sql,
		).toBe(
			'select "users"."id" as "id", "posts"."id" as "postId" from "users" inner join "posts" on "posts"."author_id" = "users"."id"',
		);
	});

	it('selects every column of a table, by the name it goes by', () => {
		expect(selectFrom(posts).selectAll('posts').toSQL().sql).toBe(
			'select "posts"."id" as "id", "posts"."author_id" as "authorId", "posts"."title" as "title" from "posts"',
		);
		const joined = selectFrom(users)
			.innerJoin(posts)
			.on('posts.authorId', 'users.id');
		expect(joined.selectAll('posts').toSQL().sql).toMatch(
			/^select "posts"\."id" as "id", "posts"\."author_id" as "authorId", "posts"\."title" as "title" from/,
		);
		expect(selectFrom(posts.as('p')).selectAll('p').toSQL().sql).toBe(
			'select "p"."id" as "id", "p"."author_id" as "authorId", "p"."title" as "title" from "posts" as "p"',
		);
		expect(() =>
			// @ts-expect-error both tables have an `id`
			joined.selectAll('users').selectAll('posts'),
		).toThrow('"id" is already in the row');
		// @ts-expect-error the table name is required
		expect(() => joined.selectAll()).toThrow('"undefined" is not in the query');
		// @ts-expect-error not a table object
		expect(() => joined.selectAll(posts)).toThrow('is not in the query');
	});

	it('reads each selected expression with its type’s codec', () => {
		const query = selectFrom(users).select((eb) => [
			eb.fn.sum('users.age').as('a'),
			eb.fn.avg('users.score').as('b'),
			eb.fn.countDistinct('users.email').as('c'),
			eb.ref('users.age').plus(eb.ref('users.balance')).as('d'),
			eb.case().when(eb.ref('users.age').gt(1), 'x').end().as('e'),
			eb.val(1).as('f'),
			sql<number>`1`.as('g'),
			eb.fn.arrayAgg('users.createdAt').as('h'),
		]);
		expect(codecNames(query.toSQL()).results).toEqual([
			'int8',
			'float8',
			'int8',
			'numeric',
			'text',
			'int4',
			null,
			'timestamptz[]',
		]);
	});
});

describe('clauses', () => {
	it('renders distinct, group by, having, order by, limit and offset in order', () => {
		const query = selectFrom(users)
			.select((eb) => ['users.name', eb.fn.count().as('n')])
			.distinct()
			.where('users.age', 30)
			.groupBy(['users.name'])
			.groupBy((eb) => [eb.fn.lower('users.email')])
			.having((eb) => eb.fn.count().gt('1'))
			.orderBy('n', 'desc')
			.orderBy('users.name', 'asc', { nulls: 'first' })
			.orderBy((eb) => eb.fn.lower('users.name'))
			.limit(10)
			.offset(20);
		expect(plain(query.toSQL())).toEqual({
			sql: 'select distinct "users"."name" as "name", count(*) as "n" from "users" where "users"."age" = $1 group by "users"."name", lower("users"."email") having count(*) > $2 order by "n" desc, "users"."name" asc nulls first, lower("users"."name") limit $3 offset $4',
			params: [30, '1', 10, 20],
		});
	});

	it('renders distinct on, which replaces distinct', () => {
		expect(
			selectFrom(posts)
				.select(['posts.title'])
				.distinct()
				.distinctOn(['posts.authorId', 'title'])
				.orderBy('posts.authorId')
				.toSQL().sql,
		).toBe(
			'select distinct on ("posts"."author_id", "title") "posts"."title" as "title" from "posts" order by "posts"."author_id"',
		);
	});

	it('takes a key of the row only once it is selected', () => {
		expect(() =>
			// @ts-expect-error `n` is not in the row
			selectFrom(users).orderBy('n'),
		).toThrow('"n" is not a key of the row');
	});

	it('checks offset like limit', () => {
		expect(() => selectFrom(users).offset(-1)).toThrow(
			'offset takes a whole number of rows, not -1',
		);
	});
});

describe('precedence', () => {
	it('brackets not() as an operand', () => {
		expect(compiled(ub.not(ub.ref('users.age').gt(18)).isNull())).toEqual({
			sql: '(not ("users"."age" > $1)) is null',
			params: [18],
		});
		expect(compiled(ub.not(ub.ref('users.age').gt(18)).eq(true))).toEqual({
			sql: '(not ("users"."age" > $1)) = $2',
			params: [18, true],
		});
	});

	it('brackets nested arithmetic', () => {
		expect(
			compiled(ub.ref('users.age').plus(1).times(2).gt(ub.ref('users.age'))),
		).toEqual({
			sql: '(("users"."age" + $1) * $2) > "users"."age"',
			params: [1, 2],
		});
	});
});

describe('arithmetic', () => {
	it('sends plain values with their type declared', () => {
		const query = compile(
			ub.ref('users.createdAt').minus('7 days').lt(ub.fn.now())._quarry.node,
		);
		expect(plain(query).sql).toBe('("users"."created_at" - $1) < now()');
		expect(codecNames(query).params).toEqual(['interval']);
		expect(
			codecNames(compile(ub.ref('users.born').plus(1)._quarry.node)).params,
		).toEqual(['int4']);
		expect(
			codecNames(compile(ub.ref('users.visits').plus(1)._quarry.node)).params,
		).toEqual(['int8']);
	});

	it('renders the vector distances', () => {
		expect(compiled(ub.ref('users.embedding').cosineDistance([1, 0]))).toEqual({
			sql: '"users"."embedding" <=> $1',
			params: [[1, 0]],
		});
	});

	it('increments in an update', () => {
		expect(
			plain(
				update(users)
					.set((eb) => ({ visits: eb.ref('users.visits').plus(1) }))
					.where('users.id', 1)
					.toSQL(),
			),
		).toEqual({
			sql: 'update "users" set "visits" = "users"."visits" + $1 where "users"."id" = $2',
			params: [1, 1],
		});
	});
});

describe('case', () => {
	it('renders its branches, with values of the first result’s type', () => {
		const query = compile(
			ub
				.case()
				.when(ub.ref('users.age').gte(65), 'senior')
				.when(ub.ref('users.age').gte(18), 'adult')
				.else('minor')
				.end()._quarry.node,
		);
		expect(plain(query)).toEqual({
			sql: 'case when "users"."age" >= $1 then $2 when "users"."age" >= $3 then $4 else $5 end',
			params: [65, 'senior', 18, 'adult', 'minor'],
		});
		expect(codecNames(query).params).toEqual([
			'int4',
			'text',
			'int4',
			'text',
			'text',
		]);
	});

	it('types numbers as a double precision once one is fractional', () => {
		const query = compile(
			ub.case().when(ub.ref('users.age').gt(1), 1).else(1.5).end()._quarry.node,
		);
		expect(codecNames(query).params).toEqual(['int4', 'float8', 'float8']);
	});

	it('refuses results of different types, or of no known type', () => {
		expect(() =>
			ub
				.case()
				.when(ub.ref('users.age').gt(1), 1)
				// @ts-expect-error a number case takes no string
				.else('x')
				.end(),
		).toThrow('different types');
		expect(() => ub.case().when(ub.ref('users.age').gt(1), null).end()).toThrow(
			'whose type is known',
		);
	});
});

describe('functions', () => {
	it('renders aggregates and their modifiers', () => {
		expect(compiled(ub.fn.countDistinct('users.email'))).toEqual({
			sql: 'count(distinct "users"."email")',
			params: [],
		});
		expect(compiled(ub.fn.stringAgg('users.name', ', '))).toEqual({
			sql: 'string_agg("users"."name", $1)',
			params: [', '],
		});
		expect(
			compiled(
				ub.fn.jsonbBuildObject({ id: 'users.id', "it's": 'users.name' }),
			),
		).toEqual({
			sql: `jsonb_build_object('id', "users"."id", 'it''s', "users"."name")`,
			params: [],
		});
	});

	it('renders the date functions, refusing unknown units', () => {
		expect(compiled(ub.fn.dateTrunc('month', 'users.createdAt'))).toEqual({
			sql: `date_trunc('month', "users"."created_at")`,
			params: [],
		});
		expect(compiled(ub.fn.extract('epoch', 'users.createdAt'))).toEqual({
			sql: 'extract(epoch from "users"."created_at")',
			params: [],
		});
		expect(compiled(ub.fn.currentDate())).toEqual({
			sql: 'current_date',
			params: [],
		});
		// @ts-expect-error not a unit
		expect(() => ub.fn.dateTrunc('fortnight', 'users.createdAt')).toThrow(
			'Unknown date_trunc unit "fortnight"',
		);
		// @ts-expect-error not a field
		expect(() => ub.fn.extract('1 from x); --', 'users.createdAt')).toThrow(
			'Unknown extract field',
		);
	});

	it('takes the secondary arguments of string functions as values', () => {
		expect(compiled(ub.fn.splitPart('users.email', '@', 2))).toEqual({
			sql: 'split_part("users"."email", $1, $2)',
			params: ['@', 2],
		});
		expect(
			compiled(ub.fn.substring('users.name', 1, ub.ref('users.age'))),
		).toEqual({
			sql: 'substring("users"."name", $1, "users"."age")',
			params: [1],
		});
	});

	it('takes greatest / least fallbacks as references or values', () => {
		expect(
			compiled(ub.fn.greatest('users.age', 'users.managerId', 18)),
		).toEqual({
			sql: 'greatest("users"."age", "users"."manager_id", $1)',
			params: [18],
		});
	});
});

describe('sql', () => {
	it('makes values parameters and writes expressions, identifiers and literals', () => {
		const query = selectFrom(users)
			.select((eb) => [sql<string>`upper(${eb.ref('users.name')})`.as('upper')])
			.where(
				(eb) =>
					sql<boolean>`${eb.ref('users.age')} > ${18} and ${sql.id('users', 'name')} <> ${sql.lit("O'Hara")}`,
			)
			.orderBy(sql`random()`);
		expect(plain(query.toSQL())).toEqual({
			sql: `select upper("users"."name") as "upper" from "users" where "users"."age" > $1 and "users"."name" <> 'O''Hara' order by random()`,
			params: [18],
		});
	});

	it('joins lists, and writes tables by name', () => {
		const fragment = sql`select * from ${posts.as('p')} where id in (${sql.join([1, 2, 3])})`;
		expect(compiled(fragment)).toEqual({
			sql: 'select * from "posts" as "p" where id in ($1, $2, $3)',
			params: [1, 2, 3],
		});
	});

	it('refuses undefined and non-finite literals', () => {
		expect(() => sql`select ${undefined}`).toThrow('undefined');
		expect(() => sql.lit(Number.NaN)).toThrow('finite');
	});
});

describe('writes', () => {
	it('return every column with returningAll', () => {
		expect(
			insertInto(posts)
				.values({ authorId: 1, title: 'x' })
				.returningAll()
				.toSQL().sql,
		).toBe(
			'insert into "posts" ("author_id", "title") values ($1, $2) returning "posts"."id" as "id", "posts"."author_id" as "authorId", "posts"."title" as "title"',
		);
		expect(
			deleteFrom(posts).where('posts.id', 1).returningAll().toSQL().sql,
		).toMatch(
			/^delete from "posts" where "posts"\."id" = \$1 returning "posts"\."id" as "id"/,
		);
		expect(() =>
			deleteFrom(posts)
				.where('posts.id', 1)
				.returning(['posts.id'])
				// @ts-expect-error `id` is already returned
				.returningAll(),
		).toThrow('"id" is already in the row');
	});
});
