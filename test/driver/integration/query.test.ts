/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '../../../src/driver/connection.js';
import {
	ConnectionError,
	DecodeError,
	ForeignKeyViolation,
	NotNullViolation,
	PostgresError,
	QueryCanceled,
	UndefinedParameterError,
	UndefinedTable,
	UniqueViolation,
	CheckViolation,
} from '../../../src/driver/errors.js';
import type { Notice } from '../../../src/driver/notice.js';
import { quarryTypes } from '../../../src/decode.js';
import { oids, rawTypes } from '../../../src/driver/types.js';
import { noPg, open, rejection, table } from './helpers.js';

describe.skipIf(noPg)('queries', () => {
	let conn: Connection;
	beforeAll(async () => {
		conn = await open();
	});
	afterAll(async () => {
		await conn?.close();
	});

	// found by node-postgres's throw-in-type-parser tests
	it('fails only the query whose value a parser cannot decode', async () => {
		const types = {
			...rawTypes,
			[oids.int4]: (text: string) => {
				if (text === '777') throw new Error('bad int');
				return Number(text);
			},
		};
		const before = conn.query('select 1 as n', [], { types });
		const bad = conn.query('select n from (values (1), (777), (3)) v (n)', [], {
			types,
		});
		const after = conn.query('select 3 as n', [], { types });
		const error = await rejection(bad, DecodeError);
		expect(error).toMatchObject({ column: 'n', typeOid: oids.int4 });
		expect(error.message).not.toContain('777');
		expect((error.cause as Error).message).toBe('bad int');
		expect((await before).rows).toEqual([{ n: 1 }]);
		expect((await after).rows).toEqual([{ n: 3 }]);
		await expect(
			conn.simpleQuery('select 777 as n; select 1 as m', { types }),
		).rejects.toBeInstanceOf(DecodeError);
		await expect(async () => {
			for await (const _ of conn.cursor(
				'select generate_series(770, 1000) as n',
				[],
				{ types, batchSize: 1 },
			));
		}).rejects.toBeInstanceOf(DecodeError);
		expect(conn.closed).toBe(false);
		expect((await conn.query('select 4 as n', [], { types })).rows).toEqual([
			{ n: 4 },
		]);
	});

	// found by postgres.js's "big query body"
	it('takes up to 65535 parameters, and refuses more before sending', async () => {
		const n = 40_000;
		const placeholders = Array.from({ length: n }, (_, i) => `($${i + 1})`);
		const values = Array.from({ length: n }, (_, i) => String(i));
		const sql = `select count(*)::int as n from (values ${placeholders.join(',')}) v`;
		const { rows } = await conn.query(sql, values);
		expect(rows).toEqual([{ n }]);
		expect((await conn.describe(sql)).paramTypes).toHaveLength(n);
		await expect(
			conn.query(
				'select 1',
				Array.from({ length: 65_536 }, () => 1),
			),
		).rejects.toThrow(/at most 65535 parameters/);
		expect((await conn.query('select 1 as n')).rows).toEqual([{ n: 1 }]);
	});

	// found by postgres.js's "Cancel piped query"
	it('cancels a pipelined query once it runs, never the query ahead of it', async () => {
		const controller = new AbortController();
		const first = conn.query('select pg_sleep(0.4) as a');
		const second = conn.query('select pg_sleep(5) as b', [], {
			signal: controller.signal,
		});
		const third = conn.query('select pg_sleep(5) as c', [], { timeout: 100 });
		setTimeout(() => controller.abort(), 100);
		const started = Date.now();
		await expect(first).resolves.toMatchObject({ rowCount: 1 });
		expect((await rejection(second, QueryCanceled)).reason).toBe('abort');
		expect((await rejection(third, QueryCanceled)).reason).toBe('timeout');
		expect(Date.now() - started).toBeLessThan(3000);
		expect((await conn.query('select 1 as n')).rows).toEqual([{ n: 1 }]);
	});

	// found by postgres.js's "Catches query format errors"
	it('rejects SQL it cannot send, without crashing or breaking the connection', async () => {
		const pending = conn.query('select 1 as before');
		const nul = conn.query('select 1\0');
		const simple = conn.simpleQuery('select 1;\0');
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately not a string
		const notText = conn.query({} as string);
		const after = conn.query<{ n: number }>('select 2 as n');
		await expect(nul).rejects.toThrow(/NUL byte \(at character 9\)/);
		await expect(simple).rejects.toThrow(/NUL byte/);
		await expect(notText).rejects.toThrow(/must be a string/);
		await expect(conn.describe('select\0')).rejects.toThrow(/NUL byte/);
		await expect(async () => {
			for await (const _ of conn.cursor('select\0')) break;
		}).rejects.toThrow(/NUL byte/);
		await expect(conn.copyFrom('copy t from stdin\0', [])).rejects.toThrow(
			/NUL byte/,
		);
		expect((await pending).rows).toEqual([{ before: 1 }]);
		expect((await after).rows).toEqual([{ n: 2 }]);
	});

	it('refuses undefined parameters before sending, and stays usable', async () => {
		const error = await rejection(
			conn.query('select $1::int as a, $2::int[] as b', [1, [2, undefined]]),
			UndefinedParameterError,
		);
		expect(error).toMatchObject({ position: 2, element: [2] });
		await expect(
			conn.query('select $1::text as a', [undefined]),
		).rejects.toThrow('Parameter $1 is undefined');
		await expect(async () => {
			for await (const _ of conn.cursor('select $1::int as a', [undefined]))
				break;
		}).rejects.toBeInstanceOf(UndefinedParameterError);
		const { rows } = await conn.query('select $1::int as a', [null]);
		expect(rows).toEqual([{ a: null }]);
	});

	it('runs parameterised queries and decodes common types', async () => {
		const { rows, command, rowCount, fields } = await conn.query(
			`select $1::int4 as i, $2::int8 as big, $3::float8 as f, $4::bool as b, $5::text as t,
			        $6::numeric as n, $7::jsonb as j, $8::bytea as bin, $9::date as d,
			        $10::timestamptz as ts, null::int as nothing, $11::int4[] as ints, $12::text[] as texts`,
			[
				42,
				9007199254740993n,
				1.5,
				true,
				'héllo 😀',
				'12345678901234567890.123',
				{ a: [1, 'x'] },
				new Uint8Array([0, 1, 255]),
				'2024-02-29',
				new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 678)),
				[1, null, 3],
				['a,b', 'q"uote', 'back\\slash', '', 'NULL', null],
			],
		);
		expect(command).toBe('SELECT');
		expect(rowCount).toBe(1);
		expect(fields.map((f) => f.name)).toEqual([
			'i',
			'big',
			'f',
			'b',
			't',
			'n',
			'j',
			'bin',
			'd',
			'ts',
			'nothing',
			'ints',
			'texts',
		]);
		expect(rows[0]).toEqual({
			i: 42,
			big: 9007199254740993n,
			f: 1.5,
			b: true,
			t: 'héllo 😀',
			n: '12345678901234567890.123',
			j: { a: [1, 'x'] },
			bin: new Uint8Array([0, 1, 255]),
			d: '2024-02-29',
			ts: '2024-01-02 03:04:05.678+00',
			nothing: null,
			ints: [1, null, 3],
			texts: ['a,b', 'q"uote', 'back\\slash', '', 'NULL', null],
		});
	});

	it('returns raw text with rawTypes, and arrays with rowMode array', async () => {
		const { rows } = await conn.query(
			'select 1::int4 as a, true as b, $1::jsonb as c, array[1,2] as d',
			['{"x":1}'],
			{
				types: rawTypes,
				rowMode: 'array',
			},
		);
		expect(rows).toEqual([['1', 't', '{"x": 1}', '{1,2}']]);
	});

	it('decodes binary results exactly like text, and only where a built-in parser has a binary twin', async () => {
		const sql = `select
			b, i2, i4, o, f4, f8, bytes, ts
		from (values
			(true, (-32768)::int2, (-2147483648)::int4, 4294967295::oid, 'NaN'::float4, '-0'::float8, '\\x00ff'::bytea, '-infinity'::timestamptz),
			(false, 32767::int2, 2147483647::int4, 0::oid, 'Infinity'::float4, '1e-310'::float8, ''::bytea, 'infinity'::timestamptz),
			(null, 1::int2, 0::int4, 26::oid, '-1.5'::float4, '-Infinity'::float8, null, '0044-03-15 12:00:00.123456+00 BC'::timestamptz),
			(true, 0::int2, 7::int4, 1::oid, '3.4e38'::float4, '0.1'::float8, '\\xdeadbeef'::bytea, '1969-12-31 23:59:59.9995+00'::timestamptz),
			(true, 0::int2, 7::int4, 1::oid, '1'::float4, 'NaN'::float8, '\\x'::bytea, '2024-02-29 13:45:01.000999+05:30'::timestamptz)
		) as t(b, i2, i4, o, f4, f8, bytes, ts)`;
		await using c = await open({ types: quarryTypes });
		const text = await c.query(sql, [], { binary: false });
		await c.query(sql); // describes the statement
		const binary = await c.query(sql);
		expect(binary.fields.map((f) => f.format)).toEqual([
			1, 1, 1, 1, 0, 1, 1, 1,
		]);
		expect(text.fields.every((f) => f.format === 0)).toBe(true);
		expect(binary.rows).toEqual(text.rows);
		expect(Object.is(binary.rows[0]?.['f8'], -0)).toBe(true);

		// a custom parser keeps its column in text
		const custom = {
			...quarryTypes,
			[oids.timestamptz]: (t: string) => `custom ${t}`,
		};
		await c.query('select now() as t, 1 as n', [], { types: custom });
		const mixed = await c.query<{ t: string; n: number }>(
			'select now() as t, 1 as n',
			[],
			{ types: custom },
		);
		expect(mixed.fields.map((f) => f.format)).toEqual([0, 1]);
		expect(mixed.rows[0]?.t).toMatch(/^custom /);
		const raw = await c.query('select 1 as n', [], { types: rawTypes });
		expect(
			(await c.query('select 1 as n', [], { types: rawTypes })).rows,
		).toEqual(raw.rows);
		expect(raw.rows).toEqual([{ n: '1' }]);
	});

	it('builds rows safely whatever the column names', async () => {
		const { rows } = await conn.query(
			`select 1 as "a""b", 2 as "line\nbreak", 3 as "${'x'.repeat(63)}", 4 as "__proto__", '{"polluted":true}'::jsonb as "constructor"`,
		);
		const row = rows[0] ?? {};
		expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
		expect(Object.keys(row)).toEqual([
			'a"b',
			'line\nbreak',
			'x'.repeat(63),
			'__proto__',
			'constructor',
		]);
		expect(Object.getOwnPropertyDescriptor(row, '__proto__')?.value).toBe(4);
		expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
	});

	it('parses nested and special arrays', async () => {
		const { rows } = await conn.query<{
			m: unknown;
			f: unknown;
			e: unknown;
			b: unknown;
		}>(
			`select array[[1,2],[3,4]] as m, '{NaN,Infinity,-Infinity,1.5}'::float8[] as f, '{}'::int[] as e, '[0:1]={7,8}'::int[] as b`,
		);
		expect(rows[0]).toEqual({
			m: [
				[1, 2],
				[3, 4],
			],
			f: [Number.NaN, Infinity, -Infinity, 1.5],
			e: [],
			b: [7, 8],
		});
	});

	it('reports command tags for writes', async () => {
		const name = table();
		await conn.query(`create temp table ${name} (id int primary key, v text)`);
		const insert = await conn.query(
			`insert into ${name} values (1, 'a'), (2, 'b'), (3, 'c')`,
		);
		expect([insert.command, insert.rowCount, insert.rows]).toEqual([
			'INSERT',
			3,
			[],
		]);
		const update = await conn.query(
			`update ${name} set v = 'z' where id > $1 returning id`,
			[1],
		);
		expect([update.command, update.rowCount, update.rows]).toEqual([
			'UPDATE',
			2,
			[{ id: 2 }, { id: 3 }],
		]);
		const del = await conn.query(`delete from ${name}`);
		expect([del.command, del.rowCount]).toEqual(['DELETE', 3]);
		const ddl = await conn.query(`drop table ${name}`);
		expect([ddl.command, ddl.rowCount]).toEqual(['DROP TABLE', null]);
	});

	it('reuses prepared statements and evicts the least recently used', async () => {
		await using small = await open({ statementCacheSize: 2 });
		const count = async () =>
			(
				await small.query<{ n: number }>(
					'select count(*)::int as n from pg_prepared_statements',
					[],
					{ prepare: false },
				)
			).rows[0]?.n;
		await small.query('select 1 as x');
		await small.query('select 1 as x');
		expect(await count()).toBe(1);
		for (let i = 0; i < 5; i++) await small.query(`select ${i} as y`);
		expect(await count()).toBeLessThanOrEqual(2);
		expect((await small.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});

	it('works without named statements (prepare: false)', async () => {
		await using unnamed = await open({ prepare: false });
		await unnamed.query('select $1::int as v', [1]);
		const { rows } = await unnamed.query<{ n: number }>(
			'select count(*)::int as n from pg_prepared_statements',
		);
		expect(rows[0]?.n).toBe(0);
	});

	it('pipelines many concurrent queries on one connection, in order', async () => {
		const results = await Promise.all(
			Array.from({ length: 2000 }, (_, i) =>
				conn.query<{ v: number }>('select $1::int as v', [i]),
			),
		);
		expect(results.map((r) => r.rows[0]?.v)).toEqual(
			Array.from({ length: 2000 }, (_, i) => i),
		);
	});

	it('isolates errors between pipelined queries', async () => {
		const [a, b, c] = await Promise.allSettled([
			conn.query('select 1 as ok'),
			conn.query('select 1/0'),
			conn.query('select 2 as ok'),
		]);
		expect(a.status === 'fulfilled' && a.value.rows).toEqual([{ ok: 1 }]);
		expect(b.status === 'rejected' && b.reason).toBeInstanceOf(PostgresError);
		expect(b.status === 'rejected' && b.reason).toMatchObject({
			code: '22012',
		});
		expect(c.status === 'fulfilled' && c.value.rows).toEqual([{ ok: 2 }]);
	});

	it('reports a failed Parse to every pipelined query of that SQL', async () => {
		const results = await Promise.allSettled([
			conn.query('selec 1'),
			conn.query('selec 1'),
			conn.query('select 3 as ok'),
		]);
		expect(
			results.map((r) =>
				r.status === 'rejected' && r.reason instanceof PostgresError
					? r.reason.code
					: r.status,
			),
		).toEqual(['42601', '42601', 'fulfilled']);
		const error = await rejection(conn.query('selec 1'), PostgresError);
		expect(error.position).toBe(1);
		expect(error.query?.sql).toBe('selec 1');
		expect(Object.keys(error)).not.toContain('query');
	});

	it('maps constraint errors to typed classes with their fields', async () => {
		const parent = table('p');
		const child = table('c');
		await conn.query(
			`create temp table ${parent} (id int primary key, email text unique, age int check (age > 0))`,
		);
		await conn.query(
			`create temp table ${child} (id int primary key, parent_id int not null references ${parent}(id))`,
		);
		await conn.query(`insert into ${parent} values (1, 'a@x', 5)`);
		const unique = await rejection(
			conn.query(`insert into ${parent} values ($1, $2, 5)`, [2, 'a@x']),
			UniqueViolation,
		);
		expect([
			unique.table,
			unique.constraint,
			unique.columns,
			unique.schema,
		]).toEqual([
			parent,
			`${parent}_email_key`,
			['email'],
			expect.stringMatching(/^pg_temp/),
		]);
		const fk = await rejection(
			conn.query(`insert into ${child} values (1, 99)`),
			ForeignKeyViolation,
		);
		expect(fk.columns).toEqual(['parent_id']);
		const notNull = await rejection(
			conn.query(`insert into ${child} values (2, null)`),
			NotNullViolation,
		);
		expect(notNull.columns).toEqual(['parent_id']);
		const check = await rejection(
			conn.query(`insert into ${parent} values (3, 'b', -1)`),
			CheckViolation,
		);
		expect(check.constraint).toBe(`${parent}_age_check`);
		await expect(
			conn.query('select * from no_such_table'),
		).rejects.toBeInstanceOf(UndefinedTable);
	});

	it('keeps transaction semantics and tracks the transaction status', async () => {
		await using tx = await open();
		await tx.query('begin');
		expect(tx.transactionStatus).toBe('transaction');
		await expect(tx.query('select 1/0')).rejects.toThrow(/division by zero/);
		expect(tx.transactionStatus).toBe('failed');
		const aborted = await rejection(tx.query('select 1'), PostgresError);
		expect(aborted.code).toBe('25P02');
		await tx.query('rollback');
		expect(tx.transactionStatus).toBe('idle');
		expect((await tx.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});

	it('re-prepares a cached statement whose result type changed', async () => {
		const name = table();
		await conn.query(`create table ${name} (a int)`);
		await conn.query(`insert into ${name} values (1)`);
		expect((await conn.query(`select * from ${name}`)).rows).toEqual([
			{ a: 1 },
		]);
		await conn.query(`alter table ${name} add column b text default 'x'`);
		expect((await conn.query(`select * from ${name}`)).rows).toEqual([
			{ a: 1, b: 'x' },
		]);
		await conn.query(`drop table ${name}`);
	});

	// found by postgres.js's "Recreate prepared statements on transformAssignedExpr error"
	it('re-prepares a cached statement whose inferred parameter type no longer fits', async () => {
		const name = table();
		const insert = () =>
			conn.query<{ v: unknown }>(
				`insert into ${name} (v) values ($1) returning v`,
				['1'],
			);
		await conn.query(`create table ${name} (v text)`);
		expect((await insert()).rows).toEqual([{ v: '1' }]);
		await conn.query(
			`alter table ${name} alter column v type int using v::integer`,
		);
		expect((await insert()).rows).toEqual([{ v: 1 }]);
		// inside a transaction the error stands: retrying there isn't safe
		await expect(
			conn.transaction(async (tx) => {
				await tx.query(`alter table ${name} alter column v type text`);
				await tx.query(`insert into ${name} (v) values ($1) returning v`, [
					'2',
				]);
			}),
		).rejects.toBeInstanceOf(PostgresError);
		await conn.query(`drop table ${name}`);
	});

	it('re-prepares a cached statement the server no longer has', async () => {
		const select = () => conn.query<{ n: number }>('select 7 as n');
		expect((await select()).rows).toEqual([{ n: 7 }]);
		await conn.simpleQuery('deallocate all');
		expect((await select()).rows).toEqual([{ n: 7 }]);
	});

	it('runs multi-statement scripts through the simple protocol', async () => {
		const results = await conn.simpleQuery(
			'select 1 as a; select 2 as b, 3 as c; create temp table if not exists s1 (x int)',
		);
		expect(results.map((r) => [r.command, r.rows])).toEqual([
			['SELECT', [{ a: 1 }]],
			['SELECT', [{ b: 2, c: 3 }]],
			['CREATE TABLE', []],
		]);
		await expect(
			conn.simpleQuery('select 1; select 1/0; select 3'),
		).rejects.toThrow(/division by zero/);
		expect(await conn.simpleQuery('')).toEqual([]);
	});

	it('delivers notices', async () => {
		const notices: Notice[] = [];
		const off = conn.onNotice((n) => notices.push(n));
		await conn.query(
			`do $$ begin raise notice 'hello %', 42 using hint = 'a hint'; end $$`,
		);
		off();
		expect(notices).toMatchObject([
			{
				severity: 'NOTICE',
				message: 'hello 42',
				hint: 'a hint',
				code: '00000',
			},
		]);
	});

	it('handles empty queries and very large values', async () => {
		expect((await conn.query('')).rows).toEqual([]);
		const big = 'x'.repeat(8 * 1024 * 1024) + 'é';
		const { rows } = await conn.query<{ v: string; n: number }>(
			'select $1::text as v, length($1) as n',
			[big],
		);
		expect(rows[0]?.n).toBe(big.length);
		expect(rows[0]?.v === big).toBe(true);
	});

	it('describes a statement without running it', async () => {
		const description = await conn.describe(
			'select $1::int + 1 as n, $2::text as t',
		);
		expect(description.paramTypes).toEqual([23, 25]);
		expect(description.fields.map((f) => [f.name, f.typeOid])).toEqual([
			['n', 23],
			['t', 25],
		]);
		const write = await conn.describe(
			'create temp table if not exists d1 (x int)',
		);
		expect(write.fields).toEqual([]);
	});

	it('rejects values it cannot encode without breaking the connection', async () => {
		await expect(conn.query('select $1', [Symbol('x')])).rejects.toThrow(
			/Cannot send a symbol/,
		);
		expect((await conn.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});

	it('fails queued queries with the FATAL error when the backend is terminated', async () => {
		const victim = await open();
		const closed = new Promise((resolve) => victim.onClose(resolve));
		const pending = victim.query('select pg_sleep(10)');
		await new Promise((r) => setTimeout(r, 100));
		await conn.query('select pg_terminate_backend($1)', [victim.processId]);
		const error = await rejection(pending, PostgresError);
		expect(error.code).toBe('57P01');
		expect(error.isFatal).toBe(true);
		expect(await closed).toBeInstanceOf(PostgresError);
		expect(victim.closed).toBe(true);
		await expect(victim.query('select 1')).rejects.toBeInstanceOf(
			ConnectionError,
		);
	});

	it('closes gracefully after finishing queued queries', async () => {
		const c = await open();
		const pending = c.query('select pg_sleep(0.05), 1 as x');
		const closing = c.close();
		await expect(pending).resolves.toMatchObject({ rows: [{ x: 1 }] });
		await closing;
		expect(c.closed).toBe(true);
		await expect(c.query('select 1')).rejects.toBeInstanceOf(ConnectionError);
	});
});
