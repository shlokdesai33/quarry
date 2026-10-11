import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { CatalogColumn } from '../../src/verify/catalog.js';
import { compare } from '../../src/verify/compare.js';
import { findSpan } from '../../src/verify/render/code-frame.js';
import {
	type FormatOptions,
	formatVerifyReport,
} from '../../src/verify/render/format.js';
import { detectTerminal, wrap } from '../../src/verify/render/terminal.js';
import type { Diagnostic, VerifyReport } from '../../src/verify/report.js';
import { renderType, type SqlType } from '../../src/verify/sql-type.js';
import { describeTables } from '../../src/verify/spec.js';
import { schema } from './fixtures/schema.js';

const source = readFileSync(
	new URL('./fixtures/schema.ts', import.meta.url),
	'utf8',
);

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

/** The report for fixtures/drift.sql, with the schema at /project/src/schema.ts. */
function driftReport(): VerifyReport {
	const status = type('user_status', { isEnum: true });
	const { diagnostics, tables, columns } = compare(describeTables(schema), [
		{
			schema: 'public',
			name: 'users',
			kind: 'table',
			relkind: 'r',
			columns: [
				column('id', type('integer'), { identity: 'always' }),
				column('email', type('varchar', { modifiers: [320] })),
				column('display_name', type('text'), { notNull: false }),
				column('age', type('bigint'), { notNull: false }),
				column('status', status, {
					expression: "'active'::user_status",
					enumLabels: ['active', 'suspended', 'banned'],
				}),
				column('tags', type('text', { array: true }), {
					expression: "'{}'::text[]",
				}),
				column('created_at', type('timestamptz'), { notNull: false }),
				column('legacy_code', type('text')),
			],
		},
		{
			schema: 'public',
			name: 'orders',
			kind: 'table',
			relkind: 'r',
			columns: [
				column('id', type('bigint'), { identity: 'always' }),
				column('user_id', type('integer')),
				column('total', type('numeric', { modifiers: [12, 2] })),
				column('search', type('tsvector'), { notNull: false }),
			],
		},
		undefined,
	]);
	const moved = diagnostics.map((diagnostic) =>
		diagnostic.source
			? Object.assign({}, diagnostic, {
					source: { ...diagnostic.source, file: '/project/src/schema.ts' },
				})
			: diagnostic,
	);
	return summarise(moved, tables, columns);
}

function summarise(
	diagnostics: Diagnostic[],
	tables: VerifyReport['tables'],
	columns: number,
): VerifyReport {
	const count = (severity: string) =>
		diagnostics.filter((d) => d.severity === severity).length;
	return {
		ok: count('error') === 0,
		diagnostics,
		tables,
		summary: {
			errors: count('error'),
			warnings: count('warning'),
			infos: count('info'),
			tables: tables.length,
			columns,
			durationMs: 12.4,
		},
	};
}

function isAscii(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) > 127) return false;
	}
	return true;
}

const plain: FormatOptions = {
	color: false,
	unicode: true,
	hyperlinks: false,
	width: 100,
	cwd: '/project',
	root: '/project',
	read: (file) => (file === '/project/src/schema.ts' ? source : undefined),
};

describe('pretty', () => {
	test('without colour', () => {
		expect(formatVerifyReport(driftReport(), plain)).toMatchSnapshot();
	});

	test('with colour and links', () => {
		const out = formatVerifyReport(driftReport(), {
			...plain,
			color: true,
			hyperlinks: true,
		});
		expect(out).toContain('\u001B[31m×\u001B[39m');
		expect(out).toContain(
			'\u001B]8;;file:///project/src/schema.ts\u001B\\src/schema.ts:23:10\u001B]8;;\u001B\\',
		);
		expect(out).toMatchSnapshot();
	});

	test('in ASCII on a narrow terminal', () => {
		const out = formatVerifyReport(driftReport(), {
			...plain,
			unicode: false,
			width: 60,
		});
		expect(out).toSatisfy(isAscii);
		for (const line of out.split('\n')) {
			if (!line.includes('help:') && !line.startsWith('        ')) {
				expect(line.length, line).toBeLessThanOrEqual(60);
			}
		}
		expect(out).toMatchSnapshot();
	});

	test('a matching schema', () => {
		const report = summarise([], [], 0);
		expect(formatVerifyReport(report, plain)).toBe(
			'  ✔ schema matches the database · 0 tables, 0 columns checked in 12ms\n',
		);
	});

	test('notes and warnings only', () => {
		const report = summarise(
			[
				{
					severity: 'info',
					code: 'column-extra',
					message: 'column t.a is in the database but not in the code',
					table: 't',
					column: 'a',
				},
			],
			[],
			1,
		);
		expect(formatVerifyReport(report, plain)).toBe(
			[
				'  ℹ quarry(column-extra): column t.a is in the database but not in the code',
				'    at t.a',
				'',
				'  ℹ 1 note · 0 tables, 1 column checked in 12ms',
				'',
			].join('\n'),
		);
	});

	test('a source file that cannot be read', () => {
		const report = summarise(
			[
				{
					severity: 'error',
					code: 'column-missing',
					message: 'column t.a does not exist in the database',
					table: 't',
					column: 'a',
					source: { file: '/project/gone.ts', line: 3, column: 5 },
				},
			],
			[],
			1,
		);
		expect(formatVerifyReport(report, plain)).toContain(
			'    at gone.ts:3:5 (t.a)',
		);
	});
});

test('table view', () => {
	expect(
		formatVerifyReport(driftReport(), { ...plain, format: 'table' }),
	).toMatchSnapshot();
	expect(
		formatVerifyReport(driftReport(), {
			...plain,
			format: 'table',
			unicode: false,
		}),
	).toSatisfy(isAscii);
});

test('github annotations', () => {
	const out = formatVerifyReport(driftReport(), {
		...plain,
		format: 'github',
	});
	expect(out.split('\n')[0]).toBe(
		'::error file=src/schema.ts,line=23,col=10,title=quarry(column-type-mismatch)::users.email is varchar(320) in the database, but varchar(255) in the code%0Ahelp: alter table users alter column email type varchar(255) using email::varchar(255);%0Aor declare it as varchar(320)',
	);
	expect(out).toContain('::warning file=src/schema.ts');
	expect(out).toMatchSnapshot();
});

test('github annotations escape properties and data', () => {
	const report = summarise(
		[
			{
				severity: 'info',
				code: 'column-extra',
				message: '100% new\r\nline',
				table: 't',
				source: { file: '/project/a,b:c.ts', line: 1, column: 1 },
			},
		],
		[],
		1,
	);
	expect(
		formatVerifyReport(report, { ...plain, format: 'github' }).split('\n')[0],
	).toBe(
		'::notice file=a%2Cb%3Ac.ts,line=1,col=1,title=quarry(column-extra)::100%25 new%0D%0Aline',
	);
});

test('json', () => {
	const report = driftReport();
	const out = formatVerifyReport(report, { ...plain, format: 'json' });
	expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(report)));
	expect(out).toMatchSnapshot();
});

describe('terminal', () => {
	const tty = { isTTY: true, columns: 120 };
	test('colour only on a TTY, honouring NO_COLOR and FORCE_COLOR', () => {
		expect(detectTerminal(tty, {}, 'linux')).toMatchObject({
			color: true,
			unicode: true,
			hyperlinks: true,
			width: 120,
		});
		expect(detectTerminal({ isTTY: false }, {}, 'linux')).toMatchObject({
			color: false,
			hyperlinks: false,
			width: 80,
		});
		expect(detectTerminal(tty, { NO_COLOR: '1' }, 'linux').color).toBe(false);
		expect(detectTerminal({}, { FORCE_COLOR: '1' }, 'linux').color).toBe(true);
		expect(
			detectTerminal(tty, { NO_COLOR: '1', FORCE_COLOR: '1' }, 'linux').color,
		).toBe(true);
		expect(detectTerminal(tty, { FORCE_COLOR: '0' }, 'linux').color).toBe(
			false,
		);
		expect(detectTerminal(tty, { TERM: 'dumb' }, 'linux').color).toBe(false);
		expect(detectTerminal(tty, { CI: 'true' }, 'linux').hyperlinks).toBe(false);
		expect(detectTerminal({}, { COLUMNS: '72' }, 'linux').width).toBe(72);
	});

	test('ASCII where box drawing may be missing', () => {
		expect(detectTerminal(tty, { TERM: 'linux' }, 'linux').unicode).toBe(false);
		expect(detectTerminal(tty, {}, 'win32').unicode).toBe(false);
		expect(detectTerminal(tty, { WT_SESSION: '1' }, 'win32').unicode).toBe(
			true,
		);
		expect(detectTerminal(tty, { QUARRY_ASCII: '1' }, 'linux').unicode).toBe(
			false,
		);
	});

	test('wrapping', () => {
		expect(wrap('aa bb cc dd', 5)).toEqual(['aa bb', 'cc dd']);
		expect(wrap('aa bb cc dd', 8, '  ', 2)).toEqual(['aa', '  bb cc', '  dd']);
		expect(wrap('averyveryverylongword x', 5)).toEqual([
			'averyveryverylongword',
			'x',
		]);
	});
});

function span(line: string, at: string): string {
	const { start, end } = findSpan(line, line.indexOf(at));
	return line.slice(start, end);
}

describe('spans', () => {
	test('a column from its key to the end of its expression', () => {
		expect(span('\t\tage: integer().nullable(),', 'integer')).toBe(
			'age: integer().nullable()',
		);
		expect(span("  'first-name'?: text().name('a,b'), // x", 'text')).toBe(
			"'first-name'?: text().name('a,b')",
		);
		expect(span('{ a: text(), b: integer() }', 'integer')).toBe('b: integer()');
		expect(span('tags: array(text(), 1)', 'array')).toBe(
			'tags: array(text(), 1)',
		);
	});
	test('a call without a key up to its first argument', () => {
		expect(span("export const t = defineTable('t', {", 'defineTable')).toBe(
			"defineTable('t'",
		);
		expect(span("const s = defineEnum('s', ['a', 'b']);", 'defineEnum')).toBe(
			"defineEnum('s'",
		);
	});
});
