const decoder = new TextDecoder();

/**
 * Decodes UTF-8 bytes in `[start, end)`. Short ASCII runs, which most
 * result values are, are built directly; anything else goes through
 * `TextDecoder`.
 */
export function utf8(bytes: Uint8Array, start: number, end: number): string {
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
