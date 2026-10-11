import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
	formatVerifyReport,
	type ReportFormat,
} from '../verify/render/format.js';
import {
	detectTerminal,
	type OutputStream,
} from '../verify/render/terminal.js';
import { parseConfig, schemaTables } from './config.js';

/** Where the command writes, and the environment it reads. */
export interface Io {
	readonly stdout: OutputStream & { write(text: string): unknown };
	readonly stderr: { write(text: string): unknown };
	readonly cwd: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	/** Imports the config module; defaults to `import()`. */
	readonly load?: ((url: string) => Promise<unknown>) | undefined;
}

export const usage = `Usage: quarry verify [options]

Checks the tables in quarry.config.ts against the database.

Options:
  --config <path>    the config file (default: quarry.config.{ts,mts,js,mjs})
  --format <format>  pretty (default), table, github or json
  --strict           treat columns only the database has as errors
  --schema <name>    look tables up in this schema instead of search_path
  --ascii            draw frames with ASCII characters
  --color, --no-color
  -h, --help
`;

const configNames = [
	'quarry.config.ts',
	'quarry.config.mts',
	'quarry.config.js',
	'quarry.config.mjs',
];

/** The config file the command would load, or `undefined` if there is none. */
export function findConfig(
	cwd: string,
	path: string | undefined,
): string | undefined {
	if (path !== undefined) return resolve(cwd, path);
	return configNames.map((name) => resolve(cwd, name)).find(existsSync);
}

const formats = new Set<string>(['pretty', 'table', 'github', 'json']);

function isFormat(value: string): value is ReportFormat {
	return formats.has(value);
}

/**
 * Runs `quarry <argv>`, returning the exit code: 0 when the schema matches
 * (warnings allowed), 1 when there are errors, 2 when the command or config
 * is wrong.
 */
export async function runCli(argv: readonly string[], io: Io): Promise<number> {
	let parsed;
	try {
		parsed = parseArgs({
			args: [...argv],
			allowPositionals: true,
			allowNegative: true,
			options: {
				config: { type: 'string' },
				format: { type: 'string', default: 'pretty' },
				strict: { type: 'boolean', default: false },
				schema: { type: 'string' },
				ascii: { type: 'boolean', default: false },
				color: { type: 'boolean' },
				help: { type: 'boolean', short: 'h', default: false },
			},
		});
	} catch (error) {
		io.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n\n${usage}`,
		);
		return 2;
	}
	const { values, positionals } = parsed;
	if (values.help) {
		io.stdout.write(usage);
		return 0;
	}
	const [command, ...extra] = positionals;
	if (command !== 'verify' || extra.length > 0) {
		io.stderr.write(
			`${command === undefined ? 'No command given' : `Unknown command: ${[command, ...extra].join(' ')}`}\n\n${usage}`,
		);
		return 2;
	}
	if (!isFormat(values.format)) {
		io.stderr.write(`Unknown format: ${values.format}\n\n${usage}`);
		return 2;
	}

	const path = findConfig(io.cwd, values.config);
	if (path === undefined || !existsSync(path)) {
		io.stderr.write(
			`${path === undefined ? `No ${configNames[0]} in ${io.cwd}` : `No config at ${path}`}\n\n${usage}`,
		);
		return 2;
	}
	const load = io.load ?? ((url: string): Promise<unknown> => import(url));
	const config = parseConfig(await load(pathToFileURL(path).href));
	if (typeof config === 'string') {
		io.stderr.write(`${path}: ${config}\n`);
		return 2;
	}

	try {
		const report = await config.db.verify(schemaTables(config.schema), {
			strict: values.strict,
			schema: values.schema,
		});
		const terminal = detectTerminal(io.stdout, io.env);
		io.stdout.write(
			formatVerifyReport(report, {
				...terminal,
				cwd: io.cwd,
				...(values.color !== undefined && { color: values.color }),
				...(values.ascii && { unicode: false }),
				format: values.format,
				root: io.env['GITHUB_WORKSPACE'] ?? io.cwd,
			}),
		);
		return report.ok ? 0 : 1;
	} finally {
		await config.close?.();
	}
}
