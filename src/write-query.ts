import type { AnyColumn } from './column/any-column.js';
import type { DataType } from './data-type/data-type.js';
import { compile, type CompiledQuery } from './compile.js';
import {
	type Executor,
	NoRowError,
	RowCountError,
	type RunOptions,
	type TooManyRowsError,
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
import { type Missing, type Query, rejectAwait } from './query.js';
import {
	type ColumnValue,
	type ErrorFor,
	errorArg,
	expectAtMostOne,
	expectFirst,
	expectNonEmpty,
	expectOne,
	expectValue,
	failure,
	type Shape,
	type ShapeInput,
	shapedQuery,
	takeFirst,
	takeValue,
	type ValueArgs,
} from './shape.js';
import type { AnyTable } from './table.js';
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

/** What a write query without `returning` resolves to. */
export interface WriteResult {
	/** The number of rows the query inserted, updated or deleted. */
	readonly rowCount: number;
}

/** A column of a table: the column declared under a key, and its name in the database. */
interface ColumnOf {
	readonly column: AnyColumn;
	readonly name: string;
}

/** Each table's columns by key, looked up once per table: only keys that name a column are kept. */
const columnsOf = new WeakMap<AnyTable, Map<string, ColumnOf>>();

/** The column declared under `key`, and its name in the database. */
export function columnOf(table: AnyTable, key: string): ColumnOf {
	let columns = columnsOf.get(table);
	if (columns === undefined) {
		columns = new Map();
		columnsOf.set(table, columns);
	}
	let found = columns.get(key);
	if (found === undefined) {
		const column = table.schema.columns[key];
		if (column === undefined) {
			throw new Error(`Unknown column "${key}" in table "${table.name}"`);
		}
		found = { column, name: column._quarry.columnName ?? key };
		columns.set(key, found);
	}
	return found;
}

/** A value written to `column`: an expression as is, a value encoded by the column's codec. */
function valueNode(column: AnyColumn, value: unknown): OperationNode {
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
	const nodes = [...set];
	const keys = Object.keys(values);
	// read once each, before any is written, as Object.entries reads them
	const given: unknown[] = [];
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the values are a record of columns
	for (const key of keys) given.push((values as Record<string, unknown>)[key]);
	// a short list is searched; a long one indexed
	const index =
		set.length + keys.length > 32
			? new Map(set.map((node, i) => [node.column, i]))
			: undefined;
	for (let k = 0; k < keys.length; k++) {
		const value = given[k];
		if (value === undefined) continue;
		// oxlint-disable-next-line typescript/no-non-null-assertion -- within bounds
		const { column, name } = columnOf(table, keys[k]!);
		const node = { column: name, value: valueNode(column, value) };
		const at =
			index === undefined
				? indexOfColumn(nodes, name)
				: (index.get(name) ?? -1);
		if (at >= 0) nodes[at] = node;
		else {
			index?.set(name, nodes.length);
			nodes.push(node);
		}
	}
	if (nodes.length === 0) {
		throw new Error(
			`The update of "${table.name}" sets no columns: an undefined value leaves its column out, and every value given was undefined (or none was given)`,
		);
	}
	return nodes;
}

function indexOfColumn(nodes: readonly SetNode[], name: string): number {
	for (let i = 0; i < nodes.length; i++)
		if (nodes[i]?.column === name) return i;
	return -1;
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
	// each row's own enumerable keys and values, read once, as Object.entries reads them
	const rowKeys: string[][] = [];
	const rowValues: unknown[][] = [];
	const keys: string[] = [];
	for (const row of rows) {
		const own = Object.keys(row);
		const values: unknown[] = [];
		for (const key of own) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a row is a record of its columns
			const value = (row as Record<string, unknown>)[key];
			values.push(value);
			if (value !== undefined && !keys.includes(key)) keys.push(key);
		}
		rowKeys.push(own);
		rowValues.push(values);
	}
	const resolved = keys.map((key) => columnOf(table, key));
	const cells: (OperationNode | undefined)[][] = [];
	for (let r = 0; r < rowKeys.length; r++) {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- within bounds
		const own = rowKeys[r]!;
		// oxlint-disable-next-line typescript/no-non-null-assertion -- within bounds
		const values = rowValues[r]!;
		const row: (OperationNode | undefined)[] = [];
		for (let i = 0; i < keys.length; i++) row.push(undefined);
		for (let j = 0; j < own.length; j++) {
			const value = values[j];
			if (value === undefined) continue;
			// oxlint-disable-next-line typescript/no-non-null-assertion -- within bounds
			const key = own[j]!;
			const i = keys[j] === key ? j : keys.indexOf(key);
			// oxlint-disable-next-line typescript/no-non-null-assertion -- every defined key is in keys
			row[i] = valueNode(resolved[i]!.column, value);
		}
		cells.push(row);
	}
	return {
		columns: resolved.map(({ name }) => name),
		types: resolved.map(({ column }) => castType(column._quarry.dataType)),
		codecs: resolved.map(({ column }) => column._quarry.dataType.codec),
		rows: cells,
		strategy,
	};
}

/** Each data type's SQL type without modifiers, as `unnest` casts its arrays to. */
const castTypes = new WeakMap<DataType, string>();

function castType(dataType: DataType): string {
	let type = castTypes.get(dataType);
	if (type === undefined) {
		type = renderType({ ...codeType(dataType), modifiers: undefined });
		castTypes.set(dataType, type);
	}
	return type;
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
function rowCount(count: number): number {
	if (!Number.isInteger(count) || count < 0) {
		throw new RangeError(
			`expectRows takes a whole number of rows, not ${count}`,
		);
	}
	return count;
}

/** A write query, read by `shape`. */
function writeQuery<R>(
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
function writeOutput<O>(
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
function writeNonEmpty<O>(
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
function writeExpectRows<O>(
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

/**
 * What the insert, update and delete builders share: the `take…` and
 * `expect…` shapes over their `returning` rows (and `expectNonEmpty` and
 * `expectRows` over their row count), `execute()`, `toSQL()` and
 * `toQuery()`. `O` is the `returning` row (`undefined` without
 * `returning`); `M` is what the query still needs before it can run.
 */
export abstract class WriteQueryBuilder<O, M extends string> {
	/** The type of a `returning` row. Never set. */
	declare readonly $output: O;

	/** What the query still needs before it can run. Never set. */
	declare readonly $missing: M;

	/** What the query runs on; `undefined` when it was built on its own. */
	readonly #executor: Executor | undefined;

	constructor(executor: Executor | undefined) {
		this.#executor = executor;
	}

	/** The whole query as one node. */
	abstract toNode(): InsertNode | UpdateNode | DeleteNode;

	/**
	 * The first `returning` row, if any; runs with `execute()`. Never
	 * throws for the number of rows, and doesn't change the SQL: the
	 * statement writes every row it matches, and only the first is decoded.
	 */
	takeFirst(this: WriteQueryBuilder<O & object, never>): Query<O | undefined> {
		return writeQuery(this.#executor, this.toNode(), takeFirst<O>());
	}

	/**
	 * The value of the one `returning` column of the first row, if any;
	 * runs with `execute()`. Never throws for the number of rows, and
	 * doesn't change the SQL: the statement writes every row it matches.
	 *
	 * @example .returning(['users.id']).takeValue()
	 */
	takeValue(
		this: WriteQueryBuilder<O & object, never>,
		..._oneColumn: ValueArgs<O, []>
	): Query<ColumnValue<O> | undefined> {
		return writeQuery(
			this.#executor,
			this.toNode(),
			takeValue<ColumnValue<O>>(),
		);
	}

	/**
	 * Requires the statement to write one or more rows; runs with
	 * `execute()`, which resolves to the `returning` rows, as a non-empty
	 * array, or without `returning`, to the row count. Throws `NoRowError`
	 * (or what `err` makes of it) after the statement ran, when it wrote
	 * none; inside a transaction, that rolls it back.
	 */
	expectNonEmpty(
		this: WriteQueryBuilder<O, never>,
		err?: ErrorFor<NoRowError>,
	): Query<NonEmptyOutput<O>> {
		return writeNonEmpty<O>(this.#executor, this.toNode(), err);
	}

	/**
	 * The first `returning` row; runs with `execute()`, which throws
	 * `NoRowError` (or what `err` makes of it) when there is none, after
	 * the statement ran. Other rows are ignored.
	 */
	expectFirst(
		this: WriteQueryBuilder<O & object, never>,
		err?: ErrorFor<NoRowError>,
	): Query<O> {
		return writeQuery(this.#executor, this.toNode(), expectFirst<O>(err));
	}

	/**
	 * The one `returning` row; runs with `execute()`, which throws
	 * `NoRowError` when there is none and `TooManyRowsError` (with the
	 * `count`) when there are several, after the statement ran; `err`
	 * makes the error to throw instead.
	 */
	expectOne(
		this: WriteQueryBuilder<O & object, never>,
		err?: ErrorFor<NoRowError | TooManyRowsError>,
	): Query<O> {
		return writeQuery(this.#executor, this.toNode(), expectOne<O>(err));
	}

	/**
	 * The `returning` row, if any; runs with `execute()`, which throws
	 * `TooManyRowsError` (or what `err` makes of it) when there are
	 * several, after the statement ran.
	 */
	expectAtMostOne(
		this: WriteQueryBuilder<O & object, never>,
		err?: ErrorFor<TooManyRowsError>,
	): Query<O | undefined> {
		return writeQuery(this.#executor, this.toNode(), expectAtMostOne<O>(err));
	}

	/**
	 * The value of the one `returning` column of the first row; runs with
	 * `execute()`, which throws `NoRowError` (or what `err` makes of it)
	 * when there is no row, after the statement ran.
	 */
	expectValue(
		this: WriteQueryBuilder<O & object, never>,
		...args: ValueArgs<O, [err?: ErrorFor<NoRowError>]>
	): Query<ColumnValue<O>> {
		return writeQuery(
			this.#executor,
			this.toNode(),
			expectValue<ColumnValue<O>>(errorArg(args)),
		);
	}

	/**
	 * Requires the statement to write exactly `count` rows; runs with
	 * `execute()`, which resolves as it does without a shape, and throws
	 * `RowCountError` (or what `err` makes of it) after the statement ran,
	 * when it wrote a different number; inside a transaction, that rolls
	 * it back.
	 *
	 * @example .onConflict('email').doNothing().expectRows(1)
	 * @example .where('docs.id', id).where('docs.version', version).expectRows(1)
	 */
	expectRows(
		this: WriteQueryBuilder<O, never>,
		count: number,
		err?: ErrorFor<RowCountError>,
	): Query<WriteOutput<O>> {
		return writeExpectRows<O>(this.#executor, this.toNode(), count, err);
	}

	/**
	 * Runs the query, resolving to every `returning` row, or without
	 * `returning`, to the number of rows written. Never throws for the
	 * number of rows: the `expect` shapes do.
	 */
	execute(
		this: WriteQueryBuilder<O, never>,
		options?: RunOptions,
	): Promise<WriteOutput<O>> {
		return writeOutput<O>(this.#executor, this.toNode()).execute(options);
	}

	/** The SQL and parameters `execute()` sends. */
	toSQL(): CompiledQuery {
		return compile(this.toNode());
	}

	/** The query `execute()` runs, for `db.batch`; one that still needs clauses has none. */
	toQuery(): [M] extends [never] ? Query<WriteOutput<O>> : Missing<M> {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the type keeps a query that can't run yet out of a batch
		return writeOutput<O>(this.#executor, this.toNode()) as [M] extends [never]
			? Query<WriteOutput<O>>
			: Missing<M>;
	}

	/** @deprecated A query runs with `execute()`; awaiting one rejects. */
	// oxlint-disable-next-line unicorn/no-thenable -- so that a forgotten execute() fails loudly
	readonly then = rejectAwait;
}
