import { describe, expectTypeOf, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { database } from '../src/database.js';
import { defineTable } from '../src/define-table.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text().nullable(),
	},
});

const db = database({ execute: async () => ({ rows: [] }) });
const query = db.selectFrom(users).select(['users.id', 'users.email']);
type Row = { id: number; email: string | null };

describe('running a query', () => {
	it('returns the rows of the select list', () => {
		expectTypeOf(query.all()).toEqualTypeOf<Promise<Row[]>>();
		expectTypeOf(query.first()).toEqualTypeOf<Promise<Row | undefined>>();
		expectTypeOf(query.one()).toEqualTypeOf<Promise<Row>>();
		expectTypeOf(query.maybeOne()).toEqualTypeOf<Promise<Row | undefined>>();
	});

	it('gives the executor the tag, if any', () => {
		database({
			execute: async (compiled) => {
				expectTypeOf(compiled.tag).toEqualTypeOf<string | undefined>();
				return { rows: [] };
			},
		});
	});
});
