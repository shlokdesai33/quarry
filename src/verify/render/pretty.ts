import type { Diagnostic, Severity, VerifyReport } from '../report.js';
import { codeFrame, locationText, type ReadSource } from './code-frame.js';
import {
	type Glyphs,
	glyphs as glyphsFor,
	type Paint,
	painter,
	type Terminal,
	wrap,
} from './terminal.js';

const accents = {
	error: 'red',
	warning: 'yellow',
	info: 'cyan',
} as const satisfies Record<Severity, Parameters<Paint>[0]>;

/**
 * The report as miette and oxlint print diagnostics: a severity icon, the
 * rule code and message, a code frame of the definition, `help:` with the
 * suggested SQL, then a summary.
 */
export function formatPretty(
	report: VerifyReport,
	terminal: Terminal,
	read: ReadSource,
): string {
	const paint = painter(terminal);
	const glyphs = glyphsFor(terminal);
	const blocks = report.diagnostics.map((diagnostic) =>
		formatDiagnostic(diagnostic, { terminal, paint, glyphs, read }),
	);
	blocks.push(formatSummary(report, paint, glyphs, terminal.width));
	return `${blocks.join('\n\n')}\n`;
}

interface Context {
	readonly terminal: Terminal;
	readonly paint: Paint;
	readonly glyphs: Glyphs;
	readonly read: ReadSource;
}

function formatDiagnostic(diagnostic: Diagnostic, context: Context): string {
	const { terminal, paint, glyphs } = context;
	const accent = accents[diagnostic.severity];
	const icon = paint(accent, glyphs[diagnostic.severity]);
	const code = `quarry(${diagnostic.code}):`;
	const [first = '', ...rest] = wrap(
		diagnostic.message,
		terminal.width,
		'    ',
		terminal.width - code.length - 5,
	);
	const lines = [
		`  ${icon} ${paint(accent, paint('bold', code))} ${paint('bold', first)}`,
		...rest.map((line) => paint('bold', line)),
	];

	const where = `${diagnostic.table}${diagnostic.column === undefined ? '' : `.${diagnostic.column}`}`;
	const frame =
		diagnostic.source &&
		codeFrame({
			location: diagnostic.source,
			label: diagnostic.label,
			accent,
			terminal,
			paint,
			glyphs,
			read: context.read,
		});
	if (frame) {
		lines.push(...frame);
	} else {
		const at = diagnostic.source
			? `${locationText(diagnostic.source, terminal)} (${where})`
			: where;
		lines.push(`    ${paint('dim', 'at')} ${at}`);
	}

	const help = [
		...(diagnostic.fix?.split('\n').map((line) => paint('cyan', line)) ?? []),
		...(diagnostic.hint === undefined
			? []
			: wrap(diagnostic.hint, terminal.width - 8)),
	];
	help.forEach((line, i) => {
		lines.push(
			i === 0 ? `  ${paint('cyan', 'help:')} ${line}` : `        ${line}`,
		);
	});
	return lines.join('\n');
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function formatSummary(
	report: VerifyReport,
	paint: Paint,
	glyphs: Glyphs,
	width: number,
): string {
	const { errors, warnings, infos, tables, columns, durationMs } =
		report.summary;
	const checked = `${plural(tables, 'table')}, ${plural(columns, 'column')} checked in ${Math.round(durationMs)}ms`;
	const counts = [
		errors > 0 && (['red', plural(errors, 'error')] as const),
		warnings > 0 && (['yellow', plural(warnings, 'warning')] as const),
		infos > 0 && (['cyan', plural(infos, 'note')] as const),
	].filter((part) => part !== false);
	const [icon, headline] =
		counts.length === 0
			? [paint('green', glyphs.ok), 'schema matches the database']
			: [
					errors > 0
						? paint('red', glyphs.failed)
						: warnings > 0
							? paint('yellow', glyphs.warning)
							: paint('cyan', glyphs.info),
					counts.map(([, text]) => text).join(', '),
				];
	const styled =
		counts.length === 0
			? paint('bold', headline)
			: counts.map(([color, text]) => paint(color, text)).join(', ');
	const separator = ` ${glyphs.separator} `;
	const fits = 4 + headline.length + separator.length + checked.length <= width;
	return fits
		? `  ${icon} ${styled}${paint('dim', separator)}${paint('dim', checked)}`
		: `  ${icon} ${styled}\n    ${paint('dim', checked)}`;
}
