import { describe, expectTypeOf, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { defineTable } from '../src/define-table.js';
import {
	type Fragment,
	fragment,
	selectFrom,
} from '../src/select-query-builder.js';

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
	it('types `column = value` like `eq`', () => {
		selectFrom(users).where('users.age', 18);
		selectFrom(users).where('users.role', 'admin');
		selectFrom(users).where('users.email', 'a@example.com');

		// @ts-expect-error wrong value type
		selectFrom(users).where('users.age', '18');
		// @ts-expect-error not one of the role's values
		selectFrom(users).where('users.role', 'owner');
		// @ts-expect-error `= null` is never true: `isNull()` in a callback
		selectFrom(users).where('users.email', null);
		// @ts-expect-error the two-argument form is only `=`
		selectFrom(users).where('users.age', '>=', 18);
	});

	it('takes any condition in a callback', () => {
		selectFrom(users).where((eb) => eb.ref('users.age').gte(18));
		selectFrom(users).where((eb) =>
			eb.or([eb.ref('users.age').lt(13), eb.ref('users.email').isNull()]),
		);
		selectFrom(users).where(({ ref }) =>
			ref('users.email').like('%@example.com'),
		);

		// @ts-expect-error a callback returns a condition
		selectFrom(users).where((eb) => eb.ref('users.age'));
	});

	it('has no orWhere: or is part of one condition', () => {
		// @ts-expect-error `.where((eb) => eb.or([a, b]))`
		selectFrom(users).orWhere('users.age', 18);
	});

	it('only sees joined tables', () => {
		// @ts-expect-error contacts is not joined
		selectFrom(users).where('contacts.email', 'x');
		// @ts-expect-error nor in a callback
		selectFrom(users).where((eb) => eb.ref('contacts.email').eq('x'));

		selectFrom(users)
			.innerJoin(contacts)
			.on('contacts.userId', 'users.id')
			.where('contacts.email', 'x');
	});
});

describe('innerJoin', () => {
	const joined = selectFrom(users).innerJoin(contacts);

	it('equates a joined column with another table’s column', () => {
		joined.on('contacts.userId', 'users.id');
		joined.on('contacts.userId', 'users.age');
		joined.on('contacts.email', 'users.email');
	});

	it('puts the joined table’s column on the left', () => {
		// @ts-expect-error the left-hand side is a column of the joined table
		joined.on('users.id', 'contacts.userId');
	});

	it('takes a column of an earlier table on the right', () => {
		// @ts-expect-error the right-hand side is a column of an earlier table
		joined.on('contacts.userId', 'contacts.id');
		// @ts-expect-error a value is not a column
		joined.on('contacts.userId', 1);
		// @ts-expect-error not a column in scope
		joined.on('contacts.userId', 'users.nope');
	});

	it('takes a column of any earlier table on the right', () => {
		const second = joined
			.on('contacts.userId', 'users.id')
			.innerJoin(users.as('managers'));
		second.on('managers.id', 'users.id');
		second.on('managers.id', 'contacts.userId');
		// @ts-expect-error the right-hand side is a column of an earlier table
		second.on('managers.id', 'managers.age');
	});

	it('checks the right-hand column against the joined column’s `=`', () => {
		// @ts-expect-error an integer column is not compared with a string one
		joined.on('contacts.userId', 'users.email');
	});

	it('joins a table to an alias of itself', () => {
		selectFrom(users)
			.innerJoin(users.as('managers'))
			.on('managers.id', 'users.id');
	});

	it('takes any other condition in a callback', () => {
		joined.on((eb) =>
			eb.and([
				eb.ref('contacts.userId').eq(eb.ref('users.id')),
				eb.ref('contacts.email').like('%@example.com'),
			]),
		);
		joined.on((eb) => eb.ref('contacts.userId').lt(eb.ref('users.age')));
		joined.on((eb) => eb.ref('users.age').gte(18));
		// @ts-expect-error the shorthand takes no operator
		joined.on('contacts.userId', '<', 'users.age');
		// @ts-expect-error a callback condition is still checked
		joined.on((eb) => eb.ref('contacts.userId').eq(eb.ref('users.email')));
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
				.on('contacts.userId', 'users.id')
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

describe('when', () => {
	const flag = Math.random() > 0.5;

	it('keeps the row when it only adds conditions', () => {
		const query = selectFrom(users)
			.select(['users.id'])
			.when(flag, (qb) => qb.where('users.role', 'admin'));
		expectTypeOf(query.$output).toEqualTypeOf<{ id: number }>();
	});

	it('makes the columns it selects optional', () => {
		expectTypeOf(
			selectFrom(users)
				.select(['users.id'])
				.when(flag, (qb) => qb.select(['users.email'])).$output,
		).toEqualTypeOf<{ id: number; email?: string | null }>();
	});

	it('keeps the tables, so it cannot join', () => {
		selectFrom(users).when(flag, (qb) =>
			// @ts-expect-error a join changes the tables
			qb.innerJoin(contacts).on('contacts.userId', 'users.id'),
		);
	});
});

const admins = fragment(users, (qb) => qb.where('users.role', 'admin'));
const withContacts = fragment(users, (qb) =>
	qb.innerJoin(contacts).on('contacts.userId', 'users.id'),
);
const contactEmail = fragment(contacts, (qb) => qb.select(['contacts.email']));
const sameEmail = fragment([users, contacts], (qb) =>
	qb.where((eb) => eb.ref('contacts.email').eq(eb.ref('users.email'))),
);

describe('fragment', () => {
	it('builds on the tables it is given', () => {
		fragment(users, (qb) => {
			expectTypeOf(qb).toEqualTypeOf<Fragment<[typeof users]>>();
			return qb;
		});
		fragment([users, contacts], (qb) => {
			expectTypeOf(qb).toEqualTypeOf<
				Fragment<[typeof users, typeof contacts]>
			>();
			return qb;
		});
	});

	it('only sees its tables', () => {
		// @ts-expect-error contacts is not a table of the fragment
		fragment(users, (qb) => qb.where('contacts.email', 'x'));
	});

	it('returns a query', () => {
		// @ts-expect-error not a query
		fragment(users, () => 1);
	});
});

describe('pipe', () => {
	it('applies a reusable piece of a query', () => {
		expectTypeOf(
			selectFrom(users).pipe(admins).select(['users.id']).$output,
		).toEqualTypeOf<{ id: number }>();
	});

	it('adds the tables it joins', () => {
		expectTypeOf(
			selectFrom(users).pipe(withContacts).select(['contacts.email']).$output,
		).toEqualTypeOf<{ email: string }>();
	});

	it('adds the columns it selects to the row', () => {
		expectTypeOf(
			selectFrom(users)
				.select(['users.id'])
				.pipe(withContacts)
				.pipe(contactEmail).$output,
		).toEqualTypeOf<{ id: number; email: string }>();
	});

	it('applies wherever its tables are in the query', () => {
		const joined = selectFrom(users).pipe(withContacts);
		expectTypeOf(
			joined.pipe(admins).select(['contacts.email']).$output,
		).toEqualTypeOf<{ email: string }>();
		joined.pipe(sameEmail);
		selectFrom(contacts)
			.innerJoin(users)
			.on('users.id', 'contacts.userId')
			.pipe(admins);
	});

	it('needs its tables in the query', () => {
		// @ts-expect-error users is not in a contacts query
		selectFrom(contacts).pipe(admins);
		// @ts-expect-error contacts is not joined
		selectFrom(users).pipe(sameEmail);
	});

	it('takes only a function returning a query', () => {
		// @ts-expect-error not a query
		selectFrom(users).pipe(() => 1);
	});
});
