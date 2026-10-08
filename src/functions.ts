import { ArrayType } from './data-type/array.js';
import { DataType } from './data-type/data-type.js';
import {
	Expression,
	type Param,
	Quantified,
	TypedExpression,
} from './expression.js';
import { typedExpression } from './expression-methods.js';
import type { OperationNode } from './node.js';
import type { Expr, Kind, OrderedKind, TextKind } from './operators.js';
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
}

type CastType = keyof CastValues;

/** The kind of each target of `cast`, keyed by SQL name. */
const CAST_KINDS = {
	text: 'text',
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
}

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
		coalesce: (first, ...rest) =>
			call('coalesce', [first, ...rest].map(node), dataType(first)),
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
	};
}
