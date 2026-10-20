import {
	afterAll,
	beforeAll,
	describe,
	expect,
	expectTypeOf,
	it,
} from 'vitest';
import {
	array,
	bigint,
	boolean,
	date,
	decimal,
	integer,
	jsonb,
	real,
	text,
	timestamptz,
	vector,
} from '../../../src/column-factories.js';
import { database, type Database } from '../../../src/database.js';
import { defineTable } from '../../../src/define-table.js';
import { createPool, type Pool } from '../../../src/driver/pool.js';
import { NoRowError } from '../../../src/executor.js';
import { fragment } from '../../../src/select-query-builder.js';
import { sql } from '../../../src/sql.js';
import { noPg, options, pg, table } from './helpers.js';

const schema = table('everyday');

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		name: text(),
		email: text().nullable(),
		age: integer(),
		managerId: integer().name('manager_id').nullable(),
		balance: decimal().default(),
		score: real().default(),
		tags: array(text()).default(),
		settings: jsonb<{ theme: string; beta?: boolean }>().default(),
		createdAt: timestamptz().name('created_at').default(),
		born: date().nullable(),
	},
});

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		authorId: integer().name('author_id').nullable(),
		title: text(),
		views: bigint().default(),
		published: boolean().default(),
	},
});

const items = defineTable('items', {
	columns: {
		id: integer().identity(),
		embedding: vector(),
	},
});

describe.skipIf(noPg)('everyday SQL on PostgreSQL', () => {
	let pool: Pool;
	let db: Database;

	beforeAll(async () => {
		pool = createPool({
			...options(),
			max: 2,
			params: { search_path: `${schema},public` },
		});
		db = database(pool);
		await pool.simpleQuery(`
			create schema ${schema};
			create table users (
				id int generated always as identity primary key, name text not null, email text,
				age int not null, manager_id int, balance numeric not null default 0,
				score real not null default 0, tags text[] not null default '{}',
				settings jsonb not null default '{"theme":"light"}',
				created_at timestamptz not null default '2024-01-15T10:30:00Z', born date
			);
			create table posts (
				id int generated always as identity primary key, author_id int, title text not null,
				views bigint not null default 0, published boolean not null default false
			);
		`);
		await db
			.insertInto(users)
			.values([
				{
					name: 'Ada',
					email: 'ada@x.io',
					age: 36,
					managerId: null,
					balance: '10.5',
					score: 1.5,
					tags: ['admin', 'beta'],
					settings: { theme: 'dark', beta: true },
					born: '1990-12-10',
				},
				{
					name: 'Alan',
					email: null,
					age: 41,
					managerId: 1,
					balance: '2',
					score: 2.5,
					tags: ['beta'],
					born: null,
				},
				{
					name: 'Grace',
					email: 'grace@x.io',
					age: 25,
					managerId: 1,
					born: null,
				},
			])
			.execute();
		await db
			.insertInto(posts)
			.values([
				{ authorId: 1, title: 'Engines', views: '10', published: true },
				{ authorId: 1, title: 'Notes', views: '5', published: false },
				{ authorId: 2, title: 'Machines', views: '7', published: true },
				{ authorId: null, title: 'Orphan', views: '1', published: true },
			])
			.execute();
	});

	afterAll(async () => {
		await pool
			?.query(`drop schema if exists ${schema} cascade`)
			.catch(() => {});
		await pool?.end();
	});

	describe('joins', () => {
		it('left join keeps rows without a match, as nulls', async () => {
			const rows = await db
				.selectFrom(users)
				.leftJoin(posts)
				.on('posts.authorId', 'users.id')
				.select(['users.name', 'posts.title'])
				.orderBy('users.id')
				.orderBy('posts.id')
				.execute();
			expectTypeOf(rows).toEqualTypeOf<
				{ name: string; title: string | null }[]
			>();
			expect(rows).toEqual([
				{ name: 'Ada', title: 'Engines' },
				{ name: 'Ada', title: 'Notes' },
				{ name: 'Alan', title: 'Machines' },
				{ name: 'Grace', title: null },
			]);
		});

		it('right join keeps the joined rows without a match', async () => {
			const rows = await db
				.selectFrom(users)
				.rightJoin(posts)
				.on('posts.authorId', 'users.id')
				.select(['users.name', 'posts.title'])
				.orderBy('posts.id')
				.execute();
			expectTypeOf(rows).toEqualTypeOf<
				{ name: string | null; title: string }[]
			>();
			expect(rows.at(-1)).toEqual({ name: null, title: 'Orphan' });
		});

		it('full join keeps both sides', async () => {
			const rows = await db
				.selectFrom(users)
				.fullJoin(posts)
				.on('posts.authorId', 'users.id')
				.select(['users.name', 'posts.title'])
				.execute();
			expect(rows).toHaveLength(5);
			expect(rows).toContainEqual({ name: 'Grace', title: null });
			expect(rows).toContainEqual({ name: null, title: 'Orphan' });
		});

		it('cross join pairs every row', async () => {
			const count = await db
				.selectFrom(users)
				.crossJoin(posts)
				.select((eb) => [eb.fn.count().as('n')])
				.expectValue()
				.execute();
			expect(count).toBe('12');
		});

		it('self-joins under an alias, keeping both columns', async () => {
			const rows = await db
				.selectFrom(users)
				.innerJoin(users.as('managers'))
				.on('managers.id', 'users.managerId')
				.select((eb) => [
					'users.name',
					eb.ref('managers.name').as('managerName'),
				])
				.orderBy('users.id')
				.execute();
			expect(rows).toEqual([
				{ name: 'Alan', managerName: 'Ada' },
				{ name: 'Grace', managerName: 'Ada' },
			]);
		});

		it('rejects a duplicate key and an unaliased self-join before running', () => {
			expect(() =>
				db
					.selectFrom(users)
					.innerJoin(users.as('m'))
					.on('m.id', 'users.managerId')
					// @ts-expect-error both are keyed `name`
					.select(['users.name', 'm.name']),
			).toThrow('"name" is already in the row');
			// @ts-expect-error users is already in the query
			expect(() => db.selectFrom(users).innerJoin(users)).toThrow(
				'already in the query',
			);
		});
	});

	describe('ordering, distinct and pagination', () => {
		it('orders by several keys, directions and nulls, then pages', async () => {
			const rows = await db
				.selectFrom(users)
				.select(['users.name', 'users.email'])
				.orderBy('users.email', 'desc', { nulls: 'last' })
				.orderBy('users.name')
				.execute();
			expect(rows.map((r) => r.name)).toEqual(['Grace', 'Ada', 'Alan']);
			const page = await db
				.selectFrom(users)
				.select(['users.name'])
				.orderBy((eb) => eb.fn.lower('users.name'), 'asc')
				.limit(1)
				.offset(1)
				.execute();
			expect(page).toEqual([{ name: 'Alan' }]);
		});

		it('selects distinct rows, and the first of each group with distinct on', async () => {
			const published = await db
				.selectFrom(posts)
				.select(['posts.published'])
				.distinct()
				.orderBy('posts.published')
				.execute();
			expect(published).toEqual([{ published: false }, { published: true }]);
			const latest = await db
				.selectFrom(posts)
				.where((eb) => eb.ref('posts.authorId').isNotNull())
				.select(['posts.authorId', 'posts.title'])
				.distinctOn(['posts.authorId'])
				.orderBy('posts.authorId')
				.orderBy('posts.id', 'desc')
				.execute();
			expect(latest).toEqual([
				{ authorId: 1, title: 'Notes' },
				{ authorId: 2, title: 'Machines' },
			]);
		});
	});

	describe('grouping and aggregates', () => {
		it('groups with having, ordering by an aggregate alias', async () => {
			const rows = await db
				.selectFrom(users)
				.leftJoin(posts)
				.on('posts.authorId', 'users.id')
				.select((eb) => [
					'users.name',
					eb.fn.count('posts.id').as('postCount'),
					eb.fn.sum('posts.views').as('views'),
				])
				.groupBy(['users.id'])
				.having((eb) => eb.fn.count('posts.id').gte('1'))
				.orderBy('postCount', 'desc')
				.execute();
			expectTypeOf(rows).toEqualTypeOf<
				{ name: string; postCount: string; views: string | null }[]
			>();
			expect(rows).toEqual([
				{ name: 'Ada', postCount: '2', views: '15' },
				{ name: 'Alan', postCount: '1', views: '7' },
			]);
		});

		it('decodes each aggregate to the type postgres gives it', async () => {
			const row = await db
				.selectFrom(users)
				.select((eb) => [
					eb.fn.sum('users.age').as('ageSum'),
					eb.fn.avg('users.age').as('ageAvg'),
					eb.fn.avg('users.score').as('scoreAvg'),
					eb.fn.sum('users.balance').as('balanceSum'),
					eb.fn.min('users.name').as('first'),
					eb.fn.max('users.createdAt').as('latest'),
					eb.fn.countDistinct('users.managerId').as('managers'),
					eb.fn.boolOr(eb.ref('users.age').gt(40)).as('anyOver40'),
					eb.fn.boolAnd(eb.ref('users.age').gt(40)).as('allOver40'),
				])
				.expectOne()
				.execute();
			expectTypeOf(row).toEqualTypeOf<{
				ageSum: string | null;
				ageAvg: string | null;
				scoreAvg: number | null;
				balanceSum: string | null;
				first: string | null;
				latest: Date | null;
				managers: string;
				anyOver40: boolean | null;
				allOver40: boolean | null;
			}>();
			expect(row).toEqual({
				ageSum: '102',
				ageAvg: '34.0000000000000000',
				scoreAvg: 4 / 3,
				balanceSum: '12.5',
				first: 'Ada',
				latest: new Date('2024-01-15T10:30:00Z'),
				managers: '1',
				anyOver40: true,
				allOver40: false,
			});
		});

		it('aggregates into arrays, text and jsonb', async () => {
			const rows = await db
				.selectFrom(users)
				.innerJoin(posts)
				.on('posts.authorId', 'users.id')
				.select((eb) => [
					'users.name',
					eb.fn.arrayAgg('posts.title').as('titles'),
					eb.fn.stringAgg('posts.title', ', ').as('list'),
					eb.fn
						.jsonbAgg(
							eb.fn.jsonbBuildObject({
								id: 'posts.id',
								views: 'posts.views',
								published: 'posts.published',
							}),
						)
						.as('posts'),
				])
				.groupBy(['users.name'])
				.orderBy('users.name')
				.execute();
			expectTypeOf(rows).toEqualTypeOf<
				{
					name: string;
					titles: string[] | null;
					list: string | null;
					posts: { id: number; views: number; published: boolean }[] | null;
				}[]
			>();
			expect(rows[1]).toEqual({
				name: 'Alan',
				titles: ['Machines'],
				list: 'Machines',
				posts: [{ id: 3, views: 7, published: true }],
			});
			expect(rows[0]?.titles?.toSorted()).toEqual(['Engines', 'Notes']);
		});
	});

	describe('expressions', () => {
		it('case yields the union of its results, null without else', async () => {
			const rows = await db
				.selectFrom(users)
				.select((eb) => [
					'users.name',
					eb
						.case()
						.when(eb.ref('users.age').gte(40), 'senior')
						.when(eb.ref('users.age').gte(30), 'mid')
						.else('junior')
						.end()
						.as('band'),
					eb
						.case()
						.when(eb.ref('users.age').gt(40), eb.ref('users.age'))
						.end()
						.as('over40'),
				])
				.orderBy('users.id')
				.execute();
			expectTypeOf(rows).toEqualTypeOf<
				{
					name: string;
					band: 'senior' | 'mid' | 'junior';
					over40: number | null;
				}[]
			>();
			expect(rows).toEqual([
				{ name: 'Ada', band: 'mid', over40: null },
				{ name: 'Alan', band: 'senior', over40: 41 },
				{ name: 'Grace', band: 'junior', over40: null },
			]);
		});

		it('coalesce, nullif, greatest, least and casts', async () => {
			const row = await db
				.selectFrom(users)
				.where('users.name', 'Alan')
				.select((eb) => [
					eb.fn.coalesce('users.email', eb.val('none')).as('email'),
					eb.fn.nullif('users.name', 'Alan').as('nulled'),
					eb.fn.greatest('users.age', 50).as('atLeast50'),
					eb.fn.least('users.age', 'users.managerId').as('smaller'),
					eb.fn.cast('users.age', 'varchar').as('ageText'),
					eb.fn.cast(eb.val('1 day'), 'interval').as('day'),
				])
				.expectOne()
				.execute();
			expect(row).toEqual({
				email: 'none',
				nulled: null,
				atLeast50: 50,
				smaller: 1,
				ageText: '41',
				day: '1 day',
			});
		});

		it('string functions, and concat with parameters', async () => {
			const row = await db
				.selectFrom(users)
				.where('users.name', 'Ada')
				.select((eb) => [
					eb.fn
						.concat('users.name', eb.val(' <'), 'users.email', eb.val('>'))
						.as('label'),
					eb.fn
						.trim(eb.fn.concat(eb.val('  '), 'users.name', eb.val('  ')))
						.as('trimmed'),
					eb.fn.substring('users.name', 2, 2).as('sub'),
					eb.fn.replace('users.email', '@', ' at ').as('replaced'),
					eb.fn.strpos('users.email', '@').as('at'),
					eb.fn.left('users.name', 1).as('initial'),
					eb.fn.right('users.name', 2).as('tail'),
					eb.fn.splitPart('users.email', '@', 2).as('domain'),
					eb.val(1).as('one'),
					eb.val('x').as('x'),
				])
				.expectOne()
				.execute();
			expectTypeOf(row.at).toEqualTypeOf<number | null>();
			expectTypeOf(row.one).toEqualTypeOf<1>();
			expect(row).toEqual({
				label: 'Ada <ada@x.io>',
				trimmed: 'Ada',
				sub: 'da',
				replaced: 'ada at x.io',
				at: 4,
				initial: 'A',
				tail: 'da',
				domain: 'x.io',
				one: 1,
				x: 'x',
			});
		});

		it('date functions and interval arithmetic', async () => {
			const row = await db
				.selectFrom(users)
				.where('users.name', 'Ada')
				.select((eb) => [
					eb.fn.dateTrunc('month', 'users.createdAt').as('month'),
					eb.fn
						.cast(eb.fn.extract('year', 'users.createdAt'), 'integer')
						.as('year'),
					eb.ref('users.createdAt').minus('15 days').as('earlier'),
					eb
						.ref('users.createdAt')
						.plus(eb.fn.cast(eb.val('1 hour'), 'interval'))
						.as('later'),
					eb
						.ref('users.createdAt')
						.minus(new Date('2024-01-14T10:30:00Z'))
						.as('since'),
					eb.ref('users.born').plus(1).as('nextDay'),
					eb.fn.toChar('users.createdAt', 'YYYY').as('formatted'),
					eb.fn.currentDate().isNotNull().as('today'),
				])
				.expectOne()
				.execute();
			expectTypeOf(row.month).toEqualTypeOf<Date>();
			expectTypeOf(row.since).toEqualTypeOf<string>();
			expectTypeOf(row.nextDay).toEqualTypeOf<string | null>();
			expect(row.month.toISOString()).toMatch(/^2024-01-01T/);
			expect(row).toMatchObject({
				year: 2024,
				earlier: new Date('2023-12-31T10:30:00Z'),
				later: new Date('2024-01-15T11:30:00Z'),
				since: '1 day',
				nextDay: '1990-12-11',
				formatted: '2024',
				today: true,
			});
		});

		it('arithmetic and math functions, typed by postgres’s rules', async () => {
			const row = await db
				.selectFrom(users)
				.where('users.name', 'Ada')
				.select((eb) => [
					eb.ref('users.age').plus(1).as('next'),
					eb.ref('users.age').dividedBy(5).as('intDiv'),
					eb.ref('users.age').mod(5).as('rem'),
					eb.ref('users.age').times(eb.ref('users.balance')).as('product'),
					eb.ref('users.age').minus(eb.ref('users.score')).as('mixed'),
					eb.fn.abs(eb.ref('users.age').times(-1)).as('abs'),
					eb.fn.round('users.balance').as('rounded'),
					eb.fn.round('users.balance', 1).as('oneDigit'),
					eb.fn.ceil('users.score').as('ceil'),
					eb.fn.floor('users.age').as('floor'),
					eb.fn.cardinality('users.tags').as('tagCount'),
				])
				.expectOne()
				.execute();
			expectTypeOf(row).toEqualTypeOf<{
				next: number;
				intDiv: number;
				rem: number;
				product: string;
				mixed: number;
				abs: number;
				rounded: string;
				oneDigit: string;
				ceil: number;
				floor: number;
				tagCount: number;
			}>();
			expect(row).toEqual({
				next: 37,
				intDiv: 7,
				rem: 1,
				product: '378.0',
				mixed: 34.5,
				abs: 36,
				rounded: '11',
				oneDigit: '10.5',
				ceil: 2,
				floor: 36,
				tagCount: 2,
			});
		});

		it('increments a column in an update, returning the new value', async () => {
			const views = await db
				.update(posts)
				.set((eb) => ({ views: eb.ref('posts.views').plus(1) }))
				.where('posts.id', 1)
				.returning(['posts.views'])
				.expectValue()
				.execute();
			expect(views).toBe('11');
		});
	});

	describe('conditions', () => {
		it('not() as an operand is bracketed, so it reads as written', async () => {
			const rows = await db
				.selectFrom(users)
				.where((eb) => eb.not(eb.ref('users.age').gt(18)).isNull())
				.select(['users.id'])
				.execute();
			expect(rows).toEqual([]);
		});

		it('combines the everyday operators', async () => {
			const names = await db
				.selectFrom(users)
				.where((eb) =>
					eb.and([
						eb.ref('users.age').between([20, 40]),
						eb.ref('users.name').notIn(['Bob']),
						eb.or([
							eb.ref('users.email').ilike('%@X.IO'),
							eb.ref('users.email').isNull(),
						]),
						eb.not(eb.ref('users.name').like('G%')),
						eb.val('beta').eq(eb.fn.any('users.tags')),
						eb.ref('users.tags').overlaps(['admin', 'beta']),
						eb.json.text('users.settings', 'theme').in(['dark', 'light']),
					]),
				)
				.select(['users.name'])
				.orderBy('users.name')
				.execute();
			expect(names).toEqual([{ name: 'Ada' }]);
		});
	});

	describe('selectAll and returningAll', () => {
		it('selects every column of a table, nullable on the outer side', async () => {
			const rows = await db
				.selectFrom(users)
				.leftJoin(posts)
				.on('posts.authorId', 'users.id')
				.where('users.name', 'Grace')
				.select(['users.name'])
				.selectAll('posts')
				.execute();
			expectTypeOf(rows).toEqualTypeOf<
				{
					name: string;
					id: number | null;
					authorId: number | null;
					title: string | null;
					views: string | null;
					published: boolean | null;
				}[]
			>();
			expect(rows).toEqual([
				{
					name: 'Grace',
					id: null,
					authorId: null,
					title: null,
					views: null,
					published: null,
				},
			]);
		});

		it('returns every column of the rows written', async () => {
			const inserted = await db
				.insertInto(posts)
				.values({ authorId: 3, title: 'Compilers' })
				.returningAll()
				.expectOne()
				.execute();
			expect(inserted).toEqual({
				id: 5,
				authorId: 3,
				title: 'Compilers',
				views: '0',
				published: false,
			});
			const deleted = await db
				.deleteFrom(posts)
				.where('posts.id', inserted.id)
				.returningAll()
				.expectOne()
				.execute();
			expect(deleted).toEqual(inserted);
		});
	});

	describe('raw sql', () => {
		it('embeds fragments in a query, as values, predicates and keys', async () => {
			const rows = await db
				.selectFrom(users)
				.select((eb) => [
					'users.name',
					sql<number>`extract(day from ${eb.ref('users.createdAt')})::int`.as(
						'day',
					),
				])
				.where((eb) => sql<boolean>`${eb.ref('users.age')} > ${30}`)
				.orderBy(sql`2`)
				.orderBy('users.name', 'desc')
				.execute();
			expect(rows).toEqual([
				{ name: 'Alan', day: 15 },
				{ name: 'Ada', day: 15 },
			]);
		});

		it('runs whole statements with the result shapes, also in transactions and batches', async () => {
			const n = await db.sql<{
				n: string;
			}>`select count(*) as n from ${users} where ${sql.id('age')} > ${30}`
				.expectValue()
				.execute();
			expect(n).toBe('2');
			const { rows, rowCount } = await db.sql<{
				name: string;
			}>`select name from users where name in (${sql.join(['Ada', 'Grace'])}) order by name`.execute();
			expect({ rows, rowCount }).toEqual({
				rows: [{ name: 'Ada' }, { name: 'Grace' }],
				rowCount: 2,
			});
			const inTx = await db.transaction(async (tx) => {
				await tx.sql`set local application_name = ${sql.lit('quarry-test')}`.execute();
				return tx.sql<{
					name: string;
				}>`select current_setting('application_name') as name`
					.expectValue()
					.execute();
			});
			expect(inTx).toBe('quarry-test');
			const [first, missing] = await db.batch([
				db.sql<{ one: number }>`select 1 as one`.takeFirst(),
				db.sql`select 1 where false`.takeFirst(),
			]);
			expect([first, missing]).toEqual([{ one: 1 }, undefined]);
			await expect(
				db.sql`select 1 where false`.expectOne().execute(),
			).rejects.toBeInstanceOf(NoRowError);
		});

		it('refuses a string where a template belongs', () => {
			// @ts-expect-error a template tag, not a function of a string
			expect(() => sql('select 1')).toThrow('template tag');
		});
	});

	it('types the columns selected after piping a fragment', async () => {
		const withAuthor = fragment(posts, (qb) =>
			qb
				.innerJoin(users)
				.on('users.id', 'posts.authorId')
				.select(['users.email']),
		);
		const rows = await db
			.selectFrom(posts)
			.pipe(withAuthor)
			.select(['posts.title'])
			.orderBy('posts.id')
			.execute();
		expectTypeOf(rows).toEqualTypeOf<
			{ email: string | null; title: string }[]
		>();
		expect(rows[0]).toEqual({ email: 'ada@x.io', title: 'Engines' });
	});

	describe.skipIf(!pg?.extensions.includes('vector'))('pgvector', () => {
		it('orders by distance', async () => {
			await pool.simpleQuery(`
				create extension if not exists vector;
				create table ${schema}.items (id int generated always as identity primary key, embedding vector(2) not null);
				insert into ${schema}.items (embedding) values ('[0,0]'), ('[3,4]'), ('[1,1]');
			`);
			const rows = await db
				.selectFrom(items)
				.select((eb) => [
					'items.id',
					eb.ref('items.embedding').l2Distance([0, 0]).as('distance'),
				])
				.orderBy('distance')
				.execute();
			expectTypeOf(rows).toEqualTypeOf<{ id: number; distance: number }[]>();
			expect(rows.map((r) => r.distance)).toEqual([0, Math.SQRT2, 5]);
		});
	});
});
