import { describe, expect, it } from 'vitest';
import { integer, jsonb, text, timestamptz } from '../src/column-factories.js';
import { compile } from '../src/compile.js';
import { arrayOf, declareParamType } from '../src/driver/codec.js';
import { codecs } from '../src/driver/codecs.js';
import { codecNames, plain } from './helpers/compiled.js';
import { databaseWith } from '../src/database.js';
import {
	NoRowError,
	RowCountError,
	TooManyRowsError,
} from '../src/executor.js';
import { executorFrom, fakeExecutor } from './helpers/executor.js';
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

const events = defineTable('events', {
	columns: {
		id: integer().identity(),
		at: timestamptz().default(),
	},
});

const value = (v: unknown, codec?: unknown) => ({
	kind: 'value',
	value: v,
	codec,
});
const excluded = (column: string) => ({
	kind: 'reference',
	table: 'excluded',
	column,
});
const sql = (node: OperationNode | undefined) =>
	node === undefined ? undefined : compile(node).sql;

describe('insertInto', () => {
	it('records one row by database column name, each value with its column’s codec', () => {
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
				types: ['text', 'text', 'jsonb'],
				codecs: [codecs.text, codecs.text, codecs.jsonb],
				rows: [
					[
						value('ada@example.com', codecs.text),
						value(null, codecs.text),
						value({ theme: 'dark' }, codecs.jsonb),
					],
				],
				strategy: 'values',
			},
			onConflict: undefined,
			returning: [],
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
			types: ['text', 'text', 'timestamptz'],
			codecs: [codecs.text, codecs.text, codecs.timestamptz],
			rows: [
				[
					value('ada@example.com', codecs.text),
					value('Ada', codecs.text),
					undefined,
				],
				[
					value('alan@example.com', codecs.text),
					value(null, codecs.text),
					value(at, codecs.timestamptz),
				],
			],
			strategy: 'unnest',
		});
	});

	it('records the returning list and tag', () => {
		const node = insertInto(users)
			.values({ email: 'ada@example.com', name: null })
			.returning(['users.id', 'users.createdAt'])
			.tag('users.create')
			.toNode();
		expect(node.returning).toEqual([
			{
				expression: { kind: 'reference', table: 'users', column: 'id' },
				alias: 'id',
				codec: codecs.int4,
			},
			{
				expression: { kind: 'reference', table: 'users', column: 'created_at' },
				alias: 'createdAt',
				codec: codecs.timestamptz,
			},
		]);
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
			{ column: 'name', value: value('Ada Lovelace', codecs.text) },
			{ column: 'email', value: value('ada@example.com', codecs.text) },
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
		const query = update(users)
			.set({ name: 'Ada' })
			.where('users.id', 1)
			.where('users.email', 'ada@example.com');
		expect(sql(query.toNode().where)).toBe(
			'("users"."id" = $1 and "users"."email" = $2)',
		);
		expect(query.expectRows(1).toSQL()).toEqual(query.toSQL());
	});

	it('takes a whole number of expected rows', () => {
		const query = update(users).set({ name: 'Ada' }).allRows();
		expect(() => query.expectRows(1.5)).toThrow(RangeError);
		expect(() => query.expectRows(-1)).toThrow(RangeError);
	});

	it('leaves the builder it was called on unchanged', () => {
		const query = update(users).set({ name: 'Ada' });
		query.set({ name: 'Alan' }).where('users.id', 1);
		expect(query.toNode().set).toEqual([
			{ column: 'name', value: value('Ada', codecs.text) },
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
			types: ['integer', 'text', 'timestamptz'],
			codecs: [codecs.int4, codecs.text, codecs.timestamptz],
			rows: [
				[value(1, codecs.int4), value('Ada', codecs.text), undefined],
				[
					value(2, codecs.int4),
					undefined,
					value(new Date(0), codecs.timestamptz),
				],
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
	it('records its `where` and returning list', () => {
		const node = deleteFrom(users)
			.where('users.email', 'ada@example.com')
			.returning(['users.id'])
			.toNode();
		expect(node).toMatchObject({
			kind: 'delete',
			table: { name: 'users', alias: undefined },
			allRows: false,
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

describe('compiling write queries', () => {
	it('renders an insert with values, defaults, on conflict and returning', () => {
		const query = compile(
			insertInto(users)
				.values({ email: 'ada@example.com', name: null })
				.onConflict('email')
				.merge(['name'])
				.returning(['users.id'])
				.tag('users.upsert')
				.toNode(),
		);
		expect(plain(query)).toEqual({
			sql: 'insert into "users" ("email", "name") values ($1, $2) on conflict ("email") do update set "name" = excluded."name" returning "users"."id" as "id"',
			params: ['ada@example.com', null],
			tag: 'users.upsert',
		});
		expect(codecNames(query)).toEqual({
			params: ['text', 'text'],
			results: ['int4'],
		});
		expect(compile(insertInto(events).values({}).toNode()).sql).toBe(
			'insert into "events" default values',
		);
		expect(
			compile(
				insertInto(users)
					.values({ email: 'a', name: null })
					.onConflict('email')
					.doNothing()
					.toNode(),
			).sql,
		).toBe(
			'insert into "users" ("email", "name") values ($1, $2) on conflict ("email") do nothing',
		);
	});

	it('sends many rows as one array per column with unnest, or falls back to values', () => {
		const many = compile(
			insertInto(users)
				.values([
					{ email: 'a', name: 'A' },
					{ email: 'b', name: null },
				])
				.toNode(),
		);
		expect(plain(many)).toEqual({
			sql: 'insert into "users" ("email", "name") select * from unnest($1::text[], $2::text[])',
			params: [
				['a', 'b'],
				['A', null],
			],
		});
		// one array per column, of the column's codec, its type declared: the cast pins it
		expect(many.paramCodecs).toEqual([
			declareParamType(arrayOf(codecs.text)),
			declareParamType(arrayOf(codecs.text)),
		]);
		expect(many.paramCodecs?.[0]).toMatchObject({
			oid: 1009,
			inferParamType: false,
			paramFormat: 'binary',
		});
		// a row that leaves a column to its default can't go through unnest
		const ragged = compile(
			insertInto(users)
				.values([
					{ email: 'a', name: 'A' },
					{ email: 'b', name: 'B', settings: { theme: 'x' } },
				])
				.toNode(),
		);
		expect(ragged.sql).toBe(
			'insert into "users" ("email", "name", "settings") values ($1, $2, default), ($3, $4, $5)',
		);
	});

	it('renders updates, updateMany and deletes', () => {
		expect(
			plain(
				compile(
					update(users)
						.set({ name: 'Ada' })
						.where('users.id', 1)
						.returning(['users.name'])
						.toNode(),
				),
			),
		).toEqual({
			sql: 'update "users" set "name" = $1 where "users"."id" = $2 returning "users"."name" as "name"',
			params: ['Ada', 1],
		});
		expect(
			compile(update(users).set({ name: null }).allRows().toNode()).sql,
		).toBe('update "users" set "name" = $1');
		const many = compile(
			updateMany(
				users,
				[
					{ id: 1, name: 'A' },
					{ id: 2, name: 'B' },
				],
				{ by: 'id' },
			).toNode(),
		);
		expect(plain(many)).toEqual({
			sql: 'update "users" set "name" = "quarry_rows"."name" from unnest($1::integer[], $2::text[]) as "quarry_rows"("id", "name") where "users"."id" = "quarry_rows"."id"',
			params: [
				[1, 2],
				['A', 'B'],
			],
		});
		expect(codecNames(many).params).toEqual(['int4[]', 'text[]']);
		expect(() =>
			compile(
				updateMany(users, [{ id: 1, name: 'A' }, { id: 2 }], {
					by: 'id',
				}).toNode(),
			),
		).toThrow(/every row to set the same columns/);
		expect(
			compile(
				deleteFrom(users)
					.where('users.id', 3)
					.returning(['users.email'])
					.toNode(),
			).sql,
		).toBe(
			'delete from "users" where "users"."id" = $1 returning "users"."email" as "email"',
		);
		expect(compile(deleteFrom(users).allRows().toNode()).sql).toBe(
			'delete from "users"',
		);
	});
});

describe('running a write query', () => {
	it('resolves to the row count and the returning rows', async () => {
		const { executor, ran } = fakeExecutor([{ id: 7 }]);
		const db = databaseWith(executor);
		expect(await db.deleteFrom(users).where('users.id', 7).execute()).toEqual({
			rowCount: 1,
		});
		expect(
			await db
				.insertInto(users)
				.values({ email: 'a', name: null })
				.returning(['users.id'])
				.expectOne()
				.execute(),
		).toEqual({ id: 7 });
		expect(
			await db
				.update(users)
				.set({ name: 'A' })
				.allRows()
				.returning(['users.id'])
				.takeFirst()
				.execute(),
		).toEqual({ id: 7 });
		expect(ran.map((q) => q.sql.split(' ')[0])).toEqual([
			'delete',
			'insert',
			'update',
		]);
	});

	it('enforces expectRows and one-row results after the statement ran', async () => {
		const none = databaseWith(
			executorFrom(async () => ({ rows: [], rowCount: 0 })),
		);
		const error = await none
			.update(users)
			.set({ name: 'A' })
			.where('users.id', 1)
			.expectRows(1)
			.execute()
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RowCountError);
		expect(error).toMatchObject({
			expected: 1,
			actual: 0,
			table: 'users',
			message: 'The query on "users" affected 0 rows, where 1 was expected',
		});
		expect(JSON.stringify(error)).not.toContain('"A"');
		const noRow = none
			.deleteFrom(users)
			.where('users.id', 1)
			.returning(['users.id'])
			.expectOne()
			.execute();
		await expect(noRow).rejects.toBeInstanceOf(NoRowError);
		await expect(noRow).rejects.toMatchObject({ table: 'users' });
		const two = databaseWith(fakeExecutor([{ id: 1 }, { id: 2 }]).executor);
		const several = two
			.deleteFrom(users)
			.allRows()
			.returning(['users.id'])
			.expectAtMostOne()
			.execute();
		await expect(several).rejects.toBeInstanceOf(TooManyRowsError);
		await expect(several).rejects.toMatchObject({ table: 'users', count: 2 });
	});

	it('expects one or more rows written, with or without returning', async () => {
		const none = databaseWith(
			executorFrom(async () => ({ rows: [], rowCount: 0 })),
		);
		const some = databaseWith(
			executorFrom(async () => ({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })),
		);
		const remove = (db: typeof none) =>
			db.deleteFrom(users).where('users.id', 1);
		expect(await remove(some).expectNonEmpty().execute()).toEqual({
			rowCount: 2,
		});
		expect(
			await remove(some).returning(['users.id']).expectNonEmpty().execute(),
		).toEqual([{ id: 1 }, { id: 2 }]);
		await expect(remove(none).expectNonEmpty().execute()).rejects.toThrow(
			new NoRowError(remove(none).toSQL(), 'users', 'at least one', 'affected'),
		);
		await expect(remove(none).expectNonEmpty().execute()).rejects.toMatchObject(
			{
				message:
					'The query on "users" affected no row, where at least one was expected',
			},
		);
		await expect(
			remove(none).returning(['users.id']).expectNonEmpty().execute(),
		).rejects.toBeInstanceOf(NoRowError);
		await expect(
			remove(none)
				.expectNonEmpty(() => new Error('nothing deleted'))
				.execute(),
		).rejects.toThrow('nothing deleted');
	});

	it('reads the first returning row or value, never throwing for the count', async () => {
		const some = databaseWith(
			executorFrom(async () => ({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })),
		);
		const none = databaseWith(
			executorFrom(async () => ({ rows: [], rowCount: 0 })),
		);
		const returning = (db: typeof some) =>
			db.update(users).set({ name: 'A' }).allRows().returning(['users.id']);
		expect(await returning(some).takeFirst().execute()).toEqual({ id: 1 });
		expect(await returning(some).takeValue().execute()).toBe(1);
		expect(await returning(none).takeFirst().execute()).toBeUndefined();
		expect(await returning(none).takeValue().execute()).toBeUndefined();
		expect(await returning(some).expectFirst().execute()).toEqual({ id: 1 });
		expect(await returning(some).expectValue().execute()).toBe(1);
		await expect(
			returning(none).expectValue().execute(),
		).rejects.toBeInstanceOf(NoRowError);
		await expect(
			returning(some)
				.expectOne((error) => new Error(`got ${error.message}`))
				.execute(),
		).rejects.toThrow(
			'got The query on "users" returned 2 rows, where exactly one was expected',
		);
	});

	it('makes expectRows a shape, resolving as execute() does', async () => {
		const some = databaseWith(
			executorFrom(async () => ({ rows: [{ id: 1 }], rowCount: 1 })),
		);
		const remove = some.deleteFrom(users).where('users.id', 1);
		expect(await remove.expectRows(1).execute()).toEqual({ rowCount: 1 });
		expect(
			await remove.returning(['users.id']).expectRows(1).execute(),
		).toEqual([{ id: 1 }]);
		await expect(
			remove.expectRows(2, (error) => new Error(`${error.actual}`)).execute(),
		).rejects.toThrow('1');
	});

	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the undefined a plain JS caller, or an `as` cast, can pass
	const missing = undefined as never;

	it('leaves out columns whose value is undefined, never writing NULL for them', () => {
		expect(
			plain(
				compile(
					insertInto(users).values({ email: 'a', name: missing }).toNode(),
				),
			),
		).toEqual({
			sql: 'insert into "users" ("email") values ($1)',
			params: ['a'],
		});
		expect(
			plain(
				compile(
					insertInto(users)
						.values([
							{ email: 'a', name: null },
							{ email: 'b', name: missing },
						])
						.toNode(),
				),
			),
		).toEqual({
			sql: 'insert into "users" ("email", "name") values ($1, $2), ($3, default)',
			params: ['a', null, 'b'],
		});
		expect(
			plain(
				compile(
					update(users)
						.set({ name: missing, email: 'b' })
						.where('users.id', 1)
						.toNode(),
				),
			),
		).toEqual({
			sql: 'update "users" set "email" = $1 where "users"."id" = $2',
			params: ['b', 1],
		});
	});

	it('refuses a set() that leaves no columns to set', () => {
		const message =
			'The update of "users" sets no columns: an undefined value leaves its column out, and every value given was undefined (or none was given)';
		expect(() => update(users).set({ name: missing })).toThrow(message);
		expect(() => update(users).set({})).toThrow(message);
		expect(() =>
			insertInto(users)
				.values({ email: 'a', name: null })
				.onConflict('email')
				.doUpdate(() => ({ name: missing })),
		).toThrow(message);
		expect(
			compile(
				update(users)
					.set({ email: 'b' })
					.set({ name: missing })
					.where('users.id', 1)
					.toNode(),
			).sql,
		).toBe('update "users" set "email" = $1 where "users"."id" = $2');
	});

	it('needs a database', async () => {
		await expect(
			insertInto(users).values({ email: 'a', name: null }).execute(),
		).rejects.toThrow(/no database to run on/);
	});
});
