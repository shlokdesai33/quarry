import {
	array,
	bigint,
	decimal,
	integer,
	text,
	timestamptz,
	tsvector,
	varchar,
} from '../../../src/column-factories.js';
import { defineEnum } from '../../../src/define-enum.js';
import { defineTable } from '../../../src/define-table.js';

export const status = defineEnum('user_status', [
	'active',
	'suspended',
	'archived',
]);

export const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: varchar(255),
		displayName: text().name('display_name').nullable(),
		age: integer().nullable(),
		status: status().default(),
		tags: array(text()).default(),
		createdAt: timestamptz().name('created_at').default(),
	},
});

export const orders = defineTable('orders', {
	columns: {
		id: bigint().identity(),
		userId: integer().name('user_id'),
		total: decimal(10, 2),
		search: tsvector().generated(),
	},
});

export const invoices = defineTable('invoices', {
	columns: {
		id: bigint().identity(),
		orderId: bigint().name('order_id'),
	},
});

export const schema = [users, orders, invoices];
