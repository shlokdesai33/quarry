import type { Kind } from '../operators.js';

/**
 * How a user-defined data type encodes values, where that differs from
 * passing them to the driver as they are.
 */
type Options = {
	/**
	 * The postgres input syntax of a non-null value of the type, for types the
	 * driver would send wrongly. `null` is always SQL `NULL`, so it never
	 * reaches this.
	 */
	readonly serialize?: (value: unknown) => string;
};

/**
 * A SQL type of kind `K`: how values of the type are encoded for the driver,
 * and, through `OperatorsByKind`, the operators they admit. Columns and
 * expressions of the type share it, so a value is encoded the same way
 * whether it is compared against a column or against a computed expression.
 *
 * It says nothing about the TypeScript type of its values, which lives on
 * the column or expression instead: `text`, `text null` and `text` narrowed
 * to a union of literals are all the same SQL type.
 *
 * A user-defined type gives its encoding as an option; the built-in types
 * that need one override `serialize`, leaving `null` as SQL `NULL`.
 *
 * Instances are immutable.
 */
export class DataType<K extends Kind = Kind> {
	/**
	 * The name of the SQL type, which keys its operators in `OperatorsByKind`.
	 * It also keeps types that admit the same operators, such as `integer`
	 * and `real`, distinct.
	 */
	readonly $kind: K;

	/**
	 * How values are encoded, where they aren't sent as is.
	 */
	readonly #options: Options;

	/**
	 * Creates a data type of the given kind.
	 *
	 * @param kind the name of the SQL type.
	 * @param options how values are encoded, where they aren't sent as is.
	 */
	constructor(kind: K, options: Options = {}) {
		this.$kind = kind;
		this.#options = options;
	}

	/**
	 * Converts a value of this type into what the driver should send: the
	 * `serialize` option's text, or the value as is, since the driver already
	 * serialises strings, numbers, booleans, dates, byte arrays and plain
	 * arrays. `null` is SQL `NULL`.
	 */
	serialize(value: unknown): unknown {
		return this.#options.serialize && value !== null
			? this.#options.serialize(value)
			: value;
	}
}
