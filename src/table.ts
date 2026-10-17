import type { AnyColumn } from './column/any-column.js';
import type { TableNode } from './node.js';
import type { Schema } from './types.js';
import type { CallSite } from './call-site.js';

export class Table<N extends string, S extends Schema> {
	readonly name: N;
	readonly schema: S;

	/**
	 * The table's columns keyed `name.column`. Never set.
	 *
	 * The keys are a union rather than an `as` clause, for type-checking
	 * speed: `keyof` of a mapped type with `as` re-instantiates the key of
	 * every column each time, and every reference lookup takes the `keyof` of
	 * the scope. A union of keys is computed once per table.
	 */
	declare readonly $refs: {
		[
			K in `${N}.${keyof S['columns'] & string}`
		]: S['columns'][K extends `${N}.${infer C}` ? C : never];
	};

	/**
	 * What the library reads: not part of the API. `source` is the table's
	 * name in the database, which `name` differs from for an alias; `site`
	 * where `defineTable` was called, for `db.verify`.
	 */
	readonly _quarry: {
		readonly source: string;
		readonly site: CallSite | undefined;
	};

	constructor(name: N, schema: S, source: string = name, site?: CallSite) {
		this.name = name;
		this.schema = schema;
		this._quarry = { source, site };
	}

	as<const A extends string>(alias: A) {
		return new Table(
			alias,
			this.schema,
			this._quarry.source,
			this._quarry.site,
		);
	}
}

export type AnyTable = Table<string, Schema>;

/**
 * A column as the outer side of a join reads it: null in the rows the join
 * found no match for. Only its selected type changes; its SQL type, and so
 * its comparisons and codec, stay the column's.
 */
export interface NullableColumn<C extends AnyColumn> {
	readonly $select: C['$select'] | null;
	readonly $insert: C['$insert'];
	readonly $update: C['$update'];
	readonly _quarry: C['_quarry'];
}

/**
 * The table `X` on the outer side of a join (the joined table of a `left
 * join`, the earlier ones of a `right join`, both of a `full join`): every
 * column nullable. Only a type: the table itself is the same.
 */
export type NullableTable<X extends AnyTable> =
	X extends Table<infer N, infer S>
		? Table<
				N,
				{
					columns: {
						[K in keyof S['columns']]: NullableColumn<S['columns'][K]>;
					};
				}
			>
		: never;

/** The tables `T`, each a `NullableTable`. */
export type NullableTables<T extends readonly AnyTable[]> = {
	[I in keyof T]: NullableTable<T[I]>;
};

/** A table as `from`, `join` and the write queries render it. */
export function tableNode(table: AnyTable): TableNode {
	const node = {
		name: table._quarry.source,
		alias: table.name === table._quarry.source ? undefined : table.name,
	};
	const sensitive = Object.entries(table.schema.columns)
		.filter(([, column]) => column._quarry.sensitive)
		.map(([key, column]) => column._quarry.columnName ?? key);
	return sensitive.length === 0 ? node : { ...node, sensitive };
}
