/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BatchError } from '../../../src/batch.js';
import { QueryBudgetError } from '../../../src/budget.js';
import {
	array,
	bigint,
	boolean,
	bytea,
	date,
	daterange,
	decimal,
	integer,
	jsonb,
	text,
	timestamptz,
	tstzrange,
	uuid,
} from '../../../src/column-factories.js';
import { database, type Database } from '../../../src/database.js';
import { defineEnum } from '../../../src/define-enum.js';
import { defineTable } from '../../../src/define-table.js';
import type { QueryEvent } from '../../../src/driver-executor.js';
import {
	DecodeError,
	NotNullViolation,
	PostgresError,
	UniqueViolation,
} from '../../../src/driver/errors.js';
import { createPool, type Pool } from '../../../src/driver/pool.js';
import { defineCodec } from '../../../src/driver/codec.js';
import { oids } from '../../../src/driver/types.js';
import { violatedColumns } from '../../../src/errors.js';
import { NoRowError } from '../../../src/executor.js';
import { sql as sqlTag } from '../../../src/sql.js';
import { noPg, options, rejection, table } from './helpers.js';

const schema = table('dx');
const mood = defineEnum('dx_mood', ['happy', 'sad']);

const items = defineTable('items', {
	columns: {
		id: integer().identity(),
		name: text(),
		tags: array(text()),
		scores: array(integer().nullable()),
		data: jsonb(),
		createdAt: timestamptz().name('created_at'),
		born: date().nullable(),
		blob: bytea().nullable(),
		price: decimal(10, 2),
		visits: bigint(),
		done: boolean(),
		token: uuid().nullable(),
		mood: mood(),
		during: daterange(),
		window: tstzrange(),
	},
});

const accounts = defineTable('accounts', {
	columns: {
		id: integer().identity(),
		name: text(),
		email: text().sensitive(),
		passwordHash: text().name('password_hash').sensitive(),
		pin: text().nullable().default().sensitive(),
		token: uuid().nullable().default().sensitive(),
		settings: jsonb().nullable().default().sensitive(),
	},
});

const notes = defineTable('notes', {
	columns: {
		id: integer().identity(),
		body: text(),
		at: timestamptz(),
		amount: decimal(),
	},
});

/** A view that sleeps for 200ms, for slow queries. */
const nap = defineTable('nap', { columns: { done: text() } });

const at = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678));

const row = (n: number) => ({
	name: `item ${n} 'quoted' \\ back`,
	tags: [`t${n}`, 'a,b "c"', 'x\\y'],
	scores: [n, null],
	data: { n, nested: { s: "it's" } },
	createdAt: new Date(at.getTime() + n * 1000),
	born: '2000-01-31',
	blob: new Uint8Array([n, 0, 255]),
	price: `${n}.25`,
	visits: '9007199254740993',
	done: n % 2 === 0,
	token: null,
	mood: n % 2 === 0 ? ('happy' as const) : ('sad' as const),
	during: {
		empty: false as const,
		lower: '2026-01-01',
		upper: '2026-02-01',
		bounds: '[)' as const,
	},
	window: {
		empty: false as const,
		lower: at,
		upper: null,
		bounds: '[)' as const,
	},
});

describe.skipIf(noPg)('DX features against PostgreSQL', () => {
	let pool: Pool;
	let db: Database;
	const events: QueryEvent[] = [];
	const slow: QueryEvent[] = [];

	beforeAll(async () => {
		pool = createPool({
			...options(),
			max: 4,
			params: { search_path: `${schema},public` },
		});
		db = database(pool, {
			onQuery: (e) => events.push(e),
			slowQuery: { thresholdMs: 150, onSlow: (e) => slow.push(e) },
		});
		await pool.simpleQuery(`
			create schema ${schema};
			create type ${schema}.dx_mood as enum ('happy', 'sad');
			create table ${schema}.items (
				id int generated always as identity primary key,
				name text not null, tags text[] not null, scores int[] not null,
				data jsonb not null, created_at timestamptz not null, born date,
				blob bytea, price numeric(10, 2) not null, visits bigint not null,
				done boolean not null, token uuid, mood ${schema}.dx_mood not null,
				during daterange not null, "window" tstzrange not null
			);
			create table ${schema}.accounts (
				id int generated always as identity primary key,
				name text not null, email text unique not null,
				password_hash text not null, pin text, token uuid, settings jsonb
			);
			create table ${schema}.notes (
				id int generated always as identity primary key,
				body text not null, at timestamptz not null, amount numeric not null
			);
			create view ${schema}.nap as select pg_sleep(0.2)::text as done;
		`);
		await db
			.insertInto(items)
			.values([row(1), row(2), row(3)])
			.execute();
	});

	afterAll(async () => {
		await pool
			?.query(`drop schema if exists ${schema} cascade`)
			.catch(() => {});
		await pool?.end();
	});

	describe('toSQL({ inline })', () => {
		it('pastes into psql: the inlined query returns what the query returns', async () => {
			const queries = [
				db
					.selectFrom(items)
					.select(['items.id'])
					.where('items.name', row(2).name),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where((eb) => eb.ref('items.tags').contains(['a,b "c"', 'x\\y'])),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where('items.scores', [1, null]),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where((eb) =>
						eb.ref('items.data').contains({ nested: { s: "it's" } }),
					),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where((eb) =>
						eb
							.ref('items.createdAt')
							.between([at, new Date(at.getTime() + 2000)]),
					),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where('items.born', '2000-01-31'),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where('items.blob', new Uint8Array([3, 0, 255])),
				db.selectFrom(items).select(['items.id']).where('items.price', '2.25'),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where('items.visits', '9007199254740993'),
				db.selectFrom(items).select(['items.id']).where('items.done', true),
				db.selectFrom(items).select(['items.id']).where('items.mood', 'sad'),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where('items.during', row(1).during),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where((eb) => eb.ref('items.id').in([1, 3]))
					.where((eb) =>
						eb.ref('items.name').in(eb.val([row(1).name, row(3).name])),
					),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where((eb) => eb.val('t2').eq(eb.fn.any('items.tags'))),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where((eb) => eb.json.hasKey('items.data', 'nested')),
			];
			for (const query of queries) {
				const expected = await query.execute();
				expect(expected.length).toBeGreaterThan(0);
				for (const pretty of [false, true]) {
					const { sql, params } = query.toSQL({ inline: true, pretty });
					expect(params).toEqual([]);
					const { rows } = await pool.query(sql);
					expect(rows, sql).toEqual(expected);
				}
			}
		});

		it('casts a range’s single point, which the parameter alone leaves to inference', async () => {
			for (const query of [
				db
					.selectFrom(items)
					.select(['items.id'])
					.where((eb) => eb.ref('items.during').contains('2026-01-15')),
				db
					.selectFrom(items)
					.select(['items.id'])
					.where((eb) =>
						eb.ref('items.window').contains(new Date(at.getTime() + 1)),
					),
			]) {
				const { rows } = await pool.query(query.toSQL({ inline: true }).sql);
				expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
			}
		});

		it('inlines writes that run as they would', async () => {
			const insert = db
				.insertInto(items)
				.values(row(10))
				.returning(['items.name', 'items.tags', 'items.data', 'items.window']);
			const { sql } = insert.toSQL({ inline: true, pretty: true });
			await pool.query('begin');
			try {
				const { rows } = await pool.query(sql);
				expect(rows).toEqual([
					{
						name: row(10).name,
						tags: row(10).tags,
						data: row(10).data,
						window: '["2026-01-02 03:04:05.678+00",)',
					},
				]);
			} finally {
				await pool.query('rollback');
			}
			const many = db
				.insertInto(items)
				.values([row(11), row(12)])
				.toSQL({ inline: true });
			const unnest = db
				.insertInto(notes)
				.values([
					{ body: "it's", at, amount: '1.50' },
					{ body: 'x\\y "z"', at, amount: '-2' },
				])
				.toSQL({ inline: true });
			expect(unnest.sql).toContain('unnest(');
			const updated = db
				.update(items)
				.set({ tags: ['z'], data: [1, 'two'], born: null })
				.where('items.id', 1)
				.toSQL({ inline: true, pretty: true });
			const client = await pool.acquire();
			try {
				await client.query('begin');
				await client.query(many.sql);
				await client.query(unnest.sql);
				const { rows: written } = await client.query(
					`select body, at, amount from ${schema}.notes order by id`,
				);
				const stamp = '2026-01-02 03:04:05.678+00';
				expect(written).toEqual([
					{ body: "it's", at: stamp, amount: '1.50' },
					{ body: 'x\\y "z"', at: stamp, amount: '-2' },
				]);
				const result = await client.query(updated.sql);
				expect(result.rowCount).toBe(1);
				const { rows } = await client.query<{ data: unknown; born: unknown }>(
					`select data, born from ${schema}.items where id = 1`,
				);
				expect(rows).toEqual([{ data: [1, 'two'], born: null }]);
			} finally {
				await client.query('rollback');
				client.release();
			}
		});
	});

	describe('slowQuery', () => {
		it('reports queries at or above the threshold, with onQuery’s event', async () => {
			slow.length = 0;
			events.length = 0;
			await db
				.selectFrom(items)
				.select(['items.id'])
				.where('items.id', 1)
				.execute();
			expect(slow).toEqual([]);
			await db.selectFrom(nap).select(['nap.done']).tag('nap.all').execute();
			expect(slow).toHaveLength(1);
			expect(slow[0]).toBe(events.at(-1));
			expect(slow[0]?.tag).toBe('nap.all');
			expect(slow[0]?.durationMs).toBeGreaterThanOrEqual(150);
			for await (const _ of db.selectFrom(nap).select(['nap.done']).stream());
			expect(slow.map((e) => e.kind)).toEqual(['execute', 'stream']);
		});
	});

	describe('db.budget', () => {
		it('refuses the query over maxQueries before it is sent', async () => {
			events.length = 0;
			const error = await rejection(
				db.budget({ maxQueries: 2 }, async (usage) => {
					await db.selectFrom(items).where('items.id', 1).execute();
					await db.selectFrom(items).where('items.id', 2).execute();
					expect(usage.queries).toBe(2);
					await db.selectFrom(items).where('items.id', 3).execute();
				}),
				QueryBudgetError,
			);
			expect(error.limit).toBe('queries');
			expect(error.budget).toEqual({ maxQueries: 2 });
			expect(error.usage.queries).toBe(3);
			expect(error.query.params).toEqual([3]);
			expect(error.stack).toContain('--- query issued at ---');
			expect(events).toHaveLength(2);
		});

		it('throws from the query that takes the time over maxDurationMs, then refuses the rest', async () => {
			events.length = 0;
			const errors = await db.budget({ maxDurationMs: 100 }, async () => {
				const fast = await db.selectFrom(items).where('items.id', 1).execute();
				expect(fast).toHaveLength(1);
				const first = await rejection(
					db.selectFrom(nap).select(['nap.done']).execute(),
					QueryBudgetError,
				);
				const next = await rejection(
					db.selectFrom(items).where('items.id', 1).execute(),
					QueryBudgetError,
				);
				return [first, next];
			});
			expect(errors.map((e) => e.limit)).toEqual(['duration', 'duration']);
			expect(errors[0]?.usage.durationMs).toBeGreaterThan(100);
			// the slow query ran; the one after it was never sent
			expect(events).toHaveLength(2);
		});

		it('reports once with onExceeded, and lets queries go on', async () => {
			const reports: unknown[] = [];
			const result = await db.budget(
				{ maxQueries: 1, onExceeded: (usage) => reports.push(usage) },
				async (usage) => {
					for (let i = 0; i < 3; i++)
						await db.selectFrom(items).where('items.id', 1).execute();
					return usage.queries;
				},
			);
			expect(result).toBe(3);
			expect(reports).toEqual([
				{ queries: 2, durationMs: expect.any(Number), exceeded: 'queries' },
			]);
		});

		it('counts streams and transactions, nests, and keeps concurrent budgets apart', async () => {
			const counts = await Promise.all(
				[1, 2].map((n) =>
					db.budget({}, async (outer) => {
						await db.budget({}, async (inner) => {
							for await (const _ of db
								.selectFrom(items)
								.select(['items.id'])
								.stream())
								break;
							expect(inner.queries).toBe(1);
						});
						await db.transaction(async (tx) => {
							for (let i = 0; i < n; i++)
								await tx.selectFrom(items).where('items.id', 1).execute();
						});
						return outer.queries;
					}),
				),
			);
			expect(counts).toEqual([2, 3]);
			// another database's queries don't count
			const other = database(pool);
			const used = await db.budget({ maxQueries: 0 }, async (usage) => {
				await other.selectFrom(items).where('items.id', 1).execute();
				return usage.queries;
			});
			expect(used).toBe(0);
			await expect(
				db.budget({ maxQueries: -1 }, async () => 1),
			).rejects.toThrow(RangeError);
		});
		it('counts db.sql and tx.sql statements, alone, in transactions and batched, and setEach updates', async () => {
			const used = await db.budget({}, async (usage) => {
				await db.sql`select 1`.execute();
				await db.transaction(async (tx) => {
					await tx.sql<{ n: number }>`select ${1}::int as n`
						.expectValue()
						.execute();
				});
				await db.batch([db.sql`select 1`, db.sql`select 2`]);
				await db
					.update(items)
					.setEach([{ id: 1, done: true }], { key: 'id' })
					.expectRows(1)
					.execute();
				return usage.queries;
			});
			expect(used).toBe(5);
			const error = await rejection(
				db.budget({ maxQueries: 1 }, async () => {
					await db.sql`select 1`.execute();
					await db.sql`select ${2}::int`.execute();
				}),
				QueryBudgetError,
			);
			expect(error.limit).toBe('queries');
			expect(error.query.params).toEqual([2]);
		});

		it('counts each query of a batch, refusing a batch over maxQueries whole', async () => {
			events.length = 0;
			const byId = (id: number) =>
				db.selectFrom(items).select(['items.id']).where('items.id', id);
			const error = await rejection(
				db.budget({ maxQueries: 3 }, async (usage) => {
					const [all, first] = await db.batch([byId(1), byId(2).takeFirst()]);
					expect([all, first]).toEqual([[{ id: 1 }], { id: 2 }]);
					expect(usage.queries).toBe(2);
					await db.batch([byId(1), byId(2), byId(3)]);
				}),
				QueryBudgetError,
			);
			expect(error.limit).toBe('queries');
			expect(error.usage.queries).toBe(5);
			// the first query over: the batch's second
			expect(error.query.params).toEqual([2]);
			expect(error.stack).toContain('--- query issued at ---');
			// the refused batch sent nothing
			expect(events).toHaveLength(2);
		});

		it('counts a batch’s round trip once toward maxDurationMs, and throws once it ran', async () => {
			slow.length = 0;
			const usage = await db.budget({}, async (used) => {
				await db.batch([
					db.selectFrom(nap).select(['nap.done']),
					db.selectFrom(nap).select(['nap.done']),
				]);
				return { queries: used.queries, durationMs: used.durationMs };
			});
			// the server runs them in turn: about 400ms, counted once, not 200 + 400
			expect(usage.queries).toBe(2);
			expect(usage.durationMs).toBeGreaterThanOrEqual(390);
			expect(usage.durationMs).toBeLessThan(580);
			// each query of it is reported, timed from when the batch started
			expect(slow).toHaveLength(2);
			const before = await db.selectFrom(notes).execute();
			const error = await rejection(
				db.budget({ maxDurationMs: 100 }, () =>
					db.batch(
						[
							db.insertInto(notes).values({ body: 'budget', at, amount: '1' }),
							db.selectFrom(nap).select(['nap.done']),
						],
						{ transaction: true },
					),
				),
				QueryBudgetError,
			);
			expect(error.limit).toBe('duration');
			// it ran and committed, as a single query outside a transaction does
			expect(await db.selectFrom(notes).execute()).toHaveLength(
				before.length + 1,
			);
		});
	});

	describe('sensitive columns', () => {
		it('redacts onQuery params, and sends and returns the real values', async () => {
			events.length = 0;
			const inserted = await db
				.insertInto(accounts)
				.values({
					name: 'Ada',
					email: 'ada@example.com',
					passwordHash: 'hash-of-hunter2',
					pin: '4242',
				})
				.returning(['accounts.email', 'accounts.passwordHash'])
				.expectOne()
				.execute();
			expect(inserted).toEqual({
				email: 'ada@example.com',
				passwordHash: 'hash-of-hunter2',
			});
			const found = await db
				.selectFrom(accounts)
				.select(['accounts.name'])
				.where('accounts.email', 'ada@example.com')
				.expectOne()
				.execute();
			expect(found).toEqual({ name: 'Ada' });
			await db
				.update(accounts)
				.set({ passwordHash: 'hash-of-swordfish' })
				.where('accounts.email', 'ada@example.com')
				.expectRows(1)
				.execute();
			await db
				.update(accounts)
				.setEach([{ id: 1, pin: '1111' }], { key: ['id'] })
				.execute();
			const shown = inspect(events, { depth: 5 });
			for (const secret of [
				'ada@example.com',
				'hunter2',
				'swordfish',
				'4242',
				'1111',
			])
				expect(shown).not.toContain(secret);
			expect(events[0]?.params).toEqual([
				'Ada',
				'[redacted]',
				'[redacted]',
				'[redacted]',
			]);
			const { rows } = await pool.query<{ password_hash: string; pin: string }>(
				`select password_hash, pin from ${schema}.accounts`,
			);
			expect(rows).toEqual([
				{ password_hash: 'hash-of-swordfish', pin: '1111' },
			]);
		});

		it('redacts constraint details and messages, keeping violatedColumns', async () => {
			const duplicate = await rejection(
				db
					.insertInto(accounts)
					.values({
						name: 'Ada 2',
						email: 'ada@example.com',
						passwordHash: 'h',
					})
					.execute(),
				UniqueViolation,
			);
			expect(duplicate.detail).toBe('Key (email)=([redacted]) already exists.');
			expect(violatedColumns(duplicate, accounts)).toEqual(['email']);
			expect(duplicate.query?.params).toEqual([
				'Ada 2',
				'[redacted]',
				'[redacted]',
			]);
			// declared nullable here, to reach the database's NOT NULL
			const loose = defineTable('accounts', {
				columns: {
					name: text(),
					email: text().sensitive(),
					passwordHash: text().name('password_hash').nullable().sensitive(),
				},
			});
			const missing = await rejection(
				db
					.insertInto(loose)
					.values({ name: 'Bob', email: 'bob@example.com', passwordHash: null })
					.execute(),
				NotNullViolation,
			);
			expect(missing.detail).toBe('Failing row contains ([redacted]).');
			const malformed = await rejection(
				db
					.insertInto(accounts)
					.values({
						name: 'Cy',
						email: 'cy@example.com',
						passwordHash: 'h',
						token: 'not-a-uuid-secret',
					})
					.execute(),
				PostgresError,
			);
			expect(malformed.message).toBe(
				'invalid input syntax for type uuid: "[redacted]"',
			);
			for (const error of [duplicate, missing, malformed]) {
				const shown = `${inspect(error)} ${JSON.stringify(error)} ${error.stack}`;
				for (const secret of [
					'ada@example.com',
					'bob@example.com',
					'not-a-uuid-secret',
				])
					expect(shown).not.toContain(secret);
			}
		});

		it("redacts quarry's own errors", async () => {
			const error = await rejection(
				db
					.selectFrom(accounts)
					.select(['accounts.id'])
					.where('accounts.email', 'nobody@example.com')
					.expectOne()
					.execute(),
				NoRowError,
			);
			expect(error.query.params).toEqual(['[redacted]']);
		});

		it('redacts a decode error on a sensitive column', async () => {
			await db
				.update(accounts)
				.set({ settings: { pin: 1234 } })
				.where('accounts.id', 1)
				.execute();
			const failingJson = defineCodec({
				name: 'jsonb',
				oid: oids.jsonb,
				encode: (value: unknown) => JSON.stringify(value),
				decodeText: (raw): unknown => {
					throw new SyntaxError(`Unexpected token in ${raw}`);
				},
			});
			const failingAccounts = defineTable('accounts', {
				columns: {
					id: integer().identity(),
					settings: jsonb()
						.nullable()
						.default()
						.useCodec(failingJson)
						.sensitive(),
				},
			});
			const failingItems = defineTable('items', {
				columns: {
					id: integer().identity(),
					data: jsonb().useCodec(failingJson),
				},
			});
			const secret = await rejection(
				db.selectFrom(failingAccounts).select(['accounts.settings']).execute(),
				DecodeError,
			);
			expect(secret.column).toBe('settings');
			expect(secret.message).toBe(
				`Could not decode a value of column "settings" (type OID ${oids.jsonb})`,
			);
			expect(secret.cause).toBeUndefined();
			expect(inspect(secret)).not.toContain('1234');
			const plain = await rejection(
				db
					.selectFrom(failingItems)
					.select(['items.data'])
					.where('items.id', 1)
					.execute(),
				DecodeError,
			);
			expect(plain.cause).toBeInstanceOf(SyntaxError);
		});

		it('redacts the events and errors of batched queries', async () => {
			events.length = 0;
			const nobody = db
				.selectFrom(accounts)
				.select(['accounts.id'])
				.where('accounts.email', 'nobody@example.com');
			const duplicate = db.insertInto(accounts).values({
				name: 'Dup',
				email: 'ada@example.com',
				passwordHash: 'hash-of-a-secret',
			});
			const failed = await rejection(
				db.batch([nobody.expectOne(), duplicate, nobody.takeFirst()]),
				BatchError,
			);
			const [noRow, unique]: unknown[] = failed.errors;
			expect(noRow).toBeInstanceOf(NoRowError);
			expect(noRow).toMatchObject({ query: { params: ['[redacted]'] } });
			expect(unique).toBeInstanceOf(UniqueViolation);
			expect(unique).toMatchObject({
				detail: 'Key (email)=([redacted]) already exists.',
			});
			expect(failed.results[2]).toEqual({
				status: 'fulfilled',
				value: undefined,
			});
			const atomic = await rejection(
				db.batch([duplicate.expectRows(1)], { transaction: true }),
				UniqueViolation,
			);
			expect(atomic.query?.params).toEqual(['Dup', '[redacted]', '[redacted]']);
			const shown = inspect([failed, atomic, events], { depth: 6 });
			for (const secret of [
				'nobody@example.com',
				'ada@example.com',
				'hash-of-a-secret',
			]) {
				expect(shown).not.toContain(secret);
			}
			expect(events.map((e) => e.params)).toContainEqual(['[redacted]']);
		});

		it('redacts db.sql and tx.sql statements, their events and errors', async () => {
			events.length = 0;
			const error = await rejection(
				db.sql`insert into ${accounts} (name, email, password_hash) values (${'Dup'}, ${'ada@example.com'}, ${'hash-of-sql'})`.execute(),
				UniqueViolation,
			);
			expect(error.detail).toBe('Key (email)=([redacted]) already exists.');
			expect(error.query?.params).toEqual([
				'[redacted]',
				'[redacted]',
				'[redacted]',
			]);
			await db.transaction(async (tx) => {
				await tx.sql`update accounts set pin = ${sqlTag.sensitive('pin-from-sql')} where id = ${1}`.execute();
			});
			expect(
				await db
					.selectFrom(accounts)
					.select(['accounts.pin'])
					.where('accounts.id', 1)
					.expectValue()
					.execute(),
			).toBe('pin-from-sql');
			const shown = inspect([error, events], { depth: 6 });
			for (const secret of ['ada@example.com', 'hash-of-sql', 'pin-from-sql']) {
				expect(shown).not.toContain(secret);
			}
			expect(events.map((e) => e.params)).toContainEqual(['[redacted]', 1]);
		});
	});
});
