import type { Field } from './protocol/messages.js';
import { parseTimestamptz } from './parsers.js';
import {
	oids,
	parseBool,
	parseBytea,
	parseFloat,
	parseInteger,
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
	return new Date(Math.floor((hi * 4294967296 + lo) / 1000) + PG_EPOCH_MS);
};

/**
 * The binary decoder that gives the same value as `parser` for type `oid`,
 * or undefined. Binary format is only used where this exists, so custom
 * parsers and raw types always get the server's text.
 */
export function binaryParser(
	oid: number,
	parser: TextParser | undefined,
): BinaryParser | undefined {
	if (parser === undefined) return undefined;
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
