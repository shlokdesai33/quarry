import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BatchError } from '../../../src/batch.js';
import { integer, text } from '../../../src/column-factories.js';
import { database, type Database } from '../../../src/database.js';
import { defineTable } from '../../../src/define-table.js';
import type { QueryEvent } from '../../../src/driver-executor.js';
import type { Connection } from '../../../src/driver/connection.js';
import {
	AbortError,
	CheckViolation,
	DriverError,
	LockNotAvailable,
	PostgresError,
	QueryCanceled,
	UniqueViolation,
} from '../../../src/driver/errors.js';
import { createPool } from '../../../src/driver/pool.js';
import { Transaction } from '../../../src/driver/transaction.js';
import { NoRowError, RowCountError } from '../../../src/executor.js';
import {
	noPg,
	open,
	options,
	rejection,
	roundTripSockets,
	table,
} from './helpers.js';

// quarry refers to columns by table name, so the tables keep plain names
// inside a schema of their own
const schema = table('batch');

const accounts = defineTable('accounts', {
	columns: {
		id: integer(),
		owner: text(),
		balance: integer(),
	},
});

const notes = defineTable('notes', {
	columns: {
		id: integer().identity(),
		body: text(),
	},
});

/** A view of the transaction's settings. */
const settings = defineTable('settings', {
	columns: {
		tenant: text().nullable(),
		isolation: text(),
	},
});

/** `value`, checked to be an instance of `type`. */
function as<E>(value: unknown, type: abstract new (...args: never[]) => E): E {
	expect(value).toBeInstanceOf(type);
	if (!(value instanceof type)) throw new Error(`Expected a ${type.name}`);
	return value;
}

/** A view that sleeps for 300 ms. */
const slow = defineTable('slow', { columns: { done: text() } });

describe.skipIf(noPg)('db.batch', () => {
	const net = roundTripSockets();
	const events: QueryEvent[] = [];
	let conn: Connection;
	let db: Database;

	/** What `work` cost on the wire, and its value or error. */
	const measure = async (work: () => Promise<unknown>) => {
		const trips = net.roundTrips();
		const writes = net.writes();
		const outcome = await work().then(
			(value) => ({ value, error: undefined }),
			(error: unknown) => ({ value: undefined, error }),
		);
		return {
			...outcome,
			trips: net.roundTrips() - trips,
			writes: net.writes() - writes,
		};
	};
	const balances = async () =>
		(
			await conn.query<{ id: number; balance: number }>(
				'select id, balance from accounts order by id',
			)
		).rows;
	const noteBodies = async () =>
		(await conn.query<{ body: string }>('select body from notes order by id'))
			.rows;
	const byId = (id: number) =>
		db
			.selectFrom(accounts)
			.select(['accounts.owner', 'accounts.balance'])
			.where('accounts.id', id);
	const setBalance = (id: number, balance: number) =>
		db.update(accounts).set({ balance }).where('accounts.id', id);

	beforeAll(async () => {
		conn = await open({
			socket: net.factory,
			params: { search_path: `${schema},public` },
		});
		db = database(conn, { onQuery: (e) => events.push(e) });
		await conn.simpleQuery(`
			create schema ${schema};
			create table ${schema}.accounts (id int primary key, owner text not null, balance int not null check (balance >= 0));
			create table ${schema}.notes (id int generated always as identity primary key, body text not null);
			create view ${schema}.settings as
				select current_setting('app.tenant', true) as tenant, current_setting('transaction_isolation') as isolation;
			create view ${schema}.slow as select pg_sleep(0.3)::text as done;
		`);
		// loads the type catalog, once, before anything is measured
		await db.selectFrom(accounts).execute();
	});
	afterAll(async () => {
		await conn?.query(`drop schema if exists ${schema} cascade`);
		await conn?.close();
	});
	beforeEach(async () => {
		await conn.simpleQuery(
			"truncate accounts, notes restart identity; insert into accounts values (1, 'ada', 100), (2, 'alan', 50)",
		);
		events.length = 0;
	});

	describe('outside a transaction', () => {
		it('sends reads and writes in one write, reading each by its shape', async () => {
			const { value, error, trips, writes } = await measure(() =>
				db.batch([
					byId(1).expectOne(),
					db
						.selectFrom(accounts)
						.select(['accounts.id'])
						.where((eb) => eb.ref('accounts.balance').gt(0)),
					db.insertInto(notes).values({ body: 'hello' }),
					setBalance(2, 55).returning(['accounts.balance']).expectOne(),
					db
						.insertInto(notes)
						.values([{ body: 'a' }, { body: 'b' }])
						.returning(['notes.id']),
					db.deleteFrom(notes).where('notes.body', 'a'),
					byId(3).expectAtMostOne(),
					byId(2).takeFirst(),
				]),
			);
			expect(error).toBeUndefined();
			expect(value).toEqual([
				{ owner: 'ada', balance: 100 },
				[{ id: 1 }, { id: 2 }],
				{ rowCount: 1 },
				{ balance: 55 },
				[{ id: 2 }, { id: 3 }],
				{ rowCount: 1 },
				undefined,
				// the batch's statements run in order
				{ owner: 'alan', balance: 55 },
			]);
			expect({ trips, writes }).toEqual({ trips: 1, writes: 1 });
			expect(await noteBodies()).toEqual([{ body: 'hello' }, { body: 'b' }]);
			expect(events.map((e) => e.command)).toEqual([
				'SELECT',
				'SELECT',
				'INSERT',
				'UPDATE',
				'INSERT',
				'DELETE',
				'SELECT',
				'SELECT',
			]);
		});

		it('runs every query on its own: one that fails leaves the others, and the batch reports each outcome', async () => {
			const { error, trips } = await measure(() =>
				db.batch([
					db.insertInto(notes).values({ body: 'kept' }),
					db.insertInto(accounts).values({ id: 1, owner: 'dup', balance: 0 }),
					setBalance(2, -50),
					byId(9).expectOne(),
					setBalance(1, 101).returning(['accounts.balance']).expectOne(),
				]),
			);
			expect(trips).toBe(1);
			expect(error).toBeInstanceOf(BatchError);
			if (!(error instanceof BatchError)) return;
			expect(error.results.map((r) => r.status)).toEqual([
				'fulfilled',
				'rejected',
				'rejected',
				'rejected',
				'fulfilled',
			]);
			expect(error.results[4]).toEqual({
				status: 'fulfilled',
				value: { balance: 101 },
			});
			const [unique, check, noRow] = error.errors;
			expect(noRow).toBeInstanceOf(NoRowError);
			// each error names its own query, and where the batch was issued
			expect(as(unique, UniqueViolation).query?.sql).toMatch(
				/^insert into "accounts"/,
			);
			expect(as(check, CheckViolation).query?.sql).toMatch(/^update/);
			expect(as(unique, Error).stack).toContain('--- query issued at ---');
			expect(await noteBodies()).toEqual([{ body: 'kept' }]);
			expect(await balances()).toEqual([
				{ id: 1, balance: 101 },
				{ id: 2, balance: 50 },
			]);
			expect(conn.transactionStatus).toBe('idle');
		});

		it('applies the timeout to each query', async () => {
			const error = await rejection(
				db.batch(
					[
						db.selectFrom(slow).select(['slow.done']).expectOne(),
						byId(1).expectOne(),
					],
					{ timeout: 100 },
				),
				BatchError,
			);
			expect(error.errors[0]).toBeInstanceOf(QueryCanceled);
			expect(error.results[1]).toMatchObject({ status: 'fulfilled' });
		});

		it('runs on a pool, on one connection', async () => {
			await using pooled = database(
				createPool({
					...options(),
					max: 2,
					params: { search_path: `${schema},public` },
				}),
			);
			const [one, two] = await pooled.batch([
				pooled
					.selectFrom(accounts)
					.select(['accounts.owner'])
					.where('accounts.id', 1)
					.expectOne(),
				pooled.selectFrom(accounts).select(['accounts.owner']),
			]);
			expect(one).toEqual({ owner: 'ada' });
			expect(two).toHaveLength(2);
		});
	});

	describe('with transaction', () => {
		it('sends BEGIN, the queries and COMMIT in one round trip', async () => {
			const { value, error, trips, writes } = await measure(() =>
				db.batch(
					[
						setBalance(1, 70),
						setBalance(2, 80),
						db.insertInto(notes).values({ body: 'transfer' }),
						byId(2),
					],
					{ transaction: true },
				),
			);
			expect(error).toBeUndefined();
			expect(value).toEqual([
				{ rowCount: 1 },
				{ rowCount: 1 },
				{ rowCount: 1 },
				[{ owner: 'alan', balance: 80 }],
			]);
			expect({ trips, writes }).toEqual({ trips: 1, writes: 1 });
			expect(await balances()).toEqual([
				{ id: 1, balance: 70 },
				{ id: 2, balance: 80 },
			]);
			expect(conn.transactionStatus).toBe('idle');
		});

		it('rolls everything back when a query fails, still in one round trip', async () => {
			const { error, trips } = await measure(() =>
				db.batch(
					[
						db.insertInto(notes).values({ body: 'dropped' }),
						setBalance(2, 250),
						setBalance(1, -100),
						byId(1),
					],
					{ transaction: true },
				),
			);
			expect(trips).toBe(1);
			expect(as(error, CheckViolation).query?.sql).toMatch(/^update/);
			expect(await balances()).toEqual([
				{ id: 1, balance: 100 },
				{ id: 2, balance: 50 },
			]);
			expect(await noteBodies()).toEqual([]);
			expect(conn.transactionStatus).toBe('idle');
		});

		it('waits for COMMIT when a result is checked, and rolls back when the check fails', async () => {
			const ok = await measure(() =>
				db.batch(
					[
						setBalance(1, 101).returning(['accounts.balance']).expectOne(),
						byId(2).expectOne(),
					],
					{ transaction: true },
				),
			);
			expect(ok.value).toEqual([
				{ balance: 101 },
				{ owner: 'alan', balance: 50 },
			]);
			expect(ok.trips).toBe(2);

			const noRow = await measure(() =>
				db.batch(
					[
						db.insertInto(notes).values({ body: 'dropped' }),
						byId(9).expectOne(),
					],
					{ transaction: true },
				),
			);
			expect(as(noRow.error, NoRowError).stack).toContain(
				'--- query issued at ---',
			);
			expect(noRow.trips).toBe(2);

			const rowCount = await measure(() =>
				db.batch(
					[
						db.insertInto(notes).values({ body: 'dropped' }),
						setBalance(9, 1).expectRows(1),
					],
					{ transaction: true },
				),
			);
			expect(rowCount.error).toBeInstanceOf(RowCountError);
			expect(await noteBodies()).toEqual([]);
			expect(await balances()).toEqual([
				{ id: 1, balance: 101 },
				{ id: 2, balance: 50 },
			]);
			expect(conn.transactionStatus).toBe('idle');
		});

		it('applies the transaction options, and the timeout to its statements', async () => {
			const [[read]] = await db.batch(
				[
					db
						.selectFrom(settings)
						.select(['settings.tenant', 'settings.isolation']),
				],
				{
					transaction: {
						isolation: 'repeatable read',
						settings: { 'app.tenant': 'acme' },
					},
				},
			);
			expect(read).toEqual({ tenant: 'acme', isolation: 'repeatable read' });

			const error = await rejection(
				db.batch(
					[
						db.insertInto(notes).values({ body: 'dropped' }),
						db.selectFrom(slow).select(['slow.done']),
					],
					{ transaction: true, timeout: 100 },
				),
				QueryCanceled,
			);
			expect(error.code).toBe('57014');
			expect(await noteBodies()).toEqual([]);
			expect(conn.transactionStatus).toBe('idle');
		});

		it('sends nothing when aborted first', async () => {
			const controller = new AbortController();
			controller.abort();
			const { error, trips } = await measure(() =>
				db.batch([db.insertInto(notes).values({ body: 'x' })], {
					transaction: true,
					signal: controller.signal,
				}),
			);
			expect(error).toBeInstanceOf(AbortError);
			expect(trips).toBe(0);
			expect(await noteBodies()).toEqual([]);
		});
	});

	describe('with row locks', () => {
		it('keeps the locking clause through the shape, and holds the locks in its transaction', async () => {
			const claim = (id: number) =>
				byId(id).forUpdate().skipLocked().limit(1).takeFirst();
			expect(claim(1).toSQL().sql).toMatch(
				/ limit \$\d+ for update skip locked$/,
			);
			await using other = await open({
				params: { search_path: `${schema},public` },
			});
			await other.transaction(async (tx) => {
				await tx.query('select id from accounts where id = 1 for update');
				const { value, trips } = await measure(() =>
					db.batch([claim(1), claim(2), setBalance(2, 60)], {
						transaction: true,
					}),
				);
				expect(value).toEqual([
					undefined,
					{ owner: 'alan', balance: 50 },
					{ rowCount: 1 },
				]);
				expect(trips).toBe(1);
				// a checked shape: COMMIT waits for it, and the lock error rolls back
				await rejection(
					db.batch(
						[setBalance(2, 70), byId(1).forUpdate().noWait().expectOne()],
						{
							transaction: true,
						},
					),
					LockNotAvailable,
				);
				// outside a transaction, the lock is the statement's own
				const error = await rejection(
					db.batch([byId(1).forShare().noWait(), byId(2).forShare()]),
					BatchError,
				);
				expect(error.errors[0]).toBeInstanceOf(LockNotAvailable);
				expect(error.results[1]).toMatchObject({ status: 'fulfilled' });
			});
			expect(await balances()).toEqual([
				{ id: 1, balance: 100 },
				{ id: 2, balance: 60 },
			]);
			expect(conn.transactionStatus).toBe('idle');
		});
	});

	describe('inside a transaction', () => {
		it('shares one Sync with BEGIN', async () => {
			const { value, trips } = await measure(() =>
				db.transaction((tx) =>
					tx.batch([
						tx.insertInto(notes).values({ body: 'in tx' }),
						tx.selectFrom(notes).select(['notes.body']),
					]),
				),
			);
			expect(value).toEqual([{ rowCount: 1 }, [{ body: 'in tx' }]]);
			// BEGIN with the batch, then COMMIT
			expect(trips).toBe(2);
		});

		it('fails the transaction with the first error', async () => {
			const error = await rejection(
				db.transaction(async (tx) => {
					await tx.batch([
						tx.insertInto(notes).values({ body: 'dropped' }),
						setBalance(1, -400),
						tx.insertInto(notes).values({ body: 'skipped' }),
					]);
				}),
				CheckViolation,
			);
			expect(error.query?.sql).toMatch(/^update/);
			expect(await noteBodies()).toEqual([]);
		});

		it('runs in a savepoint with transaction', async () => {
			const caught = await db.transaction(async (tx) => {
				await tx.insertInto(notes).values({ body: 'kept' }).execute();
				const failure = await tx
					.batch(
						[
							tx.insertInto(notes).values({ body: 'dropped' }),
							setBalance(1, -400),
						],
						{ transaction: true },
					)
					.catch((e: unknown) => e);
				await tx.insertInto(notes).values({ body: 'after' }).execute();
				return failure;
			});
			expect(caught).toBeInstanceOf(CheckViolation);
			expect(await noteBodies()).toEqual([{ body: 'kept' }, { body: 'after' }]);
		});

		it('takes no timeout', async () => {
			await rejection(
				db.transaction((tx) => tx.batch([byId(1)], { timeout: 100 })),
				DriverError,
			);
		});
	});
});

describe.skipIf(noPg)('Transaction.batch', () => {
	let conn: Connection;
	let name: string;
	beforeAll(async () => {
		conn = await open();
		name = table('txb');
		await conn.query(
			`create table ${name} (id int, constraint ${name}_u unique (id) deferrable initially deferred)`,
		);
	});
	afterAll(async () => {
		await conn?.query(`drop table if exists ${name}`);
		await conn?.close();
	});
	beforeEach(() => conn.query(`truncate ${name}`));
	const ids = async () =>
		(
			await conn.query<{ id: number }>(`select id from ${name} order by id`)
		).rows.map((r) => r.id);

	it('runs nothing when BEGIN fails, and COMMIT outside it does nothing', async () => {
		const { results, done } = Transaction.batch(
			conn,
			[{ sql: `insert into ${name} values (1)` }],
			{ settings: { statement_timeout: 'not a duration' } },
		);
		const error = await rejection(done, PostgresError);
		expect(error.code).toBe('22023');
		await expect(results[0]).rejects.toBe(error);
		expect(await ids()).toEqual([]);
		expect(conn.transactionStatus).toBe('idle');
	});

	it('forgets a statement the server skipped, so its SQL runs later', async () => {
		const failing = { settings: { statement_timeout: 'not a duration' } };
		const batched = `insert into ${name} values (7)`;
		await rejection(
			Transaction.batch(conn, [{ sql: batched }], failing).done,
			PostgresError,
		);
		const first = `insert into ${name} values (8)`;
		await rejection(
			conn.transaction((tx) => tx.query(first), failing),
			PostgresError,
		);
		// a statement under a shared Sync isn't retried, so it would fail on a stale cache entry
		await Transaction.batch(conn, [{ sql: batched }, { sql: first }]).done;
		expect(await ids()).toEqual([7, 8]);
	});

	it('reports an error at COMMIT, committing nothing', async () => {
		const { results, done } = Transaction.batch(conn, [
			{ sql: `insert into ${name} values (1)` },
			{ sql: `insert into ${name} values (1)` },
		]);
		await rejection(done, UniqueViolation);
		await expect(Promise.all(results)).resolves.toHaveLength(2);
		expect(await ids()).toEqual([]);
		expect(conn.transactionStatus).toBe('idle');
	});

	it('refuses a connection already in a transaction', async () => {
		await conn.transaction(async () => {
			expect(() => Transaction.batch(conn, [{ sql: 'select 1' }])).toThrow(
				DriverError,
			);
		});
	});
});
