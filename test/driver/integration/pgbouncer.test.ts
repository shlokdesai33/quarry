/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { describe, expect, it } from 'vitest';
import { cluster, open, pg, table } from './helpers.js';

const bouncer = () => ({
	host: cluster().host,
	port: cluster().bouncerPort ?? 0,
	user: 'postgres',
	password: undefined,
	ssl: 'disable' as const,
});

// PgBouncer runs in transaction mode with max_prepared_statements set, so
// server connections are shared between clients between transactions.
describe.skipIf(!pg?.bouncerPort)('PgBouncer in transaction mode', () => {
	it('negotiates protocol 3.2', async () => {
		await using conn = await open(bouncer());
		expect(conn.protocol).toBe('3.2');
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
});
