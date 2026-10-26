import { describe, expect, it } from 'vitest';
import {
	array,
	integer,
	jsonb,
	text,
	timestamptz,
} from '../src/column-factories.js';
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
import { expressionBuilder } from '../src/expression-builder.js';
import { insertInto } from '../src/insert-query-builder.js';
import type { OperationNode } from '../src/node.js';
import { sql as rawSql } from '../src/sql.js';
import { update } from '../src/update-query-builder.js';

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

	it('aligns rows whose keys come in other orders, or are left undefined', () => {
		const at = new Date('2024-01-01T00:00:00.000Z');
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the undefined a plain JS caller can pass
		const missing = undefined as never;
		const { values } = insertInto(users)
			.values([
				{ name: 'Ada', email: 'ada@example.com', createdAt: missing },
				{ createdAt: at, email: 'alan@example.com', name: missing },
				{ email: 'grace@example.com', name: missing, createdAt: at },
			])
			.toNode();
		expect(values?.columns).toEqual(['name', 'email', 'created_at']);
		expect(values?.rows).toStrictEqual([
			[value('Ada', codecs.text), value('ada@example.com', codecs.text), undefined],
			[
				undefined,
				value('alan@example.com', codecs.text),
				value(at, codecs.timestamptz),
			],
			[
				undefined,
				value('grace@example.com', codecs.text),
				value(at, codecs.timestamptz),
			],
		]);
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

const target = (column: string) => ({
	kind: 'reference',
	table: 'users',
	column,
});
const row = (column: string) => ({ kind: 'reference', table: 'row', column });

describe('update().setEach', () => {
	it('records the rows, key columns first, and matches them by key', () => {
		const node = update(users)
			.setEach(
				[
					{ name: 'Ada', id: 1 },
					{ id: 2, name: null },
				],
				{ key: 'id' },
			)
			.toNode();
		expect(node.from).toEqual({
			alias: 'row',
			rows: {
				columns: ['id', 'name'],
				types: ['integer', 'text'],
				codecs: [codecs.int4, codecs.text],
				rows: [
					[value(1, codecs.int4), value('Ada', codecs.text)],
					[value(2, codecs.int4), value(null, codecs.text)],
				],
				strategy: 'unnest',
			},
		});
		expect(node.set).toEqual([{ column: 'name', value: row('name') }]);
		expect(node.where).toEqual({
			kind: 'binary',
			left: target('id'),
			operator: '=',
			right: row('id'),
		});
		expect(node.allRows).toBe(false);
	});

	it('keeps a column a row leaves out, with a flag per such column', () => {
		const { from, set } = update(users)
			.setEach(
				[
					{ id: 1, name: 'Ada', email: 'ada@example.com' },
					{ id: 2, createdAt: new Date(0), email: 'alan@example.com' },
				],
				{ key: 'id' },
			)
			.toNode();
		expect(from?.rows.columns).toEqual([
			'id',
			'name',
			'email',
			'created_at',
			'set:name',
			'set:created_at',
		]);
		expect(from?.rows.types).toEqual([
			'integer',
			'text',
			'text',
			'timestamptz',
			'boolean',
			'boolean',
		]);
		expect(from?.rows.rows).toEqual([
			[
				value(1, codecs.int4),
				value('Ada', codecs.text),
				value('ada@example.com', codecs.text),
				value(null, codecs.timestamptz),
				value(true, codecs.bool),
				value(false, codecs.bool),
			],
			[
				value(2, codecs.int4),
				value(null, codecs.text),
				value('alan@example.com', codecs.text),
				value(new Date(0), codecs.timestamptz),
				value(false, codecs.bool),
				value(true, codecs.bool),
			],
		]);
		expect(set.map(({ column }) => column)).toEqual([
			'name',
			'email',
			'created_at',
		]);
		expect(set[1]?.value).toEqual(row('email'));
		expect(set[0]?.value).toEqual({
			kind: 'case',
			branches: [{ when: row('set:name'), result: row('name') }],
			otherwise: target('name'),
		});
	});

	it('takes a later set over a row value, and a set before it under it', () => {
		const { set } = update(users)
			.set({ name: 'kept?', email: 'everyone@example.com' })
			.setEach([{ id: 1, name: 'Ada' }], { key: 'id' })
			.set((eb) => ({ name: eb.fn.lower('row.name') }))
			.toNode();
		expect(set).toEqual([
			{
				column: 'name',
				value: { kind: 'function', name: 'lower', args: [row('name')] },
			},
			{ column: 'email', value: value('everyone@example.com', codecs.text) },
		]);
	});

	it('rejects what the types can’t rule out', () => {
		const query = update(users);
		const each = (rows: unknown, options: unknown) => () =>
			Reflect.apply(query.setEach.bind(query), undefined, [rows, options]);
		expect(each([{ name: 'Ada' }], { key: 'id' })).toThrow('missing "id"');
		expect(each([{ id: null, name: 'Ada' }], { key: 'id' })).toThrow(
			'missing "id"',
		);
		expect(each([], { key: 'id' })).toThrow('at least one row');
		expect(
			each(
				[
					{ id: 1, name: 'Ada' },
					{ id: 1, name: 'Alan' },
				],
				{ key: 'id' },
			),
		).toThrow('Rows 0 and 1 of setEach have the same key (id)');
		expect(each([{ id: 1, name: 'Ada' }], { key: 'id', as: 'users' })).toThrow(
			'pass another `as`',
		);
		expect(each([{ id: 1 }], { key: 'nope' })).toThrow('Unknown column "nope"');
		const once = update(users).setEach([{ id: 1, name: 'A' }], { key: 'id' });
		expect(() => once.setEach([{ id: 2, name: 'B' }], { key: 'id' })).toThrow(
			'one setEach',
		);
	});

	it('leaves the builder it was called on unchanged', () => {
		const query = update(users).set({ name: 'Ada' });
		query.setEach([{ id: 1, email: 'a' }], { key: 'id' });
		expect(query.toNode()).toMatchObject({ from: undefined, where: undefined });
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

	it('renders updates and deletes', () => {
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

describe('compiling setEach', () => {
	const docs = defineTable('docs', {
		columns: {
			tenantId: integer().name('tenant_id'),
			slug: text(),
			body: text().nullable(),
			tags: array(text()).default(),
			version: integer(),
		},
	});

	it('updates from unnest, one array per column, matched by key', () => {
		const query = compile(
			update(users)
				.setEach(
					[
						{ id: 1, name: 'A' },
						{ id: 2, name: 'B' },
					],
					{ key: 'id' },
				)
				.toNode(),
		);
		expect(plain(query)).toEqual({
			sql: 'update "users" set "name" = "row"."name" from unnest($1::integer[], $2::text[]) as "row"("id", "name") where "users"."id" = "row"."id"',
			params: [
				[1, 2],
				['A', 'B'],
			],
		});
		expect(codecNames(query).params).toEqual(['int4[]', 'text[]']);
	});

	it('sets a column some rows leave out only in the rows that have it', () => {
		const query = compile(
			update(users)
				.setEach(
					[
						{ id: 1, name: 'A' },
						{ id: 2, email: 'b@example.com' },
					],
					{ key: 'id' },
				)
				.toNode(),
		);
		expect(plain(query)).toEqual({
			sql: 'update "users" set "name" = case when "row"."set:name" then "row"."name" else "users"."name" end, "email" = case when "row"."set:email" then "row"."email" else "users"."email" end from unnest($1::integer[], $2::text[], $3::text[], $4::boolean[], $5::boolean[]) as "row"("id", "name", "email", "set:name", "set:email") where "users"."id" = "row"."id"',
			params: [
				[1, 2],
				['A', null],
				[null, 'b@example.com'],
				[true, false],
				[false, true],
			],
		});
		expect(codecNames(query).params).toEqual([
			'int4[]',
			'text[]',
			'text[]',
			'bool[]',
			'bool[]',
		]);
	});

	it('matches a composite key, under another name, with more conditions, sets and returning', () => {
		const query = compile(
			update(docs)
				.setEach(
					[
						{ tenantId: 1, slug: 'a', body: 'x', version: 2 },
						{ tenantId: 1, slug: 'b', body: null, version: 5 },
					],
					{ key: ['tenantId', 'slug'], as: 'v' },
				)
				.set((eb) => ({
					version: eb.fn.coalesce('v.version', 'docs.version'),
				}))
				.where((eb) => eb.ref('docs.version').lt(eb.ref('v.version')))
				.returning(['docs.slug', 'v.body'])
				.toNode(),
		);
		expect(plain(query)).toEqual({
			sql: 'update "docs" set "body" = "v"."body", "version" = coalesce("v"."version", "docs"."version") from unnest($1::integer[], $2::text[], $3::text[], $4::integer[]) as "v"("tenant_id", "slug", "body", "version") where ("docs"."tenant_id" = "v"."tenant_id" and "docs"."slug" = "v"."slug" and "docs"."version" < "v"."version") returning "docs"."slug" as "slug", "v"."body" as "body"',
			params: [
				[1, 1],
				['a', 'b'],
				['x', null],
				[2, 5],
			],
		});
		expect(codecNames(query).results).toEqual(['text', 'text']);
	});

	it('takes returningAll, arithmetic, case and sql over the rows', () => {
		const query = update(docs)
			.setEach(
				[
					{ tenantId: 1, slug: 'a', version: 2 },
					{ tenantId: 1, slug: 'b', version: 5 },
				],
				{ key: ['tenantId', 'slug'] },
			)
			.set((eb) => ({
				version: eb
					.case()
					.when(eb.ref('row.version').gt(3), eb.ref('docs.version').plus(1))
					.else(eb.fn.coalesce('row.version', eb.val(0)))
					.end(),
				body: rawSql<string>`upper(${eb.ref('row.slug')})`,
			}))
			.returningAll();
		expect(query.toSQL().sql).toBe(
			'update "docs" set "version" = case when "row"."version" > $1 then "docs"."version" + $2 else coalesce("row"."version", $3) end, "body" = upper("row"."slug") from unnest($4::integer[], $5::text[], $6::integer[]) as "row"("tenant_id", "slug", "version") where ("docs"."tenant_id" = "row"."tenant_id" and "docs"."slug" = "row"."slug") returning "docs"."tenant_id" as "tenantId", "docs"."slug" as "slug", "docs"."body" as "body", "docs"."tags" as "tags", "docs"."version" as "version"',
		);
	});

	it('refuses what unnest can’t send: expressions and array columns', () => {
		const expression = update(users).setEach(
			// @ts-expect-error rows hold plain values
			[{ id: 1, name: expressionBuilder(users).fn.lower('users.email') }],
			{ key: 'id' },
		);
		expect(() => expression.toSQL()).toThrow(/plain value/);
		const arrays = update(docs).setEach(
			[{ tenantId: 1, slug: 'a', tags: ['x'] }],
			{ key: ['tenantId', 'slug'] },
		);
		expect(() => arrays.toSQL()).toThrow(/array columns/);
	});

	it('needs a column to set besides the key', () => {
		const keysOnly = update(users).setEach([{ id: 1 }], { key: 'id' });
		expect(() => keysOnly.toSQL()).toThrow('An update needs columns to set');
		expect(keysOnly.set({ name: 'Ada' }).toSQL().sql).toBe(
			'update "users" set "name" = $1 from unnest($2::integer[]) as "row"("id") where "users"."id" = "row"."id"',
		);
	});

	it('runs with the take and expect shapes, and in a batch', async () => {
		const { executor, ran } = fakeExecutor([{ id: 1 }, { id: 2 }]);
		const db = databaseWith(executor);
		const rows = [
			{ id: 1, name: 'A' },
			{ id: 2, name: 'B' },
		];
		const query = db.update(users).setEach(rows, { key: 'id' });
		expect(await query.execute()).toEqual({ rowCount: 2 });
		expect(await query.expectRows(rows.length).execute()).toEqual({
			rowCount: 2,
		});
		await expect(query.expectRows(3).execute()).rejects.toBeInstanceOf(
			RowCountError,
		);
		expect(
			await query.returning(['users.id']).expectNonEmpty().execute(),
		).toEqual([{ id: 1 }, { id: 2 }]);
		const [count, first] = await db.batch([
			query,
			query.returning(['row.name']).takeFirst(),
		]);
		expect(count).toEqual({ rowCount: 2 });
		expect(first).toEqual({ id: 1 });
		expect(new Set(ran.map((q) => q.sql.split(' from ')[1]))).toEqual(
			new Set([
				'unnest($1::integer[], $2::text[]) as "row"("id", "name") where "users"."id" = "row"."id"',
				'unnest($1::integer[], $2::text[]) as "row"("id", "name") where "users"."id" = "row"."id" returning "users"."id" as "id"',
				'unnest($1::integer[], $2::text[]) as "row"("id", "name") where "users"."id" = "row"."id" returning "row"."name" as "name"',
			]),
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
