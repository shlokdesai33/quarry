/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	arrayOf,
	defineCodec,
	typed,
	type Codec,
} from '../../../src/driver/codec.js';
import { codecs } from '../../../src/driver/codecs.js';
import type { Connection } from '../../../src/driver/connection.js';
import { createPool } from '../../../src/driver/pool.js';
import { createCodecRegistry } from '../../../src/driver/registry.js';
import { int4 } from '../../../src/driver/binary.js';
import { noPg, open, options, pg, table } from './helpers.js';

const hasVector = pg?.extensions.includes('vector') ?? false;

/** A value written and what it reads back as, when not itself. */
type Case = readonly [value: unknown, read?: unknown];

/** Every built-in codec with a fixed type: the SQL type it is cast to, and values with edge cases. */
const CASES: readonly (readonly [string, Codec, string, readonly Case[]])[] = [
	['bool', codecs.bool, 'bool', [[true], [false]]],
	['int2', codecs.int2, 'int2', [[-32768], [32767], [0]]],
	['int4', codecs.int4, 'int4', [[-2147483648], [2147483647], [0]]],
	['oid', codecs.oid, 'oid', [[0], [4294967295]]],
	[
		'int8',
		codecs.int8,
		'int8',
		[
			[-(2n ** 63n)],
			[2n ** 63n - 1n],
			[9007199254740993n],
			[0n],
			[5, 5n],
			['-12', -12n],
		],
	],
	[
		'int8AsString',
		codecs.int8AsString,
		'int8',
		[['-9223372036854775808'], ['9223372036854775807'], ['0'], [7n, '7']],
	],
	[
		'float4',
		codecs.float4,
		'float4',
		[[0.5], [-1.25], [Infinity], [Number.NaN]],
	],
	[
		'float8',
		codecs.float8,
		'float8',
		[[0.1], [5e-324], [Number.MAX_VALUE], [-Infinity], [Number.NaN]],
	],
	[
		'numeric',
		codecs.numeric,
		'numeric',
		[
			['0'],
			['-1.50'],
			['12345678901234567890.0001'],
			['0.00000012'],
			['100000000000000000000'],
			['NaN'],
			['Infinity'],
			['-Infinity'],
			[1e21, '1000000000000000000000'],
			[2.5, '2.5'],
		],
	],
	['text', codecs.text, 'text', [[''], ['héllo 🎉'], ['a"b\\c,{}'], ['NULL']]],
	['varchar', codecs.varchar, 'varchar', [['x'], ['ü']]],
	['bpchar', codecs.bpchar, 'char(3)', [['ab', 'ab '], ['abc']]],
	['name', codecs.name, 'name', [['pg_class']]],
	['char', codecs.char, '"char"', [['a']]],
	[
		'uuid',
		codecs.uuid,
		'uuid',
		[
			['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
			[
				'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
				'ffffffff-ffff-ffff-ffff-ffffffffffff',
			],
		],
	],
	[
		'bytea',
		codecs.bytea,
		'bytea',
		[[new Uint8Array([0, 255, 16])], [new Uint8Array(0)]],
	],
	[
		'json',
		codecs.json,
		'json',
		[[{ a: 1, é: 'q"x' }], [[1, 'x', null]], ['str'], [1.5], [true]],
	],
	[
		'jsonb',
		codecs.jsonb,
		'jsonb',
		[[{ a: 1, é: 'q"x' }], [[1, 'x', null]], ['str'], [1.5], [false]],
	],
	[
		'timestamptz',
		codecs.timestamptz,
		'timestamptz',
		[
			[new Date(Date.UTC(2024, 1, 29, 13, 45, 1, 1))],
			[new Date(0)],
			[new Date(-1)],
			[new Date(Date.UTC(-4712, 0, 1, 12))],
			[new Date(Date.UTC(10000, 0, 1))],
			['infinity', new Date(8.64e15)],
		],
	],
	[
		'timestamptzAsString',
		codecs.timestamptzAsString,
		'timestamptz',
		[['2024-01-02 03:04:05.678+00'], [new Date(0), '1970-01-01 00:00:00+00']],
	],
	[
		'date',
		codecs.date,
		'date',
		[['2024-02-29'], ['infinity'], ['0044-03-15 BC']],
	],
	['time', codecs.time, 'time', [['13:45:00.123456']]],
	['timetz', codecs.timetz, 'timetz', [['13:45:00+05:30']]],
	['timestamp', codecs.timestamp, 'timestamp', [['2024-01-02 03:04:05.678']]],
	['interval', codecs.interval, 'interval', [['1 day 02:00:00']]],
	['inet', codecs.inet, 'inet', [['192.168.0.1'], ['10.0.0.0/8'], ['::1']]],
	['cidr', codecs.cidr, 'cidr', [['10.0.0.0/8']]],
	['macaddr', codecs.macaddr, 'macaddr', [['08:00:2b:01:02:03']]],
	['xml', codecs.xml, 'xml', [['<a>x</a>']]],
	['bit', codecs.bit, 'bit(3)', [['101']]],
	['varbit', codecs.varbit, 'varbit', [['10110']]],
	['point', codecs.point, 'point', [['(1,2)']]],
	['box', codecs.box, 'box', [['(1,1),(0,0)']]],
	['tsvector', codecs.tsvector, 'tsvector', [["'a' 'b'"]]],
	['tsquery', codecs.tsquery, 'tsquery', [["'a' & 'b'"]]],
	['jsonpath', codecs.jsonpath, 'jsonpath', [['$."a"']]],
	[
		'daterange',
		codecs.daterange,
		'daterange',
		[
			[
				{
					empty: false,
					lower: '2024-01-01',
					upper: '2024-02-01',
					bounds: '[)',
				},
			],
			[{ empty: true }],
			[
				{ empty: false, lower: null, upper: '2024-02-01', bounds: '(]' },
				{ empty: false, lower: null, upper: '2024-02-02', bounds: '()' },
			],
		],
	],
	[
		'tstzrange',
		codecs.tstzrange,
		'tstzrange',
		[
			[
				{
					empty: false,
					lower: new Date(Date.UTC(2024, 0, 1)),
					upper: new Date(Date.UTC(10000, 0, 1)),
					bounds: '[)',
				},
			],
			[{ empty: false, lower: null, upper: null, bounds: '()' }],
			[{ empty: true }],
		],
	],
];

/** The codec, asked for in binary: its own binary decoder, even where its results are read as text. */
const inBinary = (codec: Codec): Codec => ({
	...codec,
	resultFormat: 'binary',
});

describe.skipIf(noPg)('built-in codecs', () => {
	let c: Connection;
	beforeAll(async () => {
		c = await open();
	});
	afterAll(async () => {
		await c?.close();
	});

	/** Sends `value` with `codec`, reads it back with `read`, in `binary` or text. */
	async function roundTrip(
		codec: Codec,
		type: string,
		value: unknown,
		read: Codec,
		binary: boolean,
	) {
		const run = () =>
			c.query<{ v: unknown }>(
				`select $1::${type} as v`,
				[typed(value, codec)],
				{
					resultCodecs: [read],
					binary,
				},
			);
		// described by the first run, so the second asks for the codec's format
		await run();
		const result = await run();
		return { value: result.rows[0]?.v, format: result.fields[0]?.format };
	}

	it.each(CASES)(
		'%s: round-trips values and NULL in text and binary, alone and in arrays',
		async (_, codec, type, cases) => {
			const formats = new Set<number | undefined>();
			for (const [value, read = value] of cases) {
				const text = await roundTrip(codec, type, value, codec, false);
				expect(text).toEqual({ value: read, format: 0 });
				const own = await roundTrip(codec, type, value, codec, true);
				expect(own.value).toEqual(read);
				formats.add(own.format);
				if (codec.decodeBinary !== undefined) {
					const binary = await roundTrip(
						codec,
						type,
						value,
						inBinary(codec),
						true,
					);
					expect(binary).toEqual({ value: read, format: 1 });
				}
			}
			// the format its results are asked for in, once described
			expect(formats).toEqual(
				new Set([codec.resultFormat === 'binary' ? 1 : 0]),
			);
			expect(await roundTrip(codec, type, null, codec, true)).toMatchObject({
				value: null,
			});

			const array = arrayOf(codec);
			const values = [...cases.map(([value]) => value), null];
			const reads = [...cases.map(([value, read = value]) => read), null];
			for (const binary of [false, true]) {
				const result = await roundTrip(
					array,
					`${type}[]`,
					values,
					array,
					binary,
				);
				expect(result.value).toEqual(reads);
				expect(result.format).toBe(
					binary && array.resultFormat === 'binary' ? 1 : 0,
				);
			}
			expect(
				(await roundTrip(array, `${type}[]`, [], array, true)).value,
			).toEqual([]);
		},
	);

	it('round-trips multi-dimensional arrays both ways', async () => {
		const array = arrayOf(codecs.int4);
		const value = [
			[1, 2],
			[3, null],
		];
		for (const binary of [false, true]) {
			const result = await roundTrip(array, 'int4[]', value, array, binary);
			expect(result.value).toEqual(value);
		}
		const texts = arrayOf(codecs.text);
		expect(
			(
				await roundTrip(
					texts,
					'text[]',
					[
						['a', 'b c'],
						['"', null],
					],
					texts,
					true,
				)
			).value,
		).toEqual([
			['a', 'b c'],
			['"', null],
		]);
	});

	it('keeps any type as the server’s text with codecs.raw, inferring its type', async () => {
		const result = await c.query<{ v: unknown; t: unknown }>(
			'select $1::int4 + 1 as v, pg_typeof($1)::text as t',
			[typed('5', codecs.raw)],
			{ resultCodecs: [codecs.raw, codecs.raw] },
		);
		expect(result.rows).toEqual([{ v: '6', t: 'integer' }]);
	});

	it('declares the codec’s type for its parameter, and leaves text-like ones to the server', async () => {
		const result = await c.query<Record<string, string>>(
			'select pg_typeof($1)::text as a, pg_typeof($2)::text as b, pg_typeof($3)::text as c',
			[
				typed(1, codecs.int4),
				typed(new Date(0), codecs.timestamptz),
				typed([1, 2], arrayOf(codecs.int8)),
			],
		);
		expect(result.rows).toEqual([
			{ a: 'integer', b: 'timestamp with time zone', c: 'bigint[]' },
		]);
		// a text parameter's type is left to the server, here char(2)
		await c.query('create temp table codec_kinds (k char(2))');
		await c.query('insert into codec_kinds values ($1)', [
			typed('ab', codecs.text),
		]);
	});

	it('keeps statements apart by the parameter types they declare', async () => {
		const sql = 'select pg_typeof($1)::text as t';
		const asInt = await c.query(sql, [typed(1, codecs.int4)]);
		const asBig = await c.query(sql, [typed(1n, codecs.int8)]);
		const again = await c.query(sql, [typed(1, codecs.int4)]);
		expect([asInt, asBig, again].map((r) => r.rows[0])).toEqual([
			{ t: 'integer' },
			{ t: 'bigint' },
			{ t: 'integer' },
		]);
	});

	it('tests a range against a single point', async () => {
		const range = {
			empty: false,
			lower: new Date(Date.UTC(2024, 0, 1)),
			upper: new Date(Date.UTC(2024, 1, 1)),
			bounds: '[)',
		} as const;
		const { rows } = await c.query(
			'select $1 @> $2 as inside, $3 @> $4 as day',
			[
				typed(range, codecs.tstzrange),
				typed(new Date(Date.UTC(2024, 0, 5)), codecs.timestamptz),
				typed(
					{
						empty: false,
						lower: '2024-01-01',
						upper: '2024-02-01',
						bounds: '[)',
					},
					codecs.daterange,
				),
				typed('2024-01-05', codecs.date),
			],
		);
		expect(rows).toEqual([{ inside: true, day: true }]);
	});
});

describe.skipIf(noPg)('result codecs', () => {
	const SQL = `select 7::int4 as i, '2024-01-02 03:04:05.678+00'::timestamptz as t, 'x'::text as s, array[1, 2]::int4[] as a`;
	const expected = [
		codecs.int4,
		codecs.timestamptz,
		codecs.text,
		arrayOf(codecs.int4),
	];

	it('are asked for in binary only once the statement is described, never unprepared', async () => {
		for (const prepare of [true, false]) {
			await using c = await open();
			const first = await c.query(SQL, [], { resultCodecs: expected, prepare });
			expect(first.fields.map((f) => f.format)).toEqual([0, 0, 0, 0]);
			expect(first.rows).toEqual([
				{
					i: 7,
					t: new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 678)),
					s: 'x',
					a: [1, 2],
				},
			]);
			const second = await c.query(SQL, [], {
				resultCodecs: expected,
				prepare,
			});
			expect(second.fields.map((f) => f.format)).toEqual(
				prepare ? [1, 1, 0, 1] : [0, 0, 0, 0],
			);
			expect(second.rows).toEqual(first.rows);
		}
	});

	it('are read with their codecs from a cursor', async () => {
		await using c = await open();
		const batches: unknown[][] = [];
		for await (const batch of c.cursor(
			'select n, now() as t from generate_series(1, 3) n',
			[],
			{ resultCodecs: [codecs.int4, codecs.timestamptz], batchSize: 2 },
		))
			batches.push(batch);
		expect(batches.flat()).toHaveLength(3);
		expect(batches[0]?.[0]).toMatchObject({ n: 1, t: expect.any(Date) });
	});

	it('fall back to the registry’s codec for a column of another type', async () => {
		await using c = await open({ codecs: [codecs.int8AsString] });
		// expected int4, actually int8: read in binary as int8, by the registry
		const { rows, fields } = await c.query(
			'select 5::int8 as v, 1.5::float8 as f',
			[],
			{ resultCodecs: [codecs.int4, codecs.int4] },
		);
		expect(rows).toEqual([{ v: '5', f: 1.5 }]);
		expect(fields.map((f) => f.typeOid)).toEqual([20, 701]);
	});

	it('read a column of a type without a codec as text, never asking for its binary', async () => {
		await using c = await open();
		const sql = `select 1.5::numeric as v`;
		for (let run = 0; run < 3; run++) {
			const result = await c.query(sql, [], { resultCodecs: [codecs.int4] });
			expect(result.rows).toEqual([{ v: '1.5' }]);
			expect(result.fields[0]?.format).toBe(0);
		}
	});

	it('decode a column whose type changed between runs, for selects and returning writes', async () => {
		for (const prepare of [true, false]) {
			await using c = await open();
			const name = table('codec_drift');
			await c.query(`create table ${name} (id int4, v int4)`);
			const read = { resultCodecs: [codecs.int4], prepare };
			const select = () =>
				c.query<{ v: unknown }>(`select v from ${name} where id = 1`, [], read);
			let id = 0;
			const insert = () =>
				c.query<{ v: unknown }>(
					`insert into ${name} values ($1, 7) returning v`,
					[typed(++id, codecs.int4)],
					read,
				);
			// twice each, so the prepared statements are described and ask for binary
			for (let run = 0; run < 2; run++) {
				expect((await insert()).rows).toEqual([{ v: 7 }]);
				expect((await select()).rows).toEqual([{ v: 7 }]);
			}
			await c.query(`alter table ${name} alter column v type int8`);
			// the stale plans are prepared again, and read with the registry's int8
			for (let run = 0; run < 2; run++) {
				expect((await insert()).rows).toEqual([{ v: 7n }]);
				expect((await select()).rows).toEqual([{ v: 7n }]);
			}
			await c.query(`alter table ${name} alter column v type numeric`);
			// numeric has no default codec: text, never binary nobody reads
			for (let run = 0; run < 2; run++) {
				expect((await insert()).rows).toEqual([{ v: '7' }]);
				expect((await select()).rows).toEqual([{ v: '7' }]);
			}
			expect(
				(await c.query(`select count(*)::int as n from ${name}`)).rows,
			).toEqual([{ n: 6 }]);
			await c.query(`drop table ${name}`);
		}
	});
});

describe.skipIf(noPg)('types looked up by name', () => {
	const schema = table('codec_types');
	const mood = defineCodec({
		name: 'codec_mood',
		encode: (value: string) => value,
		decodeText: (text) => text,
	});
	const posint = defineCodec({
		name: 'codec_posint',
		encode: (value: number) => String(value),
		decodeText: (text) => Number(text),
		decodeBinary: int4,
	});

	beforeAll(async () => {
		await using c = await open();
		await c.simpleQuery(`
			${hasVector ? 'create extension if not exists vector;' : ''}
			create schema ${schema};
			create type ${schema}.codec_mood as enum ('happy', 'sad');
			create domain ${schema}.codec_posint as int4 check (value > 0);
			create table ${schema}.feelings (m ${schema}.codec_mood, ms ${schema}.codec_mood[], n ${schema}.codec_posint);
			insert into ${schema}.feelings values ('happy', '{happy,sad}', 3);
		`);
	});
	afterAll(async () => {
		await using c = await open();
		await c.query(`drop schema if exists ${schema} cascade`);
	});

	const inSchema = () => ({ params: { search_path: `${schema},public` } });

	it('resolves enums, their arrays and domains once per pool, and declares them exactly', async () => {
		await using pool = createPool({
			...options(inSchema()),
			max: 2,
			codecs: [mood],
		});
		await pool.loadTypes();
		const { rows: oids } = await pool.query<Record<string, number>>(
			`select 'codec_mood'::regtype::oid as m, 'codec_mood[]'::regtype::oid as ms, 'codec_posint'::regtype::oid as n`,
		);
		const row = oids[0];
		const { rows } = await pool.query(
			'select pg_typeof($1)::text as a, pg_typeof($2)::text as b, pg_typeof($3)::text as c',
			[typed('sad', mood), typed(['happy'], arrayOf(mood)), typed(4, posint)],
		);
		expect(rows).toEqual([
			{ a: 'codec_mood', b: 'codec_mood[]', c: 'codec_posint' },
		]);
		const feelings = () =>
			pool.query('select m, ms, n from feelings', [], {
				resultCodecs: [mood, arrayOf(mood), posint],
			});
		await feelings();
		const read = await feelings();
		expect(read.rows).toEqual([{ m: 'happy', ms: ['happy', 'sad'], n: 3 }]);
		// a domain's column is reported as its base type, which the codec reads in binary
		expect(read.fields.map((f) => [f.typeOid, f.format])).toEqual([
			[row?.['m'], 0],
			[row?.['ms'], 0],
			[23, 1],
		]);
		// the registry's codec for the enum decodes it in raw SQL too, and its arrays
		const raw = await pool.query('select m, ms from feelings');
		expect(raw.rows).toEqual([{ m: 'happy', ms: ['happy', 'sad'] }]);
	});

	it('looks the types up again with reloadTypes, for types created since', async () => {
		await using pool = createPool({ ...options(inSchema()), max: 1 });
		const late = defineCodec({
			name: 'codec_late',
			encode: (value: string) => value,
			decodeText: (text) => text,
		});
		await pool.loadTypes();
		await pool.query(`create type ${schema}.codec_late as enum ('x')`);
		const declared = () =>
			pool.query('select pg_typeof($1)::text as t', [typed('x', late)]);
		// not in the catalog loaded before it existed: its type is inferred
		await expect(declared()).rejects.toMatchObject({ code: '42P18' });
		await pool.reloadTypes();
		expect((await declared()).rows).toEqual([{ t: 'codec_late' }]);
	});

	it('loads the catalog behind the first query that needs it, sending that one inferred', async () => {
		await using c = await open(inSchema());
		const first = await c.query(
			'select $1::codec_mood as m',
			[typed('happy', mood)],
			{
				resultCodecs: [mood],
			},
		);
		expect(first.rows).toEqual([{ m: 'happy' }]);
		expect(c.loadTypes()).toBeInstanceOf(Promise);
		// the load the first query started
		await c.loadTypes();
		const later = await c.query('select pg_typeof($1)::text as t', [
			typed('happy', mood),
		]);
		expect(later.rows).toEqual([{ t: 'codec_mood' }]);
	});

	it.skipIf(!hasVector)(
		'resolves pgvector, reading vectors in binary once described',
		async () => {
			await using c = await open({ codecs: [codecs.vector] });
			await c.loadTypes();
			const vectors = () =>
				c.query(
					'select $1::vector as v, pg_typeof($1)::text as t',
					[typed([0.5, 1, -2], codecs.vector)],
					{ resultCodecs: [codecs.vector, codecs.text] },
				);
			await vectors();
			const { rows, fields } = await vectors();
			expect(rows).toEqual([{ v: [0.5, 1, -2], t: 'vector' }]);
			expect(fields[0]?.format).toBe(1);
		},
	);
});

describe.skipIf(noPg)('the standalone driver’s codecs', () => {
	it('registers and overrides codecs for a pool', async () => {
		await using pool = createPool({
			...options(),
			max: 1,
			codecs: [codecs.int8AsString, codecs.timestamptz],
		});
		const sql = `select 9007199254740993::int8 as a, '2024-01-01 00:00:00+00'::timestamptz as b, array[1::int8, null] as c`;
		for (let run = 0; run < 2; run++) {
			const { rows } = await pool.query(sql);
			expect(rows).toEqual([
				{
					a: '9007199254740993',
					b: new Date(Date.UTC(2024, 0, 1)),
					c: ['1', null],
				},
			]);
		}
	});

	it('takes a registry or a list per query', async () => {
		await using c = await open();
		const list = [codecs.timestamptzAsString];
		const registry = createCodecRegistry([codecs.int8AsString]);
		const sql = `select 1::int8 as a, '2024-01-01 00:00:00+00'::timestamptz as b`;
		expect((await c.query(sql)).rows).toEqual([
			{ a: 1n, b: '2024-01-01 00:00:00+00' },
		]);
		expect((await c.query(sql, [], { codecs: registry })).rows).toEqual([
			{ a: '1', b: '2024-01-01 00:00:00+00' },
		]);
		expect((await c.query(sql, [], { codecs: list })).rows).toEqual([
			{ a: 1n, b: '2024-01-01 00:00:00+00' },
		]);
	});

	it('mixes typed and untyped parameters', async () => {
		await using c = await open();
		const { rows } = await c.query(
			'select $1::int4 + $2 as sum, $3::jsonb as doc',
			[1, typed(2, codecs.int4), typed('just a string', codecs.jsonb)],
		);
		expect(rows).toEqual([{ sum: 3, doc: 'just a string' }]);
	});
});
