/* oxlint-disable no-await-in-loop -- measurements run one at a time */
/**
 * Footprint and cold start: per client, install size and dependency count
 * (a clean `npm install` of the published package), minified bundle size
 * (esbuild, platform node), module import time and process-start → first
 * query result, on each runtime. Needs the environment from env.ts running
 * (orchestrate.ts starts it; or run this after `node env-up.ts`).
 *
 *   node footprint.ts [--id name] [--reps 15]
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { CPUS, startEnv, stopChildren } from './env.ts';

const args = process.argv.slice(2);
const arg = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const REPS = Number(arg('reps') ?? 15);
const ID = arg('id') ?? 'footprint';
const OUT = join(import.meta.dirname, 'results', ID);
const ROOT = join(import.meta.dirname, '..', '..', '..');

function duBytes(dir: string): number {
	return Number(execFileSync('du', ['-sb', dir], { encoding: 'utf8' }).split('\t')[0]);
}

function countPackages(nodeModules: string): number {
	let n = 0;
	const walk = (dir: string) => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.startsWith('.')) continue;
			const p = join(dir, e);
			if (e.startsWith('@')) walk(p);
			else {
				try {
					statSync(join(p, 'package.json'));
					n++;
					walk(join(p, 'node_modules'));
				} catch {
					// not a package
				}
			}
		}
	};
	walk(nodeModules);
	return n;
}

function install(specs: string[]): { bytes: number; packages: number } {
	const dir = mkdtempSync(join(tmpdir(), 'bench-install-'));
	try {
		writeFileSync(join(dir, 'package.json'), '{"name":"x","private":true}');
		execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', ...specs], { cwd: dir, stdio: 'pipe' });
		const nm = join(dir, 'node_modules');
		return { bytes: duBytes(nm), packages: countPackages(nm) };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function bundle(name: string, source: string, external: string[] = []): Promise<{ bytes: number; gzip: number }> {
	const result = await build({
		stdin: { contents: source, resolveDir: import.meta.dirname, loader: 'js' },
		bundle: true,
		minify: true,
		platform: 'node',
		format: 'esm',
		write: false,
		external,
		logLevel: 'silent',
	});
	const code = result.outputFiles[0]!.contents;
	writeFileSync(join(OUT, `bundle-${name}.js`), code);
	return { bytes: code.byteLength, gzip: gzipSync(code, { level: 9 }).byteLength };
}

const median = (v: number[]) => v.toSorted((a, b) => a - b)[Math.floor(v.length / 2)] ?? Number.NaN;

async function main() {
	mkdirSync(OUT, { recursive: true });
	await startEnv(arg('dir'));
	const out: Record<string, unknown> = {};

	// ---- install size (published packages, production deps only)
	execSync('pnpm pack --pack-destination ' + OUT, { cwd: ROOT, stdio: 'pipe' });
	const tarball = readdirSync(OUT).find((f) => f.startsWith('quarry-') && f.endsWith('.tgz'))!;
	const installs: Record<string, unknown> = {
		'quarry (whole package: query builder + driver + src)': install([join(OUT, tarball)]),
		pg: install(['pg@8.23.1']),
		'pg + pg-native (libpq addon, built)': install(['pg@8.23.1', 'pg-native@3.9.1']),
		'postgres.js': install(['postgres@3.4.9']),
		'@neondatabase/serverless (+ ws on Node)': install(['@neondatabase/serverless@1.2.0', 'ws@8.22.0']),
	};
	try {
		const info = JSON.parse(execFileSync('deno', ['info', '--json', 'jsr:@db/postgres@0.19.5'], { encoding: 'utf8' }));
		const modules = info.modules as { size?: number; specifier: string }[];
		const pkgs = new Set(modules.map((m) => /jsr\.io\/(@[^/]+\/[^/]+)\//.exec(m.specifier)?.[1]).filter(Boolean));
		installs['deno-postgres (jsr, source modules)'] = { bytes: modules.reduce((a, m) => a + (m.size ?? 0), 0), packages: pkgs.size };
	} catch (error) {
		installs['deno-postgres (jsr, source modules)'] = { error: String(error) };
	}
	installs['Bun.sql (built into Bun)'] = { bytes: 0, packages: 0 };
	out['install'] = installs;
	console.error('install sizes done');

	// ---- bundle size: an app that creates a pool and runs a query
	out['bundle'] = {
		'quarry/driver': await bundle('quarry', `import { createPool } from '${join(ROOT, 'dist/driver/index.js')}'; const p = createPool(process.env.DATABASE_URL); console.log((await p.query('select 1')).rows);`),
		pg: await bundle('pg', `import pg from 'pg'; const p = new pg.Pool(); console.log((await p.query('select 1')).rows);`, ['pg-native']),
		'postgres.js': await bundle('postgres', `import postgres from 'postgres'; const sql = postgres(); console.log(await sql\`select 1\`);`),
		'@neondatabase/serverless': await bundle('neon', `import { Pool } from '@neondatabase/serverless'; const p = new Pool(); console.log((await p.query('select 1')).rows);`),
		'pg-native': { note: 'native addon (libpq .node + libpq.so): not bundleable' },
	};
	console.error('bundles done');

	// ---- cold start
	const runtimes: Record<string, (driver: string) => string[]> = {
		node: (d) => ['node', 'cold.ts', d, '55432'],
		bun: (d) => ['bun', 'cold.ts', d, '55432'],
		deno: (d) => ['deno', 'run', '-A', '--no-lock', 'cold.ts', d, '55432'],
	};
	const support: Record<string, string[]> = {
		node: ['none', 'quarry', 'pg', 'pg-native', 'postgres.js', 'neon'],
		bun: ['none', 'quarry', 'pg', 'postgres.js', 'bun.sql'],
		deno: ['none', 'quarry', 'pg', 'postgres.js', 'deno-postgres'],
	};
	const cold: Record<string, unknown> = {};
	for (const [runtime, cmd] of Object.entries(runtimes)) {
		for (const driver of support[runtime]!) {
			const samples: { importMs: number; firstQueryMs: number; sinceStartMs: number; wallMs: number }[] = [];
			for (let r = 0; r < REPS + 2; r++) {
				const t = performance.now();
				const line = execFileSync('taskset', ['-c', CPUS.client, ...cmd(driver)], {
					cwd: import.meta.dirname,
					encoding: 'utf8',
					env: { ...process.env, NO_COLOR: '1' },
					stdio: ['ignore', 'pipe', 'ignore'],
				}).trim().split('\n').pop()!;
				const wallMs = performance.now() - t;
				if (r >= 2) samples.push({ ...JSON.parse(line), wallMs });
			}
			cold[`${runtime}/${driver}`] = {
				importMs: median(samples.map((s) => s.importMs)),
				firstQueryMs: median(samples.map((s) => s.firstQueryMs)),
				sinceStartMs: median(samples.map((s) => s.sinceStartMs)),
				wallMs: median(samples.map((s) => s.wallMs)),
				reps: samples.length,
			};
			console.error(`cold ${runtime}/${driver}`, cold[`${runtime}/${driver}`]);
		}
	}
	out['cold'] = cold;
	out['driverDistBytes'] = statSync(join(ROOT, 'dist/driver/index.js')).size;
	writeFileSync(join(OUT, 'footprint.json'), JSON.stringify(out, null, 2));
	console.error(`wrote ${join(OUT, 'footprint.json')}`);
	stopChildren();
	process.exit(0);
}

await main();
