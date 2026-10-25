/* oxlint-disable no-await-in-loop -- cells run one at a time, on purpose */
/**
 * Runs the benchmark matrix: every cell (client × scenario × parameters) `--runs` times, each run in a fresh process pinned to the
 * client CPUs, in a seeded random order. Results append to
 * `results/<id>/raw.jsonl` as they come, so an interrupted run resumes
 * with `--id <id>`.
 *
 *   node orchestrate.ts [--phases main,conc,pipeline,rtt,bouncer,reconnect,verify]
 *                       [--runs 5] [--seed 1] [--id name]
 *                       [--only-drivers a,b] [--only-scenarios a,b] [--quick] [--parallel 1]
 */
import { execSync, spawn } from 'node:child_process';
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { cpus, totalmem, release } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
	CPUS,
	PORTS,
	restartPostgres,
	setLatency,
	startEnv,
	stopChildren,
	type BenchEnv,
} from './env.ts';
import { DRIVERS, defaultTarget, type Target } from './drivers.ts';
import { byId, SCENARIOS } from './scenarios.ts';
import type { Job } from './worker.ts';

const args = process.argv.slice(2);
const arg = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);
const list = (name: string) => arg(name)?.split(',').filter(Boolean);

const RUNS = Number(arg('runs') ?? 5);
const SEED = Number(arg('seed') ?? 1);
const QUICK = flag('quick');
const PARALLEL = Number(arg('parallel') ?? 1);
const PHASES = list('phases') ?? [
	'verify',
	'main',
	'conc',
	'pipeline',
	'rtt',
	'batch',
	'builder',
	'bouncer',
	'reconnect',
];
const ONLY_DRIVERS = list('only-drivers');
const ONLY_SCENARIOS = list('only-scenarios');
const ID =
	arg('id') ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
/** Set to a built `dist/driver/index.js` to add a `quarry-candidate` twin of every quarry cell. */
const CANDIDATE = process.env['QUARRY_DIST_CANDIDATE'];
const OUT = join(import.meta.dirname, 'results', ID);

/** The main clients; every scenario runs on each. */
export const CORE: readonly string[] = [
	'quarry',
	'pg',
	'pg-named',
	'pg-native',
	'postgres.js',
	'neon',
];

const PREPARE_SET = [
	'select1',
	'pk',
	'range100',
	'fetch1k',
	'params100',
	'params1000',
	'insert1',
	'upsert',
];
const DECODE_SET = [
	'pk',
	'fetch1k',
	'fetch100k',
	'fetch1m',
	'wide',
	'arrays',
	...SCENARIOS.filter((s) => s.group === 'types').map((s) => s.id),
];
/** Configuration variants, with the scenarios where they're informative. */
const VARIANTS: Record<string, readonly string[]> = {
	'quarry-lossless': DECODE_SET,
	'quarry-noprep': PREPARE_SET,
	'postgres.js-noprep': PREPARE_SET,
	'pg-native-named': PREPARE_SET,
	'neon-default': ['select1', 'pk', 'fetch1k', 'insert1', 'tx-insert'],
};

interface Cell {
	readonly phase: string;
	/** Always `node`; kept so results stay keyed like earlier snapshots. */
	readonly runtime: 'node';
	readonly driver: string;
	readonly scenario: string;
	readonly via: 'direct' | 'bouncer' | 'toxiproxy';
	readonly max: number;
	readonly concurrency?: number;
	readonly pipeline?: number;
	readonly rtt?: number;
	readonly durationMs?: number;
	/** Equal-work memory cell: exactly this many operations (see `memOps` in scenarios.ts). */
	readonly memOps?: number;
}

const cellKey = (c: Cell) =>
	JSON.stringify([
		c.phase,
		c.runtime,
		c.driver,
		c.scenario,
		c.via,
		c.max,
		c.concurrency ?? null,
		c.pipeline ?? null,
		c.rtt ?? null,
		// only when set, so keys of earlier results stay valid for --id resumes
		...(c.memOps === undefined ? [] : [c.memOps]),
	]);
const keep = (driver: string, scenario: string) =>
	(!ONLY_DRIVERS || ONLY_DRIVERS.includes(driver)) &&
	(!ONLY_SCENARIOS || ONLY_SCENARIOS.includes(scenario));

function matrix(phase: string): Cell[] {
	const cells: Cell[] = [];
	const push = (c: Cell) => {
		if (keep(c.driver, c.scenario) && DRIVERS[c.driver] !== undefined)
			cells.push(c);
	};
	const add = (c: Cell) => {
		push(c);
		// equal-work memory twin, in its own process
		const s = byId.get(c.scenario);
		if (c.phase === 'main' && s?.kind === 'ops' && s.memOps !== undefined)
			push({ ...c, memOps: s.memOps });
		// A/B: every quarry cell again with the candidate build
		if (CANDIDATE && c.driver === 'quarry') {
			push({ ...c, driver: 'quarry-candidate' });
			if (c.phase === 'main' && s?.kind === 'ops' && s.memOps !== undefined)
				push({ ...c, driver: 'quarry-candidate', memOps: s.memOps });
			if (s?.group === 'streaming' && s.kind === 'ops')
				push({ ...c, driver: 'quarry-candidate-readahead' });
		}
		if (CANDIDATE && c.driver === 'quarry-db')
			push({ ...c, driver: 'quarry-db-candidate' });
	};
	const runtime = 'node';
	if (phase === 'main' || phase === 'verify') {
		for (const s of SCENARIOS) {
			if (
				s.id === 'reconnect' ||
				s.group === 'batches' ||
				s.group === 'builder'
			)
				continue;
			if (phase === 'verify' && (s.kind !== 'ops' || !s.verify)) continue;
			for (const driver of CORE)
				add({
					phase,
					runtime,
					driver,
					scenario: s.id,
					via: 'direct',
					max: 10,
				});
			for (const [driver, scenarios] of Object.entries(VARIANTS))
				if (scenarios.includes(s.id))
					add({
						phase,
						runtime,
						driver,
						scenario: s.id,
						via: 'direct',
						max: 10,
					});
		}
	}
	if (phase === 'conc') {
		for (const driver of [...CORE, 'quarry-nopipe'])
			for (const concurrency of [1, 10, 50, 100, 500, 1000])
				for (const max of [1, 5, 10, 50])
					add({
						phase,
						runtime,
						driver,
						scenario: 'pk',
						via: 'direct',
						max,
						concurrency,
					});
	}
	if (phase === 'pipeline') {
		for (const rtt of [0, 5])
			// undefined: the default, adaptive depth
			for (const pipeline of [1, 2, 4, 8, 16, 32, 64, 100, undefined])
				add({
					phase,
					runtime,
					driver: 'quarry',
					scenario: 'pk',
					via: 'toxiproxy',
					rtt,
					max: 1,
					concurrency: 100,
					...(pipeline === undefined ? {} : { pipeline }),
					durationMs: 2000,
				});
	}
	if (phase === 'rtt') {
		const scenarios: [string, number, number?][] = [
			['select1', 10],
			['pk', 10],
			['pk', 10, 50],
			['pk', 1, 100],
			['pk', 1, 500],
			['fetch1k', 10],
			['tx-insert', 10],
			['tx-empty', 10],
			['savepoints', 10],
			['insert1-c50', 10],
			['connect-plain-trust', 10],
		];
		for (const rtt of [0, 1, 5, 20])
			for (const driver of CORE)
				for (const [scenario, max, concurrency] of scenarios)
					add({
						phase,
						runtime,
						driver,
						scenario,
						via: 'toxiproxy',
						rtt,
						max,
						...(concurrency ? { concurrency } : {}),
						durationMs: rtt >= 5 ? 2000 : 1000,
					});
	}
	if (phase === 'bouncer') {
		const drivers = [
			'quarry',
			'quarry-noprep',
			'pg',
			'pg-named',
			'pg-native',
			'postgres.js',
			'postgres.js-noprep',
		];
		const scenarios: [string, number?][] = [
			['select1'],
			['pk'],
			['pk', 50],
			['fetch1k'],
			['insert1'],
			['tx-insert'],
			['insert1-c50'],
			['error'],
		];
		for (const driver of drivers)
			for (const [scenario, concurrency] of scenarios)
				add({
					phase,
					runtime,
					driver,
					scenario,
					via: 'bouncer',
					max: 10,
					...(concurrency ? { concurrency } : {}),
				});
	}
	// quarry's query builder: db.batch against sequential and Promise.all
	if (phase === 'batch') {
		for (const s of SCENARIOS.filter((x) => x.group === 'batches'))
			for (const rtt of [0, 5])
				add({
					phase,
					runtime,
					driver: 'quarry-db',
					scenario: s.id,
					via: 'toxiproxy',
					rtt,
					max: 10,
					durationMs: rtt >= 5 ? 2000 : 1000,
				});
	}
	// quarry's query builder under concurrency, with the same statements
	// through the drivers for reference
	if (phase === 'builder') {
		const plan: [string, string[]][] = [
			['quarry-db', ['db-pk', 'db-pk-timed', 'db-insert', 'db-update']],
			...['quarry', 'pg', 'postgres.js'].map((d): [string, string[]] => [
				d,
				['pk', 'insert1', 'update'],
			]),
		];
		for (const rtt of [0, 5])
			for (const [driver, scenarios] of plan)
				for (const scenario of scenarios)
					for (const concurrency of [1, 100, 500, 1000])
						add({
							phase,
							runtime,
							driver,
							scenario,
							via: 'toxiproxy',
							rtt,
							max: 10,
							concurrency,
							durationMs: rtt >= 5 ? 2000 : 1000,
						});
	}
	if (phase === 'reconnect') {
		for (const driver of CORE.filter((d) => d !== 'neon'))
			add({
				phase,
				runtime,
				driver,
				scenario: 'reconnect',
				via: 'direct',
				max: 10,
			});
	}
	return cells;
}

function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle<T>(items: T[], random: () => number): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[items[i], items[j]] = [items[j]!, items[i]!];
	}
	return items;
}

function command(json: string): string[] {
	const pin = PARALLEL > 1 ? [] : ['taskset', '-c', CPUS.client];
	return [...pin, 'node', '--expose-gc', 'worker.ts', json];
}

function targetFor(cell: Cell): Target {
	const port =
		cell.via === 'bouncer'
			? PORTS.bouncer
			: cell.via === 'toxiproxy'
				? PORTS.toxiproxy
				: PORTS.postgres;
	return defaultTarget(port);
}

async function runCell(
	env: BenchEnv,
	cell: Cell,
	verify = false,
): Promise<Record<string, unknown>> {
	if (cell.via === 'toxiproxy') await setLatency(cell.rtt ?? 0);
	const job: Job = {
		driver: cell.driver,
		scenario: cell.scenario,
		target: targetFor(cell),
		caFile: env.caFile,
		max: cell.max,
		concurrency: cell.concurrency,
		pipeline: cell.pipeline,
		durationMs: QUICK ? 150 : cell.durationMs,
		warmupMs: QUICK ? 50 : undefined,
		verify,
		memOps: cell.memOps,
	};
	const [cmd, ...rest] = command(JSON.stringify(job));
	const child = spawn(cmd!, rest, {
		cwd: import.meta.dirname,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, TZ: 'UTC', NODE_ENV: 'production', NO_COLOR: '1' },
	});
	let stderr = '';
	child.stderr.on('data', (b: Buffer) => {
		stderr = (stderr + b.toString()).slice(-4000);
	});
	let last = '';
	const lines = createInterface({ input: child.stdout });
	const timeout = setTimeout(
		() => child.kill('SIGKILL'),
		cell.scenario === 'reconnect' ? 60_000 : 240_000,
	);
	for await (const line of lines) {
		if (line === 'READY') {
			const { down, up } = restartPostgres(env);
			child.stdin.write(`UP ${down} ${up}\n`);
		} else if (line.startsWith('{')) last = line;
	}
	if (child.exitCode === null && child.signalCode === null)
		await new Promise((r) => child.once('exit', r));
	clearTimeout(timeout);
	try {
		return JSON.parse(last);
	} catch {
		return {
			ok: false,
			error: `no result (exit ${child.exitCode}); stderr: ${stderr}`,
		};
	}
}

const sh = (cmd: string) => {
	try {
		return execSync(cmd, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
	} catch {
		return 'n/a';
	}
};
const pkg = (name: string) => {
	try {
		return JSON.parse(
			readFileSync(
				join(import.meta.dirname, 'node_modules', name, 'package.json'),
				'utf8',
			),
		).version;
	} catch {
		return 'n/a';
	}
};
function versions(): Record<string, string> {
	return {
		node: process.version,
		postgresql: sh(
			`${process.env['PG_BIN'] ?? '/usr/lib/postgresql/18/bin'}/postgres --version`,
		),
		pgbouncer: sh('/usr/sbin/pgbouncer --version').split('\n')[0] ?? 'n/a',
		toxiproxy: sh(
			`${process.env['BENCH_BIN'] ?? `${process.env['HOME']}/benchbin`}/toxiproxy-server -version`,
		),
		libpq: sh('pg_config --version'),
		pg: pkg('pg'),
		'pg-native': pkg('pg-native'),
		'postgres.js': pkg('postgres'),
		'@neondatabase/serverless': pkg('@neondatabase/serverless'),
		'pg-cursor': pkg('pg-cursor'),
		'pg-copy-streams': pkg('pg-copy-streams'),
		quarry: sh('git -C ../../.. rev-parse --short HEAD'),
		kernel: release(),
		os: sh('. /etc/os-release && echo $PRETTY_NAME'),
	};
}

async function main() {
	mkdirSync(OUT, { recursive: true });
	const env = await startEnv(arg('dir'));
	const rawFile = join(OUT, 'raw.jsonl');
	const done = new Set<string>();
	if (existsSync(rawFile))
		for (const line of readFileSync(rawFile, 'utf8')
			.split('\n')
			.filter(Boolean)) {
			const r = JSON.parse(line);
			done.add(`${cellKey(r.cell)}#${r.run}`);
		}
	const meta = {
		id: ID,
		started: new Date().toISOString(),
		seed: SEED,
		runs: RUNS,
		quick: QUICK,
		phases: PHASES,
		runtimes: ['node'],
		cpu: cpus()[0]?.model,
		cores: cpus().length,
		memoryGB: Math.round(totalmem() / 2 ** 30),
		pinning: CPUS,
		versions: versions(),
		serverConfig: env.serverConfig,
		bouncerConfig: env.bouncerConfig,
		drivers: Object.fromEntries(
			Object.entries(DRIVERS).map(([k, v]) => [k, v.describe]),
		),
	};
	writeFileSync(
		join(OUT, `meta-${Date.now()}.json`),
		JSON.stringify(meta, null, 2),
	);
	const random = mulberry32(SEED);
	try {
		for (const phase of PHASES) {
			const cells = matrix(phase);
			const runs = phase === 'verify' ? 1 : RUNS;
			// phases with server restarts run in order; everything else interleaves runs of every cell
			const queue = shuffle(
				cells.flatMap((cell) =>
					Array.from({ length: runs }, (_, run) => ({ cell, run })),
				),
				random,
			).filter((j) => !done.has(`${cellKey(j.cell)}#${j.run}`));
			console.error(
				`phase ${phase}: ${cells.length} cells × ${runs} runs, ${queue.length} to do`,
			);
			let i = 0;
			const started = Date.now();
			const worker = async () => {
				while (i < queue.length) {
					const { cell, run } = queue[i++]!;
					const result = await runCell(env, cell, phase === 'verify');
					appendFileSync(
						rawFile,
						`${JSON.stringify({ cell, run, at: Date.now(), result })}\n`,
					);
					const r = result as {
						ok?: boolean;
						throughput?: number;
						lat?: { p50: number };
						error?: string;
						unsupported?: boolean;
						digest?: string;
					};
					const eta =
						(((Date.now() - started) / i) * (queue.length - i)) / 60000;
					console.error(
						`[${phase} ${i}/${queue.length} eta ${eta.toFixed(0)}m] ${cell.driver} ${cell.scenario} via=${cell.via} max=${cell.max} c=${cell.concurrency ?? '-'} rtt=${cell.rtt ?? '-'} p=${cell.pipeline ?? '-'} → ` +
							(r.ok
								? (r.digest ??
									`${r.throughput?.toFixed(0)}/s p50=${((r.lat?.p50 ?? 0) * 1000).toFixed(0)}µs`)
								: r.unsupported
									? 'unsupported'
									: `ERROR ${r.error?.slice(0, 300)}`),
					);
				}
			};
			// the simulated RTT and server restarts are global
			const parallel = [
				'reconnect',
				'rtt',
				'pipeline',
				'batch',
				'builder',
			].includes(phase)
				? 1
				: PARALLEL;
			await Promise.all(Array.from({ length: parallel }, worker));
		}
	} finally {
		await setLatency(0).catch(() => {});
		stopChildren();
	}
	console.error(`results: ${rawFile}`);
	process.exit(0);
}

await main();
