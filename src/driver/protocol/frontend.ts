import { Writer } from './writer.js';

/** Protocol version 3.0, as sent in the startup message. */
export const PROTOCOL_3_0 = 196608;
/** Protocol version 3.2 (PostgreSQL 18+): variable-length cancel keys. */
export const PROTOCOL_3_2 = 196610;

const SSL_REQUEST_CODE = 80877103;
const CANCEL_REQUEST_CODE = 80877102;

/** A value bound to a parameter: text, binary, or NULL. */
export type WireValue = string | Uint8Array | null;

/** The startup message: the protocol version and session parameters. */
export function startup(
	w: Writer,
	version: number,
	params: Readonly<Record<string, string>>,
): Writer {
	w.beginUntyped().int32(version);
	for (const [key, value] of Object.entries(params)) {
		w.cstring(key).cstring(value);
	}
	return w.int8(0).end();
}

/** Asks the server to switch to TLS before startup. */
export function sslRequest(): Uint8Array {
	return new Writer(8).beginUntyped().int32(SSL_REQUEST_CODE).end().take();
}

/**
 * Asks the server to cancel the query running on the backend `pid`. Sent on
 * a separate connection. The key is 4 bytes before protocol 3.2 and up to
 * 256 bytes from 3.2.
 */
export function cancelRequest(pid: number, key: Uint8Array): Uint8Array {
	return new Writer(12 + key.length)
		.beginUntyped()
		.int32(CANCEL_REQUEST_CODE)
		.int32(pid)
		.bytes(key)
		.end()
		.take();
}

/** A cleartext or MD5-hashed password. */
export function password(w: Writer, value: string): Writer {
	return w.begin(0x70).cstring(value).end();
}

/** The first SASL message: the chosen mechanism and its initial response. */
export function saslInitialResponse(
	w: Writer,
	mechanism: string,
	data: Uint8Array,
): Writer {
	return w.begin(0x70).cstring(mechanism).int32(data.length).bytes(data).end();
}

/** A later SASL message. */
export function saslResponse(w: Writer, data: Uint8Array): Writer {
	return w.begin(0x70).bytes(data).end();
}

/** A simple query: one or more statements, text results. */
export function query(w: Writer, sql: string): Writer {
	return w.begin(0x51).cstring(sql).end();
}

/** Parses `sql` into the prepared statement `name` ('' is unnamed). */
export function parse(
	w: Writer,
	name: string,
	sql: string,
	types: readonly number[] = [],
): Writer {
	w.begin(0x50).cstring(name).cstring(sql).int16(types.length);
	for (const oid of types) w.int32(oid);
	return w.end();
}

/**
 * Binds values to a prepared statement, creating a portal. Strings are sent
 * in text format and byte arrays in binary format. Results are requested in
 * `resultFormat` (0 text, 1 binary) for every column.
 */
export function bind(
	w: Writer,
	portal: string,
	statement: string,
	values: readonly WireValue[],
	resultFormat: 0 | 1 = 0,
): Writer {
	w.begin(0x42).cstring(portal).cstring(statement);
	if (values.some((value) => value instanceof Uint8Array)) {
		w.int16(values.length);
		for (const value of values) w.int16(value instanceof Uint8Array ? 1 : 0);
	} else {
		w.int16(0);
	}
	w.int16(values.length);
	for (const value of values) w.value(value);
	if (resultFormat === 0) w.int16(0);
	else w.int16(1).int16(1);
	return w.end();
}

/** Describes a prepared statement (`S`) or a portal (`P`). */
export function describe(w: Writer, kind: 'S' | 'P', name: string): Writer {
	return w
		.begin(0x44)
		.int8(kind === 'S' ? 0x53 : 0x50)
		.cstring(name)
		.end();
}

/** Runs a portal, returning at most `maxRows` rows (0 for all). */
export function execute(w: Writer, portal: string, maxRows = 0): Writer {
	return w.begin(0x45).cstring(portal).int32(maxRows).end();
}

/** Closes a prepared statement (`S`) or a portal (`P`). */
export function close(w: Writer, kind: 'S' | 'P', name: string): Writer {
	return w
		.begin(0x43)
		.int8(kind === 'S' ? 0x53 : 0x50)
		.cstring(name)
		.end();
}

/** Ends an extended-query pipeline segment; the server answers ReadyForQuery. */
export function sync(w: Writer): Writer {
	return w.begin(0x53).end();
}

/** Asks the server to send pending output without ending the segment. */
export function flush(w: Writer): Writer {
	return w.begin(0x48).end();
}

export function terminate(w: Writer): Writer {
	return w.begin(0x58).end();
}

export function copyData(w: Writer, data: Uint8Array | string): Writer {
	w.begin(0x64);
	if (typeof data === 'string') w.string(data);
	else w.bytes(data);
	return w.end();
}

export function copyDone(w: Writer): Writer {
	return w.begin(0x63).end();
}

export function copyFail(w: Writer, message: string): Writer {
	return w.begin(0x66).cstring(message).end();
}
