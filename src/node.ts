import type { Codec } from './driver/codec.js';

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
	| CaseNode
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
	/**
	 * The driver codec the value is encoded with, chosen by what it is
	 * compared with or written to; without one, the driver encodes it by
	 * its JavaScript type and the server infers its type.
	 */
	readonly codec?: Codec | undefined;
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
	/** `name(distinct args)`, for an aggregate over the distinct values. */
	readonly distinct?: boolean | undefined;
};

/**
 * `case when condition then result ... else result end`; without `otherwise`,
 * `else` is left out, so no branch matching yields null.
 */
export type CaseNode = {
	readonly kind: 'case';
	readonly branches: readonly {
		readonly when: OperationNode;
		readonly result: OperationNode;
	}[];
	readonly otherwise: OperationNode | undefined;
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
	/** The codec the column is read with, when its SQL type is known. */
	readonly codec: Codec | undefined;
};

/** `kind join table on condition`; a cross join has no condition. */
export type JoinNode = {
	readonly kind: 'inner' | 'left' | 'right' | 'full' | 'cross';
	readonly table: TableNode;
	readonly on: OperationNode | undefined;
};

/**
 * An `order by` key: `expression [asc | desc] [nulls first | nulls last]`;
 * each left out when `undefined`, for postgres's default (ascending, nulls
 * last when ascending and first when descending).
 */
export type OrderNode = {
	readonly expression: OperationNode | AliasNode;
	readonly direction: 'asc' | 'desc' | undefined;
	readonly nulls: 'first' | 'last' | undefined;
};

/** A selected column by its alias, as `group by` and `order by` can name it. */
export type AliasNode = {
	readonly kind: 'alias';
	readonly alias: string;
};

/**
 * `for strength [of tables] [skip locked | nowait]`. `of` names tables as the
 * query references them (an alias, for an aliased table); empty for every
 * table of the query.
 */
export type LockNode = {
	readonly strength: 'update' | 'no key update' | 'share' | 'key share';
	readonly of: readonly string[];
	readonly wait: 'skip locked' | 'nowait' | undefined;
};

/**
 * A `select` query. An empty select list is valid in postgres and yields
 * rows without columns.
 */
export type SelectNode = {
	readonly kind: 'select';
	/**
	 * `select distinct`, or with expressions, `select distinct on
	 * (expressions)`; `undefined` for every row.
	 */
	readonly distinct?: true | readonly (OperationNode | AliasNode)[] | undefined;
	readonly selections: readonly SelectionNode[];
	readonly from: TableNode;
	readonly joins: readonly JoinNode[];
	readonly where: OperationNode | undefined;
	readonly groupBy?: readonly (OperationNode | AliasNode)[] | undefined;
	readonly having?: OperationNode | undefined;
	readonly orderBy?: readonly OrderNode[] | undefined;
	readonly limit: number | undefined;
	readonly offset?: number | undefined;
	/** The locking clauses, in order. */
	readonly locks: readonly LockNode[];
	/** A label passed on with the compiled query, never rendered into its SQL. */
	readonly tag: string | undefined;
};

/**
 * `column = value` in an `update` or an upsert's `do update`, by the
 * column's name in the database.
 */
export type SetNode = {
	readonly column: string;
	readonly value: OperationNode;
};

/**
 * Rows of values aligned with `columns` (names in the database); an
 * `undefined` value is the column's `default`. `unnest` sends each column as
 * one array parameter, for many rows; `values` lists the rows.
 */
export type RowsNode = {
	readonly columns: readonly string[];
	/**
	 * The columns' SQL types as DDL writes them, for `unnest`'s array casts,
	 * without modifiers: a cast to `varchar(3)` would truncate, where the
	 * assignment to the column rejects a value too long.
	 */
	readonly types: readonly string[];
	/** The columns' codecs, whose arrays `unnest`'s parameters are encoded with. */
	readonly codecs: readonly Codec[];
	readonly rows: readonly (readonly (OperationNode | undefined)[])[];
	readonly strategy: 'values' | 'unnest';
};

/** What an upsert does on a conflict. */
export type ConflictActionNode =
	| { readonly kind: 'nothing' }
	| {
			/** Each column set from `excluded`; `undefined` for every inserted column. */
			readonly kind: 'merge';
			readonly columns: readonly string[] | undefined;
			readonly where: OperationNode | undefined;
	  }
	| {
			readonly kind: 'update';
			readonly set: readonly SetNode[];
			readonly where: OperationNode | undefined;
	  };

/** `on conflict (target) where ... do ...`. */
export type OnConflictNode = {
	readonly target: readonly string[];
	/** The predicate of a partial unique index the target names. */
	readonly where: OperationNode | undefined;
	readonly action: ConflictActionNode;
};

/** What every write query records besides its own clauses. */
type WriteNode = {
	readonly table: TableNode;
	readonly returning: readonly SelectionNode[];
	readonly tag: string | undefined;
};

/** An `insert` query. */
export type InsertNode = WriteNode & {
	readonly kind: 'insert';
	readonly values: RowsNode;
	readonly onConflict: OnConflictNode | undefined;
};

/**
 * An `update` query. `many`
 * is the rows of an `updateMany`, matched to the table's by the `by`
 * columns. `allRows` is set by `allRows()`, which stands in for `where`.
 */
export type UpdateNode = WriteNode & {
	readonly kind: 'update';
	readonly set: readonly SetNode[];
	readonly many: (RowsNode & { readonly by: readonly string[] }) | undefined;
	readonly where: OperationNode | undefined;
	readonly allRows: boolean;
};

/** A `delete` query. */
export type DeleteNode = WriteNode & {
	readonly kind: 'delete';
	readonly where: OperationNode | undefined;
	readonly allRows: boolean;
};
