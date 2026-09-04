import type { Schema } from './types.js';
import { Table } from './table.js';

/**
 * TODO
 */
export function defineTable<N extends string, S extends Schema>(
	name: N,
	schema: S,
) {
	return new Table(name, schema);
}
