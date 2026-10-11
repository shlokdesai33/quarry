import type { AnyColumn } from './column/any-column.js';
import { Expression } from './expression.js';
import { typedExpression } from './expression-methods.js';
import type { OperationNode, RowsNode, SetNode } from './node.js';
import type { Expr } from './operators.js';
import type { AnyTable } from './table.js';
import type { Prettify } from './types.js';

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
 * place and takes the new value.
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
	return [...merged].map(([column, value]) => ({ column, value }));
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

/** Running a write query, which isn't supported yet. */
export function notImplemented(
	kind: 'insert' | 'update' | 'delete',
): Promise<never> {
	return Promise.reject(
		new Error(
			`Running ${kind} queries isn't implemented yet: inspect them with toNode()`,
		),
	);
}
