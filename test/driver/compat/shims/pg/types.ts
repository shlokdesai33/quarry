// pg-types bridged into quarry's parser tables. The instance comes from the
// node-postgres checkout when the compatibility runner sets
// QUARRY_COMPAT_PG_TYPES, so tests that change parsers globally
// (`types.setTypeParser`) reach the shim too; otherwise from quarry's own pg.
import { createRequire } from 'node:module';
import type { TypeParsers } from '../../../../../src/driver/index.js';

type Parser = (value: string) => unknown;

export interface PgTypes {
	getTypeParser(oid: number, format?: string): Parser;
	setTypeParser(oid: number, format: string | Parser, parser?: Parser): void;
	builtins: Record<string, number>;
	arrayParser: unknown;
}

const require = createRequire(import.meta.url);
const from = process.env['QUARRY_COMPAT_PG_TYPES'];
export const pgTypes: PgTypes = from
	? require(from)
	: createRequire(require.resolve('pg'))('pg-types');

/** Something with pg's `getTypeParser(oid, format)`. */
export interface TypeSource {
	getTypeParser(oid: number, format?: string): Parser;
}

/** pg's per-client overrides, falling back to another source (pg-types by default). */
export class TypeOverrides implements TypeSource {
	readonly #types: TypeSource;
	text: Record<number, Parser> = {};
	binary: Record<number, Parser> = {};

	constructor(types?: TypeSource) {
		this.#types = types ?? pgTypes;
	}

	setTypeParser(oid: number, format: string | Parser, parser?: Parser): void {
		if (typeof format === 'function') {
			this.text[oid] = format;
			return;
		}
		if (parser === undefined) return;
		(format === 'binary' ? this.binary : this.text)[oid] = parser;
	}

	getTypeParser(oid: number, format = 'text'): Parser {
		return (
			(format === 'binary' ? this.binary : this.text)[oid] ??
			this.#types.getTypeParser(oid, format)
		);
	}
}

const tables = new WeakMap<TypeSource, TypeParsers>();

/**
 * A quarry parser table that asks `source` for every OID, so parsers set
 * after the table was made still apply (as in pg). A parser that throws
 * fails the query, as in pg.
 */
export function parsersFor(source: TypeSource): TypeParsers {
	let table = tables.get(source);
	if (table === undefined) {
		table = new Proxy(
			{},
			{
				get: (_target, key) => {
					if (typeof key !== 'string') return undefined;
					const oid = Number(key);
					if (!Number.isInteger(oid)) return undefined;
					return (text: string) => source.getTypeParser(oid, 'text')(text);
				},
				has: () => true,
			},
		) as TypeParsers;
		tables.set(source, table);
	}
	return table;
}
