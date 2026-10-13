import { describe, expectTypeOf, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { databaseWith, type DatabaseTransaction } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import type { QueryDescription } from '../src/executor.js';
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
	it('returns the rows of the select list', () => {
		expectTypeOf(query.all()).toEqualTypeOf<Promise<Row[]>>();
		expectTypeOf(query.first()).toEqualTypeOf<Promise<Row | undefined>>();
		expectTypeOf(query.one()).toEqualTypeOf<Promise<Row>>();
		expectTypeOf(query.maybeOne()).toEqualTypeOf<Promise<Row | undefined>>();
	});

	it('runs a query with a locking clause like any other', () => {
		const locked = query.forUpdate().of(users).skipLocked();
		expectTypeOf(locked.all()).toEqualTypeOf<Promise<Row[]>>();
		expectTypeOf(locked.first()).toEqualTypeOf<Promise<Row | undefined>>();
		expectTypeOf(query.forShare().one()).toEqualTypeOf<Promise<Row>>();
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
			query.all({ signal: controller.signal, timeout: '2s' }),
		).toEqualTypeOf<Promise<Row[]>>();
		expectTypeOf(query.stream({ batchSize: 100 })).toEqualTypeOf<
			AsyncGenerator<Row, void, undefined>
		>();
		expectTypeOf(query.describe()).toEqualTypeOf<Promise<QueryDescription>>();
		// @ts-expect-error unknown option
		void query.all({ timeoutMs: 5 });
	});

	it('runs transactions with a typed transaction database', () => {
		const result = db.transaction(
			async (tx) => {
				expectTypeOf(tx).toEqualTypeOf<DatabaseTransaction>();
				tx.afterCommit(() => {});
				const rows = await tx.selectFrom(users).select(['users.id']).all();
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
