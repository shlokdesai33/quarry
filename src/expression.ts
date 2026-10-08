import type { DataType } from './data-type/data-type.js';
import type { OperationNode } from './node.js';

/**
 * A SQL expression. `T` is the type the database yields when the expression
 * is evaluated: a column reference is `Expression<S>`, a comparison is
 * `Expression<boolean>`.
 *
 * Every position in a query that accepts a computed value accepts an
 * `Expression` of the appropriate type, which is what lets column references,
 * literals, function calls and subqueries compose freely. Positions that
 * need the expression's SQL type as well take a `TypedExpression`.
 *
 * Only this library creates expressions (the package exports the type, not
 * the class).
 */
export class Expression<T> {
	/**
	 * What the library reads: not part of the API.
	 */
	readonly _quarry: {
		/**
		 * Phantom: the type this expression evaluates to. Never set: it exists
		 * only so that `Expression<string>` is not assignable to
		 * `Expression<number>`, and is optional so that the object can be
		 * built without it. Reading it gives `T | undefined`; `T` itself is
		 * what `Expression<infer T>` infers.
		 */
		readonly $type?: T;
		/**
		 * The node the expression compiles to.
		 */
		readonly node: OperationNode;
	};

	/**
	 * Creates a new expression.
	 *
	 * @param node what the expression compiles to.
	 */
	constructor(node: OperationNode) {
		this._quarry = { node };
	}

	/**
	 * Whether `value` is an expression created by this copy of the library,
	 * i.e. whether it is rendered as SQL rather than sent as a parameter.
	 */
	static is(value: unknown): value is Expression<unknown> {
		return typeof value === 'object' && value !== null && '_quarry' in value;
	}

	/**
	 * Names the expression, e.g. for a select list.
	 *
	 * @example eb.fn.lower('users.email').as('email')
	 */
	as<const A extends string>(alias: A): AliasedExpression<T, A> {
		return { expression: this, alias };
	}
}

/**
 * An expression whose SQL type `D` is known: a column reference, a function
 * call, a comparison. Only these have the comparison methods of a SQL type
 * (see `Expr`) or can be the argument of a function that needs one, and
 * values compared against them are encoded by its SQL type.
 *
 * An expression whose SQL type is whatever postgres infers, such as a bare
 * parameter, is only an `Expression`.
 *
 * The TypeScript type alone can't stand in for `D`: `text`, `uuid` and
 * `bigint` are all `string`, but only one of them has `like`.
 */
export class TypedExpression<T, D extends DataType> extends Expression<T> {
	/**
	 * What the library reads: not part of the API. `dataType` is the SQL type
	 * of the expression: its methods and how values compared against it are
	 * encoded.
	 */
	declare readonly _quarry: {
		/**
		 * Phantom: the type this expression evaluates to.
		 */
		readonly $type?: T;
		readonly node: OperationNode;
		readonly dataType: D;
	};

	constructor(node: OperationNode, dataType: D) {
		super(node);
		this._quarry = { node, dataType };
	}
}

/**
 * A parameter: a value sent alongside the query, whose SQL type postgres
 * infers from where it is used, as `eb.val` creates. As the array of `in` or
 * `any` / `all`, its items are encoded by the other side's SQL type, exactly
 * like a plain array's; elsewhere it is sent as is.
 *
 * It has no SQL type of its own, so it is never a `TypedExpression`, and an
 * operand that takes a parameter does not thereby take an expression of any
 * SQL type.
 */
export class Param<T> extends Expression<T> {
	/**
	 * What the library reads: not part of the API. `value` is sent to the
	 * driver.
	 */
	declare readonly _quarry: {
		/**
		 * Phantom: the type this expression evaluates to.
		 */
		readonly $type?: T;
		/**
		 * Phantom: the value sent to the driver.
		 */
		readonly $value?: T;
		/**
		 * Phantom: the node the expression compiles to.
		 */
		readonly node: OperationNode;
		/**
		 * The value sent to the driver.
		 */
		readonly value: T;
	};

	constructor(value: T) {
		const node = { kind: 'value', value } as const;
		super(node);
		this._quarry = { node, value };
	}
}

/**
 * `any(array)` or `all(array)`, as `eb.fn.any` and `eb.fn.all` create: on
 * the right of a comparison, it holds if the comparison holds for some, or
 * for every, element. `S` is the type of the elements, `D` their SQL type
 * (`never` for values, whose SQL type postgres infers), and `N` is `null`
 * when the array or an element can be. `Typed` is `true` for an array
 * expression and `false` for values or a parameter: a comparison checks
 * values by the other side's TypeScript type, and an array expression only by
 * its SQL type.
 *
 * Not an expression: postgres only allows it as the right-hand operand of an
 * operator, so nothing else accepts it. When the array has a SQL type, a
 * parameter can be the left-hand side, as in
 * `eb.val('a').eq(eb.fn.any('users.tags'))`, and is encoded by the element
 * type.
 */
export class Quantified<
	S,
	D extends DataType,
	N extends null = never,
	Typed extends boolean = boolean,
> {
	/**
	 * What the library reads: not part of the API. The `$` members are
	 * phantoms, never set: optional so that the object can be built without
	 * them, and still compared.
	 */
	readonly _quarry: {
		/**
		 * Phantom: the type of the elements.
		 */
		readonly $element?: S;
		/**
		 * Phantom: the SQL type of the elements.
		 */
		readonly $dataType?: D;
		/**
		 * Phantom: `null` when the array or an element can be.
		 */
		readonly $null?: N;
		/**
		 * Phantom: whether the elements have a known SQL type.
		 */
		readonly $typed?: Typed;
		/**
		 * Whether some or every element must satisfy the comparison.
		 */
		readonly quantifier: 'any' | 'all';
		/**
		 * The array: values or a parameter, which the comparison encodes item
		 * by item, or an expression.
		 */
		readonly array: readonly unknown[] | Expression<unknown>;
		/**
		 * The SQL type of the elements, when the array is an expression of an
		 * array type; `undefined` for values and parameters.
		 */
		readonly element: DataType | undefined;
	};

	constructor(
		quantifier: 'any' | 'all',
		array: readonly unknown[] | Expression<unknown>,
		element: DataType | undefined,
	) {
		this._quarry = { quantifier, array, element };
	}
}

/**
 * An expression paired with a name, for the positions that take one: select
 * list entries and derived tables. `A` becomes the key in the result row and
 * `T` its type.
 *
 * This is not itself an expression. SQL only allows an alias on a list entry,
 * never inside a computation, so the clause that owns the list renders the
 * `as "alias"`.
 */
export interface AliasedExpression<T, A extends string> {
	readonly expression: Expression<T>;
	readonly alias: A;
}
