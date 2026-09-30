import type { ArrayOperators } from '../operators.js';
import { DataType } from './data-type.js';

/**
 * An array of `E`, e.g. `text[]`. Elements are encoded by `E`, so an array
 * of ranges or of jsonb is sent as the element literals postgres expects.
 *
 * Postgres has no arrays of arrays: `integer[][]` is the same type as
 * `integer[]`, with the dimensions as metadata on the value. So `E` is never
 * itself an array type; `array()` enforces it.
 */
export class ArrayType<E extends DataType = DataType> extends DataType {
	declare readonly $kind: 'array';
	declare readonly $native: E['$native'][];
	declare readonly $operators: ArrayOperators<this['$value']>;

	/**
	 * The type of the elements.
	 */
	readonly element: E;

	/**
	 * Creates a new array type.
	 *
	 * @param element the type of the elements.
	 */
	constructor(element: E) {
		super();
		this.element = element;
	}

	/**
	 * Encodes a value as a SQL array.
	 *
	 * @param value the value to encode.
	 * @returns the encoded value.
	 */
	override encode(value: unknown) {
		return Array.isArray(value)
			? value.map((item: unknown) => this.element.encode(item))
			: value;
	}

	/**
	 * Encodes an operand as a SQL array. For `= any` and `<> all` the operand
	 * is a single element, so it's encoded by the element type instead.
	 *
	 * @param operator the operator to encode.
	 * @param value the value to encode.
	 * @returns the encoded value.
	 */
	override encodeOperand(operator: string, value: unknown) {
		switch (operator) {
			case '= any':
				return this.element.encodeOperand('=', value);
			case '<> all':
				return this.element.encodeOperand('<>', value);
			default:
				return this.encode(value);
		}
	}
}
