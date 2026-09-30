import type { AnyColumn } from './column/any-column.js';
import { comparison } from './comparison.js';
import { BooleanType } from './data-type/boolean.js';
import type { DataType } from './data-type/data-type.js';
import { Expression, TypedExpression } from './expression.js';
import { type Functions, functions } from './functions.js';
import type { OperationNode, ReferenceNode } from './node.js';
import type {
	NullOf,
	Operand,
	OperatorsOf,
	Ref,
	Refs,
	RefsOf,
	TypeOf,
} from './refs.js';
import type { AnyTable } from './table.js';

/**
 * The right-hand side of a comparison: a non-null value (`= null` is never
 * true), or an expression, which may be null. `is` and `is not` take only the
 * value, since postgres only allows the keywords `null`, `true` and `false`
 * after them.
 */
type Value<O, V> = O extends 'is' | 'is not' ? V : V | Expression<V | null>;

/** The operators that yield a boolean even when an operand is null. */
type NullSafe = 'is' | 'is not' | 'is distinct from' | 'is not distinct from';

/** `null` if `left operator value` can be unknown, as in SQL. */
type NullOfComparison<R extends Refs, L, O, V> = O extends NullSafe
	? never
	: NullOf<TypeOf<R, L>> | (V extends Expression<infer T> ? NullOf<T> : never);

/** A boolean expression, nullable when `N` is `null`. */
type Predicate<N extends null = never> = TypedExpression<
	BooleanType['$native'] | N,
	BooleanType
>;

type AnyPredicate = Expression<BooleanType['$native'] | null>;

/**
 * Builds expressions over the references in scope `R`. Only visible columns
 * can be referenced, and a comparison only admits the operators and value
 * types of its left-hand side's SQL type.
 */
export interface ExpressionBuilder<R extends Refs> {
	/**
	 * `left operator value`. The operators and the type of `value` come from
	 * the SQL type of `left`, which also encodes `value`. The result is
	 * nullable when either operand is, unless the operator is null-safe.
	 *
	 * @example eb('users.email', 'like', '%@example.com')
	 * @example eb('users.age', 'between', [18, 65])
	 * @example eb('users.deletedAt', 'is', null)
	 * @example eb(eb.fn.lower('users.email'), 'like', '%@example.com')
	 */
	<
		L extends Operand<R>,
		O extends keyof OperatorsOf<R, L> & string,
		V extends Value<O, OperatorsOf<R, L>[O]>,
	>(
		left: L,
		operator: O,
		value: V,
	): Predicate<NullOfComparison<R, L, O, V>>;

	/**
	 * A column reference, for positions that take a value by default.
	 *
	 * @example eb('users.firstName', '=', eb.ref('users.lastName'))
	 */
	ref<C extends Ref<R>>(
		column: C,
	): TypedExpression<R[C]['$select'], R[C]['dataType']>;

	/**
	 * A parameter, for positions that take a reference by default. Its SQL
	 * type is whatever postgres infers, so it cannot be the left-hand side of
	 * a comparison, and it is sent to the driver unencoded.
	 *
	 * @example eb.fn.concat('users.firstName', eb.val(' '), 'users.lastName')
	 */
	val<T extends readonly unknown[]>(value: T): Expression<T>;
	val<const T>(value: T): Expression<T>;

	/**
	 * The SQL functions.
	 *
	 * @example eb.fn.lower('users.email')
	 */
	readonly fn: Functions<R>;

	/** `(a and b and ...)`; `true` when empty. */
	and<const E extends readonly AnyPredicate[]>(
		expressions: E,
	): Predicate<NullOf<E[number]['$type']>>;

	/** `(a or b or ...)`; `false` when empty. */
	or<const E extends readonly AnyPredicate[]>(
		expressions: E,
	): Predicate<NullOf<E[number]['$type']>>;

	/** `not (expression)`. */
	not<E extends AnyPredicate>(expression: E): Predicate<NullOf<E['$type']>>;
}

/**
 * Creates an expression builder with the given tables in scope. The
 * implementation only builds nodes; `ExpressionBuilder` supplies the types.
 *
 * @example
 * const eb = expressionBuilder(users, posts.as('p'));
 * eb('p.authorId', '=', eb.ref('users.id'))
 */
export function expressionBuilder<const T extends readonly AnyTable[]>(
	...tables: T
): ExpressionBuilder<RefsOf<T>> {
	type R = RefsOf<T>;

	const resolve = (
		reference: string,
	): { node: ReferenceNode; column: AnyColumn } => {
		const dot = reference.indexOf('.');
		const tableName = reference.slice(0, dot);
		const key = reference.slice(dot + 1);
		const column = tables.find((table) => table.name === tableName)?.schema
			.columns[key];
		if (column === undefined) {
			throw new Error(`Unknown column reference "${reference}"`);
		}
		return {
			node: { kind: 'reference', table: tableName, column: column.name ?? key },
			column,
		};
	};

	const node = (arg: string | Expression<unknown>): OperationNode =>
		typeof arg === 'string' ? resolve(arg).node : arg.toNode();

	const dataType = (
		arg: string | TypedExpression<unknown, DataType>,
	): DataType =>
		typeof arg === 'string' ? resolve(arg).column.dataType : arg.dataType;

	const junction =
		(kind: 'and' | 'or') => (expressions: readonly AnyPredicate[]) =>
			predicate({
				kind,
				operands: expressions.map((expression) => expression.toNode()),
			});

	const compare = (
		left: string | TypedExpression<unknown, DataType>,
		operator: string,
		value: unknown,
	) => {
		const type = dataType(left);
		return predicate(
			comparison(node(left), operator, value, (item) =>
				type.encodeOperand(operator, item),
			),
		);
	};

	return Object.assign(compare, {
		ref: <C extends Ref<R>>(column: C) => {
			const resolved = resolve(column);
			return new TypedExpression<R[C]['$select'], R[C]['dataType']>(
				resolved.node,
				resolved.column.dataType,
			);
		},
		val: (value: unknown): Expression<never> =>
			new Expression({ kind: 'value', value }),
		fn: functions<R>({ node, dataType }),
		and: junction('and'),
		or: junction('or'),
		not: (expression: AnyPredicate) =>
			predicate({ kind: 'not', operand: expression.toNode() }),
	});
}

function predicate(node: OperationNode): Predicate {
	return new TypedExpression(node, new BooleanType());
}
