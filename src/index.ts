import { array, integer, text } from './column-factories.js';
import { defineEnum } from './define-enum.js';
import { defineTable } from './define-table.js';
import { selectFrom } from './select-query-builder.js';

const status = defineEnum('status', ['active', 'inactive']);

type UserId = number & { readonly __brand?: 'UserId' };
type ContactId = number & { readonly __brand?: 'ContactId' };
type EmployeeId = number & { readonly __brand?: 'EmployeeId' };

export const User = defineTable('users', {
	columns: {
		/** primary key of the user */
		id: integer<UserId>().identity(),
		/** name of the user */
		firstName: text().name('first_name').nullable(),
		/** email of the user */
		email: text(),
		/** password of the user */
		password: text(),
		/** status of the user */
		status: status().name('user_status'),
		/** the roles the user has */
		roles: array(text()).name('roles').default(),
	},
});

export const Contact = defineTable('contacts', {
	columns: {
		id: integer<ContactId>().identity(),
		userId: integer<UserId>(),
		email: text(),
		phone: text().nullable().default(),
	},
});

export const Employee = defineTable('employees', {
	columns: {
		id: integer<EmployeeId>().identity(),
		userId: integer<UserId>(),
		email: text(),
		phone: text().nullable().default(),
	},
});

const test = selectFrom(User)
	.innerJoin(Contact)
	.on('contacts.userId', 'users.id')
	.innerJoin(Employee)
	.on('employees.userId', 'users.id')
	.where((eb) =>
		eb.or([
			eb.ref('contacts.email').eq('shlok@slash.com'),
			eb.ref('contacts.email').ilike('%@slash.com%'),
			eb.and([
				eb.ref('contacts.email').eq('shlok@slash.com'),
				eb.ref('contacts.email').ilike('%@slash.com%'),
			])
		]),
	)
	.select(['users.id', 'users.roles']);

const joined = selectFrom(User).innerJoin(Contact);

// same brand on both sides
joined.on('contacts.userId', 'users.id');

// brands aren't checked, only SQL types: a ContactId joins a UserId
joined.on('contacts.id', 'users.id');

// other operators, and values, go in a callback
joined.on((eb) => eb.ref('contacts.userId').lt(eb.ref('users.id')));
joined.on((eb) => eb.ref('contacts.userId').eq(1));
