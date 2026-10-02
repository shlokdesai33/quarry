import type { AnyColumn } from './column/any-column.js';
import { comparison } from './comparison.js';
import { DataType } from './data-type/data-type.js';
import {
	type Expression,
	Param,
	Quantified,
	TypedExpression,
} from './expression.js';
import { type Functions, functions } from './functions.js';
import { type JsonFunctions, jsonFunctions } from './json.js';
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

/** The operators that yield a boolean even when an operand is null. */
type NullSafe = 'is' | 'is not' | 'is distinct from' | 'is not distinct from';

/**
 * `null` if the right-hand side of a comparison can be null: an expression or
 * parameter that can be, a list or pair holding one, or `any` / `all` of an
 * array that can be or can hold null.
 */
type NullIn<V> =
	V extends Expression<infer T>
		? NullOf<T>
		: V extends readonly (infer I)[]
			? NullIn<I>
			: V extends Quantified<unknown, DataType, infer N>
				? N
				: never;

/** `null` if `left operator value` can be unknown, as in SQL. */
type NullOfComparison<R extends Refs, L, O, V> = O extends NullSafe
	? never
	: NullOf<TypeOf<R, L>> | NullIn<V>;

/** A boolean expression, nullable when `N` is `null`. */
type Predicate<N extends null = never> = TypedExpression<
	boolean | N,
	DataType<'boolean'>
>;

type AnyPredicate = Expression<boolean | null>;

/**
 * Builds expressions over the references in scope `R`. Only visible columns
 * can be referenced, and a comparison only admits the operators and value
 * types of its left-hand side's SQL type.
 */
export interface ExpressionBuilder<R extends Refs> {
	/**
	 * `left operator value`. The operators and what each takes come from the
	 * SQL type of `left`, which also encodes `value`: a plain value or a
	 * parameter, or an expression of a SQL type the operator accepts (also as
	 * an item of a list or pair). The result is nullable when either operand
	 * is, unless the operator is null-safe.
	 *
	 * `left` can also be a parameter compared with `any` / `all` of an array
	 * column or expression, whose element type encodes it. Its operator and
	 * type are not checked against the elements.
	 *
	 * @example eb('users.email', 'like', '%@example.com')
	 * @example eb('users.age', 'between', [18, eb.ref('users.maxAge')])
	 * @example eb('users.deletedAt', 'is', null)
	 * @example eb(eb.fn.lower('users.email'), 'like', '%@example.com')
	 * @example eb(eb.val('admin'), '=', eb.fn.any('users.tags'))
	 */
	<
		L extends Operand<R> | Param<unknown>,
		O extends keyof OperatorsOf<R, L> & string,
		V extends OperatorsOf<R, L>[O],
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
	 * a comparison. Compared against something, it is encoded like a plain
	 * value; elsewhere it is sent to the driver as is.
	 *
	 * @example eb.fn.concat('users.firstName', eb.val(' '), 'users.lastName')
	 * @example eb('users.id', 'in', eb.val(ids))
	 */
	val<T extends readonly unknown[]>(value: T): Param<T>;
	val<const T>(value: T): Param<T>;

	/**
	 * The SQL functions.
	 *
	 * @example eb.fn.lower('users.email')
	 */
	readonly fn: Functions<R>;

	/**
	 * The jsonb functions: reading a field or path, and testing keys and
	 * jsonpaths.
	 *
	 * @example eb(eb.json.text('users.settings', 'theme'), '=', 'dark')
	 * @example eb.json.hasKey('users.settings', 'theme')
	 */
	readonly json: JsonFunctions<R>;

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
			node: {
				kind: 'reference',
				table: tableName,
				column: column.columnName ?? key,
			},
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
		left: string | TypedExpression<unknown, DataType> | Param<unknown>,
		operator: string,
		value: unknown,
	) => {
		if (left instanceof Param) {
			const element = value instanceof Quantified ? value.element : undefined;
			if (element === undefined) {
				throw new Error(
					'A parameter on the left needs any() or all() of an array column or expression on the right',
				);
			}
			const serialize = (item: unknown) => element.serialize(item);
			return predicate(
				comparison(
					{ kind: 'value', value: serialize(left.value) },
					operator,
					value,
					serialize,
				),
			);
		}

		const type = dataType(left);
		return predicate(
			comparison(node(left), operator, value, (item) => type.serialize(item)),
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
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the overloads supply the type
		val: (value: unknown): Param<never> => new Param(value as never),
		fn: functions<R>({ node, dataType }),
		json: jsonFunctions<R>({ node, dataType }),
		and: junction('and'),
		or: junction('or'),
		not: (expression: AnyPredicate) =>
			predicate({ kind: 'not', operand: expression.toNode() }),
	});
}

function predicate(node: OperationNode): Predicate {
	return new TypedExpression(node, new DataType('boolean'));
}
