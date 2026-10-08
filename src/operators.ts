import type { ArrayType } from './data-type/array.js';
import type { DataType } from './data-type/data-type.js';
import type { EnumType } from './data-type/enum.js';
import type {
	Expression,
	Param,
	Quantified,
	TypedExpression,
} from './expression.js';
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
 * Any value jsonb can hold.
 */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| readonly JsonValue[]
	| { [key: string]: JsonValue };

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
type ComparableType<D extends DataType> = D extends EnumType
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
 * equality, the `is` tests, and combining conditions. `and` and `or` group
 * left to right, so `a.or(b).and(c)` is `(a or b) and c`.
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
	/** `this and other` */
	and<V extends AnyPredicate>(other: V): Predicate<N | NullIn<V>>;
	/** `this or other` */
	or<V extends AnyPredicate>(other: V): Predicate<N | NullIn<V>>;
	/** `not this` */
	not(): Predicate<N>;
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
	smallint: ComparableMethods<S, DataType<NumberKind>, N>;
	integer: ComparableMethods<S, DataType<NumberKind>, N>;
	bigint: ComparableMethods<S, DataType<NumberKind>, N>;
	decimal: ComparableMethods<S, DataType<NumberKind>, N>;
	real: ComparableMethods<S, DataType<NumberKind>, N>;
	'double precision': ComparableMethods<S, DataType<NumberKind>, N>;
	boolean: BooleanMethods<N>;
	text: TextMethods<S, DataType<TextKind>, N>;
	varchar: TextMethods<S, DataType<TextKind>, N>;
	uuid: EqualityMethods<S, DataType<'uuid'>, N>;
	bytea: EqualityMethods<S, DataType<'bytea'>, N>;
	date: ComparableMethods<S, DataType<TimestampKind>, N>;
	time: ComparableMethods<S, DataType<'time'>, N>;
	timestamp: ComparableMethods<S, DataType<TimestampKind>, N>;
	timestamptz: ComparableMethods<S, DataType<TimestampKind>, N>;
	interval: ComparableMethods<S, DataType<'interval'>, N>;
	jsonb: JsonbMethods<S, N>;
	inet: InetMethods<S, N>;
	tsvector: TsvectorMethods<N>;
	vector: NullMethods;
	daterange: RangeMethods<S, DataType<'daterange'>, DataType<'date'>, N>;
	tstzrange: RangeMethods<S, DataType<'tstzrange'>, DataType<TimestampKind>, N>;
	enum: EqualityMethods<S, ComparableType<D>, N>;
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
 * The methods of a parameter, as in `eb.val('a').eq(eb.fn.any('users.tags'))`:
 * every comparison that takes `any` / `all` for some SQL type, each taking
 * `any` / `all` of any array. A parameter has no SQL type of its own, so
 * neither the method nor the value is checked against the elements yet; the
 * elements' SQL type encodes it.
 */
export interface ParamMethods<T> {
	/** `=` */
	eq<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `<>` */
	ne<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `>` */
	gt<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `>=` */
	gte<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `<` */
	lt<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `<=` */
	lte<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `like` */
	like<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `not like` */
	notLike<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `ilike` */
	ilike<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `not ilike` */
	notIlike<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `~` */
	regex<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `!~` */
	notRegex<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `~*` */
	iregex<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `!~*` */
	notIregex<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `^@` */
	startsWith<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `@>` */
	contains<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `<@` */
	containedBy<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `&&` */
	overlaps<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `<<` (ranges) */
	strictlyLeftOf<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `>>` (ranges) */
	strictlyRightOf<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `&<` */
	doesNotExtendRightOf<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `&>` */
	doesNotExtendLeftOf<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `-|-` */
	adjacentTo<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `<<` (inet) */
	isSubnetOf<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `<<=` */
	isSubnetOrEqual<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `>>` (inet) */
	isSupernetOf<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
	/** `>>=` */
	isSupernetOrEqual<V extends Quantified<unknown, DataType, null>>(
		array: V,
	): Predicate<Extract<T, null> | NullIn<V>>;
}

/** A parameter, with the methods a parameter has. */
export type Value<T> = Param<T> & ParamMethods<T>;
