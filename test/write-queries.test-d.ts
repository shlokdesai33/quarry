import { describe, expectTypeOf, it } from 'vitest';
import {
	integer,
	jsonb,
	text,
	timestamptz,
	tsvector,
} from '../src/column-factories.js';
import type { DataType } from '../src/data-type/data-type.js';
import { database } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import {
	type DeleteQueryBuilder,
	deleteFrom,
} from '../src/delete-query-builder.js';
import {
	type InsertQueryBuilder,
	insertInto,
} from '../src/insert-query-builder.js';
import type { Expr } from '../src/operators.js';
import {
	type UpdateQueryBuilder,
	update,
	updateMany,
} from '../src/update-query-builder.js';
import type { WriteResult } from '../src/write-query.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text(),
		name: text().nullable(),
		role: text<'admin' | 'member'>().default(),
		createdAt: timestamptz().name('created_at').default(),
		search: tsvector().generated(),
	},
});

const docs = defineTable('docs', {
	columns: {
		id: integer().identity(),
		tenantId: integer().name('tenant_id'),
		slug: text(),
		body: text(),
		version: integer(),
		settings: jsonb<{ theme: string }>().default(),
	},
});

const ada = { email: 'ada@example.com', name: 'Ada' };

describe('insertInto', () => {
	it('types the values by the columns’ insert types', () => {
		insertInto(users).values({ email: 'ada@example.com', name: null });
		insertInto(users).values({ ...ada, role: 'admin', createdAt: new Date() });

		// @ts-expect-error a required column is missing
		insertInto(users).values({ name: 'Ada' });
		// @ts-expect-error a nullable column without a default is still required
		insertInto(users).values({ email: 'ada@example.com' });
		// @ts-expect-error an identity is never written
		insertInto(users).values({ ...ada, id: 1 });
		// @ts-expect-error nor is a generated column
		insertInto(users).values({ ...ada, search: 'x' });
		// @ts-expect-error not one of the role's values
		insertInto(users).values({ ...ada, role: 'owner' });
		// @ts-expect-error wrong value type
		insertInto(users).values({ email: 1, name: null });
		// @ts-expect-error not a column
		insertInto(users).values({ ...ada, nickname: 'ada' });
	});

	it('takes several rows', () => {
		insertInto(users).values([ada, { email: 'alan@example.com', name: null }]);

		// @ts-expect-error each row is checked
		insertInto(users).values([ada, { name: 'Alan' }]);
	});

	it('only runs once it has values', () => {
		const empty = insertInto(users);
		// @ts-expect-error no values yet
		void empty.execute();

		expectTypeOf(empty.values(ada).execute()).toEqualTypeOf<
			Promise<WriteResult>
		>();
		expectTypeOf(empty.values(ada).execute()).toEqualTypeOf<
			Promise<{ readonly rowCount: number }>
		>();
	});

	it('returns rows only with `returning`, typed like a select list', () => {
		const query = insertInto(users).values(ada);
		// @ts-expect-error no `returning`, so no rows
		void query.one();

		const returning = query.returning(['users.id', 'users.role']);
		expectTypeOf(returning.one()).toEqualTypeOf<
			Promise<{ id: number; role: 'admin' | 'member' }>
		>();
		expectTypeOf(returning.all()).toEqualTypeOf<
			Promise<{ id: number; role: 'admin' | 'member' }[]>
		>();
		expectTypeOf(
			query.returning((eb) => [eb.fn.lower('users.email').as('lower')]).first(),
		).toEqualTypeOf<Promise<{ lower: string } | undefined>>();

		// @ts-expect-error not a column of the table
		query.returning(['docs.id']);
	});

	it('keeps its type through `expectRows`, `tag` and `when`', () => {
		const query = insertInto(users).values(ada);
		expectTypeOf(query.expectRows(1)).toEqualTypeOf<typeof query>();
		expectTypeOf(query.tag('users.create')).toEqualTypeOf<typeof query>();
		expectTypeOf(
			query.when(true, (qb) => qb.onConflict('email').doNothing()),
		).toEqualTypeOf<typeof query>();
	});

	it('does not count values given in `when`', () => {
		const query = insertInto(users).when(true, (qb) => qb.values(ada));
		// @ts-expect-error `when` may not have run
		void query.execute();
	});
});

describe('onConflict', () => {
	const query = insertInto(users).values(ada);

	it('names its target by column keys', () => {
		query.onConflict('email').doNothing();
		insertInto(docs)
			.values({ tenantId: 1, slug: 'a', body: '', version: 1 })
			.onConflict(['tenantId', 'slug'])
			.doNothing();

		// @ts-expect-error not a column
		query.onConflict('nickname');
		// @ts-expect-error a column key, not a reference
		query.onConflict('users.email');
		// @ts-expect-error at least one column
		query.onConflict([]);
	});

	it('returns to the insert, which can still run', () => {
		expectTypeOf(query.onConflict('email').doNothing()).toEqualTypeOf<
			InsertQueryBuilder<typeof users, undefined, never>
		>();
		expectTypeOf(query.onConflict('email').doNothing().execute()).toEqualTypeOf<
			Promise<WriteResult>
		>();
	});

	it('merges only columns an update can set', () => {
		query.onConflict('email').merge();
		query.onConflict('email').merge(['name', 'role']);

		// @ts-expect-error an identity is never written
		query.onConflict('email').merge(['id']);
		// @ts-expect-error not a column
		query.onConflict('email').merge(['nickname']);
	});

	it('types `excluded` by the table’s columns', () => {
		query.onConflict('email').doUpdate((excluded) => {
			expectTypeOf(excluded.name).toEqualTypeOf<
				Expr<string | null, DataType<'text'>>
			>();
			expectTypeOf(excluded.id).toEqualTypeOf<
				Expr<number, DataType<'integer'>>
			>();
			return { name: excluded.name, role: excluded.role };
		});

		// @ts-expect-error an integer is not set into a text column
		query.onConflict('email').doUpdate((excluded) => ({ name: excluded.id }));
		// @ts-expect-error an identity is never written
		query.onConflict('email').doUpdate((excluded) => ({ id: excluded.id }));
		// @ts-expect-error not a column
		query.onConflict('email').doUpdate((excluded) => ({ nope: excluded.name }));
	});

	it('takes a `where` on the target and on the update', () => {
		query.onConflict('email').where('users.role', 'admin').doNothing();
		query
			.onConflict('email')
			.where((eb) => eb.ref('users.name').isNotNull())
			.merge(['name'], {
				where: (eb, excluded) =>
					eb.ref('users.name').isDistinctFrom(excluded.name),
			});

		// @ts-expect-error not one of the role's values
		query.onConflict('email').where('users.role', 'owner');
		query
			.onConflict('email')
			// @ts-expect-error a condition is a boolean
			.merge(['name'], { where: (eb) => eb.ref('users.name') });
	});
});

describe('update', () => {
	it('only runs with `set` and a `where`', () => {
		const noWhere = update(users).set({ name: 'Ada' });
		// @ts-expect-error no `where`: it would update every row
		void noWhere.execute();

		const noSet = update(users).where('users.id', 1);
		// @ts-expect-error nothing to set
		void noSet.execute();

		expectTypeOf(
			update(users).set({ name: 'Ada' }).where('users.id', 1).execute(),
		).toEqualTypeOf<Promise<WriteResult>>();
		expectTypeOf(
			update(users).where('users.id', 1).set({ name: 'Ada' }).execute(),
		).toEqualTypeOf<Promise<WriteResult>>();
	});

	it('updates every row only when told to', () => {
		expectTypeOf(
			update(users).set({ role: 'member' }).allRows().execute(),
		).toEqualTypeOf<Promise<WriteResult>>();
	});

	it('does not count a `where` given in `when`', () => {
		const query = update(users)
			.set({ name: 'Ada' })
			.when(true, (qb) => qb.where('users.id', 1));
		// @ts-expect-error `when` may not have run
		void query.execute();
	});

	it('types `set` by the columns’ update types', () => {
		update(users).set({ name: null, role: 'admin' });
		update(users).set((eb) => ({ name: eb.fn.lower('users.email') }));

		// @ts-expect-error an identity is never written
		update(users).set({ id: 1 });
		// @ts-expect-error nor is a generated column
		update(users).set({ search: 'x' });
		// @ts-expect-error not one of the role's values
		update(users).set({ role: 'owner' });
		// @ts-expect-error a non-null column takes no null
		update(users).set({ email: null });
		// @ts-expect-error not a column
		update(users).set({ nickname: 'ada' });
		// @ts-expect-error an integer expression is not set into a text column
		update(users).set((eb) => ({ name: eb.fn.length('users.email') }));
	});

	it('takes the `where` forms of a select', () => {
		update(users)
			.set({ name: 'Ada' })
			.where('users.email', 'ada@example.com')
			.where((eb) => eb.ref('users.createdAt').lt(new Date()));

		// @ts-expect-error wrong value type
		update(users).set({ name: 'Ada' }).where('users.id', '1');
		// @ts-expect-error not a column of the table
		update(users).set({ name: 'Ada' }).where('docs.id', 1);
	});

	it('type-checks an optimistic lock', () => {
		const db = database({ execute: async () => ({ rows: [] }) });
		const save = (id: number, version: number, body: string) =>
			db
				.update(docs)
				.set({ body, version: version + 1 })
				.where('docs.id', id)
				.where('docs.version', version)
				.expectRows(1);
		expectTypeOf(save(1, 3, 'x').execute()).toEqualTypeOf<
			Promise<WriteResult>
		>();
		expectTypeOf(
			save(1, 3, 'x').returning(['docs.version']).one(),
		).toEqualTypeOf<Promise<{ version: number }>>();
	});

	it('returns rows only with `returning`', () => {
		const query = update(users).set({ name: 'Ada' }).where('users.id', 1);
		// @ts-expect-error no `returning`, so no rows
		void query.all();
		expectTypeOf(query.returning(['users.name']).all()).toEqualTypeOf<
			Promise<{ name: string | null }[]>
		>();
	});
});

describe('updateMany', () => {
	it('takes rows with the `by` columns and any columns to set', () => {
		const query = updateMany(
			docs,
			[
				{ id: 1, body: 'a' },
				{ id: 2, version: 3 },
			],
			{ by: 'id' },
		);
		expectTypeOf(query).toEqualTypeOf<
			UpdateQueryBuilder<typeof docs, undefined, never>
		>();
		expectTypeOf(query.execute()).toEqualTypeOf<Promise<WriteResult>>();

		updateMany(docs, [{ tenantId: 1, slug: 'a', body: 'b' }], {
			by: ['tenantId', 'slug'],
		});
	});

	it('rejects rows without the `by` columns, or with wrong values', () => {
		// @ts-expect-error a row lacks its `by` column
		updateMany(docs, [{ id: 1, body: 'a' }, { body: 'b' }], { by: 'id' });
		const composite = { by: ['tenantId', 'slug'] } as const;
		// @ts-expect-error a row lacks one of its `by` columns
		updateMany(docs, [{ tenantId: 1, body: 'b' }], composite);
		// @ts-expect-error wrong value type
		updateMany(docs, [{ id: 1, body: 2 }], { by: 'id' });
		// @ts-expect-error an identity is only a `by` column, never set
		updateMany(docs, [{ slug: 'a', id: 1 }], { by: 'slug' });
		// @ts-expect-error not a column: reported on the rows, which then need every column
		updateMany(docs, [{ id: 1 }], { by: 'nope' });
	});
});

describe('deleteFrom', () => {
	it('only runs with a `where`', () => {
		const query = deleteFrom(users);
		// @ts-expect-error no `where`: it would delete every row
		void query.execute();

		expectTypeOf(
			deleteFrom(users).where('users.id', 1).execute(),
		).toEqualTypeOf<Promise<WriteResult>>();
		expectTypeOf(deleteFrom(users).allRows().execute()).toEqualTypeOf<
			Promise<WriteResult>
		>();

		const conditional = deleteFrom(users).when(true, (qb) =>
			qb.where('users.id', 1),
		);
		// @ts-expect-error `when` may not have run
		void conditional.execute();
	});

	it('returns rows only with `returning`', () => {
		const query = deleteFrom(users).where('users.id', 1);
		// @ts-expect-error no `returning`, so no rows
		void query.maybeOne();
		expectTypeOf(query.returning(['users.email']).maybeOne()).toEqualTypeOf<
			Promise<{ email: string } | undefined>
		>();
		expectTypeOf(query.expectRows(1)).toEqualTypeOf<typeof query>();
	});
});

describe('database', () => {
	const db = database({ execute: async () => ({ rows: [] }) });

	it('starts each kind of query', () => {
		expectTypeOf(db.insertInto(users)).toEqualTypeOf<
			InsertQueryBuilder<typeof users, undefined, 'values'>
		>();
		expectTypeOf(db.update(users)).toEqualTypeOf<
			UpdateQueryBuilder<typeof users, undefined, 'set' | 'where'>
		>();
		expectTypeOf(db.deleteFrom(users)).toEqualTypeOf<
			DeleteQueryBuilder<typeof users, undefined, 'where'>
		>();
		expectTypeOf(
			db.updateMany(docs, [{ id: 1, body: 'a' }], { by: 'id' }),
		).toEqualTypeOf<UpdateQueryBuilder<typeof docs, undefined, never>>();
	});
});
