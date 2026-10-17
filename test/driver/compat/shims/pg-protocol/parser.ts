// pg-protocol's Parser over quarry's Reader: framing and decoding are
// quarry's; this only renames what it decoded into pg-protocol's message
// shapes, so pg-protocol's inbound-parser tests can check the result.
import { Buffer } from 'node:buffer';
import { Reader } from '../../../../../src/driver/protocol/reader.js';
import type { BackendMessage } from '../../../../../src/driver/protocol/messages.js';

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

function noticeOrError(
	name: string,
	length: number,
	fields: Readonly<Record<string, string>>,
) {
	const message: any =
		name === 'error'
			? Object.assign(new Error(fields['M'] ?? ''), { name, length })
			: { name, length, message: fields['M'] };
	const map: Record<string, string> = {
		S: 'severity',
		V: 'severity',
		C: 'code',
		D: 'detail',
		H: 'hint',
		P: 'position',
		p: 'internalPosition',
		q: 'internalQuery',
		W: 'where',
		s: 'schema',
		t: 'table',
		c: 'column',
		d: 'dataType',
		n: 'constraint',
		F: 'file',
		L: 'line',
		R: 'routine',
	};
	for (const [code, key] of Object.entries(map)) {
		if (code === 'V' && fields['S'] !== undefined) continue;
		message[key] = fields[code];
	}
	return message;
}

/** The DataRow body's values, as pg-protocol gives them: strings, or null. */
function dataRowFields(payload: Uint8Array): (string | null)[] {
	const view = new DataView(
		payload.buffer,
		payload.byteOffset,
		payload.byteLength,
	);
	const count = view.getInt16(0);
	const out: (string | null)[] = [];
	let pos = 2;
	for (let i = 0; i < count; i++) {
		const length = view.getInt32(pos);
		pos += 4;
		if (length === -1) {
			out.push(null);
		} else {
			out.push(text(payload.subarray(pos, pos + length)));
			pos += length;
		}
	}
	return out;
}

export function convert(msg: BackendMessage, length: number): any {
	switch (msg.type) {
		case 'AuthenticationOk':
			return { name: 'authenticationOk', length };
		case 'AuthenticationCleartextPassword':
			return { name: 'authenticationCleartextPassword', length };
		case 'AuthenticationMD5Password':
			return {
				name: 'authenticationMD5Password',
				length,
				salt: Buffer.from(msg.salt),
			};
		case 'AuthenticationSASL':
			return {
				name: 'authenticationSASL',
				length,
				mechanisms: [...msg.mechanisms],
			};
		case 'AuthenticationSASLContinue':
			return {
				name: 'authenticationSASLContinue',
				length,
				data: text(msg.data),
			};
		case 'AuthenticationSASLFinal':
			return { name: 'authenticationSASLFinal', length, data: text(msg.data) };
		case 'BackendKeyData': {
			const key = msg.key;
			const secretKey =
				key.length === 4
					? new DataView(key.buffer, key.byteOffset, 4).getInt32(0)
					: Buffer.from(key);
			return { name: 'backendKeyData', length, processID: msg.pid, secretKey };
		}
		case 'ParameterStatus':
			return {
				name: 'parameterStatus',
				length,
				parameterName: msg.name,
				parameterValue: msg.value,
			};
		case 'ReadyForQuery':
			return { name: 'readyForQuery', length, status: msg.status };
		case 'CommandComplete':
			return { name: 'commandComplete', length, text: msg.tag };
		case 'NotificationResponse':
			return {
				name: 'notification',
				length,
				processId: msg.pid,
				channel: msg.channel,
				payload: msg.payload,
			};
		case 'EmptyQueryResponse':
			return { name: 'emptyQuery', length };
		case 'NoData':
			return { name: 'noData', length };
		case 'ParseComplete':
			return { name: 'parseComplete', length };
		case 'BindComplete':
			return { name: 'bindComplete', length };
		case 'CloseComplete':
			return { name: 'closeComplete', length };
		case 'PortalSuspended':
			return { name: 'portalSuspended', length };
		case 'CopyDone':
			return { name: 'copyDone', length };
		case 'CopyData':
			return { name: 'copyData', length, chunk: Buffer.from(msg.data) };
		case 'CopyInResponse':
		case 'CopyOutResponse':
			return {
				name:
					msg.type === 'CopyInResponse' ? 'copyInResponse' : 'copyOutResponse',
				length,
				binary: msg.binary,
				columnTypes: [...msg.columnFormats],
			};
		case 'RowDescription':
			return {
				name: 'rowDescription',
				length,
				fieldCount: msg.fields.length,
				fields: msg.fields.map((f) => ({
					name: f.name,
					tableID: f.tableOid,
					columnID: f.columnId,
					dataTypeID: f.typeOid,
					dataTypeSize: f.typeSize,
					dataTypeModifier: f.typeModifier,
					format: f.format === 0 ? 'text' : 'binary',
				})),
			};
		case 'ParameterDescription':
			return {
				name: 'parameterDescription',
				length,
				parameterCount: msg.typeOids.length,
				dataTypeIDs: [...msg.typeOids],
			};
		case 'DataRow': {
			const fields = dataRowFields(msg.payload);
			return { name: 'dataRow', length, fieldCount: fields.length, fields };
		}
		case 'ErrorResponse':
			return noticeOrError('error', length, msg.fields);
		case 'NoticeResponse':
			return noticeOrError('notice', length, msg.fields);
		default:
			return { name: msg.type, length };
	}
}

export class Parser {
	readonly #reader = new Reader();

	parse(buffer: Buffer, callback: (message: any) => void): void {
		const reader = this.#reader;
		reader.push(buffer);
		for (let type = reader.nextType(); type >= 0; type = reader.nextType()) {
			const length = reader.end - reader.start + 4;
			let message: any;
			try {
				message = convert(reader.parse(), length);
			} catch (error) {
				// pg-protocol reports what it can't parse as an error message
				message = Object.assign(
					new Error(`received invalid response: ${(error as Error).message}`),
					{
						name: 'error',
						length,
					},
				);
			}
			callback(message);
		}
	}
}
