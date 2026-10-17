import { describe, expectTypeOf, it } from 'vitest';
import {
	array,
	bigint,
	date,
	decimal,
	doublePrecision,
	integer,
	interval,
	jsonb,
	real,
	smallint,
	text,
	timestamptz,
	uuid,
	vector,
} from '../src/column-factories.js';
import { database } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import type { Expression } from '../src/expression.js';
import { expressionBuilder } from '../src/expression-builder.js';
import { fragment, selectFrom } from '../src/select-query-builder.js';
import { sql } from '../src/sql.js';
import { insertInto } from '../src/insert-query-builder.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		name: text(),
		email: text().nullable(),
		age: integer(),
		level: smallint(),
		visits: bigint(),
		balance: decimal(),
		score: real(),
		ratio: doublePrecision(),
		token: uuid(),
		tags: array(text<'a' | 'b'>()),
		settings: jsonb<{ theme: string }>(),
		createdAt: timestamptz().name('created_at'),
		born: date().nullable(),
		wait: interval(),
		embedding: vector(),
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

declare function typeOf<T>(expression: Expression<T>): T;

describe('joins', () => {
	it('make the outer side nullable', () => {
		expectTypeOf(
			selectFrom(users)
				.leftJoin(posts)
				.on('posts.authorId', 'users.id')
				.select(['users.name', 'posts.title']).$output,
		).toEqualTypeOf<{ name: string; title: string | null }>();
		expectTypeOf(
			selectFrom(users)
				.select(['users.name'])
				.rightJoin(posts)
				.on('posts.authorId', 'users.id')
				.select(['posts.title']).$output,
		).toEqualTypeOf<{ name: string | null; title: string }>();
		expectTypeOf(
			selectFrom(users)
				.fullJoin(posts)
				.on('posts.authorId', 'users.id')
				.select(['users.name', 'posts.title']).$output,
		).toEqualTypeOf<{ name: string | null; title: string | null }>();
		expectTypeOf(
			selectFrom(users).crossJoin(posts).select(['posts.title']).$output,
		).toEqualTypeOf<{ title: string }>();
	});

	it('keep the SQL type of nullable columns, and their comparisons', () => {
		selectFrom(users)
			.leftJoin(posts)
			.on('posts.authorId', 'users.id')
			.where((eb) => eb.ref('posts.title').like('%x'))
			.where((eb) => eb.ref('posts.id').isNull());
		selectFrom(users)
			.leftJoin(posts)
			// @ts-expect-error a text column doesn't equal an integer
			.on('posts.title', 'users.id');
	});

	it('take a table already in the query only under an alias', () => {
		// @ts-expect-error users is already in the query
		selectFrom(users).innerJoin(users);
		// @ts-expect-error nor for an outer join
		selectFrom(users).leftJoin(users);
		const managers = selectFrom(users)
			.leftJoin(users.as('managers'))
			.on('managers.id', 'users.id')
			.select((eb) => ['users.name', eb.ref('managers.name').as('manager')]);
		expectTypeOf(managers.$output).toEqualTypeOf<{
			name: string;
			manager: string | null;
		}>();
	});
});

describe('select', () => {
	it('rejects a key already in the row', () => {
		const joined = selectFrom(users)
			.innerJoin(posts)
			.on('posts.authorId', 'users.id');
		// @ts-expect-error both are keyed `id`
		joined.select(['users.id', 'posts.id']);
		// @ts-expect-error `id` again, across calls
		joined.select(['users.id']).select(['posts.id']);
		// @ts-expect-error an alias taken by a column
		joined.select((eb) => [
			'users.name',
			eb.fn.lower('posts.title').as('name'),
		]);
		// @ts-expect-error both tables have an `id`
		joined.selectAll();
		// @ts-expect-error `title` is already selected
		joined.select(['posts.title']).selectAll(posts);
	});

	it('types selectAll by the table’s columns', () => {
		expectTypeOf(selectFrom(posts).selectAll().$output).toEqualTypeOf<{
			id: number;
			authorId: number;
			title: string;
		}>();
		expectTypeOf(
			selectFrom(users)
				.leftJoin(posts)
				.on('posts.authorId', 'users.id')
				.selectAll(posts).$output,
		).toEqualTypeOf<{
			id: number | null;
			authorId: number | null;
			title: string | null;
		}>();
		// @ts-expect-error not in the query
		selectFrom(users).selectAll('posts');
	});

	it('types the columns selected after pipe', () => {
		const withAuthor = fragment(posts, (qb) =>
			qb
				.innerJoin(users)
				.on('users.id', 'posts.authorId')
				.select(['users.email']),
		);
		expectTypeOf(
			selectFrom(posts).pipe(withAuthor).select(['posts.title']).$output,
		).toEqualTypeOf<{ email: string | null; title: string }>();
		expectTypeOf(
			selectFrom(posts)
				.pipe(withAuthor)
				.when(true, (qb) => qb.select(['users.name'])).$output,
		).toEqualTypeOf<{ email: string | null; name?: string }>();
	});

	it('types a parameter by its value', () => {
		expectTypeOf(
			selectFrom(users).select((eb) => [eb.val(1).as('one')]).$output,
		).toEqualTypeOf<{ one: 1 }>();
	});
});

describe('clauses', () => {
	it('take columns, keys of the row and expressions as keys', () => {
		const q = selectFrom(users).select((eb) => [
			'users.name',
			eb.fn.count().as('n'),
		]);
		q.groupBy(['users.name', 'name']).orderBy('n', 'desc', { nulls: 'last' });
		q.groupBy((eb) => [eb.fn.lower('users.name')]);
		q.orderBy((eb) => eb.fn.count(), 'desc');
		q.distinctOn(['users.name']).orderBy('users.name');
		q.having((eb) => eb.fn.count().gt('1'));
		// @ts-expect-error not a column nor a key of the row
		q.orderBy('nme');
		// @ts-expect-error not a direction
		q.orderBy('n', 'down');
		// @ts-expect-error posts is not joined
		q.groupBy(['posts.title']);
	});
});

describe('aggregates', () => {
	it('have the types postgres gives them', () => {
		expectTypeOf(typeOf(ub.fn.sum('users.age'))).toEqualTypeOf<string | null>();
		const row = selectFrom(users).select((eb) => [
			eb.fn.sum('users.age').as('sumInt'),
			eb.fn.sum('users.visits').as('sumBig'),
			eb.fn.sum('users.score').as('sumReal'),
			eb.fn.sum('users.wait').as('sumInterval'),
			eb.fn.avg('users.age').as('avgInt'),
			eb.fn.avg('users.ratio').as('avgDouble'),
			eb.fn.countDistinct('users.email').as('distinct'),
			eb.fn.arrayAgg('users.email').as('emails'),
			eb.fn.stringAgg('users.name', ', ').as('names'),
			eb.fn.boolAnd(eb.ref('users.age').gt(1)).as('all'),
			eb.fn.jsonbAgg('users.createdAt').as('dates'),
			eb.fn
				.jsonbBuildObject({
					id: 'users.id',
					visits: 'users.visits',
					tags: 'users.tags',
				})
				.as('obj'),
		]).$output;
		expectTypeOf(row).toEqualTypeOf<{
			sumInt: string | null;
			sumBig: string | null;
			sumReal: number | null;
			sumInterval: string | null;
			avgInt: string | null;
			avgDouble: number | null;
			distinct: string;
			emails: (string | null)[] | null;
			names: string | null;
			all: boolean | null;
			dates: string[] | null;
			obj: { id: number; visits: number; tags: ('a' | 'b')[] };
		}>();
		// @ts-expect-error no sum of text
		ub.fn.sum('users.name');
		// @ts-expect-error no array_agg of an array
		ub.fn.arrayAgg('users.tags');
	});
});

describe('arithmetic', () => {
	it('types the result by postgres’s rules', () => {
		expectTypeOf(typeOf(ub.ref('users.age').plus(1))).toEqualTypeOf<number>();
		expectTypeOf(
			typeOf(ub.ref('users.age').plus(ub.ref('users.visits'))),
		).toEqualTypeOf<string>();
		expectTypeOf(
			typeOf(ub.ref('users.level').times(ub.ref('users.balance'))),
		).toEqualTypeOf<string>();
		expectTypeOf(
			typeOf(ub.ref('users.age').minus(ub.ref('users.score'))),
		).toEqualTypeOf<number>();
		expectTypeOf(
			typeOf(ub.ref('users.visits').plus(1)),
		).toEqualTypeOf<string>();
		expectTypeOf(
			typeOf(ub.ref('users.createdAt').minus('1 day')),
		).toEqualTypeOf<Date>();
		expectTypeOf(
			typeOf(ub.ref('users.createdAt').minus(ub.fn.now())),
		).toEqualTypeOf<string>();
		expectTypeOf(typeOf(ub.ref('users.born').plus(1))).toEqualTypeOf<
			string | null
		>();
		expectTypeOf(
			typeOf(ub.ref('users.born').minus(ub.fn.currentDate())),
		).toEqualTypeOf<number | null>();
		expectTypeOf(
			typeOf(ub.ref('users.embedding').l2Distance([1, 2])),
		).toEqualTypeOf<number>();
		ub.ref('users.age').plus(1).gt(2);

		// @ts-expect-error no arithmetic on text
		ub.ref('users.name').plus('x');
		// @ts-expect-error no % on floats
		ub.ref('users.score').mod(2);
		// @ts-expect-error an integer takes numbers
		ub.ref('users.age').plus('1');
		// @ts-expect-error a timestamp moves by an interval, not a number
		ub.ref('users.createdAt').plus(1);
		// @ts-expect-error uuids have no arithmetic
		ub.ref('users.token').plus(1);
	});
});

describe('case', () => {
	it('is the union of its results, nullable without else', () => {
		expectTypeOf(
			typeOf(
				ub
					.case()
					.when(ub.ref('users.age').gt(1), 'a')
					.when(ub.ref('users.age').gt(2), 'b')
					.else('c')
					.end(),
			),
		).toEqualTypeOf<'a' | 'b' | 'c'>();
		expectTypeOf(
			typeOf(
				ub.case().when(ub.ref('users.age').gt(1), ub.ref('users.email')).end(),
			),
		).toEqualTypeOf<string | null>();
		ub.case().when(ub.ref('users.age').gt(1), 'a').end().like('a%');
		// @ts-expect-error results share a type
		ub.case().when(ub.ref('users.age').gt(1), 'a').else(1);
		// @ts-expect-error nor an expression of another SQL type
		ub.case().when(ub.ref('users.age').gt(1), 'a').else(ub.ref('users.age'));
		// @ts-expect-error a branch comes first
		ub.case().end();
		// @ts-expect-error the condition is a predicate
		ub.case().when(ub.ref('users.age'), 'a');
	});
});

describe('functions', () => {
	it('propagate null and keep types', () => {
		expectTypeOf(typeOf(ub.fn.nullif('users.name', ''))).toEqualTypeOf<
			string | null
		>();
		expectTypeOf(
			typeOf(ub.fn.greatest('users.age', 1)),
		).toEqualTypeOf<number>();
		expectTypeOf(
			typeOf(ub.fn.greatest('users.email', 'users.email')),
		).toEqualTypeOf<string | null>();
		expectTypeOf(
			typeOf(ub.fn.round('users.balance', 2)),
		).toEqualTypeOf<string>();
		expectTypeOf(typeOf(ub.fn.round('users.score'))).toEqualTypeOf<number>();
		expectTypeOf(typeOf(ub.fn.substring('users.email', 1))).toEqualTypeOf<
			string | null
		>();
		expectTypeOf(
			typeOf(ub.fn.dateTrunc('day', 'users.born')),
		).toEqualTypeOf<Date | null>();
		expectTypeOf(
			typeOf(ub.fn.extract('year', 'users.createdAt')),
		).toEqualTypeOf<string>();
		expectTypeOf(
			typeOf(ub.fn.cast(ub.val('1'), 'interval')),
		).toEqualTypeOf<string>();
		// @ts-expect-error round(x, digits) takes only a decimal
		ub.fn.round('users.score', 1);
		// @ts-expect-error a number is no delimiter
		ub.fn.splitPart('users.name', 1, 1);
		// @ts-expect-error text fallbacks of greatest go through eb.val
		ub.fn.greatest('users.name', 'x');
	});
});

describe('parameters with any / all', () => {
	it('check the parameter against the elements', () => {
		ub.val('a').eq(ub.fn.any('users.tags'));
		// @ts-expect-error not one of the elements’ values
		ub.val('c').eq(ub.fn.any('users.tags'));
		// @ts-expect-error a list of values has no SQL type to encode the parameter
		ub.val('a').eq(ub.fn.any(['a', 'b']));
	});
});

describe('sql', () => {
	it('types fragments and statements by the promise given', () => {
		expectTypeOf(
			selectFrom(users).select(() => [sql<number>`1`.as('one')]).$output,
		).toEqualTypeOf<{ one: number }>();
		selectFrom(users).where(() => sql<boolean>`true`);
		const db = database('postgres://localhost/x');
		expectTypeOf(
			db.sql<{ n: string }>`select 1 as n`.expectValue(),
		).toEqualTypeOf<import('../src/query.js').Query<string>>();
		void db.transaction(async (tx) => {
			await tx.sql`select 1`.execute();
		});
	});
});

describe('returningAll', () => {
	it('types every column', () => {
		expectTypeOf(
			insertInto(posts).values({ authorId: 1, title: 'x' }).returningAll()
				.$output,
		).toEqualTypeOf<{ id: number; authorId: number; title: string }>();
	});
});
