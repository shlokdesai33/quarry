/* oxlint-disable no-await-in-loop -- tests run their steps in order */
import { describe, expect, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { databaseWith } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import { RowStream } from '../src/driver/row-stream.js';
import type { Executor } from '../src/executor.js';
import { selectFrom } from '../src/select-query-builder.js';
import { fakeExecutor } from './helpers/executor.js';

const users = defineTable('users', {
	columns: { id: integer().identity(), email: text() },
});

/** Batches from `batches`, recording what was asked of them. */
function source<T>(batches: readonly (readonly T[])[], fail?: Error) {
	const log: string[] = [];
	const iterable: AsyncIterable<readonly T[]> = {
		[Symbol.asyncIterator]() {
			log.push('start');
			let i = 0;
			return {
				async next() {
					log.push(`next ${i}`);
					await Promise.resolve();
					if (i < batches.length)
						return { done: false, value: batches[i++] ?? [] };
					if (fail) throw fail;
					return { done: true, value: undefined };
				},
				async return() {
					log.push('return');
					return { done: true, value: undefined };
				},
			};
		},
	};
	return { iterable, log };
}

describe('RowStream', () => {
	it('yields each row, skipping empty batches, and reads a batch only when its rows are wanted', async () => {
		const { iterable, log } = source([[1, 2], [], [3]]);
		const rows = new RowStream(iterable);
		expect(log).toEqual([]);
		expect(await rows.next()).toEqual({ done: false, value: 1 });
		expect(log).toEqual(['start', 'next 0']);
		expect(await rows.next()).toEqual({ done: false, value: 2 });
		expect(log).toEqual(['start', 'next 0']);
		const rest: number[] = [];
		for await (const row of rows) rest.push(row);
		expect(rest).toEqual([3]);
		expect(log).toEqual(['start', 'next 0', 'next 1', 'next 2', 'next 3']);
		expect(await rows.next()).toEqual({ done: true, value: undefined });
	});

	it('answers concurrent next() calls in order', async () => {
		const { iterable } = source([[1], [2, 3], [4]]);
		const rows = new RowStream(iterable);
		const results = await Promise.all(
			Array.from({ length: 6 }, () => rows.next()),
		);
		expect(results.map((r) => (r.done ? 'done' : r.value))).toEqual([
			1,
			2,
			3,
			4,
			'done',
			'done',
		]);
	});

	it('closes the source on break, return() and disposal, and never starts one it did not need', async () => {
		const broken = source([[1, 2, 3]]);
		for await (const row of new RowStream(broken.iterable))
			if (row === 2) break;
		expect(broken.log).toEqual(['start', 'next 0', 'return']);

		const unused = source([[1]]);
		const rows = new RowStream(unused.iterable);
		expect(await rows.return()).toEqual({ done: true, value: undefined });
		expect(await rows.next()).toEqual({ done: true, value: undefined });
		expect(unused.log).toEqual([]);

		const disposed = source([[1, 2]]);
		{
			await using inner = new RowStream(disposed.iterable);
			await inner.next();
		}
		expect(disposed.log).toEqual(['start', 'next 0', 'return']);
	});

	it('rejects once with the source’s error, then ends', async () => {
		const boom = new Error('boom');
		const { iterable } = source([[1]], boom);
		const rows = new RowStream(iterable);
		expect(await rows.next()).toEqual({ done: false, value: 1 });
		await expect(rows.next()).rejects.toBe(boom);
		expect(await rows.next()).toEqual({ done: true, value: undefined });
	});
});

describe('stream()', () => {
	it('runs nothing until the first row is asked for, and yields the rows', async () => {
		const { executor, ran } = fakeExecutor([
			{ id: 1, email: 'a' },
			{ id: 2, email: 'b' },
		]);
		const db = databaseWith(executor);
		const query = db.selectFrom(users).select(['users.id', 'users.email']);
		const rows = query.stream();
		expect(ran).toHaveLength(0);
		const all: unknown[] = [];
		for await (const row of rows) all.push(row);
		expect(all).toEqual([
			{ id: 1, email: 'a' },
			{ id: 2, email: 'b' },
		]);
		expect(ran.map((q) => q.sql)).toEqual([query.toSQL().sql]);
	});

	it('passes its options to the executor, and checks batchSize at once', async () => {
		const seen: unknown[] = [];
		const { executor } = fakeExecutor();
		const db = databaseWith({
			...executor,
			async *stream(query, options) {
				seen.push(options);
				yield* executor.stream(query, options);
			},
		} satisfies Executor);
		const signal = new AbortController().signal;
		for await (const _ of db
			.selectFrom(users)
			.select(['users.id'])
			.stream({ batchSize: 50, signal, timeout: '1s' }));
		expect(seen).toEqual([{ batchSize: 50, signal, timeout: '1s' }]);
		for (const batchSize of [0, -1, 1.5, Number.NaN]) {
			expect(() =>
				db.selectFrom(users).select(['users.id']).stream({ batchSize }),
			).toThrow(RangeError);
		}
	});

	it('throws at once without a database to run on', () => {
		expect(() => selectFrom(users).select(['users.id']).stream()).toThrow(
			/no database/,
		);
	});
});
