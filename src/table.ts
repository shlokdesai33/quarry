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

/** A table as `from`, `join` and the write queries render it. */
export function tableNode(table: AnyTable): TableNode {
	return {
		name: table._quarry.source,
		alias: table.name === table._quarry.source ? undefined : table.name,
	};
}
