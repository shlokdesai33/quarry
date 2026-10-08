import { DataType } from './data-type.js';

/**
 * A postgres enum type, declared once with `defineEnum` and shared by every
 * column that uses it. `N` is its name: each enum is its own SQL type, which
 * postgres compares with no other.
 */
export class EnumType<N extends string = string> extends DataType<'enum'> {
	/**
	 * The name of the postgres enum type, as declared in `create type ... as
	 * enum (...)`.
	 *
	 * @example 'user_status'
	 */
	readonly enumName: N;

	/**
	 * The members of the enum, in declaration order.
	 *
	 * @example ['active', 'inactive']
	 */
	readonly values: readonly string[];

	constructor(enumName: N, values: readonly string[]) {
		super('enum');
		this.enumName = enumName;
		this.values = values;
	}
}
