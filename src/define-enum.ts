import { Column } from './column/column.js';
import { EnumType } from './data-type/enum.js';

/**
 * Declares a postgres enum type once so it can back columns in any number of
 * tables. Returns a column factory like the other data types.
 *
 * @example
 * const status = defineEnum('status', ['active', 'suspended', 'deleted']);
 *
 * // a column that can hold any of the members
 * defineTable('users', {
 *   columns: { status: status().default() },
 * });
 *
 * // a column that only ever holds a subset of the members
 * defineTable('archived_users', {
 *   columns: { status: status<'suspended' | 'deleted'>() },
 * });
 */
export function defineEnum<const N extends string, const T extends string>(
	enumName: N,
	values: readonly T[],
) {
	return function $defineEnum<X extends T>() {
		return new Column<EnumType<N>, X>({
			dataType: new EnumType(enumName, values),
		});
	};
}
