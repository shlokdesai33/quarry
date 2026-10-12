import { ProtocolError } from '../errors.js';
import type { BackendMessage, Field, NoticeFields } from './messages.js';
import { allocate, asBuffer, utf8 } from './text.js';

const EMPTY = new Uint8Array(0);

/** The largest backend message accepted, by default: 1 GiB, Postgres's own field limit. */
export const DEFAULT_MAX_MESSAGE_SIZE = 0x40000000;

/**
 * Splits the byte stream from the server into backend messages. Bytes are
 * pushed as they arrive; `next` returns each complete message in order, or
 * `undefined` when more bytes are needed.
 *
 * A message that spans several chunks is collected without re-copying the
 * buffered bytes on every chunk, so large rows and COPY data stay linear.
 */
export class Reader {
	#buf: Uint8Array = EMPTY;
	#view: DataView = new DataView(EMPTY.buffer);
	#pos = 0;
	/** Chunks held back until the message they complete is whole. */
	#pending: Uint8Array[] = [];
	#pendingLength = 0;
	/** The bytes needed before the pending chunks are joined. */
	#needed = 0;
	readonly #maxMessageSize: number;

	constructor(maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE) {
		this.#maxMessageSize = maxMessageSize;
	}

	/** Bytes received but not yet returned as messages. */
	get buffered(): number {
		return this.#buf.length - this.#pos + this.#pendingLength;
	}

	push(bytes: Uint8Array): void {
		if (bytes.length === 0) return;
		const chunk = asBuffer(bytes);
		if (this.#needed > 0) {
			this.#pending.push(chunk);
			this.#pendingLength += chunk.length;
			if (this.#buf.length - this.#pos + this.#pendingLength < this.#needed) {
				return;
			}
			this.#join();
			return;
		}
		if (this.#pos >= this.#buf.length) {
			this.#set(chunk);
			return;
		}
		this.#pending.push(chunk);
		this.#pendingLength += chunk.length;
		this.#join();
	}

	#join(): void {
		const rest = this.#buf.length - this.#pos;
		const next = allocate(rest + this.#pendingLength);
		next.set(this.#buf.subarray(this.#pos));
		let at = rest;
		for (const chunk of this.#pending) {
			next.set(chunk, at);
			at += chunk.length;
		}
		this.#pending = [];
		this.#pendingLength = 0;
		this.#needed = 0;
		this.#set(next);
	}

	#set(buf: Uint8Array): void {
		this.#buf = buf;
		this.#view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
		this.#pos = 0;
	}

	/** The buffer holding the message found by the latest `nextType`. */
	bytes: Uint8Array = EMPTY;
	/** Where that message's body starts and ends in `bytes`. */
	start = 0;
	end = 0;
	#type = -1;

	/**
	 * Finds the next complete message without decoding it: returns its type
	 * byte (and sets `bytes`, `start` and `end`), or -1 if more bytes are
	 * needed. `parse` then decodes it, or the caller reads the body itself,
	 * which is how rows avoid allocating a message object each.
	 */
	nextType(): number {
		if (this.#needed > 0) return -1;
		const available = this.#buf.length - this.#pos;
		if (available < 5) {
			if (available > 0) this.#needed = 5;
			return -1;
		}
		const buf = this.#buf;
		const pos = this.#pos;
		const type = buf[pos] ?? 0;
		const length =
			((buf[pos + 1] ?? 0) << 24) |
			((buf[pos + 2] ?? 0) << 16) |
			((buf[pos + 3] ?? 0) << 8) |
			(buf[pos + 4] ?? 0);
		if (length < 4 || length > this.#maxMessageSize) {
			throw new ProtocolError(
				`Invalid length ${length} for message type 0x${type.toString(16)}`,
			);
		}
		if (available < length + 1) {
			this.#needed = length + 1;
			return -1;
		}
		this.bytes = buf;
		this.start = pos + 5;
		this.end = pos + 1 + length;
		this.#pos = this.end;
		this.#type = type;
		return type;
	}

	/** Decodes the message found by the latest `nextType`. */
	parse(): BackendMessage {
		return parseMessage(
			this.#type,
			this.bytes,
			this.#view,
			this.start,
			this.end,
		);
	}

	/** The next complete message, or `undefined` if more bytes are needed. */
	next(): BackendMessage | undefined {
		return this.nextType() < 0 ? undefined : this.parse();
	}
}

/** Reads fields of one message body, checking each read stays inside it. */
class Cursor {
	readonly bytes: Uint8Array;
	readonly view: DataView;
	pos: number;
	readonly end: number;

	constructor(bytes: Uint8Array, view: DataView, start: number, end: number) {
		this.bytes = bytes;
		this.view = view;
		this.pos = start;
		this.end = end;
	}

	#need(n: number): void {
		if (this.pos + n > this.end) throw new ProtocolError('Message too short');
	}

	int8(): number {
		this.#need(1);
		return this.view.getUint8(this.pos++);
	}

	int16(): number {
		this.#need(2);
		const value = this.view.getInt16(this.pos);
		this.pos += 2;
		return value;
	}

	int32(): number {
		this.#need(4);
		const value = this.view.getInt32(this.pos);
		this.pos += 4;
		return value;
	}

	cstring(): string {
		const nul = this.bytes.indexOf(0, this.pos);
		if (nul < 0 || nul >= this.end) {
			throw new ProtocolError('Unterminated string in message');
		}
		const value = utf8(this.bytes, this.pos, nul);
		this.pos = nul + 1;
		return value;
	}

	/** A copy of `n` bytes, or of the rest of the message. */
	bytesCopy(n = this.end - this.pos): Uint8Array {
		this.#need(n);
		const value = this.bytes.slice(this.pos, this.pos + n);
		this.pos += n;
		return value;
	}

	rest(): Uint8Array {
		const value = this.bytes.subarray(this.pos, this.end);
		this.pos = this.end;
		return value;
	}

	/** A count (of parameters, columns, formats): unsigned, so up to 65535 parameters fit. */
	count(): number {
		this.#need(2);
		const value = this.view.getUint16(this.pos);
		this.pos += 2;
		return value;
	}
}

function parseMessage(
	type: number,
	bytes: Uint8Array,
	view: DataView,
	start: number,
	end: number,
): BackendMessage {
	switch (type) {
		case 0x44: // D
			return { type: 'DataRow', payload: bytes.subarray(start, end) };
		case 0x43: // C
			return {
				type: 'CommandComplete',
				tag: new Cursor(bytes, view, start, end).cstring(),
			};
		case 0x5a: {
			// Z
			const status = String.fromCharCode(
				new Cursor(bytes, view, start, end).int8(),
			);
			if (status !== 'I' && status !== 'T' && status !== 'E') {
				throw new ProtocolError(`Invalid transaction status ${status}`);
			}
			return { type: 'ReadyForQuery', status };
		}
		case 0x31: // 1
			return { type: 'ParseComplete' };
		case 0x32: // 2
			return { type: 'BindComplete' };
		case 0x33: // 3
			return { type: 'CloseComplete' };
		case 0x6e: // n
			return { type: 'NoData' };
		case 0x49: // I
			return { type: 'EmptyQueryResponse' };
		case 0x73: // s
			return { type: 'PortalSuspended' };
		case 0x63: // c
			return { type: 'CopyDone' };
		case 0x64: // d
			return { type: 'CopyData', data: bytes.subarray(start, end) };
		case 0x54: // T
			return rowDescription(new Cursor(bytes, view, start, end));
		case 0x74: {
			// t
			const cursor = new Cursor(bytes, view, start, end);
			const n = cursor.count();
			const typeOids: number[] = [];
			for (let i = 0; i < n; i++) typeOids.push(cursor.int32() >>> 0);
			return { type: 'ParameterDescription', typeOids };
		}
		case 0x45: // E
			return {
				type: 'ErrorResponse',
				fields: noticeFields(new Cursor(bytes, view, start, end)),
			};
		case 0x4e: // N
			return {
				type: 'NoticeResponse',
				fields: noticeFields(new Cursor(bytes, view, start, end)),
			};
		case 0x53: {
			// S
			const cursor = new Cursor(bytes, view, start, end);
			return {
				type: 'ParameterStatus',
				name: cursor.cstring(),
				value: cursor.cstring(),
			};
		}
		case 0x4b: {
			// K
			const cursor = new Cursor(bytes, view, start, end);
			const pid = cursor.int32();
			const key = cursor.bytesCopy();
			if (key.length < 4 || key.length > 256) {
				throw new ProtocolError(`Invalid cancel key length ${key.length}`);
			}
			return { type: 'BackendKeyData', pid, key };
		}
		case 0x41: {
			// A
			const cursor = new Cursor(bytes, view, start, end);
			return {
				type: 'NotificationResponse',
				pid: cursor.int32(),
				channel: cursor.cstring(),
				payload: cursor.cstring(),
			};
		}
		case 0x52: // R
			return authentication(new Cursor(bytes, view, start, end));
		case 0x47: // G
		case 0x48: // H
		case 0x57: {
			// W
			const cursor = new Cursor(bytes, view, start, end);
			const binary = cursor.int8() === 1;
			const n = cursor.count();
			const columnFormats: number[] = [];
			for (let i = 0; i < n; i++) columnFormats.push(cursor.int16());
			return {
				type:
					type === 0x47
						? 'CopyInResponse'
						: type === 0x48
							? 'CopyOutResponse'
							: 'CopyBothResponse',
				binary,
				columnFormats,
			};
		}
		case 0x76: {
			// v
			const cursor = new Cursor(bytes, view, start, end);
			const minor = cursor.int32();
			const n = cursor.int32();
			if (n < 0 || n > end - start) {
				throw new ProtocolError(`Invalid option count ${n}`);
			}
			const unrecognized: string[] = [];
			for (let i = 0; i < n; i++) unrecognized.push(cursor.cstring());
			return { type: 'NegotiateProtocolVersion', minor, unrecognized };
		}
		case 0x56: // V
			return { type: 'FunctionCallResponse' };
		default:
			throw new ProtocolError(
				`Unknown message type 0x${type.toString(16).padStart(2, '0')}`,
			);
	}
}

function rowDescription(cursor: Cursor): BackendMessage {
	const n = cursor.count();
	const fields: Field[] = [];
	for (let i = 0; i < n; i++) {
		fields.push({
			name: cursor.cstring(),
			tableOid: cursor.int32() >>> 0,
			columnId: cursor.int16(),
			typeOid: cursor.int32() >>> 0,
			typeSize: cursor.int16(),
			typeModifier: cursor.int32(),
			format: cursor.int16(),
		});
	}
	return { type: 'RowDescription', fields };
}

function noticeFields(cursor: Cursor): NoticeFields {
	const fields: Record<string, string> = {};
	while (cursor.pos < cursor.end) {
		const code = cursor.int8();
		if (code === 0) break;
		fields[String.fromCharCode(code)] = cursor.cstring();
	}
	return fields;
}

function authentication(cursor: Cursor): BackendMessage {
	const code = cursor.int32();
	switch (code) {
		case 0:
			return { type: 'AuthenticationOk' };
		case 3:
			return { type: 'AuthenticationCleartextPassword' };
		case 5:
			return { type: 'AuthenticationMD5Password', salt: cursor.bytesCopy(4) };
		case 10: {
			const mechanisms: string[] = [];
			for (;;) {
				const mechanism = cursor.cstring();
				if (mechanism === '') break;
				mechanisms.push(mechanism);
			}
			return { type: 'AuthenticationSASL', mechanisms };
		}
		case 11:
			return { type: 'AuthenticationSASLContinue', data: cursor.bytesCopy() };
		case 12:
			return { type: 'AuthenticationSASLFinal', data: cursor.bytesCopy() };
		default:
			return { type: 'AuthenticationUnsupported', code };
	}
}

/**
 * Splits a DataRow body into its values: `null` for SQL NULL, otherwise the
 * `[start, end)` offsets into `payload`. Throws if the body is malformed.
 */
export function forEachValue(
	payload: Uint8Array,
	visit: (index: number, start: number, end: number) => void,
): number {
	if (payload.length < 2) throw new ProtocolError('DataRow too short');
	const view = new DataView(
		payload.buffer,
		payload.byteOffset,
		payload.byteLength,
	);
	const count = view.getInt16(0);
	if (count < 0) throw new ProtocolError(`Negative column count ${count}`);
	let pos = 2;
	for (let i = 0; i < count; i++) {
		if (pos + 4 > payload.length) throw new ProtocolError('DataRow too short');
		const length = view.getInt32(pos);
		pos += 4;
		if (length === -1) {
			visit(i, -1, -1);
			continue;
		}
		if (length < 0 || pos + length > payload.length) {
			throw new ProtocolError(`Invalid value length ${length} in DataRow`);
		}
		visit(i, pos, pos + length);
		pos += length;
	}
	return count;
}

/** Reads a DataRow's values as text, `null` for SQL NULL. */
export function textValues(payload: Uint8Array): (string | null)[] {
	const values: (string | null)[] = [];
	forEachValue(payload, (_, start, end) => {
		values.push(start < 0 ? null : utf8(payload, start, end));
	});
	return values;
}
