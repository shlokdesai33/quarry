import { describe, expectTypeOf, it } from 'vitest';
import {
	integer,
	jsonb,
	text,
	timestamptz,
	tsvector,
} from '../src/column-factories.js';
import type { DataType } from '../src/data-type/data-type.js';
import { databaseWith } from '../src/database.js';
import { fakeExecutor } from './helpers/executor.js';
import type { Query } from '../src/query.js';
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
		void query.expectOne();

		const returning = query.returning(['users.id', 'users.role']);
		expectTypeOf(returning.expectOne()).toEqualTypeOf<
			Query<{ id: number; role: 'admin' | 'member' }>
		>();
		expectTypeOf(returning.toQuery()).toEqualTypeOf<
			Query<{ id: number; role: 'admin' | 'member' }[]>
		>();
		expectTypeOf(
			query
				.returning((eb) => [eb.fn.lower('users.email').as('lower')])
				.takeFirst(),
		).toEqualTypeOf<Query<{ lower: string } | undefined>>();

		// @ts-expect-error not a column of the table
		query.returning(['docs.id']);
	});

	it('keeps its type through `tag` and `when`', () => {
		const query = insertInto(users).values(ada);
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
		const db = databaseWith(fakeExecutor().executor);
		const save = (id: number, version: number, body: string) =>
			db
				.update(docs)
				.set({ body, version: version + 1 })
				.where('docs.id', id)
				.where('docs.version', version);
		expectTypeOf(save(1, 3, 'x').expectRows(1).execute()).toEqualTypeOf<
			Promise<WriteResult>
		>();
		expectTypeOf(
			save(1, 3, 'x').returning(['docs.version']).expectRows(1).execute(),
		).toEqualTypeOf<Promise<{ version: number }[]>>();
		expectTypeOf(
			save(1, 3, 'x').returning(['docs.version']).expectOne(),
		).toEqualTypeOf<Query<{ version: number }>>();
	});

	it('returns rows only with `returning`', () => {
		const query = update(users).set({ name: 'Ada' }).where('users.id', 1);
		// @ts-expect-error no `returning`, so no rows
		void query.takeFirst();
		expectTypeOf(query.returning(['users.name']).toQuery()).toEqualTypeOf<
			Query<{ name: string | null }[]>
		>();
	});
});

describe('update().setEach', () => {
	const db = databaseWith(fakeExecutor().executor);

	it('runs as is: the key match is its `where`', () => {
		const query = update(docs).setEach(
			[
				{ id: 1, body: 'a' },
				{ id: 2, version: 3 },
			],
			{ key: 'id' },
		);
		expectTypeOf(query.$missing).toEqualTypeOf<never>();
		expectTypeOf(query.execute()).toEqualTypeOf<Promise<WriteResult>>();
		expectTypeOf(query.expectRows(2)).toEqualTypeOf<Query<WriteResult>>();
		expectTypeOf(query.toQuery()).toEqualTypeOf<Query<WriteResult>>();
		// branded: the plain check rejects a rest tuple of `{ id: number }`
		expectTypeOf(
			query.returning(['docs.id']).expectNonEmpty(),
		).branded.toEqualTypeOf<Query<[{ id: number }, ...{ id: number }[]]>>();
		expectTypeOf(
			query.returning(['docs.id']).takeFirst().execute(),
		).toEqualTypeOf<Promise<{ id: number } | undefined>>();
		// @ts-expect-error a plain `set` still needs a `where`
		void update(docs).set({ body: 'a' }).execute();
	});

	it('types each row: its key, and any of the columns an update can set', () => {
		update(docs).setEach(
			[
				{ id: 1, body: 'a', settings: { theme: 'dark' } },
				{ id: 2, version: 3 },
				{ id: 3 },
			],
			{ key: 'id' },
		);
		update(users).setEach([{ id: 1, name: null, role: 'admin' }], {
			key: 'id',
		});
		update(docs).setEach([{ tenantId: 1, slug: 'a', body: 'b' }], {
			key: ['tenantId', 'slug'],
		});
		update(docs).setEach([{ slug: 'a', version: 1 }], { key: 'slug' });

		// @ts-expect-error a row lacks its key
		update(docs).setEach([{ id: 1, body: 'a' }, { body: 'b' }], { key: 'id' });
		update(docs).setEach(
			// @ts-expect-error a row lacks one of its key columns
			[{ tenantId: 1, body: 'b' }],
			{ key: ['tenantId', 'slug'] },
		);
		// @ts-expect-error a key is never null
		update(users).setEach([{ id: null, name: 'a' }], { key: 'id' });
		// @ts-expect-error wrong value type
		update(docs).setEach([{ id: 1, body: 2 }], { key: 'id' });
		// @ts-expect-error a non-null column takes no null
		update(docs).setEach([{ id: 1, body: null }], { key: 'id' });
		// @ts-expect-error not one of the role's values
		update(users).setEach([{ id: 1, role: 'owner' }], { key: 'id' });
		// @ts-expect-error an identity is only a key column, never set
		update(docs).setEach([{ slug: 'a', id: 1 }], { key: 'slug' });
		// @ts-expect-error nor is a generated column
		update(users).setEach([{ id: 1, search: 'x' }], { key: 'id' });
		// @ts-expect-error not a column
		update(users).setEach([{ id: 1, nickname: 'x' }], { key: 'id' });
		// @ts-expect-error not a column: reported on the rows, which then need every column
		update(docs).setEach([{ id: 1 }], { key: 'nope' });
		// @ts-expect-error a key needs a column
		update(docs).setEach([{ id: 1 }], { key: [] });
	});

	it('takes the rows’ type from a variable, with columns set in some rows only', () => {
		type Patch = { id: number; body?: string; version?: number };
		const patches: Patch[] = [{ id: 1, body: 'a' }, { id: 2 }];
		void db.update(docs).setEach(patches, { key: 'id' }).execute();
		const loose: { id?: number; body?: string }[] = [];
		// @ts-expect-error a row's key may be missing
		update(docs).setEach(loose, { key: 'id' });
	});

	it('puts the rows in scope, a column a row may leave out as nullable', () => {
		const query = update(docs)
			.setEach([{ id: 1, body: 'a' }], { key: 'id' })
			.set((eb) => ({
				version: eb.fn.coalesce('row.version', 'docs.version'),
			}))
			.where((eb) => eb.ref('docs.version').lt(eb.ref('row.id')))
			.returning(['docs.slug', 'row.id', 'row.body']);
		expectTypeOf(query.expectOne()).toEqualTypeOf<
			Query<{ slug: string; id: number; body: string | null }>
		>();

		update(docs)
			.setEach([{ id: 1, body: 'a' }], { key: 'id' })
			// @ts-expect-error a row may leave the body out: it is nullable
			.set((eb) => ({ body: eb.ref('row.body') }));
		update(users)
			.setEach([{ id: 1, name: 'a' }], { key: 'id' })
			// @ts-expect-error only the key and the columns an update sets are in the rows
			.returning(['row.search']);
		// @ts-expect-error the rows are only in scope after setEach
		update(docs).set((eb) => ({ body: eb.ref('row.body') }));
	});

	it('works with returningAll and arithmetic over the rows', () => {
		const query = update(docs)
			.setEach([{ id: 1, version: 2 }], { key: 'id' })
			.set((eb) => ({
				version: eb
					.ref('docs.version')
					.plus(eb.fn.coalesce('row.version', eb.val(0))),
			}))
			.returningAll();
		expectTypeOf(query.takeFirst()).toEqualTypeOf<
			Query<
				| {
						id: number;
						tenantId: number;
						slug: string;
						body: string;
						version: number;
						settings: { theme: string };
				  }
				| undefined
			>
		>();
		update(docs)
			.setEach([{ id: 1, version: 2 }], { key: 'id' })
			// @ts-expect-error a row may leave the version out: the sum is nullable
			.set((eb) => ({
				version: eb.ref('docs.version').plus(eb.ref('row.version')),
			}));
	});

	it('names the rows with `as`', () => {
		const query = update(docs)
			.setEach([{ tenantId: 1, slug: 'a', body: 'x' }], {
				key: ['tenantId', 'slug'],
				as: 'v',
			})
			.returning(['v.tenantId', 'v.slug']);
		expectTypeOf(query.expectFirst()).toEqualTypeOf<
			Query<{ tenantId: number; slug: string }>
		>();
		update(docs)
			.setEach([{ id: 1, body: 'x' }], { key: 'id', as: 'v' })
			// @ts-expect-error the rows are `v`, not `row`
			.returning(['row.id']);
	});

	it('runs in a batch', async () => {
		const [counted, first] = await db.batch([
			db.update(docs).setEach([{ id: 1, body: 'a' }], { key: 'id' }),
			db
				.update(docs)
				.setEach([{ id: 2, version: 3 }], { key: 'id' })
				.returning(['docs.id', 'row.version'])
				.takeFirst(),
		]);
		expectTypeOf(counted).toEqualTypeOf<WriteResult>();
		expectTypeOf(first).toEqualTypeOf<
			{ id: number; version: number | null } | undefined
		>();
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
		void query.expectAtMostOne();
		expectTypeOf(
			query.returning(['users.email']).expectAtMostOne(),
		).toEqualTypeOf<Query<{ email: string } | undefined>>();
		expectTypeOf(query.expectRows(1)).toEqualTypeOf<Query<WriteResult>>();
	});
});

describe('database', () => {
	const db = databaseWith(fakeExecutor().executor);

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
	});
});
