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

type Utf8Buffer = Uint8Array & {
	utf8Slice(start: number, end: number): string;
};

/**
 * Whether Buffers have `utf8Slice` (Node, Bun): the native call
 * `toString('utf8', start, end)` makes once it has normalized its
 * arguments and looked up the encoding, which costs a short string about a
 * tenth more. Deno's `utf8Slice` is slower than its `toString`.
 */
const slicesUtf8 =
	NodeBuffer !== undefined &&
	Reflect.get(globalThis, 'Deno') === undefined &&
	typeof Reflect.get(NodeBuffer.prototype, 'utf8Slice') === 'function';

const hasUtf8Slice = (bytes: Uint8Array): bytes is Utf8Buffer =>
	slicesUtf8 && NodeBuffer !== undefined && bytes instanceof NodeBuffer;

/**
 * Decodes UTF-8 bytes in `[start, end)`, which must lie within `bytes`:
 * natively from a Node Buffer, otherwise building short ASCII runs directly
 * and using `TextDecoder` for the rest.
 */
export function utf8(bytes: Uint8Array, start: number, end: number): string {
	if (hasUtf8Slice(bytes)) return bytes.utf8Slice(start, end);
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
