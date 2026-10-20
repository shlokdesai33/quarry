import { describe, expect, it } from 'vitest';
import { compile, identifier, isDataStatement } from '../src/compile.js';
import { integer, text } from '../src/column-factories.js';
import { databaseWith } from '../src/database.js';
import { defineTable } from '../src/define-table.js';
import type { Executor } from '../src/executor.js';
import { allSelections, expressionBuilder } from '../src/expression-builder.js';
import { insertInto } from '../src/insert-query-builder.js';
import { selectFrom } from '../src/select-query-builder.js';
import { sql } from '../src/sql.js';
import { update } from '../src/update-query-builder.js';

const users = defineTable('users', {
	columns: {
		id: integer(),
		firstName: text().name('first_name'),
		email: text().nullable(),
	},
});

/** Another table of the same name, whose columns are named differently. */
const legacyUsers = defineTable('users', {
	columns: {
		id: integer().name('user_id'),
		firstName: text().name('given_name'),
	},
});

const quoted = defineTable('we"ird', {
	columns: { id: integer().name('i"d') },
});

// eslint-disable-next-line typescript/no-unsafe-type-assertion -- a key left out, as a plain JS caller can
const missing = undefined as never;

const byIdOf = (table: typeof users | typeof legacyUsers) =>
	selectFrom(table)
		.where('users.id', 1)
		.select(['users.id', 'users.firstName'])
		.toSQL().sql;

describe('what the builders reuse across queries', () => {
	it('renders the same SQL each time, with fresh parameters', () => {
		const byId = (id: number) =>
			selectFrom(users)
				.where('users.id', id)
				.select(['users.id', 'users.firstName'])
				.toSQL();
		for (const id of [1, 2, 3]) {
			expect(byId(id)).toMatchObject({
				sql: 'select "users"."id" as "id", "users"."first_name" as "firstName" from "users" where "users"."id" = $1',
				params: [id],
			});
		}
	});

	it('keeps tables of the same name apart, aliased ones too', () => {
		expect(byIdOf(users)).toBe(
			'select "users"."id" as "id", "users"."first_name" as "firstName" from "users" where "users"."id" = $1',
		);
		expect(byIdOf(legacyUsers)).toBe(
			'select "users"."user_id" as "id", "users"."given_name" as "firstName" from "users" where "users"."user_id" = $1',
		);
		const managers = users.as('managers');
		expect(
			selectFrom(users)
				.innerJoin(managers)
				.on('managers.id', 'users.id')
				.select(['users.firstName'])
				.select((eb) => [eb.ref('managers.firstName').as('manager')])
				.toSQL().sql,
		).toBe(
			'select "users"."first_name" as "firstName", "managers"."first_name" as "manager" from "users" inner join "users" as "managers" on "managers"."id" = "users"."id"',
		);
	});

	it('escapes quotes in identifiers, however many names it has seen', () => {
		for (let i = 0; i < 5000; i++) expect(identifier(`c${i}`)).toBe(`"c${i}"`);
		expect(
			selectFrom(quoted).where('we"ird.id', 1).select(['we"ird.id']).toSQL()
				.sql,
		).toBe(
			'select "we""ird"."i""d" as "id" from "we""ird" where "we""ird"."i""d" = $1',
		);
	});

	it('shares a scope of one table, and still rejects unknown columns', () => {
		expect(expressionBuilder(users)).toBe(expressionBuilder(users));
		expect(Object.isFrozen(expressionBuilder(users))).toBe(true);
		expect(expressionBuilder(users)).not.toBe(expressionBuilder(legacyUsers));
		const { ref } = expressionBuilder(users);
		// @ts-expect-error -- not a column of users
		expect(() => ref('users.nope')).toThrow(
			'Unknown column reference "users.nope"',
		);
		// @ts-expect-error -- nor is what its columns object inherits
		expect(() => ref('users.toString')).toThrow(
			'Unknown column reference "users.toString"',
		);
	});

	it('still rejects a key selected twice', () => {
		expect(() =>
			selectFrom(users)
				.select(['users.id'])
				// @ts-expect-error -- the type error the runtime check backs up
				.select(['users.id']),
		).toThrow('select each key once: "id" is already in the row');
		expect(() =>
			// @ts-expect-error -- id twice in one list
			selectFrom(users).select(['users.id', 'users.email', 'users.id']),
		).toThrow('select each key once: "id" is already in the row');
	});

	it('keeps a column set again in its place, with the new value', () => {
		expect(
			update(users)
				.set({ email: 'a', firstName: 'b' })
				.set({ id: 3, email: 'c' })
				.where('users.id', 1)
				.toSQL(),
		).toMatchObject({
			sql: 'update "users" set "email" = $1, "first_name" = $2, "id" = $3 where "users"."id" = $4',
			params: ['c', 'b', 3, 1],
		});
	});

	it('aligns rows given with their keys in any order, defaulting the ones left out', () => {
		expect(
			insertInto(users)
				.values([
					{ id: 1, firstName: 'a', email: missing },
					{ firstName: 'b', email: 'x', id: 2 },
					{ id: 3, firstName: 'c', email: missing },
				])
				.toSQL(),
		).toMatchObject({
			sql: 'insert into "users" ("id", "first_name", "email") values ($1, $2, default), ($3, $4, $5), ($6, $7, default)',
			params: [1, 'a', 2, 'b', 'x', 3, 'c'],
		});
	});

	it('renders each shape right when shapes that share a start interleave', () => {
		const shapes = [
			(i: number) => selectFrom(users).where('users.id', i).selectAll('users'),
			(i: number) =>
				selectFrom(users).where('users.email', `e${i}`).selectAll('users'),
			(i: number) =>
				selectFrom(users).where('users.id', i).selectAll('users').limit(1),
			(i: number) => selectFrom(users).selectAll('users').where('users.id', i),
			(i: number) =>
				selectFrom(legacyUsers).where('users.id', i).selectAll('users'),
		];
		const expected = [
			'select "users"."id" as "id", "users"."first_name" as "firstName", "users"."email" as "email" from "users" where "users"."id" = $1',
			'select "users"."id" as "id", "users"."first_name" as "firstName", "users"."email" as "email" from "users" where "users"."email" = $1',
			'select "users"."id" as "id", "users"."first_name" as "firstName", "users"."email" as "email" from "users" where "users"."id" = $1 limit $2',
			'select "users"."id" as "id", "users"."first_name" as "firstName", "users"."email" as "email" from "users" where "users"."id" = $1',
			'select "users"."user_id" as "id", "users"."given_name" as "firstName" from "users" where "users"."user_id" = $1',
		];
		for (let round = 0; round < 3; round++) {
			shapes.forEach((shape, i) => {
				expect(shape(round).toSQL().sql).toBe(expected[i]);
			});
		}
	});

	it('writes out a query past the bounds of the rendered-SQL trie', () => {
		const rows = Array.from({ length: 400 }, (_, i) => ({
			id: i,
			firstName: `n${i}`,
			email: i % 2 === 0 ? missing : 'x',
		}));
		let n = 0;
		const values = rows
			.map(
				(row) =>
					`($${++n}, $${++n}, ${row.email === undefined ? 'default' : `$${++n}`})`,
			)
			.join(', ');
		const insert = `insert into "users" ("id", "first_name", "email") values ${values}`;
		const long = 'x'.repeat(5000);
		const literal = `select "users"."id" as "id" from "users" where "users"."first_name" = '${long}' and "users"."id" = $1`;
		for (let round = 0; round < 2; round++) {
			expect(insertInto(users).values(rows).toSQL().sql).toBe(insert);
			expect(
				selectFrom(users)
					.where((eb) =>
						eb.and([
							sql<boolean>`${eb.ref('users.firstName')} = ${sql.lit(long)}`,
							eb.ref('users.id').eq(1),
						]),
					)
					.select(['users.id'])
					.toSQL().sql,
			).toBe(literal.replace('where ', 'where (').concat(')'));
		}
	});

	it('shares one frozen list of every column per table, still checking keys', () => {
		expect(allSelections(users)).toBe(allSelections(users));
		expect(Object.isFrozen(allSelections(users))).toBe(true);
		expect(allSelections(users).map((s) => s.alias)).toEqual([
			'id',
			'firstName',
			'email',
		]);
		const both = selectFrom(users)
			.innerJoin(legacyUsers.as('legacy'))
			.on('legacy.id', 'users.id')
			.selectAll('legacy')
			.toSQL();
		expect(both.sql).toBe(
			'select "legacy"."user_id" as "id", "legacy"."given_name" as "firstName" from "users" inner join "users" as "legacy" on "legacy"."user_id" = "users"."id"',
		);
		expect(
			selectFrom(users)
				.innerJoin(legacyUsers.as('legacy'))
				.on('legacy.id', 'users.id')
				.select(['users.email'])
				.selectAll('legacy')
				.toSQL().sql,
		).toBe(
			'select "users"."email" as "email", "legacy"."user_id" as "id", "legacy"."given_name" as "firstName" from "users" inner join "users" as "legacy" on "legacy"."user_id" = "users"."id"',
		);
		expect(() =>
			selectFrom(users)
				.select(['users.id'])
				// @ts-expect-error -- id is already in the row
				.selectAll('users'),
		).toThrow('select each key once: "id" is already in the row');
		expect(() =>
			insertInto(users)
				.values({ id: 1, firstName: 'a', email: null })
				.returning(['users.email'])
				// @ts-expect-error -- email is already in the row
				.returningAll(),
		).toThrow('select each key once: "email" is already in the row');
		expect(
			update(users).set({ id: 2 }).where('users.id', 1).returningAll().toSQL()
				.sql,
		).toBe(
			'update "users" set "id" = $1 where "users"."id" = $2 returning "users"."id" as "id", "users"."first_name" as "firstName", "users"."email" as "email"',
		);
	});

	it('marks what it compiles from a select or a write, not SQL written by hand', () => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- never run
		const db = databaseWith({} as Executor);
		const select = selectFrom(users)
			.where('users.id', 1)
			.selectAll('users')
			.toSQL();
		expect(isDataStatement(select)).toBe(true);
		expect(
			isDataStatement(
				insertInto(users)
					.values({ id: 1, firstName: 'a', email: null })
					.toSQL(),
			),
		).toBe(true);
		expect(isDataStatement(db.sql`begin`.toSQL())).toBe(false);
		expect(isDataStatement(db.sql`select 1`.toSQL())).toBe(false);
		expect(isDataStatement({ ...select })).toBe(false);
		expect(
			isDataStatement(
				compile({ kind: 'raw', fragments: ['set x = 1'], nodes: [] }),
			),
		).toBe(false);
	});
});
