/**
 * Base class for all column types.
 */
export abstract class Column<S, I = S, U = I> {
	/** type of the column when used in a select clause */
	declare readonly $select: S;
	/** type of the column when used in an insert clause */
	declare readonly $insert: I;
	/** type of the column when used in an update clause */
	declare readonly $update: U;
	/** operators usable in a where clause */
	declare abstract readonly $operators: Record<string, unknown>;

	/**
	 * Marks the column as nullable on select, insert, and update. Use `as()` for
	 * asymmetric cases.
	 *
	 * @example timestamptz().nullable()
	 * @example timestamptz().nullable().as<Date | null, Date | null, Date>()
	 */
	abstract nullable(): Column<S | null, I | null, U | null>;

	/**
	 * Marks the column as having a database default, so it may be omitted on
	 * insert.
	 *
	 * @example timestamptz().default()
	 */
	abstract default(): Column<S, I | undefined, U>;

	/**
	 * Narrows the TypeScript view of the column (branded ids, literal unions,
	 * read-only columns, asymmetric nullability). Writes must stay within both
	 * the current write type and the new select type, so this can never make the
	 * library emit a value postgres would reject`.
	 *
	 * @example timestamptz().as<Date, never, never>()
	 */
	abstract as<X extends S, Y extends I & X, Z extends U & X>(): Column<X, Y, Z>;
}

/**
 * Constraint for "some column". Only for use in `extends` positions: lookups
 * must go through the concrete column type, never through this alias.
 */
export type AnyColumn = {
	readonly $select: unknown;
	readonly $insert: unknown;
	readonly $update: unknown;
	readonly $operators: Record<string, unknown>;
};
