/* oxlint-disable no-await-in-loop -- tests run their steps in order */
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
import { database, type Database } from '../../../src/database.js';
import { defineEnum } from '../../../src/define-enum.js';
import { defineTable } from '../../../src/define-table.js';
import type { QueryEvent } from '../../../src/driver-executor.js';
import { createPool, type Pool } from '../../../src/driver/pool.js';
import { QueryCanceled, UniqueViolation } from '../../../src/driver/errors.js';
import { NoRowError, RowCountError } from '../../../src/executor.js';
import { noPg, options, pg, rejection, table } from './helpers.js';

const mood = defineEnum('quarry_mood', ['happy', 'sad']);
// quarry refers to columns by table name, so the tables keep plain names
// inside a schema of their own
const schema = table('quarry');

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		firstName: text().name('first_name').nullable(),
		email: text(),
		admin: boolean().default(),
		balance: decimal().default(),
		visits: bigint().default(),
		roles: array(text()).default(),
		moods: array(mood()).default(),
		settings: jsonb<{ theme: string }>().default(),
		createdAt: timestamptz().name('created_at').default(),
		active: daterange().default(),
		window: tstzrange().default(),
		embedding: vector().nullable(),
	},
});

const posts = defineTable('posts', {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		title: text(),
	},
});

/** A view that sleeps, so a select can run long enough to cancel. */
const slow = defineTable('slow', { columns: { done: text() } });

// the fixture uses pgvector; the suite is skipped where it isn't installed
describe.skipIf(noPg || !pg?.extensions.includes('vector'))(
	'quarry on the driver',
	() => {
		let pool: Pool;
		let db: Database;
		const events: QueryEvent[] = [];

		beforeAll(async () => {
			pool = createPool({
				...options(),
				max: 4,
				params: { search_path: `${schema},public` },
			});
			db = database(pool, { onQuery: (e) => events.push(e) });
			await pool.simpleQuery(`
			create extension if not exists vector;
			create schema ${schema};
			create type quarry_mood as enum ('happy', 'sad');
			create table users (
				id int generated always as identity primary key,
				first_name text, email text unique not null, admin boolean not null default false,
				balance numeric not null default 0, visits bigint not null default 0, roles text[] not null default '{}',
				moods quarry_mood[] not null default '{}', settings jsonb not null default '{"theme":"light"}',
				created_at timestamptz not null default now(), active daterange not null default 'empty',
				"window" tstzrange not null default '(,)', embedding vector(3)
			);
			create table posts (id int generated always as identity primary key, user_id int not null, title text not null);
			create view slow as select pg_sleep(2)::text as done;
		`);
		});

		afterAll(async () => {
			await pool
				?.query(`drop schema if exists ${schema} cascade`)
				.catch(() => {});
			await pool?.end();
		});

		it('inserts with returning, decoding to the TypeScript types quarry declares', async () => {
			const ada = await db
				.insertInto(users)
				.values({
					firstName: 'Ada',
					email: 'a@x',
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
				})
				.returning([
					'users.id',
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
				.one();
			expect(ada).toEqual({
				id: 1,
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
			// several rows go through unnest
			const many = await db
				.insertInto(users)
				.values([
					{ firstName: null, email: 'b@x', embedding: null },
					{ firstName: 'Cy', email: 'c@x', embedding: null },
				])
				.returning(['users.email', 'users.active', 'users.window'])
				.all();
			expect(many).toEqual([
				{
					email: 'b@x',
					active: { empty: true },
					window: { empty: false, lower: null, upper: null, bounds: '()' },
				},
				{
					email: 'c@x',
					active: { empty: true },
					window: { empty: false, lower: null, upper: null, bounds: '()' },
				},
			]);
			await db
				.insertInto(posts)
				.values([
					{ userId: 1, title: 'first' },
					{ userId: 1, title: 'second' },
				])
				.execute();
		});

		it('upserts, updates, updates many and deletes', async () => {
			const merged = await db
				.insertInto(users)
				.values({ email: 'a@x', firstName: 'Ada Lovelace', embedding: null })
				.onConflict('email')
				.merge(['firstName'])
				.returning(['users.id', 'users.firstName'])
				.one();
			expect(merged).toEqual({ id: 1, firstName: 'Ada Lovelace' });
			expect(
				await db
					.insertInto(users)
					.values({ email: 'a@x', firstName: null, embedding: null })
					.onConflict('email')
					.doNothing()
					.execute(),
			).toEqual({
				rowCount: 0,
			});
			const updated = await db
				.update(users)
				.set({ visits: '42' })
				.where('users.email', 'b@x')
				.returning(['users.visits'])
				.one();
			expect(updated).toEqual({ visits: '42' });
			expect(
				await db
					.updateMany(
						users,
						[
							{ id: 2, firstName: 'Bea' },
							{ id: 3, firstName: 'Cyd' },
						],
						{ by: 'id' },
					)
					.returning(['users.firstName'])
					.all(),
			).toEqual(
				expect.arrayContaining([{ firstName: 'Bea' }, { firstName: 'Cyd' }]),
			);
			const removed = await db
				.deleteFrom(posts)
				.where('posts.title', 'second')
				.returning(['posts.title'])
				.all();
			expect(removed).toEqual([{ title: 'second' }]);
			await expect(
				db
					.deleteFrom(posts)
					.where('posts.title', 'nope')
					.expectRows(1)
					.execute(),
			).rejects.toBeInstanceOf(RowCountError);
		});

		it('selects with joins and quarry’s result semantics', async () => {
			const titles = await db
				.selectFrom(users)
				.innerJoin(posts)
				.on('posts.userId', 'users.id')
				.select(['users.email', 'posts.title'])
				.where('users.admin', true)
				.all();
			expect(titles).toEqual([{ email: 'a@x', title: 'first' }]);
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

		it('streams rows and describes queries', async () => {
			const emails: string[] = [];
			for await (const row of db
				.selectFrom(users)
				.select(['users.email'])
				.stream({ batchSize: 1 }))
				emails.push(row.email);
			expect(emails.toSorted()).toEqual(['a@x', 'b@x', 'c@x']);
			for await (const _ of db
				.selectFrom(users)
				.select(['users.id'])
				.stream({ timeout: '5s' }))
				break;
			const description = await db
				.selectFrom(users)
				.select(['users.id', 'users.email'])
				.where('users.email', 'x')
				.describe();
			expect(description.params).toEqual([25]);
			expect(description.columns.map((c) => [c.name, c.typeOid])).toEqual([
				['id', 23],
				['email', 25],
			]);
		});

		it('cancels with a signal and times out on the server', async () => {
			const controller = new AbortController();
			const running = rejection(
				db
					.selectFrom(slow)
					.select(['slow.done'])
					.all({ signal: controller.signal }),
				QueryCanceled,
			);
			setTimeout(() => controller.abort(), 100);
			expect((await running).reason).toBe('abort');
			const timedOut = await rejection(
				db.selectFrom(slow).select(['slow.done']).all({ timeout: '100ms' }),
				QueryCanceled,
			);
			expect(timedOut.reason).toBe('statement_timeout');
		});

		it('reports tags and timings to onQuery, and enriches errors', async () => {
			events.length = 0;
			await db.selectFrom(users).select(['users.id']).tag('users.ids').all();
			expect(events.find((e) => e.tag === 'users.ids')).toMatchObject({
				kind: 'execute',
				command: 'SELECT',
				rowCount: 3,
				error: undefined,
			});
			const error = await rejection(
				db
					.insertInto(users)
					.values({ email: 'a@x', firstName: null, embedding: null })
					.tag('users.create')
					.execute(),
				UniqueViolation,
			);
			expect(error.query?.tag).toBe('users.create');
			expect(error.columns).toEqual(['email']);
			expect(error.stack).toContain('query issued at');
			expect(error.stack).toContain('quarry.test.ts');
			expect(events.at(-1)?.error).toBe(error);
		});

		it('runs transactions with savepoints, settings and after-commit hooks', async () => {
			const committed: string[] = [];
			const titles = await db.transaction(
				async (tx) => {
					await tx
						.insertInto(posts)
						.values({ userId: 1, title: 'tx' })
						.execute();
					tx.afterCommit(() => committed.push('done'));
					await expect(
						tx.transaction(async (inner) => {
							inner.afterCommit(() => committed.push('dropped'));
							await inner
								.insertInto(posts)
								.values({ userId: 1, title: 'rolled back' })
								.execute();
							await inner
								.deleteFrom(posts)
								.where('posts.title', 'missing')
								.expectRows(1)
								.execute();
						}),
					).rejects.toBeInstanceOf(RowCountError);
					await tx.setLocal('app.user', 7);
					return (await tx.selectFrom(posts).select(['posts.title']).all()).map(
						(r) => r.title,
					);
				},
				{
					isolation: 'repeatable read',
					settings: { 'app.tenant': 'acme' },
					timeout: '5s',
				},
			);
			expect(titles.toSorted()).toEqual(['first', 'tx']);
			expect(committed).toEqual(['done']);
			await expect(
				db.transaction(async (tx) => {
					await tx
						.insertInto(posts)
						.values({ userId: 1, title: 'never' })
						.execute();
					throw new Error('rollback');
				}),
			).rejects.toThrow('rollback');
			expect(
				await db
					.selectFrom(posts)
					.select(['posts.id'])
					.where('posts.title', 'never')
					.maybeOne(),
			).toBeUndefined();
		});

		it('leaves opted-in types as text', async () => {
			const raw = database(pool, {
				raw: ['timestamptz', 'daterange', 'vector'],
			});
			const row = await raw
				.selectFrom(users)
				.select(['users.createdAt', 'users.active', 'users.embedding'])
				.where('users.id', 1)
				.one();
			expect(row).toEqual({
				createdAt: '2024-01-02 03:04:05.678+00',
				active: '[2024-01-01,2024-02-01)',
				embedding: '[1,2.5,3]',
			});
		});

		it('verifies the schema through the driver', async () => {
			const report = await db.verify([users, posts]);
			expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual(
				[],
			);
		});

		it('opens and closes its own pool from options or a connection string', async () => {
			await using own = database({
				...options(),
				max: 1,
				params: { search_path: schema },
			});
			expect(
				await own
					.selectFrom(posts)
					.select(['posts.title'])
					.where('posts.title', 'first')
					.one(),
			).toEqual({ title: 'first' });
			const c = pg;
			if (c === null) return;
			const url = `postgres://${c.users.trust.user}@${c.host}:${c.port}/${c.database}?sslmode=disable&search_path=${schema}`;
			const fromUrl = database(url);
			expect(
				await fromUrl
					.selectFrom(users)
					.select(['users.email'])
					.where('users.id', 1)
					.one(),
			).toEqual({ email: 'a@x' });
			await fromUrl.close();
		});
	},
);
