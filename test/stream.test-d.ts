import { Readable } from 'node:stream';
import { describe, expectTypeOf, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { databaseWith } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import type {
	Connection,
	Pool,
	PoolClient,
	Transaction,
} from '../src/driver/index.js';
import type { RowStream, StreamOptions } from '../src/index.js';
import { fakeExecutor } from './helpers/executor.js';

const users = defineTable('users', {
	columns: { id: integer().identity(), email: text().nullable() },
});

const db = databaseWith(fakeExecutor().executor);
const query = db.selectFrom(users).select(['users.id', 'users.email']);
type Row = { id: number; email: string | null };

declare const conn: Connection;
declare const pool: Pool;
declare const client: PoolClient;
declare const tx: Transaction;

describe('stream()', () => {
	it('streams typed rows, as an async iterator that can be disposed of', async () => {
		const rows = query.stream();
		expectTypeOf(rows).toEqualTypeOf<RowStream<Row>>();
		expectTypeOf(rows).toExtend<AsyncIterable<Row>>();
		expectTypeOf(rows).toExtend<AsyncIterator<Row, undefined>>();
		expectTypeOf(rows).toExtend<AsyncDisposable>();
		for await (const row of rows) expectTypeOf(row).toEqualTypeOf<Row>();
		expectTypeOf(await rows.next()).toEqualTypeOf<
			IteratorResult<Row, undefined>
		>();
		expectTypeOf(Readable.from(query.stream())).toEqualTypeOf<Readable>();
		expectTypeOf(ReadableStream.from(query.stream())).toEqualTypeOf<
			ReadableStream<Row>
		>();
	});

	it('takes a batch size, a signal and a timeout', () => {
		const signal = new AbortController().signal;
		query.stream({ batchSize: 500, signal, timeout: '2s' });
		query.stream({ timeout: 2000 });
		expectTypeOf<StreamOptions>().toHaveProperty('batchSize');
		// @ts-expect-error unknown option
		query.stream({ batch: 500 });
		// @ts-expect-error a stream reads every row
		query.stream({ keepRows: 1 });
	});

	it('is the every-row read: shaped queries have no stream', () => {
		// @ts-expect-error a shape reads a whole result
		void query.takeFirst().stream;
		// @ts-expect-error a shape reads a whole result
		void query.expectOne().stream;
		// @ts-expect-error a shape reads a whole result
		void query.toQuery().stream;
	});

	it('keeps the row type through joins, expressions and locks', () => {
		const posts = defineTable('posts', {
			columns: { id: integer().identity(), userId: integer().name('user_id') },
		});
		const joined = db
			.selectFrom(users)
			.innerJoin(posts)
			.on('posts.userId', 'users.id')
			.select(['posts.id'])
			.select((eb) => [eb.fn.lower('users.email').as('email')])
			.forUpdate()
			.stream();
		expectTypeOf(joined).toEqualTypeOf<
			RowStream<{ id: number; email: string | null }>
		>();
	});
});

describe('driver streams', () => {
	it('return row streams everywhere', () => {
		type N = { n: number };
		expectTypeOf(conn.stream<N>('select 1 as n')).toEqualTypeOf<RowStream<N>>();
		expectTypeOf(pool.stream<N>('select 1 as n')).toEqualTypeOf<RowStream<N>>();
		expectTypeOf(client.stream<N>('select 1 as n')).toEqualTypeOf<
			RowStream<N>
		>();
		expectTypeOf(tx.stream<N>('select 1 as n')).toEqualTypeOf<RowStream<N>>();
		expectTypeOf(conn.cursor<N>('select 1 as n')).toEqualTypeOf<
			AsyncIterable<N[]>
		>();
	});
});
