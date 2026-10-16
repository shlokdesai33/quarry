import { arrayOf } from '../driver/codec.js';
import { DataType } from './data-type.js';

/**
 * An array of `E`, e.g. `text[]`. Its codec is `arrayOf` the element's, so
 * an array of ranges or of jsonb is sent as the element literals postgres
 * expects, and read back element by element.
 *
 * Postgres has no arrays of arrays: `integer[][]` is the same type as
 * `integer[]`, with the dimensions as metadata on the value. So `E` is never
 * itself an array type; `array()` enforces it.
 */
export class ArrayType<E extends DataType> extends DataType<'array'> {
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
		super('array', { codec: arrayOf(element.codec) });
		this.element = element;
	}
}
