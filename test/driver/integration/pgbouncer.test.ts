/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { describe, expect, it } from 'vitest';
import { statementNames } from '../../../src/driver/capabilities.js';
import { typed } from '../../../src/driver/codec.js';
import { codecs } from '../../../src/driver/codecs.js';
import { DecodeError } from '../../../src/driver/errors.js';
import { versionAtLeast } from '../setup/cluster.js';
import { Transaction } from '../../../src/driver/transaction.js';
import { cluster, open, pg, recordingSockets, table } from './helpers.js';

// named prepared statements in transaction mode need PgBouncer 1.21+
const prepare = versionAtLeast(pg?.bouncerVersion, 1, 21);

const bouncer = () => ({
	host: cluster().host,
	port: cluster().bouncerPort ?? 0,
	user: 'postgres',
	password: undefined,
	ssl: 'disable' as const,
	prepare,
});

/** A statement selecting `n` and its parameter. */
const numbered = (n: number) => `select ${n}::int as n, $1::text as s`;

/** `n` queries issued together, so a connection pipelines them. */
const pipelined = <R>(n: number, query: () => Promise<R>) =>
	Promise.allSettled(Array.from({ length: n }, query));

// PgBouncer runs in transaction mode with max_prepared_statements set, so
// server connections are shared between clients between transactions.
describe.skipIf(!pg?.bouncerPort)('PgBouncer in transaction mode', () => {
	it('negotiates a protocol version', async () => {
		await using conn = await open(bouncer());
		expect(['3.0', '3.2']).toContain(conn.protocol);
	});

	it('runs pipelined prepared statements from many clients over few server connections', async () => {
		const clients = await Promise.all(
			Array.from({ length: 16 }, () => open(bouncer())),
		);
		try {
			const results = await Promise.all(
				clients.flatMap((conn, c) =>
					Array.from({ length: 50 }, (_, i) =>
						conn.query<{ v: number; w: string }>(
							i % 2
								? 'select $1::int as v, $2::text as w'
								: 'select $2::text as w, $1::int as v',
							[c * 1000 + i, `c${c}`],
						),
					),
				),
			);
			expect(results).toHaveLength(800);
			results.forEach((r, n) => {
				const c = Math.floor(n / 50);
				expect(r.rows[0]).toEqual({ v: c * 1000 + (n % 50), w: `c${c}` });
			});
		} finally {
			await Promise.all(clients.map((c) => c.close()));
		}
	});

	it('keeps transactions on one server connection, with errors and rollback', async () => {
		await using setup = await open(bouncer());
		const name = table('bouncer');
		await setup.query(`create table ${name} (id int primary key)`);
		const clients = await Promise.all(
			Array.from({ length: 8 }, () => open(bouncer())),
		);
		try {
			await Promise.all(
				clients.map(async (conn, c) => {
					for (let i = 0; i < 10; i++) {
						await conn.query('begin');
						await conn.query(`insert into ${name} values ($1)`, [c * 100 + i]);
						if (i % 3 === 0) {
							await expect(
								conn.query(`insert into ${name} values ($1)`, [c * 100 + i]),
							).rejects.toThrow(/duplicate key/);
							await conn.query('rollback');
						} else {
							await conn.query('commit');
						}
					}
				}),
			);
			const { rows } = await setup.query<{ n: number }>(
				`select count(*)::int as n from ${name}`,
			);
			expect(rows[0]?.n).toBe(8 * 6);
		} finally {
			await Promise.all(clients.map((c) => c.close()));
			await setup.query(`drop table ${name}`);
		}
	});

	it('evicts cached statements safely through the pooler', async () => {
		await using conn = await open({ ...bouncer(), statementCacheSize: 3 });
		const results = await Promise.all(
			Array.from({ length: 60 }, (_, i) =>
				conn.query<{ v: number }>(`select ${i % 10} + $1::int as v`, [i]),
			),
		);
		expect(results.map((r) => r.rows[0]?.v)).toEqual(
			Array.from({ length: 60 }, (_, i) => (i % 10) + i),
		);
	});

	it('streams with a cursor and cancels through the pooler', async () => {
		await using conn = await open(bouncer());
		let count = 0;
		for await (const batch of conn.cursor(
			'select generate_series(1, 5000)',
			[],
			{ batchSize: 1000 },
		))
			count += batch.length;
		expect(count).toBe(5000);
		await expect(
			conn.query('select pg_sleep(10)', [], { timeout: 200 }),
		).rejects.toThrow(/cancel/);
		expect((await conn.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});

	it.skipIf(!prepare)(
		'recovers when a schema change makes the pooler’s prepared statements stale',
		async () => {
			const name = table('bounce');
			await using conn = await open(bouncer());
			const select = () => conn.query<{ x: unknown }>(`select x from ${name}`);
			await conn.query(`create table ${name} (x int)`);
			await conn.query(`insert into ${name} values (1)`);
			expect((await select()).rows).toEqual([{ x: 1 }]);
			expect((await select()).rows).toEqual([{ x: 1 }]);
			await conn.query(`alter table ${name} alter column x type text`);
			// PgBouncer maps a new Parse of the same text to its stale statement
			for (let i = 0; i < 3; i++)
				expect((await select()).rows).toEqual([{ x: '1' }]);
			await conn.query(`drop table ${name}`);
		},
	);

	// PgBouncer 1.26 reports itself at login, so pipelined queries go unnamed
	describe.skipIf(!versionAtLeast(pg?.bouncerVersion, 1, 26))(
		'pipelined queries, sent unnamed',
		() => {
			it('are detected from what PgBouncer reports', async () => {
				await using conn = await open(bouncer());
				expect(conn.capabilities.pgbouncer).toMatchObject({
					poolMode: 'transaction',
					maxPreparedStatements: 200,
				});
				expect(statementNames(conn.capabilities.pgbouncer)).toBe('rewritten');
			});

			it('are decoded with the cached columns, in binary', async () => {
				await using conn = await open(bouncer());
				const sql =
					'select $1::int as i, $2::float8 as f, $3::bool as b, $4::text as s';
				const params = [7, 1.5, true, 'x'];
				const first = await conn.query(sql, params);
				expect(first.fields.map((f) => f.format)).toEqual([0, 0, 0, 0]);
				const results = await pipelined(20, () => conn.query(sql, params));
				for (const result of results) {
					expect(result).toMatchObject({
						status: 'fulfilled',
						value: { rows: [{ i: 7, f: 1.5, b: true, s: 'x' }] },
					});
					if (result.status === 'fulfilled')
						expect(result.value.fields.map((f) => f.format)).toEqual([
							1, 1, 1, 0,
						]);
				}
			});

			it('ask for their codecs’ formats once described, and read a changed column by its new type', async () => {
				const name = table('bounce_codecs');
				await using conn = await open(bouncer());
				await conn.query(`create table ${name} (i int4, s text)`);
				await conn.query(`insert into ${name} values (7, 'x')`);
				const sql = `select i, s, now() as t from ${name} where i = $1`;
				const params = [typed(7, codecs.int4)];
				const resultCodecs = [codecs.int4, codecs.text, codecs.timestamptz];
				const first = await conn.query(sql, params, { resultCodecs });
				expect(first.fields.map((f) => f.format)).toEqual([0, 0, 0]);
				const check = async (i: unknown, formats?: number[]) => {
					for (const result of await pipelined(10, () =>
						conn.query(sql, params, { resultCodecs }),
					)) {
						expect(result).toMatchObject({
							status: 'fulfilled',
							value: { rows: [{ i, s: 'x', t: expect.any(Date) }] },
						});
						if (result.status === 'fulfilled' && formats !== undefined)
							expect(result.value.fields.map((f) => f.format)).toEqual(formats);
					}
				};
				await check(7, [1, 0, 1]);
				await conn.query(`alter table ${name} alter column i type int8`);
				// read by the registry's int8 (a bigint): stale named ones are prepared
				// again, unnamed ones read by the portal's description
				await check(7n);
				await check(7n);
				await conn.query(`drop table ${name}`);
			});

			it('read the new columns after a schema change', async () => {
				const name = table('bounce_pipe');
				await using conn = await open(bouncer());
				const select = () =>
					conn.query<{ x: unknown; y: unknown }>(`select x, y from ${name}`);
				await conn.query(`create table ${name} (x int, y int)`);
				await conn.query(`insert into ${name} values (1, 2)`);
				for (const r of await pipelined(5, select))
					expect(r).toMatchObject({ value: { rows: [{ x: 1, y: 2 }] } });
				await pipelined(5, select);
				// to a type whose binary is its text, and one with a binary decoder
				await conn.query(
					`alter table ${name} alter column x type text, alter column y type float8`,
				);
				for (const r of await pipelined(5, select))
					expect(r).toMatchObject({ value: { rows: [{ x: '1', y: 2 }] } });
				for (const r of await pipelined(5, select))
					expect(r).toMatchObject({ value: { rows: [{ x: '1', y: 2 }] } });
				await conn.query(`drop table ${name}`);
			});

			it('fail alone when a column asked for in binary changed to a type read in text', async () => {
				const name = table('bounce_pipe');
				await using conn = await open(bouncer());
				const select = () =>
					conn.query<{ x: unknown }>(`select x from ${name}`);
				await conn.query(`create table ${name} (x int)`);
				await conn.query(`insert into ${name} values (1)`);
				await select();
				await conn.query(`alter table ${name} alter column x type numeric`);
				const results = await pipelined(5, select);
				for (const r of results) {
					expect(r.status).toBe('rejected');
					if (r.status === 'rejected') {
						expect(r.reason).toBeInstanceOf(DecodeError);
						expect(r.reason).toMatchObject({ column: 'x', typeOid: 1700 });
					}
				}
				for (const r of await pipelined(5, select))
					expect(r).toMatchObject({ value: { rows: [{ x: '1' }] } });
				expect((await select()).rows).toEqual([{ x: '1' }]);
				await conn.query(`drop table ${name}`);
			});

			it('include the statements of a batch, but not a transaction’s first one', async () => {
				const net = recordingSockets();
				await using conn = await open({ ...bouncer(), socket: net.factory });
				const statements = [1, 2, 3].map((n) => ({
					sql: numbered(n),
					params: ['x'],
				}));
				const rows = [1, 2, 3].map((n) => ({ n, s: 'x' }));
				// alone in the queue: COMMIT waits for verify
				const { done } = Transaction.batch(conn, statements, {
					verify: () => {},
				});
				expect((await done).map((r) => r.rows[0])).toEqual(rows);
				// inside a transaction, with BEGIN
				const grouped = await conn.transaction((tx) =>
					Promise.all(tx.queryGroup(statements)),
				);
				expect(grouped.map((r) => r.rows[0])).toEqual(rows);
				await conn.transaction((tx) => tx.query(numbered(4), ['x']));
				await conn.transaction((tx) => tx.query(numbered(4), ['x']));
				// Parse: type, length, statement name, SQL
				const parses = [
					...net.sent().matchAll(/P[\s\S]{4}(q\d+)?\0select (\d)/g),
				].map(([, name, n]) => `${n}:${name === undefined ? '' : 'named'}`);
				expect(parses).toEqual([
					'1:',
					'2:',
					'3:',
					'1:',
					'2:',
					'3:',
					// alone under its Sync but for BEGIN: unnamed on its first
					// run, named on its second
					'4:',
					'4:named',
				]);
			});
		},
	);
});
