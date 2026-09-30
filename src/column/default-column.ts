import type { DataType } from '../data-type/data-type.js';
import { BaseColumn } from './base-column.js';

/**
 * A column with a database default. It may still be made nullable; it can't
 * also be generated.
 */
export class DefaultColumn<D extends DataType, S, I, U>
	//
	extends BaseColumn<D, S, I, U>
{
	/**
	 * Marks the column as nullable on select, insert, and update.
	 *
	 * @example text().default().nullable()
	 */
	nullable() {
		return new DefaultColumn<D, S | null, I | null, U | null>({
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

	override as<X, Y, Z>() {
		return new DefaultColumn<D, X, Y, Z>({
			dataType: this.dataType,
			name: this.name,
		});
	}
}
