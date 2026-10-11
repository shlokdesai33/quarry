import type { VerifyReport } from '../report.js';
import { readSource, type ReadSource } from './code-frame.js';
import { formatGithub } from './github.js';
import { formatPretty } from './pretty.js';
import { formatTable } from './table.js';
import { detectTerminal, type Terminal } from './terminal.js';

export type ReportFormat = 'pretty' | 'table' | 'github' | 'json';

export interface FormatOptions extends Partial<Terminal> {
	/** Defaults to `pretty`. */
	readonly format?: ReportFormat | undefined;
	/**
	 * Where paths in `github` annotations are relative to; defaults to
	 * `GITHUB_WORKSPACE`, or the working directory.
	 */
	readonly root?: string | undefined;
	/** Reads the schema files for code frames; defaults to the file system. */
	readonly read?: ReadSource | undefined;
}

/**
 * Renders a `db.verify` report: `pretty` diagnostics with code frames,
 * a `table` per database table, `github` workflow annotations, or `json`.
 * Colour, ASCII and width default to what `process.stdout` supports.
 *
 * @example
 * process.stdout.write(formatVerifyReport(await db.verify(tables)));
 */
export function formatVerifyReport(
	report: VerifyReport,
	options: FormatOptions = {},
): string {
	const { format = 'pretty', root, read = readSource, ...overrides } = options;
	const terminal: Terminal = {
		...detectTerminal(process.stdout),
		...overrides,
	};
	switch (format) {
		case 'json':
			return `${JSON.stringify(report, null, 2)}\n`;
		case 'github':
			return formatGithub(
				report,
				root ?? process.env['GITHUB_WORKSPACE'] ?? terminal.cwd,
			);
		case 'table':
			return formatTable(report, terminal);
		case 'pretty':
			return formatPretty(report, terminal, read);
	}
}
