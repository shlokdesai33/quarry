import type { DataType } from '../data-type/data-type.js';

/**
 * Constraint for "some column". Only for use in `extends` positions: lookups
 * must go through the concrete column type, never through this alias.
 *
 * It lists only the properties the library reads, so that every column class
 * fits without their methods being compared (which fails for the generic
 * `as()`). The value types are `unknown`, not `any`: a factory called where
 * some column is expected (`columns: { a: text() }`) infers its value type
 * from this, and `unknown`, unlike `any`, fails the factory's constraint,
 * which is then used instead.
 */
export interface AnyColumn {
	readonly $select: unknown;
	readonly $insert: unknown;
	readonly $update: unknown;
	readonly dataType: DataType;
	readonly name: string | undefined;
}
