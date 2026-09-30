import type { EqualityOperators } from '../operators.js';
import { DataType } from './data-type.js';

/**
 * A postgres enum type, declared once with `defineEnum` and shared by every
 * column that uses it.
 */
export class EnumType extends DataType {
	declare readonly $kind: 'enum';
	declare readonly $native: string;
	declare readonly $operators: EqualityOperators<this['$value']>;

	/**
	 * The name of the postgres enum type, as declared in `create type ... as
	 * enum (...)`.
	 *
	 * @example 'user_status'
	 */
	readonly enumName: string;

	/**
	 * The members of the enum, in declaration order.
	 *
	 * @example ['active', 'inactive']
	 */
	readonly values: readonly string[];

	constructor(enumName: string, values: readonly string[]) {
		super();
		this.enumName = enumName;
		this.values = values;
	}
}
