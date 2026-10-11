import { describe, expect, it } from 'vitest';
import { serialize } from 'pg-protocol';
import { Parser } from 'pg-protocol/dist/parser.js';
import * as fe from '../../src/driver/protocol/frontend.js';
import { Writer } from '../../src/driver/protocol/writer.js';
import { Reader, textValues } from '../../src/driver/protocol/reader.js';
import type { BackendMessage } from '../../src/driver/protocol/messages.js';
import { ProtocolError } from '../../src/driver/errors.js';
import {
	concat,
	dataRowPayload,
	encodeBackend,
	prng,
} from './helpers/backend.js';

const bytes = (b: Uint8Array) => Buffer.from(b).toString('hex');
const one = (build: (w: Writer) => Writer) => build(new Writer(8)).take();

function readAll(reader: Reader): BackendMessage[] {
	const out: BackendMessage[] = [];
	for (let m = reader.next(); m !== undefined; m = reader.next()) out.push(m);
	return out;
}

/** Feeds `stream` to a reader in random-sized chunks and collects the messages. */
function readChunked(stream: Uint8Array, rand: () => number): BackendMessage[] {
	const reader = new Reader();
	const out: BackendMessage[] = [];
	let at = 0;
	while (at < stream.length) {
		const size = Math.max(1, Math.floor(rand() * rand() * 64));
		reader.push(stream.subarray(at, at + size));
		at += size;
		out.push(...readAll(reader));
	}
	expect(reader.buffered).toBe(0);
	return out;
}

const randomString = (rand: () => number, max = 20) =>
	Array.from({ length: Math.floor(rand() * max) }, () => {
		const r = rand();
		// mostly ASCII, some multi-byte characters
		return r < 0.8
			? String.fromCharCode(32 + Math.floor(rand() * 95))
			: r < 0.95
				? 'é'
				: '😀';
	}).join('');

function randomMessage(rand: () => number): BackendMessage {
	const pick = Math.floor(rand() * 16);
	const str = () => randomString(rand);
	switch (pick) {
		case 0:
			return {
				type: 'DataRow',
				payload: dataRowPayload(
					Array.from({ length: Math.floor(rand() * 6) }, () =>
						rand() < 0.2 ? null : randomString(rand, 60),
					),
				),
			};
		case 1:
			return {
				type: 'RowDescription',
				fields: Array.from({ length: Math.floor(rand() * 4) }, () => ({
					name: str(),
					tableOid: Math.floor(rand() * 2 ** 32),
					columnId: Math.floor(rand() * 100),
					typeOid: Math.floor(rand() * 2 ** 32),
					typeSize: -1,
					typeModifier: -1,
					format: 0,
				})),
			};
		case 2:
			return {
				type: 'CommandComplete',
				tag: `SELECT ${Math.floor(rand() * 1e6)}`,
			};
		case 3:
			return { type: 'ReadyForQuery', status: rand() < 0.5 ? 'I' : 'T' };
		case 4:
			return {
				type: 'ErrorResponse',
				fields: {
					S: 'ERROR',
					V: 'ERROR',
					C: '23505',
					M: str(),
					D: str(),
					n: str(),
				},
			};
		case 5:
			return { type: 'NoticeResponse', fields: { S: 'NOTICE', M: str() } };
		case 6:
			return { type: 'ParameterStatus', name: str(), value: str() };
		case 7:
			return {
				type: 'BackendKeyData',
				pid: Math.floor(rand() * 1e6),
				key: new Uint8Array(4 + Math.floor(rand() * 28)).map(
					() => rand() * 256,
				),
			};
		case 8:
			return {
				type: 'NotificationResponse',
				pid: 42,
				channel: str(),
				payload: str(),
			};
		case 9:
			return {
				type: 'ParameterDescription',
				typeOids: Array.from({ length: Math.floor(rand() * 5) }, () => 25),
			};
		case 10:
			return {
				type: 'CopyData',
				data: new Uint8Array(Math.floor(rand() * 100)).fill(7),
			};
		case 11:
			return { type: 'CopyOutResponse', binary: false, columnFormats: [0, 0] };
		case 12:
			return {
				type: 'AuthenticationSASL',
				mechanisms: ['SCRAM-SHA-256-PLUS', 'SCRAM-SHA-256'],
			};
		case 13:
			return {
				type: 'NegotiateProtocolVersion',
				minor: 0,
				unrecognized: [str()],
			};
		case 14:
			return {
				type: 'AuthenticationMD5Password',
				salt: new Uint8Array([1, 2, 3, 4]),
			};
		default:
			return { type: 'BindComplete' };
	}
}

describe('Writer and frontend messages', () => {
	it('matches pg-protocol byte for byte', () => {
		const cases: [Uint8Array, Uint8Array][] = [
			[
				one((w) => fe.query(w, 'select 1; select é')),
				serialize.query('select 1; select é'),
			],
			[
				one((w) => fe.parse(w, 's1', 'select $1::int', [23])),
				serialize.parse({ name: 's1', text: 'select $1::int', types: [23] }),
			],
			[
				one((w) => fe.describe(w, 'S', 's1')),
				serialize.describe({ type: 'S', name: 's1' }),
			],
			[
				one((w) => fe.describe(w, 'P', '')),
				serialize.describe({ type: 'P', name: '' }),
			],
			[
				one((w) => fe.execute(w, 'p', 100)),
				serialize.execute({ portal: 'p', rows: 100 }),
			],
			[
				one((w) => fe.close(w, 'S', 's1')),
				serialize.close({ type: 'S', name: 's1' }),
			],
			[one((w) => fe.sync(w)), serialize.sync()],
			[one((w) => fe.flush(w)), serialize.flush()],
			[one((w) => fe.password(w, 'pässword')), serialize.password('pässword')],
			[
				one((w) => fe.copyData(w, 'a\tb\n')),
				serialize.copyData(Buffer.from('a\tb\n')),
			],
			[one((w) => fe.copyDone(w)), serialize.copyDone()],
			[one((w) => fe.copyFail(w, 'nope')), serialize.copyFail('nope')],
			[fe.sslRequest(), serialize.requestSsl()],
			[
				fe.cancelRequest(1234, new Uint8Array([1, 2, 3, 4])),
				serialize.cancel(
					1234,
					new DataView(new Uint8Array([1, 2, 3, 4]).buffer).getInt32(0),
				),
			],
			[
				one((w) =>
					fe.startup(w, fe.PROTOCOL_3_0, {
						user: 'u',
						database: 'd',
						client_encoding: 'UTF8',
					}),
				),
				serialize.startup({ user: 'u', database: 'd' }),
			],
		];
		for (const [ours, theirs] of cases) expect(bytes(ours)).toBe(bytes(theirs));
	});

	it('writes bind values in text, binary and NULL', () => {
		const out = one((w) =>
			fe.bind(w, 'p', 's', ['abc', null, new Uint8Array([9, 8]), ''], 0),
		);
		const view = new DataView(out.buffer);
		expect(String.fromCharCode(out[0]!)).toBe('B');
		expect(view.getInt32(1)).toBe(out.length - 1);
		// portal "p\0", statement "s\0", then 4 format codes: 0,0,1,0
		let at = 5 + 4;
		expect(view.getInt16(at)).toBe(4);
		expect([0, 1, 2, 3].map((i) => view.getInt16(at + 2 + i * 2))).toEqual([
			0, 0, 1, 0,
		]);
		at += 2 + 8;
		expect(view.getInt16(at)).toBe(4);
		at += 2;
		expect(view.getInt32(at)).toBe(3);
		expect(Buffer.from(out.subarray(at + 4, at + 7)).toString()).toBe('abc');
		at += 7;
		expect(view.getInt32(at)).toBe(-1);
		at += 4;
		expect(view.getInt32(at)).toBe(2);
		at += 6;
		expect(view.getInt32(at)).toBe(0);
		at += 4;
		expect(view.getInt16(at)).toBe(0); // all results in text
		expect(at + 2).toBe(out.length);
	});

	it('writes multi-byte strings with the right lengths, growing its buffer', () => {
		const big = 'é😀'.repeat(5000);
		const out = one((w) => fe.bind(w, '', '', [big]));
		const view = new DataView(out.buffer);
		const len = view.getInt32(5 + 2 + 2 + 2);
		expect(len).toBe(Buffer.byteLength(big));
		expect(Buffer.from(out.subarray(15, 15 + len)).toString()).toBe(big);
	});

	it('rejects NUL in protocol strings', () => {
		expect(() => one((w) => fe.query(w, 'select 1\0'))).toThrow(/NUL/);
	});

	it('writes a 3.2 cancel request with a long key', () => {
		const key = new Uint8Array(32).map((_, i) => i);
		const out = fe.cancelRequest(77, key);
		const view = new DataView(out.buffer);
		expect(view.getInt32(0)).toBe(12 + 32);
		expect(view.getInt32(4)).toBe(80877102);
		expect(view.getInt32(8)).toBe(77);
		expect([...out.subarray(12)]).toEqual([...key]);
	});
});

describe('Reader', () => {
	it('round-trips every message type across random chunk boundaries', () => {
		for (let seed = 1; seed <= 200; seed++) {
			const rand = prng(seed);
			const messages = Array.from({ length: 1 + Math.floor(rand() * 30) }, () =>
				randomMessage(rand),
			);
			const stream = concat(messages.map(encodeBackend));
			expect(readChunked(stream, rand), `seed ${seed}`).toEqual(messages);
		}
	});

	it('agrees with pg-protocol on random streams', () => {
		for (let seed = 1; seed <= 50; seed++) {
			const rand = prng(seed);
			const messages = Array.from({ length: 20 }, () =>
				randomMessage(rand),
			).filter(
				(m) =>
					m.type === 'DataRow' ||
					m.type === 'RowDescription' ||
					m.type === 'ErrorResponse' ||
					m.type === 'CommandComplete' ||
					m.type === 'NotificationResponse' ||
					m.type === 'ParameterStatus',
			);
			const stream = concat(messages.map(encodeBackend));
			const theirs: any[] = [];
			new Parser().parse(Buffer.from(stream), (m: any) => theirs.push(m));
			const ours = readChunked(stream, rand);
			expect(ours.length).toBe(theirs.length);
			ours.forEach((m, i) => {
				const t = theirs[i];
				if (m.type === 'DataRow')
					expect(textValues(m.payload)).toEqual(t.fields);
				if (m.type === 'RowDescription')
					expect(m.fields.map((f) => [f.name, f.tableOid, f.typeOid])).toEqual(
						t.fields.map((f: any) => [f.name, f.tableID, f.dataTypeID]),
					);
				if (m.type === 'ErrorResponse') {
					expect(m.fields['M']).toBe(t.message);
					expect(m.fields['D']).toBe(t.detail);
					expect(m.fields['n']).toBe(t.constraint);
				}
				if (m.type === 'CommandComplete') expect(m.tag).toBe(t.text);
				if (m.type === 'NotificationResponse')
					expect([m.channel, m.payload]).toEqual([t.channel, t.payload]);
				if (m.type === 'ParameterStatus')
					expect([m.name, m.value]).toEqual([
						t.parameterName,
						t.parameterValue,
					]);
			});
		}
	});

	it('collects a large message from many small chunks', () => {
		const value = 'x'.repeat(3_000_000);
		const stream = encodeBackend({
			type: 'DataRow',
			payload: dataRowPayload([value, null]),
		});
		const reader = new Reader();
		for (let at = 0; at < stream.length; at += 1000) {
			reader.push(stream.subarray(at, at + 1000));
			if (at + 1000 < stream.length) expect(reader.next()).toBeUndefined();
		}
		const message = reader.next();
		expect(message?.type).toBe('DataRow');
		if (message?.type === 'DataRow')
			expect(textValues(message.payload)).toEqual([value, null]);
	});

	it('rejects invalid lengths, unknown types and oversized messages', () => {
		const reader = new Reader(1024);
		reader.push(new Uint8Array([0x5a, 0, 0, 0, 2]));
		expect(() => reader.next()).toThrow(ProtocolError);
		const r2 = new Reader();
		r2.push(new Uint8Array([0x01, 0, 0, 0, 4]));
		expect(() => r2.next()).toThrow(/Unknown message type 0x01/);
		const r3 = new Reader(1024);
		r3.push(new Uint8Array([0x44, 0, 0, 0x10, 0]));
		expect(() => r3.next()).toThrow(/Invalid length/);
	});

	it('rejects malformed DataRows', () => {
		expect(() => textValues(new Uint8Array([0, 1, 0, 0, 0, 9, 1]))).toThrow(
			ProtocolError,
		);
		expect(() => textValues(new Uint8Array([0xff, 0xff]))).toThrow(
			ProtocolError,
		);
		expect(() =>
			textValues(new Uint8Array([0, 1, 0xff, 0xff, 0xff, 0xfe])),
		).toThrow(ProtocolError);
	});
});

/** Parses everything; returns normally or throws ProtocolError, never anything else. */
function parseOrProtocolError(stream: Uint8Array, rand: () => number) {
	const reader = new Reader(1 << 20);
	try {
		let at = 0;
		while (at < stream.length) {
			const size = 1 + Math.floor(rand() * 40);
			reader.push(stream.subarray(at, at + size));
			at += size;
			for (let m = reader.next(); m !== undefined; m = reader.next()) {
				if (m.type === 'DataRow') textValues(m.payload);
			}
		}
	} catch (error) {
		if (!(error instanceof ProtocolError)) throw error;
	}
}

describe('Reader fuzzing', () => {
	it('survives random bytes', () => {
		for (let seed = 1; seed <= 300; seed++) {
			const rand = prng(seed);
			const stream = new Uint8Array(Math.floor(rand() * 2000)).map(
				() => rand() * 256,
			);
			parseOrProtocolError(stream, rand);
		}
	});

	it('survives mutated valid streams', () => {
		for (let seed = 1; seed <= 500; seed++) {
			const rand = prng(seed);
			const messages = Array.from({ length: 10 }, () => randomMessage(rand));
			const stream = concat(messages.map(encodeBackend));
			for (let i = 0; i < 1 + rand() * 8; i++) {
				const at = Math.floor(rand() * stream.length);
				stream[at] =
					rand() < 0.5
						? Math.floor(rand() * 256)
						: stream[at]! ^ (1 << (rand() * 8));
			}
			parseOrProtocolError(stream, rand);
		}
	});

	it('survives truncated message bodies with consistent lengths', () => {
		for (let seed = 1; seed <= 300; seed++) {
			const rand = prng(seed);
			const encoded = encodeBackend(randomMessage(rand));
			const cut = 5 + Math.floor(rand() * Math.max(0, encoded.length - 5));
			const body = encoded.slice(0, cut);
			new DataView(body.buffer).setInt32(1, cut - 1);
			parseOrProtocolError(body, rand);
		}
	});
});
