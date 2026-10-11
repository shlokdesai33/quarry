/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '../../../src/driver/connection.js';
import {
	AbortError,
	ConnectionError,
	DriverError,
	QueryCanceled,
	ReadOnlyTransaction,
	UniqueViolation,
} from '../../../src/driver/errors.js';
import { createPool, type PoolOptions } from '../../../src/driver/pool.js';
import { TransactionRolledBack } from '../../../src/driver/transaction.js';
import { noPg, open, options, rejection, table } from './helpers.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pool = (overrides: PoolOptions = {}) =>
	createPool({ ...options(), ...overrides });

describe.skipIf(noPg)('transactions', () => {
	let conn: Connection;
	let name: string;
	beforeAll(async () => {
		conn = await open();
		name = table('tx');
		await conn.query(`create table ${name} (id int primary key, v text)`);
	});
	afterAll(async () => {
		await conn?.query(`drop table if exists ${name}`);
		await conn?.close();
	});
	const ids = async () =>
		(
			await conn.query<{ id: number }>(`select id from ${name} order by id`)
		).rows.map((r) => r.id);

	it('commits on success and rolls back on error', async () => {
		await conn.query(`truncate ${name}`);
		const value = await conn.transaction(async (tx) => {
			await tx.query(`insert into ${name} values (1, 'a')`);
			return 'done';
		});
		expect(value).toBe('done');
		await expect(
			conn.transaction(async (tx) => {
				await tx.query(`insert into ${name} values (2, 'b')`);
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');
		expect(await ids()).toEqual([1]);
		expect(conn.transactionStatus).toBe('idle');
	});

	it('nests savepoints', async () => {
		await conn.query(`truncate ${name}`);
		await conn.transaction(async (tx) => {
			await tx.query(`insert into ${name} values (1, 'outer')`);
			await expect(
				tx.transaction(async (inner) => {
					expect(inner.depth).toBe(1);
					await inner.query(`insert into ${name} values (2, 'inner')`);
					await inner.query(`insert into ${name} values (1, 'dup')`);
				}),
			).rejects.toBeInstanceOf(UniqueViolation);
			await tx.transaction(async (inner) => {
				await inner.query(`insert into ${name} values (3, 'kept')`);
			});
			await expect(
				tx.transaction(async () => {}, { durable: true }),
			).rejects.toThrow(/durable/);
			await expect(
				tx.transaction(async () => {}, { isolation: 'serializable' }),
			).rejects.toThrow(/outermost/);
		});
		expect(await ids()).toEqual([1, 3]);
	});

	it('refuses to start inside an open transaction', async () => {
		await using c = await open();
		await c.query('begin');
		await expect(c.transaction(async () => {})).rejects.toThrow(
			/already in a transaction/,
		);
		await c.query('rollback');
	});

	it('applies isolation, read-only and settings with bound parameters', async () => {
		const seen = await conn.transaction(
			async (tx) => {
				await expect(
					tx.transaction((sp) =>
						sp.query(`insert into ${name} values (99, 'x')`),
					),
				).rejects.toBeInstanceOf(ReadOnlyTransaction);
				return 'ok';
			},
			{ isolation: 'serializable', readOnly: true, deferrable: true },
		);
		expect(seen).toBe('ok');
		const settings = await conn.transaction(
			async (tx) => {
				await tx.setLocal('app.user_id', 42);
				const { rows } = await tx.query<Record<string, string>>(
					"select current_setting('app.tenant_id') as tenant, current_setting('app.user_id') as uid, current_setting('transaction_isolation') as iso",
				);
				return rows[0];
			},
			{
				isolation: 'repeatable read',
				settings: { 'app.tenant_id': "t'; drop table x; --" },
			},
		);
		expect(settings).toEqual({
			tenant: "t'; drop table x; --",
			uid: '42',
			iso: 'repeatable read',
		});
		const after = await conn.query<{ v: string | null }>(
			"select current_setting('app.tenant_id', true) as v",
		);
		expect(after.rows[0]?.v ?? '').toBe('');
		await expect(
			conn.transaction(async () => {}, { settings: { 'bad name;': 1 } }),
		).rejects.toThrow(/Invalid setting name/);
	});

	it('runs afterCommit and afterRollback callbacks at the right time', async () => {
		const events: string[] = [];
		await conn.transaction(async (tx) => {
			tx.afterCommit(() => events.push('outer commit'));
			await tx.transaction(async (sp) => {
				sp.afterCommit(() => events.push('savepoint commit'));
			});
			await tx
				.transaction(async (sp) => {
					sp.afterCommit(() => events.push('dropped'));
					sp.afterRollback(() => events.push('savepoint rollback'));
					throw new Error('x');
				})
				.catch(() => {});
			events.push('body done');
		});
		await conn
			.transaction(async (tx) => {
				tx.afterCommit(() => events.push('never'));
				tx.afterRollback(() => events.push('rolled back'));
				throw new Error('y');
			})
			.catch(() => {});
		expect(events).toEqual([
			'savepoint rollback',
			'body done',
			'outer commit',
			'savepoint commit',
			'rolled back',
		]);
	});

	it('detects a commit that rolled back because an error was swallowed', async () => {
		await expect(
			conn.transaction(async (tx) => {
				await tx.query('select 1/0').catch(() => {});
			}),
		).rejects.toBeInstanceOf(TransactionRolledBack);
	});

	it('refuses use after the transaction finished', async () => {
		let leaked: { query(sql: string): Promise<unknown> } | undefined;
		await conn.transaction(async (tx) => {
			leaked = tx;
		});
		await expect(leaked?.query('select 1')).rejects.toThrow(/already finished/);
	});

	it('retries serialization failures', async () => {
		await conn.query(`truncate ${name}`);
		await using a = await open();
		await using b = await open();
		let attempts = 0;
		let arrived = 0;
		const { promise: barrier, resolve: release } =
			Promise.withResolvers<void>();
		const work = (c: Connection, id: number) =>
			c.transaction(
				async (tx) => {
					attempts++;
					const { rows } = await tx.query<{ n: number }>(
						`select count(*)::int as n from ${name}`,
					);
					if (++arrived === 2) release();
					await barrier;
					await tx.query(`insert into ${name} values ($1, $2)`, [
						id,
						`saw ${rows[0]?.n}`,
					]);
				},
				{ isolation: 'serializable', retries: 5, retryDelay: () => 5 },
			);
		await Promise.all([work(a, 1), work(b, 2)]);
		expect(await ids()).toEqual([1, 2]);
		expect(attempts).toBeGreaterThan(2);
	});

	it('applies a per-query server-side statement timeout without leaking it', async () => {
		const error = await rejection(
			conn.query('select pg_sleep(5)', [], { statementTimeout: 100 }),
			QueryCanceled,
		);
		expect(error.reason).toBe('statement_timeout');
		expect(conn.transactionStatus).toBe('idle');
		expect(
			(await conn.query("select current_setting('statement_timeout') as t"))
				.rows,
		).toEqual([{ t: '0' }]);
		const ok = await conn.query('select 1 as x', [], {
			statementTimeout: '2s',
		});
		expect(ok.rows).toEqual([{ x: 1 }]);
		await conn.transaction(async (tx) => {
			await tx.query("set local statement_timeout = '7s'");
			await tx.query('select 1', [], { statementTimeout: 50 });
			expect(
				(await tx.query("select current_setting('statement_timeout') as t"))
					.rows,
			).toEqual([{ t: '7s' }]);
		});
	});
});

describe.skipIf(noPg)('pool', () => {
	it('runs queries and never exceeds max', async () => {
		await using p = pool({ max: 4, applicationName: 'pool-max' });
		let peak = 0;
		await Promise.all(
			Array.from({ length: 40 }, async (_, i) => {
				const { rows } = await p.query<{ v: number }>(
					'select $1::int as v, pg_sleep(0.01)',
					[i],
				);
				peak = Math.max(peak, p.stats.total);
				expect(rows[0]?.v).toBe(i);
			}),
		);
		expect(peak).toBeLessThanOrEqual(4);
		expect(p.stats).toMatchObject({ total: 4, idle: 4, busy: 0, waiting: 0 });
	});

	it('pipelines queries onto shared connections once the pool is full', async () => {
		await using p = pool({ max: 2, pipeline: 50 });
		await Promise.all([p.query('select 1'), p.query('select 1')]);
		// the second connection may still be opening after both queries ran
		while (p.stats.idle < 2) await sleep(5);
		let maxWaiting = 0;
		const run = (count: number) =>
			Promise.allSettled(
				Array.from({ length: count }, (_, i) => {
					const q =
						i % 25 === 7
							? p.query('select 1/0')
							: p.query<{ v: number }>('select $1::int as v', [i]);
					maxWaiting = Math.max(maxWaiting, p.stats.waiting);
					return q;
				}),
			);
		// up to 2 × 50 in flight: nobody waits
		const results = await run(100);
		expect(maxWaiting).toBe(0);
		results.forEach((r, i) => {
			if (i % 25 === 7) expect(r.status).toBe('rejected');
			else
				expect(r.status === 'fulfilled' && r.value.rows[0]).toEqual({ v: i });
		});
		// beyond that, the rest wait their turn and still complete
		const more = await run(300);
		expect(maxWaiting).toBe(200);
		expect(more.filter((r) => r.status === 'fulfilled')).toHaveLength(288);
		expect(p.stats).toMatchObject({ total: 2, busy: 0, idle: 2 });
	});

	it('gives every query its own connection with pipeline: false', async () => {
		await using p = pool({ max: 1, pipeline: false });
		await p.query('select 1');
		let maxWaiting = 0;
		await Promise.all(
			Array.from({ length: 20 }, () => {
				const q = p.query('select 1');
				maxWaiting = Math.max(maxWaiting, p.stats.waiting);
				return q;
			}),
		);
		expect(maxWaiting).toBeGreaterThan(0);
	});

	it('lets a waiting acquire in while queries are being pipelined', async () => {
		await using p = pool({ max: 1 });
		await p.query('select 1');
		const busy = Array.from({ length: 10 }, () =>
			p.query('select pg_sleep(0.02)'),
		);
		const client = p.acquire();
		const later = p.query('select 2 as x');
		const order: string[] = [];
		await Promise.all([
			client.then((c) => {
				order.push('acquired');
				return c.release();
			}),
			later.then(() => order.push('later query')),
			...busy,
		]);
		expect(order).toEqual(['acquired', 'later query']);
	});

	it('times out, aborts and limits waiting acquires', async () => {
		await using p = pool({ max: 1, acquireTimeout: 100, maxWaiting: 1 });
		await using held = await p.acquire();
		const timedOut = await rejection(p.acquire(), ConnectionError);
		expect(timedOut.code).toBe('ETIMEDOUT');
		const controller = new AbortController();
		const aborted = p.acquire({ signal: controller.signal });
		await expect(p.acquire()).rejects.toThrow(/maxWaiting/);
		controller.abort();
		await expect(aborted).rejects.toBeInstanceOf(AbortError);
		expect((await held.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
	});

	it('hands released connections to waiters in order', async () => {
		await using p = pool({ max: 1 });
		const order: number[] = [];
		const first = await p.acquire();
		const waiting = [1, 2, 3].map(async (n) => {
			const client = await p.acquire();
			order.push(n);
			client.release();
		});
		first.release();
		await Promise.all(waiting);
		expect(order).toEqual([1, 2, 3]);
	});

	it('closes idle connections and recycles old ones', async () => {
		await using idle = pool({ idleTimeout: 50 });
		await idle.query('select 1');
		expect(idle.stats.total).toBe(1);
		await sleep(200);
		expect(idle.stats.total).toBe(0);

		await using old = pool({ maxLifetime: 50 });
		const a = await old.acquire();
		const pidA = a.connection.processId;
		a.release();
		await sleep(100);
		const b = await old.acquire();
		expect(b.connection.processId).not.toBe(pidA);
		b.release();
	});

	it('keeps min connections open', async () => {
		await using p = pool({ min: 2, idleTimeout: 20 });
		await sleep(150);
		expect(p.stats.total).toBe(2);
	});

	it('replaces connections that die while idle', async () => {
		await using p = pool({ max: 1 });
		const client = await p.acquire();
		const pid = client.connection.processId;
		client.release();
		await using admin = await open();
		await admin.query('select pg_terminate_backend($1)', [pid]);
		await sleep(100);
		const { rows } = await p.query<{ pid: number }>(
			'select pg_backend_pid() as pid',
		);
		expect(rows[0]?.pid).not.toBe(pid);
	});

	it('never reuses a connection released mid-transaction', async () => {
		await using p = pool({ max: 1 });
		const client = await p.acquire();
		const pid = client.connection.processId;
		await client.query('begin');
		client.release();
		const { rows } = await p.query<{ pid: number; tx: string }>(
			"select pg_backend_pid() as pid, current_setting('transaction_isolation') as tx",
		);
		expect(rows[0]?.pid).not.toBe(pid);
	});

	it('runs onConnect for each new connection', async () => {
		await using p = pool({
			onConnect: (c) =>
				c.query("set search_path = 'pg_catalog'").then(() => undefined),
		});
		expect((await p.query('show search_path')).rows).toEqual([
			{ search_path: 'pg_catalog' },
		]);
	});

	it('supports transactions, cursors and await using clients', async () => {
		await using p = pool({ max: 2 });
		const n = await p.transaction(
			async (tx) => (await tx.query<{ n: number }>('select 5 as n')).rows[0]?.n,
		);
		expect(n).toBe(5);
		let total = 0;
		for await (const row of p.stream<{ n: number }>(
			'select generate_series(1, 100) as n',
			[],
			{ batchSize: 10 },
		))
			total += row.n;
		expect(total).toBe(5050);
		{
			await using client = await p.acquire();
			await client.query('select 1');
			expect(p.stats.busy).toBe(1);
		}
		expect(p.stats.busy).toBe(0);
	});

	it('ends: waiters fail and later queries are refused', async () => {
		const p = pool({ max: 1 });
		const held = await p.acquire();
		const waiting = p.acquire();
		const ending = p.end();
		await expect(waiting).rejects.toThrow(/ended/);
		held.release();
		await ending;
		await expect(p.query('select 1')).rejects.toBeInstanceOf(DriverError);
	});

	it('listens on a dedicated connection and re-subscribes after it drops', async () => {
		await using p = pool();
		const received: string[] = [];
		const unlisten = await p.listen('pool_events', (n) =>
			received.push(n.payload),
		);
		await p.query("select pg_notify('pool_events', 'one')");
		await sleep(100);
		await using admin = await open();
		await admin.query(
			'select pg_terminate_backend(pid) from pg_stat_activity where query = \'listen "pool_events"\' and pid <> pg_backend_pid()',
		);
		await sleep(600);
		await p.query("select pg_notify('pool_events', 'two')");
		await sleep(100);
		expect(received).toEqual(['one', 'two']);
		await unlisten();
	});
});
