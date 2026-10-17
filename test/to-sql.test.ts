import { describe, expect, it } from 'vitest';
import {
	array,
	bigint,
	boolean,
	bytea,
	date,
	daterange,
	decimal,
	doublePrecision,
	integer,
	jsonb,
	text,
	timestamptz,
	tstzrange,
	uuid,
	varchar,
	vector,
} from '../src/column-factories.js';
import { compile } from '../src/compile.js';
import { defineCodec } from '../src/driver/codec.js';
import { codecs } from '../src/driver/codecs.js';
import { databaseWith } from '../src/database.js';
import { defineEnum } from '../src/define-enum.js';
import { defineTable } from '../src/define-table.js';
import { deleteFrom } from '../src/delete-query-builder.js';
import { insertInto } from '../src/insert-query-builder.js';
import { selectFrom } from '../src/select-query-builder.js';
import { sql as sqlTag } from '../src/sql.js';
import { prettySQL } from '../src/to-sql.js';
import { update } from '../src/update-query-builder.js';
import { codecNames } from './helpers/compiled.js';
import { fakeExecutor } from './helpers/executor.js';

const mood = defineEnum('mood', ['happy', 'sad']);

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		name: text(),
		nick: varchar(3).nullable(),
		email: text().nullable(),
		tags: array(text()),
		scores: array(integer().nullable()),
		data: jsonb(),
		createdAt: timestamptz().name('created_at'),
		born: date().nullable(),
		avatar: bytea().nullable(),
		balance: decimal(10, 2),
		visits: bigint(),
		ratio: doublePrecision(),
		admin: boolean(),
		token: uuid(),
		mood: mood(),
		active: daterange(),
		window: tstzrange(),
		embedding: vector().nullable(),
		password: text().name('password_hash').sensitive(),
	},
});

const flags = defineTable('flags', {
	columns: { id: integer().identity(), name: text(), admin: boolean() },
});

const at = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678));

/** The SQL `toSQL({ inline: true })` writes for `where(column, value)`. */
const inlined = (
	where: (q: ReturnType<typeof base>) => ReturnType<typeof base>,
) =>
	where(base())
		.toSQL({ inline: true })
		.sql.replace(/^.* where /, '');
const base = () => selectFrom(users).select(['users.id']);

describe('toSQL', () => {
	it('returns the SQL and its parameters, as compile does', () => {
		const query = selectFrom(users)
			.select(['users.id', 'users.name'])
			.where('users.name', 'Ada')
			.where((eb) => eb.ref('users.tags').overlaps(['a', 'b']));
		expect(query.toSQL()).toEqual({
			sql: 'select "users"."id" as "id", "users"."name" as "name" from "users" where ("users"."name" = $1 and "users"."tags" && $2)',
			params: ['Ada', ['a', 'b']],
		});
		const { sql, params } = compile(query.toNode());
		expect(query.toSQL()).toEqual({ sql, params });
	});

	it('runs nothing', () => {
		const { executor, ran } = fakeExecutor();
		const db = databaseWith(executor);
		db.selectFrom(users).where('users.id', 1).toSQL({ inline: true });
		db.insertInto(users)
			.values({
				name: 'a',
				nick: null,
				email: null,
				born: null,
				avatar: null,
				embedding: null,
				tags: [],
				scores: [],
				data: {},
				createdAt: at,
				balance: '1',
				visits: '1',
				ratio: 1,
				admin: true,
				token: 'x',
				mood: 'sad',
				active: { empty: true },
				window: { empty: true },
				password: 'p',
			})
			.toSQL();
		db.update(users).set({ name: 'b' }).where('users.id', 1).toSQL();
		db.deleteFrom(users).where('users.id', 1).toSQL({ pretty: true });
		expect(ran).toEqual([]);
	});

	it('inlines values as literals cast to their SQL type', () => {
		expect(inlined((q) => q.where('users.id', 42))).toBe('"users"."id" = 42');
		expect(inlined((q) => q.where('users.name', 'Ada'))).toBe(
			`"users"."name" = 'Ada'`,
		);
		expect(inlined((q) => q.where('users.nick', 'abcd'))).toBe(
			`"users"."nick" = 'abcd'`,
		);
		expect(
			inlined((q) =>
				q.where((eb) => eb.ref('users.tags').contains(['a', 'b,c'])),
			),
		).toBe(`"users"."tags" @> '{a,"b,c"}'`);
		expect(
			inlined((q) => q.where((eb) => eb.ref('users.scores').eq([1, null]))),
		).toBe(`"users"."scores" = '{1,NULL}'::int4[]`);
		expect(
			inlined((q) => q.where((eb) => eb.ref('users.data').contains({ a: 1 }))),
		).toBe(`"users"."data" @> '{"a":1}'::jsonb`);
		expect(inlined((q) => q.where('users.createdAt', at))).toBe(
			`"users"."created_at" = '2026-01-02 03:04:05.678+00'::timestamptz`,
		);
		expect(inlined((q) => q.where('users.born', '2026-01-02'))).toBe(
			`"users"."born" = '2026-01-02'::date`,
		);
		expect(
			inlined((q) => q.where('users.avatar', new Uint8Array([0, 1, 255]))),
		).toBe(`"users"."avatar" = E'\\\\x0001ff'::bytea`);
		expect(inlined((q) => q.where('users.balance', '12.50'))).toBe(
			`"users"."balance" = '12.50'::numeric`,
		);
		expect(inlined((q) => q.where('users.visits', '9007199254740993'))).toBe(
			`"users"."visits" = '9007199254740993'::int8`,
		);
		expect(inlined((q) => q.where('users.ratio', 0.5))).toBe(
			`"users"."ratio" = '0.5'::float8`,
		);
		expect(inlined((q) => q.where('users.admin', false))).toBe(
			'"users"."admin" = false',
		);
		expect(inlined((q) => q.where('users.mood', 'happy'))).toBe(
			`"users"."mood" = 'happy'::mood`,
		);
		expect(
			inlined((q) =>
				q.where('users.token', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
			),
		).toBe(`"users"."token" = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid`);
	});

	it('casts ranges, and a range’s single point to the point type', () => {
		expect(
			inlined((q) =>
				q.where('users.active', {
					empty: false,
					lower: '2026-01-01',
					upper: '2026-02-01',
					bounds: '[)',
				}),
			),
		).toBe(`"users"."active" = '["2026-01-01","2026-02-01")'::daterange`);
		expect(
			inlined((q) =>
				q.where((eb) => eb.ref('users.active').contains('2026-01-15')),
			),
		).toBe(`"users"."active" @> '2026-01-15'::date`);
		expect(
			inlined((q) => q.where((eb) => eb.ref('users.window').contains(at))),
		).toBe(`"users"."window" @> '2026-01-02 03:04:05.678+00'::timestamptz`);
		expect(inlined((q) => q.where('users.window', { empty: true }))).toBe(
			`"users"."window" = 'empty'::tstzrange`,
		);
	});

	it('escapes quotes and backslashes as quote_literal does', () => {
		expect(inlined((q) => q.where('users.name', "O'Brien"))).toBe(
			`"users"."name" = 'O''Brien'`,
		);
		expect(inlined((q) => q.where('users.name', 'a\\b'))).toBe(
			`"users"."name" = E'a\\\\b'`,
		);
		expect(
			inlined((q) =>
				q.where((eb) => eb.ref('users.tags').contains(['say "hi"'])),
			),
		).toBe(`"users"."tags" @> E'{"say \\\\"hi\\\\""}'`);
	});

	it('inlines in lists, any(), between, limit and untyped parameters', () => {
		expect(inlined((q) => q.where((eb) => eb.ref('users.id').in([1, 2])))).toBe(
			'"users"."id" in (1, 2)',
		);
		expect(
			inlined((q) =>
				q.where((eb) => eb.ref('users.name').in(eb.val(['a', 'b']))),
			),
		).toBe(`"users"."name" = any('{a,b}')`);
		expect(
			inlined((q) => q.where((eb) => eb.val('a').eq(eb.fn.any('users.tags')))),
		).toBe(`'a' = any("users"."tags")`);
		expect(
			inlined((q) =>
				q.where((eb) => eb.ref('users.createdAt').between([at, at])),
			),
		).toBe(
			`"users"."created_at" between '2026-01-02 03:04:05.678+00'::timestamptz and '2026-01-02 03:04:05.678+00'::timestamptz`,
		);
		expect(
			inlined((q) => q.where((eb) => eb.json.hasKey('users.data', 'theme'))),
		).toBe(`"users"."data" ? 'theme'`);
		expect(
			selectFrom(users)
				.select(['users.id'])
				.toSQL({ inline: true })
				.sql.endsWith('from "users"'),
		).toBe(true);
	});

	it('inlines NULL and returns no parameters', () => {
		const { sql, params } = update(users)
			.set({ email: null, embedding: [1, 2.5] })
			.where('users.id', 1)
			.toSQL({ inline: true });
		expect(sql).toBe(
			`update "users" set "email" = NULL, "embedding" = '[1,2.5]'::vector where "users"."id" = 1`,
		);
		expect(params).toEqual([]);
	});

	it('writes the casts unnest already has once', () => {
		const { sql } = insertInto(flags)
			.values([
				{ name: 'a', admin: true },
				{ name: 'b', admin: false },
			])
			.toSQL({ inline: true });
		expect(sql).toBe(
			`insert into "flags" ("name", "admin") select * from unnest('{a,b}'::text[], '{t,f}'::boolean[])`,
		);
	});

	it('renders each value by its column’s codec', () => {
		const citext = defineCodec({
			name: 'citext',
			inferParamType: true,
			encode: (value: string) => value,
			decodeText: (raw) => raw,
		});
		const cents = defineCodec({
			name: 'cents',
			encode: (value: number) => `${value / 100}`,
			decodeText: (raw) => Math.round(Number(raw) * 100),
		});
		const accounts = defineTable('accounts', {
			columns: {
				id: bigint().useCodec(codecs.int8),
				email: text().useCodec(citext),
				balance: integer().useCodec(cents),
			},
		});
		const sql = selectFrom(accounts)
			.select(['accounts.id'])
			.where('accounts.id', 7n)
			.where('accounts.email', 'Ada@Example.com')
			.where('accounts.balance', 1250)
			.toSQL({ inline: true }).sql;
		expect(sql.replace(/^.* where /, '')).toBe(
			`("accounts"."id" = '7'::int8 and "accounts"."email" = 'Ada@Example.com' and "accounts"."balance" = '12.5'::cents)`,
		);
	});

	it('casts without modifiers, which would round or truncate', () => {
		expect(inlined((q) => q.where('users.balance', '1.239'))).toBe(
			`"users"."balance" = '1.239'::numeric`,
		);
	});

	it('shows values of sensitive columns as [redacted]', () => {
		expect(inlined((q) => q.where('users.password', 'hunter2'))).toBe(
			`"users"."password_hash" = '[redacted]'`,
		);
		const { sql } = update(users)
			.set({ password: 'new', name: 'Ada' })
			.where('users.id', 1)
			.toSQL({ inline: true });
		expect(sql).toBe(
			`update "users" set "password_hash" = '[redacted]', "name" = 'Ada' where "users"."id" = 1`,
		);
		// without inline the real values are returned, to run elsewhere
		expect(
			update(users).set({ password: 'new' }).where('users.id', 1).toSQL()
				.params,
		).toEqual(['new', 1]);
	});
});

describe('toSQL({ pretty })', () => {
	it('puts clauses, list items and conditions on their own lines', () => {
		const { sql } = selectFrom(users)
			.innerJoin(users.as('managers'))
			.on('managers.id', 'users.id')
			.select(['users.id', 'users.name'])
			.where('users.name', 'Ada')
			.where((eb) =>
				eb.or([
					eb.ref('users.id').between([1, 9]),
					eb.ref('users.admin').isTrue(),
				]),
			)
			.toSQL({ inline: true, pretty: true });
		expect(sql).toBe(
			[
				'select',
				'  "users"."id" as "id",',
				'  "users"."name" as "name"',
				'from "users"',
				'inner join "users" as "managers" on "managers"."id" = "users"."id"',
				'where (',
				`  "users"."name" = 'Ada'`,
				'  and ("users"."id" between 1 and 9 or "users"."admin" is true)',
				')',
			].join('\n'),
		);
	});

	it('lays out writes', () => {
		const upsert = insertInto(flags)
			.values({ name: 'Ada', admin: true })
			.onConflict(['name'])
			.merge(['admin'])
			.returning(['flags.id'])
			.toSQL({ pretty: true }).sql;
		expect(upsert).toBe(
			[
				'insert into "flags" ("name", "admin")',
				'values',
				'  ($1, $2)',
				'on conflict ("name") do update set',
				'  "admin" = excluded."admin"',
				'returning',
				'  "flags"."id" as "id"',
			].join('\n'),
		);
		expect(
			update(users)
				.set({ name: 'b', admin: false })
				.where('users.id', 1)
				.toSQL({ pretty: true }).sql,
		).toBe(
			[
				'update "users"',
				'set',
				'  "name" = $1,',
				'  "admin" = $2',
				'where "users"."id" = $3',
			].join('\n'),
		);
		expect(
			update(users)
				.setEach([{ id: 1, name: 'a' }], { key: ['id'] })
				.where('users.admin', true)
				.toSQL({ pretty: true }).sql,
		).toBe(
			[
				'update "users"',
				'set',
				'  "name" = "row"."name"',
				'from unnest($1::integer[], $2::text[]) as "row"("id", "name")',
				'where (',
				'  "users"."id" = "row"."id"',
				'  and "users"."admin" = $3',
				')',
			].join('\n'),
		);
		expect(
			deleteFrom(users)
				.where((eb) => eb.ref('users.id').isDistinctFrom(3))
				.toSQL({ pretty: true }).sql,
		).toBe(
			['delete from "users"', 'where "users"."id" is distinct from $1'].join(
				'\n',
			),
		);
	});

	it('only changes whitespace outside quotes', () => {
		const tricky = selectFrom(users)
			.select(['users.id'])
			.where('users.name', 'a from b, where (c and d)')
			.where((eb) => eb.ref('users.tags').contains(['x) or (y']))
			.toSQL({ inline: true });
		const pretty = prettySQL(tricky.sql);
		expect(
			pretty.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')'),
		).toBe(tricky.sql);
		expect(pretty).toContain(`'a from b, where (c and d)'`);
		expect(pretty).toContain(`'{"x) or (y"}'`);
	});

	it('indents subqueries', () => {
		expect(
			prettySQL(
				'select "a" as "a" from "t" where "a" in (select "b" from "u" where "c" = 1)',
			),
		).toBe(
			[
				'select',
				'  "a" as "a"',
				'from "t"',
				'where "a" in (',
				'  select',
				'    "b"',
				'  from "u"',
				'  where "c" = 1',
				')',
			].join('\n'),
		);
	});
});

describe('toSQL of shaped queries and batch items', () => {
	const query = selectFrom(users)
		.select(['users.id'])
		.where('users.password', 'hunter2')
		.where((eb) => eb.ref('users.id').in([1, 2]));
	const shapes = [
		query.toQuery(),
		query.takeFirst(),
		query.takeValue(),
		query.expectNonEmpty(),
		query.expectFirst(),
		query.expectOne(),
		query.expectAtMostOne(),
		query.expectValue(),
	];

	it('is the builder’s SQL: no shape adds a limit', () => {
		for (const shape of shapes) {
			expect(shape.toSQL()).toEqual(query.toSQL());
			expect(shape.toSQL({ inline: true })).toEqual(
				query.toSQL({ inline: true }),
			);
			expect(shape.toSQL({ pretty: true })).toEqual(
				query.toSQL({ pretty: true }),
			);
		}
		expect(query.toSQL().sql).not.toContain('limit');
		expect(query.limit(1).expectOne().toSQL({ inline: true }).sql).toMatch(
			/ limit 1$/,
		);
	});

	it('inlines each item of a batch, redacting sensitive values', () => {
		const insert = insertInto(flags).values({ name: "it's", admin: true });
		const items = [
			query.expectOne(),
			insert,
			insert.returning(['flags.id']).takeValue(),
			update(flags).set({ admin: false }).where('flags.id', 7).expectRows(1),
			deleteFrom(flags).where('flags.id', 7).expectNonEmpty(),
		];
		expect(
			items.map((item) => item.toQuery().toSQL({ inline: true }).sql),
		).toEqual([
			`select "users"."id" as "id" from "users" where ("users"."password_hash" = '[redacted]' and "users"."id" in (1, 2))`,
			`insert into "flags" ("name", "admin") values ('it''s', true)`,
			`insert into "flags" ("name", "admin") values ('it''s', true) returning "flags"."id" as "id"`,
			`update "flags" set "admin" = false where "flags"."id" = 7`,
			`delete from "flags" where "flags"."id" = 7`,
		]);
		expect(items[0]?.toQuery().toSQL({ inline: true }).params).toEqual([]);
	});

	it('keeps what execute() sends without options, codecs and tag included', () => {
		const tagged = insertInto(flags)
			.values([
				{ name: 'a', admin: true },
				{ name: 'b', admin: false },
			])
			.tag('flags.seed');
		const sent = tagged.toQuery().toSQL();
		expect(sent.tag).toBe('flags.seed');
		expect(codecNames(sent).params).toEqual(['text[]', 'bool[]']);
		expect(tagged.expectNonEmpty().toSQL()).toEqual(sent);
		const pretty = tagged.toSQL({ pretty: true });
		expect(codecNames(pretty)).toEqual(codecNames(sent));
		expect(pretty.params).toEqual(sent.params);
		expect(tagged.toSQL({ inline: true })).toEqual({
			sql: expect.stringContaining(`unnest('{a,b}'::text[]`),
			params: [],
			tag: 'flags.seed',
		});
	});
});

describe('toSQL of everyday SQL', () => {
	const query = selectFrom(users)
		.leftJoin(flags)
		.on('flags.id', 'users.id')
		.crossJoin(users.as('c'))
		.select((eb) => [
			'users.name',
			eb.fn.count().as('n'),
			eb.ref('users.balance').plus('1.50').as('more'),
			eb
				.case()
				.when(eb.ref('users.admin').isTrue(), 'admin')
				.else('member')
				.end()
				.as('role'),
			sqlTag<string>`upper(${eb.ref('users.name')})`.as('upper'),
		])
		.where('users.id', 7)
		.where(
			(eb) =>
				sqlTag<boolean>`${sqlTag.id('users', 'name')} <> ${sqlTag.lit("O'Hara")} and ${eb.ref('users.ratio')} > ${0.5}`,
		)
		.groupBy(['users.name'])
		.having((eb) => eb.and([eb.fn.count().gt('1'), eb.fn.count().lt('9')]))
		.orderBy('n', 'desc')
		.orderBy('users.name', 'asc', { nulls: 'first' })
		.limit(10)
		.offset(20);

	it('inlines joins, arithmetic, case, raw fragments and every clause', () => {
		expect(query.toSQL({ inline: true })).toEqual({
			sql: `select "users"."name" as "name", count(*) as "n", "users"."balance" + '1.50'::numeric as "more", case when "users"."admin" is true then 'admin'::text else 'member'::text end as "role", upper("users"."name") as "upper" from "users" left join "flags" on "flags"."id" = "users"."id" cross join "users" as "c" where ("users"."id" = 7 and "users"."name" <> 'O''Hara' and "users"."ratio" > 0.5) group by "users"."name" having (count(*) > '1'::int8 and count(*) < '9'::int8) order by "n" desc, "users"."name" asc nulls first limit 10 offset 20`,
			params: [],
		});
	});

	it('lays out joins, group by, having, order by and offset', () => {
		expect(query.toSQL({ inline: true, pretty: true }).sql).toBe(
			[
				'select',
				'  "users"."name" as "name",',
				'  count(*) as "n",',
				`  "users"."balance" + '1.50'::numeric as "more",`,
				`  case when "users"."admin" is true then 'admin'::text else 'member'::text end as "role",`,
				'  upper("users"."name") as "upper"',
				'from "users"',
				'left join "flags" on "flags"."id" = "users"."id"',
				'cross join "users" as "c"',
				'where (',
				'  "users"."id" = 7',
				`  and "users"."name" <> 'O''Hara'`,
				'  and "users"."ratio" > 0.5',
				')',
				'group by',
				'  "users"."name"',
				'having (',
				`  count(*) > '1'::int8`,
				`  and count(*) < '9'::int8`,
				')',
				'order by',
				'  "n" desc,',
				'  "users"."name" asc nulls first',
				'limit 10',
				'offset 20',
			].join('\n'),
		);
		const pretty = query.toSQL({ pretty: true });
		expect(pretty.params).toEqual(query.toSQL().params);
		expect(
			pretty.sql.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')'),
		).toBe(query.toSQL().sql);
	});

	it('keeps a case’s own conditions on its line', () => {
		expect(
			prettySQL(
				'select "a" as "a" from "t" where case when "b" and "c" then true else false end and "d"',
			),
		).toBe(
			[
				'select',
				'  "a" as "a"',
				'from "t"',
				'where case when "b" and "c" then true else false end',
				'  and "d"',
			].join('\n'),
		);
	});

	it('inlines setEach’s unnest arrays and the case of a row that leaves a column out', () => {
		const each = update(users).setEach(
			[
				{ id: 1, name: "O'Hara", password: 'p1' },
				{ id: 2, admin: false },
			],
			{ key: 'id' },
		);
		expect(each.toSQL({ inline: true, pretty: true }).sql).toBe(
			[
				'update "users"',
				'set',
				'  "name" = case when "row"."set:name" then "row"."name" else "users"."name" end,',
				'  "password_hash" = case when "row"."set:password_hash" then "row"."password_hash" else "users"."password_hash" end,',
				'  "admin" = case when "row"."set:admin" then "row"."admin" else "users"."admin" end',
				`from unnest('{1,2}'::integer[], '{O''Hara,NULL}'::text[], '[redacted]'::text[], '{NULL,f}'::boolean[], '{t,f}'::boolean[], '{t,f}'::boolean[], '{f,t}'::boolean[]) as "row"("id", "name", "password_hash", "admin", "set:name", "set:password_hash", "set:admin")`,
				'where "users"."id" = "row"."id"',
			].join('\n'),
		);
		expect(each.toSQL({ inline: true }).params).toEqual([]);
	});

	it('renders db.sql statements, sql.id and sql.lit', () => {
		const db = databaseWith(fakeExecutor().executor);
		const statement = db.sql`select ${sqlTag.id('flags', 'name')} from ${flags} where ${sqlTag.id('flags', 'id')} = ${7} and name <> ${sqlTag.lit('x')} order by 1`;
		expect(statement.toSQL()).toEqual({
			sql: `select "flags"."name" from "flags" where "flags"."id" = $1 and name <> 'x' order by 1`,
			params: [7],
		});
		expect(statement.toSQL({ inline: true })).toEqual({
			sql: `select "flags"."name" from "flags" where "flags"."id" = 7 and name <> 'x' order by 1`,
			params: [],
		});
		expect(statement.toSQL({ pretty: true }).sql).toBe(
			[
				'select',
				'  "flags"."name"',
				'from "flags"',
				`where "flags"."id" = $1`,
				`  and name <> 'x'`,
				'order by',
				'  1',
			].join('\n'),
		);
		expect(statement.expectOne().toSQL({ inline: true })).toEqual(
			statement.toSQL({ inline: true }),
		);
	});
});
