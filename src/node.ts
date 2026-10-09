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
	| RawNode
	| SelectNode;

/**
 * A column reference, e.g. `"users"."first_name"`.
 */
export type ReferenceNode = {
	readonly kind: 'reference';
	readonly table: string;
	readonly column: string;
};

/**
 * A parameter, rendered as `$n` and passed to the driver separately.
 */
export type ValueNode = {
	readonly kind: 'value';
	readonly value: unknown;
};

/**
 * A parenthesised, comma-separated list, e.g. the right side of `in`.
 */
export type ValueListNode = {
	readonly kind: 'value_list';
	readonly values: readonly OperationNode[];
};

/**
 * A value merged into the SQL text rather than parameterised: where postgres
 * refuses a parameter (`is null`, `is true`), and for jsonb keys, which an
 * expression index on `data->>'key'` only matches as written. Strings are
 * quoted and escaped by `compile`; numbers must be finite.
 */
export type LiteralNode = {
	readonly kind: 'literal';
	readonly value: boolean | number | string | null;
};

/**
 * `left operator right`.
 */
export type BinaryOperationNode = {
	readonly kind: 'binary';
	readonly left: OperationNode;
	readonly operator: string;
	readonly right: OperationNode;
};

/**
 * `(a and b and ...)`; renders as `true` when empty.
 */
export type AndNode = {
	readonly kind: 'and';
	readonly operands: readonly OperationNode[];
};

/**
 * `(a or b or ...)`; renders as `false` when empty.
 */
export type OrNode = {
	readonly kind: 'or';
	readonly operands: readonly OperationNode[];
};

/**
 * `not (operand)`.
 */
export type NotNode = {
	readonly kind: 'not';
	readonly operand: OperationNode;
};

/**
 * A function call, e.g. `lower("users"."first_name")`.
 */
export type FunctionNode = {
	readonly kind: 'function';
	readonly name: string;
	readonly args: readonly OperationNode[];
};

/**
 * Raw SQL with embedded nodes. `fragments` has exactly one more element than
 * `nodes`; they interleave starting with a fragment.
 */
export type RawNode = {
	readonly kind: 'raw';
	readonly fragments: readonly string[];
	readonly nodes: readonly OperationNode[];
};

/**
 * A table in a `from` or `join`: its name in the database, and the name it
 * is referenced by when that differs (`"users" as "managers"`).
 */
export type TableNode = {
	readonly name: string;
	readonly alias: string | undefined;
};

/** An entry of a select list, keyed in the result row by `alias`. */
export type SelectionNode = {
	readonly expression: OperationNode;
	readonly alias: string;
};

/** `inner join table on condition`. */
export type JoinNode = {
	readonly table: TableNode;
	readonly on: OperationNode;
};

/**
 * A `select` query. An empty select list is valid in postgres and yields
 * rows without columns.
 */
export type SelectNode = {
	readonly kind: 'select';
	readonly selections: readonly SelectionNode[];
	readonly from: TableNode;
	readonly joins: readonly JoinNode[];
	readonly where: OperationNode | undefined;
	readonly limit: number | undefined;
	/** A label passed on with the compiled query, never rendered into its SQL. */
	readonly tag: string | undefined;
};
