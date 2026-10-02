import type { AnyColumn } from './column/any-column.js';
import type { DataType } from './data-type/data-type.js';
import type { Expression, Param, TypedExpression } from './expression.js';
import type { OperatorsByKind, ParamOperators } from './operators.js';
import type { AnyTable } from './table.js';

/**
 * The column references visible in some scope, keyed `table.column` (or
 * `alias.column` for aliased tables).
 */
export type Refs = Record<string, AnyColumn>;

type UnionToIntersection<U> = (
	U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
	? I
	: never;

/**
 * The references visible when the given tables are in scope: the merged
 * `$refs` of every table.
 */
export type RefsOf<T extends readonly AnyTable[]> =
	UnionToIntersection<T[number]['$refs']> extends infer R extends Refs
		? R
		: never;

/** A reference in scope. */
export type Ref<R extends Refs> = keyof R & string;

/** The references in scope whose column's SQL type is a `D`. */
export type RefsWith<R extends Refs, D extends DataType> = {
	[K in Ref<R>]: R[K]['dataType'] extends D ? K : never;
}[Ref<R>];

/**
 * Something whose SQL type is a `D`: a reference in scope or a typed
 * expression. This is what comparisons take on the left and functions take
 * as arguments. With the default `D`, anything whose SQL type is known
 * qualifies; a bare parameter (`eb.val`) does not.
 */
export type Operand<R extends Refs, D extends DataType = DataType> =
	// every reference qualifies for the default `D`: skip `RefsWith`'s scan
	(DataType extends D ? Ref<R> : RefsWith<R, D>) | TypedExpression<unknown, D>;

/*
 * The lookups below test `[A] extends [infer K extends Ref<R>]` rather than
 * `A extends Ref<R>`, for type-checking speed. The tuple stops them
 * distributing over a union `A`: while resolving a call, the compiler
 * instantiates them with an argument's constraint, `Operand<R>`, and a
 * distributive lookup would then run once for every reference in scope.
 * Inferring `K` and indexing `R[K]`, rather than `R[A]`, keeps the number of
 * types, and the memory, far lower.
 */

/** The type an operand evaluates to. */
export type TypeOf<R extends Refs, A> = [A] extends [infer K extends Ref<R>]
	? R[K]['$select']
	: A extends Expression<infer T>
		? T
		: never;

/** The SQL type of an operand. */
export type DataTypeOf<R extends Refs, A> = [A] extends [infer K extends Ref<R>]
	? R[K]['dataType']
	: A extends TypedExpression<unknown, infer D extends DataType>
		? D
		: never;

/** `null` if `T` admits it, otherwise nothing: how null propagates through SQL. */
export type NullOf<T> = Extract<T, null>;

/**
 * The operators an operand admits: those of its SQL type, at its non-null
 * value type. A parameter has no SQL type, so it only admits `any` / `all`
 * of an array on the right.
 */
export type OperatorsOf<R extends Refs, A> = [A] extends [
	infer K extends Ref<R>,
]
	? OperatorsByKind<
			NonNullable<R[K]['$select']>,
			R[K]['dataType']
		>[R[K]['dataType']['$kind']]
	: A extends TypedExpression<infer T, infer D extends DataType>
		? OperatorsByKind<NonNullable<T>, D>[D['$kind']]
		: A extends Param<unknown>
			? ParamOperators
			: never;
