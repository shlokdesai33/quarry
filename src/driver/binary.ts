import { DriverError } from './errors.js';
import type { Field } from './protocol/messages.js';
import { utf8 } from './protocol/text.js';
import { parseTimestamptz, parseVector } from './parsers.js';
import {
	arrayOids,
	arrayParserInfo,
	oids,
	parseBigInt,
	parseBool,
	parseBytea,
	parseFloat,
	parseInteger,
	parseJson,
	type TextParser,
	type TypeParsers,
} from './types.js';

/** Decodes one binary-format value, `bytes[start, end)`. */
export type BinaryParser = (
	bytes: Uint8Array,
	start: number,
	end: number,
) => unknown;

const scratch = new DataView(new ArrayBuffer(8));

const int32 = (b: Uint8Array, s: number): number =>
	((b[s] ?? 0) << 24) |
	((b[s + 1] ?? 0) << 16) |
	((b[s + 2] ?? 0) << 8) |
	(b[s + 3] ?? 0);

const bool: BinaryParser = (b, s) => b[s] !== 0;
const int2: BinaryParser = (b, s) =>
	(((b[s] ?? 0) << 24) >> 16) | (b[s + 1] ?? 0);
const int4: BinaryParser = (b, s) => int32(b, s);
const uint4: BinaryParser = (b, s) => int32(b, s) >>> 0;
const float8: BinaryParser = (b, s) => {
	for (let i = 0; i < 8; i++) scratch.setUint8(i, b[s + i] ?? 0);
	return scratch.getFloat64(0);
};
/** A copy, so rows never hold on to (or alias) the read buffer. */
const bytea: BinaryParser = (b, s, e) => new Uint8Array(b.subarray(s, e));

/** Microseconds between the Unix epoch and PostgreSQL's (2000-01-01). */
const PG_EPOCH_MS = 946_684_800_000;
const MAX_DATE = 8.64e15;
const timestamptz: BinaryParser = (b, s) => {
	const hi = int32(b, s);
	const lo = int32(b, s + 4) >>> 0;
	if (hi === 0x7fffffff && lo === 0xffffffff) return new Date(MAX_DATE);
	if (hi === -0x80000000 && lo === 0) return new Date(-MAX_DATE);
	// floor((hi * 2^32 + lo) / 1000) without the sum, which loses precision
	// beyond 2^53 µs (285 years from 2000): 2^32 = 4294967 * 1000 + 296
	const ms = hi * 4294967 + Math.floor((hi * 296 + lo) / 1000);
	return new Date(ms + PG_EPOCH_MS);
};

const TWO_32 = 4294967296;
/** int8 as `int8out` prints it. */
const int8Text: BinaryParser = (b, s) => {
	const hi = int32(b, s);
	const lo = int32(b, s + 4) >>> 0;
	// exact as a double below 2^53
	if (hi >= -0x200000 && hi < 0x200000) return String(hi * TWO_32 + lo);
	return BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo)).toString();
};
const int8BigInt: BinaryParser = (b, s) => {
	const hi = int32(b, s);
	const lo = int32(b, s + 4) >>> 0;
	if (hi >= -0x200000 && hi < 0x200000) return BigInt(hi * TWO_32 + lo);
	return BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo));
};
const text: BinaryParser = (b, s, e) => utf8(b, s, e);
const json: BinaryParser = (b, s, e) => JSON.parse(utf8(b, s, e));
/** jsonb's binary format: a version byte (1), then the text. */
const jsonb: BinaryParser = (b, s, e) => {
	if (b[s] !== 1) throw new DriverError('Unsupported jsonb binary version');
	return JSON.parse(utf8(b, s + 1, e));
};

/** pgvector's binary format: Int16 dimensions, Int16 unused, then float4s. */
const vector: BinaryParser = (b, s, e) => {
	const dim = ((b[s] ?? 0) << 8) | (b[s + 1] ?? 0);
	if (e - s !== 4 + dim * 4)
		throw new DriverError('Invalid vector binary value');
	const view = new DataView(b.buffer, b.byteOffset + s + 4, dim * 4);
	const out: number[] = [];
	for (let i = 0; i < dim; i++) out.push(view.getFloat32(i * 4));
	return out;
};

const invalidArray = (): DriverError =>
	new DriverError('Invalid array binary value');

/** PostgreSQL's MAXDIM. */
const MAX_DIMENSIONS = 6;

/**
 * Decodes a binary array into nested arrays, as `parseArray` does its text:
 * lower bounds are dropped and NULL elements are `null`.
 */
function arrayDecoder(elementOid: number, element: BinaryParser): BinaryParser {
	return (b, s, e) => {
		const ndim = int32(b, s);
		if (e - s < 12 || int32(b, s + 8) !== elementOid) throw invalidArray();
		if (ndim === 0) return [];
		let pos = s + 12 + ndim * 8;
		if (ndim < 0 || ndim > MAX_DIMENSIONS || pos > e) throw invalidArray();
		const level = (dim: number): unknown[] => {
			const n = int32(b, s + 12 + dim * 8);
			const out: unknown[] = [];
			if (dim < ndim - 1) {
				for (let i = 0; i < n; i++) out.push(level(dim + 1));
				return out;
			}
			for (let i = 0; i < n; i++) {
				if (pos + 4 > e) throw invalidArray();
				const length = int32(b, pos);
				pos += 4;
				if (length === -1) {
					out.push(null);
					continue;
				}
				const next = pos + length;
				if (length < 0 || next > e) throw invalidArray();
				out.push(element(b, pos, next));
				pos = next;
			}
			return out;
		};
		const out = level(0);
		if (pos !== e) throw invalidArray();
		return out;
	};
}

const oidsByName: Readonly<Record<string, number>> = oids;
/** The element type of each built-in array type. */
const arrayElements: Readonly<Record<number, number>> = Object.fromEntries(
	Object.entries(arrayOids).flatMap(([name, oid]) => {
		const element = oidsByName[name];
		return element === undefined ? [] : [[oid, element]];
	}),
);

/** Element types whose binary format is their text. */
const textLike = new Set<number>([
	oids.text,
	oids.varchar,
	oids.bpchar,
	oids.name,
]);

/**
 * The binary decoder of an array element giving the same value as
 * `parser`: the scalar decoders, plus types that stay text as scalars
 * (decoding them from binary only pays off inside an array).
 */
function elementParser(
	oid: number,
	parser: TextParser | undefined,
): BinaryParser | undefined {
	if (parser === undefined) {
		if (textLike.has(oid)) return text;
		return oid === oids.int8 ? int8Text : undefined;
	}
	if (oid === oids.int8) return parser === parseBigInt ? int8BigInt : undefined;
	if (oid === oids.json) return parser === parseJson ? json : undefined;
	if (oid === oids.jsonb) return parser === parseJson ? jsonb : undefined;
	return binaryParser(oid, parser);
}

/**
 * The binary decoder that gives the same value as `parser` for type `oid`,
 * or undefined. Binary format is only used where this exists, so custom
 * parsers and raw types always get the server's text. Arrays qualify when
 * their parser is the driver's own (`arrayParser`) and their element has
 * a decoder.
 */
export function binaryParser(
	oid: number,
	parser: TextParser | undefined,
): BinaryParser | undefined {
	if (parser === undefined) return undefined;
	if (parser === parseVector) return vector;
	const array = arrayParserInfo(parser);
	if (array !== undefined) {
		const elementOid = array.elementOid ?? arrayElements[oid];
		if (elementOid === undefined || array.delimiter !== ',') return undefined;
		const element = elementParser(elementOid, array.element);
		return element && arrayDecoder(elementOid, element);
	}
	switch (oid) {
		case oids.bool:
			return parser === parseBool ? bool : undefined;
		case oids.int2:
			return parser === parseInteger ? int2 : undefined;
		case oids.int4:
			return parser === parseInteger ? int4 : undefined;
		case oids.oid:
			return parser === parseInteger ? uint4 : undefined;
		// float4 stays text: its text form is the shortest float32 round-trip
		// (3.4e38), which as a double differs from the binary float32 value
		case oids.float8:
			return parser === parseFloat ? float8 : undefined;
		case oids.bytea:
			return parser === parseBytea ? bytea : undefined;
		case oids.timestamptz:
			return parser === parseTimestamptz ? timestamptz : undefined;
		default:
			return undefined;
	}
}

/** Per-column result formats for `fields` (1 where a binary decoder applies), and the fields with those formats. */
export interface FormatPlan {
	readonly formats: readonly number[] | 0;
	readonly fields: readonly Field[];
}

export function formatPlan(
	fields: readonly Field[],
	types: TypeParsers,
): FormatPlan {
	const formats = fields.map((field) =>
		binaryParser(field.typeOid, types[field.typeOid]) ? 1 : 0,
	);
	if (!formats.includes(1)) return { formats: 0, fields };
	return {
		formats,
		fields: fields.map((field, i) => ({ ...field, format: formats[i] ?? 0 })),
	};
}
