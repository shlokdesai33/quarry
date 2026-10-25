import { allocate } from './protocol/text.js';

/*
 * Binary encoders for array parameters of the built-in codecs (`arrayOf`),
 * so the server reads them with `array_recv` rather than parsing a `{…}`
 * literal. An encoder gives up (undefined) on any
 * element it can't encode exactly as the text path would be read, and the
 * array is then sent as a literal, as before.
 */

const PG_EPOCH_MS = 946_684_800_000;
const TWO_32 = 4294967296;
const INT8_DIGITS = /^-?\d{1,19}$/;
const MIN_INT8 = -(2n ** 63n);
const MAX_INT8 = 2n ** 63n - 1n;

interface Fixed {
	readonly kind: 'fixed';
	readonly element: number;
	readonly width: number;
	/** Writes `value` at `pos`, or returns false when it can't be encoded. */
	readonly write: (view: DataView, pos: number, value: unknown) => boolean;
}

interface Variable {
	readonly kind: 'variable';
	readonly element: number;
	/** jsonb's version byte, written before the text. */
	readonly prefix: number | undefined;
	/** jsonb: elements are JSON values to stringify (`values`), or already JSON text. */
	readonly json: boolean;
}

/** bytea: byte arrays as they are. */
interface Bytes {
	readonly kind: 'bytes';
	readonly element: number;
}

type Codec = Fixed | Variable | Bytes;

const fixed = (
	element: number,
	width: number,
	write: Fixed['write'],
): Fixed => ({ kind: 'fixed', element, width, write });

const writeInt8 = (view: DataView, pos: number, value: unknown): boolean => {
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) return false;
		const hi = Math.floor(value / TWO_32);
		view.setInt32(pos, hi);
		view.setUint32(pos + 4, value - hi * TWO_32);
		return true;
	}
	let big: bigint;
	if (typeof value === 'bigint') big = value;
	else if (typeof value === 'string' && INT8_DIGITS.test(value)) {
		// exact below 2^53; anything at or above it isn't a safe integer
		const n = Number(value);
		if (Number.isSafeInteger(n)) return writeInt8(view, pos, n);
		big = BigInt(value);
	} else return false;
	if (big < MIN_INT8 || big > MAX_INT8) return false;
	view.setBigInt64(pos, big);
	return true;
};

/** Microseconds since 2000 as exact halves: the sum can exceed 2^53. */
const writeTimestamptz = (
	view: DataView,
	pos: number,
	value: unknown,
): boolean => {
	if (!(value instanceof Date)) return false;
	const time = value.getTime();
	if (Number.isNaN(time)) return false;
	const ms = time - PG_EPOCH_MS;
	const high = Math.floor(ms / TWO_32);
	const low = (ms - high * TWO_32) * 1000;
	const carry = Math.floor(low / TWO_32);
	view.setInt32(pos, high * 1000 + carry);
	view.setUint32(pos + 4, low - carry * TWO_32);
	return true;
};

const HEX = new Int8Array(128).fill(-1);
for (let i = 0; i < 16; i++) {
	HEX['0123456789abcdef'.charCodeAt(i)] = i;
	HEX['0123456789ABCDEF'.charCodeAt(i)] = i;
}
const hex = (s: string, i: number): number => HEX[s.charCodeAt(i)] ?? -1;

/** Only the canonical `8-4-4-4-12` form; `uuid_in`'s other spellings go as text. */
const writeUuid = (view: DataView, pos: number, value: unknown): boolean => {
	if (typeof value !== 'string' || value.length !== 36) return false;
	let j = 0;
	for (let i = 0; i < 16; i++) {
		if (j === 8 || j === 13 || j === 18 || j === 23) {
			if (value.charCodeAt(j) !== 45) return false;
			j++;
		}
		const byte = (hex(value, j) << 4) | hex(value, j + 1);
		if (byte < 0) return false;
		view.setUint8(pos + i, byte);
		j += 2;
	}
	return true;
};

/** Codecs by array type OID. */
const codecs: Readonly<Record<number, Codec>> = {
	// bool[]
	1000: fixed(16, 1, (view, pos, value) => {
		if (typeof value !== 'boolean') return false;
		view.setUint8(pos, value ? 1 : 0);
		return true;
	}),
	// int2[]
	1005: fixed(21, 2, (view, pos, value) => {
		if (typeof value !== 'number' || !Number.isInteger(value)) return false;
		if (value < -32768 || value > 32767) return false;
		view.setInt16(pos, value);
		return true;
	}),
	// int4[]
	1007: fixed(23, 4, (view, pos, value) => {
		if (typeof value !== 'number' || !Number.isInteger(value)) return false;
		if (value < -2147483648 || value > 2147483647) return false;
		view.setInt32(pos, value);
		return true;
	}),
	// int8[]
	1016: fixed(20, 8, writeInt8),
	// float8[]: -0 becomes 0, as `String(-0)` sends it in text
	1022: fixed(701, 8, (view, pos, value) => {
		if (typeof value !== 'number') return false;
		view.setFloat64(pos, value === 0 ? 0 : value);
		return true;
	}),
	// timestamptz[]
	1185: fixed(1184, 8, writeTimestamptz),
	// uuid[]
	2951: fixed(2950, 16, writeUuid),
	// text[], varchar[], bpchar[]
	1009: { kind: 'variable', element: 25, prefix: undefined, json: false },
	1015: { kind: 'variable', element: 1043, prefix: undefined, json: false },
	1014: { kind: 'variable', element: 1042, prefix: undefined, json: false },
	// jsonb[]: each element as its JSON text
	3807: { kind: 'variable', element: 3802, prefix: 1, json: true },
	// bytea[]
	1001: { kind: 'bytes', element: 17 },
};

/** The header of a one-dimensional array: ndim, has-nulls, element type, length, lower bound. */
function header(
	view: DataView,
	element: number,
	length: number,
	nulls: boolean,
): number {
	if (length === 0) {
		view.setInt32(0, 0);
		view.setInt32(4, 0);
		view.setInt32(8, element);
		return 12;
	}
	view.setInt32(0, 1);
	view.setInt32(4, nulls ? 1 : 0);
	view.setInt32(8, element);
	view.setInt32(12, length);
	view.setInt32(16, 1);
	return 20;
}

const viewOf = (bytes: Uint8Array): DataView =>
	new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function encodeFixed(
	codec: Fixed,
	values: readonly unknown[],
): Uint8Array | undefined {
	let nulls = 0;
	for (const value of values) if (value === null) nulls++;
	const size = 20 + values.length * 4 + (values.length - nulls) * codec.width;
	const out = allocate(size);
	const view = viewOf(out);
	let pos = header(view, codec.element, values.length, nulls > 0);
	for (const value of values) {
		if (value === null) {
			view.setInt32(pos, -1);
			pos += 4;
			continue;
		}
		view.setInt32(pos, codec.width);
		if (!codec.write(view, pos + 4, value)) return undefined;
		pos += 4 + codec.width;
	}
	return out.subarray(0, pos);
}

function encodeVariable(
	codec: Variable,
	input: readonly unknown[],
	jsonValues: boolean,
): Uint8Array | undefined {
	const values =
		codec.json && jsonValues
			? input.map((value) => (value === null ? value : JSON.stringify(value)))
			: input;
	const prefix = codec.prefix === undefined ? 0 : 1;
	let size = 20;
	let nulls = false;
	for (const value of values) {
		if (value === null) {
			nulls = true;
			size += 4;
		} else if (typeof value === 'string') {
			size += 4 + prefix + Buffer.byteLength(value);
		} else {
			return undefined;
		}
	}
	const out = allocate(size);
	const view = viewOf(out);
	let pos = header(view, codec.element, values.length, nulls);
	for (const value of values) {
		if (typeof value !== 'string') {
			view.setInt32(pos, -1);
			pos += 4;
			continue;
		}
		const start = pos + 4;
		let end = start;
		if (codec.prefix !== undefined) out[end++] = codec.prefix;
		end += out.write(value, end);
		view.setInt32(pos, end - start);
		pos = end;
	}
	return out.subarray(0, pos);
}

function encodeBytes(
	codec: Bytes,
	values: readonly unknown[],
): Uint8Array | undefined {
	let size = 20;
	let nulls = false;
	for (const value of values) {
		if (value === null) nulls = true;
		else if (ArrayBuffer.isView(value)) size += value.byteLength;
		else return undefined;
		size += 4;
	}
	const out = allocate(size);
	const view = viewOf(out);
	let pos = header(view, codec.element, values.length, nulls);
	for (const value of values) {
		if (!ArrayBuffer.isView(value)) {
			view.setInt32(pos, -1);
			pos += 4;
			continue;
		}
		view.setInt32(pos, value.byteLength);
		out.set(
			new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
			pos + 4,
		);
		pos += 4 + value.byteLength;
	}
	return out.subarray(0, pos);
}

/**
 * `values` in binary for the array type `arrayOid`, or undefined when the
 * type has no encoder or an element doesn't fit it (nested arrays, a value
 * of another JavaScript type, out of range). jsonb elements are JSON text,
 * or with `jsonValues`, JSON values to stringify.
 */
export function binaryArray(
	values: readonly unknown[],
	arrayOid: number,
	jsonValues = false,
): Uint8Array | undefined {
	const codec = codecs[arrayOid];
	if (codec === undefined) return undefined;
	switch (codec.kind) {
		case 'fixed':
			return encodeFixed(codec, values);
		case 'variable':
			return encodeVariable(codec, values, jsonValues);
		case 'bytes':
			return encodeBytes(codec, values);
	}
}
