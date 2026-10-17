import { describe, expectTypeOf, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { databaseWith, type DatabaseTransaction } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import type { QueryDescription } from '../src/executor.js';
import type { NotExecuted, Query } from '../src/query.js';
import { executorFrom, fakeExecutor } from './helpers/executor.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text().nullable(),
	},
});

const db = databaseWith(fakeExecutor().executor);
const query = db.selectFrom(users).select(['users.id', 'users.email']);
type Row = { id: number; email: string | null };

describe('running a query', () => {
	it('shapes the result of the select list, without running it', () => {
		expectTypeOf(query.toQuery()).toEqualTypeOf<Query<Row[]>>();
		expectTypeOf(query.takeFirst()).toEqualTypeOf<Query<Row | undefined>>();
		expectTypeOf(query.expectOne()).toEqualTypeOf<Query<Row>>();
		expectTypeOf(query.expectAtMostOne()).toEqualTypeOf<
			Query<Row | undefined>
		>();
	});

	it("doesn't run when awaited without execute()", async () => {
		const awaited = await query.expectOne();
		expectTypeOf(awaited).toEqualTypeOf<NotExecuted>();
		// @ts-expect-error not a row
		void awaited.id;
		expectTypeOf(await query).toEqualTypeOf<NotExecuted>();
		expectTypeOf(
			await db.insertInto(users).values({ email: null }),
		).toEqualTypeOf<NotExecuted>();
	});

	it('shapes and runs a query with a locking clause like any other', async () => {
		const locked = query.forUpdate().of(users).skipLocked();
		expectTypeOf(locked.toQuery()).toEqualTypeOf<Query<Row[]>>();
		expectTypeOf(locked.limit(1).takeFirst()).toEqualTypeOf<
			Query<Row | undefined>
		>();
		expectTypeOf(query.forShare().expectOne()).toEqualTypeOf<Query<Row>>();
		expectTypeOf(locked.takeFirst().execute()).toEqualTypeOf<
			Promise<Row | undefined>
		>();
		expectTypeOf(locked.execute()).toEqualTypeOf<Promise<Row[]>>();
		expectTypeOf(
			await db.batch([locked.takeFirst(), query.forShare().noWait()]),
		).toEqualTypeOf<[Row | undefined, Row[]]>();
		// @ts-expect-error a shape takes no lock modifiers
		void query.forUpdate().takeFirst().skipLocked();
	});

	it('gives the executor the tag, if any', () => {
		databaseWith(
			executorFrom(async (compiled) => {
				expectTypeOf(compiled.tag).toEqualTypeOf<string | undefined>();
				return { rows: [] };
			}),
		);
	});

	it('takes per-query options, streams rows and describes', () => {
		const controller = new AbortController();
		expectTypeOf(
			query.execute({ signal: controller.signal, timeout: '2s' }),
		).toEqualTypeOf<Promise<Row[]>>();
		expectTypeOf(query.execute()).toEqualTypeOf<Promise<Row[]>>();
		expectTypeOf(query.expectOne().execute()).toEqualTypeOf<Promise<Row>>();
		expectTypeOf(query.stream({ batchSize: 100 })).toEqualTypeOf<
			AsyncGenerator<Row, void, undefined>
		>();
		expectTypeOf(query.describe()).toEqualTypeOf<Promise<QueryDescription>>();
		// @ts-expect-error unknown option
		void query.execute({ timeoutMs: 5 });
	});

	it('runs transactions with a typed transaction database', () => {
		const result = db.transaction(
			async (tx) => {
				expectTypeOf(tx).toEqualTypeOf<DatabaseTransaction>();
				tx.afterCommit(() => {});
				const rows = await tx.selectFrom(users).select(['users.id']).execute();
				return rows.length;
			},
			{
				isolation: 'serializable',
				retries: 3,
				settings: { 'app.tenant': 'a' },
				timeout: '5s',
			},
		);
		expectTypeOf(result).toEqualTypeOf<Promise<number>>();
		// @ts-expect-error a transaction database can't be closed
		void db.transaction(async (tx) => tx.close());
	});
});
