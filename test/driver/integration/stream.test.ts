/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	array,
	bigint,
	decimal,
	integer,
	jsonb,
	text,
	timestamptz,
} from '../../../src/column-factories.js';
import { database, type Database } from '../../../src/database.js';
import { defineEnum } from '../../../src/define-enum.js';
import { defineTable } from '../../../src/define-table.js';
import type { QueryEvent } from '../../../src/driver-executor.js';
import { defineCodec } from '../../../src/driver/codec.js';
import { codecs } from '../../../src/driver/codecs.js';
import {
	AbortError,
	DriverError,
	PostgresError,
	QueryCanceled,
} from '../../../src/driver/errors.js';
import { createPool, type Pool } from '../../../src/driver/pool.js';
import { versionAtLeast } from '../setup/cluster.js';
import { cluster, noPg, options, pg, rejection, table } from './helpers.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mood = defineEnum('stream_mood', ['happy', 'sad']);

const items = defineTable('items', {
	columns: {
		id: integer().identity(),
		label: text(),
		big: bigint(),
		price: decimal(),
		at: timestamptz(),
		tags: array(text()),
		moods: array(mood()),
		meta: jsonb<{ n: number }>(),
	},
});

/** A view of `count` rows, generated as they are read. */
const many = defineTable('many', {
	columns: { id: integer(), label: text() },
});

/** A view whose rows divide by zero from the fifth on. */
const failing = defineTable('failing', { columns: { v: integer() } });

/** A view whose rows take 50ms each. */
const slow = defineTable('slow', { columns: { id: integer() } });

/** A view counting the rows the server produced, in the sequence `produced`. */
const counted = defineTable('counted', { columns: { id: integer() } });

const ROWS = 2_000_000;

/** Reads `rows` to the end, sampling the heap: the most it grew over where it started. */
async function heapGrowth(rows: AsyncIterable<unknown>): Promise<{
	count: number;
	grewBy: number;
}> {
	const start = process.memoryUsage().heapUsed;
	let most = 0;
	let count = 0;
	for await (const _ of rows) {
		if (++count % 50_000 === 0)
			most = Math.max(most, process.memoryUsage().heapUsed - start);
	}
	return { count, grewBy: most };
}

describe.skipIf(noPg)('stream() on the driver', () => {
	const schema = table('stream');
	let pool: Pool;
	let db: Database;
	const events: QueryEvent[] = [];
	const config = () => ({
		...options(),
		params: { search_path: `${schema},public` },
	});

	beforeAll(async () => {
		pool = createPool({ ...config(), max: 4 });
		db = database(pool, { onQuery: (e) => events.push(e) });
		await pool.simpleQuery(`
			create schema ${schema};
			set search_path = ${schema};
			create type stream_mood as enum ('happy', 'sad');
			create table items (
				id int generated always as identity primary key, label text not null, big bigint not null,
				price numeric not null, at timestamptz not null, tags text[] not null,
				moods stream_mood[] not null, meta jsonb not null
			);
			insert into items (label, big, price, at, tags, moods, meta)
			select 'item ' || g, 9007199254740993 + g, (g / 3.0)::numeric(20, 6),
				timestamptz '2024-01-01 00:00:00+00' + g * interval '1 minute',
				array['t' || g, 'x,y "q"'], array['happy', 'sad']::stream_mood[], jsonb_build_object('n', g)
			from generate_series(1, 5000) g;
			create view many as select g as id, 'label ' || g as label from generate_series(1, ${ROWS}) g;
			create view failing as select 10 / (5 - g) as v from generate_series(1, 10) g;
			create view slow as select g as id from generate_series(1, 100) g where pg_sleep(0.05 + 0 * g)::text = '';
			create sequence produced;
			create view counted as select nextval('produced')::int as id from generate_series(1, 100000);
		`);
	});

	afterAll(async () => {
		await pool
			?.query(`drop schema if exists ${schema} cascade`)
			.catch(() => {});
		await pool?.end();
	});

	const all = () =>
		db
			.selectFrom(items)
			.select([
				'items.id',
				'items.label',
				'items.big',
				'items.price',
				'items.at',
				'items.tags',
				'items.moods',
				'items.meta',
			]);

	it('decodes rows as execute() does, through each column’s codec', async () => {
		const streamed: unknown[] = [];
		for await (const row of all().stream({ batchSize: 777 }))
			streamed.push(row);
		const executed = await all().execute();
		expect(streamed).toHaveLength(5000);
		expect(streamed.toSorted((a: any, b: any) => a.id - b.id)).toEqual(
			executed.toSorted((a, b) => a.id - b.id),
		);
		expect(streamed[0]).toMatchObject({
			big: '9007199254740994',
			price: '0.333333',
			at: new Date(Date.UTC(2024, 0, 1, 0, 1)),
			tags: ['t1', 'x,y "q"'],
			moods: ['happy', 'sad'],
			meta: { n: 1 },
		});
	});

	it('reads binary from the first run, once the statement is described', async () => {
		let binary = 0;
		let texts = 0;
		const countedInt4 = defineCodec({
			name: 'int4',
			oid: 23,
			encode: (value: number) => String(value),
			decodeText: (value: string) => {
				texts++;
				return Number(value);
			},
			decodeBinary: (bytes, start, end) => {
				binary++;
				return codecs.int4.decodeBinary?.(bytes, start, end) ?? 0;
			},
		});
		const countedItems = defineTable('items', {
			columns: { id: integer().useCodec(countedInt4) },
		});
		for (const prepare of [true, false]) {
			binary = 0;
			texts = 0;
			await using fresh = database({ ...config(), max: 1, prepare });
			const ids: number[] = [];
			for await (const row of fresh
				.selectFrom(countedItems)
				.select(['items.id'])
				.where((eb) => eb.ref('items.id').lte(10))
				.stream())
				ids.push(row.id);
			expect(ids.toSorted((a, b) => a - b)).toEqual([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
			]);
			expect({ prepare, binary, texts }).toEqual({
				prepare,
				binary: 10,
				texts: 0,
			});
		}
	});

	it(`streams ${ROWS.toLocaleString('en')} rows in bounded memory`, async () => {
		const { count, grewBy } = await heapGrowth(
			db.selectFrom(many).select(['many.id', 'many.label']).stream(),
		);
		expect(count).toBe(ROWS);
		// the whole result would be well over 200 MB of objects
		expect(grewBy).toBeLessThan(64 * 1024 * 1024);
	}, 120_000);

	it('fetches a batch only once the rows before it are taken', async () => {
		const produced = async () =>
			(
				await pool.query<{ n: string }>(
					`select last_value::text as n from ${schema}.produced`,
				)
			).rows[0]?.n;
		const rows = db
			.selectFrom(counted)
			.select(['counted.id'])
			.stream({ batchSize: 100 });
		expect(await produced()).toBe('1');
		expect((await rows.next()).value).toEqual({ id: 1 });
		await sleep(50);
		expect(await produced()).toBe('100');
		for (let i = 2; i <= 100; i++) await rows.next();
		await sleep(50);
		expect(await produced()).toBe('100');
		expect((await rows.next()).value).toEqual({ id: 101 });
		expect(await produced()).toBe('200');
		await rows.return();
		expect(pool.stats.busy).toBe(0);
	});

	it('releases the connection when the loop breaks, throws or returns', async () => {
		await using one = database({ ...config(), max: 1 });
		const query = one.selectFrom(many).select(['many.id']);
		for await (const row of query.stream({ batchSize: 10 })) {
			if (row.id === 25) break;
		}
		expect(
			await one
				.selectFrom(items)
				.select(['items.id'])
				.where('items.id', 1)
				.takeValue()
				.execute(),
		).toBe(1);
		await expect(
			(async () => {
				for await (const row of query.stream())
					if (row.id === 3) throw new Error('loop failed');
			})(),
		).rejects.toThrow('loop failed');
		const firstId = async () => {
			for await (const row of query.stream()) return row.id;
			return undefined;
		};
		expect(await firstId()).toBe(1);
		{
			await using rows = query.stream();
			expect((await rows.next()).value).toEqual({ id: 1 });
		}
		expect(
			(await one.selectFrom(items).select(['items.id']).limit(2).execute())
				.length,
		).toBe(2);
	});

	it('stops when aborted, between batches and while one is read', async () => {
		await using one = database({ ...config(), max: 1 });
		const controller = new AbortController();
		const seen: number[] = [];
		const error = await rejection(
			(async () => {
				for await (const row of one
					.selectFrom(many)
					.select(['many.id'])
					.stream({ batchSize: 10, signal: controller.signal })) {
					seen.push(row.id);
					if (row.id === 15) controller.abort(new Error('enough'));
				}
			})(),
			AbortError,
		);
		expect(error.message).toBe('The cursor was aborted');
		// the batch already taken is still read, the next one never fetched
		expect(seen).toHaveLength(20);
		expect(
			await one
				.selectFrom(items)
				.select(['items.id'])
				.where('items.id', 2)
				.takeValue()
				.execute(),
		).toBe(2);

		const running = new AbortController();
		const started = Date.now();
		setTimeout(() => running.abort(), 150);
		const canceled = await rejection(
			(async () => {
				for await (const _ of one
					.selectFrom(slow)
					.select(['slow.id'])
					.stream({ batchSize: 50, signal: running.signal }));
			})(),
			QueryCanceled,
		);
		expect(canceled.reason).toBe('abort');
		expect(Date.now() - started).toBeLessThan(2000);
		expect(
			await one
				.selectFrom(items)
				.select(['items.id'])
				.where('items.id', 3)
				.takeValue()
				.execute(),
		).toBe(3);

		const before = new AbortController();
		before.abort();
		await expect(
			one
				.selectFrom(many)
				.select(['many.id'])
				.stream({ signal: before.signal })
				.next(),
		).rejects.toBeInstanceOf(AbortError);
	});

	it('surfaces errors in the middle of a stream, then frees the connection', async () => {
		await using one = database({ ...config(), max: 1 });
		const rows: unknown[] = [];
		const error = await rejection(
			(async () => {
				for await (const row of one
					.selectFrom(failing)
					.select(['failing.v'])
					.stream({ batchSize: 2 }))
					rows.push(row);
			})(),
			PostgresError,
		);
		expect(error.code).toBe('22012');
		expect(rows).toEqual([{ v: 2 }, { v: 3 }, { v: 5 }, { v: 10 }]);
		expect(error.stack).toContain('--- query issued at ---');
		expect(Reflect.get(error, 'query')).toMatchObject({
			sql: expect.stringContaining('"failing"'),
		});
		expect(
			await one
				.selectFrom(items)
				.select(['items.id'])
				.where('items.id', 4)
				.takeValue()
				.execute(),
		).toBe(4);
	});

	it('bounds the whole stream with a timeout, and refuses one inside a transaction', async () => {
		const timedOut = await rejection(
			(async () => {
				for await (const _ of db
					.selectFrom(many)
					.select(['many.id'])
					.stream({ batchSize: 10, timeout: '200ms' }))
					await sleep(20);
			})(),
			QueryCanceled,
		);
		expect(timedOut.reason).toBe('statement_timeout');
		let n = 0;
		for await (const _ of db
			.selectFrom(items)
			.select(['items.id'])
			.stream({ timeout: '5s' }))
			n++;
		expect(n).toBe(5000);
		const [setting] = await Promise.all(
			Array.from({ length: 4 }, () =>
				pool.query<{ statement_timeout: string }>('show statement_timeout'),
			),
		);
		expect(setting?.rows[0]?.statement_timeout).toBe('0');
		await expect(
			db.transaction(async (tx) => {
				for await (const _ of tx
					.selectFrom(items)
					.select(['items.id'])
					.stream({ timeout: '1s' }));
			}),
		).rejects.toBeInstanceOf(DriverError);
	});

	it('runs the loop’s queries between batches inside a transaction', async () => {
		const rolledBack = new Error('roll back');
		await expect(
			db.transaction(async (tx) => {
				let seen = 0;
				for await (const row of tx
					.selectFrom(items)
					.select(['items.id'])
					.where((eb) => eb.ref('items.id').lte(300))
					.stream({ batchSize: 64 })) {
					seen++;
					await tx
						.update(items)
						.set({ label: `seen ${row.id}` })
						.where('items.id', row.id)
						.execute();
					const label = await tx
						.selectFrom(items)
						.select(['items.label'])
						.where('items.id', row.id)
						.expectValue()
						.execute();
					expect(label).toBe(`seen ${row.id}`);
				}
				expect(seen).toBe(300);
				throw rolledBack;
			}),
		).rejects.toBe(rolledBack);
		expect(
			await db
				.selectFrom(items)
				.select(['items.label'])
				.where('items.id', 7)
				.expectValue()
				.execute(),
		).toBe('item 7');
		// two streams of one transaction, read in step
		await db.transaction(async (tx) => {
			const a = tx
				.selectFrom(items)
				.select(['items.id'])
				.where((eb) => eb.ref('items.id').lte(100))
				.stream({ batchSize: 7 });
			const b = tx
				.selectFrom(many)
				.select(['many.id'])
				.stream({ batchSize: 13 });
			for (let i = 0; i < 100; i++) {
				const [x, y] = await Promise.all([a.next(), b.next()]);
				expect(x.done).toBe(false);
				expect(y.value).toEqual({ id: i + 1 });
			}
			expect((await a.next()).done).toBe(true);
			await b.return();
		});
	});

	it('rolls back when the loop throws inside a transaction, and keeps the pool clean', async () => {
		await expect(
			db.transaction(async (tx) => {
				await tx
					.update(items)
					.set({ label: 'changed' })
					.where('items.id', 1)
					.execute();
				for await (const row of tx
					.selectFrom(many)
					.select(['many.id'])
					.stream({ batchSize: 5 }))
					if (row.id === 12) throw new Error('loop failed');
			}),
		).rejects.toThrow('loop failed');
		expect(
			await db
				.selectFrom(items)
				.select(['items.label'])
				.where('items.id', 1)
				.expectValue()
				.execute(),
		).toBe('item 1');
		expect(pool.stats.busy).toBe(0);
	});

	it('reports the stream to onQuery once it ends', async () => {
		events.length = 0;
		let n = 0;
		for await (const _ of db
			.selectFrom(items)
			.select(['items.id'])
			.tag('items.stream')
			.stream({ batchSize: 1000 }))
			n++;
		const event = events.find((e) => e.kind === 'stream');
		expect(event).toMatchObject({
			tag: 'items.stream',
			command: 'SELECT',
			rowCount: n,
			error: undefined,
		});
	});

	it('pipes into Node and web streams with backpressure, closing on destroy and cancel', async () => {
		await using one = database({ ...config(), max: 1 });
		let written = 0;
		await pipeline(
			Readable.from(
				one
					.selectFrom(items)
					.select(['items.id', 'items.label'])
					.stream({ batchSize: 100 }),
			),
			new Writable({
				objectMode: true,
				highWaterMark: 4,
				write(_row, _encoding, done) {
					written++;
					setImmediate(done);
				},
			}),
		);
		expect(written).toBe(5000);

		const readable = Readable.from(
			one.selectFrom(many).select(['many.id']).stream(),
		);
		let read = 0;
		for await (const _ of readable) if (++read === 10) break;
		expect(readable.destroyed).toBe(true);

		const web = ReadableStream.from(
			one.selectFrom(many).select(['many.id']).stream({ batchSize: 50 }),
		);
		const reader = web.getReader();
		expect((await reader.read()).value).toEqual({ id: 1 });
		await reader.cancel();
		expect(
			await one
				.selectFrom(items)
				.select(['items.id'])
				.where('items.id', 5)
				.takeValue()
				.execute(),
		).toBe(5);
	});
});

// named prepared statements in transaction mode need PgBouncer 1.21+
const bouncerPrepares = versionAtLeast(pg?.bouncerVersion, 1, 21);

/** A view in `public`: PgBouncer takes no `search_path` at startup. */
const bouncerMany = defineTable('stream_bouncer_many', {
	columns: { id: integer(), label: text() },
});

const bouncer = (prepare: boolean) => ({
	host: cluster().host,
	port: cluster().bouncerPort ?? 0,
	database: cluster().database,
	user: 'postgres',
	password: undefined,
	ssl: 'disable' as const,
	prepare,
});

describe.skipIf(!pg?.bouncerPort)(
	'stream() through PgBouncer in transaction mode',
	() => {
		let setup: Pool;

		beforeAll(async () => {
			setup = createPool({ ...options(), max: 1 });
			await setup.query(
				`create or replace view stream_bouncer_many as select g as id, 'label ' || g as label from generate_series(1, 200000) g`,
			);
		});

		afterAll(async () => {
			await setup
				?.query('drop view if exists stream_bouncer_many')
				.catch(() => {});
			await setup?.end();
		});

		for (const prepare of bouncerPrepares ? [true, false] : [false]) {
			it(`streams, breaks, times out and interleaves in transactions (prepare: ${prepare})`, async () => {
				await using db = database({ ...bouncer(prepare), max: 4 });
				const query = db
					.selectFrom(bouncerMany)
					.select(['stream_bouncer_many.id', 'stream_bouncer_many.label']);
				for (let run = 0; run < 2; run++) {
					let n = 0;
					let sum = 0;
					for await (const row of query.stream({ batchSize: 5000 })) {
						n++;
						sum += row.id;
					}
					expect([n, sum]).toEqual([200_000, (200_000 * 200_001) / 2]);
				}
				// several streams at once, each holding its server connection until it ends
				const firsts = await Promise.all(
					Array.from({ length: 4 }, async (_, i) => {
						for await (const row of query.stream({ batchSize: 10 }))
							if (row.id === 50 + i) return row.label;
						return undefined;
					}),
				);
				expect(firsts).toEqual([
					'label 50',
					'label 51',
					'label 52',
					'label 53',
				]);
				const timedOut = await rejection(
					(async () => {
						for await (const _ of query.stream({
							batchSize: 10,
							timeout: '150ms',
						}))
							await sleep(10);
					})(),
					QueryCanceled,
				);
				expect(timedOut.reason).toBe('statement_timeout');
				await db.transaction(async (tx) => {
					let n = 0;
					for await (const row of tx
						.selectFrom(bouncerMany)
						.select(['stream_bouncer_many.id'])
						.stream({ batchSize: 100 })) {
						const again = await tx
							.selectFrom(bouncerMany)
							.select(['stream_bouncer_many.label'])
							.where('stream_bouncer_many.id', row.id)
							.expectValue()
							.execute();
						expect(again).toBe(`label ${row.id}`);
						if (++n === 250) break;
					}
				});
			}, 60_000);
		}
	},
);
