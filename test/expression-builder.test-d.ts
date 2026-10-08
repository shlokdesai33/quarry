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
	date,
	decimal,
	integer,
	jsonb,
	real,
	text,
	timestamp,
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
import type { Binary, JsonValue, NullIn } from '../src/operators.js';

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

/**
 * The type an expression evaluates to. Inferred, since reading the optional
 * `$type` phantom adds `undefined`. Type-only: this file is never run.
 */
declare function typeOf<T>(expression: Expression<T>): T;

const eb = expressionBuilder(users);

describe('comparison methods', () => {
	it('only has the methods of the column type', () => {
		eb.ref('users.firstName').like('%a%');
		eb.ref('users.firstName').gt('M');
		eb.ref('users.age').between([18, 65]);
		eb.ref('users.tags').contains(['a']);

		// @ts-expect-error integers have no pattern methods
		eb.ref('users.age').like('1%');
		// @ts-expect-error enums have no ordering methods
		eb.ref('users.status').lt('active');
		// @ts-expect-error scalars have no array methods
		eb.ref('users.age').overlaps([1]);
		// @ts-expect-error only booleans have the `is true` tests
		eb.ref('users.email').isTrue();
	});

	it('types the value from the column and method', () => {
		eb.ref('users.age').eq(1);
		eb.ref('users.status').eq('active');
		eb.ref('users.status').in(['active', 'inactive']);

		// @ts-expect-error wrong scalar type
		eb.ref('users.age').eq('1');
		// @ts-expect-error not a member of the enum
		eb.ref('users.status').eq('deleted');
		// @ts-expect-error `in` takes a list
		eb.ref('users.age').in(1);
		// @ts-expect-error or an array expression, not a scalar one
		eb.ref('users.firstName').in(eb.ref('users.firstName'));
		// @ts-expect-error `between` takes a pair
		eb.ref('users.age').between([1]);
		// @ts-expect-error `any` is a value, not a method: `eq(eb.fn.any(...))`
		eb.ref('users.tags').eqAny('a');
	});

	it('only tests for null through `isNull`', () => {
		eb.ref('users.email').isNull();
		eb.ref('users.email').isNotNull();
		eb.ref('users.admin').isTrue();

		// @ts-expect-error `= null` is never true
		eb.ref('users.email').eq(null);
		// @ts-expect-error nor is `<> null`
		eb.ref('users.email').ne(null);
		// @ts-expect-error the `is` tests take no value: postgres only takes a keyword
		eb.ref('users.email').isNull(eb.val(null));
		// @ts-expect-error nor an expression
		eb.ref('users.admin').isTrue(eb.ref('users.admin').eq(true));
	});

	it('rejects references outside the scope', () => {
		// @ts-expect-error unknown column
		eb.ref('users.nope').eq(1);
		// @ts-expect-error posts is not in scope
		eb.ref('posts.id').eq(1);
		// @ts-expect-error no bare column names
		eb.ref('age').eq(1);
	});

	it('is a boolean of SQL type boolean', () => {
		const predicate = eb.ref('users.age').eq(1);
		expectTypeOf(typeOf(predicate)).toEqualTypeOf<boolean>();
		expectTypeOf(predicate._quarry.dataType).toEqualTypeOf<BooleanType>();
	});

	it('is nullable when either operand is', () => {
		expectTypeOf(typeOf(eb.ref('users.email').eq('x'))).toEqualTypeOf<
			boolean | null
		>();
		expectTypeOf(typeOf(eb.ref('users.email').like('x%'))).toEqualTypeOf<
			boolean | null
		>();
		expectTypeOf(
			typeOf(eb.ref('users.age').eq(eb.ref('users.score'))),
		).toEqualTypeOf<boolean | null>();
		// nullability lives on the type, not the SQL type
		expectTypeOf(
			eb.ref('users.email').eq('x')._quarry.dataType,
		).toEqualTypeOf<BooleanType>();
	});

	it('is never null for the null-safe operators', () => {
		expectTypeOf(
			typeOf(eb.ref('users.email').isNull()),
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(eb.ref('users.email').isNotNull()),
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(eb.ref('users.email').isDistinctFrom(eb.ref('users.email'))),
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
			tags: array(text()),
			aliases: array(text()).nullable(),
			labels: array(text().nullable()),
			tokens: array(uuid()),
			limits: array(integer()),
			documents: array(jsonb()),
			settings: jsonb(),
			active: tstzrange(),
		},
	});
	const tb = expressionBuilder(things);

	it('take expressions as list items and pair bounds', () => {
		tb.ref('things.age').in([18, tb.ref('things.minAge')]);
		tb.ref('things.age').notIn([tb.ref('things.minAge')]);
		tb.ref('things.age').between([tb.ref('things.minAge'), 65]);

		// @ts-expect-error a list item is still checked
		tb.ref('things.age').in([18, tb.ref('things.name')]);
		// @ts-expect-error a bound is still checked
		tb.ref('things.age').between([tb.ref('things.token'), 65]);
	});

	it('check array expressions by their element type', () => {
		tb.ref('things.tags').overlaps(tb.ref('things.tags'));
		tb.ref('things.name').in(tb.ref('things.tags'));
		tb.ref('things.nickname').eq(tb.fn.any('things.tags'));

		// @ts-expect-error text[] @> uuid[]
		tb.ref('things.tags').contains(tb.ref('things.tokens'));
		// @ts-expect-error text in uuid[]
		tb.ref('things.name').in(tb.ref('things.tokens'));
		// @ts-expect-error a uuid is not an element of text[]
		tb.ref('things.token').eq(tb.fn.any('things.tags'));
	});

	it('compare a parameter with the elements of an array', () => {
		tb.val('a').eq(tb.fn.any('things.tags'));
		tb.val('a').ne(tb.fn.all(tb.ref('things.aliases')));
		tb.val('a%').like(tb.fn.any('things.tags'));
		tb.val(5).lt(tb.fn.all('things.limits'));
		tb.val({ a: 1 }).contains(tb.fn.any('things.documents'));
		tb.val('a').eq(tb.fn.any(tb.fn.coalesce('things.tags', tb.val([]))));

		// the operator and the parameter's type are not checked against the
		// elements yet
		tb.val(1).like(tb.fn.any('things.tags'));

		// @ts-expect-error a parameter needs `any` or `all` on the right
		tb.val('a').eq('a');
		// @ts-expect-error `in` takes a list, not `any` / `all`
		tb.val('a').in(tb.fn.any('things.tags'));
		// @ts-expect-error nor `between`, whose operand is a pair
		tb.val(1).between(tb.fn.any('things.limits'));
	});

	it('are nullable when the parameter, the array or an element is', () => {
		expectTypeOf(
			typeOf(tb.val('a').eq(tb.fn.any('things.tags'))),
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(tb.val('a').eq(tb.fn.any('things.aliases'))),
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(
			typeOf(tb.val('a').eq(tb.fn.any('things.labels'))),
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(
			typeOf(tb.val(null).eq(tb.fn.any('things.tags'))),
		).toEqualTypeOf<boolean | null>();
	});

	it('take a parameter on the left in where clauses too', () => {
		selectFrom(things).where(tb.val('a').eq(tb.fn.any('things.tags')));
		selectFrom(things).where((q) => q.val('a').ne(q.fn.all('things.tags')));
		// @ts-expect-error a parameter needs `any` or `all` on the right
		selectFrom(things).where((q) => q.val('a').eq('a'));
	});

	it('leave jsonb key and path tests to `eb.json`', () => {
		tb.ref('things.settings').contains({ theme: 'dark' });
		tb.ref('things.settings').containedBy(['a']);

		// @ts-expect-error `eb.json.hasKey`
		tb.ref('things.settings').hasKey('theme');
		// @ts-expect-error `eb.json.hasAnyKey`
		tb.ref('things.settings').hasAnyKey(['a']);
		// @ts-expect-error `eb.json.pathExists`
		tb.ref('things.settings').pathExists('$.theme');
		// @ts-expect-error null is SQL null, never contained
		tb.ref('things.settings').contains(null);
	});

	it('find no null in a JSON value, however deeply it nests', () => {
		// the operand type includes nullable expressions, but resolves
		expectTypeOf<
			NullIn<Binary<NonNullable<JsonValue>, DataType<'jsonb'>>>
		>().toEqualTypeOf<null>();
		expectTypeOf<NullIn<NonNullable<JsonValue>>>().toEqualTypeOf<never>();
		expectTypeOf<NullIn<readonly [[[null]]]>>().toEqualTypeOf<never>();
		expectTypeOf<
			NullIn<readonly [1, TypedExpression<number | null, IntegerType>]>
		>().toEqualTypeOf<null>();
	});

	it('take an array parameter as a list, and no parameter as one value', () => {
		tb.ref('things.age').in(tb.val([1, 2]));

		// @ts-expect-error an array parameter of the wrong type
		tb.ref('things.age').in(tb.val(['1']));
		// @ts-expect-error one value is given as is
		tb.ref('things.age').eq(tb.val(1));
		// @ts-expect-error as is each item of a list
		tb.ref('things.age').in([1, tb.val(2)]);
		// @ts-expect-error and each bound of a range
		tb.ref('things.age').between([tb.val(1), 2]);
	});

	it('take `any` / `all` wherever an operator takes one operand', () => {
		tb.ref('things.name').like(tb.fn.any(['a%', 'b%']));
		tb.ref('things.name').notIlike(tb.fn.all(['a%']));
		tb.ref('things.name').eq(tb.fn.any('things.tags'));
		tb.ref('things.name').eq(tb.fn.any(tb.ref('things.aliases')));
		tb.ref('things.age').gt(tb.fn.any(tb.val([1, 2])));
		tb.ref('things.age').lte(tb.fn.all('things.limits'));
		tb.ref('things.settings').contains(tb.fn.any([{ theme: 'dark' }]));
		tb.ref('things.active').contains(tb.fn.any([new Date()]));
		eb.ref('users.status').eq(eb.fn.any(['active', 'inactive']));

		// @ts-expect-error the elements are checked against the operand type
		tb.ref('things.age').gt(tb.fn.any(['1']));
		// @ts-expect-error nor an element of a list of text
		tb.ref('things.name').eq(tb.fn.any('things.tokens'));
		// @ts-expect-error not a member of the enum
		eb.ref('users.status').eq(eb.fn.any(['deleted']));
		// @ts-expect-error a value is not null
		tb.ref('things.name').eq(tb.fn.any(['a', null]));
		// @ts-expect-error `any` takes an array
		tb.ref('things.name').eq(tb.fn.any('things.name'));
	});

	it('take `any` / `all` only where postgres does', () => {
		// @ts-expect-error `is distinct from` takes no `any` / `all`
		tb.ref('things.name').isDistinctFrom(tb.fn.any(['a']));
		// @ts-expect-error `in` takes a list
		tb.ref('things.name').in(tb.fn.any(['a']));
		// @ts-expect-error `between` takes a pair
		tb.ref('things.age').between([tb.fn.any([1]), 2]);
		// @ts-expect-error the operand is an array, and arrays hold no arrays
		tb.ref('things.tags').contains(tb.fn.any([['a']]));
		// @ts-expect-error nor for equality
		tb.ref('things.tags').eq(tb.fn.any([['a']]));
		// @ts-expect-error nor for containment of jsonb arrays held in arrays
		tb.ref('things.documents').contains(tb.fn.any([[{ a: 1 }]]));
	});

	it('take no `any` / `all` of arrays of arrays, however they are given', () => {
		const nested: string[][] = [['a']];
		tb.ref('things.tags').eq(['a']);
		tb.ref('things.tags').ne(tb.ref('things.aliases'));
		// a json value can be an array
		tb.ref('things.settings').contains(tb.fn.any(nested));

		// @ts-expect-error a parameter of arrays
		tb.ref('things.tags').eq(tb.fn.any(tb.val(nested)));
		// @ts-expect-error a variable of arrays
		tb.ref('things.tags').eq(tb.fn.any(nested));
		// @ts-expect-error nor with `all`
		tb.ref('things.tags').ne(tb.fn.all(nested));
		// @ts-expect-error nor as the value of a `where`
		selectFrom(things).where('things.tags', tb.fn.any(nested));
		// @ts-expect-error not an expression
		tb.fn.lower(tb.fn.any(['a']));
		// @ts-expect-error nor a predicate
		tb.and([tb.fn.any([true])]);
	});

	it('are nullable when the array given to `any` / `all` or an element is', () => {
		expectTypeOf(
			typeOf(tb.ref('things.name').eq(tb.fn.any(['a']))),
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(tb.ref('things.name').eq(tb.fn.any('things.tags'))),
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(tb.ref('things.name').eq(tb.fn.any('things.aliases'))),
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(
			typeOf(tb.ref('things.name').eq(tb.fn.all('things.labels'))),
		).toEqualTypeOf<boolean | null>();
	});

	it('are nullable when an item of a list or pair is', () => {
		expectTypeOf(
			typeOf(tb.ref('things.age').in([1, 2])),
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(tb.ref('things.age').in([1, tb.ref('things.score')])),
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(
			typeOf(tb.ref('things.age').between([tb.ref('things.score'), 2])),
		).toEqualTypeOf<boolean | null>();
	});
});

describe('expression operands, checked by SQL type alone', () => {
	type UserId = number & { readonly __brand?: 'UserId' };
	type ContactId = number & { readonly __brand?: 'ContactId' };
	type OrderId = string & { readonly __brand?: 'OrderId' };

	const state = defineEnum('state', ['active', 'suspended', 'deleted']);
	const plan = defineEnum('plan', ['active', 'free']);

	const mixed = defineTable('mixed', {
		columns: {
			small: integer(),
			big: bigint(),
			amount: decimal(),
			ratio: real(),
			scores: array(integer()),
			bigs: array(bigint()),
			day: date(),
			at: timestamp(),
			instant: timestamptz(),
			span: tstzrange(),
			name: text(),
			nickname: varchar(),
			token: uuid(),
			role: text<'admin' | 'member'>(),
			live: state(),
			archived: state<'suspended' | 'deleted'>(),
			plan: plan(),
			plans: array(plan()),
			settings: jsonb<{ theme: string }>(),
			data: jsonb(),
			userId: integer<UserId>(),
			contactId: integer<ContactId>(),
			contactIds: array(integer<ContactId>()),
			orderId: bigint<OrderId>(),
		},
	});
	const mb = expressionBuilder(mixed);

	it('compare the character types with each other', () => {
		mb.ref('mixed.name').eq(mb.ref('mixed.nickname'));
		mb.ref('mixed.nickname').lt(mb.ref('mixed.name'));
		mb.ref('mixed.name').like(mb.fn.concat('mixed.nickname', mb.val('%')));
	});

	it('compare the numeric types with each other', () => {
		mb.ref('mixed.small').eq(mb.ref('mixed.big'));
		mb.ref('mixed.big').gt(mb.ref('mixed.small'));
		mb.ref('mixed.amount').lt(mb.ref('mixed.small'));
		mb.ref('mixed.ratio').gte(mb.ref('mixed.amount'));
		mb.ref('mixed.big').between([mb.ref('mixed.small'), mb.ref('mixed.ratio')]);
		mb.ref('mixed.small').in([1, mb.ref('mixed.big')]);
		mb.ref('mixed.big').gt(mb.fn.count());
	});

	it('compare the date and timestamp types with each other', () => {
		mb.ref('mixed.day').lt(mb.ref('mixed.instant'));
		mb.ref('mixed.instant').gte(mb.ref('mixed.at'));
		mb.ref('mixed.span').contains(mb.ref('mixed.day'));
		mb.ref('mixed.span').contains(mb.ref('mixed.at'));
		mb.ref('mixed.span').contains(mb.ref('mixed.instant'));
	});

	it('take arrays of other types as a whole and through `any` / `all`', () => {
		mb.ref('mixed.small').in(mb.ref('mixed.bigs'));
		mb.ref('mixed.big').notIn(mb.ref('mixed.scores'));
		mb.ref('mixed.small').eq(mb.fn.any('mixed.bigs'));
		mb.ref('mixed.big').lt(mb.fn.all('mixed.scores'));
	});

	it('ignore narrowed types, enum subsets and jsonb shapes', () => {
		mb.ref('mixed.role').eq(mb.ref('mixed.name'));
		mb.ref('mixed.role').eq(mb.fn.lower('mixed.name'));
		mb.ref('mixed.archived').eq(mb.ref('mixed.live'));
		mb.ref('mixed.settings').eq(mb.ref('mixed.data'));
		mb.ref('mixed.settings').contains(mb.json.get('mixed.data', 'theme'));
	});

	it('ignore brands', () => {
		mb.ref('mixed.userId').eq(mb.ref('mixed.contactId'));
		mb.ref('mixed.userId').eq(mb.ref('mixed.orderId'));
		mb.ref('mixed.userId').in(mb.ref('mixed.contactIds'));
		mb.ref('mixed.userId').eq(mb.fn.any('mixed.contactIds'));

		const orders = defineTable('orders', {
			columns: { id: bigint<OrderId>().identity(), userId: integer<UserId>() },
		});
		selectFrom(mixed).innerJoin(orders).on('orders.userId', 'mixed.contactId');
	});

	it('still take only values of the column’s own type', () => {
		// @ts-expect-error an integer value is a number
		mb.ref('mixed.small').eq('1');
		// @ts-expect-error a bigint value is a string
		mb.ref('mixed.big').eq(1);
		// @ts-expect-error a timestamptz value is a Date
		mb.ref('mixed.instant').lt('2024-01-01');
		// @ts-expect-error not one of the narrowed values
		mb.ref('mixed.role').eq('owner');
		// @ts-expect-error nor as values of `any` / `all`
		mb.ref('mixed.small').gt(mb.fn.any(['1']));
		// @ts-expect-error nor as a parameter of them
		mb.ref('mixed.small').gt(mb.fn.any(mb.val(['1'])));
	});

	it('still reject SQL types postgres does not compare', () => {
		// @ts-expect-error a text expression is not numeric
		mb.ref('mixed.big').eq(mb.fn.lower(mb.fn.cast('mixed.big', 'text')));
		// @ts-expect-error nor is a date
		mb.ref('mixed.big').lt(mb.ref('mixed.day'));
		// @ts-expect-error text = bigint, although both are strings
		mb.ref('mixed.name').eq(mb.fn.count());
		// @ts-expect-error text = uuid, although both are strings
		mb.ref('mixed.name').eq(mb.ref('mixed.token'));
		// @ts-expect-error a uuid is not a pattern
		mb.ref('mixed.name').like(mb.ref('mixed.token'));
		// @ts-expect-error nor an item of a list of text
		mb.ref('mixed.name').in(['a', mb.ref('mixed.token')]);
	});

	it('keep each enum its own SQL type', () => {
		mb.ref('mixed.plan').in(mb.ref('mixed.plans'));

		// @ts-expect-error a plan is not a state, although both have 'active'
		mb.ref('mixed.live').eq(mb.ref('mixed.plan'));
		// @ts-expect-error nor an element of an array of them
		mb.ref('mixed.live').in(mb.ref('mixed.plans'));
		// @ts-expect-error nor through `any`
		mb.ref('mixed.live').eq(mb.fn.any('mixed.plans'));

		const accounts = defineTable('accounts', { columns: { plan: plan() } });
		const joined = selectFrom(mixed).innerJoin(accounts);
		joined.on('accounts.plan', 'mixed.plan');
		// @ts-expect-error nor in the `on` shorthand
		joined.on('accounts.plan', 'mixed.live');
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
		expectTypeOf(typeOf(db.json.get('docs.profile', 'address'))).toEqualTypeOf<{
			city: string;
			zip?: string;
		} | null>();
		expectTypeOf(
			typeOf(db.json.get('docs.profile', 'address', 'zip')),
		).toEqualTypeOf<string | null>();
		expectTypeOf(typeOf(db.json.get('docs.profile', 'tags', 0))).toEqualTypeOf<
			string | null
		>();
		expectTypeOf(
			typeOf(db.json.text('docs.profile', 'address', 'city')),
		).toEqualTypeOf<string | null>();
		expectTypeOf(
			db.json.get('docs.profile', 'tags')._quarry.dataType,
		).toEqualTypeOf<JsonbType>();
		expectTypeOf(
			db.json.text('docs.profile', 'tags')._quarry.dataType,
		).toEqualTypeOf<DataType<'text'>>();
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
		db.json.text('docs.profile', 'address', 'city').ilike('os%');
		db.json.get('docs.profile', 'address').contains({ city: 'Oslo' });
		db.fn.cast(db.json.text('docs.data', 'age'), 'integer').gt(18);
		db.json.length(db.json.get('docs.profile', 'tags')).gt(2);

		// @ts-expect-error text has no containment
		db.json.text('docs.profile', 'address').contains('a');
	});

	it('test keys and jsonpaths as predicates', () => {
		db.json.hasKey('docs.profile', 'tags');
		db.json.hasKey('docs.profile', db.ref('docs.name'));
		db.json.hasAnyKey('docs.profile', ['tags', 'address']);
		db.json.hasAllKeys('docs.profile', db.ref('docs.keys'));
		db.json.pathExists('docs.data', '$.tags[*]');
		db.json.pathMatches('docs.data', db.val('$.n > 1'));
		selectFrom(docs).where(db.json.hasKey('docs.profile', 'tags'));
		selectFrom(docs).where((q) => q.json.hasKey('docs.data', 'a'));

		// @ts-expect-error a key is text, not a uuid
		db.json.hasKey('docs.profile', db.ref('docs.token'));
		// @ts-expect-error a key list is text[]
		db.json.hasAnyKey('docs.profile', 'tags');
		// @ts-expect-error a jsonpath is a string
		db.json.pathExists('docs.data', 1);
	});

	it('are nullable when the column, a key or the result can be', () => {
		expectTypeOf(
			typeOf(db.json.hasKey('docs.profile', 'tags')),
		).toEqualTypeOf<boolean>();
		expectTypeOf(typeOf(db.json.hasKey('docs.extra', 'tags'))).toEqualTypeOf<
			boolean | null
		>();
		expectTypeOf(
			typeOf(db.json.pathMatches('docs.data', '$.n > 1')),
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(typeOf(db.json.typeOf('docs.profile'))).toEqualTypeOf<
			'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
		>();
		expectTypeOf(typeOf(db.json.length('docs.extra'))).toEqualTypeOf<
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
		expectTypeOf(
			typeOf(eb.fn.lower('users.firstName')),
		).toEqualTypeOf<string>();
		expectTypeOf(typeOf(eb.fn.lower('users.email'))).toEqualTypeOf<
			string | null
		>();
		expectTypeOf(typeOf(eb.fn.length('users.email'))).toEqualTypeOf<
			number | null
		>();
		expectTypeOf(typeOf(eb.fn.max('users.age'))).toEqualTypeOf<number | null>();
		expectTypeOf(typeOf(eb.fn.min('users.age'))).toEqualTypeOf<number | null>();
		expectTypeOf(typeOf(eb.fn.count())).toEqualTypeOf<string>();
		expectTypeOf(typeOf(eb.fn.now())).toEqualTypeOf<Date>();
		expectTypeOf(
			typeOf(eb.fn.concat('users.email', eb.val(' '), 'users.age')),
		).toEqualTypeOf<string>();
	});

	it('give the result the methods of its SQL type', () => {
		eb.fn.lower('users.firstName').like('a%');
		eb.fn.count().gt('5');
		eb.fn.coalesce('users.email', eb.val('')).ilike('%@example.com');
		eb.fn.max('users.createdAt').lt(new Date());

		// @ts-expect-error a count is a bigint: no pattern methods
		eb.fn.count().like('5');
	});

	it('give the result its SQL type', () => {
		expectTypeOf(
			eb.fn.lower('users.email')._quarry.dataType,
		).toEqualTypeOf<TextType>();
		expectTypeOf(eb.fn.count()._quarry.dataType).toEqualTypeOf<BigIntType>();
		expectTypeOf(
			eb.fn.coalesce('users.email', eb.val(''))._quarry.dataType,
		).toEqualTypeOf<TextType>();
		expectTypeOf(
			eb.fn.max('users.age')._quarry.dataType,
		).toEqualTypeOf<IntegerType>();
		expectTypeOf(
			eb.fn.min('users.firstName')._quarry.dataType,
		).toEqualTypeOf<TextType>();
	});

	it('types coalesce from its last argument', () => {
		expectTypeOf(
			typeOf(eb.fn.coalesce('users.email', 'users.firstName')),
		).toEqualTypeOf<string>();
		expectTypeOf(
			typeOf(eb.fn.coalesce('users.email', eb.val(''))),
		).toEqualTypeOf<string>();
		expectTypeOf(
			typeOf(eb.fn.coalesce('users.email', eb.val(null))),
		).toEqualTypeOf<string | null>();
		expectTypeOf(
			typeOf(eb.fn.coalesce('users.email', eb.val(null), 'users.email')),
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
		expectTypeOf(typeOf(count)).toEqualTypeOf<number>();
		expectTypeOf(count._quarry.dataType).toEqualTypeOf<IntegerType>();
		count.gt(5);

		expectTypeOf(typeOf(eb.fn.cast('users.email', 'uuid'))).toEqualTypeOf<
			string | null
		>();
		expectTypeOf(
			typeOf(eb.fn.cast('users.age', 'text')),
		).toEqualTypeOf<string>();
		eb.fn.cast('users.age', 'text').like('1%');

		// @ts-expect-error not a castable type
		eb.fn.cast('users.age', 'money');
		// @ts-expect-error integers have no pattern methods
		eb.fn.cast('users.firstName', 'integer').like('1%');
	});
});

describe('references and values', () => {
	it('types a reference from the column', () => {
		expectTypeOf(typeOf(eb.ref('users.age'))).toEqualTypeOf<number>();
		expectTypeOf(typeOf(eb.ref('users.email'))).toEqualTypeOf<string | null>();
		expectTypeOf(typeOf(eb.ref('users.status'))).toEqualTypeOf<
			'active' | 'inactive'
		>();
		expectTypeOf(typeOf(eb.ref('users.createdAt'))).toEqualTypeOf<Date>();
	});

	it('gives a reference the SQL type of its column', () => {
		// a nullable column has the same SQL type
		expectTypeOf(
			eb.ref('users.email')._quarry.dataType,
		).toEqualTypeOf<TextType>();
		expectTypeOf(
			eb.ref('users.age')._quarry.dataType,
		).toEqualTypeOf<IntegerType>();
		expectTypeOf(eb.ref('users.status')._quarry.dataType).toEqualTypeOf<
			EnumType<'status'>
		>();
	});

	it('gives a value no SQL type', () => {
		expectTypeOf(eb.val(1)).not.toExtend<TypedExpression<1, DataType>>();
	});

	it('types arrays by element, so they fit array positions', () => {
		expectTypeOf(typeOf(eb.val(['a']))).toEqualTypeOf<string[]>();
		expectTypeOf(typeOf(eb.val([]))).toEqualTypeOf<never[]>();
		eb.ref('users.firstName').in(eb.val(['a']));
		eb.fn.coalesce('users.tags', eb.val([]));
	});

	it('types anything else literally', () => {
		expectTypeOf(typeOf(eb.val('x'))).toEqualTypeOf<'x'>();
		expectTypeOf(typeOf(eb.val(1))).toEqualTypeOf<1>();
		expectTypeOf(typeOf(eb.val({ empty: true }))).toEqualTypeOf<{
			readonly empty: true;
		}>();
	});
});

describe('logical operators', () => {
	it('only accept boolean expressions', () => {
		eb.and([eb.ref('users.age').eq(1), eb.val(true)]);
		eb.not(eb.or([]));

		eb.not(eb.ref('users.admin'));

		// @ts-expect-error a string reference is not a predicate
		eb.and([eb.ref('users.firstName')]);
		// @ts-expect-error neither is a nullable string
		eb.not(eb.ref('users.email'));
	});

	it('are nullable if any operand is', () => {
		expectTypeOf(typeOf(eb.and([]))).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(eb.and([eb.ref('users.age').eq(1)])),
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(eb.or([eb.ref('users.age').eq(1), eb.ref('users.email').eq('x')])),
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(typeOf(eb.not(eb.ref('users.email').eq('x')))).toEqualTypeOf<
			boolean | null
		>();
		expectTypeOf(
			typeOf(eb.not(eb.ref('users.email').isNull())),
		).toEqualTypeOf<boolean>();
	});
});

describe('boolean methods', () => {
	it('combine conditions, nullable if either side is', () => {
		expectTypeOf(
			typeOf(eb.ref('users.age').gt(1).and(eb.ref('users.age').lt(9))),
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(eb.ref('users.age').gt(1).or(eb.ref('users.email').eq('x'))),
		).toEqualTypeOf<boolean | null>();
		expectTypeOf(typeOf(eb.ref('users.email').eq('x').not())).toEqualTypeOf<
			boolean | null
		>();
		// a boolean column is a condition too
		expectTypeOf(
			typeOf(eb.ref('users.admin').and(eb.ref('users.age').gt(1))),
		).toEqualTypeOf<boolean>();

		// @ts-expect-error only a boolean is combined
		eb.ref('users.age').gt(1).and(eb.ref('users.age'));
		// @ts-expect-error only a boolean has `and`
		eb.ref('users.age').and(eb.ref('users.age').gt(1));
	});

	it('test truth, never null', () => {
		expectTypeOf(
			typeOf(eb.ref('users.email').eq('x').isTrue()),
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(eb.ref('users.admin').isNotFalse()),
		).toEqualTypeOf<boolean>();
	});

	it('are methods of every predicate, wherever it comes from', () => {
		expectTypeOf(
			typeOf(eb.not(eb.ref('users.admin')).or(eb.ref('users.admin'))),
		).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(eb.and([eb.ref('users.age').gt(1)]).not()),
		).toEqualTypeOf<boolean>();
	});
});

describe('the builder', () => {
	it('can be destructured', () => {
		const { ref, fn, val, and } = eb;
		and([
			ref('users.age').gt(1),
			fn.concat('users.firstName', val(' ')).like('a%'),
		]);
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
		expectTypeOf(eb.ref('users.age').eq(1)).toExtend<Expression<boolean>>();
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
		expectTypeOf(typeOf(aliased.expression)).toEqualTypeOf<string>();
	});
});

describe('columns and data types', () => {
	it('agree on how each SQL type is represented, wherever it is created', () => {
		expectTypeOf(bigint()).toEqualTypeOf<IntegerColumn<BigIntType, string>>();
		expectTypeOf(typeOf(eb.fn.count())).toEqualTypeOf<string>();
		expectTypeOf(
			typeOf(eb.fn.cast('users.age', 'bigint')),
		).toEqualTypeOf<string>();

		expectTypeOf(integer().$select).toEqualTypeOf<number>();
		expectTypeOf(
			typeOf(eb.fn.length('users.firstName')),
		).toEqualTypeOf<number>();
		expectTypeOf(
			typeOf(eb.fn.cast('users.firstName', 'integer')),
		).toEqualTypeOf<number>();

		expectTypeOf(text().$select).toEqualTypeOf<string>();
		expectTypeOf(
			typeOf(eb.fn.lower('users.firstName')),
		).toEqualTypeOf<string>();
		expectTypeOf(
			typeOf(eb.fn.cast('users.age', 'text')),
		).toEqualTypeOf<string>();

		expectTypeOf(timestamptz().$select).toEqualTypeOf<Date>();
		expectTypeOf(typeOf(eb.fn.now())).toEqualTypeOf<Date>();
		expectTypeOf(
			typeOf(eb.fn.cast('users.age', 'timestamptz')),
		).toEqualTypeOf<Date>();

		expectTypeOf(boolean().$select).toEqualTypeOf<boolean>();
		expectTypeOf(typeOf(eb.ref('users.age').eq(1))).toEqualTypeOf<boolean>();
		expectTypeOf(
			typeOf(eb.fn.cast('users.age', 'boolean')),
		).toEqualTypeOf<boolean>();

		// @ts-expect-error a bigint column's values are strings
		bigint<1n>();
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
		expectTypeOf(integer().identity()).toEqualTypeOf<
			IdentityColumn<IntegerType, number, never, never>
		>();
		expectTypeOf(
			integer().typed<UserId, UserId, UserId>().identity(),
		).toEqualTypeOf<IdentityColumn<IntegerType, UserId, never, never>>();

		// @ts-expect-error only the integer types can be identities
		text().identity();
		// @ts-expect-error an identity is never null
		integer().nullable().identity();
		// @ts-expect-error an identity has no default
		integer().default().identity();
		// @ts-expect-error an identity is not also generated
		integer().generated().identity();
		// @ts-expect-error nothing applies after identity
		integer().identity().nullable();
		// @ts-expect-error nor after narrowing it
		integer().identity().typed<number>().default();
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
			text().default().typed<Email, Email | undefined, Email>().$insert,
		).toEqualTypeOf<Email | undefined>();
	});

	it('only narrow with typed(), in every state', () => {
		type UserId = number & { readonly brand: 'user' };
		expectTypeOf(
			text().nullable().typed<string | null, string | null, string>(),
		).toEqualTypeOf<Column<TextType, string | null, string | null, string>>();
		expectTypeOf(
			text().default().typed<'a', 'a', 'a'>().$insert,
		).toEqualTypeOf<'a'>();
		expectTypeOf(integer().identity().typed<UserId>()).toEqualTypeOf<
			IdentityColumn<IntegerType, UserId, never, never>
		>();
		// each type narrows independently of the others
		expectTypeOf(text().typed<'a', string, string>()).toEqualTypeOf<
			Column<TextType, 'a', string, string>
		>();

		// @ts-expect-error the select type can't change the SQL type's values
		text().typed<number, number, number>();
		// @ts-expect-error nor in any state
		integer().identity().typed<string>();
		// @ts-expect-error nor widen them
		array(text()).typed<readonly string[], string[], string[]>();
		// @ts-expect-error a write must be a value of the column
		timestamptz().typed<Date, string, never>();
		// @ts-expect-error a column without a default can't be omitted
		text().typed<string, string | undefined, string>();
		// @ts-expect-error a generated column takes only a select type
		text().generated().typed<string, string, never>();
		// @ts-expect-error an identity takes only a select type
		integer().identity().typed<number, number, never>();
		expectTypeOf(
			text().generated().nullable().typed<'a' | null>(),
		).toEqualTypeOf<GeneratedColumn<TextType, 'a' | null, never, never>>();
	});

	it('give the types that encode values their own class', () => {
		expectTypeOf(jsonb()._quarry.dataType).toEqualTypeOf<JsonbType>();
		expectTypeOf(tstzrange()._quarry.dataType).toEqualTypeOf<TstzRangeType>();
		expectTypeOf(vector()._quarry.dataType).toEqualTypeOf<VectorType>();
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
	});

	it('type elements as nullable only when the element column is', () => {
		expectTypeOf(array(text().nullable())).toEqualTypeOf<
			Column<ArrayType<TextType>, (string | null)[]>
		>();
		expectTypeOf(array(text().nullable()).nullable().$select).toEqualTypeOf<
			(string | null)[] | null
		>();
		expectTypeOf(
			array(text().nullable().typed<'a' | null, 'a' | null, 'a' | null>())
				.$select,
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
		scoped.ref('posts.authorId').eq(scoped.ref('users.id'));
		expectTypeOf(typeOf(scoped.ref('posts.authorId'))).toEqualTypeOf<number>();
	});

	it('keys aliased tables by their alias', () => {
		const scoped = expressionBuilder(users.as('u'));
		scoped.ref('u.firstName').eq('Ada');
		// @ts-expect-error the original name is no longer in scope
		scoped.ref('users.firstName').eq('Ada');
	});
});
