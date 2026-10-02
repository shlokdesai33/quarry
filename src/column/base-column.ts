import type { DataType } from '../data-type/data-type.js';

/** What a column is constructed from. */
export type ColumnArgs<D extends DataType> = {
	/**
	 * The SQL type of the column.
	 */
	readonly dataType: D;
	/**
	 * The name of the column in the database, when it differs from the key it
	 * is declared under.
	 */
	readonly columnName?: string | undefined;
};

/**
 * What every column has: a slot in a table holding values of the SQL type
 * `D`. `S` is the TypeScript type of the column when selected, `I` when
 * inserted and `U` when updated. What depends on the SQL type (operators,
 * value encoding) lives on `D`; nullability and the write rules live here, so
 * they never change `D`.
 *
 * A column is built by chaining modifiers, and each modifier returns the
 * class for the state it leads to, which has only the modifiers still valid
 * there: postgres allows `nullable` with `default` or `generated`, but not
 * `default` with `generated`, nor any of them with `identity`. So an invalid
 * chain is not a type error on some method but a method that isn't there,
 * and autocomplete never offers it. Repeating a modifier is a no-op, so it
 * stays available, and `nullable` excludes nothing but `identity`.
 *
 * - `Column` (what the factories and `array()` return): `nullable` →
 *   `Column`, `default` → `DefaultColumn`, `generated` → `GeneratedColumn`
 * - `IntegerColumn`: as `Column`, plus `identity` → `IdentityColumn`
 * - `DefaultColumn`: `nullable`, `default` → `DefaultColumn`
 * - `GeneratedColumn`: `nullable`, `generated` → `GeneratedColumn`
 * - `IdentityColumn`: none
 *
 * The `array()` factory takes a `Column` of a non-array type as its element.
 * `name()` and `as()` are valid everywhere and keep the state.
 */
export abstract class BaseColumn<D extends DataType, S, I, U> {
	/**
	 * The type of the column when used in a select clause.
	 */
	declare readonly $select: S;

	/**
	 * The type of the column when used in an insert clause.
	 */
	declare readonly $insert: I;

	/**
	 * The type of the column when used in an update clause.
	 */
	declare readonly $update: U;

	/**
	 * The SQL type of the column. Values compared against the column are
	 * encoded by it.
	 */
	readonly dataType: D;

	/**
	 * The name of the column in the database, when it differs from the key it
	 * is declared under.
	 */
	readonly columnName: string | undefined;

	/**
	 * Creates a new column.
	 *
	 * @param args the arguments for the column.
	 */
	constructor({ dataType, columnName }: ColumnArgs<D>) {
		this.dataType = dataType;
		this.columnName = columnName;
	}

	/**
	 * Sets the name of the column in the database, when it differs from the
	 * key it is declared under. Valid in every state, which it keeps.
	 *
	 * @example firstName: text().name('first_name')
	 */
	abstract name(columnName: string): BaseColumn<D, S, I, U>;

	/**
	 * Narrows the TypeScript view of the column (branded ids, literal unions,
	 * read-only columns, asymmetric nullability). Each type can only narrow
	 * the column's current one, and what is written must also be selectable,
	 * so the view never claims a value the driver doesn't return or postgres
	 * wouldn't accept. A column with a default may still omit the value on
	 * insert.
	 *
	 * @example text().as<string, never, never>()
	 */
	abstract as(): BaseColumn<D, unknown, unknown, unknown>;
}
