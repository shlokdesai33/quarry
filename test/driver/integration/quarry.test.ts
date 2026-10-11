import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	array,
	bigint,
	boolean,
	daterange,
	decimal,
	integer,
	jsonb,
	text,
	timestamptz,
	tstzrange,
	vector,
} from '../../../src/column-factories.js';
import { database } from '../../../src/database.js';
import { defineEnum } from '../../../src/define-enum.js';
import { defineTable } from '../../../src/define-table.js';
import { NoRowError } from '../../../src/executor.js';
import {
	DriverError,
	QueryCanceled,
	UniqueViolation,
} from '../../../src/driver/errors.js';
import { createPool, type Pool } from '../../../src/driver/pool.js';
import { pgExecutor, type QueryEvent } from '../../../src/driver/quarry.js';
import { noPg, options, pg, rejection, table } from './helpers.js';

const mood = defineEnum('quarry_mood', ['happy', 'sad']);
// quarry refers to columns by table name, so the tables keep plain names
// inside a schema of their own
const schema = table('quarry');
const usersName = 'users';
const postsName = 'posts';

const users = defineTable(usersName, {
	columns: {
		id: integer().identity(),
		firstName: text().name('first_name').nullable(),
		email: text(),
		admin: boolean(),
		balance: decimal(),
		visits: bigint(),
		roles: array(text()),
		moods: array(mood()),
		settings: jsonb<{ theme: string }>(),
		createdAt: timestamptz().name('created_at'),
		active: daterange(),
		window: tstzrange(),
		embedding: vector().nullable(),
	},
});

const posts = defineTable(postsName, {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		title: text(),
	},
});

const sql = (query: string, params: unknown[] = []) => ({ sql: query, params });

// the fixture uses pgvector; the suite is skipped where it isn't installed
describe.skipIf(noPg || !pg?.extensions.includes('vector'))(
	'quarry adapter',
	() => {
		let pool: Pool;
		const events: QueryEvent[] = [];
		const executor = () => pgExecutor(pool, { onQuery: (e) => events.push(e) });

		beforeAll(async () => {
			pool = createPool({
				...options(),
				max: 4,
				params: { search_path: `${schema},public` },
			});
			await pool.simpleQuery(`
			create extension if not exists vector;
			create schema ${schema};
			create type quarry_mood as enum ('happy', 'sad');
			create table ${usersName} (
				id int generated always as identity primary key,
				first_name text, email text unique not null, admin boolean not null,
				balance numeric not null, visits bigint not null, roles text[] not null,
				moods quarry_mood[] not null, settings jsonb not null, created_at timestamptz not null,
				active daterange not null, "window" tstzrange not null, embedding vector(3)
			);
			create table ${postsName} (id int generated always as identity primary key, user_id int not null, title text not null);
		`);
			await pool.query(
				`insert into ${usersName} (first_name, email, admin, balance, visits, roles, moods, settings, created_at, active, "window", embedding)
			 values ($1, $2, true, '12345678901234567890.5', 9007199254740993, $3, $4, $5, $6, '[2024-01-01,2024-02-01)', $7, '[1,2.5,3]'),
			        (null, 'b@x', false, '0', 1, '{}', '{}', '{"theme":"light"}', '2024-06-01 00:00:00+00', 'empty', '(,)', null)`,
				[
					'Ada',
					'a@x',
					['admin', 'a,b "q"'],
					['happy', 'sad'],
					{ theme: 'dark' },
					new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 678)),
					'["2024-01-01 00:00:00+00","2024-01-02 12:00:00+00")',
				],
			);
			await pool.query(
				`insert into ${postsName} (user_id, title) values (1, 'first'), (1, 'second')`,
			);
		});

		afterAll(async () => {
			await pool
				?.query(`drop table if exists ${usersName}, ${postsName}`)
				.catch(() => {});
			await pool?.end();
		});

		it('decodes rows to the TypeScript types quarry declares', async () => {
			const db = database(executor());
			const row = await db
				.selectFrom(users)
				.select([
					'users.id',
					'users.firstName',
					'users.admin',
					'users.balance',
					'users.visits',
					'users.roles',
					'users.moods',
					'users.settings',
					'users.createdAt',
					'users.active',
					'users.window',
					'users.embedding',
				])
				.where('users.email', 'a@x')
				.one();
			expect(row).toEqual({
				id: 1,
				firstName: 'Ada',
				admin: true,
				balance: '12345678901234567890.5',
				visits: '9007199254740993',
				roles: ['admin', 'a,b "q"'],
				moods: ['happy', 'sad'],
				settings: { theme: 'dark' },
				createdAt: new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 678)),
				active: {
					empty: false,
					lower: '2024-01-01',
					upper: '2024-02-01',
					bounds: '[)',
				},
				window: {
					empty: false,
					lower: new Date(Date.UTC(2024, 0, 1)),
					upper: new Date(Date.UTC(2024, 0, 2, 12)),
					bounds: '[)',
				},
				embedding: [1, 2.5, 3],
			});
			const other = await db
				.selectFrom(users)
				.select([
					'users.active',
					'users.window',
					'users.moods',
					'users.embedding',
				])
				.where('users.email', 'b@x')
				.one();
			expect(other).toEqual({
				active: { empty: true },
				window: { empty: false, lower: null, upper: null, bounds: '()' },
				moods: [],
				embedding: null,
			});
		});

		it('runs joins, first, maybeOne and one with quarry semantics', async () => {
			const db = database(executor());
			const titles = await db
				.selectFrom(users)
				.innerJoin(posts)
				.on('posts.userId', 'users.id')
				.select(['users.email', 'posts.title'])
				.where('users.admin', true)
				.all();
			expect(titles.map((t) => t.title).toSorted()).toEqual([
				'first',
				'second',
			]);
			expect(
				await db
					.selectFrom(users)
					.select(['users.id'])
					.where('users.email', 'nobody')
					.maybeOne(),
			).toBeUndefined();
			await expect(
				db
					.selectFrom(users)
					.select(['users.id'])
					.where('users.email', 'nobody')
					.one(),
			).rejects.toBeInstanceOf(NoRowError);
			const first = await db
				.selectFrom(users)
				.select(['users.email'])
				.where((eb) => eb.ref('users.roles').contains(['admin']))
				.first();
			expect(first).toEqual({ email: 'a@x' });
		});

		it('passes the tag, timings and row count to onQuery', async () => {
			events.length = 0;
			await database(executor())
				.selectFrom(users)
				.select(['users.id'])
				.tag('users.ids')
				.all();
			const event = events.find((e) => e.tag === 'users.ids');
			expect(event).toMatchObject({
				kind: 'execute',
				command: 'SELECT',
				rowCount: 2,
				error: undefined,
			});
			expect(event?.sql).toContain('select "');
			expect(event?.durationMs).toBeGreaterThan(0);
			expect(event?.durationMs).toBeGreaterThanOrEqual(
				(event?.phases.execMs ?? 0) - 0.5,
			);
			expect(event?.phases.acquireMs).toBeGreaterThanOrEqual(0);
		});

		it('maps errors to typed classes carrying the query, tag and the caller’s stack', async () => {
			events.length = 0;
			const ex = executor();
			const error = await rejection(
				ex.execute({
					...sql(
						`insert into ${postsName} (id, user_id, title) overriding system value values (1, 1, 'dup')`,
					),
					tag: 'posts.insert',
				}),
				UniqueViolation,
			);
			expect(error.query?.tag).toBe('posts.insert');
			expect(error.constraint).toBe(`${postsName}_pkey`);
			expect(error.stack).toContain('query issued at');
			expect(error.stack).toContain('quarry.test.ts');
			expect(events.at(-1)?.error).toBe(error);
		});

		it('returns raw text for opted-in types', async () => {
			const raw = database(
				pgExecutor(pool, { raw: ['timestamptz', 'daterange', 'vector'] }),
			);
			const row = await raw
				.selectFrom(users)
				.select([
					'users.createdAt',
					'users.active',
					'users.embedding',
					'users.id',
				])
				.where('users.email', 'a@x')
				.one();
			expect(row).toEqual({
				createdAt: '2024-01-02 03:04:05.678+00',
				active: '[2024-01-01,2024-02-01)',
				embedding: '[1,2.5,3]',
				id: 1,
			});
			const allRaw = await pgExecutor(pool, { raw: true }).execute(
				sql('select 1 as one, array[1] as a'),
			);
			expect(allRaw.rows).toEqual([{ one: '1', a: '{1}' }]);
		});

		it('returns positional rows', async () => {
			const result = await executor().execute(sql('select 1 as a, 2 as a'), {
				rowMode: 'array',
			});
			expect(result.rows).toEqual([[1, 2]]);
		});

		it('cancels with a signal and times out on the server', async () => {
			const controller = new AbortController();
			const ex = executor().with({ signal: controller.signal });
			const running = rejection(
				ex.execute(sql('select pg_sleep(10)')),
				QueryCanceled,
			);
			setTimeout(() => controller.abort(), 100);
			expect((await running).reason).toBe('abort');
			const timedOut = await rejection(
				executor().execute(sql('select pg_sleep(10)'), { timeout: '100ms' }),
				QueryCanceled,
			);
			expect(timedOut.reason).toBe('statement_timeout');
		});

		it('streams in batches', async () => {
			const sizes: number[] = [];
			for await (const batch of executor().stream(
				sql('select generate_series(1, 2500) as n'),
				{ batchSize: 1000 },
			))
				sizes.push(batch.length);
			expect(sizes).toEqual([1000, 1000, 500]);
			expect(events.at(-1)).toMatchObject({ kind: 'stream', rowCount: 2500 });
			await expect(async () => {
				for await (const _ of executor().stream(sql('select 1'), {
					timeout: 100,
				})) {
					// needs a transaction
				}
			}).rejects.toBeInstanceOf(DriverError);
		});

		it('describes a query without running it', async () => {
			const description = await executor().describe(
				sql(`select "id", "email" from ${usersName} where "email" = $1`),
			);
			expect(description.params).toEqual([25]);
			expect(
				description.columns.map((c) => [c.name, c.typeOid, c.columnNumber > 0]),
			).toEqual([
				['id', 23, true],
				['email', 25, true],
			]);
		});

		it('runs transactions with savepoints, after-commit hooks and settings', async () => {
			const ex = executor();
			const committed: string[] = [];
			const row = await ex.transaction(
				async (tx) => {
					await tx.execute(
						sql(`insert into ${postsName} (user_id, title) values (1, 'tx')`),
					);
					tx.afterCommit(() => committed.push('done'));
					await expect(
						tx.transaction(async (inner) => {
							inner.afterCommit(() => committed.push('dropped'));
							await inner.execute(
								sql(
									`insert into ${postsName} (user_id, title) values (1, 'rolled back')`,
								),
							);
							await inner.execute(sql('select pg_sleep(1)'), { timeout: 50 });
						}),
					).rejects.toBeInstanceOf(QueryCanceled);
					const tenant = await tx.execute(
						sql("select current_setting('app.tenant') as t"),
					);
					expect(tenant.rows).toEqual([{ t: 'acme' }]);
					return database(tx)
						.selectFrom(posts)
						.select(['posts.title'])
						.where('posts.userId', 1)
						.all();
				},
				{ settings: { 'app.tenant': 'acme' }, isolation: 'repeatable read' },
			);
			expect(row.map((r) => r.title)).toContain('tx');
			expect(row.map((r) => r.title)).not.toContain('rolled back');
			expect(committed).toEqual(['done']);

			await expect(
				ex.transaction(async (tx) => {
					await tx.execute(
						sql(
							`insert into ${postsName} (user_id, title) values (1, 'never')`,
						),
					);
					tx.afterCommit(() => committed.push('never'));
					throw new Error('rollback');
				}),
			).rejects.toThrow('rollback');
			const never = await database(ex)
				.selectFrom(posts)
				.select(['posts.id'])
				.where('posts.title', 'never')
				.maybeOne();
			expect(never).toBeUndefined();
			expect(committed).toEqual(['done']);
			expect(() => ex.afterCommit(() => {})).toThrow(
				/not inside a transaction/,
			);
		});

		it('creates and closes its own pool from options', async () => {
			await using ex = pgExecutor({
				...options(),
				max: 1,
				params: { search_path: schema },
			});
			expect((await ex.execute(sql('select 41 + 1 as n'))).rows).toEqual([
				{ n: 42 },
			]);
		});
	},
);
