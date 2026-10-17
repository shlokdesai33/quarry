import { ArrayType } from './data-type/array.js';
import { DataType } from './data-type/data-type.js';
import {
	Expression,
	Param,
	Quantified,
	TypedExpression,
} from './expression.js';
import { declareParamType, type Codec } from './driver/codec.js';
import { codecs } from './driver/codecs.js';
import { typedExpression } from './expression-methods.js';
import type { CodecKind } from './kind-codecs.js';
import type { OperationNode } from './node.js';
import type {
	Expr,
	JsonValue,
	Kind,
	KindValue,
	NumberKind,
	One,
	OrderedKind,
	TextKind,
	TimestampKind,
} from './operators.js';
import type { DataTypeOf, NullOf, Operand, Ref, Refs, TypeOf } from './refs.js';

/** A result of SQL type `K` and TypeScript type `T`, nullable when `N` is `null`. */
type Result<K extends Kind, T, N = never> = Expr<T | N, DataType<K>>;

/** Any character type. */
type Text = DataType<TextKind>;

/** Any SQL type with an ordering. */
type Comparable = DataType<OrderedKind>;

/** An argument of any SQL type, including one postgres infers (`eb.val`). */
type Part<R extends Refs> = Ref<R> | Expression<unknown>;

/**
 * A `coalesce` fallback: an operand of the first argument's SQL type, or any
 * expression of its value type (so `eb.val` works).
 */
type Fallback<R extends Refs, First> =
	| Operand<R, DataTypeOf<R, First>>
	| Expression<TypeOf<R, First>>;

/** What `any` and `all` take: values, an array parameter, or an array operand. */
type Quantifiable<R extends Refs> =
	| readonly unknown[]
	| Param<readonly unknown[] | null>
	| Operand<R, DataType<'array'>>;

type Element<T> = T extends readonly (infer E)[] ? E : never;

type ElementType<D> = D extends ArrayType<infer E> ? E : never;

/**
 * `any(A)` or `all(A)`: values and parameters have no SQL type of their own,
 * an array operand has its element type. Null if the array or an element can
 * be.
 */
type QuantifiedOf<R extends Refs, A> = A extends readonly (infer S)[]
	? Quantified<S, never, never, false>
	: A extends Param<infer T>
		? Quantified<Element<NonNullable<T>>, never, NullOf<T>, false>
		: Quantified<
				NonNullable<Element<NonNullable<TypeOf<R, A>>>>,
				ElementType<DataTypeOf<R, A>>,
				NullOf<TypeOf<R, A> | Element<NonNullable<TypeOf<R, A>>>>,
				true
			>;

/**
 * What `coalesce(first, ...rest)` returns: of the first argument's SQL type,
 * and null only if the last argument can be.
 *
 * Behind `extends infer`, so it waits until the arguments are inferred: built
 * from both type parameters, `Expr` would otherwise be instantiated with them
 * still generic while the call is resolved.
 */
type Coalesced<R extends Refs, A, Rest extends readonly unknown[]> = [
	A,
	Rest,
] extends [infer F, infer L extends readonly unknown[]]
	? Expr<
			| NonNullable<TypeOf<R, F> | TypeOf<R, L[number]>>
			| NullOf<TypeOf<R, Last<L>>>,
			DataTypeOf<R, F>
		>
	: never;

type Last<T extends readonly unknown[]> = T extends readonly [
	...unknown[],
	infer L,
]
	? L
	: never;

/** The TypeScript type a value cast to each target arrives as. */
interface CastValues {
	text: string;
	varchar: string;
	smallint: number;
	integer: number;
	bigint: string;
	numeric: string;
	real: number;
	'double precision': number;
	boolean: boolean;
	uuid: string;
	date: string;
	timestamp: string;
	timestamptz: Date;
	time: string;
	interval: string;
	jsonb: JsonValue;
}

type CastType = keyof CastValues;

/** The kind of each target of `cast`, keyed by SQL name. */
const CAST_KINDS = {
	text: 'text',
	varchar: 'varchar',
	smallint: 'smallint',
	integer: 'integer',
	bigint: 'bigint',
	numeric: 'decimal',
	real: 'real',
	'double precision': 'double precision',
	boolean: 'boolean',
	uuid: 'uuid',
	date: 'date',
	timestamp: 'timestamp',
	timestamptz: 'timestamptz',
	time: 'time',
	interval: 'interval',
	jsonb: 'jsonb',
} as const satisfies Record<CastType, Kind>;

/**
 * The SQL functions available in scope `R`, typed by the SQL types of their
 * arguments and results. Most are null if any argument is; `concat`, `count`
 * and `now` never are. A plain value argument goes through `eb.val`.
 *
 * `R` is invariant, as for `ExpressionBuilder`.
 */
export interface Functions<in out R extends Refs> {
	/** `lower(text)` */
	lower<A extends Operand<R, Text>>(
		text: A,
	): Result<'text', string, NullOf<TypeOf<R, A>>>;

	/** `upper(text)` */
	upper<A extends Operand<R, Text>>(
		text: A,
	): Result<'text', string, NullOf<TypeOf<R, A>>>;

	/** `length(text)`: the number of characters. */
	length<A extends Operand<R, Text>>(
		text: A,
	): Result<'integer', number, NullOf<TypeOf<R, A>>>;

	/**
	 * `concat(a, b, ...)`. Nulls are skipped, so the result is never null.
	 *
	 * @example eb.fn.concat('users.firstName', eb.val(' '), 'users.lastName')
	 */
	concat(...parts: readonly [Part<R>, ...Part<R>[]]): Result<'text', string>;

	/**
	 * `coalesce(first, ...rest)`: the first non-null argument. All arguments
	 * share the first's SQL type; the result is nullable only if the last is.
	 *
	 * @example eb.fn.coalesce('users.deletedAt', eb.fn.now())
	 */
	coalesce<
		A extends Operand<R>,
		Rest extends readonly [Fallback<R, A>, ...Fallback<R, A>[]],
	>(
		first: A,
		...rest: Rest
	): Coalesced<R, A, Rest>;

	/** `count(*)` or `count(value)`. A `bigint`, so it arrives as a string. */
	count(value?: Part<R>): Result<'bigint', string>;

	/** `min(value)`: null over no rows. */
	min<A extends Operand<R, Comparable>>(
		value: A,
	): Expr<TypeOf<R, A> | null, DataTypeOf<R, A>>;

	/** `max(value)`: null over no rows. */
	max<A extends Operand<R, Comparable>>(
		value: A,
	): Expr<TypeOf<R, A> | null, DataTypeOf<R, A>>;

	/** `now()`: the transaction's start time. */
	now(): Result<'timestamptz', Date>;

	/**
	 * `cast(value as type)`: converts the value, so its type and SQL type
	 * follow the target.
	 *
	 * @example eb.fn.cast(eb.fn.count(), 'integer')
	 */
	cast<A extends Operand<R>, T extends CastType>(
		value: A,
		type: T,
	): Result<(typeof CAST_KINDS)[T], CastValues[T], NullOf<TypeOf<R, A>>>;

	/**
	 * `any(array)`, the right-hand side of a comparison that holds if it does
	 * for some element. Not a function in postgres, so it is accepted nowhere
	 * else. Each value is encoded like an operand of the comparison. Of an
	 * array column or expression, it also takes a parameter on the left.
	 *
	 * @example eb.ref('users.email').like(eb.fn.any(['%@a.com', '%@b.com']))
	 * @example eb.ref('users.age').gt(eb.fn.any('users.limits'))
	 * @example eb.val('admin').eq(eb.fn.any('users.tags'))
	 */
	any<const A extends Quantifiable<R>>(array: A): QuantifiedOf<R, A>;

	/**
	 * `all(array)`, the right-hand side of a comparison that holds if it does
	 * for every element, so always for an empty array.
	 *
	 * @example eb.ref('users.email').notLike(eb.fn.all(['%@a.com', '%@b.com']))
	 */
	all<const A extends Quantifiable<R>>(array: A): QuantifiedOf<R, A>;

	/**
	 * `nullif(value, other)`: null where `value` equals `other`, otherwise
	 * `value`. `other` is a value of `value`'s type or an expression of a
	 * SQL type it compares with.
	 *
	 * @example eb.fn.nullif('users.nickname', '')
	 */
	nullif<A extends Operand<R>>(
		value: A,
		other: One<NonNullable<TypeOf<R, A>>, DataTypeOf<R, A>>,
	): Expr<TypeOf<R, A> | null, DataTypeOf<R, A>>;

	/**
	 * `greatest(first, ...rest)`: the largest argument, ignoring nulls, so
	 * null only when every argument is. All share the first's SQL type; a
	 * fallback is a value of its type or an expression.
	 *
	 * @example eb.fn.greatest('orders.updatedAt', 'orders.createdAt')
	 */
	greatest<
		A extends Operand<R, Comparable>,
		Rest extends readonly [Extreme<R, A>, ...Extreme<R, A>[]],
	>(
		first: A,
		...rest: Rest
	): Extremum<R, A, Rest>;

	/** `least(first, ...rest)`: the smallest argument; see `greatest`. */
	least<
		A extends Operand<R, Comparable>,
		Rest extends readonly [Extreme<R, A>, ...Extreme<R, A>[]],
	>(
		first: A,
		...rest: Rest
	): Extremum<R, A, Rest>;

	/** `count(distinct value)`: the number of distinct non-null values. */
	countDistinct(value: Part<R>): Result<'bigint', string>;

	/**
	 * `sum(value)`: null over no rows. Of a `smallint` or `integer`, a
	 * `bigint`; of a `bigint`, a `decimal` (both strings); otherwise of the
	 * argument's type.
	 */
	sum<A extends Operand<R, Summable>>(
		value: A,
	): Expr<KindValue<SumKind<KindOf<R, A>>> | null, DataType<SumKind<KindOf<R, A>>>>;

	/**
	 * `avg(value)`: null over no rows. Of an exact numeric type, a `decimal`
	 * (a string); of a floating point type, a `double precision`; of an
	 * `interval`, an `interval`.
	 */
	avg<A extends Operand<R, Summable>>(
		value: A,
	): Expr<KindValue<AvgKind<KindOf<R, A>>> | null, DataType<AvgKind<KindOf<R, A>>>>;

	/**
	 * `array_agg(value)`: the values of the group as an array, nulls
	 * included; null over no rows.
	 *
	 * @example eb.fn.arrayAgg('tags.name').as('tags')
	 */
	arrayAgg<A extends Operand<R, ElementKind>>(
		value: A,
	): Expr<TypeOf<R, A>[] | null, ArrayType<DataTypeOf<R, A>>>;

	/**
	 * `string_agg(value, delimiter)`: the non-null values joined by
	 * `delimiter` (a value, or a text expression); null over no rows.
	 *
	 * @example eb.fn.stringAgg('tags.name', ', ')
	 */
	stringAgg<A extends Operand<R, Text>, D extends TextArg>(
		value: A,
		delimiter: D,
	): Result<'text', string, null>;

	/** `bool_and(value)`: whether every non-null value is true; null over no rows. */
	boolAnd(value: Operand<R, DataType<'boolean'>>): Result<'boolean', boolean, null>;

	/** `bool_or(value)`: whether any value is true; null over no rows. */
	boolOr(value: Operand<R, DataType<'boolean'>>): Result<'boolean', boolean, null>;

	/**
	 * `jsonb_agg(value)`: the values of the group as a JSON array; null over
	 * no rows. Each value is typed as JSON holds it: numbers (`bigint` and
	 * `decimal` too) as `number`, dates and times as strings.
	 *
	 * @example eb.fn.jsonbAgg(eb.fn.jsonbBuildObject({ id: 'posts.id', title: 'posts.title' })).as('posts')
	 */
	jsonbAgg<A extends Part<R>>(
		value: A,
	): Expr<JsonOf<TypeOf<R, A>, DataTypeOf<R, A>>[] | null, Jsonb>;

	/**
	 * `jsonb_build_object('key', value, ...)`: a JSON object of `fields`,
	 * each a column or an expression, typed as JSON holds it (see
	 * `jsonbAgg`). Never null.
	 *
	 * @example eb.fn.jsonbBuildObject({ id: 'users.id', email: 'users.email' }).as('user')
	 */
	jsonbBuildObject<const F extends Readonly<Record<string, Part<R>>>>(
		fields: F,
	): Expr<
		{ -readonly [K in keyof F]: JsonOf<TypeOf<R, F[K]>, DataTypeOf<R, F[K]>> },
		Jsonb
	>;

	/** `abs(value)`: the absolute value, of the argument's type. */
	abs<A extends Operand<R, DataType<NumberKind>>>(
		value: A,
	): Expr<
		KindValue<KindOf<R, A> & CodecKind> | NullOf<TypeOf<R, A>>,
		DataType<KindOf<R, A>>
	>;

	/**
	 * `round(value)`, or with `digits`, `round(value, digits)`, which only a
	 * `decimal` takes. A `decimal` stays one; anything else becomes a
	 * `double precision`, as in postgres.
	 */
	round<A extends Operand<R, DataType<NumberKind>>>(
		value: A,
	): Rounded<R, A>;
	round<A extends Operand<R, DataType<'decimal'>>>(
		value: A,
		digits: IntegerArg,
	): Rounded<R, A>;

	/** `ceil(value)`: the smallest whole number not below it; see `round`. */
	ceil<A extends Operand<R, DataType<NumberKind>>>(value: A): Rounded<R, A>;

	/** `floor(value)`: the largest whole number not above it; see `round`. */
	floor<A extends Operand<R, DataType<NumberKind>>>(value: A): Rounded<R, A>;

	/** `trim(text)`: without leading and trailing spaces. */
	trim<A extends Operand<R, Text>>(
		text: A,
	): Result<'text', string, NullOf<TypeOf<R, A>>>;

	/** `ltrim(text)`: without leading spaces. */
	ltrim<A extends Operand<R, Text>>(
		text: A,
	): Result<'text', string, NullOf<TypeOf<R, A>>>;

	/** `rtrim(text)`: without trailing spaces. */
	rtrim<A extends Operand<R, Text>>(
		text: A,
	): Result<'text', string, NullOf<TypeOf<R, A>>>;

	/**
	 * `substring(text, start, count)`: `count` characters (or the rest)
	 * from position `start`, counted from 1. `start` and `count` are values
	 * or integer expressions.
	 *
	 * @example eb.fn.substring('users.name', 1, 1)
	 */
	substring<A extends Operand<R, Text>, S extends IntegerArg, C extends IntegerArg = never>(
		text: A,
		start: S,
		count?: C,
	): Result<'text', string, NullOf<TypeOf<R, A>> | ArgNull<S> | ArgNull<C>>;

	/**
	 * `replace(text, from, to)`: every occurrence of `from` replaced by
	 * `to`, each a value or a text expression.
	 *
	 * @example eb.fn.replace('users.phone', '-', '')
	 */
	replace<A extends Operand<R, Text>, F extends TextArg, T extends TextArg>(
		text: A,
		from: F,
		to: T,
	): Result<'text', string, NullOf<TypeOf<R, A>> | ArgNull<F> | ArgNull<T>>;

	/**
	 * `strpos(text, search)`: the position of the first occurrence of
	 * `search` (a value or a text expression), from 1; 0 when absent.
	 */
	strpos<A extends Operand<R, Text>, S extends TextArg>(
		text: A,
		search: S,
	): Result<'integer', number, NullOf<TypeOf<R, A>> | ArgNull<S>>;

	/** `left(text, count)`: the first `count` characters. */
	left<A extends Operand<R, Text>, C extends IntegerArg>(
		text: A,
		count: C,
	): Result<'text', string, NullOf<TypeOf<R, A>> | ArgNull<C>>;

	/** `right(text, count)`: the last `count` characters. */
	right<A extends Operand<R, Text>, C extends IntegerArg>(
		text: A,
		count: C,
	): Result<'text', string, NullOf<TypeOf<R, A>> | ArgNull<C>>;

	/**
	 * `split_part(text, delimiter, n)`: the `n`th field (from 1; negative
	 * counts from the end) of `text` split on `delimiter`; empty when there
	 * are fewer.
	 *
	 * @example eb.fn.splitPart('users.email', '@', 2)
	 */
	splitPart<A extends Operand<R, Text>, D extends TextArg, N extends IntegerArg>(
		text: A,
		delimiter: D,
		n: N,
	): Result<'text', string, NullOf<TypeOf<R, A>> | ArgNull<D> | ArgNull<N>>;

	/** `current_date`: the transaction's start date, as the session's time zone sees it. */
	currentDate(): Result<'date', string>;

	/**
	 * `date_trunc('unit', value)`: the timestamp or interval truncated to
	 * the unit. A `date` is truncated as a `timestamptz`, as in postgres.
	 *
	 * @example eb.fn.dateTrunc('month', 'orders.createdAt')
	 */
	dateTrunc<A extends Operand<R, DataType<TimestampKind | 'interval'>>>(
		unit: DateUnit,
		value: A,
	): Truncated<R, A>;

	/**
	 * `extract(field from value)`: one field of a date, time, timestamp or
	 * interval, as a `decimal` (a string); cast it for a number.
	 *
	 * @example eb.fn.cast(eb.fn.extract('year', 'orders.createdAt'), 'integer')
	 */
	extract<A extends Operand<R, DataType<TimestampKind | 'time' | 'interval'>>>(
		field: DateField,
		value: A,
	): Result<'decimal', string, NullOf<TypeOf<R, A>>>;

	/**
	 * `to_char(value, format)`: a date, time, timestamp, interval or number
	 * formatted by the pattern, e.g. `'YYYY-MM-DD'`.
	 */
	toChar<A extends Operand<R, DataType<TimestampKind | 'time' | 'interval' | NumberKind>>, F extends TextArg>(
		value: A,
		format: F,
	): Result<'text', string, NullOf<TypeOf<R, A>> | ArgNull<F>>;

	/** `cardinality(array)`: the number of elements; 0 for an empty array. */
	cardinality<A extends Operand<R, DataType<'array'>>>(
		array: A,
	): Result<'integer', number, NullOf<TypeOf<R, A>>>;
}

/**
 * A `greatest` / `least` fallback: an operand of the first's SQL type, or a
 * value of its type; a string is a reference, so a text value is an
 * `eb.val`.
 */
type Extreme<R extends Refs, First> =
	| Operand<R, DataTypeOf<R, First>>
	| Exclude<NonNullable<TypeOf<R, First>>, string>
	| Param<TypeOf<R, First>>;

/** What `greatest(first, ...rest)` returns: null only if every argument can be. */
type Extremum<R extends Refs, A, Rest extends readonly unknown[]> = [
	A,
	Rest,
] extends [infer F, infer L extends readonly unknown[]]
	? Expr<
			| NonNullable<TypeOf<R, F>>
			| (null extends TypeOf<R, F> ? AllNull<R, L> : never),
			DataTypeOf<R, F>
		>
	: never;

/** `null` when every argument of `L` can be null. */
type AllNull<R extends Refs, L extends readonly unknown[]> = false extends {
	[I in keyof L]: null extends ArgType<R, L[I]> ? true : false;
}[number]
	? never
	: null;

/** The type of an argument that may be a plain value. */
type ArgType<R extends Refs, A> = A extends Ref<R> | Expression<unknown>
	? TypeOf<R, A>
	: A;

/** The SQL kind of an operand. */
type KindOf<R extends Refs, A> = DataTypeOf<R, A>['kind'];

/** What `sum` and `avg` take. */
type Summable = DataType<NumberKind | 'interval'>;

/** The kind `sum` of a kind `K` has. */
type SumKind<K> = K extends 'smallint' | 'integer'
	? 'bigint'
	: K extends 'bigint'
		? 'decimal'
		: K extends CodecKind
			? K
			: never;

/** The kind `avg` of a kind `K` has. */
type AvgKind<K> = K extends 'real' | 'double precision'
	? 'double precision'
	: K extends 'interval'
		? 'interval'
		: 'decimal';

/** What `round`, `ceil` and `floor` return: a `decimal` stays one, anything else is a `double precision`. */
type Rounded<R extends Refs, A> = KindOf<R, A> extends 'decimal'
	? Result<'decimal', string, NullOf<TypeOf<R, A>>>
	: Result<'double precision', number, NullOf<TypeOf<R, A>>>;

/** What `date_trunc` returns: of the argument's type, but a `timestamptz` for a `date`. */
type Truncated<R extends Refs, A> = KindOf<R, A> extends 'date'
	? Result<'timestamptz', Date, NullOf<TypeOf<R, A>>>
	: Expr<
			KindValue<KindOf<R, A> & CodecKind> | NullOf<TypeOf<R, A>>,
			DataType<KindOf<R, A>>
		>;

/** The types an array can hold: any but an array. */
type ElementKind = DataType<Exclude<Kind, 'array'>>;

type Jsonb = DataType<'jsonb'>;

/** A text argument taken as a value: a string, or a text expression or parameter. */
type TextArg = string | Param<string> | TypedExpression<string | null, Text>;

/** An integer argument taken as a value: a number, or an integer expression or parameter. */
type IntegerArg =
	| number
	| Param<number>
	| TypedExpression<number | null, DataType<'smallint' | 'integer'>>;

/** `null` if an argument taken as a value can be. */
type ArgNull<A> = A extends Expression<infer T> ? NullOf<T> : never;

/**
 * A value as JSON holds it, for a value of type `T` and SQL type `D`:
 * numbers as `number`, text, enums and uuids as they are, jsonb as its
 * document, arrays element by element, and any other type as its text.
 */
export type JsonOf<T, D> = T extends null
	? null
	: [D] extends [never]
		? JsonValue
		: D extends ArrayType<infer E>
			? T extends readonly (infer I)[]
				? JsonOf<I, E>[]
				: never
			: D extends DataType<NumberKind>
				? number
				: D extends DataType<'boolean'>
					? boolean
					: D extends DataType<'jsonb' | TextKind | 'uuid' | 'enum'>
						? T
						: string;

/** The units `date_trunc` takes. */
type DateUnit =
	| 'microseconds'
	| 'milliseconds'
	| 'second'
	| 'minute'
	| 'hour'
	| 'day'
	| 'week'
	| 'month'
	| 'quarter'
	| 'year'
	| 'decade'
	| 'century'
	| 'millennium';

const DATE_UNITS: ReadonlySet<string> = new Set<DateUnit>([
	'microseconds',
	'milliseconds',
	'second',
	'minute',
	'hour',
	'day',
	'week',
	'month',
	'quarter',
	'year',
	'decade',
	'century',
	'millennium',
]);

/** The fields `extract` takes. */
type DateField =
	| DateUnit
	| 'dow'
	| 'doy'
	| 'epoch'
	| 'isodow'
	| 'isoyear'
	| 'julian'
	| 'timezone'
	| 'timezone_hour'
	| 'timezone_minute';

const DATE_FIELDS: ReadonlySet<string> = new Set<DateField>([
	...(DATE_UNITS as ReadonlySet<DateUnit>),
	'dow',
	'doy',
	'epoch',
	'isodow',
	'isoyear',
	'julian',
	'timezone',
	'timezone_hour',
	'timezone_minute',
]);

/** How the function catalog resolves its arguments against the scope. */
export interface Scope<R extends Refs> {
	readonly node: (arg: Part<R>) => OperationNode;
	readonly dataType: (
		arg: Ref<R> | TypedExpression<unknown, DataType>,
	) => DataType;
}

const STAR: OperationNode = { kind: 'raw', fragments: ['*'], nodes: [] };

function call(name: string, args: readonly OperationNode[], type: DataType) {
	return typedExpression({ kind: 'function', name, args }, type);
}

/** Like `result`: `Functions` supplies the element types. */
function quantified(
	quantifier: 'any' | 'all',
	array: readonly unknown[] | Expression<unknown>,
	element: DataType | undefined,
): never {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the signature supplies the type
	return new Quantified(quantifier, array, element) as never;
}

export function functions<R extends Refs>({
	node,
	dataType,
}: Scope<R>): Functions<R> {
	// values and parameters stay as they are, so the comparison can encode them
	const quantify = (quantifier: 'any' | 'all') => (array: Quantifiable<R>) => {
		if (typeof array !== 'string' && !(array instanceof TypedExpression)) {
			return quantified(quantifier, array, undefined);
		}
		const type = dataType(array);
		return quantified(
			quantifier,
			typeof array === 'string' ? new Expression(node(array)) : array,
			type instanceof ArrayType ? type.element : undefined,
		);
	};

	return {
		lower: (text) => call('lower', [node(text)], new DataType('text')),
		upper: (text) => call('upper', [node(text)], new DataType('text')),
		length: (text) => call('length', [node(text)], new DataType('integer')),
		concat: (...parts) => call('concat', parts.map(node), new DataType('text')),
		coalesce: (first, ...rest) => {
			const type = dataType(first);
			// a fallback parameter is of the first argument's type
			const fallback = (arg: Part<R>): OperationNode =>
				arg instanceof Param
					? {
							kind: 'value',
							value: arg._quarry.value,
							codec: arg._quarry.codec ?? type.codec,
						}
					: node(arg);
			return call('coalesce', [node(first), ...rest.map(fallback)], type);
		},
		count: (value) =>
			call(
				'count',
				[value === undefined ? STAR : node(value)],
				new DataType('bigint'),
			),
		min: (value) => call('min', [node(value)], dataType(value)),
		max: (value) => call('max', [node(value)], dataType(value)),
		now: () => call('now', [], new DataType('timestamptz')),
		cast: (value, type) => {
			if (!Object.hasOwn(CAST_KINDS, type)) {
				throw new Error(`Unknown cast type "${type}"`);
			}
			return typedExpression(
				{
					kind: 'raw',
					fragments: ['cast(', ` as ${type})`],
					nodes: [node(value)],
				},
				new DataType(CAST_KINDS[type]),
			);
		},
		any: quantify('any'),
		all: quantify('all'),
		nullif: (value, other) => {
			const type = dataType(value);
			return call('nullif', [node(value), valueArg(other, type.codec)], type);
		},
		greatest: (first, ...rest) => extreme('greatest', first, rest),
		least: (first, ...rest) => extreme('least', first, rest),
		countDistinct: (value) =>
			typedExpression(
				{ kind: 'function', name: 'count', args: [node(value)], distinct: true },
				new DataType('bigint'),
			),
		sum: (value) =>
			call('sum', [node(value)], new DataType(sumKind(dataType(value).kind))),
		avg: (value) =>
			call('avg', [node(value)], new DataType(avgKind(dataType(value).kind))),
		arrayAgg: (value) =>
			call('array_agg', [node(value)], new ArrayType(dataType(value))),
		stringAgg: (value, delimiter) =>
			call(
				'string_agg',
				[node(value), valueArg(delimiter, codecs.text)],
				new DataType('text'),
			),
		boolAnd: (value) =>
			call('bool_and', [node(value)], new DataType('boolean')),
		boolOr: (value) => call('bool_or', [node(value)], new DataType('boolean')),
		jsonbAgg: (value) =>
			call('jsonb_agg', [node(value)], new DataType('jsonb')),
		jsonbBuildObject: (fields) =>
			call(
				'jsonb_build_object',
				Object.entries(fields).flatMap(([key, value]) => [
					{ kind: 'literal', value: key } as const,
					node(value),
				]),
				new DataType('jsonb'),
			),
		abs: (value) =>
			call('abs', [node(value)], new DataType(dataType(value).kind)),
		round: (value: Operand<R, DataType<NumberKind>>, digits?: unknown) =>
			call(
				'round',
				digits === undefined
					? [node(value)]
					: [node(value), valueArg(digits, codecs.int4)],
				rounded(dataType(value)),
			),
		ceil: (value) => call('ceil', [node(value)], rounded(dataType(value))),
		floor: (value) => call('floor', [node(value)], rounded(dataType(value))),
		trim: (text) => call('trim', [node(text)], new DataType('text')),
		ltrim: (text) => call('ltrim', [node(text)], new DataType('text')),
		rtrim: (text) => call('rtrim', [node(text)], new DataType('text')),
		substring: (text, start, count) =>
			call(
				'substring',
				[
					node(text),
					valueArg(start, codecs.int4),
					...(count === undefined ? [] : [valueArg(count, codecs.int4)]),
				],
				new DataType('text'),
			),
		replace: (text, from, to) =>
			call(
				'replace',
				[node(text), valueArg(from, codecs.text), valueArg(to, codecs.text)],
				new DataType('text'),
			),
		strpos: (text, search) =>
			call(
				'strpos',
				[node(text), valueArg(search, codecs.text)],
				new DataType('integer'),
			),
		left: (text, count) =>
			call(
				'left',
				[node(text), valueArg(count, codecs.int4)],
				new DataType('text'),
			),
		right: (text, count) =>
			call(
				'right',
				[node(text), valueArg(count, codecs.int4)],
				new DataType('text'),
			),
		splitPart: (text, delimiter, n) =>
			call(
				'split_part',
				[
					node(text),
					valueArg(delimiter, codecs.text),
					valueArg(n, codecs.int4),
				],
				new DataType('text'),
			),
		currentDate: () =>
			typedExpression(
				{ kind: 'raw', fragments: ['current_date'], nodes: [] },
				new DataType('date'),
			),
		dateTrunc: (unit, value) => {
			if (!DATE_UNITS.has(unit)) throw new Error(`Unknown date_trunc unit "${unit}"`);
			const { kind } = dataType(value);
			return call(
				'date_trunc',
				[{ kind: 'literal', value: unit }, node(value)],
				new DataType(kind === 'date' ? 'timestamptz' : kind),
			);
		},
		extract: (field, value) => {
			if (!DATE_FIELDS.has(field)) throw new Error(`Unknown extract field "${field}"`);
			return typedExpression(
				{
					kind: 'raw',
					fragments: [`extract(${field} from `, ')'],
					nodes: [node(value)],
				},
				new DataType('decimal'),
			);
		},
		toChar: (value, format) =>
			call(
				'to_char',
				[node(value), valueArg(format, codecs.text)],
				new DataType('text'),
			),
		cardinality: (array) =>
			call('cardinality', [node(array)], new DataType('integer')),
	};

	/** `greatest` or `least`: fallbacks that aren't references or expressions are values of the first's type. */
	function extreme(
		name: 'greatest' | 'least',
		first: Operand<R, Comparable>,
		rest: readonly unknown[],
	) {
		const type = dataType(first);
		const fallback = (arg: unknown): OperationNode =>
			typeof arg === 'string' ? node(arg) : valueArg(arg, type.codec);
		return call(name, [node(first), ...rest.map(fallback)], type);
	}
}

/**
 * An argument taken as a value: a plain value or parameter, sent with
 * `codec`, its type declared (postgres can't always infer a function
 * argument's), or an expression as is.
 */
function valueArg(value: unknown, codec: Codec): OperationNode {
	const inner = value instanceof Param ? value._quarry.value : value;
	if (inner === undefined) {
		throw new TypeError(
			'A function argument is undefined; for SQL NULL, pass null',
		);
	}
	if (value instanceof Param) {
		return {
			kind: 'value',
			value: inner,
			codec: value._quarry.codec ?? declareParamType(codec),
		};
	}
	return Expression.is(value)
		? value._quarry.node
		: { kind: 'value', value, codec: declareParamType(codec) };
}

/** The kind of `sum` of a value of kind `kind`; see `SumKind`. */
function sumKind(kind: Kind): Kind {
	if (kind === 'smallint' || kind === 'integer') return 'bigint';
	if (kind === 'bigint') return 'decimal';
	return kind;
}

/** The kind of `avg` of a value of kind `kind`; see `AvgKind`. */
function avgKind(kind: Kind): Kind {
	if (kind === 'real' || kind === 'double precision') return 'double precision';
	if (kind === 'interval') return 'interval';
	return 'decimal';
}

/** The type of `round`, `ceil` and `floor` of a value of type `type`; see `Rounded`. */
function rounded(type: DataType): DataType {
	return new DataType(type.kind === 'decimal' ? 'decimal' : 'double precision');
}
