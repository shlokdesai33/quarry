import type { AnyColumn } from './column/any-column.js';
import { compile } from './compile.js';
import { type Executor, NoRowError, RowCountError } from './executor.js';
import { Expression } from './expression.js';
import { typedExpression } from './expression-methods.js';
import type {
	DeleteNode,
	InsertNode,
	OperationNode,
	RowsNode,
	SetNode,
	UpdateNode,
} from './node.js';
import type { Expr } from './operators.js';
import type { Query } from './query.js';
import {
	type ErrorFor,
	expectNonEmpty,
	failure,
	type Shape,
	type ShapeInput,
	shapedQuery,
} from './shape.js';
import type { AnyTable } from './table.js';
import type { Prettify } from './types.js';
import { codeType, renderType } from './verify/sql-type.js';

/** The columns of the table `T`, by the keys they are declared under. */
type Columns<T extends AnyTable> = T['schema']['columns'];

/** A column of the table `T`, by the key it is declared under. */
export type ColumnKey<T extends AnyTable> = keyof Columns<T> & string;

/** The columns of `T` an update can set: those not read-only. */
export type UpdateKey<T extends AnyTable> = {
	[K in ColumnKey<T>]: [Columns<T>[K]['$update']] extends [never] ? never : K;
}[ColumnKey<T>];

/**
 * What an update sets: any of the columns it can, each to a value of its
 * update type or an expression that evaluates to one.
 */
export type SetValues<T extends AnyTable> = {
	readonly [K in UpdateKey<T>]?:
		| Columns<T>[K]['$update']
		| Expression<Columns<T>[K]['$update']>;
};

/**
 * The row an upsert proposed, as `excluded` in its `do update`: each column
 * as an expression of its type.
 */
export type Excluded<T extends AnyTable> = {
	readonly [K in ColumnKey<T>]: Expr<
		Columns<T>[K]['$select'],
		Columns<T>[K]['_quarry']['dataType']
	>;
};

/**
 * A row of an `updateMany`: the `by` columns, which match it to the table's
 * row, and any of the columns an update can set.
 */
export type UpdateManyRow<
	T extends AnyTable,
	B extends ColumnKey<T>,
> = Prettify<
	{ readonly [K in B]: NonNullable<Columns<T>[K]['$select']> } & {
		readonly [K in Exclude<UpdateKey<T>, B>]?: Columns<T>[K]['$update'];
	}
>;

/** What a write query without `returning` resolves to. */
export interface WriteResult {
	/** The number of rows the query inserted, updated or deleted. */
	readonly rowCount: number;
}

/** The column declared under `key`, and its name in the database. */
export function columnOf(
	table: AnyTable,
	key: string,
): { readonly column: AnyColumn; readonly name: string } {
	const column = table.schema.columns[key];
	if (column === undefined) {
		throw new Error(`Unknown column "${key}" in table "${table.name}"`);
	}
	return { column, name: column._quarry.columnName ?? key };
}

/** A value written to `column`: an expression as is, a value encoded by the column's codec. */
export function valueNode(column: AnyColumn, value: unknown): OperationNode {
	return Expression.is(value)
		? value._quarry.node
		: { kind: 'value', value, codec: column._quarry.dataType.codec };
}

/**
 * The assignments of `values` merged over `set`: a column set again keeps its
 * place and takes the new value, and an undefined value is left out. Throws
 * when that leaves nothing to set.
 */
export function setNodes(
	table: AnyTable,
	set: readonly SetNode[],
	values: object,
): SetNode[] {
	const merged = new Map(set.map((node) => [node.column, node.value]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) continue;
		const { column, name } = columnOf(table, key);
		merged.set(name, valueNode(column, value));
	}
	const nodes = [...merged].map(([column, value]) => ({ column, value }));
	if (nodes.length === 0) {
		throw new Error(
			`The update of "${table.name}" sets no columns: an undefined value leaves its column out, and every value given was undefined (or none was given)`,
		);
	}
	return nodes;
}

/**
 * Rows of values, aligned on the columns any of them has, in the order they
 * first appear; a column a row lacks is its `default`.
 */
export function rowsNode(
	table: AnyTable,
	rows: readonly object[],
	strategy: RowsNode['strategy'],
): RowsNode {
	const keys: string[] = [];
	for (const row of rows) {
		for (const [key, value] of Object.entries(row)) {
			if (value !== undefined && !keys.includes(key)) keys.push(key);
		}
	}
	const columns = keys.map((key) => columnOf(table, key));
	return {
		columns: columns.map(({ name }) => name),
		types: columns.map(({ column }) =>
			renderType({
				...codeType(column._quarry.dataType),
				modifiers: undefined,
			}),
		),
		codecs: columns.map(({ column }) => column._quarry.dataType.codec),
		rows: rows.map((row) => {
			const values = new Map(Object.entries(row));
			return keys.map((key, i) => {
				const value = values.get(key);
				const target = columns[i];
				return value === undefined || target === undefined
					? undefined
					: valueNode(target.column, value);
			});
		}),
		strategy,
	};
}

/** The `excluded` row of an upsert into `table`. */
export function excluded<T extends AnyTable>(table: T): Excluded<T> {
	const row: Record<string, unknown> = {};
	for (const key of Object.keys(table.schema.columns)) {
		const { column, name } = columnOf(table, key);
		row[key] = typedExpression(
			{ kind: 'reference', table: 'excluded', column: name },
			column._quarry.dataType,
		);
	}
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- every column was added above
	return row as Excluded<T>;
}

/** Checks the argument of `expectRows`. */
export function rowCount(count: number): number {
	if (!Number.isInteger(count) || count < 0) {
		throw new RangeError(
			`expectRows takes a whole number of rows, not ${count}`,
		);
	}
	return count;
}

/** A write query, read by `shape`. */
export function writeQuery<R>(
	executor: Executor | undefined,
	node: InsertNode | UpdateNode | DeleteNode,
	shape: Shape<R>,
): Query<R> {
	return shapedQuery(executor, compile(node), node.table.name, shape);
}

/**
 * What a write query's `execute()` resolves to without a shape: its
 * `returning` rows, or without `returning` (`O` is `undefined`), its row
 * count.
 */
export type WriteOutput<O> = [O] extends [undefined] ? WriteResult : O[];

/**
 * What a write query's `expectNonEmpty()` resolves to: its `returning`
 * rows, one or more, or without `returning`, its row count.
 */
export type NonEmptyOutput<O> = [O] extends [undefined]
	? WriteResult
	: [O, ...O[]];

/** The default shape's result, `WriteOutput`, of a query that ran. */
function output<O>(
	node: InsertNode | UpdateNode | DeleteNode,
	input: ShapeInput,
): WriteOutput<O> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `returning` is what makes `O` a row type
	return (
		node.returning.length > 0 ? input.rows : { rowCount: input.count }
	) as WriteOutput<O>;
}

/** A write query in its default shape; see `WriteOutput`. */
export function writeOutput<O>(
	executor: Executor | undefined,
	node: InsertNode | UpdateNode | DeleteNode,
): Query<WriteOutput<O>> {
	return writeQuery(executor, node, {
		read: (input) => output<O>(node, input),
		checked: false,
	});
}

/**
 * A write query that must affect one or more rows; see `NonEmptyOutput`.
 * Throws `NoRowError`, or what `err` makes of it, otherwise.
 */
export function writeNonEmpty<O>(
	executor: Executor | undefined,
	node: InsertNode | UpdateNode | DeleteNode,
	err: ErrorFor<NoRowError> | undefined,
): Query<NonEmptyOutput<O>> {
	if (node.returning.length > 0) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- with `returning`, `O` is a row type
		return writeQuery(executor, node, expectNonEmpty<O>(err)) as Query<
			NonEmptyOutput<O>
		>;
	}
	return writeQuery(executor, node, {
		read: (input) => {
			if (input.count === 0) {
				throw failure(
					err,
					new NoRowError(input.query, input.table, 'at least one', 'affected'),
				);
			}
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- without `returning`, `O` is `undefined`
			return { rowCount: input.count } as NonEmptyOutput<O>;
		},
		checked: true,
	});
}

/**
 * A write query that must affect exactly `count` rows, in its default
 * shape. Throws `RowCountError`, or what `err` makes of it, otherwise.
 */
export function writeExpectRows<O>(
	executor: Executor | undefined,
	node: InsertNode | UpdateNode | DeleteNode,
	count: number,
	err: ErrorFor<RowCountError> | undefined,
): Query<WriteOutput<O>> {
	const expected = rowCount(count);
	return writeQuery(executor, node, {
		read: (input) => {
			if (input.count !== expected) {
				throw failure(
					err,
					new RowCountError(input.query, expected, input.count, input.table),
				);
			}
			return output<O>(node, input);
		},
		checked: true,
	});
}
