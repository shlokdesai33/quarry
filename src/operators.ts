import type { ArrayType } from './data-type/array.js';
import type { DataType } from './data-type/data-type.js';
import type { CustomType } from './data-type/custom.js';
import type { EnumType } from './data-type/enum.js';
import type {
	Expression,
	Param,
	Quantified,
	TypedExpression,
} from './expression.js';
import type { CodecInput, CodecOutput } from './driver/codec.js';
import type { CodecKind, kindCodecs } from './kind-codecs.js';
import type { Range } from './range.js';

/**
 * The SQL types, by the name `DataType` records in `kind`. Each has an entry
 * in `MethodsByKind`.
 */
export type Kind =
	| 'smallint'
	| 'integer'
	| 'bigint'
	| 'decimal'
	| 'real'
	| 'double precision'
	| 'boolean'
	| 'text'
	| 'varchar'
	| 'uuid'
	| 'bytea'
	| 'date'
	| 'time'
	| 'timestamp'
	| 'timestamptz'
	| 'interval'
	| 'jsonb'
	| 'inet'
	| 'tsvector'
	| 'vector'
	| 'daterange'
	| 'tstzrange'
	| 'enum'
	| 'custom'
	| 'array';

/** The character types, which postgres compares with each other. */
export type TextKind = 'text' | 'varchar';

/** The numeric types, which postgres compares with each other. */
export type NumberKind =
	| 'smallint'
	| 'integer'
	| 'bigint'
	| 'decimal'
	| 'real'
	| 'double precision';

/** The date and timestamp types, which postgres compares with each other. */
export type TimestampKind = 'date' | 'timestamp' | 'timestamptz';

/** The types with a total ordering, which `min` and `max` take. */
export type OrderedKind =
	| NumberKind
	| TextKind
	| TimestampKind
	| 'time'
	| 'interval'
	| 'inet';

/**
 * A single operand: a non-null value of type `S` (`= null` is never true) or
 * an expression of SQL type `D` that evaluates to one (or to null). `D` is
 * what the operator accepts, e.g. any character type for a text column, so a
 * `uuid` expression is rejected even though its values are strings too.
 *
 * An expression is checked by its SQL type alone, as postgres checks it, so
 * its TypeScript type may differ from `S`: a narrowed `text` column compares
 * with a plain one, an `integer` with a `bigint` (a `string`), and branded
 * ids with each other whatever their brands. A value is always an `S`,
 * which `D` encodes.
 */
export type One<S, D extends DataType> = S | TypedExpression<unknown, D>;

/**
 * The operand of a binary operator: one operand, or `any(array)` /
 * `all(array)` of them, which holds if the operator does for some, or every,
 * element. As for `One`, values and parameters are `S`s, and an array
 * expression is checked by its element type alone. Postgres has no arrays of
 * arrays, so the operators of an array type take `One` instead.
 */
export type Binary<S, D extends DataType> =
	| One<S, D>
	| Quantified<S, D, null>
	| Quantified<unknown, D, null, true>;

/**
 * A list of operands, each a value or an expression, or an expression or
 * parameter that is an array of them as a whole.
 */
export type List<S, D extends DataType> =
	| readonly One<S, D>[]
	| TypedExpression<unknown, ArrayType<D>>
	| Param<readonly S[] | null>;

/** The point type of a range type `S`. */
type Point<S> = [S] extends [Range<infer P>] ? P : never;

/** A character operand: a pattern or a key. */
type Text = Binary<string, DataType<TextKind>>;

/**
 * Any value jsonb can hold: what the jsonb codec reads.
 */
export type { JsonValue } from './driver/binary.js';
import type { JsonValue } from './driver/binary.js';

/** The kinds postgres compares a value of kind `K` with. */
type Comparable<K extends Kind> = K extends TextKind
	? TextKind
	: K extends NumberKind
		? NumberKind
		: K extends TimestampKind
			? TimestampKind
			: K;

/**
 * The SQL types postgres compares a non-array type `D` with: those of a
 * comparable kind, or, for an enum, that enum alone.
 */
type ComparableType<D extends DataType> = D extends EnumType | CustomType
	? D
	: DataType<Comparable<D['kind']>>;

/**
 * The SQL type an element operand of the array data type `D` must have: any
 * type its element type compares with.
 */
type ElementOf<D> =
	D extends ArrayType<infer E extends DataType> ? ComparableType<E> : never;

/**
 * The SQL type an operand of an expression of SQL type `D` must have: any
 * type postgres compares it with.
 */
type OperandOf<D extends DataType> =
	D extends ArrayType<DataType> ? ArrayType<ElementOf<D>> : ComparableType<D>;

/**
 * What `=` takes against a value of non-null type `S` and SQL type `D`, as
 * in `where(column, value)` and `on`: nothing for a type without equality,
 * and no `any` / `all` for an array type, like its `eq`.
 */
export type EqualsValue<S, D extends DataType> = D['kind'] extends
	| 'tsvector'
	| 'vector'
	? never
	: D['kind'] extends 'array'
		? One<S, OperandOf<D>>
		: Binary<S, OperandOf<D>>;

/** A boolean expression, possibly null: a condition. */
export type AnyPredicate = Expression<boolean | null>;

/** A boolean expression, with its methods; nullable when `N` is `null`. */
export type Predicate<N extends null = never> = Expr<
	boolean | N,
	DataType<'boolean'>
>;

/**
 * `null` if the right-hand side of a comparison can be null: an expression or
 * parameter that can be, a list or pair holding one, or `any` / `all` of an
 * array that can be or can hold null.
 *
 * It looks one level into an array, the items of a list or pair, and no
 * further: those are single operands, and a value such as a JSON array
 * nests without end, so recursing would never stop on `JsonValue`.
 */
export type NullIn<V> = V extends readonly (infer I)[]
	? NullOfOperand<I>
	: NullOfOperand<V>;

/** `null` if one operand can be: an expression or parameter, or `any` / `all`. */
type NullOfOperand<V> =
	V extends Expression<infer T>
		? Extract<T, null>
		: V extends Quantified<unknown, DataType, infer N>
			? N
			: never;

/**
 * The methods of every expression. In SQL, `null` is "unknown", so `= null`
 * is never true; testing for it takes `isNull`, which is why no comparison
 * takes `null`.
 */
export interface NullMethods {
	/** `is null`: never null itself. */
	isNull(): Predicate;
	/** `is not null`: never null itself. */
	isNotNull(): Predicate;
}

/**
 * The methods of every type with equality, for a value of non-null type `S`.
 * An expression operand must have the SQL type `O`, e.g. any character type
 * for text, so a `uuid` expression is rejected even though its values are
 * strings too. The result is null when either side can be (`N` is `null`
 * when this side can), except for the null-safe methods. `Q` is what `=`
 * and `<>` take.
 */
export interface EqualityMethods<
	S,
	O extends DataType,
	N extends null,
	Q = Binary<S, O>,
> extends NullMethods {
	/** `=` */
	eq<V extends Q>(value: V): Predicate<N | NullIn<V>>;
	/** `<>` */
	ne<V extends Q>(value: V): Predicate<N | NullIn<V>>;
	/** `is distinct from`: `<>`, but null-safe: `null is distinct from 'x'` is true. */
	isDistinctFrom(value: One<S, O> | null): Predicate;
	/** `is not distinct from`: `=`, but null-safe: `null is not distinct from null` is true. */
	isNotDistinctFrom(value: One<S, O> | null): Predicate;
	/**
	 * `in`: equal to one of the values, or to an element of an array
	 * expression or parameter. False for an empty list.
	 */
	in<V extends List<S, O>>(values: V): Predicate<N | NullIn<V>>;
	/** `not in`: equal to none of the values. True for an empty list. */
	notIn<V extends List<S, O>>(values: V): Predicate<N | NullIn<V>>;
}

/** The methods of every type with a total ordering. */
export interface ComparableMethods<
	S,
	O extends DataType,
	N extends null,
> extends EqualityMethods<S, O, N> {
	/** `>` */
	gt<V extends Binary<S, O>>(value: V): Predicate<N | NullIn<V>>;
	/** `>=` */
	gte<V extends Binary<S, O>>(value: V): Predicate<N | NullIn<V>>;
	/** `<` */
	lt<V extends Binary<S, O>>(value: V): Predicate<N | NullIn<V>>;
	/** `<=` */
	lte<V extends Binary<S, O>>(value: V): Predicate<N | NullIn<V>>;
	/** `between low and high`, both bounds inclusive. */
	between<V extends readonly [One<S, O>, One<S, O>]>(
		bounds: V,
	): Predicate<N | NullIn<V>>;
	/** `not between low and high` */
	notBetween<V extends readonly [One<S, O>, One<S, O>]>(
		bounds: V,
	): Predicate<N | NullIn<V>>;
}

/**
 * The methods of the character types: ordering, by collation, and pattern
 * matching. A `like` pattern uses `%` for any sequence of characters and `_`
 * for exactly one.
 */
export interface TextMethods<
	S,
	O extends DataType,
	N extends null,
> extends ComparableMethods<S, O, N> {
	/** `like`: matches the pattern, case-sensitively. */
	like<V extends Text>(pattern: V): Predicate<N | NullIn<V>>;
	/** `not like`: does not match the pattern, case-sensitively. */
	notLike<V extends Text>(pattern: V): Predicate<N | NullIn<V>>;
	/** `ilike`: matches the pattern, case-insensitively. */
	ilike<V extends Text>(pattern: V): Predicate<N | NullIn<V>>;
	/** `not ilike`: does not match the pattern, case-insensitively. */
	notIlike<V extends Text>(pattern: V): Predicate<N | NullIn<V>>;
	/** `~`: matches the POSIX regular expression, case-sensitively. */
	regex<V extends Text>(pattern: V): Predicate<N | NullIn<V>>;
	/** `!~`: does not match the POSIX regular expression, case-sensitively. */
	notRegex<V extends Text>(pattern: V): Predicate<N | NullIn<V>>;
	/** `~*`: matches the POSIX regular expression, case-insensitively. */
	iregex<V extends Text>(pattern: V): Predicate<N | NullIn<V>>;
	/** `!~*`: does not match the POSIX regular expression, case-insensitively. */
	notIregex<V extends Text>(pattern: V): Predicate<N | NullIn<V>>;
	/**
	 * `^@`: starts with the prefix, taken literally, unlike a `like` pattern.
	 * Only an sp-gist index serves it.
	 */
	startsWith<V extends Text>(prefix: V): Predicate<N | NullIn<V>>;
}

/**
 * The methods of the boolean type, which is also the type of a comparison:
 * equality and the `is` tests. Conditions are combined by the builder's
 * `and`, `or` and `not`.
 */
export interface BooleanMethods<N extends null> extends EqualityMethods<
	boolean,
	DataType<'boolean'>,
	N
> {
	/** `is true`: never null itself. */
	isTrue(): Predicate;
	/** `is not true`: never null itself. */
	isNotTrue(): Predicate;
	/** `is false`: never null itself. */
	isFalse(): Predicate;
	/** `is not false`: never null itself. */
	isNotFalse(): Predicate;
}

/**
 * The methods of the range types. A point operand of `contains` must have the
 * SQL type `P`.
 */
export interface RangeMethods<
	S,
	O extends DataType,
	P extends DataType,
	N extends null,
> extends EqualityMethods<S, O, N> {
	/** `@>`: contains the range, or the single point. */
	contains<V extends Binary<S, O> | Binary<Point<S>, P>>(
		value: V,
	): Predicate<N | NullIn<V>>;
	/** `<@`: is contained by the range. */
	containedBy<V extends Binary<S, O>>(range: V): Predicate<N | NullIn<V>>;
	/** `&&`: has at least one point in common with the range. */
	overlaps<V extends Binary<S, O>>(range: V): Predicate<N | NullIn<V>>;
	/** `<<`: every point is below the range. */
	strictlyLeftOf<V extends Binary<S, O>>(range: V): Predicate<N | NullIn<V>>;
	/** `>>`: every point is above the range. */
	strictlyRightOf<V extends Binary<S, O>>(range: V): Predicate<N | NullIn<V>>;
	/** `&<`: the upper bound is at most the range's. */
	doesNotExtendRightOf<V extends Binary<S, O>>(
		range: V,
	): Predicate<N | NullIn<V>>;
	/** `&>`: the lower bound is at least the range's. */
	doesNotExtendLeftOf<V extends Binary<S, O>>(
		range: V,
	): Predicate<N | NullIn<V>>;
	/** `-|-`: touches the range without overlapping it. */
	adjacentTo<V extends Binary<S, O>>(range: V): Predicate<N | NullIn<V>>;
}

/**
 * The methods of the array types. `S` is the array type and `E` the SQL type
 * an element operand must have. Whether a value is an element is
 * `eb.val(x).eq(eb.fn.any(array))`.
 */
export interface ArrayMethods<
	S,
	E extends DataType,
	N extends null,
	// postgres has no arrays of arrays to take `any` / `all` of
> extends EqualityMethods<S, ArrayType<E>, N, One<S, ArrayType<E>>> {
	/** `@>`: every element of the array is present. */
	contains<V extends One<S, ArrayType<E>>>(array: V): Predicate<N | NullIn<V>>;
	/** `<@`: every element is present in the array. */
	containedBy<V extends One<S, ArrayType<E>>>(
		array: V,
	): Predicate<N | NullIn<V>>;
	/** `&&`: at least one element in common with the array. */
	overlaps<V extends One<S, ArrayType<E>>>(array: V): Predicate<N | NullIn<V>>;
}

/**
 * The methods of the jsonb type: those whose operand is jsonb too. The key and
 * path operators, and reading a field, are `eb.json` functions. `null` is SQL
 * `NULL`, so, as for `eq`, containment takes no top-level `null`.
 */
export interface JsonbMethods<S, N extends null> extends EqualityMethods<
	S,
	DataType<'jsonb'>,
	N
> {
	/** `@>`: the json is a subset of the value. */
	contains<V extends Binary<NonNullable<JsonValue>, DataType<'jsonb'>>>(
		json: V,
	): Predicate<N | NullIn<V>>;
	/** `<@`: the value is a subset of the json. */
	containedBy<V extends Binary<NonNullable<JsonValue>, DataType<'jsonb'>>>(
		json: V,
	): Predicate<N | NullIn<V>>;
}

/** The methods of the inet type: ordering, plus network containment. */
export interface InetMethods<S, N extends null> extends ComparableMethods<
	S,
	DataType<'inet'>,
	N
> {
	/** `<<`: is a strict subnet of the network. */
	isSubnetOf<V extends Binary<S, DataType<'inet'>>>(
		network: V,
	): Predicate<N | NullIn<V>>;
	/** `<<=`: is a subnet of the network, or equal to it. */
	isSubnetOrEqual<V extends Binary<S, DataType<'inet'>>>(
		network: V,
	): Predicate<N | NullIn<V>>;
	/** `>>`: strictly contains the network. */
	isSupernetOf<V extends Binary<S, DataType<'inet'>>>(
		network: V,
	): Predicate<N | NullIn<V>>;
	/** `>>=`: contains the network, or is equal to it. */
	isSupernetOrEqual<V extends Binary<S, DataType<'inet'>>>(
		network: V,
	): Predicate<N | NullIn<V>>;
	/** `&&`: either network contains the other. */
	overlaps<V extends Binary<S, DataType<'inet'>>>(
		network: V,
	): Predicate<N | NullIn<V>>;
}

/**
 * The methods of a type `defineType` declares: any operator, each taking a
 * value of the type or an expression of the same type. Postgres decides
 * which of them the type has.
 */
export interface CustomMethods<
	S,
	D extends DataType,
	N extends null,
> extends TextMethods<S, D, N> {
	/** `@>` */
	contains<V extends Binary<S, D>>(value: V): Predicate<N | NullIn<V>>;
	/** `<@` */
	containedBy<V extends Binary<S, D>>(value: V): Predicate<N | NullIn<V>>;
	/** `&&` */
	overlaps<V extends Binary<S, D>>(value: V): Predicate<N | NullIn<V>>;
	/** `<<` */
	strictlyLeftOf<V extends Binary<S, D>>(value: V): Predicate<N | NullIn<V>>;
	/** `>>` */
	strictlyRightOf<V extends Binary<S, D>>(value: V): Predicate<N | NullIn<V>>;
	/** `-|-` */
	adjacentTo<V extends Binary<S, D>>(value: V): Predicate<N | NullIn<V>>;
	/** `@@` */
	matches<V extends Binary<S, D>>(value: V): Predicate<N | NullIn<V>>;
}

/** The types postgres does exact arithmetic in, which have `%`. */
type ExactKind = 'smallint' | 'integer' | 'bigint' | 'decimal';

/** The largest of the exact numeric kinds `U`. */
type LargestExact<U> = 'decimal' extends U
	? 'decimal'
	: 'bigint' extends U
		? 'bigint'
		: 'integer' extends U
			? 'integer'
			: 'smallint';

/**
 * The kind of `a op b` for numeric kinds `A` and `B`, as postgres resolves
 * it: the larger of two exact kinds, and `double precision` once a
 * floating point kind meets another kind.
 */
export type WiderKind<A extends NumberKind, B extends NumberKind> = [
	A,
] extends [B]
	? A
	: [A | B] extends [ExactKind]
		? LargestExact<A | B>
		: 'double precision';

/** What a value of kind `K` arrives as, by the kind's codec. */
export type KindValue<K extends CodecKind> = CodecOutput<(typeof kindCodecs)[K]>;

/** What a value of kind `K` can be sent as, by the kind's codec. */
type KindInput<K extends CodecKind> = CodecInput<(typeof kindCodecs)[K]>;

/** The numeric kind of an arithmetic operand `V` against a value of kind `K`. */
type OperandKind<K extends NumberKind, V> =
	V extends TypedExpression<unknown, DataType<infer O extends NumberKind>>
		? O
		: K;

/** `left op right` for a left side of kind `K`, nullable when `N` is `null`. */
type Arithmetic<K extends NumberKind, N extends null, V> = Expr<
	KindValue<WiderKind<K, OperandKind<K, V>>> | N | NullIn<V>,
	DataType<WiderKind<K, OperandKind<K, V>>>
>;

/**
 * The arithmetic of the numeric types, for a value of kind `K`. A plain
 * value is sent as a `K`; with an expression of another numeric kind, the
 * result has the kind postgres gives it (`integer + bigint` is a `bigint`,
 * `integer + decimal` a `decimal`, anything with a float a `double
 * precision`). Division of two integers truncates, as in postgres.
 */
export interface NumberMethods<
	S,
	K extends NumberKind,
	N extends null,
> extends ComparableMethods<S, DataType<NumberKind>, N> {
	/** `+` */
	plus<V extends One<KindInput<K>, DataType<NumberKind>>>(
		value: V,
	): Arithmetic<K, N, V>;
	/** `-` */
	minus<V extends One<KindInput<K>, DataType<NumberKind>>>(
		value: V,
	): Arithmetic<K, N, V>;
	/** `*` */
	times<V extends One<KindInput<K>, DataType<NumberKind>>>(
		value: V,
	): Arithmetic<K, N, V>;
	/** `/`: truncates when both sides are integers. */
	dividedBy<V extends One<KindInput<K>, DataType<NumberKind>>>(
		value: V,
	): Arithmetic<K, N, V>;
}

/** The arithmetic of the exact numeric types: `NumberMethods`, and `%`. */
export interface ExactNumberMethods<
	S,
	K extends ExactKind,
	N extends null,
> extends NumberMethods<S, K, N> {
	/** `%`: the remainder, with the sign of the dividend. */
	mod<V extends One<KindInput<K>, DataType<ExactKind>>>(
		value: V,
	): Arithmetic<K, N, V>;
}

/** An interval operand: a value such as `'7 days'`, or an `interval` expression. */
type IntervalOperand = One<KindInput<'interval'>, DataType<'interval'>>;

/**
 * The arithmetic of `timestamp` and `timestamptz` (kind `K`): moving by an
 * interval, and the interval between two of them.
 */
export interface TimestampMethods<
	S,
	K extends 'timestamp' | 'timestamptz',
	N extends null,
> extends ComparableMethods<S, DataType<TimestampKind>, N> {
	/** `+ interval`: later by the interval. */
	plus<V extends IntervalOperand>(
		interval: V,
	): Expr<KindValue<K> | N | NullIn<V>, DataType<K>>;
	/** `- interval`: earlier by the interval. */
	minus<V extends IntervalOperand>(
		interval: V,
	): Expr<KindValue<K> | N | NullIn<V>, DataType<K>>;
	/** `- timestamp`: the interval between the two. */
	minus<V extends KindInput<K> | TypedExpression<unknown, DataType<K>>>(
		other: V,
	): Expr<KindValue<'interval'> | N | NullIn<V>, DataType<'interval'>>;
}

/** A whole number of days, as `date` arithmetic takes. */
type DaysOperand = One<number, DataType<'smallint' | 'integer'>>;

/** The arithmetic of `date`: moving by days, and the days between two dates. */
export interface DateMethods<S, N extends null> extends ComparableMethods<
	S,
	DataType<TimestampKind>,
	N
> {
	/** `+ days`: later by that many days. */
	plus<V extends DaysOperand>(
		days: V,
	): Expr<KindValue<'date'> | N | NullIn<V>, DataType<'date'>>;
	/** `- days`: earlier by that many days. */
	minus<V extends DaysOperand>(
		days: V,
	): Expr<KindValue<'date'> | N | NullIn<V>, DataType<'date'>>;
	/** `- date`: the number of days between the two. */
	minus<V extends TypedExpression<unknown, DataType<'date'>>>(
		other: V,
	): Expr<number | N | NullIn<V>, DataType<'integer'>>;
}

/** The arithmetic of `interval`. */
export interface IntervalMethods<S, N extends null> extends ComparableMethods<
	S,
	DataType<'interval'>,
	N
> {
	/** `+ interval` */
	plus<V extends IntervalOperand>(
		interval: V,
	): Expr<KindValue<'interval'> | N | NullIn<V>, DataType<'interval'>>;
	/** `- interval` */
	minus<V extends IntervalOperand>(
		interval: V,
	): Expr<KindValue<'interval'> | N | NullIn<V>, DataType<'interval'>>;
}

/** The methods of pgvector's `vector` type: the distances its indexes serve, each a `double precision`. */
export interface VectorMethods<S, N extends null> extends NullMethods {
	/** `<->`: the Euclidean (L2) distance. */
	l2Distance<V extends One<S, DataType<'vector'>>>(
		other: V,
	): Expr<number | N | NullIn<V>, DataType<'double precision'>>;
	/** `<=>`: the cosine distance, 1 minus the cosine similarity. */
	cosineDistance<V extends One<S, DataType<'vector'>>>(
		other: V,
	): Expr<number | N | NullIn<V>, DataType<'double precision'>>;
	/**
	 * `<#>`: the negative inner product, so that ascending order puts the
	 * largest inner product first, as pgvector's index scans do.
	 */
	innerProduct<V extends One<S, DataType<'vector'>>>(
		other: V,
	): Expr<number | N | NullIn<V>, DataType<'double precision'>>;
}

/** The methods of the tsvector type. */
export interface TsvectorMethods<N extends null> extends NullMethods {
	/** `@@`: matches the tsquery, e.g. `'fat & rat'`. */
	matches(query: string | Param<string>): Predicate<N>;
}

/**
 * The methods of each SQL type, keyed by its kind, for non-null values of
 * type `S`; `N` is `null` when the value can be. `D` is the data type itself,
 * for the methods that depend on more than its kind (an array's element
 * type).
 */
export interface MethodsByKind<S, D extends DataType, N extends null> {
	smallint: ExactNumberMethods<S, 'smallint', N>;
	integer: ExactNumberMethods<S, 'integer', N>;
	bigint: ExactNumberMethods<S, 'bigint', N>;
	decimal: ExactNumberMethods<S, 'decimal', N>;
	real: NumberMethods<S, 'real', N>;
	'double precision': NumberMethods<S, 'double precision', N>;
	boolean: BooleanMethods<N>;
	text: TextMethods<S, DataType<TextKind>, N>;
	varchar: TextMethods<S, DataType<TextKind>, N>;
	uuid: EqualityMethods<S, DataType<'uuid'>, N>;
	bytea: EqualityMethods<S, DataType<'bytea'>, N>;
	date: DateMethods<S, N>;
	time: ComparableMethods<S, DataType<'time'>, N>;
	timestamp: TimestampMethods<S, 'timestamp', N>;
	timestamptz: TimestampMethods<S, 'timestamptz', N>;
	interval: IntervalMethods<S, N>;
	jsonb: JsonbMethods<S, N>;
	inet: InetMethods<S, N>;
	tsvector: TsvectorMethods<N>;
	vector: VectorMethods<S, N>;
	daterange: RangeMethods<S, DataType<'daterange'>, DataType<'date'>, N>;
	tstzrange: RangeMethods<S, DataType<'tstzrange'>, DataType<TimestampKind>, N>;
	enum: EqualityMethods<S, ComparableType<D>, N>;
	custom: CustomMethods<S, ComparableType<D>, N>;
	array: ArrayMethods<S, ElementOf<D>, N>;
}

/**
 * An expression of type `T` and SQL type `D`, with the methods of its kind:
 * what a reference, a function call or a comparison is.
 *
 * The lookup sits behind `extends infer` so it waits until `D` is known.
 * Where `D` is still generic, as in the declared return type of
 * `ref<C>(column: C)`, indexing by its kind would instantiate the methods of
 * every kind once per scope.
 */
export type Expr<T, D extends DataType> = TypedExpression<T, D> &
	(MethodsByKind<NonNullable<T>, D, Extract<T, null>>[D['kind']] extends infer M
		? M
		: never);

/**
 * `any` / `all` of an array whose elements have a SQL type of `D`, as a
 * parameter compares with: only an array column or expression, whose
 * element type encodes the parameter. A parameter of type `T` must fit the
 * elements' type; otherwise the argument fails to type-check.
 */
type ParamArray<T, D extends DataType, V> = V &
	(V extends Quantified<infer S, DataType, null, true>
		? [NonNullable<T>] extends [S]
			? unknown
			: { readonly elementType: S }
		: never);

/** The range types. */
type RangeType = DataType<'daterange' | 'tstzrange'>;

/** A comparison of a parameter of type `T` with `any` / `all` of an array of SQL type `D`. */
type ParamComparison<T, D extends DataType> = <
	V extends Quantified<unknown, D, null, true>,
>(
	array: ParamArray<T, D, V>,
) => Predicate<Extract<T, null> | NullIn<V>>;

/**
 * The methods of a parameter, as in `eb.val('a').eq(eb.fn.any('users.tags'))`:
 * every comparison that takes `any` / `all`, each with `any` / `all` of an
 * array column or expression, whose elements have a SQL type with that
 * comparison and a TypeScript type the parameter fits. A parameter has no
 * SQL type of its own, so the elements' SQL type encodes it.
 */
export interface ParamMethods<T> {
	/** `=` */
	readonly eq: ParamComparison<T, DataType>;
	/** `<>` */
	readonly ne: ParamComparison<T, DataType>;
	/** `>` */
	readonly gt: ParamComparison<T, DataType<OrderedKind>>;
	/** `>=` */
	readonly gte: ParamComparison<T, DataType<OrderedKind>>;
	/** `<` */
	readonly lt: ParamComparison<T, DataType<OrderedKind>>;
	/** `<=` */
	readonly lte: ParamComparison<T, DataType<OrderedKind>>;
	/** `like` */
	readonly like: ParamComparison<T, DataType<TextKind>>;
	/** `not like` */
	readonly notLike: ParamComparison<T, DataType<TextKind>>;
	/** `ilike` */
	readonly ilike: ParamComparison<T, DataType<TextKind>>;
	/** `not ilike` */
	readonly notIlike: ParamComparison<T, DataType<TextKind>>;
	/** `~` */
	readonly regex: ParamComparison<T, DataType<TextKind>>;
	/** `!~` */
	readonly notRegex: ParamComparison<T, DataType<TextKind>>;
	/** `~*` */
	readonly iregex: ParamComparison<T, DataType<TextKind>>;
	/** `!~*` */
	readonly notIregex: ParamComparison<T, DataType<TextKind>>;
	/** `^@` */
	readonly startsWith: ParamComparison<T, DataType<TextKind>>;
	/** `@>`: the range or jsonb value contains an element. */
	readonly contains: ParamComparison<T, RangeType | DataType<'jsonb'>>;
	/** `<@`: the range or jsonb value is contained by an element. */
	readonly containedBy: ParamComparison<T, RangeType | DataType<'jsonb'>>;
	/** `&&`: the range or network overlaps an element. */
	readonly overlaps: ParamComparison<T, RangeType | DataType<'inet'>>;
	/** `<<` (ranges) */
	readonly strictlyLeftOf: ParamComparison<T, RangeType>;
	/** `>>` (ranges) */
	readonly strictlyRightOf: ParamComparison<T, RangeType>;
	/** `&<` */
	readonly doesNotExtendRightOf: ParamComparison<T, RangeType>;
	/** `&>` */
	readonly doesNotExtendLeftOf: ParamComparison<T, RangeType>;
	/** `-|-` */
	readonly adjacentTo: ParamComparison<T, RangeType>;
	/** `<<`: is a strict subnet of an element. */
	readonly isSubnetOf: ParamComparison<T, DataType<'inet'>>;
	/** `<<=` */
	readonly isSubnetOrEqual: ParamComparison<T, DataType<'inet'>>;
	/** `>>` */
	readonly isSupernetOf: ParamComparison<T, DataType<'inet'>>;
	/** `>>=` */
	readonly isSupernetOrEqual: ParamComparison<T, DataType<'inet'>>;
}

/** A parameter, with the methods a parameter has. */
export type Value<T> = Param<T> & ParamMethods<T>;
