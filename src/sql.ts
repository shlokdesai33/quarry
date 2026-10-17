import { compile, type CompiledQuery, identifier } from './compile.js';
import {
	type Executor,
	type NoRowError,
	RowCountError,
	type RunOptions,
	type TooManyRowsError,
} from './executor.js';
import { Expression } from './expression.js';
import type { LiteralNode, OperationNode, RawNode } from './node.js';
import { type Query, rejectAwait } from './query.js';
import {
	allRows,
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
	shapedQuery,
	takeFirst,
	takeValue,
	type ValueArgs,
} from './shape.js';
import { Table, tableNode } from './table.js';
import { toSQL as renderSQL, type ToSQLOptions } from './to-sql.js';

/**
 * A fragment of SQL written by hand, as `sql` makes: an expression of type
 * `T`, which nothing checks. It has no SQL type of its own, so it has no
 * comparison methods and its values are read by the type postgres reports.
 */
export class Sql<T> extends Expression<T> {}

/** What a `sql` template takes between its strings. */
export type SqlValue = unknown;

/** The node of one interpolated value; see `sql`. */
function interpolated(value: SqlValue): OperationNode {
	// a table has `_quarry` too, which `Expression.is` looks for
	if (value instanceof Table) {
		const table = tableNode(value);
		const name = identifier(table.name);
		const text =
			table.alias === undefined
				? name
				: `${name} as ${identifier(table.alias)}`;
		return { kind: 'raw', fragments: [text], nodes: [], table };
	}
	if (Expression.is(value)) return value._quarry.node;
	if (value === undefined) {
		throw new TypeError(
			'A value interpolated into sql is undefined; for SQL NULL, pass null',
		);
	}
	return { kind: 'value', value };
}

/** SQL text written as is. */
function verbatim(text: string): RawNode {
	return { kind: 'raw', fragments: [text], nodes: [] };
}

/** Whether `strings` came from a template literal, not a string built at run time. */
function isTemplate(strings: unknown): strings is TemplateStringsArray {
	return (
		Array.isArray(strings) &&
		'raw' in strings &&
		Array.isArray((strings as { raw: unknown }).raw)
	);
}

/** The raw node of a template's strings and values. */
function templateNode(
	strings: TemplateStringsArray,
	values: readonly SqlValue[],
): RawNode {
	if (!isTemplate(strings)) {
		throw new TypeError(
			'sql is a template tag: sql`...`, so values are parameters, never SQL text',
		);
	}
	return {
		kind: 'raw',
		fragments: [...strings],
		nodes: values.map(interpolated),
	};
}

/** The `sql` tag and its helpers. */
export interface SqlTag {
	/**
	 * A fragment of SQL written by hand, for anything the builder doesn't
	 * model, usable wherever an expression of type `T` is: in a select list
	 * (with `.as()`), a `where`, an `orderBy`. `T` is a promise you make;
	 * nothing checks it.
	 *
	 * Interpolated values become parameters, whose types postgres infers
	 * from where they stand. Expressions (`eb.ref(...)`, `eb.fn...`, other
	 * fragments) and tables are written into the SQL, as are `sql.id`,
	 * `sql.lit` and `sql.join`. A fragment is written as is, without
	 * brackets: bracket it where precedence matters.
	 *
	 * @example .select((eb) => [sql<number>`extract(epoch from ${eb.ref('users.createdAt')})`.as('epoch')])
	 * @example .where((eb) => sql<boolean>`${eb.ref('posts.title')} % ${search}`)
	 */
	<T = unknown>(strings: TemplateStringsArray, ...values: SqlValue[]): Sql<T>;

	/**
	 * A quoted identifier, its parts joined by dots: `sql.id('app', 'users')`
	 * is `"app"."users"`. For names that aren't values, such as a schema or a
	 * column the builder doesn't know.
	 */
	id(...parts: readonly [string, ...string[]]): Sql<unknown>;

	/**
	 * A literal written into the SQL rather than sent as a parameter: a
	 * string (quoted and escaped), a finite number, a boolean or null. For
	 * the places postgres takes no parameter.
	 *
	 * @example sql`set local statement_timeout = ${sql.lit('5s')}`
	 */
	lit<const T extends string | number | boolean | null>(value: T): Sql<T>;

	/**
	 * `items` written one after the other, separated by `separator` (`, `
	 * by default), each as `sql` writes an interpolated value: a list of
	 * parameters or expressions.
	 *
	 * @example sql`${eb.ref('users.id')} in (${sql.join(ids)})`
	 */
	join(items: readonly SqlValue[], separator?: Sql<unknown>): Sql<unknown>;

	/**
	 * A parameter to show as `'[redacted]'`, as a value bound against a
	 * `sensitive()` column is, where nothing else says it is secret: in
	 * `onQuery` events, errors and `toSQL({ inline })`. What is sent is
	 * unchanged. A fragment that reads a sensitive column or interpolates a
	 * table with one redacts its values without it.
	 *
	 * @example db.sql`update accounts set password_hash = ${sql.sensitive(hash)} where id = ${id}`
	 */
	sensitive(value: unknown): Sql<unknown>;
}

export const sql: SqlTag = Object.assign(
	<T>(strings: TemplateStringsArray, ...values: SqlValue[]): Sql<T> =>
		new Sql<T>(templateNode(strings, values)),
	{
		id: (...parts: readonly [string, ...string[]]): Sql<unknown> =>
			new Sql(verbatim(parts.map(identifier).join('.'))),
		lit: <const T extends string | number | boolean | null>(
			value: T,
		): Sql<T> => {
			if (typeof value === 'number' && !Number.isFinite(value)) {
				throw new RangeError(`sql.lit takes a finite number, not ${value}`);
			}
			const node: LiteralNode = { kind: 'literal', value };
			return new Sql<T>(node);
		},
		join: (
			items: readonly SqlValue[],
			separator: Sql<unknown> = new Sql(verbatim(', ')),
		): Sql<unknown> => {
			const nodes: OperationNode[] = [];
			items.forEach((item, i) => {
				if (i > 0) nodes.push(separator._quarry.node);
				nodes.push(interpolated(item));
			});
			return new Sql({
				kind: 'raw',
				fragments: ['', ...nodes.map(() => '')],
				nodes,
			});
		},
		sensitive: (value: unknown): Sql<unknown> => {
			if (value === undefined) {
				throw new TypeError(
					'A value interpolated into sql is undefined; for SQL NULL, pass null',
				);
			}
			return new Sql({ kind: 'value', value, sensitive: true });
		},
	},
);

/** What a whole statement written with `db.sql` resolves to without a shape. */
export interface SqlResult<R> {
	/** The rows it returned. */
	readonly rows: R[];
	/** The number of rows it returned or affected. */
	readonly rowCount: number;
}

/**
 * A whole statement written by hand with `db.sql` (or `tx.sql`, on the
 * transaction's connection), whose rows are `R`: a promise you make,
 * which nothing checks. Values interpolated into it are parameters,
 * expressions written into it; see `sql`.
 *
 * Like a builder, it runs with `execute()`, or in `db.batch`, and has the
 * same result shapes: the `take…` shapes never throw, the `expect…` shapes
 * do.
 */
export class SqlQuery<R> {
	/** The type of a row. Never set. */
	declare readonly $output: R;

	readonly #executor: Executor | undefined;
	readonly #node: RawNode;
	readonly #query: CompiledQuery;

	constructor(executor: Executor | undefined, node: RawNode) {
		this.#executor = executor;
		this.#node = node;
		this.#query = compile(node);
	}

	/** Runs the statement, resolving to its rows and row count. */
	execute(options?: RunOptions): Promise<SqlResult<R>> {
		return this.toQuery().execute(options);
	}

	/** The query `execute()` runs, for `db.batch`. */
	toQuery(): Query<SqlResult<R>> {
		return this.#shaped({
			read: (input) => ({
				rows: allRows<R>().read(input),
				rowCount: input.count,
			}),
			checked: false,
		});
	}

	/**
	 * The SQL and parameters `execute()` sends; with `inline` or `pretty`,
	 * rendered as the builders' `toSQL` renders theirs.
	 */
	toSQL(options?: ToSQLOptions): CompiledQuery {
		return options?.inline || options?.pretty
			? renderSQL(this.#node, options)
			: this.#query;
	}

	/** The first row, if any; never throws for the number of rows. */
	takeFirst(): Query<R | undefined> {
		return this.#shaped(takeFirst<R>());
	}

	/** The value of the first column of the first row, if any; never throws for the number of rows. */
	takeValue(
		..._oneColumn: ValueArgs<R, []>
	): Query<ColumnValue<R> | undefined> {
		return this.#shaped(takeValue<ColumnValue<R>>());
	}

	/** Every row, as a non-empty array; throws `NoRowError` (or what `err` makes of it) when there is none. */
	expectNonEmpty(err?: ErrorFor<NoRowError>): Query<[R, ...R[]]> {
		return this.#shaped(expectNonEmpty<R>(err));
	}

	/** The first row; throws `NoRowError` (or what `err` makes of it) when there is none. */
	expectFirst(err?: ErrorFor<NoRowError>): Query<R> {
		return this.#shaped(expectFirst<R>(err));
	}

	/** The one row; throws `NoRowError` when there is none and `TooManyRowsError` when there are several. */
	expectOne(err?: ErrorFor<NoRowError | TooManyRowsError>): Query<R> {
		return this.#shaped(expectOne<R>(err));
	}

	/** The row, if any; throws `TooManyRowsError` (or what `err` makes of it) when there are several. */
	expectAtMostOne(err?: ErrorFor<TooManyRowsError>): Query<R | undefined> {
		return this.#shaped(expectAtMostOne<R>(err));
	}

	/** The value of the first column of the first row; throws `NoRowError` (or what `err` makes of it) when there is no row. */
	expectValue(
		...args: ValueArgs<R, [err?: ErrorFor<NoRowError>]>
	): Query<ColumnValue<R>> {
		return this.#shaped(expectValue<ColumnValue<R>>(errorArg(args)));
	}

	/**
	 * Requires the statement to return or affect exactly `count` rows;
	 * resolves as `execute()` does, and throws `RowCountError` (or what
	 * `err` makes of it) otherwise.
	 */
	expectRows(
		count: number,
		err?: ErrorFor<RowCountError>,
	): Query<SqlResult<R>> {
		if (!Number.isInteger(count) || count < 0) {
			throw new RangeError(
				`expectRows takes a whole number of rows, not ${count}`,
			);
		}
		return this.#shaped({
			read: (input) => {
				if (input.count !== count) {
					throw failure(
						err,
						new RowCountError(input.query, count, input.count, undefined),
					);
				}
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `R` is the promise `db.sql<R>` makes
				return { rows: input.rows as R[], rowCount: input.count };
			},
			checked: true,
		});
	}

	/** @deprecated A query runs with `execute()`; awaiting one rejects. */
	// oxlint-disable-next-line unicorn/no-thenable -- so that a forgotten execute() fails loudly
	readonly then = rejectAwait;

	#shaped<T>(shape: Shape<T>): Query<T> {
		return shapedQuery(this.#executor, this.#query, undefined, shape);
	}
}

/** `db.sql`: a whole statement on `executor`. */
export function sqlQuery<R>(
	executor: Executor | undefined,
	strings: TemplateStringsArray,
	values: readonly SqlValue[],
): SqlQuery<R> {
	return new SqlQuery<R>(executor, templateNode(strings, values));
}
