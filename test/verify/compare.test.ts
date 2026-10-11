import { describe, expect, test } from 'vitest';
import {
	array,
	bigint,
	decimal,
	integer,
	text,
	timestamptz,
	tsvector,
	varchar,
	vector,
} from '../../src/column-factories.js';
import { defineEnum } from '../../src/define-enum.js';
import { defineTable } from '../../src/define-table.js';
import type { AnyTable } from '../../src/table.js';
import {
	type CatalogColumn,
	type CatalogRelation,
	catalogQuery,
	parseCatalogRows,
	textArrayLiteral,
} from '../../src/verify/catalog.js';
import { compare } from '../../src/verify/compare.js';
import { quoteIdentifier } from '../../src/verify/sql.js';
import {
	catalogType,
	codeType,
	decodeTypmod,
	renderType,
	sameType,
	type SqlType,
} from '../../src/verify/sql-type.js';
import { describeTables } from '../../src/verify/spec.js';

function type(name: string, extra: Partial<SqlType> = {}): SqlType {
	return { name, isEnum: false, modifiers: undefined, array: false, ...extra };
}

function column(
	name: string,
	sqlType: SqlType,
	extra: Partial<CatalogColumn> = {},
): CatalogColumn {
	return {
		name,
		type: sqlType,
		declared: renderType(sqlType),
		domain: undefined,
		notNull: true,
		identity: undefined,
		generated: undefined,
		expression: undefined,
		enumLabels: undefined,
		...extra,
	};
}

function relation(
	name: string,
	columns: CatalogColumn[],
	kind: CatalogRelation['kind'] = 'table',
): CatalogRelation {
	return { schema: 'public', name, kind, relkind: 'r', columns };
}

function run(
	table: AnyTable,
	columns: CatalogColumn[] | undefined,
	options: { strict?: boolean; schema?: string } = {},
) {
	const specs = describeTables([table]);
	return compare(
		specs,
		[columns && relation(table._quarry.source, columns)],
		options,
	);
}

/** `[severity, code, column]` of each diagnostic. */
function codes(result: ReturnType<typeof compare>) {
	return result.diagnostics.map((d) => [d.severity, d.code, d.column]);
}

describe('types', () => {
	test('code types use DDL names and normalise numeric(p)', () => {
		expect(renderType(codeType(integer()._quarry.dataType))).toBe('integer');
		expect(renderType(codeType(decimal()._quarry.dataType))).toBe('numeric');
		expect(renderType(codeType(decimal(10)._quarry.dataType))).toBe(
			'numeric(10,0)',
		);
		expect(renderType(codeType(decimal(10, 2)._quarry.dataType))).toBe(
			'numeric(10,2)',
		);
		expect(renderType(codeType(varchar(32)._quarry.dataType))).toBe(
			'varchar(32)',
		);
		expect(renderType(codeType(array(varchar(8))._quarry.dataType))).toBe(
			'varchar(8)[]',
		);
		const mood = defineEnum('Mood', ['happy']);
		expect(renderType(codeType(array(mood())._quarry.dataType))).toBe(
			'"Mood"[]',
		);
	});

	test('typmods decode as format_type prints them', () => {
		expect(decodeTypmod('varchar', 259)).toEqual([255]);
		expect(decodeTypmod('varchar', -1)).toBeUndefined();
		expect(decodeTypmod('numeric', ((10 << 16) | 2) + 4)).toEqual([10, 2]);
		// numeric(5, -2), postgres 15 and later
		expect(decodeTypmod('numeric', ((5 << 16) | (-2 & 0x7ff)) + 4)).toEqual([
			5, -2,
		]);
		expect(decodeTypmod('timestamptz', 3)).toEqual([3]);
		expect(decodeTypmod('timestamptz', -1)).toBeUndefined();
		expect(decodeTypmod('vector', 1536)).toEqual([1536]);
		expect(decodeTypmod('text', 10)).toBeUndefined();
	});

	test('catalog types map pg_catalog names and keep others formatted', () => {
		const base = {
			schema: 'pg_catalog',
			isEnum: false,
			array: false,
			typmod: -1,
		};
		expect(
			catalogType({ ...base, typname: 'int4', formatted: 'integer' }).name,
		).toBe('integer');
		expect(
			catalogType({
				...base,
				typname: 'float8',
				formatted: 'double precision',
			}).name,
		).toBe('double precision');
		expect(
			catalogType({
				...base,
				typname: 'varchar',
				formatted: 'character varying',
				typmod: 36,
			}),
		).toEqual(type('varchar', { modifiers: [32] }));
		expect(
			catalogType({
				...base,
				typname: 'macaddr',
				formatted: 'macaddr',
			}).name,
		).toBe('macaddr');
		expect(
			catalogType({
				...base,
				schema: 'extensions',
				typname: 'vector',
				formatted: 'extensions.vector',
				typmod: 3,
			}),
		).toEqual(type('vector', { modifiers: [3] }));
		expect(
			catalogType({
				...base,
				schema: 'app',
				typname: 'citext',
				formatted: 'app.citext',
			}).name,
		).toBe('app.citext');
	});

	test('modifiers the code leaves out match any', () => {
		const code = codeType(varchar()._quarry.dataType);
		expect(sameType(code, type('varchar', { modifiers: [320] }))).toBe(true);
		expect(
			sameType(
				codeType(varchar(255)._quarry.dataType),
				type('varchar', { modifiers: [320] }),
			),
		).toBe(false);
		expect(
			sameType(codeType(varchar(255)._quarry.dataType), type('varchar')),
		).toBe(false);
		expect(
			sameType(
				codeType(vector()._quarry.dataType),
				type('vector', { modifiers: [3] }),
			),
		).toBe(true);
		expect(sameType(type('text', { array: true }), type('text'))).toBe(false);
		expect(sameType(type('status', { isEnum: true }), type('status'))).toBe(
			false,
		);
	});

	test('identifiers are quoted only where needed', () => {
		expect(quoteIdentifier('users')).toBe('users');
		expect(quoteIdentifier('user')).toBe('"user"');
		expect(quoteIdentifier('order')).toBe('"order"');
		expect(quoteIdentifier('UserAccounts')).toBe('"UserAccounts"');
		expect(quoteIdentifier('first name')).toBe('"first name"');
		expect(quoteIdentifier('a"b')).toBe('"a""b"');
		expect(quoteIdentifier('_x$1')).toBe('_x$1');
	});
});

describe('catalog', () => {
	test('table names are a text[] literal of quoted identifiers', () => {
		expect(textArrayLiteral(['a', 'b c', 'd"e', 'f\\g', ''])).toBe(
			String.raw`{"a","b c","d\"e","f\\g",""}`,
		);
		expect(catalogQuery(['users', 'My"T'], undefined).params).toEqual([
			String.raw`{"\"users\"","\"My\"\"T\""}`,
		]);
		expect(catalogQuery(['users'], 'app').params).toEqual([
			String.raw`{"\"app\".\"users\""}`,
		]);
		expect(catalogQuery(['users'], undefined).tag).toBe('quarry:verify');
	});

	test('rows parse the same whether the driver parsed values or returned text', () => {
		const parsed = {
			tableindex: 1,
			schemaname: 'public',
			relname: 'users',
			relkind: 'r',
			colname: 'id',
			declared: 'integer',
			domainname: null,
			notnull: true,
			identity: 'a',
			generated: '',
			expression: null,
			isarray: false,
			typname: 'int4',
			typschema: 'pg_catalog',
			formatted: 'integer',
			isenum: false,
			typmod: -1,
			enumlabels: null,
		};
		const asText = Object.fromEntries(
			Object.entries(parsed).map(([key, value]) => [
				key,
				typeof value === 'boolean'
					? value
						? 't'
						: 'f'
					: value === null
						? null
						: String(value),
			]),
		);
		const missing = { tableindex: 2, relname: null, colname: null };
		const expected = parseCatalogRows([parsed, missing], 2);
		expect(parseCatalogRows([asText, missing], 2)).toEqual(expected);
		expect(expected).toEqual([
			{
				schema: 'public',
				name: 'users',
				kind: 'table',
				relkind: 'r',
				columns: [column('id', type('integer'), { identity: 'always' })],
			},
			undefined,
		]);
	});

	test('enum labels arrive as JSON text', () => {
		const [users] = parseCatalogRows(
			[
				{
					tableindex: 1,
					schemaname: 'public',
					relname: 'users',
					relkind: 'p',
					colname: 'mood',
					isenum: true,
					typname: 'mood',
					typschema: 'public',
					formatted: 'mood',
					typmod: '-1',
					enumlabels: '["a, b","c\\"d"]',
				},
			],
			1,
		);
		expect(users?.kind).toBe('partitioned table');
		expect(users?.columns[0]?.enumLabels).toEqual(['a, b', 'c"d']);
	});
});

describe('compare', () => {
	const status = defineEnum('status', ['active', 'archived']);
	const users = defineTable('users', {
		columns: {
			id: integer().identity(),
			email: varchar(255),
			bio: text().nullable(),
			status: status().default(),
			createdAt: timestamptz().name('created_at').default(),
		},
	});
	const matching = () => [
		column('id', type('integer'), { identity: 'always' }),
		column('email', type('varchar', { modifiers: [255] })),
		column('bio', type('text'), { notNull: false }),
		column('status', type('status', { isEnum: true }), {
			expression: "'active'::status",
			enumLabels: ['active', 'archived'],
		}),
		column('created_at', type('timestamptz', { modifiers: [3] }), {
			expression: 'now()',
		}),
	];

	test('a matching table has no diagnostics', () => {
		const result = run(users, matching());
		expect(result.diagnostics).toEqual([]);
		expect(result.columns).toBe(5);
		expect(result.tables[0]).toMatchObject({
			name: 'users',
			relation: 'public.users',
			kind: 'table',
			status: 'ok',
		});
	});

	test('a missing table suggests create table', () => {
		const result = run(users, undefined);
		expect(codes(result)).toEqual([['error', 'table-missing', undefined]]);
		expect(result.diagnostics[0]?.fix).toBe(
			[
				'create table users (',
				'  id integer generated always as identity,',
				'  email varchar(255) not null,',
				'  bio text,',
				'  status status not null default <expression>,',
				'  created_at timestamptz not null default <expression>',
				');',
			].join('\n'),
		);
		expect(result.tables[0]?.columns.map((c) => c.status)).toEqual(
			Array(5).fill('error'),
		);
	});

	test('a relation that is not a table or view is missing', () => {
		const specs = describeTables([users]);
		const result = compare(specs, [
			{
				schema: 'public',
				name: 'users',
				kind: undefined,
				relkind: 'S',
				columns: [],
			},
		]);
		expect(result.diagnostics[0]?.message).toBe(
			"users is not a table or view in the database (relkind 'S')",
		);
	});

	test('missing columns and type mismatches', () => {
		const [, , ...rest] = matching();
		const result = run(users, [
			column('id', type('bigint'), { identity: 'always' }),
			...rest,
		]);
		expect(codes(result)).toEqual([
			['error', 'column-type-mismatch', 'id'],
			['error', 'column-missing', 'email'],
		]);
		expect(result.diagnostics[0]).toMatchObject({
			message: 'users.id is bigint in the database, but integer in the code',
			expected: 'integer',
			actual: 'bigint',
			label: 'found bigint',
			hint: 'or declare it as bigint()',
			fix: 'alter table users alter column id type integer using id::integer;',
		});
		expect(result.diagnostics[1]?.fix).toBe(
			'alter table users add column email varchar(255) not null;',
		);
	});

	test('modifiers, arrays, enums and domains', () => {
		const table = defineTable('t', {
			columns: {
				a: varchar(32),
				b: decimal(10, 2),
				c: array(text()),
				d: text(),
				e: status(),
				f: text(),
			},
		});
		const result = run(table, [
			column('a', type('varchar', { modifiers: [64] })),
			column('b', type('numeric', { modifiers: [12, 2] })),
			column('c', type('text')),
			column('d', type('text'), { domain: 'email', declared: 'email' }),
			column('e', type('mood', { isEnum: true }), { enumLabels: ['x'] }),
			column('f', type('text', { array: true })),
		]);
		expect(
			result.diagnostics.map((d) => [d.column, d.expected, d.actual, d.hint]),
		).toEqual([
			['a', 'varchar(32)', 'varchar(64)', 'or declare it as varchar(64)'],
			[
				'b',
				'numeric(10,2)',
				'numeric(12,2)',
				'or declare it as decimal(12, 2)',
			],
			['c', 'text[]', 'text', 'or declare it as text()'],
			['e', 'status', 'mood', undefined],
			['f', 'text', 'text[]', 'or declare it as array(text())'],
		]);
	});

	test('a domain over another type names the domain', () => {
		const table = defineTable('t', { columns: { a: integer() } });
		const result = run(table, [
			column('a', type('text'), { domain: 'email', declared: 'email' }),
		]);
		expect(result.diagnostics[0]?.actual).toBe('text (domain email)');
	});

	test('nullability in both directions', () => {
		const table = defineTable('t', {
			columns: { a: text(), b: text().nullable() },
		});
		const result = run(table, [
			column('a', type('text'), { notNull: false }),
			column('b', type('text')),
		]);
		expect(codes(result)).toEqual([
			['error', 'column-nullable-mismatch', 'a'],
			['warning', 'column-not-null-mismatch', 'b'],
		]);
		expect(result.diagnostics.map((d) => d.fix)).toEqual([
			'alter table t alter column a set not null;',
			'alter table t alter column b drop not null;',
		]);
	});

	test('views are checked for types only', () => {
		const table = defineTable('v', {
			columns: { a: text(), b: integer().identity(), c: integer() },
		});
		const specs = describeTables([table]);
		const result = compare(specs, [
			relation(
				'v',
				[
					column('a', type('text'), { notNull: false }),
					column('b', type('integer'), { notNull: false }),
					column('c', type('bigint'), { notNull: false }),
				],
				'view',
			),
		]);
		expect(codes(result)).toEqual([['error', 'column-type-mismatch', 'c']]);
	});

	test('defaults, identities and generated columns', () => {
		const table = defineTable('t', {
			columns: {
				defaultMissing: text().default(),
				defaultUndeclared: text(),
				defaultOnGenerated: text().default(),
				identityMissing: integer().identity(),
				identityAsSerial: integer().identity(),
				identityAlways: integer(),
				identityAlwaysWithDefault: integer().default(),
				identityByDefault: integer(),
				identityByDefaultDeclared: integer().default(),
				generatedMissing: tsvector().generated(),
				generatedMissingNullable: tsvector().nullable().generated(),
				generatedUndeclared: tsvector(),
				generatedOnIdentity: integer().generated(),
			},
		});
		const c = (name: string, extra: Partial<CatalogColumn> = {}) =>
			column(
				name,
				type(
					name.startsWith('generated') && name !== 'generatedOnIdentity'
						? 'tsvector'
						: name.startsWith('identity') || name === 'generatedOnIdentity'
							? 'integer'
							: 'text',
				),
				extra,
			);
		const result = run(table, [
			c('defaultMissing'),
			c('defaultUndeclared', { expression: "''::text" }),
			c('defaultOnGenerated', { generated: 'stored', expression: 'x' }),
			c('identityMissing'),
			c('identityAsSerial', { expression: "nextval('t_seq'::regclass)" }),
			c('identityAlways', { identity: 'always' }),
			c('identityAlwaysWithDefault', { identity: 'always' }),
			c('identityByDefault', { identity: 'by default' }),
			c('identityByDefaultDeclared', { identity: 'by default' }),
			c('generatedMissing'),
			c('generatedMissingNullable', { notNull: false }),
			c('generatedUndeclared', { generated: 'virtual', expression: 'x' }),
			c('generatedOnIdentity', { identity: 'always' }),
		]);
		expect(codes(result)).toEqual([
			['error', 'column-default-missing', 'defaultMissing'],
			['info', 'column-default-undeclared', 'defaultUndeclared'],
			['error', 'column-generated-undeclared', 'defaultOnGenerated'],
			['error', 'column-identity-missing', 'identityMissing'],
			['warning', 'column-identity-missing', 'identityAsSerial'],
			['error', 'column-identity-undeclared', 'identityAlways'],
			['error', 'column-identity-undeclared', 'identityAlwaysWithDefault'],
			['info', 'column-default-undeclared', 'identityByDefault'],
			['error', 'column-generated-missing', 'generatedMissing'],
			['warning', 'column-generated-missing', 'generatedMissingNullable'],
			['error', 'column-generated-undeclared', 'generatedUndeclared'],
		]);
		const byColumn = new Map(result.diagnostics.map((d) => [d.column, d]));
		expect(byColumn.get('identityMissing')?.fix).toBe(
			'alter table t alter column "identityMissing" add generated always as identity;',
		);
		expect(byColumn.get('identityByDefault')?.hint).toBe(
			'declare it .identity() or .default()',
		);
		expect(byColumn.get('defaultUndeclared')?.actual).toBe("default ''::text");
	});

	test('enum labels are compared once per enum', () => {
		const table = defineTable('t', {
			columns: { a: status(), b: array(status()) },
		});
		const labels = ['active', 'banned'];
		const result = run(table, [
			column('a', type('status', { isEnum: true }), { enumLabels: labels }),
			column('b', type('status', { isEnum: true, array: true }), {
				enumLabels: labels,
			}),
		]);
		expect(codes(result)).toEqual([['error', 'enum-label-mismatch', 'a']]);
		expect(result.diagnostics[0]).toMatchObject({
			message:
				"enum status differs: the database lacks 'archived'; the code lacks 'banned'",
			fix: "alter type status add value 'archived' after 'active';",
			hint: "add 'banned' to defineEnum('status', ...); postgres can't drop enum labels",
		});
	});

	test('enum labels in another order are a warning', () => {
		const table = defineTable('t', { columns: { a: status() } });
		const result = run(table, [
			column('a', type('status', { isEnum: true }), {
				enumLabels: ['archived', 'active'],
			}),
		]);
		expect(codes(result)).toEqual([['warning', 'enum-label-order', 'a']]);
	});

	test('extra columns are informational, or errors with strict', () => {
		const table = defineTable('t', { columns: { a: text() } });
		const columns = [
			column('a', type('text')),
			column('legacy_code', type('varchar', { modifiers: [8] }), {
				notNull: false,
			}),
			column('required_flag', type('boolean')),
			column('updated_at', type('timestamptz'), { expression: 'now()' }),
		];
		expect(codes(run(table, columns))).toEqual([
			['info', 'column-extra', 'legacy_code'],
			['warning', 'column-extra', 'required_flag'],
			['info', 'column-extra', 'updated_at'],
		]);
		const strict = run(table, columns, { strict: true });
		expect(codes(strict).map(([severity]) => severity)).toEqual([
			'error',
			'error',
			'error',
		]);
		expect(strict.diagnostics.map((d) => [d.hint, d.fix])).toEqual([
			[
				"declare it: legacyCode: varchar(8).name('legacy_code').nullable()",
				'alter table t drop column legacy_code;',
			],
			[
				"declare it: requiredFlag: boolean().name('required_flag')",
				'alter table t drop column required_flag;',
			],
			[
				"declare it: updatedAt: timestamptz().name('updated_at').default()",
				'alter table t drop column updated_at;',
			],
		]);
		expect(run(table, columns).tables[0]?.columns.map((c) => c.status)).toEqual(
			['ok', 'info', 'warning', 'info'],
		);
	});

	test('suggested SQL is qualified with the schema option', () => {
		const table = defineTable('t', { columns: { a: text() } });
		const result = run(table, [column('a', type('text'), { notNull: false })], {
			schema: 'App',
		});
		expect(result.diagnostics[0]?.fix).toBe(
			'alter table "App".t alter column a set not null;',
		);
	});

	test('aliases and duplicates are checked once, by source name', () => {
		const specs = describeTables([users, users.as('u'), users]);
		expect(specs.map((spec) => spec.name)).toEqual(['users']);
	});

	test('a numeric(p) column matches decimal(p)', () => {
		const table = defineTable('t', {
			columns: { a: decimal(10), b: bigint() },
		});
		const result = run(table, [
			column('a', type('numeric', { modifiers: [10, 0] })),
			column('b', type('bigint')),
		]);
		expect(result.diagnostics).toEqual([]);
	});
});
