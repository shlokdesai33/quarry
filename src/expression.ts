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
	 * A phantom property that represents the type this expression evaluates to.
	 * Declared, never assigned: it exists only so that `Expression<string>` is
	 * not assignable to `Expression<number>`.
	 */
	declare readonly $type: T;

	/**
	 * The node the expression compiles to.
	 *
	 * Private so that only expressions built by this copy of the library are
	 * accepted: the node tree is an internal format that only the matching
	 * `compile` understands, and a look-alike object or an expression from
	 * another installed version could render wrong or bypass the invariants
	 * `LiteralNode` and `RawNode` rely on. The private field makes the type
	 * nominal and lets `is` check the brand at runtime.
	 *
	 * The drawback is that when two copies of quarry are installed, even of
	 * the same version, their expressions are incompatible with each other,
	 * both to the type checker and to `is`. The fix is to deduplicate the
	 * dependency.
	 */
	readonly #node: OperationNode;

	/**
	 * Creates a new expression.
	 *
	 * @param node the node the expression compiles to.
	 *
	 * @example new Expression(new ReferenceNode('users', 'email'))
	 * @example new Expression(new ValueNode(1))
	 * @example new Expression(new FunctionNode('now'))
	 * @example new Expression(new RawNode('now()'))
	 */
	constructor(node: OperationNode) {
		this.#node = node;
	}

	/**
	 * Whether `value` is an expression created by this copy of the library,
	 * i.e. whether it is rendered as SQL rather than sent as a parameter.
	 */
	static is(value: unknown): value is Expression<unknown> {
		return typeof value === 'object' && value !== null && #node in value;
	}

	/**
	 * Converts the expression to a node.
	 */
	toNode(): OperationNode {
		return this.#node;
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
 * call, a comparison. Only these can be the left-hand side of a comparison or
 * the argument of a function that needs a particular SQL type, and values
 * compared against them are encoded by `dataType`.
 *
 * An expression whose SQL type is whatever postgres infers, such as a bare
 * parameter, is only an `Expression`.
 *
 * The TypeScript type alone can't stand in for `D`: `text`, `uuid` and
 * `bigint` are all `string`, but only one of them has `like`.
 */
export class TypedExpression<T, D extends DataType> extends Expression<T> {
	/**
	 * The SQL type of the expression: its operators and how values compared
	 * against it are encoded.
	 */
	readonly dataType: D;

	constructor(node: OperationNode, dataType: D) {
		super(node);
		this.dataType = dataType;
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
