/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionOptions } from '../../../src/driver/config.js';
import type { Connection } from '../../../src/driver/connection.js';
import {
	DriverError,
	PostgresError,
	QueryCanceled,
} from '../../../src/driver/errors.js';
import { nodeSockets } from '../../../src/driver/node-socket.js';
import { createPool } from '../../../src/driver/pool.js';
import type { SocketFactory } from '../../../src/driver/socket.js';
import { versionAtLeast } from '../setup/cluster.js';
import {
	cluster,
	noPg,
	open,
	options,
	pg,
	recordingSockets,
	rejection,
	slowSockets,
	table,
	timeSlicedSockets,
} from './helpers.js';

/**
 * A socket factory that hands the driver what the server sent every
 * `interval` milliseconds, in one chunk: replies the server flushed
 * separately are read together.
 */
function batchedSockets(interval: number): { factory: SocketFactory } {
	return {
		factory: {
			async connect(o) {
				const socket = await nodeSockets.connect(o);
				let handler: ((data: Uint8Array) => void) | undefined;
				let pending: Uint8Array[] = [];
				const flush = () => {
					if (pending.length === 0 || handler === undefined) return;
					const data = Buffer.concat(pending);
					pending = [];
					handler(data);
				};
				const timer = setInterval(flush, interval);
				return {
					get encrypted() {
						return socket.encrypted;
					},
					write: (data) => socket.write(data),
					startTls: (t) => socket.startTls(t),
					peerCertificate: () => socket.peerCertificate(),
					pause: () => socket.pause(),
					resume: () => socket.resume(),
					end: () => socket.end(),
					destroy: () => socket.destroy(),
					onData: (h) => {
						handler = h;
						socket.onData((data) => pending.push(data.slice()));
					},
					onClose: (h) =>
						socket.onClose(() => {
							clearInterval(timer);
							flush();
							h();
						}),
					onError: (h) => socket.onError(h),
					onDrain: (h) => socket.onDrain(h),
				};
			},
		},
	};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How often `text` occurs in what was sent. */
const count = (sent: string, text: string) => sent.split(text).length - 1;

const targets: [string, () => ConnectionOptions][] = [
	['directly', () => options()],
];
if (pg?.bouncerPort) {
	targets.push([
		'through PgBouncer in transaction mode',
		() =>
			options({
				port: cluster().bouncerPort ?? 0,
				user: 'postgres',
				password: undefined,
				prepare: versionAtLeast(pg?.bouncerVersion, 1, 21),
			}),
	]);
}

const timeoutOf = async (conn: Pick<Connection, 'query'>) =>
	(
		await conn.query<{ t: string }>(
			"select current_setting('statement_timeout') as t",
		)
	).rows[0]?.t;

describe.skipIf(noPg).each(targets)('statementTimeout %s', (_name, target) => {
	let name: string;
	beforeAll(async () => {
		name = table('st');
		await using conn = await open(target());
		await conn.query(`create table ${name} (id int)`);
	});
	afterAll(async () => {
		await using conn = await open(target());
		await conn.query(`drop table if exists ${name}`);
	});

	it('refuses, before sending anything, statements that only run outside a transaction block', async () => {
		await using conn = await open(target());
		for (const sql of [
			'vacuum',
			`  -- maintenance\n VACUUM (analyze) ${name}`,
			`create index concurrently on ${name} (id)`,
			`CREATE UNIQUE INDEX CONCURRENTLY if not exists i on ${name} (id)`,
			'drop index concurrently if exists i',
			`reindex (verbose) table concurrently ${name}`,
			'reindex database x',
			'create database x',
			'alter system set work_mem = 1',
			'cluster',
		]) {
			const error = await rejection(
				conn.query(sql, [], { statementTimeout: 100 }),
				DriverError,
			);
			expect(error.message).toMatch(
				/can't bound .* outside a transaction block/,
			);
		}
		// nothing was sent: the connection is as it was
		expect(conn.pending).toBe(0);
		await conn.query(`vacuum ${name}`);
		expect(
			(await conn.query('select 1 as x', [], { statementTimeout: '1s' })).rows,
		).toEqual([{ x: 1 }]);
	});

	it("applies while another caller's transaction is open on the connection", async () => {
		await using conn = await open(target());
		await conn.query('begin');
		// the other caller's transaction is open, and its commit is queued ahead
		const other = Promise.all([
			conn.query('select pg_sleep(0.1)'),
			conn.query('commit'),
		]);
		expect(conn.transactionStatus).toBe('transaction');
		const error = await rejection(
			conn.query('select pg_sleep(3)', [], { statementTimeout: 100 }),
			QueryCanceled,
		);
		expect(error.reason).toBe('statement_timeout');
		await other;
		expect(await timeoutOf(conn)).toBe('0');
		expect(conn.transactionStatus).toBe('idle');
	});

	it('applies when the pool hands its caller a connection mid-read', async () => {
		const net = batchedSockets(20);
		await using pool = createPool({
			...target(),
			max: 1,
			pipeline: 2,
			socket: net.factory,
		});
		await pool.query('select 1');
		const first = pool.query('select pg_sleep(0.1)');
		const other = pool.query('select pg_sleep(0.5)', [], {
			statementTimeout: '5s',
		});
		// waits for a pipeline slot: it gets `first`'s, from the read that
		// also brings the start of `other`
		const error = await rejection(
			pool.query('select pg_sleep(3)', [], { statementTimeout: 100 }),
			QueryCanceled,
		);
		expect(error.reason).toBe('statement_timeout');
		await Promise.all([first, other]);
		expect(await timeoutOf(pool)).toBe('0');
	});

	it('stays inside a transaction pipelined ahead of it, without committing it', async () => {
		await using conn = await open(target());
		const results = await Promise.allSettled([
			conn.query('begin'),
			conn.query(`insert into ${name} values (1)`),
			conn.query('select 1 as x', [], { statementTimeout: '5s' }),
			conn.query(`select current_setting('statement_timeout') as t`),
			conn.query('rollback'),
		]);
		expect(results.map((r) => r.status)).toEqual(
			Array.from({ length: 5 }, () => 'fulfilled'),
		);
		const [, , timed, after] = results;
		expect(timed?.status === 'fulfilled' && timed.value.rows).toEqual([
			{ x: 1 },
		]);
		expect(after?.status === 'fulfilled' && after.value.rows).toEqual([
			{ t: '0' },
		]);
		expect(
			(await conn.query(`select count(*)::int as n from ${name}`)).rows,
		).toEqual([{ n: 0 }]);
	});

	it('bounds only its own statement inside a transaction', async () => {
		await using conn = await open(target());
		await conn.transaction(async (tx) => {
			await tx.query("set local statement_timeout = '7s'");
			const [timed, after, setting] = await Promise.all([
				tx.query('select 1 as x', [], { statementTimeout: 50 }),
				tx.query('select pg_sleep(0.2) as slept'),
				tx.query<{ t: string }>(
					"select current_setting('statement_timeout') as t",
				),
			]);
			expect(timed.rows).toEqual([{ x: 1 }]);
			expect(after.rowCount).toBe(1);
			expect(setting.rows).toEqual([{ t: '7s' }]);
			await expect(
				tx.transaction((sp) =>
					sp.query('select pg_sleep(1)', [], { statementTimeout: 50 }),
				),
			).rejects.toThrow(QueryCanceled);
			expect(await timeoutOf(tx)).toBe('7s');
		});
		expect(await timeoutOf(conn)).toBe('0');
	});

	it('applies to each of many timed queries pipelined among untimed ones on a pool, and leaks nothing', async () => {
		const net = slowSockets(5);
		await using pool = createPool({
			...target(),
			max: 2,
			pipeline: 20,
			socket: net.factory,
		});
		await Promise.all([pool.query('select 1'), pool.query('select 1')]);
		const unbounded: number[] = [];
		const failed: unknown[] = [];
		// each caller's next query starts once its last one settled, while
		// other callers' timed queries may be halfway through
		await Promise.all(
			Array.from({ length: 40 }, async (_, caller) => {
				for (let k = 0; k < 3; k++) {
					const kind = (caller + k) % 3;
					if (kind === 0) {
						const error = await pool
							.query('select pg_sleep(0.3)', [], { statementTimeout: 20 })
							.then(
								() => undefined,
								(e: unknown) => e,
							);
						if (!(error instanceof QueryCanceled)) unbounded.push(caller);
						else expect(error.reason).toBe('statement_timeout');
					} else {
						await pool
							.query(
								'select pg_sleep(0.01)',
								[],
								kind === 1 ? { statementTimeout: '5s' } : {},
							)
							.catch((e: unknown) => failed.push(e));
					}
				}
			}),
		);
		expect(unbounded).toEqual([]);
		expect(failed).toEqual([]);
		for (let i = 0; i < 4; i++) expect(await timeoutOf(pool)).toBe('0');
	});

	it('runs timed queries pipelined behind one that fails on a new connection', async () => {
		await using conn = await open(target());
		const [failed, ...rest] = await Promise.allSettled([
			conn.query('select pg_sleep(1)', [], { statementTimeout: 20 }),
			conn.query('select 1 as x', [], { statementTimeout: '1s' }),
			conn.query('select 2 as x', [], { statementTimeout: '1s' }),
		]);
		expect(failed?.status === 'rejected' && failed.reason).toBeInstanceOf(
			QueryCanceled,
		);
		expect(
			rest.map((r) => (r.status === 'fulfilled' ? r.value.rows : r.reason)),
		).toEqual([[{ x: 1 }], [{ x: 2 }]]);
	});

	it('keeps a timed cursor inside a transaction pipelined ahead of it, without committing it', async () => {
		await using conn = await open(target());
		const rows: unknown[] = [];
		const [, , read, after] = await Promise.all([
			conn.query('begin'),
			conn.query(`insert into ${name} values (2)`),
			(async () => {
				for await (const batch of conn.cursor(
					'select generate_series(1, 5) as n',
					[],
					{ batchSize: 2, statementTimeout: '5s' },
				))
					rows.push(...batch);
			})(),
			conn.query<{ t: string }>(
				"select current_setting('statement_timeout') as t",
			),
			conn.query('rollback'),
		]);
		expect(read).toBeUndefined();
		expect(rows).toHaveLength(5);
		expect(after.rows).toEqual([{ t: '0' }]);
		expect(
			(await conn.query(`select count(*)::int as n from ${name}`)).rows,
		).toEqual([{ n: 0 }]);
	});

	it('bounds a timed cursor inside an explicit transaction, and restores the setting, read to the end or closed mid-batch', async () => {
		await using conn = await open(target());
		await conn.query('begin');
		await conn.query("set local statement_timeout = '7s'");
		let n = 0;
		for await (const batch of conn.cursor('select generate_series(1, 5)', [], {
			batchSize: 2,
			statementTimeout: '1s',
		}))
			n += batch.length;
		expect(n).toBe(5);
		expect(await timeoutOf(conn)).toBe('7s');
		const cursor = conn.cursor(
			'select n, pg_sleep(0.05) from generate_series(1, 10) n',
			[],
			{ batchSize: 5, statementTimeout: '1s' },
		);
		const iterator = cursor[Symbol.asyncIterator]();
		const first = iterator.next();
		// closed while the server runs the first batch
		await sleep(20);
		await iterator.return?.();
		await first.catch(() => {});
		expect(await timeoutOf(conn)).toBe('7s');
		expect(conn.transactionStatus).toBe('transaction');
		const error = await rejection(
			(async () => {
				for await (const _ of conn.cursor(
					'select n, pg_sleep(0.05) from generate_series(1, 100) n',
					[],
					{ batchSize: 5, statementTimeout: 120 },
				));
			})(),
			QueryCanceled,
		);
		expect(error.reason).toBe('statement_timeout');
		await conn.query('rollback');
		expect(await timeoutOf(conn)).toBe('0');
	});

	it("sends nothing when its query can't be sent, so a transaction keeps its own setting", async () => {
		await using conn = await open(target());
		await conn.transaction(async (tx) => {
			await tx.query("set local statement_timeout = '7s'");
			await expect(
				tx.query('select $1::int', [undefined], { statementTimeout: 50 }),
			).rejects.toThrow(/undefined/);
			expect(await timeoutOf(tx)).toBe('7s');
		});
	});

	it.runIf(_name === 'directly')(
		'prepares the statement setting and restoring the timeout once per connection',
		async () => {
			await using conn = await open(target());
			for (let i = 0; i < 3; i++)
				await conn.query('select $1::int as x', [i], {
					statementTimeout: '1s',
				});
			const { rows } = await conn.query<{ n: number }>(
				"select count(*)::int as n from pg_prepared_statements where statement like 'select case when $1::text is null%'",
			);
			expect(rows).toEqual([{ n: 1 }]);
		},
	);

	describe('on a pool, as two statements where no transaction block can precede it', () => {
		const SHORT = "select set_config('statement_timeout', $1, true)";
		const LONG = 'select case when $1::text is null';

		it('sends the setting and the query alone, under one Sync, and leaks nothing', async () => {
			const net = recordingSockets();
			await using pool = createPool({
				...target(),
				max: 1,
				socket: net.factory,
			});
			await pool.query('select 1');
			const sent = net.sent().length;
			const error = await rejection(
				pool.query('select pg_sleep(3)', [], { statementTimeout: 100 }),
				QueryCanceled,
			);
			expect(error.reason).toBe('statement_timeout');
			expect(
				(await pool.query('select 1 as x', [], { statementTimeout: '1s' }))
					.rows,
			).toEqual([{ x: 1 }]);
			const written = net.sent().slice(sent);
			expect(count(written, SHORT)).toBeGreaterThan(0);
			expect(count(written, LONG)).toBe(0);
			expect(count(written, 'S\0\0\0\x04')).toBe(2);
			expect(await timeoutOf(pool)).toBe('0');
		});

		it('keeps the three statements behind a begin, or anything else, sent through the pool, and leaves the transaction its setting', async () => {
			const net = recordingSockets();
			await using pool = createPool({
				...target(),
				max: 1,
				pipeline: 10,
				socket: net.factory,
			});
			await pool.query('select 1');
			const sent = net.sent().length;
			// issued together: pipelined on the one connection, the begin unanswered
			const [, timed, slept, setting] = await Promise.all([
				pool.query("/* app */ BEGIN; -- the caller's own transaction"),
				pool.query('select 1 as x', [], { statementTimeout: 50 }),
				pool.query('select pg_sleep(0.2) as slept'),
				pool.query<{ t: string }>(
					"select current_setting('statement_timeout') as t",
				),
			]);
			expect(timed.rows).toEqual([{ x: 1 }]);
			expect(slept.rowCount).toBe(1);
			expect(setting.rows).toEqual([{ t: '0' }]);
			await pool.query('rollback');
			const behindSimple = await Promise.all([
				pool.simpleQuery('select 1'),
				pool.query('select 2 as x', [], { statementTimeout: '1s' }),
			]);
			expect(behindSimple[1].rows).toEqual([{ x: 2 }]);
			const written = net.sent().slice(sent);
			expect(count(written, LONG)).toBeGreaterThan(0);
			expect(count(written, SHORT)).toBe(0);
			expect(await timeoutOf(pool)).toBe('0');
		});

		it('fails alone when its query fails mid-pipeline, or its interval is invalid', async () => {
			await using pool = createPool({ ...target(), max: 1, pipeline: 10 });
			await pool.query('select 1');
			const results = await Promise.allSettled([
				pool.query('select 1/0', [], { statementTimeout: 50 }),
				pool.query('select pg_sleep(0.15) as slept'),
				pool.query('select 2 as x', [], { statementTimeout: '1s' }),
				pool.query('select 3 as x', [], { statementTimeout: 'soon' }),
				pool.query<{ t: string }>(
					"select current_setting('statement_timeout') as t",
				),
			]);
			const [divided, slept, two, invalid, setting] = results;
			expect(divided?.status === 'rejected' && divided.reason).toMatchObject({
				code: '22012',
			});
			expect(slept?.status).toBe('fulfilled');
			expect(two?.status === 'fulfilled' && two.value.rows).toEqual([{ x: 2 }]);
			expect(invalid?.status === 'rejected' && String(invalid.reason)).toMatch(
				/statement_timeout/,
			);
			expect(setting?.status === 'fulfilled' && setting.value.rows).toEqual([
				{ t: '0' },
			]);
		});

		it('keeps the three statements on a connection and in a transaction', async () => {
			const net = recordingSockets();
			await using pool = createPool({
				...target(),
				max: 1,
				socket: net.factory,
			});
			const sent = net.sent().length;
			await pool.transaction((tx) =>
				tx.query('select 1', [], { statementTimeout: '1s' }),
			);
			await using conn = await open({ ...target(), socket: net.factory });
			await conn.query('select 1', [], { statementTimeout: '1s' });
			const written = net.sent().slice(sent);
			expect(count(written, LONG)).toBeGreaterThan(0);
			expect(count(written, SHORT)).toBe(0);
		});
	});

	it('is written with its query under one Sync', async () => {
		const net = recordingSockets();
		await using conn = await open({ ...target(), socket: net.factory });
		const syncs = () => net.sent().split('S\0\0\0\x04').length - 1;
		const before = syncs();
		await conn.query('select 1', [], { statementTimeout: '1s' });
		expect(syncs() - before).toBe(1);
	});

	it("reports the query's own error, and the client's timeout and abort", async () => {
		await using conn = await open(target());
		const failed = await rejection(
			conn.query('select 1/0', [], { statementTimeout: '1s' }),
			PostgresError,
		);
		expect(failed.code).toBe('22012');
		await expect(
			conn.query('select 1', [], { statementTimeout: 'soon' }),
		).rejects.toThrow(/statement_timeout/);
		const timedOut = await rejection(
			conn.query('select pg_sleep(5)', [], {
				statementTimeout: '10s',
				timeout: 50,
			}),
			QueryCanceled,
		);
		expect(timedOut.reason).toBe('timeout');
		const controller = new AbortController();
		const aborted = conn.query('select pg_sleep(5)', [], {
			statementTimeout: '10s',
			signal: controller.signal,
		});
		setTimeout(() => controller.abort(), 50);
		expect((await rejection(aborted, QueryCanceled)).reason).toBe('abort');
		const timings: number[] = [];
		await conn.query('select 1', [], {
			statementTimeout: '1s',
			onTiming: (t) => timings.push(t.execMs),
		});
		expect(timings).toHaveLength(1);
		expect(await timeoutOf(conn)).toBe('0');
		expect(conn.transactionStatus).toBe('idle');
	});
});

describe.skipIf(noPg)('statementTimeout and the adaptive pool width', () => {
	it('narrows under timed queries as under untimed ones', async () => {
		// one CPU time-slicing every backend with replies waiting (see pool.test.ts)
		const net = timeSlicedSockets(1, 5);
		await using pool = createPool({
			...options(),
			max: 4,
			socket: net.factory,
		});
		const state = { running: true };
		const load = Promise.all(
			Array.from({ length: 200 }, async () => {
				while (state.running)
					await pool.query('select 1', [], { statementTimeout: '5s' });
			}),
		);
		try {
			let wide = false;
			let streak = 0;
			for (let i = 0; i < 200 && streak < 4; i++) {
				await sleep(50);
				const sending = net.sending(100);
				if (sending === 4) wide = true;
				streak = wide && sending <= 2 ? streak + 1 : 0;
			}
			expect(wide).toBe(true);
			expect(streak).toBe(4);
		} finally {
			net.stop();
			state.running = false;
			await load;
		}
		expect(await timeoutOf(pool)).toBe('0');
	});
});
