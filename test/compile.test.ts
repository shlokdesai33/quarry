import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import {
	array,
	boolean,
	daterange,
	integer,
	jsonb,
	text,
	timestamptz,
	tstzrange,
} from '../src/column-factories.js';
import { defineTable } from '../src/define-table.js';
import { binaryArray } from '../src/driver/array-params.js';
import { codecs } from '../src/driver/codecs.js';
import { encodeParams, paramOids } from '../src/driver/params.js';
import { TypeCatalog } from '../src/driver/registry.js';
import { arrayOids, oids } from '../src/driver/types.js';
import type { Expression } from '../src/expression.js';
import { expressionBuilder } from '../src/expression-builder.js';
import type { Range } from '../src/range.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		firstName: text().name('first_name'),
		email: text().nullable(),
		admin: boolean(),
		age: integer(),
		tags: array(text()),
		deletedAt: timestamptz().name('deleted_at').nullable(),
		settings: jsonb<{ theme: string } | string[]>(),
		profile: jsonb<{ address: { city: string }; tags: string[] }>().nullable(),
		data: jsonb(),
		active: tstzrange(),
		vacation: daterange().nullable(),
		history: array(tstzrange()),
		documents: array(jsonb<{ id: number }>()),
		attachments: array(jsonb<{ id: number }>().nullable()),
	},
});

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		authorId: integer().name('author_id'),
	},
});

const eb = expressionBuilder(users);

const compiled = (expression: Expression<unknown>) =>
	compile(expression._quarry.node);

/** Copies bytes out of a pooled buffer, to compare. */
const bytes = (value: unknown) =>
	value instanceof Uint8Array ? [...value] : value;

/** An expression's SQL, its parameters as the driver sends them, and the type OIDs it declares. */
function wire(expression: Expression<unknown>) {
	const query = compiled(expression);
	return {
		sql: query.sql,
		params: encodeParams(
			query.sql,
			query.params,
			query.paramCodecs,
			undefined,
		).map(bytes),
		types: paramOids(
			query.params,
			query.paramCodecs,
			undefined,
			new TypeCatalog(),
		),
	};
}

describe('comparisons', () => {
	it('parameterises the value and maps the column name', () => {
		expect(compiled(eb.ref('users.firstName').eq('Ada'))).toEqual({
			sql: '"users"."first_name" = $1',
			params: ['Ada'],
		});
	});

	it('keeps the key when the column has no explicit name', () => {
		expect(compiled(eb.ref('users.age').gte(18))).toEqual({
			sql: '"users"."age" >= $1',
			params: [18],
		});
	});

	it('accepts a reference on the right', () => {
		expect(compiled(eb.ref('users.age').lt(eb.ref('users.id')))).toEqual({
			sql: '"users"."age" < "users"."id"',
			params: [],
		});
	});

	it('renders `is null` as a literal', () => {
		expect(compiled(eb.ref('users.email').isNull())).toEqual({
			sql: '"users"."email" is null',
			params: [],
		});
		expect(compiled(eb.ref('users.admin').isNotTrue())).toEqual({
			sql: '"users"."admin" is not true',
			params: [],
		});
	});

	it('parenthesises a comparison on the right', () => {
		expect(
			compiled(eb.ref('users.admin').eq(eb.ref('users.age').gt(18))),
		).toEqual({
			sql: '"users"."admin" = ("users"."age" > $1)',
			params: [18],
		});
		expect(
			compiled(eb.ref('users.admin').eq(eb.and([eb.ref('users.age').gt(18)]))),
		).toEqual({
			sql: '"users"."admin" = ("users"."age" > $1)',
			params: [18],
		});
	});

	it('renders `in` as a parenthesised list', () => {
		expect(compiled(eb.ref('users.age').in([1, 2, 3]))).toEqual({
			sql: '"users"."age" in ($1, $2, $3)',
			params: [1, 2, 3],
		});
	});

	it('renders `in` against an array expression as `= any` / `<> all`', () => {
		// an integer column's array is declared int4[], so it goes in binary
		expect(wire(eb.ref('users.age').in(eb.val([1, 2])))).toEqual({
			sql: '"users"."age" = any($1)',
			params: [bytes(binaryArray([1, 2], arrayOids.int4))],
			types: [arrayOids.int4],
		});
		expect(compiled(eb.ref('users.age').notIn(eb.val([1, 2])))).toEqual({
			sql: '"users"."age" <> all($1)',
			params: [[1, 2]],
		});
		// a text column's array is left to the server to type, as a literal
		expect(wire(eb.ref('users.firstName').in(eb.val(['a', 'b c'])))).toEqual({
			sql: '"users"."first_name" = any($1)',
			params: ['{a,"b c"}'],
			types: [],
		});
		expect(
			compiled(eb.ref('users.firstName').in(eb.ref('users.tags'))),
		).toEqual({
			sql: '"users"."first_name" = any("users"."tags")',
			params: [],
		});
	});

	it('collapses an empty `in` list', () => {
		expect(compiled(eb.ref('users.age').in([]))).toEqual({
			sql: 'false',
			params: [],
		});
		expect(compiled(eb.ref('users.age').notIn([]))).toEqual({
			sql: 'true',
			params: [],
		});
	});

	it('renders `between`', () => {
		expect(compiled(eb.ref('users.age').notBetween([18, 65]))).toEqual({
			sql: '"users"."age" not between $1 and $2',
			params: [18, 65],
		});
	});

	it('takes expressions as items of a list and bounds of a pair', () => {
		expect(compiled(eb.ref('users.age').in([18, eb.ref('users.id')]))).toEqual({
			sql: '"users"."age" in ($1, "users"."id")',
			params: [18],
		});
		expect(
			compiled(eb.ref('users.age').between([eb.ref('users.id'), 65])),
		).toEqual({
			sql: '"users"."age" between "users"."id" and $1',
			params: [65],
		});
	});

	it('compares a parameter with the elements of an array column', () => {
		expect(compiled(eb.val('admin').eq(eb.fn.any('users.tags')))).toEqual({
			sql: '$1 = any("users"."tags")',
			params: ['admin'],
		});
		expect(compiled(eb.val('admin').ne(eb.fn.all('users.tags')))).toEqual({
			sql: '$1 <> all("users"."tags")',
			params: ['admin'],
		});
		expect(compiled(eb.val('ada').like(eb.fn.any('users.tags')))).toEqual({
			sql: '$1 like any("users"."tags")',
			params: ['ada'],
		});
	});

	it('numbers a parameter on the left before those on the right', () => {
		const tags = eb.fn.coalesce('users.tags', eb.val<string[]>([]));
		expect(compiled(eb.val('admin').eq(eb.fn.any(tags)))).toEqual({
			sql: '$1 = any(coalesce("users"."tags", $2))',
			params: ['admin', []],
		});
	});

	it('renders an expression on the left in place of a column', () => {
		expect(compiled(eb.fn.lower('users.firstName').like('a%'))).toEqual({
			sql: 'lower("users"."first_name") like $1',
			params: ['a%'],
		});
		expect(compiled(eb.ref('users.age').gt(18).isFalse())).toEqual({
			sql: '("users"."age" > $1) is false',
			params: [18],
		});
	});

	it('needs an array of known SQL type to compare a parameter with', () => {
		// @ts-expect-error values have no SQL type to encode the parameter by
		expect(() => eb.val('admin').eq(eb.fn.any(['admin']))).toThrow(
			'any() or all() of an array column or expression',
		);
	});

	it('renders `any` / `all` of values as one array parameter', () => {
		expect(
			compiled(eb.ref('users.firstName').like(eb.fn.any(['a%', 'b%']))),
		).toEqual({
			sql: '"users"."first_name" like any($1)',
			params: [['a%', 'b%']],
		});
		expect(
			compiled(eb.ref('users.firstName').notLike(eb.fn.all(['a%', 'b%']))),
		).toEqual({
			sql: '"users"."first_name" not like all($1)',
			params: [['a%', 'b%']],
		});
		expect(compiled(eb.ref('users.age').gt(eb.fn.any(eb.val([1, 2]))))).toEqual(
			{
				sql: '"users"."age" > any($1)',
				params: [[1, 2]],
			},
		);
		expect(
			wire(eb.ref('users.age').gt(eb.fn.any(eb.val([1, 2])))).types,
		).toEqual([arrayOids.int4]);
	});

	it('renders `any` / `all` of an array expression in place', () => {
		expect(
			compiled(eb.ref('users.firstName').eq(eb.fn.any('users.tags'))),
		).toEqual({
			sql: '"users"."first_name" = any("users"."tags")',
			params: [],
		});
		const tags = eb.fn.coalesce('users.tags', eb.val<string[]>([]));
		expect(compiled(eb.ref('users.firstName').ne(eb.fn.all(tags)))).toEqual({
			sql: '"users"."first_name" <> all(coalesce("users"."tags", $1))',
			params: [[]],
		});
	});

	it('passes array operands as a single parameter', () => {
		expect(compiled(eb.ref('users.tags').overlaps(['a', 'b']))).toEqual({
			sql: '"users"."tags" && $1',
			params: [['a', 'b']],
		});
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
	const literal = '["2024-01-01 00:00:00.000+00","2024-02-01 00:00:00.000+00")';

	it('encodes a range operand as a range literal, with the range type', () => {
		expect(wire(eb.ref('users.active').overlaps(january))).toEqual({
			sql: '"users"."active" && $1',
			params: [literal],
			types: [oids.tstzrange],
		});
	});

	it('encodes a point operand of a range with the point type, so `@>` takes it', () => {
		expect(wire(eb.ref('users.active').contains(jan))).toEqual({
			sql: '"users"."active" @> $1',
			params: ['2024-01-01 00:00:00.000+00'],
			types: [oids.timestamptz],
		});
		expect(wire(eb.ref('users.vacation').contains('2024-01-01'))).toMatchObject(
			{
				params: ['2024-01-01'],
				types: [oids.date],
			},
		);
		// a range on the right is still a range
		expect(wire(eb.ref('users.active').contains(january)).types).toEqual([
			oids.tstzrange,
		]);
	});

	it('writes tstzrange bounds past the year 9999 and before 1 as postgres reads them', () => {
		const far: Range<Date> = {
			empty: false,
			lower: new Date(Date.UTC(-1, 0, 1)),
			upper: new Date(Date.UTC(10000, 0, 1)),
			bounds: '[)',
		};
		expect(wire(eb.ref('users.active').eq(far)).params).toEqual([
			'["0002-01-01 00:00:00.000+00 BC","10000-01-01 00:00:00.000+00")',
		]);
	});

	it('encodes unbounded and empty ranges', () => {
		expect(
			wire(
				eb.ref('users.vacation').eq({
					empty: false,
					lower: null,
					upper: '2024-02-01',
					bounds: '(]',
				}),
			).params,
		).toEqual(['(,"2024-02-01"]']);
		expect(wire(eb.ref('users.vacation').eq({ empty: true })).params).toEqual([
			'empty',
		]);
	});

	it('escapes quotes and backslashes inside range bounds', () => {
		expect(
			wire(
				eb.ref('users.vacation').eq({
					empty: false,
					lower: 'a"b\\c',
					upper: null,
					bounds: '[]',
				}),
			).params,
		).toEqual(['["a\\"b\\\\c",]']);
	});

	it('encodes jsonb values, including top-level arrays and strings', () => {
		expect(wire(eb.ref('users.settings').eq({ theme: 'dark' }))).toEqual({
			sql: '"users"."settings" = $1',
			params: ['{"theme":"dark"}'],
			types: [oids.jsonb],
		});
		expect(wire(eb.ref('users.settings').eq(['a', 'b'])).params).toEqual([
			'["a","b"]',
		]);
		expect(
			wire(eb.ref('users.settings').contains({ theme: 'dark' })).params,
		).toEqual(['{"theme":"dark"}']);
	});

	it('encodes each element of an `in` list', () => {
		expect(
			wire(eb.ref('users.settings').in([{ theme: 'dark' }, ['a']])),
		).toEqual({
			sql: '"users"."settings" in ($1, $2)',
			params: ['{"theme":"dark"}', '["a"]'],
			types: [oids.jsonb, oids.jsonb],
		});
	});

	it('sends null as SQL null, not as JSON null', () => {
		expect(
			wire(eb.ref('users.settings').contains({ theme: null })).params,
		).toEqual(['{"theme":null}']);
		expect(
			wire(eb.ref('users.settings').isNotDistinctFrom(null)).params,
		).toEqual([null]);
	});

	it('encodes values by the SQL type of an expression, not only a column', () => {
		const vacation = eb.fn.coalesce('users.vacation', eb.val(null));
		expect(wire(vacation.eq({ empty: true }))).toEqual({
			sql: 'coalesce("users"."vacation", $1) = $2',
			params: [null, 'empty'],
			types: [oids.daterange, oids.daterange],
		});
	});

	it('encodes a coalesce fallback parameter by the first argument’s codec', () => {
		const active = eb.fn.coalesce('users.active', eb.val(january));
		expect(wire(active.isNotNull())).toEqual({
			sql: 'coalesce("users"."active", $1) is not null',
			params: [literal],
			types: [oids.tstzrange],
		});
	});

	it('encodes a parameter outside a comparison by the codec it is given, or its JavaScript type', () => {
		expect(
			wire(eb.fn.concat(eb.val(january, codecs.tstzrange)).isNotNull()),
		).toMatchObject({ params: [literal], types: [oids.tstzrange] });
		// postgres can't infer a parameter of `concat(variadic any)`
		expect(wire(eb.fn.concat(eb.val('a')).isNotNull())).toMatchObject({
			params: ['a'],
			types: [oids.text],
		});
		expect(wire(eb.fn.concat(eb.val(1), eb.val(1.5)).isNotNull())).toMatchObject(
			{ params: ['1', '1.5'], types: [oids.int4, oids.float8] },
		);
	});

	it('does not encode expressions', () => {
		expect(
			compiled(eb.ref('users.settings').eq(eb.ref('users.settings'))).params,
		).toEqual([]);
	});

	it('encodes the items of an array parameter given to `in`', () => {
		expect(wire(eb.ref('users.settings').in(eb.val([['a']])))).toEqual({
			sql: '"users"."settings" = any($1)',
			params: [bytes(binaryArray([['a']], arrayOids.jsonb, true))],
			types: [arrayOids.jsonb],
		});
	});

	it('encodes each value given to `any` / `all` as an operand of the operator', () => {
		expect(
			wire(
				eb
					.ref('users.settings')
					.contains(eb.fn.any([{ theme: 'dark' }, ['a']])),
			).params,
		).toEqual([
			bytes(binaryArray([{ theme: 'dark' }, ['a']], arrayOids.jsonb, true)),
		]);
		expect(
			wire(eb.ref('users.active').overlaps(eb.fn.any(eb.val([january]))))
				.params,
		).toEqual([`{"${literal.replaceAll('"', '\\"')}"}`]);
		// points of a range
		expect(
			wire(eb.ref('users.active').contains(eb.fn.any([jan]))),
		).toMatchObject({ types: [arrayOids.timestamptz] });
	});

	it('encodes vectors in pgvector syntax', () => {
		expect(codecs.vector.encode([1, 2.5, 3])).toBe('[1,2.5,3]');
	});

	it('encodes array elements by the element type', () => {
		expect(wire(eb.ref('users.history').contains([january])).params).toEqual([
			`{"${literal.replaceAll('"', '\\"')}"}`,
		]);
		expect(wire(eb.val(january).eq(eb.fn.any('users.history')))).toEqual({
			sql: '$1 = any("users"."history")',
			params: [literal],
			types: [oids.tstzrange],
		});
		expect(
			wire(eb.val({ id: 1 }).eq(eb.fn.any('users.documents'))).params,
		).toEqual(['{"id":1}']);
	});

	it('sends null elements as SQL null, not as encoded values', () => {
		expect(
			wire(eb.ref('users.attachments').contains([null, { id: 1 }])).params,
		).toEqual([bytes(binaryArray([null, { id: 1 }], arrayOids.jsonb, true))]);
	});

	it('writes integers without an exponent', () => {
		expect(wire(eb.ref('users.age').eq(1e21)).params).toEqual([
			'1000000000000000000000',
		]);
	});
});

describe('jsonb functions', () => {
	it('reads a field as jsonb or text, with the key as a literal', () => {
		expect(compiled(eb.json.get('users.settings', 'theme'))).toEqual({
			sql: '"users"."settings" -> \'theme\'',
			params: [],
		});
		expect(compiled(eb.json.text('users.settings', 'theme'))).toEqual({
			sql: '"users"."settings" ->> \'theme\'',
			params: [],
		});
	});

	it('reads a path as a chain of `->`, ending in `->>` for text', () => {
		expect(compiled(eb.json.text('users.profile', 'address', 'city')).sql).toBe(
			'("users"."profile" -> \'address\') ->> \'city\'',
		);
		expect(compiled(eb.json.get('users.profile', 'tags', -1)).sql).toBe(
			'("users"."profile" -> \'tags\') -> -1',
		);
		expect(
			compiled(eb.json.text(eb.json.get('users.profile', 'address'), 'city'))
				.sql,
		).toBe('("users"."profile" -> \'address\') ->> \'city\'');
	});

	it('escapes keys as postgres string literals', () => {
		expect(compiled(eb.json.get('users.data', "it's")).sql).toBe(
			'"users"."data" -> \'it\'\'s\'',
		);
		expect(compiled(eb.json.get('users.data', 'a\\b')).sql).toBe(
			'"users"."data" -> E\'a\\\\b\'',
		);
		expect(() => eb.json.get('users.data', 'a\0b')).not.toThrow();
		expect(() => compiled(eb.json.get('users.data', 'a\0b'))).toThrow('NUL');
		expect(() => eb.json.get('users.data', 1.5)).toThrow('integer');
	});

	it('compares a field by its SQL type', () => {
		expect(
			compiled(eb.json.text('users.settings', 'theme').eq('dark')),
		).toEqual({
			sql: '("users"."settings" ->> \'theme\') = $1',
			params: ['dark'],
		});
		expect(wire(eb.json.get('users.settings', 'theme').eq('dark'))).toEqual({
			sql: '("users"."settings" -> \'theme\') = $1',
			params: ['"dark"'],
			types: [oids.jsonb],
		});
		expect(
			wire(eb.json.get('users.profile', 'address').contains({ city: 'Oslo' }))
				.params,
		).toEqual(['{"city":"Oslo"}']);
	});

	it('tests keys and jsonpaths, sending the operand as text', () => {
		expect(compiled(eb.json.hasKey('users.settings', 'theme'))).toEqual({
			sql: '"users"."settings" ? $1',
			params: ['theme'],
		});
		expect(
			compiled(eb.json.hasAnyKey('users.settings', ['theme', 'lang'])),
		).toEqual({
			sql: '"users"."settings" ?| $1',
			params: [['theme', 'lang']],
		});
		// keys are text, encoded as a text array; a path is a jsonpath
		expect(
			wire(eb.json.hasAnyKey('users.settings', ['theme', 'a "b"'])).params,
		).toEqual(['{theme,"a \\"b\\""}']);
		expect(wire(eb.json.pathExists('users.data', '$.a')).types).toEqual([4072]);
		expect(
			compiled(eb.json.hasAllKeys('users.settings', eb.val(['theme']))),
		).toEqual({
			sql: '"users"."settings" ?& $1',
			params: [['theme']],
		});
		expect(compiled(eb.json.pathExists('users.data', '$.tags[*]'))).toEqual({
			sql: '"users"."data" @? $1',
			params: ['$.tags[*]'],
		});
		expect(compiled(eb.json.pathMatches('users.data', '$.n > 1'))).toEqual({
			sql: '"users"."data" @@ $1',
			params: ['$.n > 1'],
		});
		expect(
			compiled(eb.json.hasKey('users.settings', eb.ref('users.firstName'))),
		).toEqual({
			sql: '"users"."settings" ? "users"."first_name"',
			params: [],
		});
	});

	it('renders jsonb_typeof and jsonb_array_length', () => {
		expect(compiled(eb.json.typeOf('users.data')).sql).toBe(
			'jsonb_typeof("users"."data")',
		);
		expect(
			compiled(eb.json.length(eb.json.get('users.profile', 'tags')).gt(2)),
		).toEqual({
			sql: 'jsonb_array_length("users"."profile" -> \'tags\') > $1',
			params: [2],
		});
	});
});

describe('logical operators', () => {
	it('parenthesises and/or and numbers parameters in order', () => {
		const expression = eb.or([
			eb.and([eb.ref('users.age').gt(18), eb.ref('users.admin').eq(false)]),
			eb.not(eb.ref('users.email').isNull()),
		]);
		expect(compiled(expression)).toEqual({
			sql: '(("users"."age" > $1 and "users"."admin" = $2) or not ("users"."email" is null))',
			params: [18, false],
		});
	});

	it('unwraps a single operand', () => {
		expect(compiled(eb.and([eb.ref('users.age').gt(18)]))).toEqual({
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
		expect(compiled(eb.fn.max('users.age').gt(18))).toEqual({
			sql: 'max("users"."age") > $1',
			params: [18],
		});
	});

	it('renders nullary functions', () => {
		expect(compiled(eb.fn.now()).sql).toBe('now()');
	});

	it('renders cast', () => {
		expect(compiled(eb.fn.cast(eb.fn.count(), 'integer').gt(5))).toEqual({
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
			compiled(scoped.ref('posts.authorId').eq(scoped.ref('users.id'))),
		).toEqual({
			sql: '"posts"."author_id" = "users"."id"',
			params: [],
		});
	});

	it('uses the alias of an aliased table', () => {
		const scoped = expressionBuilder(users.as('u'));
		expect(compiled(scoped.ref('u.firstName').eq('Ada'))).toEqual({
			sql: '"u"."first_name" = $1',
			params: ['Ada'],
		});
	});
});

describe('column names', () => {
	it('keeps a name through the modifiers around it', () => {
		const named = defineTable('named', {
			columns: {
				id: integer().name('named_id').identity(),
				note: text().nullable().name('note_text').default(),
				slug: text().generated().name('slug_text').typed<'a'>(),
			},
		});
		const nb = expressionBuilder(named);
		expect(compiled(nb.ref('named.id')).sql).toBe('"named"."named_id"');
		expect(compiled(nb.ref('named.note')).sql).toBe('"named"."note_text"');
		expect(compiled(nb.ref('named.slug')).sql).toBe('"named"."slug_text"');
	});

	it('names an array column by its own name, never its element', () => {
		const tagged = defineTable('tagged', {
			columns: {
				labels: array(text()).name('label_list'),
				aliases: array(text().name('ignored')),
				topics: array(text().name('ignored')).name('topic_list'),
			},
		});
		const tb = expressionBuilder(tagged);
		expect(compiled(tb.ref('tagged.labels')).sql).toBe('"tagged"."label_list"');
		expect(compiled(tb.ref('tagged.aliases')).sql).toBe('"tagged"."aliases"');
		expect(compiled(tb.ref('tagged.topics')).sql).toBe('"tagged"."topic_list"');
	});

	it('escapes quotes in identifiers', () => {
		const odd = defineTable('we"ird', { columns: { col: text().name('a"b') } });
		expect(compiled(expressionBuilder(odd).ref('we"ird.col')).sql).toBe(
			'"we""ird"."a""b"',
		);
	});
});
