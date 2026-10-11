import type { ColumnResult, VerifyReport } from '../report.js';
import { formatSummary } from './pretty.js';
import { glyphs as glyphsFor, painter, type Terminal } from './terminal.js';

/** A column's name, with its key in the code when that differs. */
function name(column: ColumnResult): string {
	return column.key === undefined || column.key === column.name
		? column.name
		: `${column.name} (${column.key})`;
}

/**
 * The report as one compact table per database table: each column's type in
 * the code and in the database, and the rule codes it broke.
 */
export function formatTable(report: VerifyReport, terminal: Terminal): string {
	const paint = painter(terminal);
	const glyphs = glyphsFor(terminal);
	const icons = {
		ok: paint('green', glyphs.ok),
		error: paint('red', glyphs.error),
		warning: paint('yellow', glyphs.warning),
		info: paint('cyan', glyphs.info),
	};
	const dash = terminal.unicode ? '—' : '-';

	const all = report.tables.flatMap((table) => table.columns);
	const widths = {
		name: Math.max(6, ...all.map((column) => name(column).length)),
		code: Math.max(4, ...all.map((column) => (column.expected ?? dash).length)),
		db: Math.max(8, ...all.map((column) => (column.actual ?? dash).length)),
	};

	const blocks = report.tables.map((table) => {
		const where =
			table.relation === undefined
				? paint('red', 'missing')
				: paint('dim', `${table.relation} (${table.kind ?? ''})`);
		const lines = [
			`  ${icons[table.status]} ${paint('bold', table.name)}  ${where}`,
			paint(
				'dim',
				`      ${'column'.padEnd(widths.name)}  ${'code'.padEnd(widths.code)}  ${'database'.padEnd(widths.db)}  issues`,
			),
		];
		for (const column of table.columns) {
			const issues = [...new Set(column.codes)].join(', ');
			lines.push(
				`    ${icons[column.status]} ${name(column).padEnd(widths.name)}  ${(column.expected ?? dash).padEnd(widths.code)}  ${(column.actual ?? dash).padEnd(widths.db)}  ${paint('dim', issues)}`.trimEnd(),
			);
		}
		return lines.join('\n');
	});
	blocks.push(formatSummary(report, paint, glyphs, terminal.width));
	return `${blocks.join('\n\n')}\n`;
}
