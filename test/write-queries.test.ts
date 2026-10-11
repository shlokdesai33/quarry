import { describe, expect, it } from 'vitest';
import { integer, jsonb, text, timestamptz } from '../src/column-factories.js';
import { compile } from '../src/compile.js';
import { database } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import { deleteFrom } from '../src/delete-query-builder.js';
import { insertInto } from '../src/insert-query-builder.js';
import type { OperationNode } from '../src/node.js';
import { update, updateMany } from '../src/update-query-builder.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text(),
		name: text().nullable(),
		createdAt: timestamptz().name('created_at').default(),
		settings: jsonb<{ theme: string }>().default(),
	},
});

const value = (v: unknown) => ({ kind: 'value', value: v });
const excluded = (column: string) => ({
	kind: 'reference',
	table: 'excluded',
	column,
});
const sql = (node: OperationNode | undefined) =>
	node === undefined ? undefined : compile(node).sql;

describe('insertInto', () => {
	it('records one row by database column name, encoding values', () => {
		const node = insertInto(users)
			.values({
				email: 'ada@example.com',
				name: null,
				settings: { theme: 'dark' },
			})
			.toNode();
		expect(node).toEqual({
			kind: 'insert',
			table: { name: 'users', alias: undefined },
			values: {
				columns: ['email', 'name', 'settings'],
				rows: [
					[value('ada@example.com'), value(null), value('{"theme":"dark"}')],
				],
				strategy: 'values',
			},
			onConflict: undefined,
			returning: [],
			expectRows: undefined,
			tag: undefined,
		});
	});

	it('records several rows for `unnest`, a missing column as its default', () => {
		const at = new Date('2024-01-01T00:00:00.000Z');
		const { values } = insertInto(users)
			.values([
				{ email: 'ada@example.com', name: 'Ada' },
				{ email: 'alan@example.com', name: null, createdAt: at },
			])
			.toNode();
		expect(values).toEqual({
			columns: ['email', 'name', 'created_at'],
			rows: [
				[value('ada@example.com'), value('Ada'), undefined],
				[value('alan@example.com'), value(null), value(at)],
			],
			strategy: 'unnest',
		});
	});

	it('records the returning list, expected rows and tag', () => {
		const node = insertInto(users)
			.values({ email: 'ada@example.com', name: null })
			.returning(['users.id', 'users.createdAt'])
			.expectRows(1)
			.tag('users.create')
			.toNode();
		expect(node.returning).toEqual([
			{
				expression: { kind: 'reference', table: 'users', column: 'id' },
				alias: 'id',
			},
			{
				expression: { kind: 'reference', table: 'users', column: 'created_at' },
				alias: 'createdAt',
			},
		]);
		expect(node.expectRows).toBe(1);
		expect(node.tag).toBe('users.create');
	});

	it('rejects an unknown column', () => {
		const query = insertInto(users);
		const values = Reflect.get(query, 'values');
		const untyped = { email: 'a', name: null, nope: 1 };
		expect(() => Reflect.apply(values, query, [untyped])).toThrow(
			'Unknown column "nope" in table "users"',
		);
	});
});

describe('onConflict', () => {
	const query = insertInto(users).values({
		email: 'ada@example.com',
		name: null,
	});

	it('records `do nothing` and the target’s predicate', () => {
		const { onConflict } = query
			.onConflict('email')
			.where((eb) => eb.ref('users.name').isNotNull())
			.doNothing()
			.toNode();
		expect(onConflict?.target).toEqual(['email']);
		expect(sql(onConflict?.where)).toBe('"users"."name" is not null');
		expect(onConflict?.action).toEqual({ kind: 'nothing' });
	});

	it('records `merge` by database column name, or of every column', () => {
		expect(
			query.onConflict('email').merge(['createdAt']).toNode().onConflict
				?.action,
		).toEqual({ kind: 'merge', columns: ['created_at'], where: undefined });
		expect(
			query.onConflict('email').merge().toNode().onConflict?.action,
		).toEqual({ kind: 'merge', columns: undefined, where: undefined });
	});

	it('records `do update` from `excluded`, with its condition', () => {
		const action = query
			.onConflict('email')
			.doUpdate((ex) => ({ name: ex.name, createdAt: ex.createdAt }), {
				where: (eb, ex) => eb.ref('users.name').isDistinctFrom(ex.name),
			})
			.toNode().onConflict?.action;
		expect(action).toMatchObject({
			kind: 'update',
			set: [
				{ column: 'name', value: excluded('name') },
				{ column: 'created_at', value: excluded('created_at') },
			],
		});
		expect(action?.kind === 'update' ? sql(action.where) : undefined).toBe(
			'"users"."name" is distinct from "excluded"."name"',
		);
	});
});

describe('update', () => {
	it('records `set`, a column set again keeping its place', () => {
		const node = update(users)
			.set({ name: 'Ada', email: 'ada@example.com' })
			.set({ name: 'Ada Lovelace' })
			.where('users.id', 1)
			.toNode();
		expect(node.set).toEqual([
			{ column: 'name', value: value('Ada Lovelace') },
			{ column: 'email', value: value('ada@example.com') },
		]);
		expect(sql(node.where)).toBe('"users"."id" = $1');
		expect(node.allRows).toBe(false);
	});

	it('records expressions as they are', () => {
		const node = update(users)
			.set((eb) => ({ name: eb.fn.lower('users.email') }))
			.allRows()
			.toNode();
		expect(node.set[0]?.value).toEqual({
			kind: 'function',
			name: 'lower',
			args: [{ kind: 'reference', table: 'users', column: 'email' }],
		});
		expect(node.where).toBeUndefined();
		expect(node.allRows).toBe(true);
	});

	it('records an optimistic lock', () => {
		const node = update(users)
			.set({ name: 'Ada' })
			.where('users.id', 1)
			.where('users.email', 'ada@example.com')
			.expectRows(1)
			.toNode();
		expect(sql(node.where)).toBe(
			'("users"."id" = $1 and "users"."email" = $2)',
		);
		expect(node.expectRows).toBe(1);
	});

	it('takes a whole number of expected rows', () => {
		expect(() => update(users).expectRows(1.5)).toThrow(RangeError);
		expect(() => update(users).expectRows(-1)).toThrow(RangeError);
	});

	it('leaves the builder it was called on unchanged', () => {
		const query = update(users).set({ name: 'Ada' });
		query.set({ name: 'Alan' }).where('users.id', 1);
		expect(query.toNode().set).toEqual([
			{ column: 'name', value: value('Ada') },
		]);
		expect(query.toNode().where).toBeUndefined();
	});
});

describe('updateMany', () => {
	it('records the rows and the `by` columns by database name', () => {
		const { many, set } = updateMany(
			users,
			[
				{ id: 1, name: 'Ada' },
				{ id: 2, createdAt: new Date(0) },
			],
			{ by: 'id' },
		).toNode();
		expect(set).toEqual([]);
		expect(many).toEqual({
			by: ['id'],
			columns: ['id', 'name', 'created_at'],
			rows: [
				[value(1), value('Ada'), undefined],
				[value(2), undefined, value(new Date(0))],
			],
			strategy: 'unnest',
		});
	});

	it('rejects a row without its `by` columns', () => {
		const untyped = [users, [{ name: 'Ada' }], { by: 'id' }];
		expect(() => Reflect.apply(updateMany, undefined, untyped)).toThrow(
			'missing "id"',
		);
	});
});

describe('deleteFrom', () => {
	it('records its `where`, returning list and expected rows', () => {
		const node = deleteFrom(users)
			.where('users.email', 'ada@example.com')
			.returning(['users.id'])
			.expectRows(1)
			.toNode();
		expect(node).toMatchObject({
			kind: 'delete',
			table: { name: 'users', alias: undefined },
			allRows: false,
			expectRows: 1,
			tag: undefined,
		});
		expect(sql(node.where)).toBe('"users"."email" = $1');
		expect(node.returning).toHaveLength(1);
	});

	it('records `allRows`', () => {
		expect(deleteFrom(users).allRows().toNode()).toMatchObject({
			where: undefined,
			allRows: true,
		});
	});
});

describe('running a write query', () => {
	const db = database({ execute: async () => ({ rows: [] }) });

	it('is not implemented yet', async () => {
		await expect(
			db.insertInto(users).values({ email: 'a', name: null }).execute(),
		).rejects.toThrow("Running insert queries isn't implemented yet");
		await expect(
			db.update(users).set({ name: 'Ada' }).where('users.id', 1).execute(),
		).rejects.toThrow("Running update queries isn't implemented yet");
		await expect(
			db.deleteFrom(users).where('users.id', 1).returning(['users.id']).all(),
		).rejects.toThrow("Running delete queries isn't implemented yet");
	});
});
