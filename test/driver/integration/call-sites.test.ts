import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BatchError } from '../../../src/batch.js';
import { integer } from '../../../src/column-factories.js';
import { database, type Database } from '../../../src/database.js';
import { defineTable } from '../../../src/define-table.js';
import { UniqueViolation } from '../../../src/driver/errors.js';
import { createPool, type PoolOptions } from '../../../src/driver/pool.js';
import { noPg, open, options, rejection, table } from './helpers.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const schema = table('call_sites');

const items = defineTable('items', { columns: { id: integer() } });

const pool = (overrides: PoolOptions = {}) =>
	createPool({
		...options(),
		params: { search_path: `${schema},public` },
		...overrides,
	});

/** An insert that fails: id 1 is taken. */
const duplicate = (db: Pick<Database, 'insertInto'>) =>
	db.insertInto(items).values({ id: 1 });

const lookup = (db: Pick<Database, 'selectFrom'>) =>
	db.selectFrom(items).where('items.id', 1).select(['items.id']).takeFirst();

/** The part of a stack quarry appended: the code that issued the query. */
const issued = (error: Error) => {
	const stack = error.stack ?? '';
	const at = stack.indexOf('--- query issued at ---');
	return at < 0 ? '' : stack.slice(at);
};

describe.skipIf(noPg)('call sites of failed queries', () => {
	beforeAll(async () => {
		await using p = pool();
		await p.simpleQuery(`
			create schema ${schema};
			create table ${schema}.items (id int primary key);
			insert into ${schema}.items values (1);
		`);
	});

	afterAll(async () => {
		await using p = pool();
		await p.query(`drop schema if exists ${schema} cascade`);
	});

	it('name the code awaiting the query, across its awaits', async () => {
		await using p = pool();
		const db = database(p);
		async function insertItem() {
			await sleep(1);
			await duplicate(db).execute();
		}
		async function createItem() {
			await sleep(1);
			await insertItem();
		}
		const error = await rejection(createItem(), UniqueViolation);
		const site = issued(error);
		expect(site).toContain('insertItem');
		// resumed after an await, so a stack captured when the query was
		// issued wouldn't have had it
		expect(site).toContain('createItem');
		expect(site).toContain('call-sites.test.ts');
		expect(error.stack?.match(/--- query issued at ---/g)).toHaveLength(1);
	});

	it('name the code awaiting Promise.all', async () => {
		await using p = pool();
		const db = database(p);
		async function loadAll() {
			await Promise.all([lookup(db).execute(), duplicate(db).execute()]);
		}
		expect(issued(await rejection(loadAll(), UniqueViolation))).toContain(
			'loadAll',
		);
	});

	it('name the code inside a transaction, and on a connection of its own', async () => {
		await using p = pool();
		const db = database(p);
		const inTransaction = await rejection(
			db.transaction(async function writeInTransaction(tx) {
				await duplicate(tx).execute();
			}),
			UniqueViolation,
		);
		expect(issued(inTransaction)).toContain('writeInTransaction');
		await using conn = await open({
			params: { search_path: `${schema},public` },
		});
		const single = database(conn);
		async function writeOnConnection() {
			await duplicate(single).execute();
		}
		expect(
			issued(await rejection(writeOnConnection(), UniqueViolation)),
		).toContain('writeOnConnection');
	});

	it('name the code awaiting a batch, outside, with and inside a transaction', async () => {
		await using p = pool();
		const db = database(p);
		async function independent() {
			await db.batch([lookup(db), duplicate(db)]);
		}
		const batch = await rejection(independent(), BatchError);
		const [failure]: unknown[] = batch.errors;
		if (!(failure instanceof UniqueViolation)) throw new Error('No violation');
		expect(issued(failure)).toContain('independent');

		async function allOrNothing() {
			await db.batch([lookup(db), duplicate(db)], { transaction: true });
		}
		expect(issued(await rejection(allOrNothing(), UniqueViolation))).toContain(
			'allOrNothing',
		);

		const inside = await rejection(
			db.transaction(async function batchInTransaction(tx) {
				await tx.batch([lookup(tx), duplicate(tx)]);
			}),
			UniqueViolation,
		);
		expect(issued(inside)).toContain('batchInTransaction');
	});

	it('name the code awaiting a query issued earlier, when it fails', async () => {
		await using p = pool();
		const db = database(p);
		const query = duplicate(db).execute();
		query.catch(() => {});
		// nothing awaits the query when it fails: its stack has quarry's frames
		await sleep(50);
		const early = await rejection(query, UniqueViolation);
		expect(issued(early)).toContain('Query.execute');
		const awaiting = rejection(duplicate(db).execute(), UniqueViolation);
		await sleep(50);
		// `rejection` awaited it from the start
		expect(issued(await awaiting)).toContain('rejection');
	});

	it('are left out with callsites: false', async () => {
		await using p = pool();
		const db = database(p, { callsites: false });
		const error = await rejection(duplicate(db).execute(), UniqueViolation);
		expect(error.stack).not.toContain('query issued at');
		const batch = await rejection(
			db.batch([duplicate(db)], { transaction: true }),
			UniqueViolation,
		);
		expect(batch.stack).not.toContain('query issued at');
	});
});
