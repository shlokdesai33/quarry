import { describe, expect, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { defineTable } from '../src/define-table.js';
import { selectFrom } from '../src/select-query-builder.js';
import { codecNames, plain } from './helpers/compiled.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		name: text(),
	},
});

const bookings = defineTable('bookings', {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		name: text(),
	},
});

const left = selectFrom(users)
	.leftJoin(bookings)
	.on('bookings.userId', 'users.id');

describe('nest', () => {
	it('selects flat columns after a ctid marker keyed by the object', () => {
		const query = left
			.select(({ nest }) => ['users.id', nest('bookings', ['id', 'name'])])
			.toSQL();
		expect(plain(query)).toEqual({
			sql: 'select "users"."id" as "id", ("bookings".ctid is not null) as "bookings", "bookings"."id" as "bookings.id", "bookings"."name" as "bookings.name" from "users" left join "bookings" on "bookings"."user_id" = "users"."id"',
			params: [],
		});
		expect(codecNames(query).results).toEqual(['int4', 'bool', 'int4', 'text']);
		expect(query.nested).toEqual([
			{
				key: 'bookings',
				marker: 1,
				columns: [
					[2, 'id'],
					[3, 'name'],
				],
			},
		]);
	});

	it('selects every column without a list, by its name in the database', () => {
		expect(left.select(({ nest }) => [nest('bookings')]).toSQL().sql).toBe(
			'select ("bookings".ctid is not null) as "bookings", "bookings"."id" as "bookings.id", "bookings"."user_id" as "bookings.userId", "bookings"."name" as "bookings.name" from "users" left join "bookings" on "bookings"."user_id" = "users"."id"',
		);
	});

	it('keys the object, and its columns, by .as()', () => {
		const query = left
			.select(({ nest }) => [nest('bookings', ['id']).as('booking')])
			.toSQL();
		expect(query.sql).toBe(
			'select ("bookings".ctid is not null) as "booking", "bookings"."id" as "booking.id" from "users" left join "bookings" on "bookings"."user_id" = "users"."id"',
		);
		expect(query.nested).toEqual([
			{ key: 'booking', marker: 0, columns: [[1, 'id']] },
		]);
	});

	it('takes a table by its alias', () => {
		const query = selectFrom(users)
			.leftJoin(users.as('managers'))
			.on('managers.id', 'users.id')
			.select(({ nest }) => [nest('users', ['id']), nest('managers', ['id'])])
			.toSQL();
		expect(query.sql).toBe(
			'select ("users".ctid is not null) as "users", "users"."id" as "users.id", ("managers".ctid is not null) as "managers", "managers"."id" as "managers.id" from "users" left join "users" as "managers" on "managers"."id" = "users"."id"',
		);
		expect(query.nested).toEqual([
			{ key: 'users', marker: 0, columns: [[1, 'id']] },
			{ key: 'managers', marker: 2, columns: [[3, 'id']] },
		]);
	});

	it('leaves queries without one as they were', () => {
		expect(left.select(['users.id']).toSQL().nested).toBeUndefined();
	});

	it('keeps the nesting off the enumerable properties of the compiled query', () => {
		const query = left.select(({ nest }) => [nest('bookings')]).toSQL();
		expect(Object.keys(query)).toEqual(['sql', 'params']);
		expect({ ...query }.nested).toBeUndefined();
	});

	it('throws for tables and columns not in the query', () => {
		// oxlint-disable-next-line typescript/no-explicit-any -- what the types reject
		const loose = left as any;
		expect(() => loose.select(({ nest }: any) => [nest('posts')])).toThrow(
			'nest: "posts" is not in the query',
		);
		expect(() =>
			loose.select(({ nest }: any) => [nest('bookings', ['email'])]),
		).toThrow('nest: "bookings" has no column "email"');
		expect(() => loose.select(({ nest }: any) => [nest('bookings', [])])).toThrow(
			'nest: list at least one column of "bookings", or none for every column',
		);
		expect(() =>
			left.select(({ nest }) => [nest('bookings', ['id', 'id'])]),
		).toThrow('nest: "id" is listed twice');
	});

	it('checks its key against the row, not its columns', () => {
		expect(() =>
			left.select(({ nest }) => ['users.id', nest('bookings', ['id'])]),
		).not.toThrow();
		const nested = left.select(({ nest }) => [nest('bookings', ['id'])]);
		// oxlint-disable-next-line typescript/no-explicit-any -- what the types reject
		expect(() => (nested as any).select(({ nest }: any) => [nest('bookings')])).toThrow(
			'select each key once: "bookings" is already in the row',
		);
	});

	it("isn't a key to order or group by", () => {
		const nested = left.select(({ nest }) => [nest('bookings', ['id'])]);
		expect(() => nested.orderBy('bookings')).toThrow(
			'"bookings" is a nested object: name one of its columns',
		);
		expect(nested.orderBy('bookings.id').toSQL().sql).toMatch(
			/order by "bookings"\."id"$/,
		);
	});
});
