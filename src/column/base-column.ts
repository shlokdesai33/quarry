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
	readonly name?: string | undefined;
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
 * - `Column` (what the factories return): `nullable` → `NullableColumn`,
 *   `default` → `DefaultColumn`, `generated` → `GeneratedColumn`,
 *   `array` → `ArrayColumn`
 * - `IntegerColumn`: as `Column`, plus `identity` → `IdentityColumn`
 * - `NullableColumn`: as `Column` (its `nullable` → `NullableColumn`),
 *   without `array`: elements are never nullable
 * - `ArrayColumn`: as `Column` (its `nullable` → `ArrayColumn`), without
 *   `array`
 * - `DefaultColumn`: `nullable`, `default` → `DefaultColumn`
 * - `GeneratedColumn`: `nullable`, `generated` → `GeneratedColumn`
 * - `IdentityColumn`: none
 *
 * `as()` is valid everywhere and keeps the state.
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
	readonly name: string | undefined;

	/**
	 * Creates a new column.
	 * 
	 * @param args the arguments for the column.
	 */
	constructor({ dataType, name }: ColumnArgs<D>) {
		this.dataType = dataType;
		this.name = name;
	}

	/**
	 * Sets the TypeScript view of the column (branded ids, literal unions,
	 * read-only columns, asymmetric nullability). The types are not checked
	 * against the SQL type or each other: they must match what the driver
	 * returns and what postgres accepts.
	 *
	 * @example text().as<string, never, never>()
	 */
	abstract as(): BaseColumn<D, unknown, unknown, unknown>;
}
