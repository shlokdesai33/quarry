import { Buffer } from 'node:buffer';
import { DriverError } from './errors.js';
import { utf8 } from './protocol/text.js';

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

const int16 = (b: Uint8Array, s: number): number =>
	(((b[s] ?? 0) << 24) >> 16) | (b[s + 1] ?? 0);

export const bool = (b: Uint8Array, s: number): boolean => b[s] !== 0;
export const int2 = (b: Uint8Array, s: number): number => int16(b, s);
export const int4 = (b: Uint8Array, s: number): number => int32(b, s);
export const uint4 = (b: Uint8Array, s: number): number => int32(b, s) >>> 0;
export const float4 = (b: Uint8Array, s: number): number => {
	for (let i = 0; i < 4; i++) scratch.setUint8(i, b[s + i] ?? 0);
	return scratch.getFloat32(0);
};
export const float8 = (b: Uint8Array, s: number): number => {
	for (let i = 0; i < 8; i++) scratch.setUint8(i, b[s + i] ?? 0);
	return scratch.getFloat64(0);
};
/** A copy, so rows never hold on to (or alias) the read buffer. */
export const bytea = (b: Uint8Array, s: number, e: number): Uint8Array =>
	new Uint8Array(b.subarray(s, e));

/** Milliseconds between the Unix epoch and PostgreSQL's (2000-01-01). */
const PG_EPOCH_MS = 946_684_800_000;
const MAX_DATE = 8.64e15;
export const timestamptz = (b: Uint8Array, s: number): Date => {
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
export const int8BigInt = (b: Uint8Array, s: number): bigint => {
	const hi = int32(b, s);
	const lo = int32(b, s + 4) >>> 0;
	// exact as a double below 2^53
	if (hi >= -0x200000 && hi < 0x200000) return BigInt(hi * TWO_32 + lo);
	return BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo));
};
export const int8String = (b: Uint8Array, s: number): string => {
	const hi = int32(b, s);
	const lo = int32(b, s + 4) >>> 0;
	if (hi >= -0x200000 && hi < 0x200000) return String(hi * TWO_32 + lo);
	return String(BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo)));
};
export const text = (b: Uint8Array, s: number, e: number): string =>
	utf8(b, s, e);
/** Any JSON value; `null` here is JSON `null`, which a column holds apart from SQL NULL. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| readonly JsonValue[]
	| { [key: string]: JsonValue };

export const json = (b: Uint8Array, s: number, e: number): JsonValue => {
	const value: JsonValue = JSON.parse(utf8(b, s, e));
	return value;
};
/** jsonb's binary format: a version byte (1), then the text. */
export const jsonb = (b: Uint8Array, s: number, e: number): JsonValue => {
	if (b[s] !== 1) throw new DriverError('Unsupported jsonb binary version');
	const value: JsonValue = JSON.parse(utf8(b, s + 1, e));
	return value;
};

const HEX = '0123456789abcdef';
/** uuid's binary format: 16 bytes, as the hyphenated lowercase text `uuid_out` prints. */
export const uuid = (b: Uint8Array, s: number): string => {
	let out = '';
	for (let i = 0; i < 16; i++) {
		if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
		const byte = b[s + i] ?? 0;
		out += (HEX[byte >> 4] ?? '0') + (HEX[byte & 15] ?? '0');
	}
	return out;
};

/**
 * numeric's binary format, as the text `numeric_out` prints: base-10000
 * digits with a weight, a sign (or NaN, ±Infinity) and a display scale.
 */
export const numeric = (b: Uint8Array, s: number): string => {
	const ndigits = int16(b, s);
	const weight = int16(b, s + 2);
	const sign = ((b[s + 4] ?? 0) << 8) | (b[s + 5] ?? 0);
	const dscale = ((b[s + 6] ?? 0) << 8) | (b[s + 7] ?? 0);
	if (sign === 0xc000) return 'NaN';
	if (sign === 0xd000) return 'Infinity';
	if (sign === 0xf000) return '-Infinity';
	const digit = (i: number): number =>
		i >= 0 && i < ndigits ? int16(b, s + 8 + i * 2) & 0xffff : 0;
	let out = sign === 0x4000 ? '-' : '';
	if (weight < 0) out += '0';
	else {
		for (let i = 0; i <= weight; i++) {
			const d = String(digit(i));
			out += i === 0 ? d : d.padStart(4, '0');
		}
	}
	if (dscale > 0) {
		let fraction = '';
		for (let i = weight + 1; fraction.length < dscale; i++)
			fraction += String(digit(i)).padStart(4, '0');
		out += `.${fraction.slice(0, dscale)}`;
	}
	return out;
};

/** pgvector's binary format: Int16 dimensions, Int16 unused, then float4s. */
export const vector = (b: Uint8Array, s: number, e: number): number[] => {
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

type Latin1Buffer = Uint8Array & {
	latin1Slice(start: number, end: number): string;
};
const hasLatin1Slice = (b: Uint8Array): b is Latin1Buffer =>
	b instanceof Buffer;

/** Elements whose binary format is their UTF-8 text. */
export const TEXT = 'text';

/**
 * Decodes a binary array into nested arrays, as `parseArray` does its text:
 * lower bounds are dropped and NULL elements are `null`. Text elements are
 * sliced from one latin1 string of the whole value where they are ASCII: a
 * substring costs far less than a native UTF-8 decode per element. An
 * `elementOid` of 0 (a type looked up by name) isn't checked.
 */
export function arrayDecoder(
	elementOid: number,
	element: BinaryParser | typeof TEXT,
): BinaryParser {
	return (b, s, e) => {
		const ndim = int32(b, s);
		if (e - s < 12) throw invalidArray();
		if (elementOid !== 0 && int32(b, s + 8) >>> 0 !== elementOid)
			throw invalidArray();
		if (ndim === 0) return [];
		let pos = s + 12 + ndim * 8;
		if (ndim < 0 || ndim > MAX_DIMENSIONS || pos > e) throw invalidArray();
		const latin1 =
			element === TEXT && hasLatin1Slice(b) ? b.latin1Slice(s, e) : undefined;
		const decode = (start: number, end: number): unknown => {
			if (element !== TEXT) return element(b, start, end);
			if (latin1 !== undefined) {
				let ascii = true;
				for (let i = start; i < end && ascii; i++) ascii = (b[i] ?? 0) < 0x80;
				if (ascii) return latin1.slice(start - s, end - s);
			}
			return utf8(b, start, end);
		};
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
				out.push(decode(pos, next));
				pos = next;
			}
			return out;
		};
		const out = level(0);
		if (pos !== e) throw invalidArray();
		return out;
	};
}
