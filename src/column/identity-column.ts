import type { DataType } from '../data-type/data-type.js';
import { BaseColumn } from './base-column.js';

/**
 * A `generated always as identity` column. No other modifier applies to it;
 * only `as()` remains.
 */
export class IdentityColumn<D extends DataType, S, I, U>
	//
	extends BaseColumn<D, S, I, U>
{
	/**
	 * Sets the TypeScript view of the column when selected (branded ids,
	 * literal unions). Only the select type is given: an identity is never
	 * written, so its insert and update types stay `never`.
	 *
	 * @example integer().identity().as<UserId>()
	 */
	override as<X>() {
		return new IdentityColumn<D, X, I, U>({
			dataType: this.dataType,
			name: this.name,
		});
	}
}
