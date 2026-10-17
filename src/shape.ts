import type { CompiledQuery } from './compile.js';
import {
	type Executor,
	NoRowError,
	type ReadOptions,
	TooManyRowsError,
} from './executor.js';
import { Query } from './query.js';

/** Makes the error an `expect` shape throws, from the one it would throw. */
export type ErrorFor<E extends Error> = (error: E) => Error;

/** What a shape reads: the rows of a query that ran. */
export interface ShapeInput {
	readonly query: CompiledQuery;
	/** The table the query reads (its `from`) or writes, by its name in the database. */
	readonly table: string | undefined;
	/** The rows, as the shape's `rows` options asked for them. */
	readonly rows: readonly unknown[];
	/** Every row the query returned or affected, though `rows` may hold only the first. */
	readonly count: number;
}

/** How a result is read from a query's rows. */
export interface Shape<R> {
	readonly read: (input: ShapeInput) => R;
	/** Whether `read` can throw. */
	readonly checked: boolean;
	/** How the executor returns the rows, for `read`. */
	readonly rows?: ReadOptions;
}

/** `true` when the row `O` has exactly one column. */
type IsOneColumn<O> = {
	[K in keyof O]-?: [Exclude<keyof O, K>] extends [never] ? true : false;
}[keyof O];

/**
 * The arguments `A` of `takeValue` or `expectValue` on rows `O`, when they
 * have one column; otherwise one more argument, so the call fails. The row
 * type doesn't record which column comes first.
 */
export type ValueArgs<O, A extends readonly unknown[]> = [keyof O] extends [
	never,
]
	? [oneColumn: 'select exactly one column to read a value']
	: [IsOneColumn<O>] extends [true]
		? A
		: [oneColumn: 'select exactly one column to read a value'];

/** The type of the one column of the row `O`. */
export type ColumnValue<O> = O[keyof O];

/** The query `query`, read by `shape`. */
export function shapedQuery<R>(
	executor: Executor | undefined,
	query: CompiledQuery,
	table: string | undefined,
	shape: Shape<R>,
): Query<R> {
	return new Query({
		query,
		executor,
		checked: shape.checked,
		rows: shape.rows,
		read: ({ rows, rowCount }) =>
			shape.read({
				query,
				table,
				rows,
				count: Math.max(rowCount ?? 0, rows.length),
			}),
	});
}

/** The rows of a result, typed by the select or `returning` list. */
function rowsOf<O>({ rows }: ShapeInput): O[] {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the select or returning list supplies the row type
	return rows as O[];
}

const firstRow: ReadOptions = { keepRows: 1 };
/** Positional rows, of the one column `ValueArgs` allows. */
const firstValueRows: ReadOptions = { rowMode: 'array', keepRows: 1 };
/** Enough rows to tell one from several; `count` says how many there were. */
const twoRows: ReadOptions = { keepRows: 2 };

const isNonEmpty = <O>(rows: O[]): rows is [O, ...O[]] => rows.length > 0;

/** `error`, or the error `err` makes of it. */
export const failure = <E extends Error>(
	err: ErrorFor<E> | undefined,
	error: E,
): Error => (err === undefined ? error : err(error));

/** Every row. */
export const allRows = <O>(): Shape<O[]> => ({
	read: rowsOf<O>,
	checked: false,
});

/** The first row, if any. */
export const takeFirst = <O>(): Shape<O | undefined> => ({
	read: (input) => rowsOf<O>(input)[0],
	checked: false,
	rows: firstRow,
});

/** The first column of the first row, if any. */
export const takeValue = <V>(): Shape<V | undefined> => ({
	read: (input) => rowsOf<readonly [V]>(input)[0]?.[0],
	checked: false,
	rows: firstValueRows,
});

/** Every row, of which there must be one or more. */
export const expectNonEmpty = <O>(
	err: ErrorFor<NoRowError> | undefined,
): Shape<[O, ...O[]]> => ({
	read: (input) => {
		const rows = rowsOf<O>(input);
		if (isNonEmpty(rows)) return rows;
		throw failure(
			err,
			new NoRowError(input.query, input.table, 'at least one'),
		);
	},
	checked: true,
});

/** The first row, of which there must be one. */
export const expectFirst = <O>(
	err: ErrorFor<NoRowError> | undefined,
): Shape<O> => ({
	read: (input) => {
		const [row] = rowsOf<O>(input);
		if (row !== undefined) return row;
		throw failure(
			err,
			new NoRowError(input.query, input.table, 'at least one'),
		);
	},
	checked: true,
	rows: firstRow,
});

/** The one row: there must be exactly one. */
export const expectOne = <O>(
	err: ErrorFor<NoRowError | TooManyRowsError> | undefined,
): Shape<O> => ({
	read: (input) => {
		const [row] = rowsOf<O>(input);
		if (row === undefined) {
			throw failure(err, new NoRowError(input.query, input.table));
		}
		if (input.count > 1) {
			throw failure(
				err,
				new TooManyRowsError(
					input.query,
					input.table,
					input.count,
					'exactly one',
				),
			);
		}
		return row;
	},
	checked: true,
	rows: twoRows,
});

/** The row, if any: there must not be several. */
export const expectAtMostOne = <O>(
	err: ErrorFor<TooManyRowsError> | undefined,
): Shape<O | undefined> => ({
	read: (input) => {
		if (input.count > 1) {
			throw failure(
				err,
				new TooManyRowsError(input.query, input.table, input.count),
			);
		}
		return rowsOf<O>(input)[0];
	},
	checked: true,
	rows: twoRows,
});

/** The first column of the first row, of which there must be one. */
export const expectValue = <V>(
	err: ErrorFor<NoRowError> | undefined,
): Shape<V> => ({
	read: (input) => {
		const [row] = rowsOf<readonly [V]>(input);
		if (row !== undefined) return row[0];
		throw failure(
			err,
			new NoRowError(input.query, input.table, 'at least one'),
		);
	},
	checked: true,
	rows: firstValueRows,
});

/** The `err` argument of `expectValue`, among the arguments `ValueArgs` allows. */
export function errorArg<E extends Error>(
	args: readonly unknown[],
): ErrorFor<E> | undefined {
	const [err] = args;
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `ValueArgs` takes nothing else that is a function
	return typeof err === 'function' ? (err as ErrorFor<E>) : undefined;
}
