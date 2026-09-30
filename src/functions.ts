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

/** A result of SQL type `D`, nullable when `N` is `null`. */
type Result<D extends DataType, N = never> = TypedExpression<
	D['$native'] | N,
	D
>;

/** Any SQL type with the text operators. */
type Text = DataType & { readonly $operators: TextOperators<unknown> };

/** Any SQL type with an ordering. */
type Comparable = DataType & {
	readonly $operators: ComparableOperators<unknown>;
};

/** An argument of any SQL type, including one postgres infers (`eb.val`). */
type Part<R extends Refs> = Ref<R> | Expression<unknown>;

/**
 * A `coalesce` fallback: an operand of the first argument's SQL type, or any
 * expression of its value type (so `eb.val` works).
 */
type Fallback<R extends Refs, First> =
	| Operand<R, DataTypeOf<R, First>>
	| Expression<TypeOf<R, First>>;

type Last<T extends readonly unknown[]> = T extends readonly [
	...unknown[],
	infer L,
]
	? L
	: never;

/** The targets of `cast`, keyed by SQL name. */
const CAST_TYPES = {
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
} satisfies Record<string, new () => DataType>;

type CastType = keyof typeof CAST_TYPES;

type CastTypes = { [T in CastType]: InstanceType<(typeof CAST_TYPES)[T]> };

/**
 * The SQL functions available in scope `R`, typed by the SQL types of their
 * arguments and results. Most are null if any argument is; `concat`, `count`
 * and `now` never are. A plain value argument goes through `eb.val`.
 */
export interface Functions<R extends Refs> {
	/** `lower(text)` */
	lower<A extends Operand<R, Text>>(
		text: A,
	): Result<TextType, NullOf<TypeOf<R, A>>>;

	/** `upper(text)` */
	upper<A extends Operand<R, Text>>(
		text: A,
	): Result<TextType, NullOf<TypeOf<R, A>>>;

	/** `length(text)`: the number of characters. */
	length<A extends Operand<R, Text>>(
		text: A,
	): Result<IntegerType, NullOf<TypeOf<R, A>>>;

	/**
	 * `concat(a, b, ...)`. Nulls are skipped, so the result is never null.
	 *
	 * @example eb.fn.concat('users.firstName', eb.val(' '), 'users.lastName')
	 */
	concat(...parts: readonly [Part<R>, ...Part<R>[]]): Result<TextType>;

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
	): TypedExpression<
		| NonNullable<TypeOf<R, A> | TypeOf<R, Rest[number]>>
		| NullOf<TypeOf<R, Last<Rest>>>,
		DataTypeOf<R, A>
	>;

	/** `count(*)` or `count(value)`. A `bigint`, so it arrives as a string. */
	count(value?: Part<R>): Result<BigIntType>;

	/** `min(value)`: null over no rows. */
	min<A extends Operand<R, Comparable>>(
		value: A,
	): TypedExpression<TypeOf<R, A> | null, DataTypeOf<R, A>>;

	/** `max(value)`: null over no rows. */
	max<A extends Operand<R, Comparable>>(
		value: A,
	): TypedExpression<TypeOf<R, A> | null, DataTypeOf<R, A>>;

	/** `now()`: the transaction's start time. */
	now(): Result<TimestampTzType>;

	/**
	 * `cast(value as type)`: converts the value, so its type and SQL type
	 * follow the target.
	 *
	 * @example eb.fn.cast(eb.fn.count(), 'integer')
	 */
	cast<A extends Operand<R>, T extends CastType>(
		value: A,
		type: T,
	): Result<CastTypes[T], NullOf<TypeOf<R, A>>>;
}

/** How the function catalog resolves its arguments against the scope. */
interface Scope<R extends Refs> {
	readonly node: (arg: Part<R>) => OperationNode;
	readonly dataType: (
		arg: Ref<R> | TypedExpression<unknown, DataType>,
	) => DataType;
}

const STAR: OperationNode = { kind: 'raw', fragments: ['*'], nodes: [] };

/**
 * At runtime a call is just a node and a data type; `Functions` supplies the
 * TypeScript types, so this returns the bottom type, which fits every
 * signature.
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
