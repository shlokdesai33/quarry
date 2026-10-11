#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { findConfig, runCli } from './run.js';

const argv = process.argv.slice(2);
const configIndex = argv.indexOf('--config');
const config = findConfig(
	process.cwd(),
	configIndex === -1
		? argv.find((arg) => arg.startsWith('--config='))?.slice(9)
		: argv[configIndex + 1],
);

// Node strips TypeScript types by default from 22.18 and 23.6 on; before
// that, rerun with the flag so a quarry.config.ts loads.
if (
	config !== undefined &&
	/\.[cm]?ts$/.test(config) &&
	!Reflect.get(process.features, 'typescript') &&
	!process.execArgv.includes('--experimental-strip-types')
) {
	const result = spawnSync(
		process.execPath,
		[
			...process.execArgv,
			'--experimental-strip-types',
			'--no-warnings=ExperimentalWarning',
			...process.argv.slice(1),
		],
		{ stdio: 'inherit' },
	);
	process.exit(result.status ?? 1);
}

const code = await runCli(argv, {
	stdout: process.stdout,
	stderr: process.stderr,
	cwd: process.cwd(),
	env: process.env,
}).catch((error: unknown) => {
	process.stderr.write(
		`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	return 2;
});
// a driver pool the config didn't close would keep the process alive
process.stdout.write('', () => process.exit(code));
