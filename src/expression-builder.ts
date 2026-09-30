import type { AnyColumn } from './column/any-column.js';
import { BooleanType } from './data-type/boolean.js';
import type { DataType } from './data-type/data-type.js';
import { Expression, TypedExpression } from './expression.js';
import type {
	BinaryOperationNode,
	OperationNode,
	ReferenceNode,
} from './node.js';
import { type Functions, functions } from './functions.js';
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
 * A value, or an expression evaluating to one. The value itself cannot be
 * null (`= null` is never true), but an expression may be, as in SQL; the
 * comparison is then nullable.
 */
type Value<V> = V | Expression<V | null>;

/** The operators that yield a boolean even when an operand is null. */
type NullSafe = 'is' | 'is not' | 'is distinct from' | 'is not distinct from';

/**
 * `null` if the comparison `left operator value` can be unknown: when either
 * operand may be null and the operator is not null-safe.
 */
type NullOfComparison<R extends Refs, L, O, V> = O extends NullSafe
	? never
	: NullOf<TypeOf<R, L>> | (V extends Expression<infer T> ? NullOf<T> : never);

/** A boolean expression, nullable when `N` is `null`: SQL's three-valued logic. */
type Predicate<N extends null = never> = TypedExpression<
	BooleanType['$native'] | N,
	BooleanType
>;

/** Any predicate, nullable or not. */
type AnyPredicate = Expression<BooleanType['$native'] | null>;

/**
 * Builds expressions over the references in scope `R`. Method arguments are
 * checked against `R`: only visible columns can be referenced, and a
 * comparison only admits the operators and value types of its left-hand side.
 */
export interface ExpressionBuilder<R extends Refs> {
	/**
	 * A comparison, `left operator value`. `left` is a column reference or an
	 * expression with a known SQL type. The operators and the type of `value`
	 * come from that type, so `text` gets `like` and a nullable column can be
	 * tested with `is null` but not `= null`.
	 *
	 * The result is `boolean | null` when either operand may be null, as in
	 * SQL, except for the null-safe operators (`is`, `is distinct from`).
	 *
	 * Values are encoded by the SQL type of `left`, whether it is a column or
	 * a computed expression, so a jsonb array or a range is sent in the
	 * syntax postgres expects either way.
	 *
	 * @example eb('users.email', 'like', '%@example.com')
	 * @example eb('users.age', 'between', [18, 65])
	 * @example eb('users.deletedAt', 'is', null)
	 * @example eb(eb.fn.lower('users.email'), 'like', '%@example.com')
	 */
	<
		L extends Operand<R>,
		O extends keyof OperatorsOf<R, L> & string,
		V extends Value<OperatorsOf<R, L>[O]>,
	>(
		left: L,
		operator: O,
		value: V,
	): Predicate<NullOfComparison<R, L, O, V>>;

	/**
	 * A column reference, for positions that take a value by default. Carries
	 * the column's SQL type, so it can be compared like the column.
	 *
	 * @example eb('users.firstName', '=', eb.ref('users.lastName'))
	 */
	ref<C extends Ref<R>>(
		column: C,
	): TypedExpression<R[C]['$select'], R[C]['dataType']>;

	/**
	 * A parameter, for positions that take a reference by default. Its SQL type
	 * is whatever postgres infers, so it cannot be the left-hand side of a
	 * comparison, and it is sent as the driver receives it.
	 *
	 * Arrays keep their element type (`['a']` is `string[]`); everything else
	 * keeps its literal type (`'active'`, `{ empty: true }`).
	 *
	 * @example eb.fn.concat('users.firstName', eb.val(' '), 'users.lastName')
	 */
	val<T extends readonly unknown[]>(value: T): Expression<T>;
	val<const T>(value: T): Expression<T>;

	/**
	 * The SQL functions, typed by the SQL types of their arguments and results.
	 *
	 * @example eb.fn.lower('users.email')
	 * @example eb(eb.fn.count(), '>', '5')
	 */
	readonly fn: Functions<R>;

	/**
	 * `(a and b and ...)`. An empty list is `true`. Nullable if any operand is.
	 */
	and<const E extends readonly AnyPredicate[]>(
		expressions: E,
	): Predicate<NullOf<E[number]['$type']>>;

	/**
	 * `(a or b or ...)`. An empty list is `false`. Nullable if any operand is.
	 */
	or<const E extends readonly AnyPredicate[]>(
		expressions: E,
	): Predicate<NullOf<E[number]['$type']>>;

	/** `not (expression)`. Nullable if the operand is. */
	not<E extends AnyPredicate>(expression: E): Predicate<NullOf<E['$type']>>;
}

/**
 * Creates an expression builder with the given tables in scope.
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

	const compare = <
		L extends Operand<R>,
		O extends keyof OperatorsOf<R, L> & string,
		V extends Value<OperatorsOf<R, L>[O]>,
	>(
		left: L,
		operator: O,
		value: V,
	): Predicate<NullOfComparison<R, L, O, V>> => {
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

		fn: functions<R>({ node, dataType }),

		// the overloads on the interface supply the type; a value is just a node
		val: (value: unknown): Expression<never> =>
			new Expression({ kind: 'value', value }),

		and: (expressions: readonly AnyPredicate[]) =>
			predicate({
				kind: 'and',
				operands: expressions.map((expression) => expression.toNode()),
			}),

		or: (expressions: readonly AnyPredicate[]) =>
			predicate({
				kind: 'or',
				operands: expressions.map((expression) => expression.toNode()),
			}),

		not: (expression: AnyPredicate) =>
			predicate({ kind: 'not', operand: expression.toNode() }),
	});
}

function predicate(node: OperationNode): Predicate {
	return new TypedExpression(node, new BooleanType());
}

/**
 * Builds the node for `left operator value`, normalising the operators whose
 * right-hand side is not a single value so that `compile` needs no
 * operator-specific rendering. Plain values are passed through `encode` on
 * their way into a `ValueNode`; expressions are used as-is.
 */
function comparison(
	left: OperationNode,
	operator: string,
	value: unknown,
	encode: (value: unknown) => unknown,
): OperationNode {
	const operand = (item: unknown): OperationNode =>
		Expression.is(item)
			? item.toNode()
			: { kind: 'value', value: encode(item) };

	if (Expression.is(value)) {
		return binary(left, operator, value.toNode());
	}
	// `is null` / `is true`: postgres rejects a parameter here
	if (
		(operator === 'is' || operator === 'is not') &&
		(value === null || typeof value === 'boolean')
	) {
		return binary(left, operator, { kind: 'literal', value });
	}
	// `in ($1, $2)`; an empty list can match nothing
	if ((operator === 'in' || operator === 'not in') && isList(value)) {
		if (value.length === 0) {
			return { kind: 'literal', value: operator === 'not in' };
		}
		return binary(left, operator, {
			kind: 'valueList',
			values: value.map(operand),
		});
	}
	// `between $1 and $2`
	if ((operator === 'between' || operator === 'not between') && isList(value)) {
		const [low, high] = value;
		return binary(left, operator, {
			kind: 'raw',
			fragments: ['', ' and ', ''],
			nodes: [operand(low), operand(high)],
		});
	}
	// `$1 = any("col")`: the value is on the left
	if (operator === '= any') {
		return binary(operand(value), '=', {
			kind: 'function',
			name: 'any',
			args: [left],
		});
	}
	if (operator === '<> all') {
		return binary(operand(value), '<>', {
			kind: 'function',
			name: 'all',
			args: [left],
		});
	}
	return binary(left, operator, operand(value));
}

function binary(
	left: OperationNode,
	operator: string,
	right: OperationNode,
): BinaryOperationNode {
	return { kind: 'binary', left, operator, right };
}

function isList(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}
