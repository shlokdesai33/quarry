/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	bigint,
	boolean,
	bytea,
	doublePrecision,
	integer,
	jsonb,
	smallint,
	text,
	timestamptz,
	uuid,
	varchar,
	vector,
} from '../../../src/column-factories.js';
import { compile } from '../../../src/compile.js';
import { database, type Database } from '../../../src/database.js';
import { quarryTypes } from '../../../src/decode.js';
import { defineTable } from '../../../src/define-table.js';
import { binaryArray } from '../../../src/driver/array-params.js';
import type { Connection } from '../../../src/driver/connection.js';
import { PostgresError } from '../../../src/driver/errors.js';
import {
	catalogQuery,
	catalogTypes,
	parseVector,
	type CatalogType,
} from '../../../src/driver/parsers.js';
import { createPool, type Pool } from '../../../src/driver/pool.js';
import {
	arrayLiteral,
	arrayOids,
	arrayParser,
	defaultTypes,
	parseArray,
	parseInteger,
	type TypeParsers,
} from '../../../src/driver/types.js';
import { noPg, open, options, pg, table } from './helpers.js';

const hasVector = pg?.extensions.includes('vector') ?? false;

// a database of its own, so pgvector is installed where this file expects
// it while other files create and drop it in their schemas
const DATABASE = table('binary_arrays_db');
const here = { database: DATABASE };

beforeAll(async () => {
	if (noPg) return;
	await using admin = await open();
	await admin.query(`create database ${DATABASE}`);
	if (hasVector) {
		await using c = await open(here);
		await c.query('create extension vector');
	}
});
afterAll(async () => {
	if (noPg) return;
	await using admin = await open();
	await admin.query(`drop database if exists ${DATABASE} with (force)`);
});

/** The rows of `sql` in text, and in binary (from its second run), on one connection. */
async function bothWays(c: Connection, sql: string, types: TypeParsers) {
	const asText = await c.query(sql, [], { types, binary: false });
	await c.query(sql, [], { types }); // describes the statement
	const binary = await c.query(sql, [], { types });
	return {
		text: asText.rows,
		binary: binary.rows,
		formats: Object.fromEntries(binary.fields.map((f) => [f.name, f.format])),
	};
}

const RESULT_ARRAYS = `select * from (values
	(1,
		'{t,f,NULL}'::bool[], '{-32768,32767,NULL}'::int2[],
		'{1,NULL,-2147483648,2147483647}'::int4[], '{0,4294967295}'::oid[],
		'{-9223372036854775808,9223372036854775807,9007199254740993,-9007199254740993,0,NULL}'::int8[],
		'{NaN,Infinity,-Infinity,-0,1e-310,0.1,1.7976931348623157e308,NULL}'::float8[],
		'{0.1,3.4e38}'::float4[],
		array['', 'NULL', 'a,b', 'q"uote', 'back\\slash', '{brace}', ' spaced ', 'héllo', '日本語', '🎉', E'tab\\tnew\\nline', null]::text[],
		array['x', null, 'ü']::varchar[], array['a', 'ab ']::char(3)[], array['pg_class']::name[],
		array['infinity', '-infinity', '0044-03-15 12:00:00.123456+00 BC', '1969-12-31 23:59:59.9995+00',
			'2024-02-29 13:45:01.000999+05:30', '3000-06-15 12:34:56.789999+00', null]::timestamptz[],
		array['\\x00ff', null, '\\x']::bytea[],
		array['{"a": 1, "é": "\\u00e9"}', '"str"', 'null', '[1, {"b": "q\\"x"}]', null]::jsonb[],
		array['{"a" : 1}', null]::json[],
		array['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', null]::uuid[],
		'{1.50,NaN}'::numeric[], '{2024-01-01}'::date[],
		'{{1,2},{3,NULL}}'::int4[], '{{{a}},{{b}}}'::text[], '[0:2]={7,8,9}'::int4[], '[-1:0][1:1]={{1},{2}}'::int8[]),
	(2, '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}', '{}',
		'{}', '{}', '{}', '{}'),
	(3, '{NULL}', null, '{NULL}', null, '{NULL}', '{NULL}', null, '{NULL}', '{NULL}', null, null,
		'{NULL}', '{NULL}', '{NULL}', null, '{NULL}', null, null, null, null, null, null)
) as t(id, b, i2, i4, o, i8, f8, f4, t, vc, bp, nm, ts, by, jb, js, u, n, d, md, md3, lb, lb2)
order by id`;

describe.skipIf(noPg)('binary arrays', () => {
	let c: Connection;
	let catalog: CatalogType[];

	beforeAll(async () => {
		c = await open(here);
		catalog = (await c.query<CatalogType>(catalogQuery)).rows;
	});
	afterAll(async () => {
		await c?.close();
	});

	it('decodes arrays in binary exactly as from text, with quarry’s parsers', async () => {
		const types = catalogTypes(quarryTypes, catalog);
		const {
			text: asText,
			binary,
			formats,
		} = await bothWays(c, RESULT_ARRAYS, types);
		expect(formats).toEqual({
			id: 1,
			b: 1,
			i2: 1,
			i4: 1,
			o: 1,
			i8: 1,
			f8: 1,
			// float4 text is the shortest float32 decimal, which binary doesn't give
			f4: 0,
			t: 1,
			vc: 1,
			bp: 1,
			nm: 1,
			ts: 1,
			by: 1,
			jb: 1,
			js: 1,
			// quarry's uuid, numeric and date are strings, built faster from text
			u: 0,
			n: 0,
			d: 0,
			md: 1,
			md3: 1,
			lb: 1,
			lb2: 1,
		});
		expect(binary).toEqual(asText);
		const f8 = binary[0]?.['f8'];
		expect(Array.isArray(f8) && Object.is(f8[3], -0)).toBe(true);
		expect(binary[0]?.['i8']).toEqual([
			'-9223372036854775808',
			'9223372036854775807',
			'9007199254740993',
			'-9007199254740993',
			'0',
			null,
		]);
		expect(binary[0]?.['md']).toEqual([
			[1, 2],
			[3, null],
		]);
		expect(binary[0]?.['lb']).toEqual([7, 8, 9]);
		expect(binary[1]?.['md']).toEqual([]);
		expect(binary[2]?.['t']).toEqual([null]);
	});

	it('decodes arrays in binary exactly as from text, with the driver’s defaults', async () => {
		const types = catalogTypes(defaultTypes, catalog);
		const {
			text: asText,
			binary,
			formats,
		} = await bothWays(c, RESULT_ARRAYS, types);
		expect(formats['i8']).toBe(1);
		expect(formats['t']).toBe(1);
		// defaultTypes leave timestamptz as text, and so its arrays
		expect(formats['ts']).toBe(0);
		expect(binary).toEqual(asText);
		expect(binary[0]?.['i8']).toEqual([
			-9223372036854775808n,
			9223372036854775807n,
			9007199254740993n,
			-9007199254740993n,
			0n,
			null,
		]);
	});

	it('keeps arrays in text for custom, hand-written or raw parsers', async () => {
		const sql = `select '{1,2}'::int4[] as mine, '{3}'::int4[] as theirs, '{a}'::text[] as raw, '{4}'::int2[] as custom`;
		const types = {
			...quarryTypes,
			[arrayOids.int4]: (t: string) => parseArray(t, parseInteger),
			[arrayOids.int2]: arrayParser((t) => `#${t}`),
		};
		const { binary, formats } = await bothWays(c, sql, types);
		expect(formats).toEqual({ mine: 0, theirs: 0, raw: 0, custom: 0 });
		expect(binary).toEqual([
			{ mine: [1, 2], theirs: [3], raw: '{a}', custom: ['#4'] },
		]);
	});

	it.skipIf(!hasVector)(
		'decodes vectors in binary as the float32 values text gives',
		async () => {
			const vectors = (await c.query<CatalogType>(catalogQuery)).rows;
			const types = catalogTypes(quarryTypes, vectors);
			const sql = `select '[0.1,1e-45,3.4028235e38,-0,1,-2.5]'::vector as v,
				array['[1,0.2]'::vector, null] as va, '[0.1,2]'::halfvec as h
				union all select '[3]', '{}', null`;
			const { text: asText, binary, formats } = await bothWays(c, sql, types);
			expect(formats).toEqual({ v: 1, va: 1, h: 0 });
			expect(binary).toEqual(asText);
			expect(binary[0]?.['v']).toEqual(
				[0.1, 1e-45, 3.4028235e38, -0, 1, -2.5].map(Math.fround),
			);
			// halfvec stays text, parsed as printed
			expect(binary[0]?.['h']).toEqual([0.099975586, 2]);
			expect(parseVector('[0.1]')).toEqual([0.10000000149011612]);
		},
	);

	it('agrees with the text parser for a million random float32s', async () => {
		if (!hasVector) return;
		const bits = new Uint32Array(1_000_000);
		let seed = 1;
		for (let i = 0; i < bits.length; i++) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			bits[i] = seed;
		}
		const floats = Array.from(new Float32Array(bits.buffer)).filter((f) =>
			Number.isFinite(f),
		);
		const types = catalogTypes(
			quarryTypes,
			(await c.query<CatalogType>(catalogQuery)).rows,
		);
		for (let i = 0; i < floats.length; i += 16_000) {
			const chunk = floats.slice(i, i + 16_000);
			const sql = `select $1::float4[]::vector as v`;
			const literal = `{${chunk.map((f) => f.toPrecision(9)).join(',')}}`;
			const { rows: textRows } = await c.query<{ v: number[] }>(
				sql,
				[literal],
				{ types, binary: false },
			);
			await c.query(sql, [literal], { types });
			const { rows } = await c.query<{ v: number[] }>(sql, [literal], {
				types,
			});
			expect(rows[0]?.v).toEqual(chunk);
			expect(textRows[0]?.v).toEqual(chunk);
		}
	});

	describe('binary array parameters', () => {
		const NUL_TEXT = ['a\0b'];
		const cases: [string, number, readonly unknown[][]][] = [
			['bool', arrayOids.bool, [[true, false, null], []]],
			['int2', arrayOids.int2, [[-32768, 32767, 0, -0, null], [null]]],
			[
				'int4',
				arrayOids.int4,
				[[-2147483648, 2147483647, 0, null], [], [null, null]],
			],
			[
				'int8',
				arrayOids.int8,
				[
					[
						'-9223372036854775808',
						'9223372036854775807',
						'9007199254740993',
						'-9007199254740993',
						'9007199254740991',
						'0',
						'-0',
						'0001',
						null,
					],
					[1, -1, 2 ** 53 - 1, -(2 ** 53 - 1), 0],
					[9223372036854775807n, -9223372036854775808n, 0n, null],
				],
			],
			[
				'float8',
				arrayOids.float8,
				[
					[
						Number.NaN,
						Infinity,
						-Infinity,
						-0,
						0,
						5e-324,
						1e-310,
						Number.MAX_VALUE,
						0.1,
						1 / 3,
						null,
					],
				],
			],
			[
				'timestamptz',
				arrayOids.timestamptz,
				[
					[
						new Date(Date.UTC(2024, 1, 29, 13, 45, 1, 1)),
						new Date(0),
						new Date(-1),
						new Date('1969-12-31T23:59:59.999Z'),
						new Date(Date.UTC(-4712, 0, 1, 12)),
						new Date(Date.UTC(0, 5, 15)),
						new Date(Date.UTC(3000, 5, 15, 12, 34, 56, 789)),
						new Date(8.64e15),
						null,
					],
				],
			],
			[
				'text',
				arrayOids.text,
				[
					[
						'',
						'NULL',
						'a,b',
						'q"uote',
						'back\\slash',
						'{brace}',
						' spaced ',
						'héllo',
						'日本語',
						'🎉',
						'\ud800',
						'tab\tnew\nline',
						null,
					],
					[],
				],
			],
			['varchar', arrayOids.varchar, [['x', 'ü', null]]],
			['char', arrayOids.bpchar, [['a', 'ab ', null]]],
			[
				'uuid',
				arrayOids.uuid,
				[
					[
						'00000000-0000-0000-0000-000000000000',
						'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
						'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
						null,
					],
				],
			],
			[
				'jsonb',
				arrayOids.jsonb,
				[['{"a":1}', '"str"', 'null', '[1,"é",{"b":"q\\"x\\u00e9"}]', null]],
			],
			[
				'bytea',
				arrayOids.bytea,
				[
					[
						new Uint8Array([0, 255]),
						new Uint8Array(0),
						null,
						Buffer.from('hi'),
					],
				],
			],
		];

		it.each(cases)(
			'sends %s arrays in binary, read as the text literal is',
			async (type, oid, values) => {
				for (const value of values) {
					expect(binaryArray(value, oid)).toBeInstanceOf(Uint8Array);
					const sql = `select $1::${type}[] as v, $1::${type}[] is not distinct from $2::${type}[] as same`;
					const binary = await c.query<{ v: unknown; same: boolean }>(
						sql,
						[value, arrayLiteral(value)],
						{ paramTypes: [oid], types: quarryTypes },
					);
					const asText = await c.query<{ v: unknown }>(
						`select $1::${type}[] as v`,
						[value],
						{ types: quarryTypes },
					);
					expect(binary.rows[0]?.same).toBe(true);
					expect(binary.rows[0]?.v).toEqual(asText.rows[0]?.v);
				}
			},
		);

		it('falls back to a literal where an element doesn’t fit the type', async () => {
			const fallbacks: [number, unknown[]][] = [
				[arrayOids.int4, [1.5]],
				[arrayOids.int4, ['1']],
				[arrayOids.int4, [2 ** 31]],
				[arrayOids.int4, [[1, 2]]],
				[arrayOids.int2, [40000]],
				[arrayOids.int8, [' 1']],
				[arrayOids.int8, ['+1']],
				[arrayOids.int8, ['1e3']],
				[arrayOids.int8, [2 ** 53]],
				[arrayOids.int8, ['9223372036854775808']],
				[arrayOids.int8, [2n ** 63n]],
				[arrayOids.float8, ['1.5']],
				[arrayOids.bool, ['t']],
				[arrayOids.timestamptz, ['2024-01-01']],
				[arrayOids.timestamptz, [new Date(Number.NaN)]],
				[arrayOids.text, [1]],
				[arrayOids.uuid, ['{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}']],
				[arrayOids.uuid, ['a0eebc999c0b4ef8bb6d6bb9bd380a11']],
				[arrayOids.uuid, ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1g']],
				[arrayOids.jsonb, [{ a: 1 }]],
				[arrayOids.bytea, ['\\x00']],
				[arrayOids.numeric, ['1.5']],
			];
			for (const [oid, value] of fallbacks)
				expect(binaryArray(value, oid), String(value)).toBeUndefined();
			// they still go, as text, and the server reads them as before
			const { rows } = await c.query(
				'select $1::int4[] as a, $2::int8[] as b, $3::uuid[] as c, $4::text[] as d',
				[['1'], ['+1'], ['a0eebc999c0b4ef8bb6d6bb9bd380a11'], [1]],
				{
					paramTypes: [arrayOids.int4, arrayOids.int8, arrayOids.uuid],
					types: quarryTypes,
				},
			);
			expect(rows).toEqual([
				{
					a: [1],
					b: ['1'],
					c: '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}',
					d: '{1}',
				},
			]);
			await expect(
				c.query('select $1::int4[]', [[1.5]], {
					paramTypes: [arrayOids.int4],
				}),
			).rejects.toMatchObject({ code: '22P02' });
		});

		it('rejects a NUL in text as the text path does', async () => {
			const binary = c.query('select $1::text[]', [NUL_TEXT], {
				paramTypes: [arrayOids.text],
			});
			const asText = c.query('select $1::text[]', [NUL_TEXT]);
			const [b, t] = await Promise.all([errorCode(binary), errorCode(asText)]);
			expect(b).toMatch(/^22/);
			expect(b).toBe(t);
		});

		it('sends -0 as 0, as the text path does', async () => {
			const { rows } = await c.query<{ v: number[] }>(
				'select $1::float8[] as v',
				[[-0]],
				{ paramTypes: [arrayOids.float8], types: quarryTypes },
			);
			expect(Object.is(rows[0]?.v[0], 0)).toBe(true);
		});
	});
});

/** The SQLSTATE `promise` rejects with, or undefined if it resolves. */
const errorCode = (promise: Promise<unknown>) =>
	promise.then(
		() => undefined,
		(e: unknown) => (e instanceof PostgresError ? e.code : e),
	);

const schema = table('binary_arrays');

const items = defineTable('items', {
	columns: {
		id: integer(),
		code: varchar(3).nullable().default(),
		small: smallint().nullable().default(),
		big: bigint().nullable().default(),
		score: doublePrecision().nullable().default(),
		flag: boolean().nullable().default(),
		at: timestamptz().nullable().default(),
		label: text().nullable().default(),
		uid: uuid().nullable().default(),
		doc: jsonb<object | string>().nullable().default(),
		bytes: bytea().nullable().default(),
	},
});

const embeddings = defineTable('embeddings', {
	columns: { id: integer(), v: vector() },
});

describe.skipIf(noPg)('quarry’s binary array parameters', () => {
	let pool: Pool;
	let db: Database;

	beforeAll(async () => {
		pool = createPool({
			...options(here),
			max: 2,
			params: { search_path: `${schema},public` },
		});
		db = database(pool);
		await pool.simpleQuery(`
			create schema ${schema};
			create table items (
				id int primary key, code varchar(3), small int2, big int8, score float8, flag bool,
				at timestamptz, label text, uid uuid, doc jsonb, bytes bytea
			);
			create table single (like items);
		`);
	});
	afterAll(async () => {
		await pool
			?.query(`drop schema if exists ${schema} cascade`)
			.catch(() => {});
		await pool?.end();
	});

	const rows = [
		{
			id: 1,
			code: 'abc',
			small: -32768,
			big: '-9223372036854775808',
			score: Number.NaN,
			flag: true,
			at: new Date(Date.UTC(-4712, 0, 1, 12)),
			label: 'q"uote, {brace} \\ 日本語 🎉',
			uid: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
			doc: { a: [1, 'é', null], b: 'q"x' },
			bytes: new Uint8Array([0, 1, 255]),
		},
		{
			id: 2,
			code: '',
			small: 32767,
			big: '9007199254740993',
			score: -Infinity,
			flag: false,
			at: new Date(Date.UTC(3000, 5, 15, 12, 34, 56, 789)),
			label: '',
			uid: '00000000-0000-0000-0000-000000000000',
			doc: 'just a string',
			bytes: new Uint8Array(0),
		},
		{
			id: 3,
			code: null,
			small: null,
			big: null,
			score: null,
			flag: null,
			at: null,
			label: null,
			uid: null,
			doc: null,
			bytes: null,
		},
	];

	it('inserts many rows in binary, as single-row inserts store them', async () => {
		const query = compile(db.insertInto(items).values(rows).toNode());
		expect(query.paramTypes).toEqual([
			1007, 1015, 1005, 1016, 1022, 1000, 1185, 1009, 2951, 3807, 1001,
		]);
		await db.insertInto(items).values(rows).execute();
		for (const row of rows) await pool.query(SINGLE_INSERT, singleValues(row));
		const { rows: diff } = await pool.query(
			'(table items except table single) union all (table single except table items)',
		);
		expect(diff).toEqual([]);
		const stored = await db
			.selectFrom(items)
			.select(['items.id', 'items.big', 'items.at', 'items.doc', 'items.uid'])
			.where((eb) => eb.ref('items.id').in(eb.val([1, 2, 3])))
			.all();
		expect(stored.toSorted((a, b) => a.id - b.id)).toEqual(
			rows.map((r) => ({
				id: r.id,
				big: r.big,
				at: r.at,
				doc: r.doc,
				uid: r.uid?.toLowerCase() ?? null,
			})),
		);
	});

	it('updates many rows in binary', async () => {
		await db
			.updateMany(
				items,
				[
					{ id: 1, big: '1', at: new Date(0), flag: null },
					{ id: 2, big: '-1', at: null, flag: true },
				],
				{ by: 'id' },
			)
			.execute();
		const { rows: stored } = await pool.query(
			'select id, big, at, flag from items where id = any($1) order by id',
			[[1, 2]],
			{ types: quarryTypes },
		);
		expect(stored).toEqual([
			{ id: 1, big: '1', at: new Date(0), flag: null },
			{ id: 2, big: '-1', at: null, flag: true },
		]);
	});

	it('rejects a value too long for varchar(n) in a multi-row insert or updateMany, as a single-row insert does', async () => {
		expect(
			await errorCode(
				db.insertInto(items).values({ id: 10, code: 'abcdef' }).execute(),
			),
		).toBe('22001');
		expect(
			await errorCode(
				db
					.insertInto(items)
					.values([
						{ id: 10, code: 'abcdef' },
						{ id: 11, code: 'ok' },
					])
					.execute(),
			),
		).toBe('22001');
		expect(
			await errorCode(
				db
					.updateMany(
						items,
						[
							{ id: 1, code: 'abcd' },
							{ id: 2, code: 'x' },
						],
						{
							by: 'id',
						},
					)
					.execute(),
			),
		).toBe('22001');
		expect(
			compile(
				db
					.insertInto(items)
					.values([
						{ id: 10, code: 'a' },
						{ id: 11, code: 'b' },
					])
					.toNode(),
			).sql,
		).toBe(
			'insert into "items" ("id", "code") select * from unnest($1::integer[], $2::varchar[])',
		);
	});

	it.skipIf(!hasVector)(
		'reads vectors the same on a statement’s first run and later ones',
		async () => {
			await pool.simpleQuery(
				`create table ${schema}.embeddings (id int, v vector(3))`,
			);
			const vdb = database(pool);
			await vdb
				.insertInto(embeddings)
				.values([{ id: 1, v: [0.1, 0.2, 0.3] }])
				.execute();
			const read = () =>
				vdb.selectFrom(embeddings).select(['embeddings.v']).one();
			const first = await read();
			expect(await read()).toEqual(first);
			expect(await read()).toEqual({ v: [0.1, 0.2, 0.3].map(Math.fround) });
		},
	);
});

const COLUMNS = [
	'id',
	'code',
	'small',
	'big',
	'score',
	'flag',
	'at',
	'label',
	'uid',
	'doc',
	'bytes',
] as const;

const SINGLE_INSERT = `insert into single (${COLUMNS.join(', ')}) values (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})`;

function singleValues(row: Record<string, unknown>): unknown[] {
	return COLUMNS.map((column) => {
		const value = row[column];
		return column === 'doc' && value !== null ? JSON.stringify(value) : value;
	});
}
