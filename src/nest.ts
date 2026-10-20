import type { ExpressionBuilder } from './expression-builder.js';
import type { RefsOf } from './refs.js';
import type { AnyTable } from './table.js';

/**
 * Columns of one table in the query, selected as one object of the result
 * row, as `nest` makes it: `A` is its key in the row, `T` its type.
 */
export class Nested<T, A extends string> {
	/** The object's key in the row. */
	readonly alias: A;

	/**
	 * What the library reads: not part of the API. `table` is the name the
	 * table goes by in the query, `columns` the keys of its columns.
	 */
	readonly _quarry: {
		/** Phantom: the object's type in the row. Never set. */
		readonly $type?: T;
		readonly table: string;
		readonly columns: readonly string[];
	};

	constructor(alias: A, table: string, columns: readonly string[]) {
		this.alias = alias;
		this._quarry = { table, columns };
	}

	/**
	 * Keys the object `alias` in the row.
	 *
	 * @example nest('bookings', ['id', 'name']).as('booking')
	 */
	as<const B extends string>(alias: B): Nested<T, B> {
		return new Nested(alias, this._quarry.table, this._quarry.columns);
	}
}

/** The table of the tables `T` that goes by the name `N`. */
type TableNamed<T extends readonly AnyTable[], N> = Extract<
	T[number],
	{ readonly name: N }
>;

/** The keys of the columns of the table `X`. */
type ColumnKey<X extends AnyTable> = keyof X['schema']['columns'] & string;

/** Whether `C` is a column on the outer side of a join: a `NullableColumn`. */
type IsOuter<C> = '$inner' extends keyof C ? true : false;

/** The column `C` as its table reads it in a row it has: unwrapped from every outer join. */
type InnerColumn<C> =
	IsOuter<C> extends true
		? C extends { readonly $inner?: infer I }
			? InnerColumn<Exclude<I, undefined>>
			: C
		: C;

/**
 * The object of the columns `K` of the table `X`: each typed as in a row
 * the table has, and the whole object null when the table is on the outer
 * side of a join, which may have no row for it.
 */
type NestedRow<X extends AnyTable, K extends ColumnKey<X>> =
	IsOuter<X['schema']['columns'][K]> extends true
		? { [C in K]: InnerColumn<X['schema']['columns'][C]>['$select'] } | null
	: { [C in K]: InnerColumn<X['schema']['columns'][C]>['$select'] };

/**
 * Selects columns of the table that goes by `table` in the query (its
 * alias, or its name when not aliased) as one object of the row, keyed by
 * that name: `columns`, or without them, every column. The object is null
 * where a left join (or the other outer joins) found no row for the table,
 * however many of its columns are null where it did.
 */
export interface Nest<T extends readonly AnyTable[]> {
	<N extends T[number]['name']>(
		table: N,
	): Nested<NestedRow<TableNamed<T, N>, ColumnKey<TableNamed<T, N>>>, N>;
	<
		N extends T[number]['name'],
		const C extends readonly [
			ColumnKey<TableNamed<T, N>>,
			...ColumnKey<TableNamed<T, N>>[],
		],
	>(
		table: N,
		columns: C,
	): Nested<NestedRow<TableNamed<T, N>, C[number]>, N>;
}

/** The expression builder of a select list over the tables `T`: it also has `nest`. */
export type SelectBuilder<T extends readonly AnyTable[]> = ExpressionBuilder<
	RefsOf<T>
> & {
	/**
	 * Selects columns of a table in the query as one object of the row,
	 * null where an outer join found no row for the table. The table goes
	 * by its alias, or its name when not aliased; without columns, every
	 * column is selected. The object is keyed by the table's name, or what
	 * `.as()` names it.
	 *
	 * @example .select(({ nest }) => ['users.id', nest('bookings', ['id', 'name'])])
	 * @example .select(({ nest }) => [nest('users'), nest('managers').as('manager')])
	 */
	readonly nest: Nest<T>;
};

/** `nest` over the tables `tables`. */
export function nestOf(
	tables: readonly AnyTable[],
): (table: string, columns?: readonly string[]) => Nested<unknown, string> {
	return (name, columns) => {
		const table = tables.find((candidate) => candidate.name === name);
		if (table === undefined) {
			throw new Error(`nest: "${name}" is not in the query`);
		}
		const keys = columns ?? Object.keys(table.schema.columns);
		if (keys.length === 0) {
			throw new Error(
				`nest: list at least one column of "${name}", or none for every column`,
			);
		}
		keys.forEach((key, i) => {
			if (!Object.hasOwn(table.schema.columns, key)) {
				throw new Error(`nest: "${name}" has no column "${key}"`);
			}
			if (keys.indexOf(key) !== i) {
				throw new Error(`nest: "${key}" is listed twice`);
			}
		});
		return new Nested(name, name, keys);
	};
}
