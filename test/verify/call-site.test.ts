import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { resolveCallSite } from '../../src/call-site.js';
import { array, integer, text } from '../../src/column-factories.js';
import { defineEnum } from '../../src/define-enum.js';
import { defineTable } from '../../src/define-table.js';

const file = fileURLToPath(import.meta.url);
const lines = readFileSync(file, 'utf8').split('\n');

/**
 * The 1-based position of `call` on the first line of this file that
 * contains `code` (`call` defaults to all of it).
 */
function position(code: string, call = code) {
	const index = lines.findIndex((line) => line.includes(code));
	const line = lines[index] ?? '';
	return { file, line: index + 1, column: line.indexOf(call) + 1 };
}

function at(frame: string) {
	return resolveCallSite({ stack: `Error\n    at ${frame}` });
}

describe('call sites', () => {
	test('columns, tables and enums point at where they were defined', () => {
		const mood = defineEnum('mood', ['a']);
		const table = defineTable('t', {
			columns: {
				id: integer().identity(),
				name: text().name('full_name').nullable(),
				tags: array(text()).default(),
				mood: mood(),
			},
		});
		const { columns } = table.schema;
		expect(resolveCallSite(table._quarry.site)).toEqual(
			position("defineTable('t'"),
		);
		expect(resolveCallSite(columns.id._quarry.site)).toEqual(
			position('integer().identity()'),
		);
		expect(resolveCallSite(columns.name._quarry.site)).toEqual(
			position("text().name('full_name')"),
		);
		expect(resolveCallSite(columns.tags._quarry.site)).toEqual(
			position('array(text()).default()'),
		);
		expect(resolveCallSite(columns.mood._quarry.site)).toEqual(
			position('mood: mood()', 'mood()'),
		);
		expect(resolveCallSite(mood()._quarry.dataType.site)).toEqual(
			position("defineEnum('mood'"),
		);
		expect(table.as('alias')._quarry.site).toBe(table._quarry.site);
	});

	test('modifiers record their state', () => {
		expect(text()._quarry).toMatchObject({ nullable: false, fill: undefined });
		expect(text().nullable().default()._quarry).toMatchObject({
			nullable: true,
			fill: 'default',
		});
		expect(text().generated().nullable()._quarry).toMatchObject({
			nullable: true,
			fill: 'generated',
		});
		expect(integer().identity()._quarry.fill).toBe('identity');
		expect(text().default().name('x')._quarry).toMatchObject({
			fill: 'default',
			columnName: 'x',
		});
	});

	test('stack frames of every shape parse', () => {
		expect(at('Object.<anonymous> (/app/schema.ts:3:9)')).toEqual({
			file: '/app/schema.ts',
			line: 3,
			column: 9,
		});
		expect(at('/app/my schema.ts:3:9')).toEqual({
			file: '/app/my schema.ts',
			line: 3,
			column: 9,
		});
		expect(at('file:///app/my%20schema.ts:12:1')).toEqual({
			file: '/app/my schema.ts',
			line: 12,
			column: 1,
		});
		expect(at('async run (file:///app/a.ts:1:2)')).toEqual({
			file: '/app/a.ts',
			line: 1,
			column: 2,
		});
		expect(at('C:\\app\\schema.ts:3:9')?.file).toBe('C:\\app\\schema.ts');
		expect(at('native')).toBeUndefined();
		expect(resolveCallSite(undefined)).toBeUndefined();
		expect(resolveCallSite({})).toBeUndefined();
	});

	test('capturing a site leaves the stack trace limit alone', () => {
		const limit = Error.stackTraceLimit;
		text();
		expect(Error.stackTraceLimit).toBe(limit);
	});
});
