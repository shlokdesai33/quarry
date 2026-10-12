/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '../../../src/driver/connection.js';
import {
	AbortError,
	ConnectionError,
	DriverError,
	QueryCanceled,
	ReadOnlyTransaction,
	TransactionTimeout,
	UniqueViolation,
} from '../../../src/driver/errors.js';
import { connect } from '../../../src/driver/connect.js';
import { createPool, type PoolOptions } from '../../../src/driver/pool.js';
import { TransactionRolledBack } from '../../../src/driver/transaction.js';
import {
	noPg,
	open,
	options,
	rejection,
	slowSockets,
	table,
} from './helpers.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long `work` takes, in milliseconds. */
const waited = async (work: () => Promise<unknown>) => {
	const started = performance.now();
	await work();
	return performance.now() - started;
};
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

	it('ends a transaction that outlives its timeout', async () => {
		await using p = pool({ max: 1 });
		const error = await rejection(
			p.transaction(
				async (tx) => {
					await tx.query('select pg_sleep(0.1)');
					await tx.query('select pg_sleep(0.3)');
				},
				{ timeout: 200 },
			),
			TransactionTimeout,
		);
		expect(error.code).toBe('25P04');
		expect((await p.query('select 1 as x')).rows).toEqual([{ x: 1 }]);
		const ok = await p.transaction(
			async (tx) =>
				(
					await tx.query<{ t: string }>(
						"select current_setting('transaction_timeout') as t",
					)
				).rows[0]?.t,
			{ timeout: '5s' },
		);
		expect(ok).toBe('5s');
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

	it('keeps pipelining one connection when callers outnumber `pipeline`', async () => {
		const net = slowSockets(10);
		await using p = pool({ max: 1, pipeline: 10, socket: net.factory });
		await p.query('select $1::int as v', [0]);
		net.reset();
		const started = performance.now();
		const values = await Promise.all(
			Array.from({ length: 200 }, async (_, i) => {
				const { rows } = await p.query<{ v: number }>('select $1::int as v', [
					i,
				]);
				return rows[0]?.v;
			}),
		);
		const elapsed = performance.now() - started;
		expect(values).toEqual(Array.from({ length: 200 }, (_, i) => i));
		expect(net.maxInFlight()).toBe(10);
		// 10 per 10 ms round trip: ~200 ms; one query per round trip would take ~2 s
		expect(elapsed).toBeLessThan(1000);
		expect(p.stats).toMatchObject({ total: 1, idle: 1, busy: 0, waiting: 0 });
	});

	it('keeps pipelining under sustained load beyond max × pipeline', async () => {
		const net = slowSockets(10);
		await using p = pool({ max: 2, socket: net.factory });
		await Promise.all([p.query('select 1'), p.query('select 1')]);
		while (p.stats.idle < 2) await sleep(5);
		await p.query('select $1::int as v', [0]);
		net.reset();
		let maxWaiting = 0;
		const started = performance.now();
		// 150 callers, 4 queries each, on 2 connections × 50
		await Promise.all(
			Array.from({ length: 150 }, async (_, caller) => {
				for (let k = 0; k < 4; k++) {
					const v = caller * 4 + k;
					const query = p.query<{ v: number }>('select $1::int as v', [v]);
					maxWaiting = Math.max(maxWaiting, p.stats.waiting);
					expect((await query).rows[0]?.v).toBe(v);
				}
			}),
		);
		const elapsed = performance.now() - started;
		expect(maxWaiting).toBeGreaterThan(0);
		expect(net.maxInFlight()).toBe(50);
		// ~100 per 10 ms round trip: ~60 ms; one query per round trip per connection once anyone waits would take ~3 s
		expect(elapsed).toBeLessThan(1000);
		expect(p.stats).toMatchObject({ total: 2, idle: 2, busy: 0, waiting: 0 });
	});

	it('hands connections to transactions, clients and cursors under sustained load', async () => {
		const net = slowSockets(5);
		await using p = pool({
			max: 2,
			pipeline: 8,
			acquireTimeout: 5000,
			socket: net.factory,
		});
		await Promise.all([p.query('select 1'), p.query('select 1')]);
		const state = { running: true };
		let completed = 0;
		const load = Promise.all(
			Array.from({ length: 60 }, async () => {
				while (state.running) {
					await p.query('select 1');
					completed++;
				}
			}),
		);
		await sleep(50);
		const [transaction, acquired, cursor] = await Promise.all([
			waited(() => p.transaction((tx) => tx.query('select 1'))),
			waited(async () => {
				const client = await p.acquire();
				// held while the load keeps pipelining on the other connection
				const before = completed;
				await sleep(100);
				expect(completed - before).toBeGreaterThan(30);
				client.release();
			}),
			waited(async () => {
				let n = 0;
				for await (const row of p.stream<{ n: number }>(
					'select generate_series(1, 10) as n',
				))
					n += row.n;
				expect(n).toBe(55);
			}),
		]);
		state.running = false;
		await load;
		// each waited for the queries already in flight, not for the load to stop
		expect(transaction).toBeLessThan(1000);
		expect(acquired).toBeLessThan(1500);
		expect(cursor).toBeLessThan(1500);
		expect(net.maxInFlight()).toBeLessThanOrEqual(8);
		expect(p.stats).toMatchObject({ total: 2, busy: 0, waiting: 0 });
		// and both connections pipeline again afterwards
		net.reset();
		await Promise.all(Array.from({ length: 64 }, () => p.query('select 1')));
		expect(net.maxInFlight()).toBe(8);
	});

	it('times out and aborts queries waiting for a pipeline slot', async () => {
		await using p = pool({ max: 1, pipeline: 2, acquireTimeout: 100 });
		await p.query('select 1');
		const busy = [
			p.query('select pg_sleep(0.3)'),
			p.query('select pg_sleep(0.3)'),
		];
		const timedOut = rejection(p.query('select 1'), ConnectionError);
		const controller = new AbortController();
		const aborted = p.query('select 1', [], { signal: controller.signal });
		const queued = rejection(p.query('select 2 as x'), ConnectionError);
		controller.abort();
		await expect(aborted).rejects.toBeInstanceOf(AbortError);
		expect((await timedOut).code).toBe('ETIMEDOUT');
		await Promise.all(busy);
		expect((await queued).code).toBe('ETIMEDOUT');
		expect((await p.query<{ x: number }>('select 3 as x')).rows).toEqual([
			{ x: 3 },
		]);
		expect(p.stats).toMatchObject({ total: 1, busy: 0, waiting: 0 });
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

	it('ends within a timeout even with a query still running', async () => {
		const p = pool({ max: 1 });
		const running = p.query('select pg_sleep(10)').catch((e: unknown) => e);
		await sleep(50);
		const started = Date.now();
		await p.end({ timeout: 200 });
		expect(Date.now() - started).toBeLessThan(2000);
		expect(await running).toBeInstanceOf(ConnectionError);
	});

	it('aborts connecting with a signal', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			connect(options(), { signal: controller.signal }),
		).rejects.toThrow(/abort/i);
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
