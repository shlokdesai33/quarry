import type { CompiledQuery } from './compile.js';

/**
 * Runs compiled queries: the bridge to a driver. `rows` are the result rows
 * as the driver returns them, already parsed into JavaScript values.
 *
 * @example
 * const executor: Executor = {
 *   execute: async ({ sql, params }) => ({ rows: (await pool.query(sql, params)).rows }),
 * };
 */
export interface Executor {
	execute(query: CompiledQuery): Promise<{ readonly rows: readonly unknown[] }>;
}

/** The query returned no row where `one` expects exactly one. */
export class NoRowError extends Error {
	/** The query that returned no row. */
	readonly query: CompiledQuery;

	constructor(query: CompiledQuery) {
		super('The query returned no row, where exactly one was expected');
		this.name = 'NoRowError';
		this.query = query;
	}
}

/**
 * The query returned several rows where `one` or `maybeOne` expects at most
 * one.
 */
export class TooManyRowsError extends Error {
	/** The query that returned several rows. */
	readonly query: CompiledQuery;

	constructor(query: CompiledQuery) {
		super('The query returned several rows, where at most one was expected');
		this.name = 'TooManyRowsError';
		this.query = query;
	}
}
