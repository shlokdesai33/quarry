import { allocate } from './text.js';

const encoder = new TextEncoder();

/** A buffer grown past this is handed to `take`'s caller rather than copied and kept. */
const MAX_RETAINED = 1 << 20;

/**
 * Builds frontend messages into one growable buffer, so a pipeline of
 * messages goes out in a single socket write. Each message is opened with
 * `begin`, filled, and closed with `end`, which back-fills its length.
 */
export class Writer {
	readonly #size: number;
	#buf: Uint8Array;
	#view: DataView;
	#pos = 0;
	#start = -1;

	constructor(size = 4096) {
		this.#size = size;
		this.#buf = new Uint8Array(size);
		this.#view = new DataView(this.#buf.buffer);
	}

	/** Bytes written so far. */
	get length(): number {
		return this.#pos;
	}

	#ensure(n: number): void {
		const needed = this.#pos + n;
		if (needed <= this.#buf.length) return;
		let size = this.#buf.length * 2;
		while (size < needed) size *= 2;
		const next = new Uint8Array(size);
		next.set(this.#buf.subarray(0, this.#pos));
		this.#buf = next;
		this.#view = new DataView(next.buffer);
	}

	/** Opens a message with a type byte and a length to back-fill. */
	begin(type: number): this {
		this.#ensure(5);
		this.#buf[this.#pos++] = type;
		this.#start = this.#pos;
		this.#pos += 4;
		return this;
	}

	/** Opens a message without a type byte (startup, SSL and cancel requests). */
	beginUntyped(): this {
		this.#ensure(4);
		this.#start = this.#pos;
		this.#pos += 4;
		return this;
	}

	/** Closes the open message, writing its length. */
	end(): this {
		this.#view.setInt32(this.#start, this.#pos - this.#start);
		this.#start = -1;
		return this;
	}

	int8(value: number): this {
		this.#ensure(1);
		this.#buf[this.#pos++] = value;
		return this;
	}

	int16(value: number): this {
		this.#ensure(2);
		this.#view.setInt16(this.#pos, value);
		this.#pos += 2;
		return this;
	}

	int32(value: number): this {
		this.#ensure(4);
		this.#view.setInt32(this.#pos, value);
		this.#pos += 4;
		return this;
	}

	bytes(value: Uint8Array): this {
		this.#ensure(value.length);
		this.#buf.set(value, this.#pos);
		this.#pos += value.length;
		return this;
	}

	/** UTF-8 text, without a terminator. */
	string(value: string): this {
		const length = value.length;
		if (length === 0) return this;
		if (length <= 64 || this.#pos + length * 3 <= this.#buf.length) {
			this.#ensure(length * 3);
			// short ASCII strings (most parameters) are copied directly: a view
			// for encodeInto costs more than the copy
			if (length <= 64) {
				const buf = this.#buf;
				const pos = this.#pos;
				let i = 0;
				for (; i < length; i++) {
					const code = value.charCodeAt(i);
					if (code > 0x7f) break;
					buf[pos + i] = code;
				}
				if (i === length) {
					this.#pos = pos + length;
					return this;
				}
			}
			this.#pos += encoder.encodeInto(
				value,
				this.#buf.subarray(this.#pos),
			).written;
			return this;
		}
		// reserve a byte per character first, and 3 only for what didn't fit:
		// most text is ASCII, and 3× would triple the buffer for large values
		this.#ensure(length);
		const { read, written } = encoder.encodeInto(
			value,
			this.#buf.subarray(this.#pos),
		);
		this.#pos += written;
		if (read === length) return this;
		const rest = value.slice(read);
		this.#ensure(rest.length * 3);
		this.#pos += encoder.encodeInto(
			rest,
			this.#buf.subarray(this.#pos),
		).written;
		return this;
	}

	/** A NUL-terminated string. Postgres strings cannot contain NUL. */
	cstring(value: string): this {
		if (value.includes('\0')) {
			throw new TypeError('Strings sent to postgres cannot contain NUL bytes');
		}
		return this.string(value).int8(0);
	}

	/**
	 * A length-prefixed value: Int32 length then the bytes, or -1 for NULL.
	 * Strings are written as UTF-8.
	 */
	value(value: string | Uint8Array | null): this {
		if (value === null) return this.int32(-1);
		if (typeof value !== 'string') return this.int32(value.length).bytes(value);
		const at = this.#pos;
		this.int32(0).string(value);
		this.#view.setInt32(at, this.#pos - at - 4);
		return this;
	}

	/** Drops everything written after `length`, e.g. a message that failed halfway. */
	truncate(length: number): void {
		this.#pos = length;
		this.#start = -1;
	}

	/**
	 * Takes the bytes written so far and resets the writer. A buffer that
	 * grew large for one message goes with them, so it isn't copied or kept
	 * for the connection's lifetime.
	 */
	take(): Uint8Array {
		let out: Uint8Array;
		if (this.#buf.length > MAX_RETAINED) {
			out = this.#buf.subarray(0, this.#pos);
			this.#buf = new Uint8Array(this.#size);
			this.#view = new DataView(this.#buf.buffer);
		} else {
			// a Buffer: small ones come from its shared pool, and Node's socket
			// takes them without wrapping them first
			const length = this.#pos;
			const buf = this.#buf;
			out = allocate(length);
			// a loop for a few bytes, rather than a view to copy from
			if (length <= 256) for (let i = 0; i < length; i++) out[i] = buf[i] ?? 0;
			else out.set(buf.subarray(0, length));
		}
		this.#pos = 0;
		return out;
	}

	/** The buffer's current size. */
	get capacity(): number {
		return this.#buf.length;
	}
}
