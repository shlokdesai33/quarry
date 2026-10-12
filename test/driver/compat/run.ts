/* oxlint-disable no-console, no-await-in-loop -- a CLI that runs suites one after another and reports */
// Runs node-postgres's and postgres.js's own test suites against quarry's
// driver, through the shims in ./shims, on a throwaway PostgreSQL 18
// cluster (and again through PgBouncer in transaction mode with
// --bouncer). Outcomes are compared with ./expectations.ts: anything that
// fails without a recorded reason, or passes despite one, fails the run.
//
//   pnpm test:compat [suite…] [--bouncer] [--no-direct] [--json out.json]
//   pnpm test:compat --reclassify out.json   (re-apply expectations to a saved run)
import { execFileSync, spawn } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { findBinDir } from '../setup/cluster.js';
import { startCompatCluster, type CompatCluster } from './cluster.js';
import { classify, notRun, type Category } from './expectations.js';
import type { ResultLine } from './shims/results.js';

const root = resolve(import.meta.dirname, '../../..');
const here = import.meta.dirname;
const shims = join(here, 'shims');
const cache = process.env['QUARRY_COMPAT_DIR'] ?? join(root, '.compat');

export const upstream = {
	'node-postgres': {
		repo: 'https://github.com/brianc/node-postgres.git',
		tag: 'pg@8.23.1',
	},
	postgres: { repo: 'https://github.com/porsager/postgres.git', tag: 'v3.4.9' },
} as const;

const np = join(cache, 'node-postgres');
const pjs = join(cache, 'postgres');

function sh(cmd: string, args: string[], cwd?: string): void {
	execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

function prepare(): void {
	mkdirSync(cache, { recursive: true });
	for (const [name, { repo, tag }] of Object.entries(upstream)) {
		const dir = join(cache, name);
		if (!existsSync(dir))
			sh('git', [
				'clone',
				'--quiet',
				'--depth',
				'1',
				'--branch',
				tag,
				repo,
				dir,
			]);
	}
	if (!existsSync(join(np, 'node_modules', 'mocha'))) {
		sh(
			'npx',
			[
				'-y',
				'yarn@1.22.22',
				'install',
				'--ignore-scripts',
				'--frozen-lockfile',
				'--ignore-engines',
			],
			np,
		);
	}
	if (!existsSync(join(np, 'packages', 'pg-query-stream', 'dist', 'index.js')))
		sh(join(np, 'node_modules', '.bin', 'tsc'), ['--build'], np);
}

/** Which upstream files the shims stand in for. */
function redirects(): Record<string, string> {
	const pg = join(np, 'packages', 'pg');
	return {
		[join(pg, 'lib', 'index.js')]: join(shims, 'pg', 'index.ts'),
		[join(pg, 'lib', 'client.js')]: join(shims, 'pg', 'client-module.ts'),
		[join(pg, 'test', 'suite.js')]: join(shims, 'pg', 'suite.ts'),
		[join(np, 'packages', 'pg-pool', 'index.js')]: join(
			shims,
			'pg',
			'pool-module.ts',
		),
		[join(np, 'packages', 'pg-cursor', 'index.js')]: join(
			shims,
			'pg',
			'cursor.ts',
		),
		// pg-query-stream's own implementation, compiled, over the shim's pg-cursor
		[join(np, 'packages', 'pg-query-stream', 'src', 'index.ts')]: join(
			np,
			'packages',
			'pg-query-stream',
			'dist',
			'index.js',
		),
		[join(np, 'packages', 'pg-protocol', 'dist', 'serializer.js')]: join(
			shims,
			'pg-protocol',
			'serializer.ts',
		),
		[join(np, 'packages', 'pg-protocol', 'dist', 'parser.js')]: join(
			shims,
			'pg-protocol',
			'parser.ts',
		),
		[join(pjs, 'src', 'index.js')]: join(shims, 'postgres', 'index.ts'),
		[join(pjs, 'tests', 'test.js')]: join(shims, 'postgres', 'test.ts'),
		[join(pjs, 'tests', 'bootstrap.js')]: join(
			shims,
			'postgres',
			'bootstrap.ts',
		),
	};
}

interface Target {
	readonly label: string;
	readonly host: string;
	readonly port: number;
	readonly bouncer: boolean;
}

function env(
	target: Target,
	cluster: CompatCluster,
	extra: Record<string, string>,
) {
	return {
		...process.env,
		NODE_OPTIONS: `--import ${join(here, 'hooks.ts')} --no-warnings`,
		QUARRY_COMPAT_REDIRECTS: JSON.stringify(redirects()),
		QUARRY_COMPAT_PG_TYPES: join(np, 'node_modules', 'pg-types'),
		QUARRY_COMPAT_POSTGRES: pjs,
		QUARRY_COMPAT_BOUNCER: target.bouncer ? '1' : '',
		QUARRY_COMPAT_DIRECT_PORT: String(cluster.port),
		QUARRY_COMPAT_BIN: cluster.running.info.binDir,
		PGHOST: target.host,
		PGPORT: String(target.port),
		PGUSER: 'postgres',
		PGPASSWORD: 'postgres-pw',
		PGSOCKET: cluster.socketDir,
		TZ: 'UTC',
		...extra,
	};
}

/** Runs a child process with a deadline; resolves with its exit code and output. */
function child(
	cmd: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
	return new Promise((done) => {
		const proc = spawn(cmd, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		proc.stdout.on('data', (d: Buffer) => (output += d.toString()));
		proc.stderr.on('data', (d: Buffer) => (output += d.toString()));
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill('SIGKILL');
		}, options.timeout);
		proc.on('close', (code) => {
			clearTimeout(timer);
			done({ code, output, timedOut });
		});
	});
}

function readLines(file: string): ResultLine[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as ResultLine);
}

function walk(dir: string, match: (name: string) => boolean): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...walk(path, match));
		else if (match(entry)) out.push(path);
	}
	return out.toSorted();
}

export interface Outcome {
	readonly suite: string;
	readonly file: string;
	readonly name: string;
	readonly passed: boolean;
	readonly error?: string | undefined;
}

/** Turns a file's recorded lines (and how it exited) into outcomes. */
function outcomesOf(
	suite: string,
	file: string,
	lines: ResultLine[],
	exit: { code: number | null; output: string; timedOut: boolean },
): Outcome[] {
	const out: Outcome[] = [];
	const started = new Set<string>();
	const finished = new Set<string>();
	for (const line of lines) {
		if (line.outcome === 'start') started.add(line.name);
		else if (line.outcome === 'skip') continue;
		else {
			finished.add(line.name);
			out.push({
				suite,
				file,
				name: line.name,
				passed: line.outcome === 'pass',
				error: line.error,
			});
		}
	}
	const tail = exit.output.split('\n').slice(-15).join('\n');
	const crash = exit.timedOut
		? `timed out\n${tail}`
		: exit.code !== 0
			? `exited with ${exit.code}\n${tail}`
			: undefined;
	for (const name of started) {
		if (!finished.has(name))
			out.push({
				suite,
				file,
				name,
				passed: false,
				error: crash ?? 'never finished',
			});
	}
	if (
		out.length === 0 ||
		(crash !== undefined && started.size === finished.size)
	) {
		// a file without suite tests (or one that failed outside them) counts as one test
		out.push({
			suite,
			file,
			name: '(file)',
			passed: crash === undefined,
			error: crash,
		});
	}
	return out;
}

/** How many upstream files run at once (`--jobs`); 1 by default, as upstream runs them. */
let jobs = 1;

/** Runs `fn` over `items` with at most `jobs` at a time, keeping the items' order in the result. */
async function parallel<T, R>(
	items: T[],
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = Array.from({ length: items.length });
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.max(1, jobs) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i] as T);
			}
		}),
	);
	return out;
}

let resultCount = 0;

async function runPg(
	target: Target,
	cluster: CompatCluster,
	filter: RegExp | undefined,
) {
	const dir = join(np, 'packages', 'pg');
	const files = walk(join(dir, 'test', 'integration'), (n) =>
		n.endsWith('-tests.js'),
	).filter((path) => {
		const file = relative(dir, path);
		return !(filter && !filter.test(file)) && !notRun('pg', file);
	});
	const outcomes: Outcome[] = [];
	const perFile = await parallel(files, async (path) => {
		const file = relative(dir, path);
		const results = join(cache, 'results', `pg-${++resultCount}.jsonl`);
		const exit = await child('node', [path], {
			cwd: dir,
			timeout: 60_000,
			env: env(target, cluster, {
				QUARRY_COMPAT_RESULTS: results,
				QUARRY_COMPAT_SUITE: 'pg',
				QUARRY_COMPAT_FILE: file,
				PGDATABASE: 'ci_db_test',
				SCRAM_TEST_PGUSER: 'scram_test',
				SCRAM_TEST_PGPASSWORD: 'test4scram',
				SCRAM_TEST_PGUSER_UNICODE: 'scram_unicode_test',
				SCRAM_TEST_PGPASSWORD_UNICODE: 'IX-\u2168',
			}),
		});
		const got = outcomesOf('pg', file, readLines(results), exit);
		const failed = got.filter((o) => !o.passed).length;
		console.log(`  ${file}: ${got.length - failed}/${got.length}`);
		return got;
	});
	for (const got of perFile) outcomes.push(...got);
	return outcomes;
}

interface MochaReport {
	passes: { fullTitle: string; file?: string }[];
	failures: {
		fullTitle: string;
		file?: string;
		err: { message?: string; stack?: string };
	}[];
	pending: { fullTitle: string }[];
}

async function runMocha(
	suite: string,
	target: Target,
	cluster: CompatCluster,
	pkg: string,
	files: string[],
	extraArgs: string[] = [],
	filter?: RegExp,
): Promise<Outcome[]> {
	const dir = join(np, 'packages', pkg);
	const out: Outcome[] = [];
	for (const path of files) {
		const file = relative(dir, path);
		if (filter && !filter.test(file)) continue;
		if (notRun(suite, file)) continue;
		const report = join(cache, 'results', `${suite}-${++resultCount}.json`);
		const exit = await child(
			join(np, 'node_modules', '.bin', 'mocha'),
			[
				'--no-config',
				'--reporter',
				'json',
				'--reporter-option',
				`output=${report}`,
				'--timeout',
				'10000',
				'--exit',
				...extraArgs,
				path,
			],
			{
				cwd: dir,
				timeout: 180_000,
				env: env(target, cluster, { PGDATABASE: 'ci_db_test' }),
			},
		);
		if (!existsSync(report)) {
			out.push({
				suite,
				file,
				name: '(file)',
				passed: false,
				error: `no report (exit ${exit.code}${exit.timedOut ? ', timed out' : ''})\n${exit.output.slice(-2000)}`,
			});
			console.log(`  ${file}: crashed`);
			continue;
		}
		const parsed = JSON.parse(readFileSync(report, 'utf8')) as MochaReport;
		const got: Outcome[] = [
			...parsed.passes.map((p) => ({
				suite,
				file,
				name: p.fullTitle,
				passed: true,
			})),
			...parsed.failures.map((f) => ({
				suite,
				file,
				name: f.fullTitle,
				passed: false,
				error: (f.err.stack ?? f.err.message ?? '')
					.split('\n')
					.slice(0, 8)
					.join('\n'),
			})),
		];
		out.push(...got);
		console.log(`  ${file}: ${parsed.passes.length}/${got.length}`);
	}
	return out;
}

async function runPostgresJs(
	target: Target,
	cluster: CompatCluster,
): Promise<Outcome[]> {
	const results = join(cache, 'results', `postgres-${++resultCount}.jsonl`);
	const exit = await child('node', ['index.js'], {
		cwd: join(pjs, 'tests'),
		timeout: 900_000,
		env: env(target, cluster, {
			QUARRY_COMPAT_RESULTS: results,
			QUARRY_COMPAT_SUITE: 'postgres',
			QUARRY_COMPAT_FILE: 'tests/index.js',
		}),
	});
	const lines = readLines(results);
	const got =
		lines.length === 0
			? [
					{
						suite: 'postgres',
						file: 'tests/index.js',
						name: '(file)',
						passed: false,
						error: `no tests ran (exit ${exit.code})\n${exit.output.slice(-3000)}`,
					},
				]
			: outcomesOf('postgres', 'tests/index.js', lines, {
					...exit,
					// the runner records every test; a non-zero exit only reports failures
					code: exit.timedOut ? exit.code : 0,
				});
	console.log(
		`  tests/index.js: ${got.filter((o) => o.passed).length}/${got.length}`,
	);
	if (exit.timedOut) console.log(exit.output.slice(-3000));
	return got;
}

interface SuiteTotals {
	run: number;
	passed: number;
	fixed: number;
	intentional: number;
	notApplicable: number;
	shim: number;
	unexpected: number;
	unexpectedPasses: number;
}

const SUITES = [
	'pg',
	'pg-pool',
	'pg-cursor',
	'pg-query-stream',
	'pg-protocol',
	'postgres',
] as const;

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const bouncer = args.includes('--bouncer');
	const direct = !args.includes('--no-direct');
	const valued = new Map<string, string>();
	const wanted: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? '';
		if (['--json', '--filter', '--jobs', '--reclassify'].includes(arg))
			valued.set(arg, args[++i] ?? '');
		else if (!arg.startsWith('--')) wanted.push(arg);
	}
	const json = valued.get('--json');
	const filter = valued.has('--filter')
		? new RegExp(valued.get('--filter') ?? '')
		: undefined;
	jobs = Number(valued.get('--jobs') ?? 1);
	const suites = wanted.length > 0 ? wanted : [...SUITES];
	// re-applies the expectations to a saved run's outcomes, without running anything
	const saved = valued.get('--reclassify');
	if (saved !== undefined) {
		const { outcomes } = JSON.parse(readFileSync(saved, 'utf8')) as {
			outcomes: (Outcome & { target: string })[];
		};
		summarize(outcomes, json);
		return;
	}

	prepare();
	rmSync(join(cache, 'results'), { recursive: true, force: true });
	mkdirSync(join(cache, 'results'), { recursive: true });
	const binDir = findBinDir();
	if (binDir === undefined) throw new Error('PostgreSQL 18 is not installed');
	const cluster = await startCompatCluster(binDir, { bouncer });
	const targets: Target[] = [];
	if (direct)
		targets.push({
			label: 'PostgreSQL 18',
			host: 'localhost',
			port: cluster.port,
			bouncer: false,
		});
	if (bouncer && cluster.bouncerPort !== undefined)
		targets.push({
			label: 'PgBouncer (transaction mode)',
			host: '127.0.0.1',
			port: cluster.bouncerPort,
			bouncer: true,
		});

	const all: (Outcome & { target: string })[] = [];
	try {
		for (const target of targets) {
			for (const suite of suites) {
				console.log(`\n${suite} on ${target.label}`);
				let outcomes: Outcome[] = [];
				const pkg = (name: string) => join(np, 'packages', name);
				switch (suite) {
					case 'pg':
						outcomes = await runPg(target, cluster, filter);
						break;
					case 'pg-pool':
						outcomes = await runMocha(
							suite,
							target,
							cluster,
							'pg-pool',
							walk(join(pkg('pg-pool'), 'test'), (n) => n.endsWith('.js')),
							[],
							filter,
						);
						break;
					case 'pg-cursor':
						outcomes = await runMocha(
							suite,
							target,
							cluster,
							'pg-cursor',
							walk(join(pkg('pg-cursor'), 'test'), (n) => n.endsWith('.js')),
							[],
							filter,
						);
						break;
					case 'pg-query-stream':
						outcomes = await runMocha(
							suite,
							target,
							cluster,
							'pg-query-stream',
							walk(
								join(pkg('pg-query-stream'), 'test'),
								(n) => n.endsWith('.ts') && n !== 'helper.ts',
							),
							['--extension', 'ts'],
							filter,
						);
						break;
					case 'pg-protocol':
						outcomes = await runMocha(
							suite,
							target,
							cluster,
							'pg-protocol',
							walk(join(pkg('pg-protocol'), 'dist'), (n) =>
								n.endsWith('.test.js'),
							),
							[],
							filter,
						);
						break;
					case 'postgres':
						outcomes = await runPostgresJs(target, cluster);
						break;
					default:
						throw new Error(`Unknown suite ${suite}`);
				}
				for (const o of outcomes)
					all.push(Object.assign(o, { target: target.label }));
			}
		}
	} finally {
		await cluster.stop();
	}
	summarize(all, json);
}

/** Classifies outcomes against the expectations, prints the totals and, with `json`, writes them. */
function summarize(
	all: (Outcome & { target: string })[],
	json: string | undefined,
): void {
	// classify and total
	const totals = new Map<string, SuiteTotals>();
	const problems: string[] = [];
	const rows: unknown[] = [];
	for (const o of all) {
		const key = `${o.suite} — ${o.target}`;
		const t = totals.get(key) ?? {
			run: 0,
			passed: 0,
			fixed: 0,
			intentional: 0,
			notApplicable: 0,
			shim: 0,
			unexpected: 0,
			unexpectedPasses: 0,
		};
		totals.set(key, t);
		const expectation = classify(o.suite, o.file, o.name, o.target, o.error);
		t.run++;
		let category: Category | 'pass' | 'unexpected' = 'pass';
		if (o.passed) {
			t.passed++;
			if (expectation?.fixed) t.fixed++;
			if (
				expectation?.category &&
				!expectation.flaky &&
				!expectation.wildcard
			) {
				t.unexpectedPasses++;
				problems.push(
					`PASSES but expected ${expectation.category}: [${o.suite}] ${o.file} › ${o.name} (${o.target})`,
				);
			}
		} else if (expectation?.category) {
			category = expectation.category;
			if (category === 'intentional') t.intentional++;
			else if (category === 'not-applicable') t.notApplicable++;
			else t.shim++;
		} else {
			category = 'unexpected';
			t.unexpected++;
			problems.push(
				`FAILS: [${o.suite}] ${o.file} › ${o.name} (${o.target})\n    ${(o.error ?? '').split('\n').join('\n    ')}`,
			);
		}
		rows.push({ ...o, category, reason: expectation?.reason });
	}

	console.log('\nTotals');
	for (const [key, t] of totals) {
		console.log(
			`  ${key}: run ${t.run}, passed ${t.passed} (fixed ${t.fixed}), intentional ${t.intentional}, not applicable ${t.notApplicable}, shim ${t.shim}, unexpected failures ${t.unexpected}, unexpected passes ${t.unexpectedPasses}`,
		);
	}
	if (json)
		writeFileSync(
			json,
			JSON.stringify(
				{ totals: Object.fromEntries(totals), outcomes: rows },
				null,
				2,
			),
		);
	if (problems.length > 0) {
		console.log(
			`\n${problems.length} unexpected outcomes:\n${problems.join('\n')}`,
		);
		process.exitCode = 1;
	}
}

await main();
