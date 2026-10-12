import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseConfig, schemaTables } from '../../src/cli/config.js';
import { ConnectionError } from '../../src/driver/errors.js';
import { text } from '../../src/column-factories.js';
import { defineTable } from '../../src/define-table.js';
import { type Io, runCli, usage } from '../../src/cli/run.js';
import { databaseWith } from '../../src/database.js';
import { fakeExecutor } from '../helpers/executor.js';
import * as fixtures from './fixtures/schema.js';
import { schema as driftSchema, users } from './fixtures/schema.js';
import {
	postgresAvailable,
	schema,
	startDatabase,
	type TestDatabase,
} from './helpers/postgres.js';

const configPath = fileURLToPath(
	new URL('./fixtures/quarry.config.ts', import.meta.url),
);

function io(overrides: Partial<Io> = {}) {
	const out = { stdout: '', stderr: '' };
	const value: Io = {
		stdout: {
			isTTY: false,
			write: (chunk: string) => (out.stdout += chunk),
		},
		stderr: { write: (chunk: string) => (out.stderr += chunk) },
		cwd: process.cwd(),
		env: {},
		...overrides,
	};
	return { io: value, out };
}

describe('arguments', () => {
	test('--help', async () => {
		const { io: streams, out } = io();
		expect(await runCli(['--help'], streams)).toBe(0);
		expect(out.stdout).toBe(usage);
	});

	test.each([
		[[], 'No command given'],
		[['diff'], 'Unknown command: diff'],
		[['verify', 'x'], 'Unknown command: verify x'],
		[['verify', '--format', 'xml'], 'Unknown format: xml'],
		[['verify', '--bogus'], "Unknown option '--bogus'"],
		[['verify', '--config', 'nope.ts'], 'No config at'],
	])('%j fails with usage', async (argv, message) => {
		const { io: streams, out } = io();
		expect(await runCli(argv, streams)).toBe(2);
		expect(out.stderr).toContain(message);
	});

	test('no config in the directory', async () => {
		const { io: streams, out } = io({ cwd: '/' });
		expect(await runCli(['verify'], streams)).toBe(2);
		expect(out.stderr).toContain('No quarry.config.ts in /');
	});

	test('a config without db or schema', async () => {
		const { io: streams, out } = io({ load: async () => ({ schema: [] }) });
		expect(await runCli(['verify', '--config', configPath], streams)).toBe(2);
		expect(out.stderr).toContain('the config must export `db`');
	});
});

describe('config', () => {
	test('exports may be the default export or named', () => {
		const db = databaseWith(fakeExecutor().executor);
		const named = parseConfig({ db, schema: [users] });
		const fallback = parseConfig({ default: { db, schema: [users] } });
		expect(typeof named).toBe('object');
		expect(typeof fallback).toBe('object');
		expect(parseConfig({ db })).toBe(
			'the config must export `schema`, the tables to check',
		);
		expect(parseConfig(undefined)).toBe('the config module has no exports');
	});

	test('close defaults to db.close()', async () => {
		let closed = 0;
		const db = {
			verify: async () => {
				throw new Error('unused');
			},
			close: async () => {
				closed++;
			},
		};
		const config = parseConfig({ db, schema: [] });
		await (typeof config === 'object' ? config.close?.() : undefined);
		expect(closed).toBe(1);
		const own = parseConfig({
			db,
			schema: [],
			close: () => {
				closed += 10;
			},
		});
		await (typeof own === 'object' ? own.close?.() : undefined);
		expect(closed).toBe(11);
	});

	test('a failing check prints one line, exits 2 and still closes', async () => {
		let closed = false;
		const failing = {
			verify: async () => {
				throw new ConnectionError('connect ECONNREFUSED 127.0.0.1:5432', {
					code: 'ECONNREFUSED',
				});
			},
			close: async () => {
				closed = true;
			},
		};
		const { io: streams, out } = io({
			load: async () => ({ db: failing, schema: [users] }),
		});
		expect(await runCli(['verify', '--config', configPath], streams)).toBe(2);
		expect(out.stderr).toBe(
			'quarry verify: ConnectionError: connect ECONNREFUSED 127.0.0.1:5432\n  (set QUARRY_DEBUG=1 for the stack trace)\n',
		);
		expect(closed).toBe(true);
		const debug = io({
			env: { QUARRY_DEBUG: '1' },
			load: async () => ({ db: failing, schema: [users] }),
		});
		await runCli(['verify', '--config', configPath], debug.io);
		expect(debug.out.stderr).toMatch(
			/^quarry verify: ConnectionError: .*\n {4}at /,
		);
	});

	test('a schema module namespace keeps only its tables', () => {
		expect(
			schemaTables({ users, status: () => {}, n: 1, nothing: null }),
		).toEqual([users]);
		expect(schemaTables(driftSchema)).toHaveLength(3);
		const { invoices, orders } = fixtures;
		expect(schemaTables({ invoices, orders, users })).toEqual([
			users,
			orders,
			invoices,
		]);
	});
});

describe.skipIf(!postgresAvailable)('quarry verify against PostgreSQL', () => {
	let db: TestDatabase;
	const env = { QUARRY_VERIFY_CONFIG_POOL: '' };

	beforeAll(async () => {
		db = await startDatabase();
		await db.sql(
			readFileSync(new URL('./fixtures/drift.sql', import.meta.url), 'utf8'),
		);
		const { host, user, database: name } = db.pool.options;
		env.QUARRY_VERIFY_CONFIG_POOL = JSON.stringify({
			host,
			user,
			database: name,
			connectionString: process.env['QUARRY_TEST_DATABASE_URL'],
			options: `-c search_path=${schema}`,
		});
		process.env['QUARRY_VERIFY_CONFIG_POOL'] = env.QUARRY_VERIFY_CONFIG_POOL;
	});
	afterAll(async () => {
		delete process.env['QUARRY_VERIFY_CONFIG_POOL'];
		await db?.stop();
	});

	test('loads quarry.config.ts and exits 1 on errors', async () => {
		const { io: streams, out } = io();
		expect(await runCli(['verify', '--config', configPath], streams)).toBe(1);
		expect(out.stderr).toBe('');
		expect(out.stdout).toContain(
			'  × quarry(column-type-mismatch): users.email is varchar(320) in the database',
		);
		expect(out.stdout).toContain('╭─[test/verify/fixtures/schema.ts:23:10]');
		expect(out.stdout).toMatch(
			/ {2}✖ 8 errors, 2 warnings · 3 tables, 14 columns checked in \d+ms\n$/,
		);
		expect(out.stdout).not.toContain('\u001B[');
	});

	test('a config found in the working directory', async () => {
		const { io: streams, out } = io({
			cwd: fileURLToPath(new URL('./fixtures', import.meta.url)),
		});
		expect(await runCli(['verify', '--format', 'json'], streams)).toBe(1);
		const report: unknown = JSON.parse(out.stdout);
		expect(report).toMatchObject({
			ok: false,
			summary: { errors: 8, warnings: 2 },
		});
	});

	test('--format github, --strict, --ascii and --color', async () => {
		const github = io({ env: { GITHUB_WORKSPACE: process.cwd() } });
		expect(
			await runCli(
				['verify', '--config', configPath, '--format=github'],
				github.io,
			),
		).toBe(1);
		expect(github.out.stdout.split('\n')[0]).toMatch(
			/^::error file=test\/verify\/fixtures\/schema\.ts,line=23,col=10,title=quarry\(column-type-mismatch\)::/,
		);

		const ascii = io();
		await runCli(
			['verify', '--config', configPath, '--ascii', '--color', '--strict'],
			ascii.io,
		);
		expect(ascii.out.stdout).toContain('\u001B[31mx\u001B[39m');
		const uncoloured = stripVTControlCharacters(ascii.out.stdout);
		expect(uncoloured).toContain(',-[test/verify/fixtures/schema.ts');
		expect(uncoloured).toContain('9 errors, 1 warning');
	});

	test('exits 0 with only notes, and closes the config', async () => {
		await db.sql('create table only_notes (a text, extra text)');
		const table = defineTable('only_notes', {
			columns: { a: text().nullable() },
		});
		let closed = false;
		const { io: streams, out } = io({
			load: async () => ({
				db: databaseWith(db.executor),
				schema: { table },
				close: () => {
					closed = true;
				},
			}),
		});
		expect(
			await runCli(
				['verify', '--config', configPath, '--format', 'table'],
				streams,
			),
		).toBe(0);
		expect(closed).toBe(true);
		expect(out.stdout).toContain('ℹ extra');
		expect(out.stdout).toContain('ℹ 1 note');
	});
});
