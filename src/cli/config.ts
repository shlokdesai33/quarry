import { resolveCallSite } from '../call-site.js';
import type { Database } from '../database.js';
import type { AnyTable } from '../table.js';

/**
 * What `quarry.config.ts` exports, as its default export or as named
 * exports: the database to check, and the tables of the schema.
 *
 * @example
 * // quarry.config.ts
 * import * as schema from './src/schema.ts';
 * export default defineConfig({ db: database(executor), schema, close: () => pool.end() });
 */
export interface QuarryConfig {
	readonly db: Pick<Database, 'verify'>;
	/**
	 * Every table: a list, or an object such as a schema module's namespace,
	 * whose values that aren't tables are ignored.
	 */
	readonly schema: readonly AnyTable[] | Readonly<Record<string, unknown>>;
	/** Called when the command is done, e.g. to end the driver's pool. */
	readonly close?: (() => unknown) | undefined;
}

/** Types a `quarry.config.ts`. */
export function defineConfig(config: QuarryConfig): QuarryConfig {
	return config;
}

/** Whether `value` is a table, without relying on `instanceof`, which a second copy of quarry breaks. */
function isTable(value: unknown): value is AnyTable {
	if (typeof value !== 'object' || value === null) return false;
	const internals: unknown = Reflect.get(value, '_quarry');
	const schema: unknown = Reflect.get(value, 'schema');
	return (
		typeof internals === 'object' &&
		internals !== null &&
		typeof Reflect.get(internals, 'source') === 'string' &&
		typeof schema === 'object' &&
		schema !== null &&
		typeof Reflect.get(schema, 'columns') === 'object'
	);
}

/**
 * The tables of a config's `schema`. An object's tables are put in the order
 * they were defined in, since a module namespace lists its exports sorted.
 */
export function schemaTables(schema: QuarryConfig['schema']): AnyTable[] {
	if (Array.isArray(schema)) return schema.filter(isTable);
	const tables = Object.values(schema).filter(isTable);
	const order = new Map(
		tables.map((table) => [table, resolveCallSite(table._quarry.site)]),
	);
	return tables.toSorted((a, b) => {
		const x = order.get(a);
		const y = order.get(b);
		if (x === undefined || y === undefined) return 0;
		return x.file === y.file
			? x.line - y.line || x.column - y.column
			: x.file < y.file
				? -1
				: 1;
	});
}

/** Reads a config module's exports, or explains what is wrong with them. */
export function parseConfig(exports: unknown): QuarryConfig | string {
	if (typeof exports !== 'object' || exports === null) {
		return 'the config module has no exports';
	}
	const fallback: unknown = Reflect.get(exports, 'default');
	const config: unknown =
		typeof fallback === 'object' && fallback !== null ? fallback : exports;
	if (typeof config !== 'object' || config === null) {
		return 'the config must export { db, schema }';
	}
	const db: unknown = Reflect.get(config, 'db');
	const schema: unknown = Reflect.get(config, 'schema');
	const close: unknown = Reflect.get(config, 'close');
	if (
		typeof db !== 'object' ||
		db === null ||
		typeof Reflect.get(db, 'verify') !== 'function'
	) {
		return 'the config must export `db`, a quarry database (database(executor))';
	}
	if (typeof schema !== 'object' || schema === null) {
		return 'the config must export `schema`, the tables to check';
	}
	return {
		db: {
			verify: (tables, options) =>
				Reflect.apply(Reflect.get(db, 'verify'), db, [tables, options]),
		},
		schema: Array.isArray(schema)
			? schema
			: Object.fromEntries(Object.entries(schema)),
		close:
			typeof close === 'function'
				? () => Reflect.apply(close, config, [])
				: undefined,
	};
}
