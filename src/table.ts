import type { Schema } from './types.js';

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

	constructor(name: N, schema: S) {
		this.name = name;
		this.schema = schema;
	}

	as<const A extends string>(alias: A) {
		return new Table(alias, this.schema);
	}
}

export type AnyTable = Table<string, Schema>;
