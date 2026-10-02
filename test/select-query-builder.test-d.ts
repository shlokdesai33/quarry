import { describe, expectTypeOf, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { defineTable } from '../src/define-table.js';
import { selectFrom } from '../src/select-query-builder.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text().nullable(),
		age: integer(),
		role: text<'admin' | 'member'>(),
	},
});

const contacts = defineTable('contacts', {
	columns: {
		id: integer().identity(),
		userId: integer().name('user_id'),
		email: text(),
	},
});

describe('where', () => {
	it('types the value from the column and operator', () => {
		selectFrom(users).where('users.age', '>=', 18);
		selectFrom(users).where('users.role', 'in', ['admin', 'member']);
		selectFrom(users).orWhere('users.email', 'is', null);

		// @ts-expect-error wrong value type
		selectFrom(users).where('users.age', '=', '18');
		// @ts-expect-error not one of the role's values
		selectFrom(users).where('users.role', '=', 'owner');
		// @ts-expect-error integers have no pattern operators
		selectFrom(users).where('users.age', 'like', '1%');
	});

	it('gives a group the same scope', () => {
		selectFrom(users).where((q) =>
			q.where('users.age', '<', 13).orWhere('users.role', '=', 'admin'),
		);
		selectFrom(users).where((q) =>
			q.where('users.age', '>', q.ref('users.id')),
		);

		selectFrom(users).where((q) =>
			// @ts-expect-error a reference is still checked inside a group
			q.where('users.age', '>', q.ref('users.email')),
		);
	});

	it('only sees joined tables', () => {
		// @ts-expect-error contacts is not joined
		selectFrom(users).where('contacts.email', '=', 'x');

		selectFrom(users)
			.innerJoin(contacts)
			.on((q) => q.where('contacts.userId', '=', q.ref('users.id')))
			.where('contacts.email', '=', 'x');
	});
});

describe('innerJoin', () => {
	const joined = selectFrom(users).innerJoin(contacts);

	it('compares a joined column with another table’s column', () => {
		joined.on('contacts.userId', '=', 'users.id');
		joined.on('contacts.userId', '<', 'users.age');
		joined.on('contacts.email', '=', 'users.email');
	});

	it('puts the joined table’s column on the left', () => {
		// @ts-expect-error the left-hand side is a column of the joined table
		joined.on('users.id', '=', 'contacts.userId');
	});

	it('takes any column in scope on the right', () => {
		joined.on('contacts.userId', '=', 'contacts.id');

		// @ts-expect-error a value is not a column
		joined.on('contacts.userId', '=', 1);
		// @ts-expect-error not a column in scope
		joined.on('contacts.userId', '=', 'users.nope');
	});

	it('checks the right-hand column against the operator', () => {
		// @ts-expect-error an integer column is not compared with a string one
		joined.on('contacts.userId', '=', 'users.email');
		// @ts-expect-error integers have no pattern operators
		joined.on('contacts.userId', 'like', 'users.email');
		// @ts-expect-error `is` takes a keyword, not a column
		joined.on('contacts.userId', 'is', 'users.id');
		// @ts-expect-error `between` takes a pair, not a column
		joined.on('contacts.userId', 'between', 'users.id');
	});

	it('joins a table to an alias of itself', () => {
		selectFrom(users)
			.innerJoin(users.as('managers'))
			.on('managers.id', '=', 'users.id');
	});

	it('takes any other condition in a callback', () => {
		joined.on((q) =>
			q
				.where('contacts.userId', '=', q.ref('users.id'))
				.where('contacts.email', 'like', '%@example.com'),
		);
		joined.on((q) => q.where('users.age', '>=', 18));
	});
});

describe('select', () => {
	it('keys columns by their name', () => {
		expectTypeOf(
			selectFrom(users).select(['users.id', 'users.email']).$output,
		).toEqualTypeOf<{ id: number; email: string | null }>();
	});

	it('keys expressions by their alias', () => {
		expectTypeOf(
			selectFrom(users).select((eb) => [
				eb.fn.lower('users.email').as('lowerEmail'),
			]).$output,
		).toEqualTypeOf<{ lowerEmail: string | null }>();
	});

	it('selects from joined tables', () => {
		expectTypeOf(
			selectFrom(users)
				.innerJoin(contacts)
				.on((q) => q.where('contacts.userId', '=', q.ref('users.id')))
				.select(['users.id', 'contacts.email']).$output,
		).toEqualTypeOf<{ id: number; email: string }>();
	});

	it('adds to the row on each call', () => {
		expectTypeOf(
			selectFrom(users).select(['users.id']).select(['users.age']).$output,
		).toEqualTypeOf<{ id: number; age: number }>();
	});

	it('only selects columns in scope', () => {
		// @ts-expect-error contacts is not joined
		selectFrom(users).select(['contacts.email']);
	});
});
