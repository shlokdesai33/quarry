/**
 * A SQL type: the operators a value of the type admits, and how such values
 * are encoded for the driver. Columns and expressions of the type share it,
 * so a value is encoded the same way whether it is compared against a column
 * or against a computed expression.
 *
 * It is not generic over the TypeScript type of its values, which lives on
 * the column or expression instead: `text`, `text null` and `text` narrowed
 * to a union of literals are all the same SQL type. It only records the
 * type's native representation, `$native`, which those narrow. The operators
 * still depend on the value type (`=` takes one), so they are declared in
 * terms of `this['$value']`, which `OperatorsFor` fills in.
 *
 * Instances are immutable.
 */
export abstract class DataType {
	/**
	 * A phantom slot for the value type, filled in by `OperatorsFor`. Never
	 * set.
	 */
	declare readonly $value: unknown;

	/**
	 * A phantom tag naming the SQL type. It keeps types that admit the same
	 * operators, such as `integer` and `real`, distinct.
	 */
	declare abstract readonly $kind: string;

	/**
	 * A phantom property holding the TypeScript type a non-null value of this
	 * type is represented as, both when read and when written: `number` for
	 * `real`, `string` for `bigint` (whose range exceeds a number's).
	 * Columns and expressions of the type narrow it, e.g. to a union of
	 * literals.
	 */
	declare abstract readonly $native: unknown;

	/**
	 * A phantom property holding the operators usable when a value of this
	 * type is on the left, in terms of `this['$value']`.
	 */
	declare abstract readonly $operators: object;

	/**
	 * Converts a value of this type into what the driver should send.
	 * Identity by default: the driver already serialises strings, numbers,
	 * booleans, dates, byte arrays and plain arrays. Overridden where the
	 * JavaScript representation differs from the postgres input syntax.
	 */
	encode(value: unknown): unknown {
		return value;
	}

	/**
	 * Converts the right-hand side of a comparison. Defaults to `encode`, since
	 * most operators compare against a value of the type itself; overridden
	 * where an operator takes something else.
	 */
	encodeOperand(_operator: string, value: unknown): unknown {
		return this.encode(value);
	}
}

/** The operators of the data type `D` for non-null values of type `S`. */
export type OperatorsFor<D extends DataType, S> = (D & {
	readonly $value: S;
})['$operators'];
