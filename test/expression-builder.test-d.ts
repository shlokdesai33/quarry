import { describe, expectTypeOf, it } from 'vitest';
import type { Column } from '../src/column/column.js';
import type { DefaultColumn } from '../src/column/default-column.js';
import type { GeneratedColumn } from '../src/column/generated-column.js';
import type { IdentityColumn } from '../src/column/identity-column.js';
import type { IntegerColumn } from '../src/column/integer-column.js';
import type { NullableColumn } from '../src/column/nullable-column.js';
import type { ArrayColumn } from '../src/column/array-column.js';
import type { ArrayType } from '../src/data-type/array.js';
import type { BooleanType } from '../src/data-type/boolean.js';
import type { TextType } from '../src/data-type/character.js';
import type { DataType, OperatorsFor } from '../src/data-type/data-type.js';
import type { TimestampTzType } from '../src/data-type/datetime.js';
import type { EnumType } from '../src/data-type/enum.js';
import type { BigIntType, IntegerType } from '../src/data-type/numeric.js';
import {
	bigint,
	boolean,
	integer,
	text,
	timestamptz,
} from '../src/column-factories.js';
import { defineEnum } from '../src/define-enum.js';
import { defineTable } from '../src/define-table.js';
import type { Expression, TypedExpression } from '../src/expression.js';
import { expressionBuilder } from '../src/expression-builder.js';
import type {
	ArrayOperators,
	ComparableOperators,
	TextOperators,
} from '../src/operators.js';

const status = defineEnum('status', ['active', 'inactive']);

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		firstName: text('first_name'),
		email: text().nullable(),
		admin: boolean(),
		age: integer(),
		score: integer().nullable(),
		tags: text().array(),
		status: status(),
		createdAt: timestamptz('created_at'),
	},
});

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		authorId: integer('author_id'),
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
		eb('users.tags', '= any', 'a');

		// @ts-expect-error wrong scalar type
		eb('users.age', '=', '1');
		// @ts-expect-error not a member of the enum
		eb('users.status', '=', 'deleted');
		// @ts-expect-error `in` takes a list
		eb('users.age', 'in', 1);
		// @ts-expect-error `between` takes a pair
		eb('users.age', 'between', [1]);
		// @ts-expect-error `= any` takes an element, not an array
		eb('users.tags', '= any', ['a']);
	});

	it('only allows null through `is`', () => {
		eb('users.email', 'is', null);
		eb('users.email', 'is not', null);
		eb('users.admin', 'is', true);

		// @ts-expect-error `= null` is never true
		eb('users.email', '=', null);
		// @ts-expect-error `is` on a non-boolean column only takes null
		eb('users.email', 'is', 'x');
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
		eb(eb.ref('users.age'), '=', eb.ref('users.id'));

		// @ts-expect-error wrong scalar type
		eb(lower, '=', 1);
		// @ts-expect-error `in` takes a list
		eb(lower, 'in', 'a');
		// @ts-expect-error reference is a string column
		eb(eb.ref('users.age'), '=', eb.ref('users.firstName'));
	});

	it('reject expressions of unknown SQL type', () => {
		// @ts-expect-error a parameter has no SQL type
		eb(eb.val(1), '=', 1);
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
			NullableColumn<TextType, string | null, string | null, string | null>
		>();
		expectTypeOf(text().as<'a' | 'b', 'a', never>()).toEqualTypeOf<
			Column<TextType, 'a' | 'b', 'a', never>
		>();
	});

	it('record the native representation of each SQL type', () => {
		expectTypeOf<IntegerType['$native']>().toEqualTypeOf<number>();
		expectTypeOf<BigIntType['$native']>().toEqualTypeOf<string>();
		expectTypeOf<ArrayType<BigIntType>['$native']>().toEqualTypeOf<string[]>();
		expectTypeOf(bigint()).toEqualTypeOf<IntegerColumn<BigIntType, string>>();
		// @ts-expect-error a bigint column's values are strings
		bigint<1n>();
	});

	it('derive operators from the SQL type at the value type', () => {
		expectTypeOf<OperatorsFor<TextType, 'a' | 'b'>>().toEqualTypeOf<
			TextOperators<'a' | 'b'>
		>();
		expectTypeOf<OperatorsFor<IntegerType, number>>().toEqualTypeOf<
			ComparableOperators<number>
		>();
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
			NullableColumn<TextType, string | null, string | null, string | null>
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
			NullableColumn<BigIntType, string | null, string | null, string | null>
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

	it('keep a default optional on insert when narrowed', () => {
		type Email = string & { readonly brand: 'email' };
		expectTypeOf(
			text().default().as<Email, Email | undefined, Email>().$insert,
		).toEqualTypeOf<Email | undefined>();
	});

	it('take any types with as(), in every state', () => {
		expectTypeOf(text().as<number, number, number>()).toEqualTypeOf<
			Column<TextType, number, number, number>
		>();
		expectTypeOf(integer().as<string, string, string>()).toEqualTypeOf<
			IntegerColumn<IntegerType, string, string, string>
		>();
		expectTypeOf(timestamptz().as<Date, string, never>()).toEqualTypeOf<
			Column<TimestampTzType, Date, string, never>
		>();
		expectTypeOf(
			text()
				.array()
				.as<(string | null)[], (string | null)[], (string | null)[]>().$select,
		).toEqualTypeOf<(string | null)[]>();
		expectTypeOf(integer().identity().as<string>()).toEqualTypeOf<
			IdentityColumn<IntegerType, string, never, never>
		>();
		// @ts-expect-error a generated column takes only a select type
		text().generated().as<string, string, never>();
		// @ts-expect-error an identity takes only a select type
		integer().identity().as<number, number, never>();
		expectTypeOf(text().generated().nullable().as<'a' | null>()).toEqualTypeOf<
			GeneratedColumn<TextType, 'a' | null, never, never>
		>();
	});

	it('type arrays by their element', () => {
		expectTypeOf(text().array()).toEqualTypeOf<
			ArrayColumn<ArrayType<TextType>, string[]>
		>();
		expectTypeOf(text().array().nullable().$select).toEqualTypeOf<
			string[] | null
		>();
		expectTypeOf(status().array().$select).toEqualTypeOf<
			('active' | 'inactive')[]
		>();
		expectTypeOf(integer<1 | 2>().array().$select).toEqualTypeOf<(1 | 2)[]>();
		expectTypeOf<OperatorsFor<ArrayType<TextType>, string[]>>().toEqualTypeOf<
			ArrayOperators<string[]>
		>();
	});

	it('only offer array() where the column can still be an element', () => {
		// @ts-expect-error postgres has no arrays of arrays
		text().array().array();
		expectTypeOf(text().array().nullable()).toEqualTypeOf<
			ArrayColumn<
				ArrayType<TextType>,
				string[] | null,
				string[] | null,
				string[] | null
			>
		>();
		// @ts-expect-error nor after making the array nullable
		text().array().nullable().array();
		// @ts-expect-error elements are never nullable
		text().nullable().array();
		// @ts-expect-error nor after narrowing the nullable column
		text().nullable().as<'a' | null, 'a' | null, 'a' | null>().array();
		// @ts-expect-error a default belongs to the array column, after array()
		text().default().array();
		// @ts-expect-error a generated value belongs to the array column
		text().generated().array();
		// @ts-expect-error an identity is not an element
		integer().identity().array();
		// @ts-expect-error identity() is not offered on an array
		integer().array().identity();

		text().array().default();
		text().array().nullable().generated();
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
