import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import {
	boolean,
	daterange,
	integer,
	jsonb,
	text,
	timestamptz,
	tstzrange,
	vector,
} from '../src/column-factories.js';
import { defineTable } from '../src/define-table.js';
import type { Expression } from '../src/expression.js';
import { expressionBuilder } from '../src/expression-builder.js';
import type { Range } from '../src/range.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		firstName: text('first_name'),
		email: text().nullable(),
		admin: boolean(),
		age: integer(),
		tags: text().array(),
		deletedAt: timestamptz('deleted_at').nullable(),
		settings: jsonb<{ theme: string } | string[]>(),
		active: tstzrange(),
		vacation: daterange().nullable(),
		history: tstzrange().array(),
		documents: jsonb<{ id: number }>().array(),
	},
});

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		authorId: integer('author_id'),
	},
});

const eb = expressionBuilder(users);

const compiled = (expression: Expression<unknown>) =>
	compile(expression.toNode());

describe('comparisons', () => {
	it('parameterises the value and maps the column name', () => {
		expect(compiled(eb('users.firstName', '=', 'Ada'))).toEqual({
			sql: '"users"."first_name" = $1',
			params: ['Ada'],
		});
	});

	it('keeps the key when the column has no explicit name', () => {
		expect(compiled(eb('users.age', '>=', 18))).toEqual({
			sql: '"users"."age" >= $1',
			params: [18],
		});
	});

	it('accepts a reference on the right', () => {
		expect(compiled(eb('users.age', '<', eb.ref('users.id')))).toEqual({
			sql: '"users"."age" < "users"."id"',
			params: [],
		});
	});

	it('renders `is null` as a literal', () => {
		expect(compiled(eb('users.email', 'is', null))).toEqual({
			sql: '"users"."email" is null',
			params: [],
		});
		expect(compiled(eb('users.admin', 'is not', true))).toEqual({
			sql: '"users"."admin" is not true',
			params: [],
		});
	});

	it('parenthesises a comparison on the right', () => {
		expect(compiled(eb('users.admin', '=', eb('users.age', '>', 18)))).toEqual({
			sql: '"users"."admin" = ("users"."age" > $1)',
			params: [18],
		});
		expect(
			compiled(eb('users.admin', '=', eb.and([eb('users.age', '>', 18)]))),
		).toEqual({
			sql: '"users"."admin" = ("users"."age" > $1)',
			params: [18],
		});
	});

	it('renders `in` as a parenthesised list', () => {
		expect(compiled(eb('users.age', 'in', [1, 2, 3]))).toEqual({
			sql: '"users"."age" in ($1, $2, $3)',
			params: [1, 2, 3],
		});
	});

	it('renders `in` against an array expression as `= any` / `<> all`', () => {
		expect(compiled(eb('users.age', 'in', eb.val([1, 2])))).toEqual({
			sql: '"users"."age" = any($1)',
			params: [[1, 2]],
		});
		expect(compiled(eb('users.age', 'not in', eb.val([1, 2])))).toEqual({
			sql: '"users"."age" <> all($1)',
			params: [[1, 2]],
		});
		expect(compiled(eb('users.firstName', 'in', eb.ref('users.tags')))).toEqual(
			{
				sql: '"users"."first_name" = any("users"."tags")',
				params: [],
			},
		);
	});

	it('collapses an empty `in` list', () => {
		expect(compiled(eb('users.age', 'in', []))).toEqual({
			sql: 'false',
			params: [],
		});
		expect(compiled(eb('users.age', 'not in', []))).toEqual({
			sql: 'true',
			params: [],
		});
	});

	it('renders `between`', () => {
		expect(compiled(eb('users.age', 'not between', [18, 65]))).toEqual({
			sql: '"users"."age" not between $1 and $2',
			params: [18, 65],
		});
	});

	it('puts the value on the left for `= any`', () => {
		expect(compiled(eb('users.tags', '= any', 'admin'))).toEqual({
			sql: '$1 = any("users"."tags")',
			params: ['admin'],
		});
		expect(compiled(eb('users.tags', '<> all', 'admin'))).toEqual({
			sql: '$1 <> all("users"."tags")',
			params: ['admin'],
		});
	});

	it('puts an expression on the left for `= any`', () => {
		const name = eb.ref('users.firstName');
		expect(compiled(eb('users.tags', '= any', name))).toEqual({
			sql: '"users"."first_name" = any("users"."tags")',
			params: [],
		});
		expect(compiled(eb('users.tags', '<> all', name))).toEqual({
			sql: '"users"."first_name" <> all("users"."tags")',
			params: [],
		});
	});

	it('passes array operands as a single parameter', () => {
		expect(compiled(eb('users.tags', '&&', ['a', 'b']))).toEqual({
			sql: '"users"."tags" && $1',
			params: [['a', 'b']],
		});
	});
});

describe('expressions on the left', () => {
	const lower = eb.fn.lower('users.firstName');

	it('renders the expression in place of the column', () => {
		expect(compiled(eb(lower, 'like', 'a%'))).toEqual({
			sql: 'lower("users"."first_name") like $1',
			params: ['a%'],
		});
		expect(compiled(eb(eb.ref('users.age'), 'in', [1, 2]))).toEqual({
			sql: '"users"."age" in ($1, $2)',
			params: [1, 2],
		});
		expect(compiled(eb(eb('users.age', '>', 18), 'is', false))).toEqual({
			sql: '("users"."age" > $1) is false',
			params: [18],
		});
	});

	it('normalises `= any` around an expression', () => {
		const tags = eb.fn.coalesce('users.tags', eb.val<string[]>([]));
		expect(compiled(eb(tags, '= any', 'admin'))).toEqual({
			sql: '$1 = any(coalesce("users"."tags", $2))',
			params: ['admin', []],
		});
	});

	it('encodes values by the SQL type of the expression', () => {
		const vacation = eb.fn.coalesce('users.vacation', eb.val(null));
		expect(compiled(eb(vacation, '=', { empty: true }))).toEqual({
			sql: 'coalesce("users"."vacation", $1) = $2',
			params: [null, 'empty'],
		});
		expect(compiled(eb(eb.ref('users.settings'), '=', ['a', 'b']))).toEqual({
			sql: '"users"."settings" = $1',
			params: ['["a","b"]'],
		});
		expect(compiled(eb(eb.ref('users.settings'), '?', 'theme')).params).toEqual(
			['theme'],
		);
	});
});

describe('value encoding', () => {
	const jan = new Date('2024-01-01T00:00:00.000Z');
	const feb = new Date('2024-02-01T00:00:00.000Z');
	const january: Range<Date> = {
		empty: false,
		lower: jan,
		upper: feb,
		bounds: '[)',
	};

	it('serialises a range operand as a range literal', () => {
		expect(compiled(eb('users.active', '&&', january))).toEqual({
			sql: '"users"."active" && $1',
			params: ['["2024-01-01T00:00:00.000Z","2024-02-01T00:00:00.000Z")'],
		});
	});

	it('passes a point operand of a range through', () => {
		expect(compiled(eb('users.active', '@>', jan))).toEqual({
			sql: '"users"."active" @> $1',
			params: [jan],
		});
	});

	it('serialises unbounded and empty ranges', () => {
		expect(
			compiled(
				eb('users.vacation', '=', {
					empty: false,
					lower: null,
					upper: '2024-02-01',
					bounds: '(]',
				}),
			).params,
		).toEqual(['(,"2024-02-01"]']);
		expect(compiled(eb('users.vacation', '=', { empty: true })).params).toEqual(
			['empty'],
		);
	});

	it('escapes quotes and backslashes inside range bounds', () => {
		expect(
			compiled(
				eb('users.vacation', '=', {
					empty: false,
					lower: 'a"b\\c',
					upper: null,
					bounds: '[]',
				}),
			).params,
		).toEqual(['["a\\"b\\\\c",]']);
	});

	it('serialises jsonb values, including top-level arrays', () => {
		expect(
			compiled(eb('users.settings', '=', { theme: 'dark' })).params,
		).toEqual(['{"theme":"dark"}']);
		expect(compiled(eb('users.settings', '=', ['a', 'b'])).params).toEqual([
			'["a","b"]',
		]);
		expect(
			compiled(eb('users.settings', '@>', { theme: 'dark' })).params,
		).toEqual(['{"theme":"dark"}']);
	});

	it('encodes each element of an `in` list', () => {
		expect(
			compiled(eb('users.settings', 'in', [{ theme: 'dark' }, ['a']])),
		).toEqual({
			sql: '"users"."settings" in ($1, $2)',
			params: ['{"theme":"dark"}', '["a"]'],
		});
	});

	it('leaves jsonb key and path operands as text', () => {
		expect(compiled(eb('users.settings', '?', 'theme')).params).toEqual([
			'theme',
		]);
		expect(
			compiled(eb('users.settings', '?|', ['theme', 'lang'])).params,
		).toEqual([['theme', 'lang']]);
		expect(compiled(eb('users.settings', '@?', '$.theme')).params).toEqual([
			'$.theme',
		]);
	});

	it('does not encode expressions', () => {
		expect(
			compiled(eb('users.settings', '=', eb.ref('users.settings'))).params,
		).toEqual([]);
	});

	it('serialises vectors in pgvector syntax', () => {
		expect(vector().dataType.encode([1, 2.5, 3])).toBe('[1,2.5,3]');
	});

	it('keeps the name of a column made an array', () => {
		const tagged = defineTable('tagged', {
			columns: { labels: text('label_list').array() },
		});
		expect(compiled(expressionBuilder(tagged).ref('tagged.labels')).sql).toBe(
			'"tagged"."label_list"',
		);
	});

	it('encodes array elements by the element type', () => {
		const literal = '["2024-01-01T00:00:00.000Z","2024-02-01T00:00:00.000Z")';
		expect(compiled(eb('users.history', '@>', [january])).params).toEqual([
			[literal],
		]);
		expect(compiled(eb('users.history', '= any', january))).toEqual({
			sql: '$1 = any("users"."history")',
			params: [literal],
		});
		expect(
			compiled(eb('users.documents', '&&', [{ id: 1 }, { id: 2 }])).params,
		).toEqual([['{"id":1}', '{"id":2}']]);
	});
});

describe('logical operators', () => {
	it('parenthesises and/or and numbers parameters in order', () => {
		const expression = eb.or([
			eb.and([eb('users.age', '>', 18), eb('users.admin', '=', false)]),
			eb.not(eb('users.email', 'is', null)),
		]);
		expect(compiled(expression)).toEqual({
			sql: '(("users"."age" > $1 and "users"."admin" = $2) or not ("users"."email" is null))',
			params: [18, false],
		});
	});

	it('unwraps a single operand', () => {
		expect(compiled(eb.and([eb('users.age', '>', 18)]))).toEqual({
			sql: '"users"."age" > $1',
			params: [18],
		});
	});

	it('renders empty and/or as their identities', () => {
		expect(compiled(eb.and([])).sql).toBe('true');
		expect(compiled(eb.or([])).sql).toBe('false');
	});
});

describe('functions', () => {
	it('renders function calls over references and expressions', () => {
		const expression = eb.fn.concat(
			'users.firstName',
			eb.val(' '),
			eb.fn.lower('users.email'),
		);
		expect(compiled(expression)).toEqual({
			sql: 'concat("users"."first_name", $1, lower("users"."email"))',
			params: [' '],
		});
	});

	it('renders `count(*)` and `count(value)`', () => {
		expect(compiled(eb.fn.count()).sql).toBe('count(*)');
		expect(compiled(eb.fn.count('users.email')).sql).toBe(
			'count("users"."email")',
		);
	});

	it('renders variadic coalesce', () => {
		expect(
			compiled(eb.fn.coalesce('users.email', 'users.firstName', eb.val('?'))),
		).toEqual({
			sql: 'coalesce("users"."email", "users"."first_name", $1)',
			params: ['?'],
		});
	});

	it('renders min and max', () => {
		expect(compiled(eb.fn.min('users.age'))).toEqual({
			sql: 'min("users"."age")',
			params: [],
		});
		expect(compiled(eb(eb.fn.max('users.age'), '>', 18))).toEqual({
			sql: 'max("users"."age") > $1',
			params: [18],
		});
	});

	it('renders nullary functions', () => {
		expect(compiled(eb.fn.now()).sql).toBe('now()');
	});

	it('renders cast', () => {
		expect(compiled(eb(eb.fn.cast(eb.fn.count(), 'integer'), '>', 5))).toEqual({
			sql: 'cast(count(*) as integer) > $1',
			params: [5],
		});
		expect(compiled(eb.fn.cast('users.age', 'double precision')).sql).toBe(
			'cast("users"."age" as double precision)',
		);
	});
});

describe('scope', () => {
	it('resolves references across several tables', () => {
		const scoped = expressionBuilder(users, posts);
		expect(
			compiled(scoped('posts.authorId', '=', scoped.ref('users.id'))),
		).toEqual({
			sql: '"posts"."author_id" = "users"."id"',
			params: [],
		});
	});

	it('uses the alias of an aliased table', () => {
		const scoped = expressionBuilder(users.as('u'));
		expect(compiled(scoped('u.firstName', '=', 'Ada'))).toEqual({
			sql: '"u"."first_name" = $1',
			params: ['Ada'],
		});
	});

	it('escapes quotes in identifiers', () => {
		const odd = defineTable('we"ird', { columns: { col: text('a"b') } });
		expect(compiled(expressionBuilder(odd).ref('we"ird.col')).sql).toBe(
			'"we""ird"."a""b"',
		);
	});
});
