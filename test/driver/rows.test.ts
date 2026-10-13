import { describe, expect, it } from 'vitest';
import { DecodeError, ProtocolError } from '../../src/driver/errors.js';
import type { Field } from '../../src/driver/protocol/messages.js';
import { Writer } from '../../src/driver/protocol/writer.js';
import { rowDecoder } from '../../src/driver/rows.js';
import { defaultTypes, oids } from '../../src/driver/types.js';

const field = (name: string, typeOid: number, format = 0): Field => ({
	name,
	tableOid: 0,
	columnId: 0,
	typeOid,
	typeSize: 0,
	typeModifier: 0,
	format,
});

/** A DataRow body: strings as UTF-8 text, bytes as they are. */
function payload(values: readonly (string | Uint8Array | null)[]): Uint8Array {
	const w = new Writer(64).int16(values.length);
	for (const v of values) w.value(v);
	return w.take();
}

const int4 = (n: number) => {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setInt32(0, n);
	return b;
};

function decode(
	fields: readonly Field[],
	values: readonly (string | Uint8Array | null)[],
	mode: 'object' | 'array' = 'object',
	types = defaultTypes,
): unknown {
	const body = payload(values);
	// at an offset inside a larger buffer, as rows are read from the socket buffer
	const bytes = new Uint8Array(body.length + 7);
	bytes.set(body, 3);
	return rowDecoder(fields, types, mode)(bytes, 3, 3 + body.length);
}

describe('rowDecoder', () => {
	it('decodes text and binary columns into objects and arrays', () => {
		const fields = [
			field('id', oids.int4, 1),
			field('name', oids.text),
			field('n', oids.int4),
			field('ok', oids.bool),
			field('missing', oids.text),
		];
		const values = [int4(-7), 'zoë', '42', 't', null];
		expect(decode(fields, values)).toEqual({
			id: -7,
			name: 'zoë',
			n: 42,
			ok: true,
			missing: null,
		});
		expect(decode(fields, values, 'array')).toEqual([
			-7,
			'zoë',
			42,
			true,
			null,
		]);
	});

	it('decodes rows wider than one generated function, in column order', () => {
		const fields = Array.from({ length: 37 }, (_, i) =>
			i % 3 === 0
				? field(`c${i}`, oids.int4, 1)
				: field(`c${i}`, i % 3 === 1 ? oids.int4 : oids.text),
		);
		const values = fields.map((_, i) =>
			i % 5 === 4 ? null : i % 3 === 0 ? int4(i) : String(i),
		);
		const expected = Object.fromEntries(
			fields.map((f, i) => [
				f.name,
				i % 5 === 4 ? null : i % 3 === 2 ? String(i) : i,
			]),
		);
		const row = decode(fields, values);
		expect(row).toEqual(expected);
		expect(Object.keys(Object(row))).toEqual(fields.map((f) => f.name));
		expect(decode(fields, values, 'array')).toEqual(Object.values(expected));
	});

	it('takes the last of columns with the same name, NULL included', () => {
		const fields = [
			field('test', oids.int4),
			field('test', oids.int4),
			field('test', oids.int4),
		];
		expect(decode(fields, [null, '10', null])).toEqual({ test: null });
		expect(decode(fields, [null, '10', '12'])).toEqual({ test: 12 });
		expect(decode(fields, [null, '10', '12'], 'array')).toEqual([null, 10, 12]);
	});

	it('defines a __proto__ column as an own property', () => {
		const row = decode(
			[field('__proto__', oids.int4), field('a', oids.int4)],
			['1', '2'],
		);
		expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
		expect(
			Object.getOwnPropertyDescriptor(Object(row), '__proto__')?.value,
		).toBe(1);
		expect(Object.keys(Object(row))).toEqual(['__proto__', 'a']);
		expect(Object.values(Object(row))).toEqual([1, 2]);
	});

	it('copies binary values out of the read buffer', () => {
		const body = payload([new Uint8Array([1, 2, 3])]);
		const value = rowDecoder(
			[field('b', oids.bytea, 1)],
			defaultTypes,
			'array',
		)(body, 0, body.length);
		body.fill(0);
		expect(value).toEqual([new Uint8Array([1, 2, 3])]);
	});

	it('names the column whose value fails to decode', () => {
		const fields = Array.from({ length: 20 }, (_, i) =>
			field(`c${i}`, oids.int4),
		);
		const values = fields.map((_, i) => String(i));
		const types = {
			...defaultTypes,
			[oids.int4]: (t: string) => {
				if (t === '13') throw new RangeError('bad value');
				return Number(t);
			},
		};
		let error: unknown;
		try {
			decode(fields, values, 'object', types);
		} catch (e) {
			error = e;
		}
		if (!(error instanceof DecodeError))
			throw new Error('expected a DecodeError');
		expect(error.column).toBe('c13');
		expect(error.cause).toBeInstanceOf(RangeError);
	});

	it('rejects malformed rows with a protocol error', () => {
		const fields = Array.from({ length: 10 }, (_, i) =>
			field(`c${i}`, oids.int4),
		);
		const decoder = rowDecoder(fields, defaultTypes, 'object');
		const good = payload(fields.map(() => '1'));
		expect(() => decoder(payload(['1']), 0, payload(['1']).length)).toThrow(
			/column count/,
		);
		expect(() => decoder(good, 0, good.length - 3)).toThrow(ProtocolError);
		const bad = good.slice();
		// the 10th value's length, past the end of the row
		new DataView(bad.buffer).setInt32(bad.length - 5, 1000);
		expect(() => decoder(bad, 0, bad.length)).toThrow(/Invalid value length/);
	});
});
