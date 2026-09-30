/**
 * The tree an expression compiles to. Nodes are plain immutable data with a
 * `kind` discriminant; `compile` renders them to SQL. References are already
 * resolved to their database names, so rendering needs no schema.
 */
export type OperationNode =
	| ReferenceNode
	| ValueNode
	| ValueListNode
	| LiteralNode
	| BinaryOperationNode
	| AndNode
	| OrNode
	| NotNode
	| FunctionNode
	| RawNode;

/**
 * A column reference, e.g. `"users"."first_name"`.
 */
export interface ReferenceNode {
	readonly kind: 'reference';
	readonly table: string;
	readonly column: string;
}

/**
 * A parameter, rendered as `$n` and passed to the driver separately.
 */
export interface ValueNode {
	readonly kind: 'value';
	readonly value: unknown;
}

/**
 * A parenthesised, comma-separated list, e.g. the right side of `in`.
 */
export interface ValueListNode {
	readonly kind: 'valueList';
	readonly values: readonly OperationNode[];
}

/**
 * A value merged into the SQL text rather than parameterised. Restricted to
 * types that cannot carry an injection, and needed where postgres refuses a
 * parameter (`is null`, `is true`).
 */
export interface LiteralNode {
	readonly kind: 'literal';
	readonly value: boolean | number | null;
}

/**
 * `left operator right`.
 */
export interface BinaryOperationNode {
	readonly kind: 'binary';
	readonly left: OperationNode;
	readonly operator: string;
	readonly right: OperationNode;
}

/**
 * `(a and b and ...)`; renders as `true` when empty.
 */
export interface AndNode {
	readonly kind: 'and';
	readonly operands: readonly OperationNode[];
}

/**
 * `(a or b or ...)`; renders as `false` when empty.
 */
export interface OrNode {
	readonly kind: 'or';
	readonly operands: readonly OperationNode[];
}

/**
 * `not (operand)`.
 */
export interface NotNode {
	readonly kind: 'not';
	readonly operand: OperationNode;
}

/**
 * A function call, e.g. `lower("users"."first_name")`.
 */
export interface FunctionNode {
	readonly kind: 'function';
	readonly name: string;
	readonly args: readonly OperationNode[];
}

/**
 * Raw SQL with embedded nodes. `fragments` has exactly one more element than
 * `nodes`; they interleave starting with a fragment.
 */
export interface RawNode {
	readonly kind: 'raw';
	readonly fragments: readonly string[];
	readonly nodes: readonly OperationNode[];
}
