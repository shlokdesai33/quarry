import type { AnyColumn } from './column/any-column.js';
import type { DataType } from './data-type/data-type.js';
import type { Expression, TypedExpression } from './expression.js';
import type { AnyTable } from './table.js';

/**
 * The column references visible in some scope, keyed `table.column` (or
 * `alias.column` for aliased tables).
 */
export type Refs = Record<string, AnyColumn>;

/**
 * The references visible when the given tables are in scope: the merged
 * `$refs` of every table.
 */
export type RefsOf<T extends readonly AnyTable[]> =
	RefsOfTuple<T> extends infer R extends Refs ? R : never;

/**
 * The `$refs` of `T`, merged as those of all but the last table and then the
 * last's, for type-checking speed. A join's tables are the previous scope's
 * plus one, so each scope reuses the merge of the one before it rather than
 * merging every table again: a join chain then costs linear rather than
 * quadratic time in its length.
 */
type RefsOfTuple<T extends readonly AnyTable[]> = T extends readonly [
	...infer Init extends readonly AnyTable[],
	infer Last extends AnyTable,
]
	? RefsOfTuple<Init> & Last['$refs']
	: unknown;

/** A reference in scope. */
export type Ref<R extends Refs> = keyof R & string;

/** The references in scope whose column's SQL type is a `D`. */
export type RefsWith<R extends Refs, D extends DataType> = {
	[K in Ref<R>]: R[K]['_quarry']['dataType'] extends D ? K : never;
}[Ref<R>];

/**
 * Something whose SQL type is a `D`: a reference in scope or a typed
 * expression. This is what functions take as arguments. With the default `D`, anything whose SQL type is known
 * qualifies; a bare parameter (`eb.val`) does not.
 */
export type Operand<R extends Refs, D extends DataType = DataType> =
	// every reference qualifies for the default `D`: skip `RefsWith`'s scan
	(DataType extends D ? Ref<R> : RefsWith<R, D>) | TypedExpression<unknown, D>;

/** The type an operand evaluates to. */
export type TypeOf<R extends Refs, A> =
	A extends Ref<R>
		? R[A]['$select']
		: A extends Expression<infer T>
			? T
			: never;

/** The SQL type of an operand. */
export type DataTypeOf<R extends Refs, A> =
	A extends Ref<R>
		? R[A]['_quarry']['dataType']
		: A extends TypedExpression<unknown, infer D extends DataType>
			? D
			: never;

/** `null` if `T` admits it, otherwise nothing: how null propagates through SQL. */
export type NullOf<T> = Extract<T, null>;
