import type { Range } from '../range.js';
import { DriverError } from './errors.js';
import {
	arrayOids,
	oids,
	parseArray,
	parseBytea,
	type TextParser,
	type TypeParsers,
} from './types.js';

const TIMESTAMPTZ =
	/^(\d{4,})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(\.\d+)?([+-])(\d\d)(?::?(\d\d))?(?::?(\d\d))?( BC)?$/;

/** The largest and smallest Dates, standing in for `infinity` and `-infinity`. */
const MAX_DATE = 8.64e15;

/**
 * Parses `timestamptz` output (DateStyle ISO) into a Date, keeping
 * milliseconds. `infinity` and `-infinity` become the largest and smallest
 * representable Dates.
 */
export function parseTimestamptz(text: string): Date {
	if (text === 'infinity') return new Date(MAX_DATE);
	if (text === '-infinity') return new Date(-MAX_DATE);
	const m = TIMESTAMPTZ.exec(text);
	if (m === null) throw new DriverError(`Invalid timestamptz output: ${text}`);
	let year = Number(m[1]);
	if (m[12] !== undefined) year = 1 - year;
	const ms = m[7] === undefined ? 0 : Math.floor(Number(m[7]) * 1000);
	const offset =
		(m[8] === '-' ? -1 : 1) *
		(Number(m[9]) * 3600 + Number(m[10] ?? 0) * 60 + Number(m[11] ?? 0));
	const date = new Date(0);
	date.setUTCFullYear(year, Number(m[2]) - 1, Number(m[3]));
	date.setUTCHours(Number(m[4]), Number(m[5]), Number(m[6]), ms);
	return new Date(date.getTime() - offset * 1000);
}

/**
 * Parses range output (`[2024-01-01,2024-02-01)`, `(,"a b"]`, `empty`) into
 * quarry's `Range`, each bound through `parse`.
 */
export function parseRange<T>(
	text: string,
	parse: (bound: string) => T,
): Range<T> {
	if (text === 'empty') return { empty: true };
	const open = text[0];
	const close = text[text.length - 1];
	if ((open !== '[' && open !== '(') || (close !== ']' && close !== ')')) {
		throw new DriverError(`Invalid range output: ${text}`);
	}
	const bounds: (string | null)[] = [];
	let i = 1;
	const end = text.length - 1;
	for (let n = 0; n < 2; n++) {
		if (text[i] === '"') {
			let value = '';
			i++;
			while (i < end) {
				const ch = text[i];
				if (ch === '\\') {
					value += text[i + 1] ?? '';
					i += 2;
				} else if (ch === '"') {
					if (text[i + 1] === '"') {
						value += '"';
						i += 2;
					} else {
						i++;
						break;
					}
				} else {
					value += ch;
					i++;
				}
			}
			bounds.push(value);
		} else {
			const stop = n === 0 ? text.indexOf(',', i) : end;
			if (stop < 0) throw new DriverError(`Invalid range output: ${text}`);
			const token = text.slice(i, stop);
			bounds.push(token === '' ? null : token);
			i = stop;
		}
		if (n === 0) {
			if (text[i] !== ',')
				throw new DriverError(`Invalid range output: ${text}`);
			i++;
		}
	}
	const [lower, upper] = bounds;
	return {
		empty: false,
		lower: lower === null || lower === undefined ? null : parse(lower),
		upper: upper === null || upper === undefined ? null : parse(upper),
		bounds: `${open}${close}`,
	};
}

/** pgvector's `vector` and `halfvec` output, `[1,2.5,3]`. */
export const parseVector: TextParser = (text) => JSON.parse(text);

const identity: TextParser = (text) => text;
const int: TextParser = (text) => Number.parseInt(text, 10);
const float: TextParser = (text) => Number(text);
const bool: TextParser = (text) => text === 't';
const json: TextParser = (text) => JSON.parse(text);
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
 * arrays of each. Extension types and other arrays are added from the
 * catalog by `catalogTypes`.
 */
export const quarryTypes: TypeParsers = Object.freeze({
	[oids.bool]: bool,
	[oids.int2]: int,
	[oids.int4]: int,
	[oids.oid]: int,
	[oids.float4]: float,
	[oids.float8]: float,
	[oids.json]: json,
	[oids.jsonb]: json,
	[oids.bytea]: parseBytea,
	[oids.timestamptz]: parseTimestamptz,
	[oids.daterange]: dateRange,
	[oids.tstzrange]: timeRange,
	[arrayOids.bool]: array(bool),
	[arrayOids.int2]: array(int),
	[arrayOids.int4]: array(int),
	[arrayOids.oid]: array(int),
	[arrayOids.int8]: array(),
	[arrayOids.float4]: array(float),
	[arrayOids.float8]: array(float),
	[arrayOids.json]: array(json),
	[arrayOids.jsonb]: array(json),
	[arrayOids.bytea]: array(parseBytea),
	[arrayOids.timestamptz]: array(parseTimestamptz),
	[arrayOids.daterange]: array(dateRange),
	[arrayOids.tstzrange]: array(timeRange),
	[arrayOids.box]: array(undefined, ';'),
});

/** One row of the catalog query. */
export interface CatalogType {
	readonly oid: number;
	readonly name: string;
	/** For arrays, the element type's OID; 0 otherwise. */
	readonly elem: number;
	readonly delim: string;
}

/** Arrays of every type, plus pgvector's types, by OID. */
export const catalogQuery = `select t.oid::int as oid, t.typname as name, t.typelem::int as elem, t.typdelim as delim
from pg_type t
where t.typname in ('vector', 'halfvec') or t.typinput = 'array_in'::regproc`;

/** Adds parsers for extension types and arrays from the catalog, keeping every parser `base` already has. */
export function catalogTypes(
	base: TypeParsers,
	catalog: readonly CatalogType[],
): TypeParsers {
	const parsers: Record<number, TextParser> = {};
	for (const type of catalog) {
		if (type.elem === 0 && (type.name === 'vector' || type.name === 'halfvec'))
			parsers[type.oid] = parseVector;
	}
	for (const type of catalog) {
		if (type.elem === 0 || base[type.oid] !== undefined) continue;
		parsers[type.oid] = array(
			base[type.elem] ?? parsers[type.elem],
			type.delim,
		);
	}
	return Object.freeze({ ...parsers, ...base });
}
