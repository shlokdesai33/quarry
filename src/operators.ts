import type { ArrayType } from './data-type/array.js';
import type { DataType } from './data-type/data-type.js';
import type { Param, Quantified, TypedExpression } from './expression.js';
import type { Range } from './range.js';

/**
 * The SQL types, by the name `DataType` records in `$kind`. Each has an entry
 * in `OperatorsByKind`.
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
 * A single operand: a non-null value of type `S` (`= null` is never true), an
 * expression of SQL type `D` that evaluates to one (or to null), or a
 * parameter. `D` is what the operator accepts, e.g. any character type for a
 * text column, so a `uuid` expression is rejected even though its values are
 * strings too.
 */
export type One<S, D extends DataType> =
	| S
	| TypedExpression<S | null, D>
	| Param<S | null>;

/**
 * The operand of a binary operator: one operand, or `any(array)` /
 * `all(array)` of them, which holds if the operator does for some, or every,
 * element. Postgres has no arrays of arrays, so an operand that is itself an
 * array is never quantified.
 */
export type Binary<S, D extends DataType> =
	| One<S, D>
	| (D extends DataType<'array'> ? never : Quantified<S, D, null>);

/**
 * A list of operands, each a value or an expression, or an expression or
 * parameter that is an array of them as a whole.
 */
export type List<S, D extends DataType> =
	| readonly One<S, D>[]
	| TypedExpression<readonly S[] | null, ArrayType<D>>
	| Param<readonly S[] | null>;

/** The point type of a range type `S`. */
type Point<S> = [S] extends [Range<infer P>] ? P : never;

/** A character operand: a pattern or a key. */
type Text = Binary<string, DataType<TextKind>>;

/**
 * Operators every type supports. In SQL, `null` is "unknown", so `= null` is
 * never true; `is null` is the only way to test for it. These are typed as
 * `null` so that mistake cannot be expressed, and take no expression because
 * postgres only allows a keyword after `is`.
 */
export interface NullOperators {
	// `is null`: the column has no value
	is: null;
	// `is not null`: the column has a value
	'is not': null;
}

/**
 * Operators shared by every type that supports equality. `S` is the value
 * type and `D` the SQL type an expression operand must have.
 */
export interface EqualityOperators<S, D extends DataType>
	//
	extends NullOperators {
	// equal to
	'=': Binary<S, D>;
	// not equal to (the SQL-standard spelling)
	'<>': Binary<S, D>;
	// not equal to (postgres alias for `<>`)
	'!=': Binary<S, D>;
	// null-safe not equal: `null is distinct from 'x'` is true
	'is distinct from': One<S, D> | null;
	// null-safe equal: `null is not distinct from null` is true
	'is not distinct from': One<S, D> | null;
	// equal to any of the given values
	in: List<S, D>;
	// equal to none of the given values
	'not in': List<S, D>;
}

/**
 * Operators of the boolean type: equality, plus `is` widened to take a
 * boolean. Also the type of a comparison, so predicates can be compared.
 */
export interface BooleanOperators extends Omit<
	EqualityOperators<boolean, DataType<'boolean'>>,
	'is' | 'is not'
> {
	// `is true` / `is false` / `is null` (never yields unknown)
	is: boolean | null;
	// `is not true` / `is not false` / `is not null` (never yields unknown)
	'is not': boolean | null;
}

/**
 * Operators shared by every type with a total ordering.
 */
export interface ComparableOperators<S, D extends DataType>
	//
	extends EqualityOperators<S, D> {
	// greater than
	'>': Binary<S, D>;
	// greater than or equal to
	'>=': Binary<S, D>;
	// less than
	'<': Binary<S, D>;
	// less than or equal to
	'<=': Binary<S, D>;
	// within `[low, high]`, both bounds inclusive
	between: readonly [One<S, D>, One<S, D>];
	// outside `[low, high]`
	'not between': readonly [One<S, D>, One<S, D>];
}

/**
 * Operators shared by the character types: ordering (by collation) and
 * pattern matching. Patterns use `%` for any sequence of characters and `_`
 * for exactly one.
 */
export interface TextOperators<S, D extends DataType>
	//
	extends ComparableOperators<S, D> {
	// matches the pattern, case-sensitively
	like: Text;
	// does not match the pattern, case-sensitively
	'not like': Text;
	// matches the pattern, case-insensitively
	ilike: Text;
	// does not match the pattern, case-insensitively
	'not ilike': Text;
	// matches the POSIX regular expression, case-sensitively
	'~': Text;
	// matches the POSIX regular expression, case-insensitively
	'~*': Text;
	// does not match the POSIX regular expression, case-sensitively
	'!~': Text;
	// does not match the POSIX regular expression, case-insensitively
	'!~*': Text;
	// starts with the given literal prefix (sp-gist only); unlike `like 'x%'`
	'^@': Text;
}

/**
 * Operators shared by the range types. `P` is the SQL type a point operand
 * must have.
 */
export interface RangeOperators<S, D extends DataType, P extends DataType>
	//
	extends EqualityOperators<S, D> {
	// contains the given range, or the given single point
	'@>': Binary<S, D> | Binary<Point<S>, P>;
	// is contained by the given range
	'<@': Binary<S, D>;
	// overlaps: the ranges have at least one point in common
	'&&': Binary<S, D>;
	// strictly left of: every point is below the given range
	'<<': Binary<S, D>;
	// strictly right of: every point is above the given range
	'>>': Binary<S, D>;
	// does not extend to the right of: upper bound is at most the given range's
	'&<': Binary<S, D>;
	// does not extend to the left of: lower bound is at least the given range's
	'&>': Binary<S, D>;
	// adjacent to: the ranges touch without overlapping
	'-|-': Binary<S, D>;
}

/**
 * Operators of the array types. `S` is the array type and `E` the SQL type
 * an element operand must have. Whether a value is an element is
 * `eb(eb.val(x), '=', eb.fn.any(col))`.
 */
export interface ArrayOperators<S, E extends DataType>
	//
	extends EqualityOperators<S, ArrayType<E>> {
	// contains: every element of the given array is present
	'@>': One<S, ArrayType<E>>;
	// is contained by: every element is present in the given array
	'<@': One<S, ArrayType<E>>;
	// overlaps: at least one element in common with the given array
	'&&': One<S, ArrayType<E>>;
}

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

/**
 * Operators of the jsonb type: those whose operand is jsonb too. The key and
 * path operators, and extracting a field, are `eb.json` functions. `null` is
 * SQL `NULL`, so, as for `=`, containment takes no top-level `null`.
 */
export interface JsonbOperators<S>
	//
	extends EqualityOperators<S, DataType<'jsonb'>> {
	// contains: the given json is a subset of the value
	'@>': Binary<NonNullable<JsonValue>, DataType<'jsonb'>>;
	// is contained by: the value is a subset of the given json
	'<@': Binary<NonNullable<JsonValue>, DataType<'jsonb'>>;
}

/**
 * Operators of the inet type: ordering, plus network containment.
 */
export interface InetOperators<S>
	//
	extends ComparableOperators<S, DataType<'inet'>> {
	// is a strict subnet of the given network
	'<<': Binary<S, DataType<'inet'>>;
	// is a subnet of, or equal to, the given network
	'<<=': Binary<S, DataType<'inet'>>;
	// strictly contains the given network
	'>>': Binary<S, DataType<'inet'>>;
	// contains, or is equal to, the given network
	'>>=': Binary<S, DataType<'inet'>>;
	// either network contains the other
	'&&': Binary<S, DataType<'inet'>>;
}

/**
 * Operators of the tsvector type.
 */
export interface TsvectorOperators extends NullOperators {
	// matches the given tsquery, e.g. `'fat & rat'`
	'@@': string | Param<string>;
}

/** The kinds postgres compares a value of kind `K` with. */
type Comparable<K extends Kind> = K extends TextKind
	? TextKind
	: K extends NumberKind
		? NumberKind
		: K extends TimestampKind
			? TimestampKind
			: K;

/**
 * The SQL type an element operand of the array data type `D` must have: any
 * type its element type compares with.
 */
type ElementOf<D> =
	D extends ArrayType<infer E extends DataType>
		? DataType<Comparable<E['$kind']>>
		: never;

/**
 * The operators of each SQL type, keyed by its kind, for non-null values of
 * type `S`. `D` is the data type itself, for the operators that depend on
 * more than its kind (an array's element type).
 */
export interface OperatorsByKind<S, D extends DataType> {
	smallint: ComparableOperators<S, DataType<NumberKind>>;
	integer: ComparableOperators<S, DataType<NumberKind>>;
	bigint: ComparableOperators<S, DataType<NumberKind>>;
	decimal: ComparableOperators<S, DataType<NumberKind>>;
	real: ComparableOperators<S, DataType<NumberKind>>;
	'double precision': ComparableOperators<S, DataType<NumberKind>>;
	boolean: BooleanOperators;
	text: TextOperators<S, DataType<TextKind>>;
	varchar: TextOperators<S, DataType<TextKind>>;
	uuid: EqualityOperators<S, DataType<'uuid'>>;
	bytea: EqualityOperators<S, DataType<'bytea'>>;
	date: ComparableOperators<S, DataType<TimestampKind>>;
	time: ComparableOperators<S, DataType<'time'>>;
	timestamp: ComparableOperators<S, DataType<TimestampKind>>;
	timestamptz: ComparableOperators<S, DataType<TimestampKind>>;
	interval: ComparableOperators<S, DataType<'interval'>>;
	jsonb: JsonbOperators<S>;
	inet: InetOperators<S>;
	tsvector: TsvectorOperators;
	vector: NullOperators;
	daterange: RangeOperators<S, DataType<'daterange'>, DataType<'date'>>;
	tstzrange: RangeOperators<S, DataType<'tstzrange'>, DataType<TimestampKind>>;
	enum: EqualityOperators<S, DataType<'enum'>>;
	array: ArrayOperators<S, ElementOf<D>>;
}

/** The operators in `T` that take `any` / `all` on the right. */
type QuantifiableIn<T> = {
	[O in keyof T & string]: [
		Extract<T[O], Quantified<unknown, DataType, null>>,
	] extends [never]
		? never
		: O;
}[keyof T & string];

/**
 * The operators of a parameter, as in `eb(eb.val('a'), '=',
 * eb.fn.any('users.tags'))`: every operator that takes `any` / `all` for
 * some SQL type, each taking `any` / `all` of any array. A parameter has no
 * SQL type of its own, so neither the operator nor the value is checked
 * against the elements yet. The same for every parameter, so it is computed
 * once.
 */
export type ParamOperators = {
	// `never` as the value type: `unknown` would absorb each slot's union
	readonly [
		O in {
			[K in Kind]: QuantifiableIn<OperatorsByKind<never, DataType<K>>[K]>;
		}[Kind]
	]: Quantified<unknown, DataType, null>;
};
