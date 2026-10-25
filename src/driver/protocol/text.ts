const decoder = new TextDecoder();

/** The bytes as a Buffer sharing the same memory. */
export function asBuffer(bytes: Uint8Array): Buffer {
	if (bytes instanceof Buffer) return bytes;
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A new, uninitialized buffer of `size` bytes, so `utf8` takes its fast path. */
export function allocate(size: number): Buffer {
	return Buffer.allocUnsafe(size);
}

type Utf8Buffer = Buffer & {
	utf8Slice(start: number, end: number): string;
};

const isBuffer = (bytes: Uint8Array): bytes is Utf8Buffer =>
	bytes instanceof Buffer;

/**
 * Decodes UTF-8 bytes in `[start, end)`, which must lie within `bytes`.
 * From a Buffer it calls `utf8Slice`: the native call
 * `toString('utf8', start, end)` makes once it has normalized its
 * arguments and looked up the encoding, which costs a short string about a
 * tenth more. Other byte arrays build short ASCII runs directly and use
 * `TextDecoder` for the rest.
 */
export function utf8(bytes: Uint8Array, start: number, end: number): string {
	if (isBuffer(bytes)) return bytes.utf8Slice(start, end);
	const length = end - start;
	if (length === 0) return '';
	if (length <= 24) {
		let out = '';
		for (let i = start; i < end; i++) {
			const byte = bytes[i] ?? 0;
			if (byte >= 0x80) return decoder.decode(bytes.subarray(start, end));
			out += String.fromCharCode(byte);
		}
		return out;
	}
	return decoder.decode(bytes.subarray(start, end));
}
