import type { IdentityType } from '../data-type/numeric.js';
import { IdentityColumn } from './identity-column.js';
import { Column } from './column.js';

/**
 * A column of one of the integer types, the only ones that can be
 * identities, as its factory returns it.
 */
export class IntegerColumn<D extends IdentityType, S, I = S, U = I>
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
			dataType: this.dataType,
			name: this.name,
		});
	}

	override as<X, Y, Z>() {
		return new IntegerColumn<D, X, Y, Z>({
			dataType: this.dataType,
			name: this.name,
		});
	}
}
