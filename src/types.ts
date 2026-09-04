import type { AnyColumn } from './column.js';
import type { AnyTable } from './table.js';

/**
 * The schema of a table.
 */
export type Schema = {
	columns: Record<string, AnyColumn>;
};

/**
 * Collapses an intersection into a single object type for readable hovers.
 */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Forces `T` to be resolved at this boundary. When a row type is used inside
 * other generic types, the compiler then works with the resolved object rather
 * than re-expanding the deferred mapped types on every use.
 */
type DrainOuterGeneric<T> = [T] extends [unknown] ? T : never;

/**
 * The columns of a table.
 */
type Columns<T extends AnyTable> = T['schema']['columns'];

/**
 * Object type returned by selecting every column of the table.
 */
export type InferSelectType<T extends AnyTable> = DrainOuterGeneric<{
	[K in keyof Columns<T>]: Columns<T>[K]['$select'];
}>;

/**
 * The row accepted by an insert into the table. Read-only columns (`never`)
 * are excluded, columns with a database default (`undefined`) are optional,
 * the rest required.
 */
export type InferInsertType<T extends AnyTable> = DrainOuterGeneric<
	Prettify<
		{
			[
				K in keyof Columns<T> as [Columns<T>[K]['$insert']] extends [never]
					? never
					: undefined extends Columns<T>[K]['$insert']
						? never
						: K
			]: Columns<T>[K]['$insert'];
		} & {
			[
				K in keyof Columns<T> as undefined extends Columns<T>[K]['$insert']
					? K
					: never
			]?: Exclude<Columns<T>[K]['$insert'], undefined>;
		}
	>
>;

/**
 * The row accepted by an update of the table: every column optional, read-only
 * columns excluded.
 */
export type InferUpdateType<T extends AnyTable> = DrainOuterGeneric<{
	[
		K in keyof Columns<T> as [Columns<T>[K]['$update']] extends [never]
			? never
			: K
	]?: Columns<T>[K]['$update'];
}>;
