import type { ArrayType } from '../data-type/array.js';
import { BaseColumn } from './base-column.js';
import { DefaultColumn } from './default-column.js';
import { GeneratedColumn } from './generated-column.js';

/**
 * An array column as `array()` returns it, or made nullable. It has the
 * modifiers of a fresh column but no `array()` of its own: only one
 * dimension is modelled.
 */
export class ArrayColumn<D extends ArrayType, S, I = S, U = I>
	//
	extends BaseColumn<D, S, I, U>
{
	/**
	 * Marks the array column as nullable on select, insert, and update. Its
	 * elements stay non-null.
	 *
	 * @example text().array().nullable()
	 */
	nullable() {
		return new ArrayColumn<D, S | null, I | null, U | null>({
			dataType: this.dataType,
			name: this.name,
		});
	}

	/**
	 * Marks the column as having a database default, so it may be omitted on
	 * insert.
	 *
	 * @example text().array().default()
	 */
	default() {
		return new DefaultColumn<D, S, I | undefined, U>({
			dataType: this.dataType,
			name: this.name,
		});
	}

	/**
	 * Declares the column `generated always as (...)`: the value is computed by
	 * postgres and can never be written by the application.
	 *
	 * @example text().array().generated()
	 */
	generated() {
		return new GeneratedColumn<D, S, never, never>({
			dataType: this.dataType,
			name: this.name,
		});
	}

	override as<X, Y, Z>() {
		return new ArrayColumn<D, X, Y, Z>({
			dataType: this.dataType,
			name: this.name,
		});
	}
}
