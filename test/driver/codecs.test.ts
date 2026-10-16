import { describe, expect, it } from 'vitest';
import {
	arrayOf,
	defineCodec,
	typed,
	TypedValue,
	type Codec,
} from '../../src/driver/codec.js';
import { codecs, defaultCodecs } from '../../src/driver/codecs.js';
import { encodeParams, paramOids } from '../../src/driver/params.js';
import {
	createCodecRegistry,
	defaultRegistry,
	TypeCatalog,
	type CatalogType,
} from '../../src/driver/registry.js';
import { numberText, parseArray } from '../../src/driver/types.js';
import { prng } from './helpers/backend.js';

const catalogRow = (
	row: Partial<CatalogType> & { oid: number; name: string },
): CatalogType => ({
	schema: 'public',
	elem: 0,
	array: 0,
	base: 0,
	delim: ',',
	visible: true,
	...row,
});

/** The formats an array of `codec` is sent and read in. */
const formats = (codec: Codec) => {
	const array = arrayOf(codec);
	return [array.paramFormat, array.resultFormat];
};

/** Encodes a value the codec's type doesn't allow. */
const encodeAny = (codec: Codec, value: unknown) => codec.encode(value);

/** numeric's binary format, decoded. */
const numeric = (
	ndigits: number,
	weight: number,
	sign: number,
	dscale: number,
	...digits: number[]
) => {
	const b = new Uint8Array(8 + digits.length * 2);
	const v = new DataView(b.buffer);
	v.setInt16(0, ndigits);
	v.setInt16(2, weight);
	v.setUint16(4, sign);
	v.setUint16(6, dscale);
	digits.forEach((d, i) => v.setInt16(8 + i * 2, d));
	return codecs.numeric.decodeBinary?.(b, 0, b.length);
};

describe('arrayOf', () => {
	it('is the same codec for the same element, typed by it', () => {
		expect(arrayOf(codecs.int4)).toBe(arrayOf(codecs.int4));
		expect(arrayOf(codecs.int4)).toMatchObject({
			name: 'int4[]',
			oid: 1007,
			element: codecs.int4,
			paramFormat: 'binary',
			resultFormat: 'binary',
		});
		expect(arrayOf(codecs.box).delimiter).toBe(';');
		expect(() => arrayOf(arrayOf(codecs.int4))).toThrow(/arrays of arrays/);
	});

	it('reads arrays in binary where it pays, and sends them in binary where the driver has an encoder', () => {
		expect(formats(codecs.text)).toEqual(['text', 'binary']);
		expect(formats(codecs.jsonb)).toEqual(['binary', 'binary']);
		expect(formats(codecs.uuid)).toEqual(['binary', 'text']);
		expect(formats(codecs.int8AsString)).toEqual(['binary', 'text']);
		expect(formats(codecs.numeric)).toEqual(['text', 'text']);
		expect(formats(codecs.float4)).toEqual(['text', 'text']);
		expect(arrayOf(codecs.text).inferParamType).toBe(true);
	});

	it('writes literals that read back as written, quoting only what needs it', () => {
		const texts = arrayOf(codecs.text);
		expect(
			texts.encode([
				'a',
				'b c',
				'',
				'NULL',
				'null',
				null,
				'q"x',
				'b\\s',
				'{',
				',',
			]),
		).toBe('{a,"b c","","NULL","null",NULL,"q\\"x","b\\\\s","{",","}');
		const rand = prng(3);
		const chars = [
			'a',
			',',
			'"',
			'\\',
			'{',
			'}',
			' ',
			'NULL',
			'é',
			'😀',
			'\n',
			'',
		];
		for (let n = 0; n < 300; n++) {
			const value = Array.from({ length: Math.floor(rand() * 5) }, () =>
				rand() < 0.1
					? null
					: Array.from(
							{ length: Math.floor(rand() * 4) },
							() => chars[Math.floor(rand() * chars.length)],
						).join(''),
			);
			const encoded = texts.encode(value);
			expect(typeof encoded).toBe('string');
			expect(texts.decodeText(String(encoded))).toEqual(value);
			expect(parseArray(String(encoded))).toEqual(value);
		}
	});

	it('falls back to a literal when an element doesn’t fit the binary encoder', () => {
		expect(arrayOf(codecs.int4).encode([1, 2])).toBeInstanceOf(Uint8Array);
		expect(arrayOf(codecs.int4).encode([1.5])).toBe('{1.5}');
		expect(encodeAny(arrayOf(codecs.int4), [[1, 2], [3]])).toBe('{{1,2},{3}}');
		expect(encodeAny(arrayOf(codecs.int4), '{1,2}')).toBe('{1,2}');
		expect(encodeAny(arrayOf(codecs.timestamptz), ['2024-01-01'])).toBe(
			'{2024-01-01}',
		);
	});

	it('encodes json elements as values, never as dimensions', () => {
		const docs = arrayOf(codecs.json);
		expect(docs.encode(['a', [1, 2], null])).toBe('{"\\"a\\"","[1,2]",NULL}');
		expect(docs.decodeText('{"\\"a\\"","[1,2]",NULL}')).toEqual([
			'a',
			[1, 2],
			null,
		]);
		expect(arrayOf(codecs.vector).encode([[1, 2], [3]])).toBe('{"[1,2]",[3]}');
		const bytes = arrayOf(codecs.jsonb).encode(['a']);
		if (!(bytes instanceof Uint8Array)) throw new Error('expected bytes');
		// the element is the JSON text of the string, after jsonb's version byte
		expect(Buffer.from(bytes).subarray(-3).toString()).toBe('"a"');
	});
});

describe('built-in codecs', () => {
	it('encode numbers without an exponent where Postgres would reject one', () => {
		expect(numberText(1e21)).toBe('1000000000000000000000');
		expect(numberText(-1e21)).toBe('-1000000000000000000000');
		expect(numberText(1.5e300)).toBe(BigInt(1.5e300).toString());
		expect(numberText(1.5e-300)).toBe('1.5e-300');
		expect(numberText(1e-7)).toBe('1e-7');
		expect(codecs.int8.encode(1e21)).toBe('1000000000000000000000');
		expect(codecs.numeric.encode(2n ** 70n)).toBe('1180591620717411303424');
	});

	it('refuse values they can’t send', () => {
		expect(() => encodeAny(codecs.int4, {})).toThrow(/Cannot send/);
		expect(() => encodeAny(codecs.bytea, 1)).toThrow(/bytea/);
		expect(() => encodeAny(codecs.vector, {})).toThrow(/vector/);
		expect(() => encodeAny(codecs.daterange, 5)).toThrow(/range/);
		expect(() => encodeAny(codecs.jsonb, () => 1)).toThrow(/json/);
	});

	it('write range bounds as timestamps Postgres reads, past 9999 and BC', () => {
		expect(
			codecs.tstzrange.encode({
				empty: false,
				lower: new Date(Date.UTC(-1, 0, 1)),
				upper: new Date(Date.UTC(10000, 0, 1)),
				bounds: '[)',
			}),
		).toBe('["0002-01-01 00:00:00.000+00 BC","10000-01-01 00:00:00.000+00")');
	});

	it('decode binary numeric and uuid exactly as their text', () => {
		expect(numeric(3, 1, 0, 4, 1, 2345, 6700)).toBe('12345.6700');
		expect(numeric(1, -1, 0x4000, 4, 12)).toBe('-0.0012');
		expect(numeric(1, -2, 0, 8, 1200)).toBe('0.00001200');
		expect(numeric(0, 0, 0, 0)).toBe('0');
		expect(numeric(1, 5, 0, 0, 1)).toBe('100000000000000000000');
		expect(numeric(0, 0, 0xc000, 0)).toBe('NaN');
		expect(numeric(0, 0, 0xf000, 0)).toBe('-Infinity');
		const id = Uint8Array.from(
			Buffer.from('a0eebc999c0b4ef8bb6d6bb9bd380a11', 'hex'),
		);
		expect(codecs.uuid.decodeBinary?.(id, 0, 16)).toBe(
			'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
		);
	});
});

describe('defineCodec and typed', () => {
	it('fills in a codec for a type looked up by name', () => {
		const point = defineCodec({
			name: 'geo_point',
			encode: (value: { x: number; y: number }) => `(${value.x},${value.y})`,
			decodeText: (text) => text,
		});
		expect(point).toMatchObject({
			name: 'geo_point',
			oid: 0,
			paramFormat: 'text',
			resultFormat: 'text',
		});
		expect(point.encode({ x: 1, y: 2 })).toBe('(1,2)');
		expect(Object.isFrozen(point)).toBe(true);
		expect(
			defineCodec({
				name: 'x',
				encode: String,
				decodeText: Number,
				decodeBinary: () => 1,
			}).resultFormat,
		).toBe('binary');
	});

	it('pairs a parameter with its codec, encoded once and declared', () => {
		const value = typed(5, codecs.int4);
		expect(value).toBeInstanceOf(TypedValue);
		const params = [
			value,
			typed('x', codecs.text),
			'plain',
			typed(null, codecs.int8),
		];
		expect(encodeParams('', params, undefined, undefined)).toEqual([
			'5',
			'x',
			'plain',
			null,
		]);
		expect(paramOids(params, undefined, undefined, new TypeCatalog())).toEqual([
			23, 0, 0, 20,
		]);
		expect(paramOids(['a'], undefined, undefined, new TypeCatalog())).toEqual(
			[],
		);
		expect(() =>
			encodeParams('', [typed(undefined, codecs.int4)], undefined, undefined),
		).toThrow(/undefined/);
	});
});

describe('the codec registry', () => {
	const catalog = new TypeCatalog();

	it('decodes as the driver always has by default', () => {
		const codec = (oid: number) => defaultRegistry.codecFor(oid, catalog);
		expect(codec(20)).toBe(codecs.int8);
		expect(codec(1016)).toBe(arrayOf(codecs.int8));
		expect(codec(1184)).toBeUndefined();
		expect(codec(1185)?.decodeText('{"2024-01-01 00:00:00+00"}')).toEqual([
			'2024-01-01 00:00:00+00',
		]);
		expect(codec(1700)).toBeUndefined();
		expect(codec(1231)?.decodeText('{1.5}')).toEqual(['1.5']);
		expect(defaultCodecs).toContain(codecs.jsonb);
	});

	it('overrides codecs and their arrays, keeping an array the same list gives', () => {
		const own = defineCodec({
			name: 'int8',
			oid: 20,
			arrayOid: 1016,
			encode: String,
			decodeText: Number,
		});
		const registry = createCodecRegistry([
			codecs.int8AsString,
			codecs.timestamptz,
		]);
		expect(registry.codecFor(20, catalog)).toBe(codecs.int8AsString);
		expect(registry.codecFor(1016, catalog)).toBe(arrayOf(codecs.int8AsString));
		expect(registry.codecFor(1185, catalog)).toBe(arrayOf(codecs.timestamptz));
		expect(registry.codecFor(23, catalog)).toBe(codecs.int4);
		const explicit = arrayOf(codecs.int8);
		const mixed = createCodecRegistry([own, explicit]);
		expect(mixed.codecFor(20, catalog)).toBe(own);
		expect(mixed.codecFor(1016, catalog)).toBe(explicit);
	});

	it('finds types looked up by name, their arrays, and domains, through the catalog', () => {
		const mood = defineCodec({
			name: 'Mood',
			encode: String,
			decodeText: (t) => `:${t}`,
		});
		const registry = createCodecRegistry([mood]);
		expect(registry.needsCatalog).toBe(true);
		const types = new TypeCatalog();
		expect(types.unresolved(mood)).toBe(true);
		expect(types.oidOf(mood)).toBe(0);
		expect(registry.codecFor(70000, types)).toBeUndefined();
		types.setTypes([
			catalogRow({ oid: 70000, name: 'mood', array: 70001 }),
			catalogRow({ oid: 70001, name: '_mood', elem: 70000 }),
			catalogRow({
				oid: 70002,
				name: 'feeling',
				schema: 'other',
				visible: false,
				array: 70003,
			}),
			catalogRow({
				oid: 70003,
				name: '_feeling',
				schema: 'other',
				visible: false,
				elem: 70002,
			}),
			catalogRow({ oid: 70004, name: 'posint', base: 23 }),
			catalogRow({ oid: 70005, name: 'Mixed Case' }),
		]);
		expect(types.unresolved(mood)).toBe(false);
		expect(types.oidOf(mood)).toBe(70000);
		expect(types.oidOf(arrayOf(mood))).toBe(70001);
		expect(registry.codecFor(70000, types)?.decodeText('happy')).toBe(':happy');
		expect(registry.codecFor(70001, types)?.decodeText('{happy}')).toEqual([
			':happy',
		]);
		// an array of a type nothing decodes is still an array, of its text
		expect(registry.codecFor(70003, types)?.decodeText('{a,b}')).toEqual([
			'a',
			'b',
		]);
		const named = (name: string) =>
			types.oidOf(defineCodec({ name, encode: String, decodeText: String }));
		expect(named('other.feeling')).toBe(70002);
		expect(named('feeling')).toBe(0);
		expect(named('"Mixed Case"')).toBe(70005);
		expect(named('public.MOOD')).toBe(70000);
		const posint = defineCodec({
			name: 'posint',
			encode: String,
			decodeText: Number,
		});
		expect(types.oidOf(posint)).toBe(70004);
		expect(types.resultOidOf(posint)).toBe(23);
	});

	it('builds on nothing with a null base, or takes a registry as a pool option', () => {
		const empty = createCodecRegistry([], null);
		expect(empty.codecFor(23, catalog)).toBeUndefined();
		const only = createCodecRegistry([codecs.int4], null);
		expect(only.codecFor(23, catalog)).toBe(codecs.int4);
		expect(only.codecFor(1007, catalog)).toBe(arrayOf(codecs.int4));
		expect(only.codecFor(16, catalog)).toBeUndefined();
	});
});
