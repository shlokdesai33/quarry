import type { DataType } from '../data-type/data-type.js';
import { BaseColumn } from './base-column.js';
import { DefaultColumn } from './default-column.js';
import { GeneratedColumn } from './generated-column.js';

/**
 * A column as the factories and `array()` return it, or made nullable. Unless
 * it is itself an array, it can be the element of an `array()`.
 */
export class Column<D extends DataType, S, I = S, U = I>
	//
	extends BaseColumn<D, S, I, U>
{
	/**
	 * Marks the column as nullable on select, insert, and update. Use `as()` for
	 * asymmetric nullability cases.
	 *
	 * @example text().nullable()
	 * @example text().nullable().as<string | null, string | null, string>()
	 */
	nullable() {
		return new Column<D, S | null, I | null, U | null>({
			dataType: this.dataType,
			columnName: this.columnName,
		});
	}

	/**
	 * Marks the column as having a database default, so it may be omitted on
	 * insert.
	 *
	 * @example text().default()
	 */
	default() {
		return new DefaultColumn<D, S, I | undefined, U>({
			dataType: this.dataType,
			columnName: this.columnName,
		});
	}

	/**
	 * Declares the column `generated always as (...)`: the value is computed by
	 * postgres and can never be written by the application.
	 *
	 * @example text().generated()
	 */
	generated() {
		return new GeneratedColumn<D, S, never, never>({
			dataType: this.dataType,
			columnName: this.columnName,
		});
	}

	override name(columnName: string) {
		return new Column<D, S, I, U>({
			dataType: this.dataType,
			columnName,
		});
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new Column<D, X, Y, Z>({
			dataType: this.dataType,
			columnName: this.columnName,
		});
	}
}
