import type { AnyColumn } from './column/any-column.js';
import type { DataType } from './data-type/data-type.js';
import type { Expression, TypedExpression } from './expression.js';
import { param, predicate, typedExpression } from './expression-methods.js';
import { type Functions, functions } from './functions.js';
import { type JsonFunctions, jsonFunctions } from './json.js';
import type { OperationNode, ReferenceNode } from './node.js';
import type { AnyPredicate, Expr, Predicate, Value } from './operators.js';
import type { NullOf, Ref, Refs, RefsOf } from './refs.js';
import type { AnyTable } from './table.js';

/**
 * Builds expressions over the references in scope `R`. Only visible columns
 * can be referenced. A condition is a method of an expression, typed by the
 * expression's SQL type: only the comparisons that type has, each taking the
 * values and expressions it accepts.
 *
 * Its members don't depend on `this`, so it can be destructured.
 *
 * `R` is declared invariant, for type-checking speed: a builder is only ever
 * used with its own scope, and without the annotation the compiler measures
 * the variance by comparing the whole interface, once per program, and
 * editors once per edit.
 *
 * @example eb.ref('users.email').like('%@example.com')
 * @example eb.ref('users.age').between([18, eb.ref('users.maxAge')])
 * @example eb.fn.lower('users.email').eq('ada@example.com')
 * @example eb.val('admin').eq(eb.fn.any('users.tags'))
 */
export interface ExpressionBuilder<in out R extends Refs> {
	/**
	 * A column reference, with the comparison methods of its SQL type.
	 *
	 * @example eb.ref('users.firstName').eq(eb.ref('users.lastName'))
	 */
	readonly ref: <C extends Ref<R>>(
		column: C,
	) => Expr<R[C]['$select'], R[C]['_quarry']['dataType']>;

	/**
	 * A parameter, for positions that take a reference by default. Its SQL
	 * type is whatever postgres infers, so its only comparisons are with
	 * `any` / `all` of an array, whose element type encodes it. A comparison
	 * takes a plain value instead, except for an array as a whole: `in` and
	 * `any` / `all` take an array parameter and encode its items. Elsewhere it
	 * is sent to the driver as is.
	 *
	 * @example eb.fn.concat('users.firstName', eb.val(' '), 'users.lastName')
	 * @example eb.ref('users.id').in(eb.val(ids))
	 */
	readonly val: {
		<T extends readonly unknown[]>(value: T): Value<T>;
		<const T>(value: T): Value<T>;
	};

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
	 * @example eb.json.text('users.settings', 'theme').eq('dark')
	 * @example eb.json.hasKey('users.settings', 'theme')
	 */
	readonly json: JsonFunctions<R>;

	/** `(a and b and ...)`; `true` when empty. */
	readonly and: <const E extends readonly AnyPredicate[]>(
		expressions: E,
	) => Predicate<NullOf<E[number]['_quarry']['$type']>>;

	/** `(a or b or ...)`; `false` when empty. */
	readonly or: <const E extends readonly AnyPredicate[]>(
		expressions: E,
	) => Predicate<NullOf<E[number]['_quarry']['$type']>>;

	/** `not (expression)`. */
	readonly not: <E extends AnyPredicate>(
		expression: E,
	) => Predicate<NullOf<E['_quarry']['$type']>>;
}

const junction =
	(kind: 'and' | 'or') => (expressions: readonly AnyPredicate[]) =>
		predicate({
			kind,
			operands: expressions.map((expression) => expression._quarry.node),
		});

/**
 * Creates an expression builder with the given tables in scope. The
 * implementation only builds nodes; `ExpressionBuilder` supplies the types.
 *
 * @example
 * const eb = expressionBuilder(users, posts.as('p'));
 * eb.ref('p.authorId').eq(eb.ref('users.id'))
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
				column: column._quarry.columnName ?? key,
			},
			column,
		};
	};

	const node = (arg: string | Expression<unknown>): OperationNode =>
		typeof arg === 'string' ? resolve(arg).node : arg._quarry.node;

	const dataType = (
		arg: string | TypedExpression<unknown, DataType>,
	): DataType =>
		typeof arg === 'string'
			? resolve(arg).column._quarry.dataType
			: arg._quarry.dataType;

	return {
		ref: (column: string) => {
			const resolved = resolve(column);
			return typedExpression(resolved.node, resolved.column._quarry.dataType);
		},
		val: (value: unknown) => param(value),
		fn: functions<R>({ node, dataType }),
		json: jsonFunctions<R>({ node, dataType }),
		and: junction('and'),
		or: junction('or'),
		not: (expression: AnyPredicate) =>
			predicate({ kind: 'not', operand: expression._quarry.node }),
	};
}
