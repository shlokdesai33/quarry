import type { Schema } from './types.js';

export class Table<N extends string, S extends Schema> {
	readonly name: N;
	readonly schema: S;

	declare readonly $refs: {
		[K in keyof S['columns'] as `${N}.${K & string}`]: S['columns'][K];
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
