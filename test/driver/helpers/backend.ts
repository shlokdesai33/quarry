import { Writer } from '../../../src/driver/protocol/writer.js';
import type { BackendMessage } from '../../../src/driver/protocol/messages.js';

const code = (c: string): number => c.charCodeAt(0);

/** Encodes backend messages, as a server would, for feeding the reader in tests. */
export function encodeBackend(message: BackendMessage): Uint8Array {
	const w = new Writer(64);
	switch (message.type) {
		case 'AuthenticationOk':
			w.begin(code('R')).int32(0);
			break;
		case 'AuthenticationCleartextPassword':
			w.begin(code('R')).int32(3);
			break;
		case 'AuthenticationMD5Password':
			w.begin(code('R')).int32(5).bytes(message.salt);
			break;
		case 'AuthenticationSASL':
			w.begin(code('R')).int32(10);
			for (const m of message.mechanisms) w.cstring(m);
			w.int8(0);
			break;
		case 'AuthenticationSASLContinue':
			w.begin(code('R')).int32(11).bytes(message.data);
			break;
		case 'AuthenticationSASLFinal':
			w.begin(code('R')).int32(12).bytes(message.data);
			break;
		case 'AuthenticationUnsupported':
			w.begin(code('R')).int32(message.code);
			break;
		case 'BackendKeyData':
			w.begin(code('K')).int32(message.pid).bytes(message.key);
			break;
		case 'BindComplete':
			w.begin(code('2'));
			break;
		case 'CloseComplete':
			w.begin(code('3'));
			break;
		case 'CommandComplete':
			w.begin(code('C')).cstring(message.tag);
			break;
		case 'CopyData':
			w.begin(code('d')).bytes(message.data);
			break;
		case 'CopyDone':
			w.begin(code('c'));
			break;
		case 'CopyInResponse':
		case 'CopyOutResponse':
		case 'CopyBothResponse':
			w.begin(
				code(
					message.type === 'CopyInResponse'
						? 'G'
						: message.type === 'CopyOutResponse'
							? 'H'
							: 'W',
				),
			)
				.int8(message.binary ? 1 : 0)
				.int16(message.columnFormats.length);
			for (const f of message.columnFormats) w.int16(f);
			break;
		case 'DataRow':
			w.begin(code('D')).bytes(message.payload);
			break;
		case 'EmptyQueryResponse':
			w.begin(code('I'));
			break;
		case 'ErrorResponse':
		case 'NoticeResponse':
			w.begin(code(message.type === 'ErrorResponse' ? 'E' : 'N'));
			for (const [k, v] of Object.entries(message.fields)) {
				w.int8(code(k)).cstring(v);
			}
			w.int8(0);
			break;
		case 'NegotiateProtocolVersion':
			w.begin(code('v'))
				.int32(message.minor)
				.int32(message.unrecognized.length);
			for (const o of message.unrecognized) w.cstring(o);
			break;
		case 'NoData':
			w.begin(code('n'));
			break;
		case 'NotificationResponse':
			w.begin(code('A'))
				.int32(message.pid)
				.cstring(message.channel)
				.cstring(message.payload);
			break;
		case 'ParameterDescription':
			w.begin(code('t')).int16(message.typeOids.length);
			for (const oid of message.typeOids) w.int32(oid);
			break;
		case 'ParameterStatus':
			w.begin(code('S')).cstring(message.name).cstring(message.value);
			break;
		case 'ParseComplete':
			w.begin(code('1'));
			break;
		case 'PortalSuspended':
			w.begin(code('s'));
			break;
		case 'ReadyForQuery':
			w.begin(code('Z')).int8(code(message.status));
			break;
		case 'RowDescription':
			w.begin(code('T')).int16(message.fields.length);
			for (const f of message.fields) {
				w.cstring(f.name)
					.int32(f.tableOid)
					.int16(f.columnId)
					.int32(f.typeOid)
					.int16(f.typeSize)
					.int32(f.typeModifier)
					.int16(f.format);
			}
			break;
		case 'FunctionCallResponse':
			w.begin(code('V')).int32(-1);
			break;
	}
	return w.end().take();
}

/** A DataRow body for the given text values. */
export function dataRowPayload(values: readonly (string | null)[]): Uint8Array {
	const w = new Writer(64).int16(values.length);
	for (const v of values) w.value(v);
	return w.take();
}

/** A small deterministic PRNG (mulberry32), so fuzz failures reproduce from the seed. */
export function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
