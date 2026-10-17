import { describe, expect, it } from 'vitest';
import { integer, jsonb, text } from '../src/column-factories.js';
import {
	compile,
	queryInfo,
	redactedParams,
	redactedQuery,
} from '../src/compile.js';
import { databaseWith } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import { DecodeError, UniqueViolation } from '../src/driver/errors.js';
import { NoRowError } from '../src/executor.js';
import { insertInto } from '../src/insert-query-builder.js';
import { redactDetail, redactError } from '../src/redact.js';
import { selectFrom } from '../src/select-query-builder.js';
import { update, updateMany } from '../src/update-query-builder.js';
import { executorFrom } from './helpers/executor.js';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		name: text(),
		email: text().sensitive(),
		password: text().name('password_hash').sensitive().default(),
		secrets: jsonb().nullable().default().sensitive(),
	},
});

const sensitiveOf = (query: ReturnType<typeof compile>) =>
	queryInfo(query)?.params.map((p) => p.sensitive);

describe('sensitive()', () => {
	it('is kept by every modifier and leaves the column otherwise unchanged', () => {
		const column = text().sensitive();
		expect(column._quarry.sensitive).toBe(true);
		expect(column.nullable()._quarry.sensitive).toBe(true);
		expect(column.default().name('x')._quarry.sensitive).toBe(true);
		expect(integer().identity().sensitive()._quarry.sensitive).toBe(true);
		expect(text()._quarry.sensitive).toBe(false);
	});

	it('marks values compared with a sensitive column, whatever wraps it', () => {
		const query = compile(
			selectFrom(users)
				.where('users.name', 'Ada')
				.where('users.email', 'ada@example.com')
				.where((eb) => eb.fn.lower('users.email').like('%@example.com'))
				.where((eb) => eb.ref('users.email').in(['a', 'b']))
				.where((eb) => eb.ref('users.email').in(eb.val(['c'])))
				.where((eb) => eb.json.hasKey('users.secrets', 'pin'))
				.toNode(),
		);
		expect(query.params).toEqual([
			'Ada',
			'ada@example.com',
			'%@example.com',
			'a',
			'b',
			['c'],
			'pin',
		]);
		expect(sensitiveOf(query)).toEqual([
			false,
			true,
			true,
			true,
			true,
			true,
			true,
		]);
		expect(redactedParams(query)).toEqual([
			'Ada',
			'[redacted]',
			'[redacted]',
			'[redacted]',
			'[redacted]',
			'[redacted]',
			'[redacted]',
		]);
	});

	it('marks inserted, updated, upserted and updateMany values', () => {
		const insert = compile(
			insertInto(users)
				.values({ name: 'Ada', email: 'a@x', password: 'h' })
				.onConflict(['email'])
				.doUpdate((ex) => ({ password: ex.password, name: 'Ada L' }))
				.toNode(),
		);
		expect(redactedParams(insert)).toEqual([
			'Ada',
			'[redacted]',
			'[redacted]',
			'Ada L',
		]);
		const rows = compile(
			insertInto(users)
				.values([
					{ name: 'a', email: 'a@x' },
					{ name: 'b', email: 'b@x' },
				])
				.toNode(),
		);
		expect(redactedParams(rows)).toEqual([['a', 'b'], '[redacted]']);
		const set = compile(
			update(users).set({ password: 'h2' }).where('users.id', 1).toNode(),
		);
		expect(redactedParams(set)).toEqual(['[redacted]', 1]);
		const many = compile(
			updateMany(
				users,
				[
					{ id: 1, email: 'a@x' },
					{ id: 2, email: 'b@x' },
				],
				{ by: ['id'] },
			).toNode(),
		);
		expect(redactedParams(many)).toEqual([[1, 2], '[redacted]']);
	});

	it('sends the real values', () => {
		const query = compile(
			update(users)
				.set({ password: 'h2' })
				.where('users.email', 'a@x')
				.toNode(),
		);
		expect(query.params).toEqual(['h2', 'a@x']);
		expect(redactedQuery(query)).toEqual({
			sql: query.sql,
			params: ['[redacted]', '[redacted]'],
		});
	});

	it('records the result columns and table columns that are sensitive', () => {
		const query = compile(
			selectFrom(users)
				.select((eb) => [
					'users.id',
					'users.password',
					eb.fn.lower('users.email').as('lowerEmail'),
				])
				.toNode(),
		);
		const info = queryInfo(query);
		expect([...(info?.sensitiveFields ?? [])]).toEqual([
			'password',
			'lowerEmail',
		]);
		expect([...(info?.sensitiveColumns.get('users') ?? [])]).toEqual([
			'email',
			'password_hash',
			'secrets',
		]);
	});

	it("redacts the query of quarry's errors", async () => {
		const db = databaseWith(executorFrom(async () => ({ rows: [] })));
		const error = await db
			.selectFrom(users)
			.select(['users.id'])
			.where('users.email', 'ada@example.com')
			.expectOne()
			.execute()
			.catch((e: unknown) => e);
		if (!(error instanceof NoRowError)) throw error;
		expect(error.query.params).toEqual(['[redacted]']);
		expect(JSON.stringify(error)).not.toContain('ada@example.com');
	});
});

describe('redactDetail', () => {
	const sensitive = new Set(['email', 'ssn']);

	it('redacts the key of unique, foreign-key and exclusion violations', () => {
		expect(
			redactDetail('Key (email)=(ada@example.com) already exists.', sensitive),
		).toBe('Key (email)=([redacted]) already exists.');
		expect(
			redactDetail(
				'Key (tenant, email)=(1, a) b@x) already exists.',
				sensitive,
			),
		).toBe('Key (tenant, email)=([redacted]) already exists.');
		expect(
			redactDetail(
				'Key (ssn)=(123) is not present in table "people".',
				sensitive,
			),
		).toBe('Key (ssn)=([redacted]) is not present in table "people".');
		expect(
			redactDetail(
				'Key (ssn)=(123) is still referenced from table "orders".',
				sensitive,
			),
		).toBe('Key (ssn)=([redacted]) is still referenced from table "orders".');
		expect(
			redactDetail(
				'Key (ssn)=(1) conflicts with existing key (ssn)=(2).',
				sensitive,
			),
		).toBe(
			'Key (ssn)=([redacted]) conflicts with existing key (ssn)=([redacted]).',
		);
		expect(redactDetail('Key ("email")=(x) already exists.', sensitive)).toBe(
			'Key ("email")=([redacted]) already exists.',
		);
	});

	it('redacts a failing row, which lists every column', () => {
		expect(
			redactDetail(
				'Failing row contains (1, null, ada@example.com).',
				sensitive,
			),
		).toBe('Failing row contains ([redacted]).');
	});

	it('leaves details about other columns alone', () => {
		expect(
			redactDetail('Key (name)=(Ada) already exists.', sensitive),
		).toBeUndefined();
		expect(
			redactDetail('Failing row contains (1).', new Set()),
		).toBeUndefined();
	});
});

describe('redactError', () => {
	const query = compile(
		insertInto(users)
			.values({ name: 'Ada', email: 'ada@example.com' })
			.toNode(),
	);

	it('redacts a server error’s detail and message', () => {
		const error = new UniqueViolation({
			C: '23505',
			M: 'duplicate key value violates unique constraint "users_email_key"',
			D: 'Key (email)=(ada@example.com) already exists.',
			t: 'users',
		});
		redactError(error, query);
		expect(error.detail).toBe('Key (email)=([redacted]) already exists.');
		expect(error.fields['D']).toBe(error.detail);
		expect(error.columns).toEqual(['email']);
		const syntax = new UniqueViolation({
			C: '22P02',
			M: 'invalid input syntax for type uuid: "ada@example.com"',
		});
		redactError(syntax, query);
		expect(syntax.message).toBe(
			'invalid input syntax for type uuid: "[redacted]"',
		);
		expect(syntax.stack).not.toContain('ada@example.com');
	});

	it('leaves errors of queries without sensitive values alone', () => {
		const plain = compile(
			selectFrom(users).where('users.name', 'Ada').toNode(),
		);
		const error = new UniqueViolation({
			C: '23505',
			M: 'duplicate',
			D: 'Key (name)=(Ada) already exists.',
		});
		redactError(error, plain);
		expect(error.detail).toBe('Key (name)=(Ada) already exists.');
	});

	it('redacts a decode error on a sensitive result column', () => {
		const select = compile(
			selectFrom(users).select(['users.id', 'users.secrets']).toNode(),
		);
		const cause = new SyntaxError('Unexpected token in JSON: {"pin":12');
		const secret = new DecodeError('secrets', 3802, cause);
		redactError(secret, select);
		expect(secret.message).toBe(
			'Could not decode a value of column "secrets" (type OID 3802)',
		);
		expect(secret.cause).toBeUndefined();
		const other = new DecodeError('id', 23, cause);
		redactError(other, select);
		expect(other.cause).toBe(cause);
	});
});
