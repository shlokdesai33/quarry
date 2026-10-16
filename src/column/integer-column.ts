import type { DataType } from '../data-type/data-type.js';
import type { Codec } from '../driver/codec.js';
import type { SwapType } from './base-column.js';
import { IdentityColumn } from './identity-column.js';
import { Column } from './column.js';

/**
 * A column of one of the integer types, the only ones that can be
 * identities, as its factory returns it.
 */
export class IntegerColumn<D extends DataType, S, I = S, U = I>
	//
	extends Column<D, S, I, U>
{
	/**
	 * Declares the column `generated always as identity`: the value comes from
	 * an implicit sequence and can never be written by the application. An
	 * identity is never null and has no default, so no other modifier applies
	 * before or after it.
	 *
	 * @example integer().identity()
	 * @example integer<UserId>().identity()
	 */
	identity() {
		return new IdentityColumn<D, S, never, never>({
			...this._quarry,
			fill: 'identity',
		});
	}

	override name(columnName: string) {
		return new IntegerColumn<D, S, I, U>({ ...this._quarry, columnName });
	}

	override typed<X extends S, Y extends I, Z extends U>() {
		return new IntegerColumn<D, X, Y, Z>(this._quarry);
	}

	override useCodec<In, Out>(codec: Codec<In, Out>) {
		return new IntegerColumn<
			D,
			SwapType<S, Out>,
			SwapType<I, In>,
			SwapType<U, In>
		>({
			...this._quarry,
			dataType: this._quarry.dataType.withCodec(codec),
		});
	}
}
