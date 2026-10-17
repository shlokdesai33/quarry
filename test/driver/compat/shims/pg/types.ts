// pg-types bridged into quarry's codec registry. The instance comes from the
// node-postgres checkout when the compatibility runner sets
// QUARRY_COMPAT_PG_TYPES, so tests that change parsers globally
// (`types.setTypeParser`) reach the shim too; otherwise from quarry's own pg.
import { createRequire } from 'node:module';
import {
	CodecRegistry,
	type Codec,
	type TypeCatalog,
} from '../../../../../src/driver/index.js';

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

/**
 * A registry asking `source` for each type's parser as a value is read, so
 * parsers set after a query was made still apply (as in pg). A parser that
 * throws fails the query, as in pg. Every column is read as text.
 */
class PgTypesRegistry extends CodecRegistry {
	readonly #source: TypeSource;
	readonly #codecs = new Map<number, Codec>();

	constructor(source: TypeSource) {
		super([]);
		this.#source = source;
	}

	override codecFor(oid: number, _catalog: TypeCatalog): Codec {
		let codec = this.#codecs.get(oid);
		if (codec === undefined) {
			const source = this.#source;
			codec = {
				name: '',
				oid,
				paramFormat: 'text',
				resultFormat: 'text',
				encode: String,
				decodeText: (text) => source.getTypeParser(oid, 'text')(text),
			};
			this.#codecs.set(oid, codec);
		}
		return codec;
	}
}

const registries = new WeakMap<TypeSource, CodecRegistry>();

/** The registry reading values with `source`'s parsers. */
export function codecsFor(source: TypeSource): CodecRegistry {
	let registry = registries.get(source);
	if (registry === undefined) {
		registry = new PgTypesRegistry(source);
		registries.set(source, registry);
	}
	return registry;
}
