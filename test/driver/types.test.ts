import { describe, expect, it } from 'vitest';
import { int4, rangeDecoder } from '../../src/driver/binary.js';
import { parseRange, parseTimestamptz } from '../../src/driver/parsers.js';
import { encodeParams as encode } from '../../src/driver/params.js';
import { codecs } from '../../src/driver/codecs.js';
import {
	DriverError,
	postgresError,
	UndefinedParameterError,
} from '../../src/driver/errors.js';
import { parseTag } from '../../src/driver/ops.js';
import {
	arrayLiteral,
	copyLine,
	encodeParam,
	formatTimestamp,
	arrayOids,
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

const encodeParams = (sql: string, params: readonly unknown[]) =>
	encode(sql, params, undefined, undefined);

const fields = (code: string) => ({ C: code, M: 'm', S: 'ERROR' });

describe('parameters', () => {
	it('encodes JavaScript values as Postgres input', () => {
		expect(encodeParam(null)).toBeNull();
		expect(() => encodeParam(undefined)).toThrow(/undefined.*pass null/);
		expect(() => encodeParam([1, [undefined]])).toThrow(/undefined/);
		expect(encodeParam('x')).toBe('x');
		expect(encodeParam(1.5)).toBe('1.5');
		expect(encodeParam(1e21)).toBe('1000000000000000000000');
		expect(encodeParam(1e-7)).toBe('1e-7');
		expect(encodeParam(Number.NaN)).toBe('NaN');
		expect(encodeParam(12n)).toBe('12');
		expect(encodeParam(true)).toBe('t');
		expect(encodeParam({ a: 1 })).toBe('{"a":1}');
		expect(encodeParam([1, null, 'a"b', [true]])).toBe(
			'{"1",NULL,"a\\"b",{"t"}}',
		);
		expect(encodeParam([new Uint8Array([1, 255])])).toBe('{"\\\\x01ff"}');
		expect(() => encodeParam(() => 1)).toThrow(/function/);
	});

	it('sends only a Uint8Array as bytes, refusing other typed arrays and DataViews', () => {
		const bytes = Buffer.from([1, 2]);
		expect(encodeParam(bytes)).toBe(bytes);
		for (const view of [
			new Uint16Array([1]),
			new Float32Array([0.5]),
			new DataView(new ArrayBuffer(2)),
		]) {
			expect(() => encodeParam(view)).toThrow(
				new RegExp(`A ${view.constructor.name} parameter is not sent`),
			);
			expect(() => encodeParam([view])).toThrow(/is not sent/);
			expect(() =>
				encode('select $1', [[view]], undefined, [arrayOids.bytea]),
			).toThrow(/is not sent/);
			expect(() =>
				encode('select $1', [view], [codecs.bytea], undefined),
			).toThrow(/is not sent/);
		}
	});

	it('gives each error class its own name', () => {
		expect(postgresError(fields('23505')).name).toBe('UniqueViolation');
		expect(postgresError(fields('23999')).name).toBe(
			'IntegrityConstraintViolation',
		);
		expect(postgresError(fields('57014')).name).toBe('QueryCanceled');
		expect(postgresError(fields('40001')).name).toBe('SerializationFailure');
		expect(postgresError(fields('XX000')).name).toBe('PostgresError');
		expect(String(postgresError(fields('42P01')))).toBe('UndefinedTable: m');
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
		expect(parseRange('["a b","c\\"d"]', String)).toEqual({
			empty: false,
			lower: 'a b',
			upper: 'c"d',
			bounds: '[]',
		});
		expect(parseRange('["x""y","z"]', String)).toEqual({
			empty: false,
			lower: 'x"y',
			upper: 'z',
			bounds: '[]',
		});
		expect(() => parseRange('1,2', String)).toThrow();
	});

	it('decodes the binary range format as the text', () => {
		const decode = rangeDecoder(int4);
		const bytes = (...b: number[]) => Uint8Array.from(b);
		expect(decode(bytes(0x01), 0, 1)).toEqual({ empty: true });
		expect(
			decode(bytes(0x02, 0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 5), 0, 17),
		).toEqual(parseRange('[1,5)', Number));
		expect(decode(bytes(0x18), 0, 1)).toEqual(parseRange('(,)', Number));
		expect(decode(bytes(0x0c, 0, 0, 0, 4, 0, 0, 0, 9), 0, 9)).toEqual(
			parseRange('(,9]', Number),
		);
		expect(() => decode(bytes(0x02, 0, 0, 0, 4, 0), 0, 6)).toThrow(
			DriverError,
		);
		expect(() => decode(bytes(0x18, 0), 0, 2)).toThrow(DriverError);
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
