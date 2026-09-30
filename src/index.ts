import { integer, text } from './column-factories.js';
import { defineEnum } from './define-enum.js';
import { defineTable } from './define-table.js';

const status = defineEnum('status', ['active', 'inactive']);

const User = defineTable('users', {
	columns: {
		/** primary key of the user */
		id: integer().identity(),
		/** name of the user */
		firstName: text('first_name').nullable(),
		/** email of the user */
		email: text(),
		/** password of the user */
		password: text(),
		/** status of the user */
		status: status('user_status'),
		/** the roles the user has */
		roles: text().array(),
	},
});
