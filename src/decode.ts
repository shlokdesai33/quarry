import {
	arrayOids,
	catalogTypes,
	oids,
	parseArray,
	parseBool,
	parseBytea,
	parseFloat,
	parseInteger,
	parseJson,
	parseRange,
	parseTimestamptz,
	rawTypes,
	type CatalogType,
	type TextParser,
	type TypeParsers,
} from './driver/index.js';

const identity: TextParser = (text) => text;
const dateRange: TextParser = (text) => parseRange(text, identity);
const timeRange: TextParser = (text) => parseRange(text, parseTimestamptz);
const array =
	(parse?: TextParser, delimiter?: string): TextParser =>
	(text) =>
		parseArray(text, parse, delimiter);

/**
 * Parsers matching the TypeScript types quarry's columns declare: int8 and
 * numeric as strings, timestamptz as a Date, date/time/timestamp/interval
 * as strings, ranges as `Range` objects, jsonb parsed, bytea as bytes, and
 * arrays of each. Extension types (pgvector) and other arrays (enums) are
 * added from the catalog.
 */
export const quarryTypes: TypeParsers = Object.freeze({
	[oids.bool]: parseBool,
	[oids.int2]: parseInteger,
	[oids.int4]: parseInteger,
	[oids.oid]: parseInteger,
	[oids.float4]: parseFloat,
	[oids.float8]: parseFloat,
	[oids.json]: parseJson,
	[oids.jsonb]: parseJson,
	[oids.bytea]: parseBytea,
	[oids.timestamptz]: parseTimestamptz,
	[oids.daterange]: dateRange,
	[oids.tstzrange]: timeRange,
	[arrayOids.bool]: array(parseBool),
	[arrayOids.int2]: array(parseInteger),
	[arrayOids.int4]: array(parseInteger),
	[arrayOids.oid]: array(parseInteger),
	[arrayOids.int8]: array(),
	[arrayOids.float4]: array(parseFloat),
	[arrayOids.float8]: array(parseFloat),
	[arrayOids.json]: array(parseJson),
	[arrayOids.jsonb]: array(parseJson),
	[arrayOids.bytea]: array(parseBytea),
	[arrayOids.timestamptz]: array(parseTimestamptz),
	[arrayOids.daterange]: array(dateRange),
	[arrayOids.tstzrange]: array(timeRange),
	[arrayOids.box]: array(undefined, ';'),
});

/**
 * Types whose values stay the server's text, for your own codecs: `true`
 * for every type, or type names or OIDs (their array types stay raw too).
 */
export type RawTypes =
	| boolean
	| readonly (keyof typeof oids | 'vector' | 'halfvec' | number)[];

const knownOids: Readonly<Record<string, number>> = oids;
const knownArrayOids: Readonly<Record<string, number>> = arrayOids;

/** Removes the `raw` types (and their arrays) from `parsers`. */
export function withoutRaw(
	parsers: TypeParsers,
	raw: RawTypes | undefined,
	catalog: readonly CatalogType[] = [],
): TypeParsers {
	if (raw === true) return rawTypes;
	if (!raw || raw.length === 0) return parsers;
	const out: Record<number, TypeParsers[number]> = { ...parsers };
	for (const type of raw) {
		const oid = typeof type === 'number' ? type : knownOids[type];
		const named =
			typeof type === 'string'
				? catalog.find((t) => t.name === type && t.elem === 0)?.oid
				: undefined;
		for (const base of [oid, named]) {
			if (base === undefined) continue;
			delete out[base];
			for (const t of catalog) if (t.elem === base) delete out[t.oid];
		}
		const arrayOid =
			typeof type === 'string' ? knownArrayOids[type] : undefined;
		if (arrayOid !== undefined) delete out[arrayOid];
	}
	return Object.freeze(out);
}

/** The parsers to start with, before the catalog lookup. */
export function initialTypes(
	types: TypeParsers | undefined,
	raw: RawTypes | undefined,
): TypeParsers {
	return withoutRaw(types ?? quarryTypes, raw);
}

/** The parsers completed from the catalog. */
export function completedTypes(
	types: TypeParsers | undefined,
	raw: RawTypes | undefined,
	catalog: readonly CatalogType[],
): TypeParsers {
	return withoutRaw(catalogTypes(types ?? quarryTypes, catalog), raw, catalog);
}
