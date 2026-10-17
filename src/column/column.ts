import type { DataType } from '../data-type/data-type.js';
import type { Codec } from '../driver/codec.js';
import { BaseColumn, type SwapType } from './base-column.js';
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
	 * Marks the column as nullable on select, insert, and update. Use `typed()` for
	 * asymmetric nullability cases.
	 *
	 * @example text().nullable()
	 * @example text().nullable().typed<string | null, string | null, string>()
	 */
	nullable() {
		return new Column<D, S | null, I | null, U | null>({
			...this._quarry,
			nullable: true,
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
			...this._quarry,
			fill: 'default',
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
			...this._quarry,
			fill: 'generated',
		});
	}

	override name(columnName: string) {
		return new Column<D, S, I, U>({ ...this._quarry, columnName });
	}

	override typed<X extends S, Y extends I, Z extends U>() {
		return new Column<D, X, Y, Z>(this._quarry);
	}

	override useCodec<In, Out>(codec: Codec<In, Out>) {
		return new Column<D, SwapType<S, Out>, SwapType<I, In>, SwapType<U, In>>({
			...this._quarry,
			dataType: this._quarry.dataType.withCodec(codec),
		});
	}
}
