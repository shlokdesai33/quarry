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
	override name(columnName: string) {
		return new IdentityColumn<D, S, I, U>({
			dataType: this.dataType,
			columnName,
		});
	}

	/**
	 * Narrows the TypeScript view of the column when selected (branded ids,
	 * literal unions). Only the select type is given: an identity is never
	 * written, so its insert and update types stay `never`.
	 *
	 * @example integer().identity().as<UserId>()
	 */
	override as<X extends S>() {
		return new IdentityColumn<D, X, I, U>({
			dataType: this.dataType,
			columnName: this.columnName,
		});
	}
}
