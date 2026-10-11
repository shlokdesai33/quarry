const decoder = new TextDecoder();

/** Node's Buffer, where it exists: its native slicing beats TextDecoder for short strings. */
export const NodeBuffer: typeof Buffer | undefined =
	typeof Buffer === 'undefined' ? undefined : Buffer;

/** The bytes as a Node Buffer sharing the same memory, where Buffer exists. */
export function asBuffer(bytes: Uint8Array): Uint8Array {
	if (NodeBuffer === undefined || bytes instanceof NodeBuffer) return bytes;
	return NodeBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A new buffer of `size` bytes: a Buffer where it exists, so `utf8` takes its fast path. */
export function allocate(size: number): Uint8Array {
	return NodeBuffer === undefined
		? new Uint8Array(size)
		: NodeBuffer.allocUnsafe(size);
}

/**
 * Decodes UTF-8 bytes in `[start, end)`: natively from a Node Buffer,
 * otherwise building short ASCII runs directly and using `TextDecoder` for
 * the rest.
 */
export function utf8(bytes: Uint8Array, start: number, end: number): string {
	if (NodeBuffer !== undefined && bytes instanceof NodeBuffer)
		return bytes.toString('utf8', start, end);
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
