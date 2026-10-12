import type { AnyColumn } from './column/any-column.js';
import { compile, type CompiledQuery } from './compile.js';
import {
	type ExecuteResult,
	type Executor,
	NoRowError,
	RowCountError,
	type RunOptions,
	TooManyRowsError,
} from './executor.js';
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

/** A value written to `column`: an expression as is, a value encoded. */
export function valueNode(column: AnyColumn, value: unknown): OperationNode {
	return Expression.is(value)
		? value._quarry.node
		: { kind: 'value', value: column._quarry.dataType.serialize(value) };
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
			renderType(codeType(column._quarry.dataType)),
		),
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

/** Compiles and runs a write query, checking `expectRows`. */
async function runWrite(
	executor: Executor | undefined,
	node: InsertNode | UpdateNode | DeleteNode,
	options: RunOptions | undefined,
): Promise<{ readonly query: CompiledQuery; readonly result: ExecuteResult }> {
	if (executor === undefined) {
		throw new Error(
			'The query has no database to run on: start it from `database(...)`',
		);
	}
	const query = compile(node);
	const result = await executor.execute(query, options);
	const count = result.rowCount ?? 0;
	if (node.expectRows !== undefined && count !== node.expectRows) {
		throw new RowCountError(query, node.expectRows, count, node.table.name);
	}
	return { query, result };
}

/** Runs a write query, resolving to the number of rows it affected. */
export async function executeWrite(
	executor: Executor | undefined,
	node: InsertNode | UpdateNode | DeleteNode,
	options: RunOptions | undefined,
): Promise<WriteResult> {
	const { result } = await runWrite(executor, node, options);
	return { rowCount: result.rowCount ?? 0 };
}

/** Runs a write query, returning its `returning` rows, typed by the caller's `returning` list. */
// eslint-disable-next-line typescript/no-unnecessary-type-parameters -- the builder's row type, which only its returning list knows
export async function writeRows<O>(
	executor: Executor | undefined,
	node: InsertNode | UpdateNode | DeleteNode,
	options: RunOptions | undefined,
): Promise<WrittenRows<O>> {
	const { query, result } = await runWrite(executor, node, options);
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the returning list supplies the row type
	return { query, rows: result.rows as O[], table: node.table.name };
}

/** A write query's `returning` rows, with the query and the table it wrote. */
interface WrittenRows<O> {
	readonly query: CompiledQuery;
	readonly rows: O[];
	readonly table: string;
}

/** The one row: throws `NoRowError` or `TooManyRowsError` otherwise. */
export function exactlyOne<O>({ query, rows, table }: WrittenRows<O>): O {
	const [row, ...rest] = rows;
	if (row === undefined) throw new NoRowError(query, table);
	if (rest.length > 0) throw new TooManyRowsError(query, table);
	return row;
}

/** The row, if any: throws `TooManyRowsError` for several. */
export function atMostOne<O>({
	query,
	rows,
	table,
}: WrittenRows<O>): O | undefined {
	const [row, ...rest] = rows;
	if (rest.length > 0) throw new TooManyRowsError(query, table);
	return row;
}
