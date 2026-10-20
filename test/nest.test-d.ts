import { describe, expectTypeOf, it } from 'vitest';
import { integer, text, timestamptz } from '../src/column-factories.js';
import { defineTable } from '../src/define-table.js';
import { selectFrom } from '../src/select-query-builder.js';

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
				.select(({ nest }) => [nest('users', ['id']), nest('bookings')]).$output,
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
		).toEqualTypeOf<{ users: { id: number } | null; bookings: { id: number } }>();
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
