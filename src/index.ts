import { array, integer, text } from './column-factories.js';
import { defineEnum } from './define-enum.js';
import { defineTable } from './define-table.js';
import { selectFrom } from './select-query-builder.js';

const status = defineEnum('status', ['active', 'inactive']);

export const User = defineTable('users', {
	columns: {
		/** primary key of the user */
		id: integer().identity(),
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
		id: integer().identity(),
		userId: integer(),
		email: text(),
		phone: text().nullable().default(),
	},
});

const test = selectFrom(User)
	.innerJoin(Contact)
	.on('contacts.email', '=', 'users.email')
	.where('contacts.id', '<=', 10)
	.select(['users.id', 'users.roles']).$output;
