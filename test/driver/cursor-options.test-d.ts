import { describe, expectTypeOf, it } from 'vitest';
import type {
	Connection,
	CursorOptions,
	Pool,
	PoolClient,
	QueryOptions,
	Transaction,
} from '../../src/driver/index.js';

declare const conn: Connection;
declare const pool: Pool;
declare const client: PoolClient;
declare const tx: Transaction;

describe('cursor options', () => {
	it('take batchSize and a query’s options, but not keepRows', () => {
		expectTypeOf<CursorOptions>().toHaveProperty('batchSize');
		expectTypeOf<CursorOptions>().toHaveProperty('rowMode');
		expectTypeOf<CursorOptions>().not.toHaveProperty('keepRows');
		expectTypeOf<QueryOptions>().toHaveProperty('keepRows');
	});

	it('refuse keepRows on every cursor and stream', () => {
		conn.cursor('select 1', [], { batchSize: 10, rowMode: 'array' });
		tx.stream('select 1', [], { batchSize: 10 });
		// @ts-expect-error a cursor reads every row it fetches
		conn.cursor('select 1', [], { keepRows: 1 });
		// @ts-expect-error a cursor reads every row it fetches
		conn.stream('select 1', [], { keepRows: 1 });
		// @ts-expect-error a cursor reads every row it fetches
		pool.cursor('select 1', [], { keepRows: 1 });
		// @ts-expect-error a cursor reads every row it fetches
		pool.stream('select 1', [], { keepRows: 1 });
		// @ts-expect-error a cursor reads every row it fetches
		client.cursor('select 1', [], { keepRows: 1 });
		// @ts-expect-error a cursor reads every row it fetches
		client.stream('select 1', [], { keepRows: 1 });
		// @ts-expect-error a cursor reads every row it fetches
		tx.cursor('select 1', [], { keepRows: 1 });
		// @ts-expect-error a cursor reads every row it fetches
		tx.stream('select 1', [], { keepRows: 1 });
	});

	it('still take keepRows on a query', () => {
		void conn.query('select 1', [], { keepRows: 1 });
		void pool.query('select 1', [], { keepRows: 1 });
	});
});
