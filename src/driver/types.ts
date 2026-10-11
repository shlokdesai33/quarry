import { DriverError } from './errors.js';
import type { WireValue } from './protocol/frontend.js';

/** Turns one value's text output into a JavaScript value. */
export type TextParser = (text: string) => unknown;

/** Text parsers keyed by type OID. A type without one is returned as a string. */
export type TypeParsers = Readonly<Record<number, TextParser>>;

/** OIDs of the built-in types the driver knows. */
export const oids = {
	bool: 16,
	bytea: 17,
	char: 18,
	name: 19,
	int8: 20,
	int2: 21,
	int4: 23,
	text: 25,
	oid: 26,
	json: 114,
	xml: 142,
	point: 600,
	float4: 700,
	float8: 701,
	unknown: 705,
	money: 790,
	inet: 869,
	cidr: 650,
	macaddr: 829,
	bpchar: 1042,
	varchar: 1043,
	date: 1082,
	time: 1083,
	timestamp: 1114,
	timestamptz: 1184,
	interval: 1186,
	timetz: 1266,
	bit: 1560,
	varbit: 1562,
	numeric: 1700,
	uuid: 2950,
	jsonb: 3802,
	int4range: 3904,
	numrange: 3906,
	tsrange: 3908,
	tstzrange: 3910,
	daterange: 3912,
	int8range: 3926,
} as const;

/** OIDs of the built-in array types, by element type. */
export const arrayOids = {
	bool: 1000,
	bytea: 1001,
	char: 1002,
	name: 1003,
	int2: 1005,
	int4: 1007,
	text: 1009,
	bpchar: 1014,
	varchar: 1015,
	int8: 1016,
	point: 1017,
	box: 1020,
	float4: 1021,
	float8: 1022,
	oid: 1028,
	inet: 1041,
	cidr: 651,
	json: 199,
	jsonb: 3807,
	date: 1182,
	time: 1183,
	timestamp: 1115,
	timestamptz: 1185,
	interval: 1187,
	timetz: 1270,
	numeric: 1231,
	uuid: 2951,
	daterange: 3913,
	tstzrange: 3911,
} as const;

const HEX = new Int8Array(128).fill(-1);
for (let i = 0; i < 16; i++) {
	HEX['0123456789abcdef'.charCodeAt(i)] = i;
	HEX['0123456789ABCDEF'.charCodeAt(i)] = i;
}

/** Parses bytea text output, in `hex` (`\x…`) or `escape` format. */
export function parseBytea(text: string): Uint8Array {
	if (text.startsWith('\\x')) {
		const out = new Uint8Array((text.length - 2) >> 1);
		for (let i = 0; i < out.length; i++) {
			const hi = HEX[text.charCodeAt(2 + i * 2)] ?? -1;
			const lo = HEX[text.charCodeAt(3 + i * 2)] ?? -1;
			if (hi < 0 || lo < 0) throw new DriverError('Invalid bytea hex output');
			out[i] = (hi << 4) | lo;
		}
		return out;
	}
	const bytes: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code !== 0x5c) {
			bytes.push(code);
		} else if (text[i + 1] === '\\') {
			bytes.push(0x5c);
			i++;
		} else {
			bytes.push(Number.parseInt(text.slice(i + 1, i + 4), 8));
			i += 3;
		}
	}
	return new Uint8Array(bytes);
}

/**
 * Parses array text output (`{1,2,NULL}`, `{{"a b",c},{d,e}}`,
 * `[0:1]={x,y}`) into nested arrays, each element through `parse`. NULL
 * elements are `null`. `box` arrays use `;` as the delimiter.
 */
export function parseArray(
	text: string,
	parse: TextParser = (s) => s,
	delimiter = ',',
): unknown[] {
	let i = 0;
	if (text.startsWith('[')) {
		i = text.indexOf('=') + 1;
		if (i === 0) throw new DriverError('Invalid array output');
	}
	const fail = (): never => {
		throw new DriverError(`Invalid array output (${text.length} characters)`);
	};
	const level = (): unknown[] => {
		if (text[i] !== '{') fail();
		i++;
		const out: unknown[] = [];
		if (text[i] === '}') {
			i++;
			return out;
		}
		for (;;) {
			const ch = text[i];
			if (ch === '{') {
				out.push(level());
			} else if (ch === '"') {
				i++;
				let value = '';
				let start = i;
				for (;;) {
					const c = text[i];
					if (c === undefined) fail();
					if (c === '"') break;
					if (c === '\\') {
						value += text.slice(start, i);
						i++;
						start = i;
					}
					i++;
				}
				value += text.slice(start, i);
				i++;
				out.push(parse(value));
			} else {
				const start = i;
				while (i < text.length && text[i] !== delimiter && text[i] !== '}') i++;
				const token = text.slice(start, i);
				out.push(token === 'NULL' ? null : parse(token));
			}
			const next = text[i];
			i++;
			if (next === delimiter) continue;
			if (next === '}') return out;
			fail();
		}
	};
	const result = level();
	if (i !== text.length) fail();
	return result;
}

const array =
	(parse?: TextParser, delimiter?: string): TextParser =>
	(text) =>
		parseArray(text, parse, delimiter);

/** Built-in text parsers. Shared, so a binary decoder can be matched to the parser it stands in for. */
export const parseBool: TextParser = (text) => text === 't';
export const parseInteger: TextParser = (text) => Number.parseInt(text, 10);
export const parseFloat: TextParser = (text) => Number(text);
export const parseBigInt: TextParser = (text) => BigInt(text);
export const parseJson: TextParser = (text) => JSON.parse(text);
const bool = parseBool;
const int = parseInteger;
const float = parseFloat;
const bigint = parseBigInt;
const json = parseJson;

/**
 * The default parsers: lossless conversions only. int2, int4, oid and
 * floats become numbers, int8 a bigint, bool a boolean, json and jsonb are
 * parsed, bytea becomes a `Uint8Array`, and arrays of those (and of text-like
 * types) become arrays. numeric, dates, times and everything else stay as
 * the server's text, so no precision or time zone is lost.
 */
export const defaultTypes: TypeParsers = Object.freeze({
	[oids.bool]: bool,
	[oids.int2]: int,
	[oids.int4]: int,
	[oids.oid]: int,
	[oids.int8]: bigint,
	[oids.float4]: float,
	[oids.float8]: float,
	[oids.json]: json,
	[oids.jsonb]: json,
	[oids.bytea]: parseBytea,
	[arrayOids.bool]: array(bool),
	[arrayOids.int2]: array(int),
	[arrayOids.int4]: array(int),
	[arrayOids.oid]: array(int),
	[arrayOids.int8]: array(bigint),
	[arrayOids.float4]: array(float),
	[arrayOids.float8]: array(float),
	[arrayOids.json]: array(json),
	[arrayOids.jsonb]: array(json),
	[arrayOids.bytea]: array(parseBytea),
	[arrayOids.text]: array(),
	[arrayOids.varchar]: array(),
	[arrayOids.bpchar]: array(),
	[arrayOids.char]: array(),
	[arrayOids.name]: array(),
	[arrayOids.uuid]: array(),
	[arrayOids.numeric]: array(),
	[arrayOids.date]: array(),
	[arrayOids.time]: array(),
	[arrayOids.timetz]: array(),
	[arrayOids.timestamp]: array(),
	[arrayOids.timestamptz]: array(),
	[arrayOids.interval]: array(),
	[arrayOids.inet]: array(),
	[arrayOids.cidr]: array(),
	[arrayOids.point]: array(),
	[arrayOids.box]: array(undefined, ';'),
	[arrayOids.daterange]: array(),
	[arrayOids.tstzrange]: array(),
});

/** No parsers: every value is returned as the server's text, for codecs to decode. */
export const rawTypes: TypeParsers = Object.freeze({});

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * A `timestamptz` input string for a Date, in UTC: `YYYY-MM-DD HH:MM:SS.mmm+00`,
 * with ` BC` for years before 1. `toISOString` can't be used: Postgres
 * rejects its expanded years.
 */
export function formatTimestamp(date: Date): string {
	const time = date.getTime();
	if (Number.isNaN(time)) throw new DriverError('Invalid Date');
	let year = date.getUTCFullYear();
	const bc = year <= 0;
	if (bc) year = 1 - year;
	return (
		`${pad(year, 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
		`${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.` +
		`${pad(date.getUTCMilliseconds(), 3)}+00${bc ? ' BC' : ''}`
	);
}

const hexDigits = (bytes: Uint8Array): string => {
	let out = '\\x';
	for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
	return out;
};

/** The text of one value, for an array element or a text parameter. */
function textOf(value: unknown): string {
	switch (typeof value) {
		case 'string':
			return value;
		case 'number':
		case 'bigint':
			return String(value);
		case 'boolean':
			return value ? 't' : 'f';
		case 'object':
			if (value instanceof Date) return formatTimestamp(value);
			if (ArrayBuffer.isView(value)) {
				return hexDigits(
					new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
				);
			}
			return JSON.stringify(value);
		default:
			throw new DriverError(`Cannot send a ${typeof value} as a parameter`);
	}
}

/**
 * A Postgres array literal: `{…}`, every element double-quoted with `\` and
 * `"` escaped, NULL bare, nested arrays as nested braces.
 */
export function arrayLiteral(values: readonly unknown[]): string {
	let out = '{';
	for (let i = 0; i < values.length; i++) {
		if (i > 0) out += ',';
		const value = values[i];
		if (value === null || value === undefined) out += 'NULL';
		else if (Array.isArray(value)) out += arrayLiteral(value);
		else
			out += `"${textOf(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
	}
	return `${out}}`;
}

/**
 * Encodes a JavaScript value as a parameter. Strings pass through
 * unchanged, which is how quarry sends values it has already encoded.
 * Byte arrays are sent in binary; numbers, bigints, booleans, Dates, arrays
 * (as array literals) and other objects (as JSON) are sent as text.
 */
export function encodeParam(value: unknown): WireValue {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') return value;
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	if (Array.isArray(value)) return arrayLiteral(value);
	return textOf(value);
}

const COPY_SPECIAL = /[\\\t\n\r]/;
const COPY_SPECIAL_ALL = /[\\\t\n\r]/g;
const COPY_ESCAPES: Readonly<Record<string, string>> = {
	'\\': '\\\\',
	'\t': '\\t',
	'\n': '\\n',
	'\r': '\\r',
};

/**
 * One row in COPY text format: values as their Postgres text (like
 * `encodeParam`, byte arrays as `\x…` hex), tab-separated, `\N` for NULL,
 * with backslash, tab, newline and carriage return escaped.
 */
export function copyLine(values: readonly unknown[]): string {
	let line = '';
	for (let i = 0; i < values.length; i++) {
		if (i > 0) line += '\t';
		const value = values[i];
		if (value === null || value === undefined) {
			line += '\\N';
			continue;
		}
		const text = Array.isArray(value) ? arrayLiteral(value) : textOf(value);
		line += COPY_SPECIAL.test(text)
			? text.replace(COPY_SPECIAL_ALL, (ch) => COPY_ESCAPES[ch] ?? ch)
			: text;
	}
	return `${line}\n`;
}

/** Batches rows into COPY text chunks of about `size` characters. */
export async function* copyChunks(
	rows: AsyncIterable<readonly unknown[]> | Iterable<readonly unknown[]>,
	size = 65536,
): AsyncGenerator<string, void, undefined> {
	let chunk = '';
	for await (const row of rows) {
		chunk += copyLine(row);
		if (chunk.length >= size) {
			yield chunk;
			chunk = '';
		}
	}
	if (chunk !== '') yield chunk;
}
