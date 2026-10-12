import { describe, expect, expectTypeOf, it } from 'vitest';
import { integer, text } from '../src/column-factories.js';
import { defineTable } from '../src/define-table.js';
import {
	CheckViolation,
	NotNullViolation,
	postgresError,
	UniqueViolation,
	type IntegrityConstraintViolation,
} from '../src/driver/errors.js';
import { violatedColumns } from '../src/errors.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text().name('email_address'),
		orgId: integer().name('org_id'),
		nickname: text().nullable(),
	},
});

/** A constraint error as the server reports it: SQLSTATE, table, column, constraint and detail. */
function violation(
	fields: Record<string, string>,
): IntegrityConstraintViolation {
	const error = postgresError({ M: 'violation', ...fields });
	if (
		!(
			error instanceof UniqueViolation ||
			error instanceof NotNullViolation ||
			error instanceof CheckViolation
		)
	)
		throw new Error(`unexpected ${error.name}`);
	return error;
}

describe('violatedColumns', () => {
	it('maps the columns of a unique violation to the keys the table declares', () => {
		const error = violation({
			C: '23505',
			t: 'users',
			n: 'users_email_key',
			D: 'Key (email_address)=(ada@example.com) already exists.',
		});
		expect(error).toBeInstanceOf(UniqueViolation);
		const columns = violatedColumns(error, users);
		expect(columns).toEqual(['email']);
		expectTypeOf(columns).toEqualTypeOf<
			('id' | 'email' | 'orgId' | 'nickname')[] | undefined
		>();
	});

	it('maps several columns, and columns declared under their own name', () => {
		const error = violation({
			C: '23505',
			t: 'users',
			D: 'Key (org_id, nickname)=(1, ada) already exists.',
		});
		expect(violatedColumns(error, users)).toEqual(['orgId', 'nickname']);
	});

	it('maps the column field of a not-null violation', () => {
		const error = violation({ C: '23502', t: 'users', c: 'org_id' });
		expect(violatedColumns(error, users)).toEqual(['orgId']);
	});

	it('is undefined for another table, or columns the table does not have', () => {
		const other = violation({
			C: '23505',
			t: 'orgs',
			D: 'Key (email_address)=(x) already exists.',
		});
		expect(violatedColumns(other, users)).toBeUndefined();
		const expression = violation({
			C: '23505',
			t: 'users',
			D: 'Key (lower(email_address))=(x) already exists.',
		});
		expect(violatedColumns(expression, users)).toBeUndefined();
	});

	it('is undefined when the error names no columns', () => {
		const check = violation({ C: '23514', t: 'users', n: 'users_email_check' });
		expect(violatedColumns(check, users)).toBeUndefined();
	});

	it('matches an aliased table by its name in the database', () => {
		const error = violation({ C: '23502', t: 'users', c: 'email_address' });
		expect(violatedColumns(error, users.as('u'))).toEqual(['email']);
	});
});
