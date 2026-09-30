import type { Range } from './range.js';

/**
 * Operators every type supports. In SQL, `null` is "unknown", so `= null` is
 * never true; `is null` is the only way to test for it. These are typed as
 * `null` so that mistake cannot be expressed.
 */
export interface NullOperators {
	// `is null`: the column has no value
	is: null;
	// `is not null`: the column has a value
	'is not': null;
}

/**
 * Operators shared by every type that supports equality.
 */
export interface EqualityOperators<T> extends NullOperators {
	// equal to
	'=': T;
	// not equal to (the SQL-standard spelling)
	'<>': T;
	// not equal to (postgres alias for `<>`)
	'!=': T;
	// null-safe not equal: `null is distinct from 'x'` is true
	'is distinct from': T | null;
	// null-safe equal: `null is not distinct from null` is true
	'is not distinct from': T | null;
	// equal to any of the given values
	in: T[];
	// equal to none of the given values
	'not in': T[];
}

/**
 * Operators of the boolean type: equality, plus `is` widened to take a
 * boolean. Also the type of a comparison, so predicates can be compared.
 */
export interface BooleanOperators {
	// `is true` / `is false` / `is null` (never yields unknown)
	is: boolean | null;
	// `is not true` / `is not false` / `is not null` (never yields unknown)
	'is not': boolean | null;
	// equal to
	'=': boolean;
	// not equal to (the SQL-standard spelling)
	'<>': boolean;
	// not equal to (postgres alias for `<>`)
	'!=': boolean;
	// null-safe not equal: `null is distinct from 'x'` is true
	'is distinct from': boolean | null;
	// null-safe equal: `null is not distinct from null` is true
	'is not distinct from': boolean | null;
	// equal to any of the given values
	in: boolean[];
	// equal to none of the given values
	'not in': boolean[];
}

/**
 * Operators shared by every type with a total ordering.
 */
export interface ComparableOperators<T> extends EqualityOperators<T> {
	// greater than
	'>': T;
	// greater than or equal to
	'>=': T;
	// less than
	'<': T;
	// less than or equal to
	'<=': T;
	// within `[low, high]`, both bounds inclusive
	between: [T, T];
	// outside `[low, high]`
	'not between': [T, T];
}

/**
 * Operators shared by the character types: ordering (by collation) and
 * pattern matching. Patterns use `%` for any sequence of characters and `_`
 * for exactly one.
 */
export interface TextOperators<T> extends ComparableOperators<T> {
	// matches the pattern, case-sensitively
	like: string;
	// does not match the pattern, case-sensitively
	'not like': string;
	// matches the pattern, case-insensitively
	ilike: string;
	// does not match the pattern, case-insensitively
	'not ilike': string;
	// matches the POSIX regular expression, case-sensitively
	'~': string;
	// matches the POSIX regular expression, case-insensitively
	'~*': string;
	// does not match the POSIX regular expression, case-sensitively
	'!~': string;
	// does not match the POSIX regular expression, case-insensitively
	'!~*': string;
	// starts with the given literal prefix (sp-gist only); unlike `like 'x%'`
	'^@': string;
}

/**
 * Operators shared by the range types.
 */
export interface RangeOperators<T> extends EqualityOperators<T> {
	// contains the given range, or the given single point. The tuple wrapper
	// stops the conditional distributing over the two variants of `Range`, one
	// of which has no point type and would otherwise infer `unknown`.
	'@>': T | ([T] extends [Range<infer K>] ? K : never);
	// is contained by the given range
	'<@': T;
	// overlaps: the ranges have at least one point in common
	'&&': T;
	// strictly left of: every point is below the given range
	'<<': T;
	// strictly right of: every point is above the given range
	'>>': T;
	// does not extend to the right of: upper bound is at most the given range's
	'&<': T;
	// does not extend to the left of: lower bound is at least the given range's
	'&>': T;
	// adjacent to: the ranges touch without overlapping
	'-|-': T;
}

/**
 * Operators of the array types. `T` is the array type; `= any` and `<> all`
 * take a single element.
 */
export interface ArrayOperators<T> extends EqualityOperators<T> {
	// contains: every element of the given array is present
	'@>': T;
	// is contained by: every element is present in the given array
	'<@': T;
	// overlaps: at least one element in common with the given array
	'&&': T;
	// `x = any(col)`: the given element is present
	'= any': T extends readonly (infer E)[] ? E : never;
	// `x <> all(col)`: the given element is absent
	'<> all': T extends readonly (infer E)[] ? E : never;
}

/**
 * Any value jsonb can hold.
 */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/**
 * Operators of the jsonb type.
 */
export interface JsonbOperators<T> extends EqualityOperators<T> {
	// contains: the given json is a subset of the value
	'@>': JsonValue;
	// is contained by: the value is a subset of the given json
	'<@': JsonValue;
	// the given string is a top-level key (or an element, for arrays)
	'?': string;
	// any of the given strings is a top-level key
	'?|': string[];
	// all of the given strings are top-level keys
	'?&': string[];
	// the jsonpath yields at least one item, e.g. `'$.tags[*] ? (@ == "a")'`
	'@?': string;
	// the jsonpath predicate is true, e.g. `'$.price > 10'`
	'@@': string;
}

/**
 * Operators of the inet type: ordering, plus network containment.
 */
export interface InetOperators<T> extends ComparableOperators<T> {
	// is a strict subnet of the given network
	'<<': T;
	// is a subnet of, or equal to, the given network
	'<<=': T;
	// strictly contains the given network
	'>>': T;
	// contains, or is equal to, the given network
	'>>=': T;
	// either network contains the other
	'&&': T;
}

/**
 * Operators of the tsvector type.
 */
export interface TsvectorOperators extends NullOperators {
	// matches the given tsquery, e.g. `'fat & rat'`
	'@@': string;
}
