import * as bin from './binary.js';
import {
	arrayOf,
	markArrayValued,
	markTextLike,
	passThrough,
	readArraysInBinary,
	sendArraysInBinary,
	type Codec,
} from './codec.js';
import { DriverError } from './errors.js';
import type { JsonValue } from './binary.js';
import {
	parseRange,
	parseTimestamptz,
	vectorValues,
	type RangeValue,
} from './parsers.js';
import { formatTimestamp, numberText, parseBytea, textOf } from './types.js';

export type { JsonValue } from './binary.js';

const toInteger = (digits: string): number => Number.parseInt(digits, 10);
const toFloat = (output: string): number => Number(output);
const toJson = (output: string): JsonValue => {
	const value: JsonValue = JSON.parse(output);
	return value;
};

const cannotSend = (value: unknown, type: string): DriverError =>
	new DriverError(`Cannot send a ${typeof value} as ${type}`);

/** Numbers, bigints and strings (as they are), for the numeric types. */
const numeric =
	(type: string) =>
	(value: unknown): string => {
		if (typeof value === 'number') return numberText(value);
		if (typeof value === 'bigint' || typeof value === 'string')
			return String(value);
		throw cannotSend(value, type);
	};

/** Strings as they are; anything else as its text, as an untyped parameter would be. */
const asText = (value: unknown): string =>
	typeof value === 'string' ? value : textOf(value);

const json = (value: unknown): string => {
	const text = JSON.stringify(value);
	if (text === undefined) throw cannotSend(value, 'json');
	return text;
};

function bytes(value: unknown): string | Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value))
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (typeof value === 'string') return value;
	throw cannotSend(value, 'bytea');
}

function timestamp(value: unknown): string {
	if (value instanceof Date) return formatTimestamp(value);
	if (typeof value === 'string') return value;
	throw cannotSend(value, 'timestamptz');
}

function quote(text: string): string {
	return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** A range literal, e.g. `["2024-01-01","2024-02-01")` or `empty`, each bound through `bound`. */
function rangeText<T>(
	range: RangeValue<T> | string,
	bound: (value: T) => string,
): string {
	if (typeof range === 'string') return range;
	if (typeof range !== 'object' || range === null || !('empty' in range))
		throw cannotSend(range, 'a range');
	if (range.empty) return 'empty';
	const lower = range.lower === null ? '' : quote(bound(range.lower));
	const upper = range.upper === null ? '' : quote(bound(range.upper));
	return `${range.bounds[0]}${lower},${upper}${range.bounds[1]}`;
}

interface Builtin<In, Out> {
	readonly name: string;
	readonly oid: number;
	readonly arrayOid: number;
	readonly paramFormat?: 'binary';
	readonly resultFormat?: 'binary';
	readonly inferParamType?: true;
	encode(value: In): string | Uint8Array;
	decodeText(text: string): Out;
	decodeBinary?(bytes: Uint8Array, start: number, end: number): Out;
}

function builtin<In, Out>(spec: Builtin<In, Out>): Codec<In, Out> {
	return Object.freeze({
		paramFormat: 'text',
		resultFormat: 'text',
		...spec,
	});
}

/** A type read as the server's text and sent as a string (anything else as its text). */
function textType(name: string, oid: number, arrayOid: number): Codec<string> {
	return builtin<string, string>({
		name,
		oid,
		arrayOid,
		encode: asText,
		decodeText: passThrough,
	});
}

/** A character type: text both ways, its type inferred by the server. */
function characterType(
	name: string,
	oid: number,
	arrayOid: number,
): Codec<string> {
	const codec = builtin<string, string>({
		name,
		oid,
		arrayOid,
		inferParamType: true,
		encode: asText,
		decodeText: passThrough,
		decodeBinary: bin.text,
	});
	markTextLike(codec);
	readArraysInBinary(codec);
	return codec;
}

const textCodec = characterType('text', 25, 1009);
const varchar = characterType('varchar', 1043, 1015);
const bpchar = characterType('bpchar', 1042, 1014);
const name = characterType('name', 19, 1003);
const char = characterType('char', 18, 1002);

const bool = builtin<boolean, boolean>({
	name: 'bool',
	oid: 16,
	arrayOid: 1000,
	resultFormat: 'binary',
	encode: (value) =>
		typeof value === 'boolean' ? (value ? 't' : 'f') : asText(value),
	decodeText: (text) => text === 't',
	decodeBinary: bin.bool,
});

const int2 = builtin<number, number>({
	name: 'int2',
	oid: 21,
	arrayOid: 1005,
	resultFormat: 'binary',
	encode: numeric('int2'),
	decodeText: toInteger,
	decodeBinary: bin.int2,
});

const int4 = builtin<number, number>({
	name: 'int4',
	oid: 23,
	arrayOid: 1007,
	resultFormat: 'binary',
	encode: numeric('int4'),
	decodeText: toInteger,
	decodeBinary: bin.int4,
});

const oid = builtin<number, number>({
	name: 'oid',
	oid: 26,
	arrayOid: 1028,
	resultFormat: 'binary',
	encode: numeric('oid'),
	decodeText: toInteger,
	decodeBinary: bin.uint4,
});

const int8 = builtin<bigint | number | string, bigint>({
	name: 'int8',
	oid: 20,
	arrayOid: 1016,
	resultFormat: 'binary',
	encode: numeric('int8'),
	decodeText: (text) => BigInt(text),
	decodeBinary: bin.int8BigInt,
});

const int8AsString = builtin<string | bigint | number, string>({
	name: 'int8',
	oid: 20,
	arrayOid: 1016,
	encode: numeric('int8'),
	decodeText: passThrough,
	decodeBinary: bin.int8String,
});

const float4 = builtin<number, number>({
	name: 'float4',
	oid: 700,
	arrayOid: 1021,
	encode: numeric('float4'),
	decodeText: toFloat,
	decodeBinary: bin.float4,
});

const float8 = builtin<number, number>({
	name: 'float8',
	oid: 701,
	arrayOid: 1022,
	resultFormat: 'binary',
	encode: numeric('float8'),
	decodeText: toFloat,
	decodeBinary: bin.float8,
});

const numericCodec = builtin<string | number | bigint, string>({
	name: 'numeric',
	oid: 1700,
	arrayOid: 1231,
	encode: numeric('numeric'),
	decodeText: passThrough,
	decodeBinary: bin.numeric,
});

const uuid = builtin<string, string>({
	name: 'uuid',
	oid: 2950,
	arrayOid: 2951,
	encode: asText,
	decodeText: passThrough,
	decodeBinary: bin.uuid,
});

const bytea = builtin<Uint8Array, Uint8Array>({
	name: 'bytea',
	oid: 17,
	arrayOid: 1001,
	paramFormat: 'binary',
	resultFormat: 'binary',
	encode: bytes,
	decodeText: parseBytea,
	decodeBinary: bin.bytea,
});

const jsonCodec = builtin<unknown, JsonValue>({
	name: 'json',
	oid: 114,
	arrayOid: 199,
	encode: json,
	decodeText: toJson,
	decodeBinary: bin.json,
});

const jsonb = builtin<unknown, JsonValue>({
	name: 'jsonb',
	oid: 3802,
	arrayOid: 3807,
	encode: json,
	decodeText: toJson,
	decodeBinary: bin.jsonb,
});

const timestamptz = builtin<Date, Date>({
	name: 'timestamptz',
	oid: 1184,
	arrayOid: 1185,
	resultFormat: 'binary',
	encode: timestamp,
	decodeText: parseTimestamptz,
	decodeBinary: bin.timestamptz,
});

const daterange = builtin<RangeValue<string>, RangeValue<string>>({
	name: 'daterange',
	oid: 3912,
	arrayOid: 3913,
	encode: (range) => rangeText(range, String),
	decodeText: (text) => parseRange(text, passThrough),
});

const tstzrange = builtin<RangeValue<Date>, RangeValue<Date>>({
	name: 'tstzrange',
	oid: 3910,
	arrayOid: 3911,
	encode: (range) => rangeText(range, timestamp),
	decodeText: (text) => parseRange(text, parseTimestamptz),
});

const vectorText = (value: unknown): string => {
	if (typeof value === 'string') return value;
	if (!Array.isArray(value)) throw cannotSend(value, 'a vector');
	return JSON.stringify(value);
};

const vector = Object.freeze<Codec<readonly number[], number[]>>({
	name: 'vector',
	oid: 0,
	paramFormat: 'text',
	resultFormat: 'binary',
	encode: vectorText,
	decodeText: vectorValues,
	decodeBinary: bin.vector,
});

const halfvec = Object.freeze<Codec<readonly number[], number[]>>({
	name: 'halfvec',
	oid: 0,
	paramFormat: 'text',
	resultFormat: 'text',
	encode: vectorText,
	decodeText: (output) => {
		const values: number[] = JSON.parse(output);
		return values;
	},
});

const raw = Object.freeze<Codec<string, string>>({
	name: '',
	oid: 0,
	paramFormat: 'text',
	resultFormat: 'text',
	inferParamType: true,
	encode: asText,
	decodeText: passThrough,
});

for (const codec of [
	int2,
	int4,
	int8,
	int8AsString,
	float8,
	bool,
	timestamptz,
	uuid,
	jsonb,
	bytea,
])
	sendArraysInBinary(codec);
for (const codec of [jsonCodec, jsonb]) readArraysInBinary(codec);
for (const codec of [jsonCodec, jsonb, vector, halfvec]) markArrayValued(codec);

/**
 * The built-in codecs, by type. Results are read in binary where that
 * builds the JavaScript value faster (numbers, booleans, bytes, Dates, and
 * arrays of those) and as text where the value is a string anyway.
 * Parameters are text, except bytea and arrays of fixed-size types.
 *
 * Some types have more than one: `int8` reads a `bigint`, `int8AsString`
 * the digits; `timestamptz` reads a `Date`, `timestamptzAsString` the
 * server's text.
 */
export const codecs = Object.freeze({
	bool,
	int2,
	int4,
	oid,
	int8,
	int8AsString,
	float4,
	float8,
	numeric: numericCodec,
	text: textCodec,
	varchar,
	bpchar,
	name,
	char,
	uuid,
	bytea,
	json: jsonCodec,
	jsonb,
	timestamptz,
	timestamptzAsString: textType('timestamptz', 1184, 1185),
	date: textType('date', 1082, 1182),
	time: textType('time', 1083, 1183),
	timetz: textType('timetz', 1266, 1270),
	timestamp: textType('timestamp', 1114, 1115),
	interval: textType('interval', 1186, 1187),
	inet: textType('inet', 869, 1041),
	cidr: textType('cidr', 650, 651),
	macaddr: textType('macaddr', 829, 1040),
	money: textType('money', 790, 791),
	xml: textType('xml', 142, 143),
	bit: textType('bit', 1560, 1561),
	varbit: textType('varbit', 1562, 1563),
	point: textType('point', 600, 1017),
	box: textType('box', 603, 1020),
	tsvector: textType('tsvector', 3614, 3643),
	tsquery: textType('tsquery', 3615, 3645),
	jsonpath: textType('jsonpath', 4072, 4073),
	daterange,
	daterangeAsString: textType('daterange', 3912, 3913),
	tstzrange,
	tstzrangeAsString: textType('tstzrange', 3910, 3911),
	/** pgvector's `vector`, as the float32 values stored (`0.1` reads as `0.10000000149011612`); read in binary. */
	vector,
	/** pgvector's `halfvec`, as the decimals printed. */
	halfvec,
	/** Any type, as the server's text both ways: the type of the column or parameter it is used for is inferred. */
	raw,
});

/**
 * The codecs the driver decodes with by default: lossless conversions
 * only. int2, int4, oid and floats become numbers, int8 a bigint, bool a
 * boolean, json and jsonb are parsed, bytea becomes a `Uint8Array`, and
 * arrays of those (and of the text types) become arrays. numeric, dates,
 * times and everything else stay as the server's text.
 */
export const defaultCodecs: readonly Codec[] = Object.freeze([
	bool,
	int2,
	int4,
	oid,
	int8,
	float4,
	float8,
	jsonCodec,
	jsonb,
	bytea,
	...[
		textCodec,
		varchar,
		bpchar,
		char,
		name,
		codecs.uuid,
		codecs.numeric,
		codecs.date,
		codecs.time,
		codecs.timetz,
		codecs.timestamp,
		codecs.timestamptzAsString,
		codecs.interval,
		codecs.inet,
		codecs.cidr,
		codecs.point,
		codecs.daterangeAsString,
		codecs.tstzrangeAsString,
	].map((element) => arrayOf<unknown, unknown>(element)),
	arrayOf<unknown, unknown>(codecs.box, ';'),
]);
