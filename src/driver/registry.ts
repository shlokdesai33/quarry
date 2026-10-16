import { arrayOf, passThrough, type Codec } from './codec.js';
import { codecs, defaultCodecs } from './codecs.js';
import { parseTimestamptz, parseVector } from './parsers.js';
import {
	arrayParserInfo,
	parseBigInt,
	parseBool,
	parseBytea,
	parseFloat,
	parseInteger,
	parseJson,
	type TextParser,
	type TypeParsers,
} from './types.js';

/** One type from the catalog query. */
export interface CatalogType {
	readonly oid: number;
	readonly name: string;
	readonly schema: string;
	/** For an array type, the element type's OID; 0 otherwise. */
	readonly elem: number;
	/** The type's array type; 0 if it has none. */
	readonly array: number;
	/** For a domain, the type it is based on; 0 otherwise. */
	readonly base: number;
	readonly delim: string;
	/** Whether the session's `search_path` finds it by its unqualified name. */
	readonly visible: boolean;
}

/**
 * The types quarry and the driver can't know in advance: extensions',
 * enums, domains, other user types and their arrays (built-in types all
 * have OIDs below 16384). Composite types (one per table) are left out.
 */
export const catalogQuery = `select t.oid, t.typname::text as name, n.nspname::text as schema, t.typelem as elem, t.typarray as array, t.typbasetype as base, t.typdelim::text as delim, pg_type_is_visible(t.oid) as visible
from pg_type t join pg_namespace n on n.oid = t.typnamespace
where t.oid >= 16384 and t.typtype <> 'c'
and not exists (select from pg_type e where e.oid = t.typelem and e.typtype = 'c')`;

/** A type name as the catalog spells it: unquoted names fold to lower case. */
function normalizeName(name: string): string {
	return name
		.split('.')
		.map((part) =>
			part.startsWith('"') && part.endsWith('"')
				? part.slice(1, -1).replaceAll('""', '"')
				: part.toLowerCase(),
		)
		.join('.');
}

/**
 * The OIDs of types looked up by name (codecs whose `oid` is 0): loaded
 * from `pg_type` once per pool, the first time a query needs one, or when
 * `loadTypes()` asks. Until then, and for names it doesn't find, such a
 * parameter's type is inferred and its results read as text.
 */
export class TypeCatalog {
	/** Bumped whenever the catalog changes, so lookups cached against it start over. */
	generation = 0;
	#loaded = false;
	#loading: Promise<void> | undefined;
	#byOid = new Map<number, CatalogType>();
	#byName = new Map<string, CatalogType>();
	#oids = new WeakMap<Codec, number>();

	get loaded(): boolean {
		return this.#loaded;
	}

	/** Loads the catalog once, through `run`; a failure leaves it to be tried again. */
	load(run: () => Promise<readonly CatalogType[]>): Promise<void> {
		if (this.#loaded) return Promise.resolve();
		this.#loading ??= run().then(
			(rows) => {
				this.setTypes(rows);
				this.#loading = undefined;
				return undefined;
			},
			() => {
				this.#loading = undefined;
				return undefined;
			},
		);
		return this.#loading;
	}

	/** Whether a load is running. */
	get loading(): boolean {
		return this.#loading !== undefined;
	}

	/** Replaces what the catalog holds. */
	setTypes(rows: readonly CatalogType[]): void {
		this.#byOid = new Map();
		this.#byName = new Map();
		for (const row of rows) {
			this.#byOid.set(row.oid, row);
			this.#byName.set(`${row.schema}.${row.name}`, row);
			if (row.visible) this.#byName.set(row.name, row);
		}
		this.#oids = new WeakMap();
		this.#loaded = true;
		this.generation++;
	}

	/** The type with this OID, if the catalog has it. */
	type(oid: number): CatalogType | undefined {
		return this.#byOid.get(oid);
	}

	/** The type a name finds, if the catalog has it. */
	named(name: string): CatalogType | undefined {
		return this.#byName.get(normalizeName(name));
	}

	/** The OID of the type `codec` is for; 0 when it is looked up by name and isn't known (yet). */
	oidOf(codec: Codec): number {
		if (codec.oid !== 0) return codec.oid;
		let oid = this.#oids.get(codec);
		if (oid !== undefined) return oid;
		oid = 0;
		const element = codec.element;
		if (element !== undefined) {
			const elementOid = this.oidOf(element);
			oid =
				element.arrayOid ??
				(elementOid === 0 ? 0 : (this.#byOid.get(elementOid)?.array ?? 0));
		} else if (codec.name !== '') {
			oid = this.named(codec.name)?.oid ?? 0;
		}
		if (this.#loaded) this.#oids.set(codec, oid);
		return oid;
	}

	/**
	 * The OID a result column of `codec`'s type reports: a domain's base
	 * type, as RowDescription has it. 0 when unknown.
	 */
	resultOidOf(codec: Codec): number {
		let oid = this.oidOf(codec);
		for (let depth = 0; oid !== 0 && depth < 8; depth++) {
			const base = this.#byOid.get(oid)?.base ?? 0;
			if (base === 0) break;
			oid = base;
		}
		return oid;
	}

	/** Whether `codec` is for a type looked up by name that isn't resolved yet. */
	unresolved(codec: Codec): boolean {
		if (codec.oid !== 0 || this.#loaded) return false;
		return codec.element === undefined
			? codec.name !== ''
			: this.unresolved(codec.element);
	}
}

/** The codec for array elements of a type nothing decodes: kept as text. */
const unknownElement = Object.freeze<Codec<string, string>>({
	name: '',
	oid: 0,
	paramFormat: 'text',
	resultFormat: 'text',
	encode: (value) => value,
	decodeText: passThrough,
});

/**
 * Codecs by the type OID they decode: how a result column is read when the
 * query didn't choose a codec for it (or chose one for another type). Built
 * from codec objects: fixed OIDs directly, types looked up by name through
 * the pool's catalog. A codec with a fixed `arrayOid` brings its array
 * codec, unless the same list has one.
 */
export class CodecRegistry {
	readonly #byOid: Map<number, Codec>;
	readonly #named: Map<string, Codec>;
	readonly #legacy: TypeParsers | undefined;
	readonly #memo = new WeakMap<
		TypeCatalog,
		{ generation: number; codecs: Map<number, Codec | null> }
	>();

	constructor(
		list: readonly Codec[],
		base?: CodecRegistry,
		legacy?: TypeParsers,
	) {
		this.#byOid = new Map(base === undefined ? [] : base.#byOid);
		this.#named = new Map(base === undefined ? [] : base.#named);
		this.#legacy = legacy ?? (base === undefined ? undefined : base.#legacy);
		const explicit = new Set<number>();
		for (const codec of list) if (codec.oid !== 0) explicit.add(codec.oid);
		for (const codec of list) {
			if (codec.oid !== 0) this.#byOid.set(codec.oid, codec);
			else if (codec.name !== '')
				this.#named.set(normalizeName(codec.name), codec);
			if (
				codec.element === undefined &&
				codec.arrayOid !== undefined &&
				!explicit.has(codec.arrayOid)
			)
				this.#byOid.set(codec.arrayOid, arrayOf(codec));
		}
	}

	/** Whether some codec is for a type looked up by name, so decoding needs the catalog. */
	get needsCatalog(): boolean {
		return this.#named.size > 0;
	}

	/** The codec for result columns of type `oid`, if any; without one a value is the server's text. */
	codecFor(oid: number, catalog: TypeCatalog): Codec | undefined {
		let memo = this.#memo.get(catalog);
		if (memo === undefined || memo.generation !== catalog.generation) {
			memo = { generation: catalog.generation, codecs: new Map() };
			this.#memo.set(catalog, memo);
		}
		const known = memo.codecs.get(oid);
		if (known !== undefined) return known ?? undefined;
		const codec = this.#find(oid, catalog) ?? null;
		memo.codecs.set(oid, codec);
		return codec ?? undefined;
	}

	#find(oid: number, catalog: TypeCatalog): Codec | undefined {
		const fixed = this.#byOid.get(oid);
		if (fixed !== undefined) return fixed;
		if (this.#legacy !== undefined) {
			const parser = this.#legacy[oid];
			return parser === undefined ? undefined : parserCodec(oid, parser);
		}
		const type = catalog.type(oid);
		if (type === undefined) return undefined;
		if (type.elem !== 0) {
			const element = this.codecFor(type.elem, catalog);
			return element?.element === undefined
				? arrayOf(element ?? unknownElement, type.delim)
				: undefined;
		}
		return (
			this.#named.get(`${type.schema}.${type.name}`) ??
			(type.visible ? this.#named.get(type.name) : undefined)
		);
	}
}

/**
 * A registry of `list` over `base` (the driver's default codecs): later
 * codecs override earlier ones for the same type.
 *
 * @example const registry = createCodecRegistry([codecs.int8AsString, codecs.timestamptz]);
 */
export function createCodecRegistry(
	list: readonly Codec[],
	base: CodecRegistry = defaultRegistry,
): CodecRegistry {
	return new CodecRegistry(list, base);
}

/** The registry of `defaultCodecs`. */
export const defaultRegistry = new CodecRegistry(defaultCodecs);

const legacyRegistries = new WeakMap<TypeParsers, CodecRegistry>();

/** A registry reading a table of text parsers by OID (the `types` option). */
export function parsersRegistry(types: TypeParsers): CodecRegistry {
	let registry = legacyRegistries.get(types);
	if (registry === undefined) {
		registry = new CodecRegistry([], undefined, types);
		legacyRegistries.set(types, registry);
	}
	return registry;
}

/** The built-in codec a driver parser stands for at `oid`, so it can be read in binary. */
function builtinFor(oid: number, parser: TextParser): Codec | undefined {
	switch (parser) {
		case parseBool:
			return oid === 16 ? codecs.bool : undefined;
		case parseInteger:
			return oid === 21
				? codecs.int2
				: oid === 23
					? codecs.int4
					: oid === 26
						? codecs.oid
						: undefined;
		case parseFloat:
			return oid === 701
				? codecs.float8
				: oid === 700
					? codecs.float4
					: undefined;
		case parseBigInt:
			return oid === 20 ? codecs.int8 : undefined;
		case parseBytea:
			return oid === 17 ? codecs.bytea : undefined;
		case parseTimestamptz:
			return oid === 1184 ? codecs.timestamptz : undefined;
		case parseJson:
			return oid === 3802
				? codecs.jsonb
				: oid === 114
					? codecs.json
					: undefined;
		case parseVector:
			return codecs.vector;
		default:
			return undefined;
	}
}

const parserCodecs = new WeakMap<TextParser, Map<number, Codec>>();

/** The codec reading `oid` with a text parser; the driver's own parsers keep their binary formats. */
function parserCodec(oid: number, parser: TextParser): Codec {
	let byOid = parserCodecs.get(parser);
	if (byOid === undefined) {
		byOid = new Map();
		parserCodecs.set(parser, byOid);
	}
	let codec = byOid.get(oid);
	if (codec !== undefined) return codec;
	codec = builtinFor(oid, parser);
	const array = arrayParserInfo(parser);
	if (codec === undefined && array !== undefined) {
		const elementOid = array.elementOid ?? arrayElements.get(oid);
		const element =
			array.element === undefined
				? textElement(elementOid)
				: elementOid === undefined
					? undefined
					: parserCodec(elementOid, array.element);
		if (
			element !== undefined &&
			element.element === undefined &&
			element.oid === (elementOid ?? 0)
		)
			codec = arrayOf(element, array.delimiter);
	}
	codec ??= Object.freeze<Codec>({
		name: '',
		oid,
		paramFormat: 'text',
		resultFormat: 'text',
		encode: (value) => String(value),
		decodeText: parser,
	});
	byOid.set(oid, codec);
	return codec;
}

/** The element types of the built-in array types. */
const arrayElements = new Map<number, number>(
	Object.values(codecs).flatMap((codec) =>
		codec.arrayOid === undefined ? [] : [[codec.arrayOid, codec.oid]],
	),
);

const textElements = new Map<number, Codec>(
	Object.values(codecs).flatMap((codec) =>
		codec.oid !== 0 && codec.decodeText === passThrough && codec.name !== ''
			? [[codec.oid, codec]]
			: [],
	),
);

/** An element kept as text: its built-in codec when it has one, so text-like arrays still read in binary. */
function textElement(oid: number | undefined): Codec | undefined {
	if (oid === undefined) return undefined;
	return textElements.get(oid) ?? { ...unknownElement, oid };
}
