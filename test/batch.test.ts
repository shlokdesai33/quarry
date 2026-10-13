import { describe, expect, it } from 'vitest';
import { BatchError } from '../src/batch.js';
import type { CompiledQuery } from '../src/compile.js';
import { integer, text } from '../src/column-factories.js';
import { databaseWith } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import {
	type ExecuteBatchOptions,
	NoRowError,
	RowCountError,
} from '../src/executor.js';
import { insertInto } from '../src/insert-query-builder.js';
import { selectFrom } from '../src/select-query-builder.js';
import { executorFrom, fakeExecutor } from './helpers/executor.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text(),
	},
});

/** A database answering each query with the rows `answer` gives, recording the batches it ran. */
function fake(
	answer: (query: CompiledQuery) => { rows: unknown[]; rowCount?: number },
) {
	const executor = executorFrom(async (query) => answer(query));
	const batches: { sql: string[]; options: ExecuteBatchOptions }[] = [];
	const db = databaseWith({
		...executor,
		batch: (queries, options = {}) => {
			batches.push({ sql: queries.map((q) => q.sql), options });
			return executor.batch(queries, options);
		},
	});
	return { db, batches };
}

const byId = (id: number) =>
	selectFrom(users).select(['users.email']).where('users.id', id);

describe('result shapes', () => {
	it('set the limit, run nothing, and run with execute', async () => {
		const { executor, ran } = fakeExecutor([{ email: 'a@x' }]);
		const db = databaseWith(executor);
		const query = db.selectFrom(users).select(['users.email']);
		const shapes = [query.all(), query.first(), query.one(), query.maybeOne()];
		expect(ran).toEqual([]);
		await Promise.all(shapes.map((shape) => shape.execute()));
		expect(shapes.map((shape) => shape.toSQL())).toEqual(ran);
		expect(ran.map((q) => q.sql.slice(q.sql.indexOf('from')))).toEqual([
			'from "users"',
			'from "users" limit $1',
			'from "users" limit $1',
			'from "users" limit $1',
		]);
		expect(ran.map((q) => q.params)).toEqual([[], [1], [2], [2]]);
		expect(query.toSQL()).toEqual(query.all().toSQL());
	});

	it('default to every row', async () => {
		const { executor } = fakeExecutor([{ email: 'a@x' }]);
		const db = databaseWith(executor);
		expect(
			await db.selectFrom(users).select(['users.email']).one().execute(),
		).toEqual({ email: 'a@x' });
		expect(
			await db.selectFrom(users).select(['users.email']).execute(),
		).toEqual([{ email: 'a@x' }]);
		await expect(byId(1).all().execute()).rejects.toThrow(
			/no database to run on/,
		);
	});

	it('default a write to its returning rows, or its row count', async () => {
		const { db } = fake(() => ({ rows: [{ id: 1 }], rowCount: 1 }));
		const insert = db.insertInto(users).values({ email: 'a@x' });
		expect(await insert.execute()).toEqual({ rowCount: 1 });
		expect(await insert.returning(['users.id']).execute()).toEqual([{ id: 1 }]);
	});

	it('reject when awaited, so a forgotten execute() fails loudly', async () => {
		const { db, batches } = fake(() => ({ rows: [] }));
		const insert = db.insertInto(users).values({ email: 'a@x' });
		const hint = /runs with execute\(\), not when awaited/;
		await expect(async () => await insert).rejects.toThrow(hint);
		await expect(
			async () => await insert.returning(['users.id']).one(),
		).rejects.toThrow(hint);
		await expect(
			async () => await db.selectFrom(users).select(['users.email']),
		).rejects.toThrow(TypeError);
		await expect(
			db.transaction(async (tx) => tx.deleteFrom(users).allRows()),
		).rejects.toThrow(hint);
		expect(batches).toEqual([]);
	});

	it('mark the results checked after the statement ran', () => {
		const insert = insertInto(users).values({ email: 'a@x' });
		const checked = [
			byId(1).all(),
			byId(1).first(),
			byId(1).one(),
			byId(1).maybeOne(),
			insert,
			insert.expectRows(1),
			insert.returning(['users.id']).all(),
			insert.returning(['users.id']).one(),
		].map((query) => query.toQuery()._quarry.checked);
		expect(checked).toEqual([
			false,
			false,
			true,
			true,
			false,
			true,
			false,
			true,
		]);
	});
});

describe('db.batch', () => {
	it('sends the queries together and reads each by its shape', async () => {
		const { db, batches } = fake((query) =>
			query.sql.startsWith('insert')
				? { rows: [], rowCount: 1 }
				: { rows: [{ email: `${String(query.params[0])}@x` }] },
		);
		const results = await db.batch([
			byId(1).one(),
			byId(2).all(),
			insertInto(users).values({ email: 'c@x' }),
		]);
		expect(results).toEqual([
			{ email: '1@x' },
			[{ email: '2@x' }],
			{ rowCount: 1 },
		]);
		expect(batches).toHaveLength(1);
		expect(batches[0]?.sql).toHaveLength(3);
		// called only where the batch runs all or nothing
		expect(batches[0]?.options).toEqual({ verify: expect.any(Function) });
	});

	it('sends nothing for no queries', async () => {
		const { db, batches } = fake(() => ({ rows: [] }));
		expect(await db.batch([])).toEqual([]);
		expect(await db.batch([], { transaction: true })).toEqual([]);
		expect(batches).toEqual([]);
	});

	it('outside a transaction, rejects with every outcome when any fails', async () => {
		const { db } = fake((query) => {
			if (query.params[0] === 2) throw new Error('boom');
			return { rows: query.params[0] === 3 ? [] : [{ email: 'a@x' }] };
		});
		const error = await db
			.batch([byId(1).one(), byId(2).one(), byId(3).one()])
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(BatchError);
		if (!(error instanceof BatchError)) return;
		expect(error.message).toBe(
			'2 of the 3 queries in the batch failed; the others ran',
		);
		expect(error.results[0]).toEqual({
			status: 'fulfilled',
			value: { email: 'a@x' },
		});
		expect(error.results[1]).toMatchObject({ status: 'rejected' });
		expect(error.results[2]).toMatchObject({ status: 'rejected' });
		expect(error.errors[0]).toEqual(new Error('boom'));
		expect(error.errors[1]).toBeInstanceOf(NoRowError);
	});

	it('in a transaction, checks the results before it commits only when a shape can fail', async () => {
		const { db, batches } = fake(() => ({ rows: [{ email: 'a@x' }] }));
		await db.batch([byId(1).all(), byId(2).first()], {
			transaction: true,
		});
		await db.batch([byId(1).all(), byId(2).one()], {
			transaction: { isolation: 'serializable' },
			timeout: 100,
		});
		await db.batch([byId(1).all()], { transaction: false });
		expect(batches.map((b) => b.options)).toEqual([
			{ transaction: {} },
			{
				transaction: { isolation: 'serializable' },
				timeout: 100,
				verify: expect.any(Function),
			},
			{},
		]);
	});

	it('in a transaction, rejects with the error that failed it', async () => {
		const { db } = fake((query) => ({
			rows: [],
			rowCount: query.sql.startsWith('insert') ? 0 : 1,
		}));
		await expect(
			db.batch([byId(1).all(), byId(2).one()], { transaction: true }),
		).rejects.toBeInstanceOf(NoRowError);
		await expect(
			db.batch(
				[
					byId(1).all(),
					insertInto(users).values({ email: 'a@x' }).expectRows(1),
				],
				{ transaction: true },
			),
		).rejects.toBeInstanceOf(RowCountError);
	});
});
