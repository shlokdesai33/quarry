import { ArrayType } from '../data-type/array.js';
import type { DataType } from '../data-type/data-type.js';
import { ArrayColumn } from './array-column.js';
import { BaseColumn } from './base-column.js';
import { DefaultColumn } from './default-column.js';
import { GeneratedColumn } from './generated-column.js';
import { NullableColumn } from './nullable-column.js';

/**
 * A column as its factory returns it: no modifier applied yet, so it can
 * still become the element of an array.
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
		return new NullableColumn<D, S | null, I | null, U | null>({
			dataType: this.dataType,
			name: this.name,
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
			name: this.name,
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
			name: this.name,
		});
	}

	/**
	 * Makes the column an array of its type: `text().array()` is a `text[]`
	 * column whose value is `string[]`. The name carries over, elements are
	 * encoded by the element type, and modifiers after `array()` apply to the
	 * array column.
	 *
	 * Elements are never typed as null, so `array()` isn't offered after
	 * `nullable()`. Postgres doesn't enforce this: any array may hold nulls,
	 * which a check like `array_position(col, null) is null` rules out.
	 *
	 * Only one dimension is modelled, so the result has no `array()` of its
	 * own. Postgres treats `integer[][]` as the same type as `integer[]`, with
	 * a rectangularity rule TypeScript cannot express, and operators like
	 * `= any` compare against the base element rather than a row.
	 *
	 * @example tags: text().array()
	 * @example labels: text().array().nullable()
	 */
	array() {
		return new ArrayColumn<ArrayType<D>, S[]>({
			dataType: new ArrayType(this.dataType),
			name: this.name,
		});
	}

	override as<X, Y, Z>() {
		return new Column<D, X, Y, Z>({
			dataType: this.dataType,
			name: this.name,
		});
	}
}
