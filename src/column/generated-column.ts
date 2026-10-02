import type { DataType } from '../data-type/data-type.js';
import { BaseColumn } from './base-column.js';

/**
 * A generated column. It may still be made nullable, which only affects
 * select: it is never written. It can't also have a default.
 */
export class GeneratedColumn<D extends DataType, S, I, U>
	//
	extends BaseColumn<D, S, I, U>
{
	/**
	 * Marks the column as nullable on select. It stays unwritable.
	 *
	 * @example text().generated().nullable()
	 */
	nullable() {
		return new GeneratedColumn<D, S | null, I, U>({
			dataType: this.dataType,
			columnName: this.columnName,
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
			columnName: this.columnName,
		});
	}

	override name(columnName: string) {
		return new GeneratedColumn<D, S, I, U>({
			dataType: this.dataType,
			columnName,
		});
	}

	/**
	 * Narrows the TypeScript view of the column when selected (branded values,
	 * literal unions). Only the select type is given: a generated column is
	 * never written, so its insert and update types stay `never`.
	 *
	 * @example text().generated().as<'active' | 'inactive'>()
	 */
	override as<X extends S>() {
		return new GeneratedColumn<D, X, I, U>({
			dataType: this.dataType,
			columnName: this.columnName,
		});
	}
}
