import type { Severity, VerifyReport } from '../report.js';
import { displayPath } from './code-frame.js';

const commands: Record<Severity, string> = {
	error: 'error',
	warning: 'warning',
	info: 'notice',
};

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** A workflow command's message, escaped as the runner unescapes it. */
function escapeData(text: string): string {
	return text
		.replaceAll('%', '%25')
		.replaceAll('\r', '%0D')
		.replaceAll('\n', '%0A');
}

/** A workflow command's property value. */
function escapeProperty(text: string): string {
	return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

/**
 * The report as GitHub Actions workflow commands, which annotate the schema
 * file's lines in a pull request: `::error file=…,line=…,col=…::…`. Paths are
 * relative to `root`, the repository's checkout (`GITHUB_WORKSPACE`).
 */
export function formatGithub(report: VerifyReport, root: string): string {
	const lines = report.diagnostics.map((diagnostic) => {
		const properties = [
			...(diagnostic.source
				? [
						`file=${escapeProperty(displayPath(diagnostic.source.file, root))}`,
						`line=${diagnostic.source.line}`,
						`col=${diagnostic.source.column}`,
					]
				: []),
			`title=${escapeProperty(`quarry(${diagnostic.code})`)}`,
		];
		const body = [
			diagnostic.message,
			...(diagnostic.fix === undefined ? [] : [`help: ${diagnostic.fix}`]),
			...(diagnostic.hint === undefined ? [] : [diagnostic.hint]),
		].join('\n');
		return `::${commands[diagnostic.severity]} ${properties.join(',')}::${escapeData(body)}`;
	});
	const { errors, warnings, infos, tables, columns } = report.summary;
	lines.push(
		`quarry verify: ${plural(errors, 'error')}, ${plural(warnings, 'warning')}, ${plural(infos, 'note')} in ${plural(tables, 'table')}, ${plural(columns, 'column')}`,
	);
	return `${lines.join('\n')}\n`;
}
