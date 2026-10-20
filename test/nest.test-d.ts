import { describe, expectTypeOf, it } from 'vitest';
import { integer, text, timestamptz } from '../src/column-factories.js';
import { defineTable } from '../src/define-table.js';
import { fragment, selectFrom } from '../src/select-query-builder.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		name: text(),
		email: text().nullable(),
	},
});

const bookings = defineTable('bookings', {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		name: text(),
		note: text().nullable(),
		at: timestamptz(),
	},
});

const left = selectFrom(users)
	.leftJoin(bookings)
	.on('bookings.userId', 'users.id');

type Booking = {
	id: number;
	userId: number;
	name: string;
	note: string | null;
	at: Date;
};

describe('nest', () => {
	it('is null as a whole on the joined side of a left join, its columns as the table reads them', () => {
		expectTypeOf(
			left.select(({ nest }) => ['users.id', nest('bookings', ['id', 'name'])])
				.$output,
		).toEqualTypeOf<{
			id: number;
			bookings: { id: number; name: string } | null;
		}>();
	});

	it('takes every column without a list', () => {
		expectTypeOf(
			left.select(({ nest }) => [nest('bookings')]).$output,
		).toEqualTypeOf<{ bookings: Booking | null }>();
	});

	it('is never null on the base table or an inner join', () => {
		expectTypeOf(
			selectFrom(users)
				.innerJoin(bookings)
				.on('bookings.userId', 'users.id')
				.select(({ nest }) => [nest('users', ['id']), nest('bookings')])
				.$output,
		).toEqualTypeOf<{ users: { id: number }; bookings: Booking }>();
		expectTypeOf(
			left.select(({ nest }) => [nest('users')]).$output,
		).toEqualTypeOf<{
			users: { id: number; name: string; email: string | null };
		}>();
	});

	it('follows right and full joins', () => {
		expectTypeOf(
			selectFrom(users)
				.rightJoin(bookings)
				.on('bookings.userId', 'users.id')
				.select(({ nest }) => [nest('users', ['id']), nest('bookings', ['id'])])
				.$output,
		).toEqualTypeOf<{
			users: { id: number } | null;
			bookings: { id: number };
		}>();
		expectTypeOf(
			selectFrom(users)
				.fullJoin(bookings)
				.on('bookings.userId', 'users.id')
				.select(({ nest }) => [nest('users', ['id']), nest('bookings', ['id'])])
				.$output,
		).toEqualTypeOf<{
			users: { id: number } | null;
			bookings: { id: number } | null;
		}>();
		// a right join after a left join: the left-joined table's columns
		// read as the table's once it has a row
		expectTypeOf(
			left
				.rightJoin(users.as('managers'))
				.on('managers.id', 'users.id')
				.select(({ nest }) => [nest('bookings', ['id', 'note'])]).$output,
		).toEqualTypeOf<{ bookings: { id: number; note: string | null } | null }>();
	});

	it('makes an object selected before a right join nullable', () => {
		expectTypeOf(
			selectFrom(users)
				.select(({ nest }) => [nest('users', ['id'])])
				.rightJoin(bookings)
				.on('bookings.userId', 'users.id')
				.select(['bookings.name']).$output,
		).toEqualTypeOf<{ users: { id: number } | null; name: string }>();
	});

	it('takes a table by its alias, and is keyed by it', () => {
		expectTypeOf(
			left
				.leftJoin(users.as('managers'))
				.on('managers.id', 'users.id')
				.select(({ nest }) => [nest('managers', ['name'])]).$output,
		).toEqualTypeOf<{ managers: { name: string } | null }>();
		// @ts-expect-error -- an aliased table goes by its alias
		selectFrom(users.as('u')).select(({ nest }) => [nest('users')]);
	});

	it('is renamed with .as()', () => {
		expectTypeOf(
			left.select(({ nest }) => [nest('bookings', ['id']).as('booking')])
				.$output,
		).toEqualTypeOf<{ booking: { id: number } | null }>();
	});

	it('takes only tables in the query and their columns', () => {
		// @ts-expect-error -- not in the query
		selectFrom(users).select(({ nest }) => [nest('bookings')]);
		// @ts-expect-error -- not a column of bookings
		left.select(({ nest }) => [nest('bookings', ['email'])]);
		// @ts-expect-error -- at least one column
		left.select(({ nest }) => [nest('bookings', [])]);
	});

	it('checks top-level keys only', () => {
		// a nested column doesn't clash with a column of the row
		expectTypeOf(
			left.select(({ nest }) => ['users.id', nest('bookings', ['id'])]).$output,
		).toEqualTypeOf<{ id: number; bookings: { id: number } | null }>();
		// @ts-expect-error -- the key is taken
		left.select(({ nest, ref }) => [
			ref('users.name').as('bookings'),
			nest('bookings'),
		]);
		left
			.select(({ nest }) => [nest('bookings', ['id'])])
			// @ts-expect-error -- the key is taken
			.select(({ nest }) => [nest('bookings', ['name'])]);
		left
			.select(({ nest }) => [nest('bookings', ['id'])])
			.select(({ nest }) => [nest('bookings', ['name']).as('again')]);
	});

	it('lists each column once', () => {
		// @ts-expect-error -- listed twice
		left.select(({ nest }) => [nest('bookings', ['id', 'name', 'id'])]);
	});

	it("isn't a key to order, group or distinct on, wherever it was selected", () => {
		const nested = left.select(({ nest }) => [
			'users.name',
			nest('bookings', ['id']).as('booking'),
		]);
		// @ts-expect-error -- a nested object's key
		nested.orderBy('booking');
		// @ts-expect-error -- a nested object's key
		nested.orderBy(() => 'booking');
		// @ts-expect-error -- a nested object's key
		nested.groupBy(['booking']);
		// @ts-expect-error -- a nested object's key
		nested.groupBy(() => ['booking']);
		// @ts-expect-error -- a nested object's key
		nested.distinctOn(['booking']);
		// its columns and the row's other keys still are
		nested
			.groupBy(['name', 'bookings.id'])
			.orderBy('name')
			.orderBy('bookings.id')
			.distinctOn(['name']);
		// through a join, `when` and `pipe`
		selectFrom(users)
			.select(({ nest }) => [nest('users', ['id'])])
			.leftJoin(bookings)
			.on('bookings.userId', 'users.id')
			// @ts-expect-error -- a nested object's key
			.orderBy('users');
		selectFrom(users)
			.when(true, (qb) => qb.select(({ nest }) => [nest('users', ['id'])]))
			// @ts-expect-error -- a nested object's key
			.orderBy('users');
		const nestUsers = fragment(users, (qb) =>
			qb.select(({ nest }) => [nest('users', ['id'])]),
		);
		selectFrom(users)
			.pipe(nestUsers)
			// @ts-expect-error -- a nested object's key
			.orderBy('users');
	});

	it("isn't a pagination key, even when a column has its name", () => {
		const accounts = defineTable('accounts', {
			columns: { id: integer().identity(), owner: integer() },
		});
		const query = selectFrom(accounts).select(({ nest }) => [
			'accounts.id',
			nest('accounts', ['owner']).as('owner'),
		]);
		query.iterateChunks(10, { by: 'accounts.id' });
		// @ts-expect-error -- `owner` holds the object, not the column
		query.iterateChunks(10, { by: 'accounts.owner' });
		// @ts-expect-error -- `owner` holds the object, not the column
		void query.paginateByCursor({ perPage: 10, by: 'accounts.owner' });
	});

	it('works with the result shapes', () => {
		const query = left.select(({ nest }) => [nest('bookings', ['id'])]);
		expectTypeOf(query.takeFirst().execute()).resolves.toEqualTypeOf<
			{ bookings: { id: number } | null } | undefined
		>();
		expectTypeOf(query.takeValue().execute()).resolves.toEqualTypeOf<
			{ id: number } | null | undefined
		>();
	});
});

describe('NullableColumn', () => {
	it('still takes the table itself where its nullable type is in scope', () => {
		left.forUpdate().of(bookings);
	});
});
