import type { DataType } from '../data-type/data-type.js';
import { BaseColumn } from './base-column.js';
import { DefaultColumn } from './default-column.js';
import { GeneratedColumn } from './generated-column.js';

/**
 * A column made nullable before any other modifier. It can still get a
 * default or be generated, but not become an array: array elements are never
 * typed as null, so nullability after `array()` applies to the array column.
 */
export class NullableColumn<D extends DataType, S, I = S, U = I>
	//
	extends BaseColumn<D, S, I, U>
{
	/**
	 * Marks the column as nullable on select, insert, and update.
	 *
	 * @example text().nullable()
	 */
	nullable() {
		return new NullableColumn<D, S | null, I | null, U | null>({
			dataType: this.dataType,
			name: this.name,
		});
	}

	/**
	 * Marks the column as having a database default, so it may be omitted on
	 * insert.
	 *
	 * @example text().nullable().default()
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
	 * @example text().nullable().generated()
	 */
	generated() {
		return new GeneratedColumn<D, S, never, never>({
			dataType: this.dataType,
			name: this.name,
		});
	}

	override as<X, Y, Z>() {
		return new NullableColumn<D, X, Y, Z>({
			dataType: this.dataType,
			name: this.name,
		});
	}
}
