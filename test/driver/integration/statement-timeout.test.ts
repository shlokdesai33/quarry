/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionOptions } from '../../../src/driver/config.js';
import type { Connection } from '../../../src/driver/connection.js';
import { PostgresError, QueryCanceled } from '../../../src/driver/errors.js';
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
