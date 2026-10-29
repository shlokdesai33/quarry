import { ProtocolError } from '../errors.js';
import type { Notification } from '../notice.js';
import type { BackendMessage, Field, NoticeFields } from './messages.js';
import { allocate, asBuffer, utf8 } from './text.js';

const EMPTY = new Uint8Array(0);

/** The largest backend message accepted, by default: 1 GiB, Postgres's own field limit. */
const DEFAULT_MAX_MESSAGE_SIZE = 0x40000000;

/**
 * Splits the byte stream from the server into backend messages. Bytes are
 * pushed as they arrive; `next` returns each complete message in order, or
 * `undefined` when more bytes are needed.
 *
 * Messages are read in place from the pushed chunks. Only a message split
 * across chunks is copied, into a buffer of its own size, so a chunk is never
 * re-copied to join its tail to the next one, and large rows and COPY data
 * stay linear. Consumed chunks are released, not kept while the connection
 * is idle.
 */
/** Split DataRows from this size up reuse one buffer (smaller ones are cheap to allocate), up to `MAX_SPARE`. */
const MIN_SPARE = 65_536;
const MAX_SPARE = 16 * 1024 * 1024;

export class Reader {
	/** The chunk being read, from `#pos`. Empty while a split message is collected. */
	#buf: Uint8Array = EMPTY;
	#pos = 0;
	/** A message split across chunks: its first `#partLength` bytes so far. */
	#part: Uint8Array = EMPTY;
	#partLength = 0;
	/** The split message's size, or 5 (the header) until its length is known; 0 when there is none. */
	#needed = 0;
	/** Whether `#part` holds a whole message, returned before the rest of `#buf`. */
	#partReady = false;
	/**
	 * The buffer split DataRows are put back together in, reused: a row is
	 * decoded, its values copied out, before the next message is read.
	 * Dropped when the connection goes idle (`dropSpare`), so it holds
	 * memory only while queries run.
	 */
	#spare: Uint8Array = EMPTY;
	readonly #maxMessageSize: number;

	constructor(maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE) {
		this.#maxMessageSize = maxMessageSize;
	}

	/** Bytes received but not yet returned as messages. */
	get buffered(): number {
		return this.#buf.length - this.#pos + this.#partLength;
	}

	push(bytes: Uint8Array): void {
		if (bytes.length === 0) return;
		const chunk = asBuffer(bytes);
		let at = 0;
		if (this.#needed > 0 && !this.#partReady) {
			at = this.#fill(chunk, 0);
			if (this.#needed === 5 && this.#partLength === 5) {
				this.#sizePart();
				at = this.#fill(chunk, at);
			}
			if (this.#partLength < this.#needed) return;
			this.#partReady = true;
			if (at === chunk.length) return;
		} else if (this.#pos < this.#buf.length) {
			// messages not yet read: keep them ahead of the new bytes
			const rest = this.#buf.length - this.#pos;
			const joined = allocate(rest + chunk.length);
			joined.set(this.#buf.subarray(this.#pos));
			joined.set(chunk, rest);
			this.#set(joined, 0);
			return;
		}
		this.#set(chunk, at);
	}

	#set(buf: Uint8Array, pos: number): void {
		this.#buf = buf;
		this.#pos = pos;
	}

	/** Copies bytes of `chunk` from `at` into the split message, up to its known size; returns where it stopped. */
	#fill(chunk: Uint8Array, at: number): number {
		const n = Math.min(this.#needed - this.#partLength, chunk.length - at);
		this.#part.set(chunk.subarray(at, at + n), this.#partLength);
		this.#partLength += n;
		return at + n;
	}

	/** Reads the split message's length from its now complete header, and makes room for all of it. */
	#sizePart(): void {
		const part = this.#part;
		const length = this.#length(part, 0);
		const whole = this.#partBuffer(part[0] ?? 0, length + 1);
		whole.set(part.subarray(0, 5));
		this.#part = whole;
		this.#needed = length + 1;
	}

	#length(buf: Uint8Array, pos: number): number {
		const length =
			((buf[pos + 1] ?? 0) << 24) |
			((buf[pos + 2] ?? 0) << 16) |
			((buf[pos + 3] ?? 0) << 8) |
			(buf[pos + 4] ?? 0);
		if (length < 4 || length > this.#maxMessageSize) {
			throw new ProtocolError(
				`Invalid length ${length} for message type 0x${(buf[pos] ?? 0).toString(16)}`,
			);
		}
		return length;
	}

	/** Moves the incomplete message at the end of the chunk into a buffer of its own, `needed` bytes long (5 if its length is unknown). */
	#stash(needed: number): void {
		const tail = this.#buf.subarray(this.#pos);
		this.#part = this.#partBuffer(tail[0] ?? 0, needed);
		this.#part.set(tail);
		this.#partLength = tail.length;
		this.#needed = needed;
		this.#release();
	}

	/**
	 * Room for a split message of `size` bytes: in the spare buffer for a
	 * DataRow from `MIN_SPARE` to `MAX_SPARE` bytes, otherwise its own. Other
	 * messages keep their own: CopyData is handed out as a view.
	 */
	#partBuffer(type: number, size: number): Uint8Array {
		if (type !== 0x44 || size < MIN_SPARE || size > MAX_SPARE)
			return allocate(size);
		if (this.#spare.length < size)
			this.#spare = allocate(
				Math.min(MAX_SPARE, Math.max(size, this.#spare.length * 2)),
			);
		return this.#spare.subarray(0, size);
	}

	/** Lets go of the reassembly buffer: the connection has nothing in flight. */
	dropSpare(): void {
		this.#spare = EMPTY;
	}

	#release(): void {
		this.#buf = EMPTY;
		this.#pos = 0;
		this.bytes = EMPTY;
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
		if (this.#partReady) {
			const part = this.#part;
			this.#part = EMPTY;
			this.#partReady = false;
			this.#partLength = 0;
			this.#needed = 0;
			this.bytes = part;
			this.start = 5;
			this.end = part.length;
			this.#type = part[0] ?? 0;
			return this.#type;
		}
		if (this.#needed > 0) return -1;
		const buf = this.#buf;
		const pos = this.#pos;
		const available = buf.length - pos;
		if (available < 5) {
			if (available > 0) this.#stash(5);
			else if (buf !== EMPTY) this.#release();
			return -1;
		}
		const length = this.#length(buf, pos);
		if (available < length + 1) {
			this.#stash(length + 1);
			return -1;
		}
		this.bytes = buf;
		this.start = pos + 5;
		this.end = pos + 1 + length;
		this.#pos = this.end;
		this.#type = buf[pos] ?? 0;
		return this.#type;
	}

	/** Decodes the message found by the latest `nextType`. */
	parse(): BackendMessage {
		return parseMessage(this.#type, this.bytes, this.start, this.end);
	}

	/** The next complete message, or `undefined` if more bytes are needed. */
	next(): BackendMessage | undefined {
		return this.nextType() < 0 ? undefined : this.parse();
	}
}

/** Reads fields of one message body, checking each read stays inside it. */
class Cursor {
	readonly bytes: Uint8Array;
	pos: number;
	readonly end: number;
	#view: DataView | undefined;

	constructor(bytes: Uint8Array, start: number, end: number) {
		this.bytes = bytes;
		this.pos = start;
		this.end = end;
	}

	/** Made on first use: the frequent messages don't read integers through it. */
	get view(): DataView {
		const bytes = this.bytes;
		return (this.#view ??= new DataView(
			bytes.buffer,
			bytes.byteOffset,
			bytes.byteLength,
		));
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

// Messages without fields, and ReadyForQuery, are shared: every query gets
// several, and they are never modified.
const PARSE_COMPLETE: BackendMessage = { type: 'ParseComplete' };
const BIND_COMPLETE: BackendMessage = { type: 'BindComplete' };
const CLOSE_COMPLETE: BackendMessage = { type: 'CloseComplete' };
const NO_DATA: BackendMessage = { type: 'NoData' };
const EMPTY_QUERY_RESPONSE: BackendMessage = { type: 'EmptyQueryResponse' };
const PORTAL_SUSPENDED: BackendMessage = { type: 'PortalSuspended' };
const COPY_DONE: BackendMessage = { type: 'CopyDone' };
const READY_IDLE: BackendMessage = { type: 'ReadyForQuery', status: 'I' };
const READY_TRANSACTION: BackendMessage = {
	type: 'ReadyForQuery',
	status: 'T',
};
const READY_FAILED: BackendMessage = { type: 'ReadyForQuery', status: 'E' };

function readyForQuery(bytes: Uint8Array, start: number, end: number) {
	if (end <= start) throw new ProtocolError('Message too short');
	switch (bytes[start]) {
		case 0x49: // I
			return READY_IDLE;
		case 0x54: // T
			return READY_TRANSACTION;
		case 0x45: // E
			return READY_FAILED;
		default:
			throw new ProtocolError(
				`Invalid transaction status ${String.fromCharCode(bytes[start] ?? 0)}`,
			);
	}
}

/**
 * The last 8 command tags' bytes and strings: queries mostly repeat a few
 * (a transaction alternates BEGIN, its statements and COMMIT), so their
 * strings are reused rather than decoded again.
 */
const TAG_CACHE = 8;
const tagBytes: Uint8Array[] = [];
const tagStrings: string[] = [];
let tagNext = 0;

function commandTag(bytes: Uint8Array, start: number, end: number): string {
	const nul = nulAt(bytes, start, end);
	const length = nul - start;
	for (let k = 0; k < tagBytes.length; k++) {
		const known = tagBytes[k];
		if (known === undefined || known.length !== length) continue;
		let i = 0;
		while (i < length && known[i] === bytes[start + i]) i++;
		if (i === length) return tagStrings[k] ?? '';
	}
	const tag = utf8(bytes, start, nul);
	// a copy: a view would keep the read buffer alive
	tagBytes[tagNext] = new Uint8Array(bytes.subarray(start, nul));
	tagStrings[tagNext] = tag;
	tagNext = (tagNext + 1) % TAG_CACHE;
	return tag;
}

function parseMessage(
	type: number,
	bytes: Uint8Array,
	start: number,
	end: number,
): BackendMessage {
	switch (type) {
		case 0x44: // D
			return { type: 'DataRow', payload: bytes.subarray(start, end) };
		case 0x43: // C
			return { type: 'CommandComplete', tag: commandTag(bytes, start, end) };
		case 0x5a: // Z
			return readyForQuery(bytes, start, end);
		case 0x31: // 1
			return PARSE_COMPLETE;
		case 0x32: // 2
			return BIND_COMPLETE;
		case 0x33: // 3
			return CLOSE_COMPLETE;
		case 0x6e: // n
			return NO_DATA;
		case 0x49: // I
			return EMPTY_QUERY_RESPONSE;
		case 0x73: // s
			return PORTAL_SUSPENDED;
		case 0x63: // c
			return COPY_DONE;
		case 0x64: // d
			return { type: 'CopyData', data: bytes.subarray(start, end) };
		case 0x54: // T
			return rowDescription(new Cursor(bytes, start, end));
		case 0x74: {
			// t
			const cursor = new Cursor(bytes, start, end);
			const n = cursor.count();
			const typeOids: number[] = [];
			for (let i = 0; i < n; i++) typeOids.push(cursor.int32() >>> 0);
			return { type: 'ParameterDescription', typeOids };
		}
		case 0x45: // E
			return {
				type: 'ErrorResponse',
				fields: noticeFields(new Cursor(bytes, start, end)),
			};
		case 0x4e: // N
			return {
				type: 'NoticeResponse',
				fields: noticeFields(new Cursor(bytes, start, end)),
			};
		case 0x53: {
			// S
			const cursor = new Cursor(bytes, start, end);
			return {
				type: 'ParameterStatus',
				name: cursor.cstring(),
				value: cursor.cstring(),
			};
		}
		case 0x4b: {
			// K
			const cursor = new Cursor(bytes, start, end);
			const pid = cursor.int32();
			const key = cursor.bytesCopy();
			if (key.length < 4 || key.length > 256) {
				throw new ProtocolError(`Invalid cancel key length ${key.length}`);
			}
			return { type: 'BackendKeyData', pid, key };
		}
		case 0x41: // A
			return {
				type: 'NotificationResponse',
				...decodeNotification(bytes, start, end),
			};
		case 0x52: // R
			return authentication(new Cursor(bytes, start, end));
		case 0x47: // G
		case 0x48: {
			// H
			const cursor = new Cursor(bytes, start, end);
			const binary = cursor.int8() === 1;
			const n = cursor.count();
			const columnFormats: number[] = [];
			for (let i = 0; i < n; i++) columnFormats.push(cursor.int16());
			return {
				type: type === 0x47 ? 'CopyInResponse' : 'CopyOutResponse',
				binary,
				columnFormats,
			};
		}
		case 0x76: {
			// v
			const cursor = new Cursor(bytes, start, end);
			const minor = cursor.int32();
			const n = cursor.int32();
			if (n < 0 || n > end - start) {
				throw new ProtocolError(`Invalid option count ${n}`);
			}
			const unrecognized: string[] = [];
			for (let i = 0; i < n; i++) unrecognized.push(cursor.cstring());
			return { type: 'NegotiateProtocolVersion', minor, unrecognized };
		}
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

/** How many channel names `ChannelNames` remembers. */
const CHANNEL_NAMES = 8;

/**
 * The channel names of recent notifications, so a notification on a known
 * channel reuses its string: comparing a few bytes is cheaper than decoding
 * them, and Map lookups by that string reuse its cached hash.
 */
export class ChannelNames {
	readonly #bytes: Uint8Array[] = [];
	readonly #names: string[] = [];
	#evict = 0;

	get(bytes: Uint8Array, start: number, end: number): string {
		const length = end - start;
		const known = this.#bytes;
		for (let i = 0; i < known.length; i++) {
			const candidate = known[i] ?? EMPTY;
			if (candidate.length !== length) continue;
			let j = 0;
			while (j < length && candidate[j] === bytes[start + j]) j++;
			if (j === length) return this.#names[i] ?? '';
		}
		const name = utf8(bytes, start, end);
		let slot = known.length;
		if (slot === CHANNEL_NAMES) {
			slot = this.#evict;
			this.#evict = (slot + 1) % CHANNEL_NAMES;
		}
		// a copy: a view would keep the whole read buffer alive
		known[slot] = new Uint8Array(bytes.subarray(start, end));
		this.#names[slot] = name;
		return name;
	}
}

/** Where the NUL ending the string at `from` is, before `end`. */
function nulAt(bytes: Uint8Array, from: number, end: number): number {
	let i = from;
	while (i < end && bytes[i] !== 0) i++;
	if (i >= end) throw new ProtocolError('Unterminated string in message');
	return i;
}

/** Decodes UTF-8 like `utf8`, building strings of a few ASCII bytes in JS: a native call costs more there. */
function shortText(bytes: Uint8Array, start: number, end: number): string {
	if (end - start > 6) return utf8(bytes, start, end);
	let out = '';
	for (let i = start; i < end; i++) {
		const byte = bytes[i] ?? 0;
		if (byte >= 0x80) return utf8(bytes, start, end);
		out += String.fromCharCode(byte);
	}
	return out;
}

/**
 * Decodes a NotificationResponse body in `[start, end)` straight from the
 * read buffer. With `names`, a recently seen channel name is reused rather
 * than decoded again.
 */
export function decodeNotification(
	bytes: Uint8Array,
	start: number,
	end: number,
	names?: ChannelNames,
): Notification {
	if (end - start < 6) throw new ProtocolError('Message too short');
	const pid =
		((bytes[start] ?? 0) << 24) |
		((bytes[start + 1] ?? 0) << 16) |
		((bytes[start + 2] ?? 0) << 8) |
		(bytes[start + 3] ?? 0);
	const channelEnd = nulAt(bytes, start + 4, end);
	const payloadEnd = nulAt(bytes, channelEnd + 1, end);
	return {
		pid,
		channel:
			names === undefined
				? utf8(bytes, start + 4, channelEnd)
				: names.get(bytes, start + 4, channelEnd),
		payload: shortText(bytes, channelEnd + 1, payloadEnd),
	};
}

/**
 * Splits a DataRow body into its values: `null` for SQL NULL, otherwise the
 * `[start, end)` offsets into `payload`. Throws if the body is malformed.
 */
function forEachValue(
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
