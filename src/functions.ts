import { BooleanType } from './data-type/boolean.js';
import { TextType } from './data-type/character.js';
import type { DataType } from './data-type/data-type.js';
import {
	DateType,
	TimestampType,
	TimestampTzType,
} from './data-type/datetime.js';
import {
	BigIntType,
	DecimalType,
	DoublePrecisionType,
	IntegerType,
	RealType,
} from './data-type/numeric.js';
import { UUIDType } from './data-type/uuid.js';
import { type Expression, TypedExpression } from './expression.js';
import type { OperationNode } from './node.js';
import type { ComparableOperators, TextOperators } from './operators.js';
import type { DataTypeOf, NullOf, Operand, Ref, Refs, TypeOf } from './refs.js';

/** The constraint for text arguments: any SQL type with the text operators. */
type Text = DataType & { readonly $operators: TextOperators<unknown> };

/** The constraint for arguments that need an ordering. */
type Comparable = DataType & {
	readonly $operators: ComparableOperators<unknown>;
};

/** The last element of a tuple. */
type Last<T extends readonly unknown[]> = T extends readonly [
	...unknown[],
	infer L,
]
	? L
	: never;

/**
 * What may follow the first argument of `coalesce`: an operand of the same
 * SQL type, or any expression of the same value type (so `eb.val` works).
 */
type Fallback<R extends Refs, First> =
	| Operand<R, DataTypeOf<R, First>>
	| Expression<TypeOf<R, First>>;

/**
 * The types an expression can be cast to, keyed by SQL name.
 */
interface CastTypes {
	text: TextType;
	integer: IntegerType;
	bigint: BigIntType;
	numeric: DecimalType;
	real: RealType;
	'double precision': DoublePrecisionType;
	boolean: BooleanType;
	uuid: UUIDType;
	date: DateType;
	timestamp: TimestampType;
	timestamptz: TimestampTzType;
}

type CastType = keyof CastTypes;

const CAST_TYPES: { readonly [T in CastType]: new () => CastTypes[T] } = {
	text: TextType,
	integer: IntegerType,
	bigint: BigIntType,
	numeric: DecimalType,
	real: RealType,
	'double precision': DoublePrecisionType,
	boolean: BooleanType,
	uuid: UUIDType,
	date: DateType,
	timestamp: TimestampType,
	timestamptz: TimestampTzType,
};

/**
 * The SQL functions available in scope `R`. Each declares the SQL type of its
 * arguments and result, so `lower` is only offered for text and its result can
 * go on the left of a comparison as text. Null propagates the way postgres
 * propagates it: most functions are null if any argument is; `concat`,
 * `count` and `now` never are.
 *
 * Arguments are references in scope or expressions; a plain value goes
 * through `eb.val`.
 */
export interface Functions<R extends Refs> {
	/** `lower(text)`: the string in lower case. */
	lower<A extends Operand<R, Text>>(
		text: A,
	): TypedExpression<TextType['$native'] | NullOf<TypeOf<R, A>>, TextType>;

	/** `upper(text)`: the string in upper case. */
	upper<A extends Operand<R, Text>>(
		text: A,
	): TypedExpression<TextType['$native'] | NullOf<TypeOf<R, A>>, TextType>;

	/** `length(text)`: the number of characters. */
	length<A extends Operand<R, Text>>(
		text: A,
	): TypedExpression<
		IntegerType['$native'] | NullOf<TypeOf<R, A>>,
		IntegerType
	>;

	/**
	 * `concat(a, b, ...)`: the arguments joined as text. Nulls are skipped, so
	 * the result is never null.
	 *
	 * @example eb.fn.concat('users.firstName', eb.val(' '), 'users.lastName')
	 */
	concat(
		...parts: readonly [Part<R>, ...Part<R>[]]
	): TypedExpression<TextType['$native'], TextType>;

	/**
	 * `coalesce(first, ...rest)`: the first non-null argument. All arguments
	 * share the first's SQL type, and the result is nullable only if the last
	 * argument is.
	 *
	 * @example eb.fn.coalesce('users.nickname', 'users.firstName')
	 * @example eb.fn.coalesce('users.deletedAt', eb.fn.now())
	 */
	coalesce<
		A extends Operand<R>,
		Rest extends readonly [Fallback<R, A>, ...Fallback<R, A>[]],
	>(
		first: A,
		...rest: Rest
	): TypedExpression<
		| NonNullable<TypeOf<R, A> | TypeOf<R, Rest[number]>>
		| NullOf<TypeOf<R, Last<Rest>>>,
		DataTypeOf<R, A>
	>;

	/**
	 * `count(*)` or `count(value)`: the number of rows, or of rows where
	 * `value` is not null. Postgres returns `bigint`, which arrives as a string.
	 */
	count(value?: Part<R>): TypedExpression<BigIntType['$native'], BigIntType>;

	/** `min(value)`: the smallest value, or null over no rows. */
	min<A extends Operand<R, Comparable>>(
		value: A,
	): TypedExpression<TypeOf<R, A> | null, DataTypeOf<R, A>>;

	/** `max(value)`: the largest value, or null over no rows. */
	max<A extends Operand<R, Comparable>>(
		value: A,
	): TypedExpression<TypeOf<R, A> | null, DataTypeOf<R, A>>;

	/** `now()`: the transaction's start time. */
	now(): TypedExpression<TimestampTzType['$native'], TimestampTzType>;

	/**
	 * `cast(value as type)`: the value converted to another SQL type. The
	 * result's type and SQL type follow the target, and null is preserved.
	 * This is the way to change an expression's type: it converts the value
	 * rather than merely asserting a different type for it.
	 *
	 * @example eb.fn.cast(eb.fn.count(), 'integer')
	 */
	cast<A extends Operand<R>, T extends CastType>(
		value: A,
		type: T,
	): TypedExpression<
		CastTypes[T]['$native'] | NullOf<TypeOf<R, A>>,
		CastTypes[T]
	>;
}

/**
 * An argument that may be of any SQL type, including one postgres infers
 * (`eb.val`), for the functions that accept anything.
 */
type Part<R extends Refs> = Ref<R> | Expression<unknown>;

/** How the function catalog resolves its arguments against the scope. */
interface Scope<R extends Refs> {
	/** The node for an argument. */
	readonly node: (arg: Ref<R> | Expression<unknown>) => OperationNode;
	/** The SQL type of an argument whose type is known. */
	readonly dataType: (
		arg: Ref<R> | TypedExpression<unknown, DataType>,
	) => DataType;
}

const STAR: OperationNode = { kind: 'raw', fragments: ['*'], nodes: [] };

/**
 * At runtime a function call is a node and a data type; the result's
 * TypeScript types are supplied by the `Functions` signature. So this returns
 * the bottom expression, which satisfies every signature.
 */
function result(
	node: OperationNode,
	dataType: DataType,
): TypedExpression<never, never> {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the signature supplies the type
	return new TypedExpression(node, dataType as never);
}

function call(name: string, args: readonly OperationNode[], type: DataType) {
	return result({ kind: 'function', name, args }, type);
}

/**
 * Creates the function catalog for a scope.
 */
export function functions<R extends Refs>({
	node,
	dataType,
}: Scope<R>): Functions<R> {
	return {
		lower: (text) => call('lower', [node(text)], new TextType()),
		upper: (text) => call('upper', [node(text)], new TextType()),
		length: (text) => call('length', [node(text)], new IntegerType()),
		concat: (...parts) => call('concat', parts.map(node), new TextType()),
		coalesce: (first, ...rest) =>
			call('coalesce', [first, ...rest].map(node), dataType(first)),
		count: (value) =>
			call(
				'count',
				[value === undefined ? STAR : node(value)],
				new BigIntType(),
			),
		min: (value) => call('min', [node(value)], dataType(value)),
		max: (value) => call('max', [node(value)], dataType(value)),
		now: () => call('now', [], new TimestampTzType()),
		cast: (value, type) => {
			if (!Object.hasOwn(CAST_TYPES, type)) {
				throw new Error(`Unknown cast type "${type}"`);
			}
			return result(
				{
					kind: 'raw',
					fragments: ['cast(', ` as ${type})`],
					nodes: [node(value)],
				},
				new CAST_TYPES[type](),
			);
		},
	};
}
