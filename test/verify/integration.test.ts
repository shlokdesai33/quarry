import { readFileSync } from 'node:fs';
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from 'vitest';
import {
	array,
	bigint,
	boolean,
	bytea,
	date,
	daterange,
	decimal,
	doublePrecision,
	inet,
	integer,
	interval,
	jsonb,
	real,
	smallint,
	text,
	time,
	timestamp,
	timestamptz,
	tsvector,
	tstzrange,
	uuid,
	varchar,
} from '../../src/column-factories.js';
import type { CompiledQuery } from '../../src/compile.js';
import { databaseWith } from '../../src/database.js';
import { executorFrom } from '../helpers/executor.js';
import { defineEnum } from '../../src/define-enum.js';
import { defineTable } from '../../src/define-table.js';
import { createPool, type Pool } from '../../src/driver/pool.js';
import { createCodecRegistry } from '../../src/driver/registry.js';
import { DriverExecutor } from '../../src/driver-executor.js';
import type { Executor } from '../../src/executor.js';
import type { AnyTable } from '../../src/table.js';
import { formatVerifyReport } from '../../src/verify/render/format.js';
import type { VerifyOptions } from '../../src/verify/report.js';
import {
	cluster,
	noPg,
	options as connectionOptions,
} from '../driver/integration/helpers.js';
import { schema as driftSchema } from './fixtures/schema.js';

/** The schema the tests create their tables in, first on the search path. */
const schema = 'quarry_verify';

/** A pool whose sessions find tables in `schema` first. */
const poolOf = (params: Record<string, string> = {}) =>
	createPool({
		...connectionOptions(),
		max: 2,
		params: { search_path: schema, ...params },
	});

let pool: Pool;
let executor: Executor;

/** Verifies on a counting executor, checking it ran a single query. */
async function verify(
	tables: readonly AnyTable[],
	options?: VerifyOptions,
	on: Executor = executor,
) {
	const queries: CompiledQuery[] = [];
	const report = await databaseWith(
		executorFrom((query) => {
			queries.push(query);
			return on.execute(query);
		}),
	).verify(tables, options);
	expect(queries).toHaveLength(tables.length === 0 ? 0 : 1);
	return report;
}

type Report = Awaited<ReturnType<typeof verify>>;

function codes(report: Report) {
	return report.diagnostics.map((d) => [
		d.severity,
		d.code,
		d.column === undefined ? d.table : `${d.table}.${d.column}`,
	]);
}

function withoutDuration(report: Report): Report {
	return { ...report, summary: { ...report.summary, durationMs: 0 } };
}

describe.skipIf(noPg)('db.verify against PostgreSQL', () => {
	let version: number;

	beforeAll(() => {
		pool = poolOf();
		executor = new DriverExecutor(pool);
		version = cluster().serverVersionNum;
	});
	afterAll(async () => {
		await pool?.simpleQuery(
			`drop schema if exists ${schema} cascade; drop schema if exists quarry_verify_other cascade`,
		);
		await pool?.end();
	});
	beforeEach(async () => {
		await pool.simpleQuery(
			`drop schema if exists ${schema} cascade; create schema ${schema};
			drop schema if exists quarry_verify_other cascade;`,
		);
	});

	test('the drift fixture', async () => {
		await pool.simpleQuery(
			readFileSync(new URL('./fixtures/drift.sql', import.meta.url), 'utf8'),
		);
		const report = await verify(driftSchema);
		expect(report.ok).toBe(false);
		expect(codes(report)).toEqual([
			['error', 'column-type-mismatch', 'users.email'],
			['error', 'column-type-mismatch', 'users.age'],
			['error', 'enum-label-mismatch', 'users.status'],
			['error', 'column-nullable-mismatch', 'users.created_at'],
			['error', 'column-default-missing', 'users.created_at'],
			['warning', 'column-extra', 'users.legacy_code'],
			['error', 'column-type-mismatch', 'orders.total'],
			['error', 'column-nullable-mismatch', 'orders.search'],
			['warning', 'column-generated-missing', 'orders.search'],
			['error', 'table-missing', 'invoices'],
		]);
		expect(report.summary).toMatchObject({
			errors: 8,
			warnings: 2,
			infos: 0,
			tables: 3,
			columns: 14,
		});
		const pretty = formatVerifyReport(
			{ ...report, summary: { ...report.summary, durationMs: 5 } },
			{
				color: false,
				unicode: true,
				hyperlinks: false,
				width: 100,
				cwd: process.cwd(),
			},
		);
		expect(pretty).toMatchSnapshot();
	});

	test('the drift fixture, fixed with the suggested SQL, matches', async () => {
		await pool.simpleQuery(
			readFileSync(new URL('./fixtures/drift.sql', import.meta.url), 'utf8'),
		);
		const report = await verify(driftSchema);
		const fixes = report.diagnostics
			.map((d) => d.fix?.replaceAll('<expression>', 'now()'))
			.filter((fix) => fix !== undefined);
		await pool.simpleQuery(
			[
				...fixes,
				// the parts the suggestions leave to people
				'alter table users drop column legacy_code',
				"alter table orders drop column search, add column search tsvector generated always as (to_tsvector('simple', total::text)) stored not null",
			].join(';\n'),
		);
		const after = await verify(driftSchema);
		expect(codes(after)).toEqual([
			['error', 'enum-label-mismatch', 'users.status'],
		]);
		expect(after.diagnostics[0]?.message).toBe(
			"enum user_status differs: the code lacks 'banned'",
		);
	});

	test('every column type quarry declares', async () => {
		const mood = defineEnum('mood', ['happy', 'sad']);
		const types = defineTable('all_types', {
			columns: {
				a: smallint(),
				b: integer(),
				c: bigint(),
				d: real(),
				e: doublePrecision(),
				f: decimal(),
				g: decimal(10, 2),
				h: boolean(),
				i: text(),
				j: varchar(),
				k: varchar(32),
				l: uuid(),
				m: bytea(),
				n: date(),
				o: time(),
				p: timestamp(),
				q: timestamptz(),
				r: interval(),
				s: jsonb(),
				t: inet(),
				u: tsvector(),
				v: daterange(),
				w: tstzrange(),
				x: mood(),
				y: array(text()),
				z: array(varchar(8)),
				aa: array(mood()).nullable(),
				ab: timestamptz(),
				ac: decimal(5),
			},
		});
		await pool.simpleQuery(`
			create type mood as enum ('happy', 'sad');
			create table all_types (
				a smallint not null, b integer not null, c bigint not null,
				d real not null, e double precision not null, f numeric not null,
				g numeric(10, 2) not null, h boolean not null, i text not null,
				j varchar not null, k varchar(32) not null, l uuid not null,
				m bytea not null, n date not null, o time not null,
				p timestamp not null, q timestamptz not null, r interval not null,
				s jsonb not null, t inet not null, u tsvector not null,
				v daterange not null, w tstzrange not null, x mood not null,
				y text[] not null, z varchar(8)[] not null, aa mood[],
				ab timestamptz(3) not null, ac decimal(5) not null
			)`);
		const report = await verify([types]);
		expect(report.diagnostics).toEqual([]);
		expect(report.ok).toBe(true);
		expect(report.tables[0]?.columns.map((c) => c.actual)).toEqual([
			'smallint',
			'integer',
			'bigint',
			'real',
			'double precision',
			'numeric',
			'numeric(10,2)',
			'boolean',
			'text',
			'varchar',
			'varchar(32)',
			'uuid',
			'bytea',
			'date',
			'time',
			'timestamp',
			'timestamptz',
			'interval',
			'jsonb',
			'inet',
			'tsvector',
			'daterange',
			'tstzrange',
			'mood',
			'text[]',
			'varchar(8)[]',
			'mood[] null',
			'timestamptz(3)',
			'numeric(5,0)',
		]);
	});

	test('types quarry has no factory for are named as postgres does', async () => {
		await pool.simpleQuery(
			'create table other (a json not null, b char(3) not null, c macaddr not null, d timetz not null)',
		);
		const table = defineTable('other', {
			columns: { a: jsonb(), b: text(), c: text(), d: time() },
		});
		const report = await verify([table]);
		expect(report.diagnostics.map((d) => d.actual)).toEqual([
			'json',
			'char(3)',
			'macaddr',
			'timetz',
		]);
	});

	test('names resolve through search_path, or in the schema option', async () => {
		await pool.simpleQuery(`
			create table accounts (id integer not null);
			create schema quarry_verify_other;
			create table quarry_verify_other.accounts (id bigint not null);
		`);
		const accounts = defineTable('accounts', { columns: { id: integer() } });
		expect((await verify([accounts])).tables[0]?.relation).toBe(
			`${schema}.accounts`,
		);
		expect((await verify([accounts])).ok).toBe(true);
		const other = await verify([accounts], { schema: 'quarry_verify_other' });
		expect(other.tables[0]?.relation).toBe('quarry_verify_other.accounts');
		expect(other.diagnostics[0]?.fix).toBe(
			'alter table quarry_verify_other.accounts alter column id type integer using id::integer;',
		);
		const missing = await verify([accounts], { schema: 'nope' });
		expect(codes(missing)).toEqual([['error', 'table-missing', 'accounts']]);
	});

	test('quoted identifiers', async () => {
		await pool.simpleQuery(`
			create type "Status Kind" as enum ('On', 'off''s');
			create table "UserAccounts" (
				"First Name" text not null,
				"user" "Status Kind" not null,
				"a""b" integer
			)`);
		const kind = defineEnum('Status Kind', ['On', "off's"]);
		const table = defineTable('UserAccounts', {
			columns: {
				firstName: text().name('First Name'),
				user: kind(),
				ab: integer().name('a"b'),
			},
		});
		const report = await verify([table]);
		expect(codes(report)).toEqual([
			['error', 'column-nullable-mismatch', 'UserAccounts.a"b'],
		]);
		expect(report.diagnostics[0]?.fix).toBe(
			'alter table "UserAccounts" alter column "a""b" set not null;',
		);
		const missing = defineTable('Missing "T"', { columns: { x: text() } });
		expect((await verify([missing])).diagnostics[0]?.fix).toBe(
			'create table "Missing ""T""" (\n  x text not null\n);',
		);
	});

	test('partitioned tables, partitions, views and materialized views', async () => {
		await pool.simpleQuery(`
			create table events (id bigint not null, at date not null, note text)
				partition by range (at);
			create table events_2026 partition of events
				for values from ('2026-01-01') to ('2027-01-01');
			create view recent_events as select id, at, note from events;
			create materialized view event_counts as
				select at, count(*) as n from events group by at;
			create sequence some_sequence;
		`);
		const columns = {
			id: bigint(),
			at: date(),
			note: text().nullable(),
		};
		const tables = [
			defineTable('events', { columns }),
			defineTable('events_2026', { columns }),
			defineTable('recent_events', { columns }),
			defineTable('event_counts', {
				columns: { at: date(), n: integer() },
			}),
			defineTable('some_sequence', { columns: {} }),
		];
		const report = await verify(tables);
		expect(report.tables.map((t) => t.kind)).toEqual([
			'partitioned table',
			'table',
			'view',
			'materialized view',
			undefined,
		]);
		expect(codes(report)).toEqual([
			['error', 'column-type-mismatch', 'event_counts.n'],
			['error', 'table-missing', 'some_sequence'],
		]);
		expect(report.diagnostics[0]?.actual).toBe('bigint');
	});

	test('identities, serials, defaults and generated columns', async () => {
		const virtual = version >= 180000;
		await pool.simpleQuery(`
			create table filled (
				a integer generated always as identity,
				b integer generated by default as identity,
				c serial,
				d text not null default 'x',
				e integer generated always as (c * 2) stored
				${virtual ? ', f integer generated always as (c * 3) virtual' : ''}
			)`);
		const declared = {
			a: integer().identity(),
			b: integer().default(),
			c: integer().identity(),
			d: text().default(),
			e: integer().nullable().generated(),
		};
		const table = virtual
			? defineTable('filled', {
					columns: { ...declared, f: integer().nullable().generated() },
				})
			: defineTable('filled', { columns: declared });
		expect(codes(await verify([table]))).toEqual([
			['warning', 'column-identity-missing', 'filled.c'],
		]);

		const plain = {
			a: integer(),
			b: integer(),
			c: integer(),
			d: text(),
			e: integer().nullable(),
		};
		const undeclared = virtual
			? defineTable('filled', {
					columns: { ...plain, f: integer().nullable() },
				})
			: defineTable('filled', { columns: plain });
		const report = await verify([undeclared]);
		expect(codes(report)).toEqual([
			['error', 'column-identity-undeclared', 'filled.a'],
			['info', 'column-default-undeclared', 'filled.b'],
			['info', 'column-default-undeclared', 'filled.c'],
			['info', 'column-default-undeclared', 'filled.d'],
			['error', 'column-generated-undeclared', 'filled.e'],
			...(virtual
				? [['error', 'column-generated-undeclared', 'filled.f']]
				: []),
		]);
		expect(report.diagnostics.map((d) => d.actual)).toEqual([
			'generated always as identity',
			'generated by default as identity',
			"default nextval('filled_c_seq'::regclass)",
			"default 'x'::text",
			'generated always as ((c * 2)) stored',
			...(virtual ? ['generated always as ((c * 3)) virtual'] : []),
		]);
	});

	test('domains resolve to their base type', async () => {
		await pool.simpleQuery(`
			create domain email as text check (value like '%@%');
			create domain short_code as varchar(4) not null;
			create table contacts (a email not null, b short_code, c email[])`);
		const report = await verify([
			defineTable('contacts', {
				columns: { a: text(), b: varchar(8), c: array(text()).nullable() },
			}),
		]);
		expect(report.diagnostics.map((d) => [d.code, d.column, d.actual])).toEqual(
			[
				['column-type-mismatch', 'b', 'varchar(4) (domain short_code)'],
				// the domain's not null isn't the column's
				['column-nullable-mismatch', 'b', 'null'],
				['column-type-mismatch', 'c', 'email[]'],
			],
		);
	});

	test('a driver that returns every value as text gives the same report', async () => {
		await pool.simpleQuery(
			readFileSync(new URL('./fixtures/drift.sql', import.meta.url), 'utf8'),
		);
		const textual = await verify(
			driftSchema,
			undefined,
			new DriverExecutor(pool, {}, false, createCodecRegistry([], null)),
		);
		const parsed = await verify(driftSchema);
		expect(withoutDuration(textual)).toEqual(withoutDuration(parsed));
	});

	test('the catalog query runs in a read-only session', async () => {
		await pool.simpleQuery('create table readonly_t (a text not null)');
		const readOnly = poolOf({ default_transaction_read_only: 'on' });
		try {
			const report = await verify(
				[defineTable('readonly_t', { columns: { a: text() } })],
				undefined,
				new DriverExecutor(readOnly),
			);
			expect(report.ok).toBe(true);
		} finally {
			await readOnly.end();
		}
	});

	test('strict makes extra columns errors', async () => {
		await pool.simpleQuery('create table wide (a text not null, extra text)');
		const table = defineTable('wide', { columns: { a: text() } });
		expect((await verify([table])).ok).toBe(true);
		const strict = await verify([table], { strict: true });
		expect(strict.ok).toBe(false);
		expect(codes(strict)).toEqual([['error', 'column-extra', 'wide.extra']]);
	});

	test('no tables runs no query', async () => {
		const report = await verify([]);
		expect(report).toMatchObject({ ok: true, diagnostics: [], tables: [] });
	});
});
