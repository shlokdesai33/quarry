import { describe, expect, it } from 'vitest';
import {
	catalogTypes,
	parseRange,
	parseTimestamptz,
} from '../../src/driver/parsers.js';
import { initialTypes, quarryTypes } from '../../src/decode.js';
import {
	DriverError,
	UndefinedParameterError,
} from '../../src/driver/errors.js';
import { parseTag } from '../../src/driver/ops.js';
import {
	arrayLiteral,
	copyLine,
	defaultTypes,
	encodeParam,
	encodeParams,
	formatTimestamp,
	oids,
	parseArray,
	parseBytea,
} from '../../src/driver/types.js';
import { prng } from './helpers/backend.js';

describe('parseArray and arrayLiteral', () => {
	it('parses Postgres array output', () => {
		expect(parseArray('{}')).toEqual([]);
		expect(parseArray('{a,b,NULL,"NULL",""}')).toEqual([
			'a',
			'b',
			null,
			'NULL',
			'',
		]);
		expect(parseArray('{"a,b","c\\"d","e\\\\f"," g "}')).toEqual([
			'a,b',
			'c"d',
			'e\\f',
			' g ',
		]);
		expect(parseArray('{{1,2},{3,NULL}}', Number)).toEqual([
			[1, 2],
			[3, null],
		]);
		expect(parseArray('[1:2]={7,8}', Number)).toEqual([7, 8]);
		expect(parseArray('{(0,0),(1,1);(2,2),(3,3)}', undefined, ';')).toEqual([
			'(0,0),(1,1)',
			'(2,2),(3,3)',
		]);
	});

	it('rejects malformed output instead of looping', () => {
		for (const bad of ['{', '{a', '{"a', 'a}', '{a}b', '{{a}', '[1:2]{a}']) {
			expect(() => parseArray(bad), bad).toThrow();
		}
	});

	it('round-trips random nested string arrays', () => {
		const rand = prng(11);
		const element = () => {
			const r = rand();
			if (r < 0.1) return null;
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
			return Array.from(
				{ length: Math.floor(rand() * 6) },
				() => chars[Math.floor(rand() * chars.length)],
			).join('');
		};
		for (let n = 0; n < 500; n++) {
			const depth = 1 + Math.floor(rand() * 3);
			const build = (d: number): unknown[] =>
				Array.from({ length: Math.floor(rand() * 4) + (d > 1 ? 1 : 0) }, () =>
					d > 1 ? build(d - 1) : element(),
				);
			const value = build(depth);
			expect(parseArray(arrayLiteral(value))).toEqual(value);
		}
	});
});

describe('parameters', () => {
	it('encodes JavaScript values as Postgres input', () => {
		expect(encodeParam(null)).toBeNull();
		expect(() => encodeParam(undefined)).toThrow(/undefined.*pass null/);
		expect(() => encodeParam([1, [undefined]])).toThrow(/undefined/);
		expect(encodeParam('x')).toBe('x');
		expect(encodeParam(1.5)).toBe('1.5');
		expect(encodeParam(Number.NaN)).toBe('NaN');
		expect(encodeParam(12n)).toBe('12');
		expect(encodeParam(true)).toBe('t');
		expect(encodeParam({ a: 1 })).toBe('{"a":1}');
		expect(encodeParam([1, null, 'a"b', [true]])).toBe(
			'{"1",NULL,"a\\"b",{"t"}}',
		);
		expect(encodeParam([new Uint8Array([1, 255])])).toBe('{"\\\\x01ff"}');
		expect(encodeParam(new Uint16Array([1]))).toEqual(new Uint8Array([1, 0]));
		expect(() => encodeParam(() => 1)).toThrow(/function/);
	});

	it('refuses undefined parameters and array elements, naming the position', () => {
		const sql = 'select $1::int, $2::text[]';
		expect(encodeParams(sql, [1, ['a', null]])).toEqual(['1', '{"a",NULL}']);
		const error = (params: unknown[]) => {
			try {
				encodeParams(sql, params);
			} catch (e) {
				if (e instanceof UndefinedParameterError) return e;
				throw e;
			}
			throw new Error('expected UndefinedParameterError');
		};
		const top = error([1, undefined]);
		expect(top).toMatchObject({ position: 2, element: [], sql });
		expect(top.message).toBe(
			'Parameter $2 is undefined; pass null for SQL NULL. In query: select $1::int, $2::text[]',
		);
		expect(error([undefined, 'secret']).message).not.toContain('secret');
		expect(error([1, ['a', undefined]]).message).toContain('Parameter $2[2]');
		expect(error([1, [['a'], ['b', undefined]]])).toMatchObject({
			position: 2,
			element: [2, 2],
		});
		// a hole in a sparse array is undefined too
		const sparse: unknown[] = ['a'];
		sparse.length = 2;
		expect(error([1, sparse])).toMatchObject({ element: [2] });
		expect(error([1, undefined])).toBeInstanceOf(DriverError);
	});

	it('formats timestamps that Postgres accepts, including BC and far-future years', () => {
		expect(formatTimestamp(new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 6)))).toBe(
			'2024-01-02 03:04:05.006+00',
		);
		const bc = new Date(0);
		bc.setUTCFullYear(-43, 2, 15);
		expect(formatTimestamp(bc)).toBe('0044-03-15 00:00:00.000+00 BC');
		const future = new Date(0);
		future.setUTCFullYear(12345, 0, 1);
		expect(formatTimestamp(future)).toBe('12345-01-01 00:00:00.000+00');
		expect(() => formatTimestamp(new Date(Number.NaN))).toThrow(/Invalid Date/);
	});

	it('parses bytea in hex and escape formats', () => {
		expect([...parseBytea('\\x00ff10')]).toEqual([0, 255, 16]);
		expect([...parseBytea('a\\\\b\\001')]).toEqual([97, 92, 98, 1]);
		expect(() => parseBytea('\\xzz')).toThrow();
	});

	it('parses command tags', () => {
		expect(parseTag('INSERT 0 3')).toEqual({ command: 'INSERT', rowCount: 3 });
		expect(parseTag('SELECT 10')).toEqual({ command: 'SELECT', rowCount: 10 });
		expect(parseTag('CREATE TABLE')).toEqual({
			command: 'CREATE TABLE',
			rowCount: null,
		});
		expect(parseTag('BEGIN')).toEqual({ command: 'BEGIN', rowCount: null });
	});
});

describe('quarry parsers', () => {
	it('parses timestamptz output with offsets, fractions, BC and infinity', () => {
		expect(parseTimestamptz('2024-01-02 03:04:05.678+00').toISOString()).toBe(
			'2024-01-02T03:04:05.678Z',
		);
		expect(
			parseTimestamptz('2024-01-02 03:04:05.123456+05:30').toISOString(),
		).toBe('2024-01-01T21:34:05.123Z');
		expect(parseTimestamptz('1900-01-01 00:00:00-00:01:15').toISOString()).toBe(
			'1900-01-01T00:01:15.000Z',
		);
		expect(parseTimestamptz('0044-03-15 00:00:00+00 BC').getUTCFullYear()).toBe(
			-43,
		);
		expect(parseTimestamptz('0001-01-01 00:00:00+00').getUTCFullYear()).toBe(1);
		expect(parseTimestamptz('infinity').getTime()).toBe(8.64e15);
		expect(parseTimestamptz('-infinity').getTime()).toBe(-8.64e15);
		expect(() => parseTimestamptz('yesterday')).toThrow();
	});

	it('round-trips Dates through formatTimestamp and parseTimestamptz', () => {
		const rand = prng(5);
		for (let i = 0; i < 300; i++) {
			const date = new Date(Math.floor((rand() * 2 - 1) * 8e15));
			expect(parseTimestamptz(formatTimestamp(date)).getTime()).toBe(
				date.getTime(),
			);
		}
	});

	it('parses ranges', () => {
		expect(parseRange('empty', String)).toEqual({ empty: true });
		expect(parseRange('[1,5)', Number)).toEqual({
			empty: false,
			lower: 1,
			upper: 5,
			bounds: '[)',
		});
		expect(parseRange('(,)', String)).toEqual({
			empty: false,
			lower: null,
			upper: null,
			bounds: '()',
		});
		expect(parseRange('["a b","c""d\\\\e"]', String)).toEqual({
			empty: false,
			lower: 'a b',
			upper: 'c"d\\e',
			bounds: '[]',
		});
		expect(parseRange('("",x]', String)).toEqual({
			empty: false,
			lower: '',
			upper: 'x',
			bounds: '(]',
		});
		expect(() => parseRange('1,2', String)).toThrow();
	});

	it('completes parsers from the catalog without overriding known ones', () => {
		const parsers = catalogTypes(quarryTypes, [
			{ oid: 9000, name: 'vector', elem: 0, delim: ',' },
			{ oid: 9001, name: '_vector', elem: 9000, delim: ',' },
			{ oid: 9002, name: '_mood', elem: 9003, delim: ',' },
			{ oid: 1016, name: '_int8', elem: 20, delim: ',' },
		]);
		expect(parsers[9000]?.('[1,2]')).toEqual([1, 2]);
		expect(parsers[9001]?.('{"[1]","[2,3]"}')).toEqual([[1], [2, 3]]);
		expect(parsers[9002]?.('{happy,sad}')).toEqual(['happy', 'sad']);
		expect(parsers[1016]?.('{1,2}')).toEqual(['1', '2']);
	});

	it('removes raw types and their arrays', () => {
		const parsers = initialTypes(undefined, ['timestamptz', oids.int4]);
		expect(parsers[oids.timestamptz]).toBeUndefined();
		expect(parsers[1185]).toBeUndefined();
		expect(parsers[oids.int4]).toBeUndefined();
		expect(parsers[oids.bool]).toBeDefined();
		expect(initialTypes(undefined, true)).toEqual({});
		expect(initialTypes(defaultTypes, undefined)[oids.int8]?.('5')).toBe(5n);
		expect(initialTypes(undefined, undefined)[oids.int8]).toBeUndefined();
	});
});

describe('COPY text', () => {
	it('escapes special characters and writes NULL as \\N', () => {
		expect(
			copyLine([
				1,
				'a\tb\nc\\d\re',
				null,
				undefined,
				true,
				['x', null],
				new Uint8Array([1, 255]),
				{ k: 'v' },
			]),
		).toBe(
			'1\ta\\tb\\nc\\\\d\\re\t\\N\t\\N\tt\t{"x",NULL}\t\\\\x01ff\t{"k":"v"}\n',
		);
		expect(copyLine([])).toBe('\n');
		expect(copyLine(['\\N'])).toBe('\\\\N\n');
	});
});
