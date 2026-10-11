const ALPHABET =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8Encode = (value: string): Uint8Array => encoder.encode(value);
export const utf8Decode = (value: Uint8Array): string => decoder.decode(value);

/** Standard base64 with padding. */
export function base64Encode(bytes: Uint8Array): string {
	let out = '';
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n =
			((bytes[i] ?? 0) << 16) |
			((bytes[i + 1] ?? 0) << 8) |
			(bytes[i + 2] ?? 0);
		out +=
			ALPHABET[n >> 18] +
			ALPHABET[(n >> 12) & 63]! +
			ALPHABET[(n >> 6) & 63]! +
			ALPHABET[n & 63]!;
	}
	const rest = bytes.length - i;
	if (rest === 1) {
		const n = (bytes[i] ?? 0) << 16;
		out += `${ALPHABET[n >> 18]}${ALPHABET[(n >> 12) & 63]}==`;
	} else if (rest === 2) {
		const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
		out += `${ALPHABET[n >> 18]}${ALPHABET[(n >> 12) & 63]}${ALPHABET[(n >> 6) & 63]}=`;
	}
	return out;
}

/** Decodes standard base64; throws on invalid input. */
export function base64Decode(text: string): Uint8Array {
	const clean = text.replace(/=+$/, '');
	if (clean.length % 4 === 1) throw new TypeError('Invalid base64');
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let bits = 0;
	let value = 0;
	let at = 0;
	for (let i = 0; i < clean.length; i++) {
		const code = clean.charCodeAt(i);
		const digit = code < 128 ? (LOOKUP[code] ?? -1) : -1;
		if (digit < 0) throw new TypeError('Invalid base64');
		value = (value << 6) | digit;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[at++] = (value >> bits) & 0xff;
		}
	}
	return out;
}

export function hex(bytes: Uint8Array): string {
	let out = '';
	for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
	return out;
}
