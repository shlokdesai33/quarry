import { describe, expectTypeOf, it } from 'vitest';
import type { Column } from '../src/column/column.js';
import type { DefaultColumn } from '../src/column/default-column.js';
import type { GeneratedColumn } from '../src/column/generated-column.js';
import type { IdentityColumn } from '../src/column/identity-column.js';
import type { IntegerColumn } from '../src/column/integer-column.js';
import type { ArrayType } from '../src/data-type/array.js';
import type { DataType } from '../src/data-type/data-type.js';
import type { EnumType } from '../src/data-type/enum.js';
import type { JsonbType } from '../src/data-type/jsonb.js';
import type { TstzRangeType } from '../src/data-type/range.js';
import type { VectorType } from '../src/data-type/vector.js';
import {
	array,
	bigint,
	boolean,
	integer,
	jsonb,
	real,
	text,
	timestamptz,
	tstzrange,
	uuid,
	varchar,
	vector,
} from '../src/column-factories.js';
import { defineEnum } from '../src/define-enum.js';
import { defineTable } from '../src/define-table.js';
import type { Expression, TypedExpression } from '../src/expression.js';
import { expressionBuilder } from '../src/expression-builder.js';
import { selectFrom } from '../src/select-query-builder.js';
import type {
	ArrayOperators,
	ComparableOperators,
	NumberKind,
	OperatorsByKind,
	TextKind,
	TextOperators,
} from '../src/operators.js';

type BigIntType = DataType<'bigint'>;
type BooleanType = DataType<'boolean'>;
type IntegerType = DataType<'integer'>;
type TextType = DataType<'text'>;

const status = defineEnum('status', ['active', 'inactive']);

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		firstName: text().name('first_name'),
		email: text().nullable(),
		admin: boolean(),
		age: integer(),
		score: integer().nullable(),
		tags: array(text()),
		status: status(),
		createdAt: timestamptz().name('created_at'),
	},
});

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		authorId: integer().name('author_id'),
	},
});

const eb = expressionBuilder(users);

describe('comparison operators', () => {
	it('only admits operators of the column type', () => {
		eb('users.firstName', 'like', '%a%');
		eb('users.firstName', '>', 'M');
		eb('users.age', 'between', [18, 65]);
		eb('users.tags', '@>', ['a']);

		// @ts-expect-error integers have no pattern operators
		eb('users.age', 'like', '1%');
		// @ts-expect-error enums have no ordering operators
		eb('users.status', '<', 'active');
		// @ts-expect-error scalars have no array operators
		eb('users.age', '&&', [1]);
	});

	it('types the value from the column and operator', () => {
		eb('users.age', '=', 1);
		eb('users.status', '=', 'active');
		eb('users.status', 'in', ['active', 'inactive']);

		// @ts-expect-error wrong scalar type
		eb('users.age', '=', '1');
		// @ts-expect-error not a member of the enum
		eb('users.status', '=', 'deleted');
		// @ts-expect-error `in` takes a list
		eb('users.age', 'in', 1);
		// @ts-expect-error `between` takes a pair
		eb('users.age', 'between', [1]);
		// @ts-expect-error not an operator: `any` goes on the right
		eb('users.tags', '= any', 'a');
	});

	it('only allows null through `is`', () => {
		eb('users.email', 'is', null);
		eb('users.email', 'is not', null);
		eb('users.admin', 'is', true);

		// @ts-expect-error `= null` is never true
		eb('users.email', '=', null);
		// @ts-expect-error `is` on a non-boolean column only takes null
		eb('users.email', 'is', 'x');
		// @ts-expect-error postgres takes only a keyword after `is`
		eb('users.email', 'is', eb.val(null));
		// @ts-expect-error postgres takes only a keyword after `is not`
		eb('users.admin', 'is not', eb('users.admin', '=', true));
	});

	it('accepts an expression of the value type, nullable or not', () => {
		eb('users.age', '=', eb.ref('users.id'));
		eb('users.age', '=', eb.ref('users.score'));
		eb('users.age', '=', eb.val(1));

		// @ts-expect-error reference is a string column
		eb('users.age', '=', eb.ref('users.firstName'));
	});

	it('rejects references outside the scope', () => {
		// @ts-expect-error unknown column
		eb('users.nope', '=', 1);
		// @ts-expect-error posts is not in scope
		eb('posts.id', '=', 1);
		// @ts-expect-error no bare column names
		eb('age', '=', 1);
	});

	it('is a boolean of SQL type boolean', () => {
		const predicate = eb('users.age', '=', 1);
		expectTypeOf(predicate.$type).toEqualTypeOf<boolean>();
		expectTypeOf(predicate.dataType).toEqualTypeOf<BooleanType>();
	});

	it('is nullable when either operand is', () => {
		expectTypeOf(eb('users.email', '=', 'x').$type).toEqualTypeOf<
			boolean | null
		>();
		expectTypeOf(eb('users.email', 'like', 'x%').$type).toEqualTypeOf<
			boolean | null
		>();
		expectTypeOf(
			eb('users.age', '=', eb.ref('users.score')).$type,
		).toEqualTypeOf<boolean | null>();
		// nullability lives on the type, not the SQL type
		expectTypeOf(
			eb('users.email', '=', 'x').dataType,
		).toEqualTypeOf<BooleanType>();
	});

	it('is never null for the null-safe operators', () => {
		expectTypeOf(eb('users.email', 'is', null).$type).toEqualTypeOf<boolean>();
		expectTypeOf(
			eb('users.email', 'is not', null).$type,
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			eb('users.email', 'is distinct from', eb.ref('users.email')).$type,
		).toEqualTypeOf<boolean>();
	});
});

describe('right-hand operands', () => {
	const things = defineTable('things', {
		columns: {
			name: text(),
			nickname: varchar(),
			token: uuid(),
			age: integer(),
			minAge: integer(),
			score: integer().nullable(),
			ratio: real(),
			tags: array(text()),
			aliases: array(text()).nullable(),
			labels: array(text().nullable()),
			tokens: array(uuid()),
			limits: array(integer()),
			documents: array(jsonb()),
			settings: jsonb(),
			active: tstzrange(),
			createdAt: timestamptz(),
		},
	});
	const tb = expressionBuilder(things);

	it('take expressions as list items and pair bounds', () => {
		tb('things.age', 'in', [18, tb.ref('things.minAge')]);
		tb('things.age', 'not in', [tb.ref('things.minAge')]);
		tb('things.age', 'between', [tb.ref('things.minAge'), 65]);

		// @ts-expect-error a list item is still checked
		tb('things.age', 'in', [18, tb.ref('things.name')]);
		// @ts-expect-error a bound is still checked
		tb('things.age', 'between', [tb.ref('things.token'), 65]);
	});

	it('accept an expression of a SQL type postgres compares with', () => {
		tb('things.name', '=', tb.ref('things.nickname'));
		tb('things.nickname', '<', tb.ref('things.name'));
		tb('things.age', '<', tb.ref('things.ratio'));
		tb('things.name', 'like', tb.fn.concat('things.nickname', tb.val('%')));

		// @ts-expect-error text = bigint, although both are strings
		tb('things.name', '=', tb.fn.count());
		// @ts-expect-error text = uuid, although both are strings
		tb('things.name', '=', tb.ref('things.token'));
		// @ts-expect-error a uuid is not a pattern
		tb('things.name', 'like', tb.ref('things.token'));
		// @ts-expect-error nor an item of a list of text
		tb('things.name', 'in', ['a', tb.ref('things.token')]);
	});

	it('check array expressions by their element type', () => {
		tb('things.tags', '&&', tb.ref('things.tags'));
		tb('things.name', 'in', tb.ref('things.tags'));
		tb('things.nickname', '=', tb.fn.any('things.tags'));

		// @ts-expect-error text[] @> uuid[]
		tb('things.tags', '@>', tb.ref('things.tokens'));
		// @ts-expect-error text in uuid[]
		tb('things.name', 'in', tb.ref('things.tokens'));
		// @ts-expect-error a uuid is not an element of text[]
		tb('things.token', '=', tb.fn.any('things.tags'));
	});

	it('compare a parameter with the elements of an array', () => {
		tb(tb.val('a'), '=', tb.fn.any('things.tags'));
		tb(tb.val('a'), '<>', tb.fn.all(tb.ref('things.aliases')));
		tb(tb.val('a%'), 'like', tb.fn.any('things.tags'));
		tb(tb.val(5), '<', tb.fn.all('things.limits'));
		tb(tb.val({ a: 1 }), '@>', tb.fn.any('things.documents'));
		tb(tb.val('a'), '=', tb.fn.any(tb.fn.coalesce('things.tags', tb.val([]))));

		// the operator and the parameter's type are not checked against the
		// elements yet
		tb(tb.val(1), 'like', tb.fn.any('things.tags'));

		// @ts-expect-error a plain value would read as a reference
		tb('a', '=', tb.fn.any('things.tags'));
		// @ts-expect-error a parameter needs `any` or `all` on the right
		tb(tb.val('a'), '=', 'a');
		// @ts-expect-error `in` takes a list, not `any` / `all`
		tb(tb.val('a'), 'in', tb.fn.any('things.tags'));
		// @ts-expect-error nor does an operator whose operand is an array
		tb(tb.val('a'), '?|', tb.fn.any('things.tags'));
	});

	it('are nullable when the parameter, the array or an element is', () => {
		expectTypeOf(
			tb(tb.val('a'), '=', tb.fn.any('things.tags')).$type,
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			tb(tb.val('a'), '=', tb.fn.any('things.aliases')).$type,
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(
			tb(tb.val('a'), '=', tb.fn.any('things.labels')).$type,
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(
			tb(tb.val(null), '=', tb.fn.any('things.tags')).$type,
		).toEqualTypeOf<boolean | null>();
	});

	it('take a parameter on the left in where clauses too', () => {
		selectFrom(things).where(tb.val('a'), '=', tb.fn.any('things.tags'));
		selectFrom(things).where((q) =>
			q.where(q.val('a'), '<>', q.fn.all('things.tags')),
		);
		// @ts-expect-error a parameter needs `any` or `all` on the right
		selectFrom(things).where(tb.val('a'), '=', 'a');
	});

	it('take the operand type of operators on other types', () => {
		tb('things.active', '@>', tb.ref('things.createdAt'));
	});

	it('leave jsonb key and path tests to `eb.json`', () => {
		tb('things.settings', '@>', { theme: 'dark' });
		tb('things.settings', '<@', ['a']);

		// @ts-expect-error `eb.json.hasKey`
		tb('things.settings', '?', 'theme');
		// @ts-expect-error `eb.json.hasAnyKey`
		tb('things.settings', '?|', ['a']);
		// @ts-expect-error `eb.json.pathExists`
		tb('things.settings', '@?', '$.theme');
		// @ts-expect-error null is SQL null, never contained
		tb('things.settings', '@>', null);
	});

	it('take parameters wherever they take a value', () => {
		tb('things.age', '=', tb.val(1));
		tb('things.age', 'in', tb.val([1, 2]));
		tb('things.age', 'in', [1, tb.val(2)]);
		tb('things.age', 'between', [tb.val(1), 2]);

		// @ts-expect-error a parameter of the wrong type
		tb('things.age', '=', tb.val('1'));
	});

	it('take `any` / `all` wherever an operator takes one operand', () => {
		tb('things.name', 'like', tb.fn.any(['a%', 'b%']));
		tb('things.name', 'not ilike', tb.fn.all(['a%']));
		tb('things.name', '=', tb.fn.any('things.tags'));
		tb('things.name', '=', tb.fn.any(tb.ref('things.aliases')));
		tb('things.age', '>', tb.fn.any(tb.val([1, 2])));
		tb('things.age', '<=', tb.fn.all('things.limits'));
		tb('things.settings', '@>', tb.fn.any([{ theme: 'dark' }]));
		tb('things.active', '@>', tb.fn.any([new Date()]));
		eb('users.status', '=', eb.fn.any(['active', 'inactive']));

		// @ts-expect-error the elements are checked against the operand type
		tb('things.age', '>', tb.fn.any(['1']));
		// @ts-expect-error nor an element of a list of text
		tb('things.name', '=', tb.fn.any('things.tokens'));
		// @ts-expect-error not a member of the enum
		eb('users.status', '=', eb.fn.any(['deleted']));
		// @ts-expect-error a value is not null
		tb('things.name', '=', tb.fn.any(['a', null]));
		// @ts-expect-error `any` takes an array
		tb('things.name', '=', tb.fn.any('things.name'));
	});

	it('take `any` / `all` only where postgres does', () => {
		// @ts-expect-error not an operator
		tb('things.name', 'is distinct from', tb.fn.any(['a']));
		// @ts-expect-error `in` takes a list
		tb('things.name', 'in', tb.fn.any(['a']));
		// @ts-expect-error `between` takes a pair
		tb('things.age', 'between', [tb.fn.any([1]), 2]);
		// @ts-expect-error the operand is an array, and arrays hold no arrays
		tb('things.tags', '@>', tb.fn.any([['a']]));
		// @ts-expect-error nor for equality
		tb('things.tags', '=', tb.fn.any([['a']]));
		// @ts-expect-error nor for containment of jsonb arrays held in arrays
		tb('things.documents', '@>', tb.fn.any([[{ a: 1 }]]));
		// @ts-expect-error not an expression
		tb.fn.lower(tb.fn.any(['a']));
		// @ts-expect-error nor a predicate
		tb.and([tb.fn.any([true])]);
	});

	it('are nullable when the array given to `any` / `all` or an element is', () => {
		expectTypeOf(
			tb('things.name', '=', tb.fn.any(['a'])).$type,
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			tb('things.name', '=', tb.fn.any('things.tags')).$type,
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			tb('things.name', '=', tb.fn.any('things.aliases')).$type,
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(
			tb('things.name', '=', tb.fn.all('things.labels')).$type,
		).toEqualTypeOf<boolean | null>();
	});

	it('are nullable when an item of a list or pair is', () => {
		expectTypeOf(tb('things.age', 'in', [1, 2]).$type).toEqualTypeOf<boolean>();
		expectTypeOf(
			tb('things.age', 'in', [1, tb.ref('things.score')]).$type,
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(
			tb('things.age', 'between', [tb.ref('things.score'), 2]).$type,
		).toEqualTypeOf<boolean | null>();
	});
});

describe('expressions on the left', () => {
	const lower = eb.fn.lower('users.firstName');

	it('take the operators of the expression', () => {
		eb(lower, 'like', 'a%');
		eb(lower, '=', 'ada');
		eb(eb.ref('users.age'), 'between', [18, 65]);
		eb(eb('users.age', '>', 18), 'is', true);
		eb(eb('users.email', '=', 'x'), 'is', true);

		// @ts-expect-error integers have no pattern operators
		eb(eb.ref('users.age'), 'like', '1%');
	});

	it('type the value from the expression and operator', () => {
		eb(lower, 'in', ['a', 'b']);
		eb(lower, 'in', eb.ref('users.tags'));
		eb(eb.ref('users.age'), '=', eb.ref('users.id'));

		// @ts-expect-error wrong scalar type
		eb(lower, '=', 1);
		// @ts-expect-error `in` takes a list
		eb(lower, 'in', 'a');
		// @ts-expect-error `in` takes an array expression, not a scalar one
		eb(lower, 'in', eb.ref('users.firstName'));
		// @ts-expect-error reference is a string column
		eb(eb.ref('users.age'), '=', eb.ref('users.firstName'));
	});

	it('reject expressions of unknown SQL type', () => {
		// @ts-expect-error a parameter has no SQL type
		eb(eb.val(1), '=', 1);
	});
});

describe('jsonb functions', () => {
	type Profile = {
		address: { city: string; zip?: string };
		tags: string[];
	};
	const docs = defineTable('docs', {
		columns: {
			name: text(),
			token: uuid(),
			keys: array(text()),
			profile: jsonb<Profile>(),
			extra: jsonb<Profile>().nullable(),
			data: jsonb(),
		},
	});
	const db = expressionBuilder(docs);

	it('type a field or path from the column', () => {
		expectTypeOf(db.json.get('docs.profile', 'address').$type).toEqualTypeOf<{
			city: string;
			zip?: string;
		} | null>();
		expectTypeOf(
			db.json.get('docs.profile', 'address', 'zip').$type,
		).toEqualTypeOf<string | null>();
		expectTypeOf(db.json.get('docs.profile', 'tags', 0).$type).toEqualTypeOf<
			string | null
		>();
		expectTypeOf(
			db.json.text('docs.profile', 'address', 'city').$type,
		).toEqualTypeOf<string | null>();
		expectTypeOf(
			db.json.get('docs.profile', 'tags').dataType,
		).toEqualTypeOf<JsonbType>();
		expectTypeOf(db.json.text('docs.profile', 'tags').dataType).toEqualTypeOf<
			DataType<'text'>
		>();
	});

	it('check each key against the value it indexes', () => {
		// @ts-expect-error not a key of the profile
		db.json.get('docs.profile', 'nope');
		// @ts-expect-error nor of the address
		db.json.text('docs.profile', 'address', 'street');
		// @ts-expect-error an array takes an index
		db.json.get('docs.profile', 'tags', 'first');
		// @ts-expect-error a path has at least one key
		db.json.get('docs.profile');
		// @ts-expect-error only jsonb has fields
		db.json.get('docs.name', 'a');
	});

	it('take any path into an untyped column', () => {
		db.json.get('docs.data', 'a', 0, 'b');
		db.json.text('docs.data', 'a');
	});

	it('compare a field by its SQL type', () => {
		db(db.json.text('docs.profile', 'address', 'city'), 'ilike', 'os%');
		db(db.json.get('docs.profile', 'address'), '@>', { city: 'Oslo' });
		db(db.fn.cast(db.json.text('docs.data', 'age'), 'integer'), '>', 18);
		db(db.json.length(db.json.get('docs.profile', 'tags')), '>', 2);

		// @ts-expect-error text has no containment
		db(db.json.text('docs.profile', 'address'), '@>', 'a');
	});

	it('test keys and jsonpaths as predicates', () => {
		db.json.hasKey('docs.profile', 'tags');
		db.json.hasKey('docs.profile', db.ref('docs.name'));
		db.json.hasAnyKey('docs.profile', ['tags', 'address']);
		db.json.hasAllKeys('docs.profile', db.ref('docs.keys'));
		db.json.pathExists('docs.data', '$.tags[*]');
		db.json.pathMatches('docs.data', db.val('$.n > 1'));
		selectFrom(docs).where(db.json.hasKey('docs.profile', 'tags'));
		selectFrom(docs).where((q) => q.where(q.json.hasKey('docs.data', 'a')));

		// @ts-expect-error a key is text, not a uuid
		db.json.hasKey('docs.profile', db.ref('docs.token'));
		// @ts-expect-error a key list is text[]
		db.json.hasAnyKey('docs.profile', 'tags');
		// @ts-expect-error a jsonpath is a string
		db.json.pathExists('docs.data', 1);
	});

	it('are nullable when the column, a key or the result can be', () => {
		expectTypeOf(
			db.json.hasKey('docs.profile', 'tags').$type,
		).toEqualTypeOf<boolean>();
		expectTypeOf(db.json.hasKey('docs.extra', 'tags').$type).toEqualTypeOf<
			boolean | null
		>();
		expectTypeOf(
			db.json.pathMatches('docs.data', '$.n > 1').$type,
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(db.json.typeOf('docs.profile').$type).toEqualTypeOf<
			'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
		>();
		expectTypeOf(db.json.length('docs.extra').$type).toEqualTypeOf<
			number | null
		>();
	});
});

describe('functions', () => {
	it('only accept arguments of the right SQL type', () => {
		eb.fn.lower('users.firstName');
		eb.fn.lower(eb.fn.upper('users.email'));
		eb.fn.max('users.createdAt');
		eb.fn.max('users.firstName');
		eb.fn.min('users.createdAt');
		eb.fn.min('users.firstName');
		eb.fn.count('users.tags');

		// @ts-expect-error integers are not text
		eb.fn.lower('users.age');
		// @ts-expect-error enums are not text
		eb.fn.lower('users.status');
		// @ts-expect-error enums have no ordering
		eb.fn.max('users.status');
		// @ts-expect-error enums have no ordering
		eb.fn.min('users.status');
		// @ts-expect-error a parameter has no SQL type
		eb.fn.lower(eb.val('a'));
		// @ts-expect-error out of scope
		eb.fn.lower('posts.title');
	});

	it('type the result from the arguments', () => {
		expectTypeOf(eb.fn.lower('users.firstName').$type).toEqualTypeOf<string>();
		expectTypeOf(eb.fn.lower('users.email').$type).toEqualTypeOf<
			string | null
		>();
		expectTypeOf(eb.fn.length('users.email').$type).toEqualTypeOf<
			number | null
		>();
		expectTypeOf(eb.fn.max('users.age').$type).toEqualTypeOf<number | null>();
		expectTypeOf(eb.fn.min('users.age').$type).toEqualTypeOf<number | null>();
		expectTypeOf(eb.fn.count().$type).toEqualTypeOf<string>();
		expectTypeOf(eb.fn.now().$type).toEqualTypeOf<Date>();
		expectTypeOf(
			eb.fn.concat('users.email', eb.val(' '), 'users.age').$type,
		).toEqualTypeOf<string>();
	});

	it('give the result its SQL type', () => {
		expectTypeOf(eb.fn.lower('users.email').dataType).toEqualTypeOf<TextType>();
		expectTypeOf(eb.fn.count().dataType).toEqualTypeOf<BigIntType>();
		expectTypeOf(
			eb.fn.coalesce('users.email', eb.val('')).dataType,
		).toEqualTypeOf<TextType>();
		expectTypeOf(eb.fn.max('users.age').dataType).toEqualTypeOf<IntegerType>();
		expectTypeOf(
			eb.fn.min('users.firstName').dataType,
		).toEqualTypeOf<TextType>();
	});

	it('types coalesce from its last argument', () => {
		expectTypeOf(
			eb.fn.coalesce('users.email', 'users.firstName').$type,
		).toEqualTypeOf<string>();
		expectTypeOf(
			eb.fn.coalesce('users.email', eb.val('')).$type,
		).toEqualTypeOf<string>();
		expectTypeOf(
			eb.fn.coalesce('users.email', eb.val(null)).$type,
		).toEqualTypeOf<string | null>();
		expectTypeOf(
			eb.fn.coalesce('users.email', eb.val(null), 'users.email').$type,
		).toEqualTypeOf<string | null>();

		// @ts-expect-error fallbacks share the first argument's SQL type
		eb.fn.coalesce('users.email', 'users.age');
		// @ts-expect-error a value fallback must be of the first argument's type
		eb.fn.coalesce('users.email', eb.val(1));
		// @ts-expect-error at least one fallback is required
		eb.fn.coalesce('users.email');
	});

	it('types cast from the target, preserving null', () => {
		const count = eb.fn.cast(eb.fn.count(), 'integer');
		expectTypeOf(count.$type).toEqualTypeOf<number>();
		expectTypeOf(count.dataType).toEqualTypeOf<IntegerType>();
		eb(count, '>', 5);

		expectTypeOf(eb.fn.cast('users.email', 'uuid').$type).toEqualTypeOf<
			string | null
		>();
		expectTypeOf(eb.fn.cast('users.age', 'text').$type).toEqualTypeOf<string>();
		eb(eb.fn.cast('users.age', 'text'), 'like', '1%');

		// @ts-expect-error not a castable type
		eb.fn.cast('users.age', 'money');
		// @ts-expect-error integers have no pattern operators
		eb(eb.fn.cast('users.firstName', 'integer'), 'like', '1%');
	});
});

describe('references and values', () => {
	it('types a reference from the column', () => {
		expectTypeOf(eb.ref('users.age').$type).toEqualTypeOf<number>();
		expectTypeOf(eb.ref('users.email').$type).toEqualTypeOf<string | null>();
		expectTypeOf(eb.ref('users.status').$type).toEqualTypeOf<
			'active' | 'inactive'
		>();
		expectTypeOf(eb.ref('users.createdAt').$type).toEqualTypeOf<Date>();
	});

	it('gives a reference the SQL type of its column', () => {
		// a nullable column has the same SQL type
		expectTypeOf(eb.ref('users.email').dataType).toEqualTypeOf<TextType>();
		expectTypeOf(eb.ref('users.age').dataType).toEqualTypeOf<IntegerType>();
		expectTypeOf(eb.ref('users.status').dataType).toEqualTypeOf<EnumType>();
	});

	it('gives a value no SQL type', () => {
		expectTypeOf(eb.val(1)).not.toExtend<TypedExpression<1, DataType>>();
	});

	it('types arrays by element, so they fit array positions', () => {
		expectTypeOf(eb.val(['a']).$type).toEqualTypeOf<string[]>();
		expectTypeOf(eb.val([]).$type).toEqualTypeOf<never[]>();
		eb('users.tags', '&&', eb.val(['a']));
		eb.fn.coalesce('users.tags', eb.val([]));
	});

	it('keeps literal types for everything else', () => {
		expectTypeOf(eb.val({ empty: true }).$type).toEqualTypeOf<{
			readonly empty: true;
		}>();
		eb('users.status', '=', eb.val('active'));
		// @ts-expect-error not a member of the enum
		eb('users.status', '=', eb.val('deleted'));
	});

	it('types a value literally', () => {
		expectTypeOf(eb.val('x').$type).toEqualTypeOf<'x'>();
		expectTypeOf(eb.val(1).$type).toEqualTypeOf<1>();
	});
});

describe('logical operators', () => {
	it('only accept boolean expressions', () => {
		eb.and([eb('users.age', '=', 1), eb.val(true)]);
		eb.not(eb.or([]));

		eb.not(eb.ref('users.admin'));

		// @ts-expect-error a string reference is not a predicate
		eb.and([eb.ref('users.firstName')]);
		// @ts-expect-error neither is a nullable string
		eb.not(eb.ref('users.email'));
	});

	it('are nullable if any operand is', () => {
		expectTypeOf(eb.and([]).$type).toEqualTypeOf<boolean>();
		expectTypeOf(
			eb.and([eb('users.age', '=', 1)]).$type,
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			eb.or([eb('users.age', '=', 1), eb('users.email', '=', 'x')]).$type,
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(eb.not(eb('users.email', '=', 'x')).$type).toEqualTypeOf<
			boolean | null
		>();
		expectTypeOf(
			eb.not(eb('users.email', 'is', null)).$type,
		).toEqualTypeOf<boolean>();
	});
});

describe('expression typing', () => {
	it('is covariant in T', () => {
		const s = eb.ref('users.firstName');
		expectTypeOf(s).toExtend<Expression<string>>();
		expectTypeOf(s).toExtend<Expression<string | null>>();
		expectTypeOf(s).not.toExtend<Expression<number>>();
		expectTypeOf(eb.ref('users.email')).not.toExtend<Expression<string>>();
	});

	it('satisfies Expression<T> whatever its SQL type', () => {
		expectTypeOf(eb.ref('users.age')).toExtend<Expression<number>>();
		expectTypeOf(eb('users.age', '=', 1)).toExtend<Expression<boolean>>();
		expectTypeOf(eb.val(true)).toExtend<Expression<boolean>>();
		expectTypeOf(eb.ref('users.age')).toExtend<
			TypedExpression<number, IntegerType>
		>();
		expectTypeOf(eb.ref('users.age')).not.toExtend<
			TypedExpression<number, TextType>
		>();
	});

	it('gives aliases their literal name', () => {
		const aliased = eb.fn.lower('users.firstName').as('lower_name');
		expectTypeOf(aliased.alias).toEqualTypeOf<'lower_name'>();
		expectTypeOf(aliased.expression.$type).toEqualTypeOf<string>();
	});
});

describe('columns and data types', () => {
	it('keep the SQL type through nullability and narrowing', () => {
		expectTypeOf(text().nullable()).toEqualTypeOf<
			Column<TextType, string | null, string | null, string | null>
		>();
		expectTypeOf(text().as<'a' | 'b', 'a', never>()).toEqualTypeOf<
			Column<TextType, 'a' | 'b', 'a', never>
		>();
	});

	it('agree on how each SQL type is represented, wherever it is created', () => {
		expectTypeOf(bigint()).toEqualTypeOf<IntegerColumn<BigIntType, string>>();
		expectTypeOf(eb.fn.count().$type).toEqualTypeOf<string>();
		expectTypeOf(
			eb.fn.cast('users.age', 'bigint').$type,
		).toEqualTypeOf<string>();

		expectTypeOf(integer().$select).toEqualTypeOf<number>();
		expectTypeOf(eb.fn.length('users.firstName').$type).toEqualTypeOf<number>();
		expectTypeOf(
			eb.fn.cast('users.firstName', 'integer').$type,
		).toEqualTypeOf<number>();

		expectTypeOf(text().$select).toEqualTypeOf<string>();
		expectTypeOf(eb.fn.lower('users.firstName').$type).toEqualTypeOf<string>();
		expectTypeOf(eb.fn.cast('users.age', 'text').$type).toEqualTypeOf<string>();

		expectTypeOf(timestamptz().$select).toEqualTypeOf<Date>();
		expectTypeOf(eb.fn.now().$type).toEqualTypeOf<Date>();
		expectTypeOf(
			eb.fn.cast('users.age', 'timestamptz').$type,
		).toEqualTypeOf<Date>();

		expectTypeOf(boolean().$select).toEqualTypeOf<boolean>();
		expectTypeOf(eb('users.age', '=', 1).$type).toEqualTypeOf<boolean>();
		expectTypeOf(
			eb.fn.cast('users.age', 'boolean').$type,
		).toEqualTypeOf<boolean>();

		// @ts-expect-error a bigint column's values are strings
		bigint<1n>();
	});

	it('derive operators from the SQL type at the value type', () => {
		expectTypeOf<OperatorsByKind<'a' | 'b', TextType>['text']>().toEqualTypeOf<
			TextOperators<'a' | 'b', DataType<TextKind>>
		>();
		expectTypeOf<
			OperatorsByKind<number, IntegerType>['integer']
		>().toEqualTypeOf<ComparableOperators<number, DataType<NumberKind>>>();
	});

	it('only allow integer identities', () => {
		expectTypeOf(integer().identity()).toEqualTypeOf<
			IdentityColumn<IntegerType, number, never, never>
		>();
		// @ts-expect-error only the integer types can be identities
		text().identity();
	});

	it('only offer the modifiers still valid after each one', () => {
		type NullableDefault = DefaultColumn<
			TextType,
			string | null,
			string | null | undefined,
			string | null
		>;
		expectTypeOf(text().default().nullable()).toEqualTypeOf<NullableDefault>();
		expectTypeOf(text().nullable().default()).toEqualTypeOf<NullableDefault>();
		expectTypeOf(text().nullable().generated()).toEqualTypeOf<
			GeneratedColumn<TextType, string | null, never, never>
		>();
		// a generated column stays unwritable when made nullable
		expectTypeOf(text().generated().nullable()).toEqualTypeOf<
			GeneratedColumn<TextType, string | null, never, never>
		>();

		// repeating a modifier is a no-op
		expectTypeOf(text().nullable().nullable()).toEqualTypeOf<
			Column<TextType, string | null, string | null, string | null>
		>();
		expectTypeOf(
			text().default().nullable().default(),
		).toEqualTypeOf<NullableDefault>();

		// @ts-expect-error a default and a generated value exclude each other
		text().default().generated();
		// @ts-expect-error a default and a generated value exclude each other
		text().generated().default();
		// @ts-expect-error a default and a generated value exclude each other
		text().nullable().default().generated();
	});

	it('only allow identity() on a fresh integer, and nothing after it', () => {
		type UserId = number & { readonly brand: 'user' };
		expectTypeOf(
			integer().as<UserId, UserId, UserId>().identity(),
		).toEqualTypeOf<IdentityColumn<IntegerType, UserId, never, never>>();
		expectTypeOf(integer().identity().as<UserId>()).toEqualTypeOf<
			IdentityColumn<IntegerType, UserId, never, never>
		>();
		expectTypeOf(bigint().nullable()).toEqualTypeOf<
			Column<BigIntType, string | null, string | null, string | null>
		>();

		// @ts-expect-error an identity is never null
		integer().nullable().identity();
		// @ts-expect-error an identity has no default
		integer().default().identity();
		// @ts-expect-error an identity is not also generated
		integer().generated().identity();
		// @ts-expect-error nothing applies after identity
		integer().identity().nullable();
		// @ts-expect-error nor after narrowing it
		integer().identity().as<number>().default();
	});

	it('keep the state when named', () => {
		expectTypeOf(text().name('a')).toEqualTypeOf<Column<TextType, string>>();
		expectTypeOf(integer().name('a')).toEqualTypeOf<
			IntegerColumn<IntegerType, number>
		>();
		expectTypeOf(text().nullable().name('a')).toEqualTypeOf<
			Column<TextType, string | null, string | null, string | null>
		>();
		expectTypeOf(text().default().name('a')).toEqualTypeOf<
			DefaultColumn<TextType, string, string | undefined, string>
		>();
		expectTypeOf(text().generated().name('a')).toEqualTypeOf<
			GeneratedColumn<TextType, string, never, never>
		>();
		expectTypeOf(integer().name('a').identity()).toEqualTypeOf<
			IdentityColumn<IntegerType, number, never, never>
		>();
		expectTypeOf(integer().identity().name('a')).toEqualTypeOf<
			IdentityColumn<IntegerType, number, never, never>
		>();
		expectTypeOf(array(text()).name('a')).toEqualTypeOf<
			Column<ArrayType<TextType>, string[]>
		>();
		// @ts-expect-error a default and a generated value exclude each other
		text().generated().name('a').default();
		// @ts-expect-error nothing applies after identity
		integer().identity().name('a').nullable();
	});

	it('keep a default optional on insert when narrowed', () => {
		type Email = string & { readonly brand: 'email' };
		expectTypeOf(
			text().default().as<Email, Email | undefined, Email>().$insert,
		).toEqualTypeOf<Email | undefined>();
	});

	it('only narrow with as(), in every state', () => {
		type UserId = number & { readonly brand: 'user' };
		expectTypeOf(
			text().nullable().as<string | null, string | null, string>(),
		).toEqualTypeOf<Column<TextType, string | null, string | null, string>>();
		expectTypeOf(
			text().default().as<'a', 'a', 'a'>().$insert,
		).toEqualTypeOf<'a'>();
		expectTypeOf(integer().identity().as<UserId>()).toEqualTypeOf<
			IdentityColumn<IntegerType, UserId, never, never>
		>();

		// @ts-expect-error the select type can't change the SQL type's values
		text().as<number, number, number>();
		// @ts-expect-error nor in any state
		integer().identity().as<string>();
		// @ts-expect-error nor widen them
		array(text()).as<readonly string[], string[], string[]>();
		// @ts-expect-error a write must be a value of the column
		timestamptz().as<Date, string, never>();
		// @ts-expect-error and selectable once written
		text().as<'a', string, string>();
		// @ts-expect-error a column without a default can't be omitted
		text().as<string, string | undefined, string>();
		// @ts-expect-error a generated column takes only a select type
		text().generated().as<string, string, never>();
		// @ts-expect-error an identity takes only a select type
		integer().identity().as<number, number, never>();
		expectTypeOf(text().generated().nullable().as<'a' | null>()).toEqualTypeOf<
			GeneratedColumn<TextType, 'a' | null, never, never>
		>();
	});

	it('give the types that encode values their own class', () => {
		expectTypeOf(jsonb().dataType).toEqualTypeOf<JsonbType>();
		expectTypeOf(tstzrange().dataType).toEqualTypeOf<TstzRangeType>();
		expectTypeOf(vector().dataType).toEqualTypeOf<VectorType>();
		// a plain jsonb data type would skip the JSON encoding
		expectTypeOf<DataType<'jsonb'>>().not.toExtend<JsonbType>();
		expectTypeOf<JsonbType>().toExtend<DataType<'jsonb'>>();
	});

	it('type arrays by their element', () => {
		expectTypeOf(array(text())).toEqualTypeOf<
			Column<ArrayType<TextType>, string[]>
		>();
		expectTypeOf(array(text()).nullable().$select).toEqualTypeOf<
			string[] | null
		>();
		expectTypeOf(array(status()).$select).toEqualTypeOf<
			('active' | 'inactive')[]
		>();
		expectTypeOf(array(integer<1 | 2>()).$select).toEqualTypeOf<(1 | 2)[]>();
		expectTypeOf<
			OperatorsByKind<string[], ArrayType<TextType>>['array']
		>().toEqualTypeOf<ArrayOperators<string[], DataType<TextKind>>>();
	});

	it('type elements as nullable only when the element column is', () => {
		expectTypeOf(array(text().nullable())).toEqualTypeOf<
			Column<ArrayType<TextType>, (string | null)[]>
		>();
		expectTypeOf(array(text().nullable()).nullable().$select).toEqualTypeOf<
			(string | null)[] | null
		>();
		expectTypeOf(
			array(text().nullable().as<'a' | null, 'a' | null, 'a' | null>()).$select,
		).toEqualTypeOf<('a' | null)[]>();
	});

	it('only take a fresh or nullable column as the element', () => {
		// @ts-expect-error postgres has no arrays of arrays
		array(array(text()));
		// @ts-expect-error nor of nullable arrays
		array(array(text()).nullable());
		// @ts-expect-error a default belongs to the array column
		array(text().default());
		// @ts-expect-error a generated value belongs to the array column
		array(text().generated());
		// @ts-expect-error an identity is not an element
		array(integer().identity());
		// @ts-expect-error identity() is not offered on an array
		array(integer()).identity();

		array(text()).default();
		array(text()).nullable().generated();
	});
});

describe('scope', () => {
	it('merges the refs of every table', () => {
		const scoped = expressionBuilder(users, posts);
		scoped('posts.authorId', '=', scoped.ref('users.id'));
		expectTypeOf(scoped.ref('posts.authorId').$type).toEqualTypeOf<number>();
	});

	it('keys aliased tables by their alias', () => {
		const scoped = expressionBuilder(users.as('u'));
		scoped('u.firstName', '=', 'Ada');
		// @ts-expect-error the original name is no longer in scope
		scoped('users.firstName', '=', 'Ada');
	});
});
