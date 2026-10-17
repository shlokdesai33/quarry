/**
 * Aggregates results: for every cell, the median across runs of each
 * metric with a bootstrap 95% confidence interval of that median. Writes
 * `summary.json` (for charts.py) and `tables.md` next to the raw results.
 *
 *   node analyze.ts --id <results id> [--id <another id> …] [--out <dir>]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { byId, SCENARIOS, TYPE_NAMES } from './scenarios.ts';

const args = process.argv.slice(2);
const ids = args.flatMap((a, i) => (a === '--id' ? [args[i + 1]!] : []));
const outDir = args.includes('--out')
	? args[args.indexOf('--out') + 1]!
	: join(import.meta.dirname, 'results', ids[0]!);

interface Raw {
	cell: {
		phase: string;
		runtime: string;
		driver: string;
		scenario: string;
		via: string;
		max: number;
		concurrency?: number;
		pipeline?: number;
		rtt?: number;
		memOps?: number;
	};
	run: number;
	result: Record<string, any>;
}

const raws: Raw[] = ids.flatMap((id) => {
	const file = join(import.meta.dirname, 'results', id, 'raw.jsonl');
	return existsSync(file)
		? readFileSync(file, 'utf8')
				.split('\n')
				.filter(Boolean)
				.map((l) => JSON.parse(l) as Raw)
		: [];
});

// ------------------------------------------------------------ statistics

function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const median = (v: readonly number[]) => {
	const s = v.toSorted((a, b) => a - b);
	const m = s.length >> 1;
	return s.length === 0
		? Number.NaN
		: s.length % 2
			? s[m]!
			: (s[m - 1]! + s[m]!) / 2;
};
/** Bootstrap 95% CI of the median. */
function ci(v: readonly number[]): [number, number] {
	if (v.length < 2) return [v[0] ?? Number.NaN, v[0] ?? Number.NaN];
	const random = mulberry32(12345);
	const meds: number[] = [];
	for (let b = 0; b < 2000; b++)
		meds.push(
			median(
				Array.from(
					{ length: v.length },
					() => v[Math.floor(random() * v.length)]!,
				),
			),
		);
	meds.sort((a, b) => a - b);
	return [meds[49]!, meds[1949]!];
}

export interface Stat {
	readonly median: number;
	readonly lo: number;
	readonly hi: number;
	readonly n: number;
}
const stat = (v: number[]): Stat => {
	const clean = v.filter((x) => Number.isFinite(x));
	const [lo, hi] = ci(clean);
	return { median: median(clean), lo, hi, n: clean.length };
};

const METRICS: Record<string, (r: Record<string, any>) => number> = {
	throughput: (r) => r['throughput'],
	p50: (r) => r['lat']?.p50,
	p90: (r) => r['lat']?.p90,
	p99: (r) => r['lat']?.p99,
	p999: (r) => r['lat']?.p999,
	pmax: (r) => r['lat']?.max,
	mean: (r) => r['lat']?.mean,
	cpuUsPerOp: (r) => r['cpuUsPerOp'],
	serverCpuUsPerOp: (r) => r['serverCpuUsPerOp'] ?? Number.NaN,
	rssPeakMB: (r) => r['rssPeakMB'],
	rssBaseMB: (r) => r['rssBaseMB'],
	heapPeakMB: (r) => r['heapPeakMB'],
	gcMsPerSec: (r) =>
		r['gc'] ? (r['gc'].totalMs / r['elapsedMs']) * 1000 : Number.NaN,
	gcMaxMs: (r) => r['gc']?.maxMs ?? Number.NaN,
	lagP99: (r) => r['loopLag']?.p99,
	lagMax: (r) => r['loopLag']?.max,
	recoveryMs: (r) => r['extra']?.recoveredMsAfterUp ?? Number.NaN,
	failedQueries: (r) => r['extra']?.failedQueries ?? Number.NaN,
	cancelled: (r) =>
		r['extra']?.rejected === undefined
			? Number.NaN
			: (r['extra'].rejected / r['ops']) * 100,
	rssGrowthMB: (r) => r['extra']?.rssGrowthMB ?? Number.NaN,
};

const keyOf = (c: Raw['cell']) =>
	[
		c.phase,
		c.runtime,
		c.driver,
		c.scenario,
		c.via,
		c.max,
		c.concurrency ?? '',
		c.pipeline ?? '',
		c.rtt ?? '',
		c.memOps ?? '',
	].join('|');

interface Agg {
	cell: Raw['cell'];
	runs: number;
	errors: string[];
	unsupported: boolean;
	m: Record<string, Stat>;
	digest?: string;
}
const groups = new Map<string, Raw[]>();
for (const r of raws) {
	const k = keyOf(r.cell);
	groups.set(k, [...(groups.get(k) ?? []), r]);
}
const aggs = new Map<string, Agg>();
for (const [k, rs] of groups) {
	const ok = rs.filter((r) => r.result['ok']);
	const m: Record<string, Stat> = {};
	for (const [name, f] of Object.entries(METRICS))
		m[name] = stat(ok.map((r) => f(r.result)));
	aggs.set(k, {
		cell: rs[0]!.cell,
		runs: ok.length,
		errors: rs
			.filter((r) => !r.result['ok'] && !r.result['unsupported'])
			.map((r) => String(r.result['error']).slice(0, 300)),
		unsupported: rs.some((r) => r.result['unsupported']),
		m,
		...(ok[0]?.result['digest'] ? { digest: ok[0].result['digest'] } : {}),
	});
}

function get(
	phase: string,
	runtime: string,
	driver: string,
	scenario: string,
	extra: Partial<Raw['cell']> = {},
): Agg | undefined {
	for (const a of aggs.values()) {
		const c = a.cell;
		if (
			c.phase !== phase ||
			c.runtime !== runtime ||
			c.driver !== driver ||
			c.scenario !== scenario
		)
			continue;
		if (extra.via !== undefined && c.via !== extra.via) continue;
		if (extra.max !== undefined && c.max !== extra.max) continue;
		if (
			(extra.concurrency ?? null) !== (c.concurrency ?? null) &&
			'concurrency' in extra
		)
			continue;
		if (
			(extra.pipeline ?? null) !== (c.pipeline ?? null) &&
			'pipeline' in extra
		)
			continue;
		if ((extra.rtt ?? null) !== (c.rtt ?? null) && 'rtt' in extra) continue;
		// equal-work memory cells only when asked for
		if ((extra.memOps ?? null) !== (c.memOps ?? null)) continue;
		return a;
	}
	return undefined;
}

// ------------------------------------------------------------ formatting

const LABEL: Record<string, string> = {
	quarry: 'quarry',
	'quarry-candidate': 'quarry (candidate)',
	'quarry-lossless': 'quarry (lossless)',
	'quarry-noprep': 'quarry (prepare: false)',
	'quarry-nopipe': 'quarry (pipeline: false)',
	pg: 'pg',
	'pg-named': 'pg (named)',
	'pg-native': 'pg-native',
	'pg-native-named': 'pg-native (named)',
	'postgres.js': 'postgres.js',
	'postgres.js-noprep': 'postgres.js (prepare: false)',
	'bun.sql': 'Bun.sql',
	'bun.sql-noprep': 'Bun.sql (prepare: false)',
	neon: 'neon (WS)',
	'neon-default': 'neon (WS, defaults)',
	'deno-postgres': 'deno-postgres (stock)',
	'deno-postgres-nodelay': 'deno-postgres (+nodelay)',
};
const label = (d: string) => LABEL[d] ?? d;

function fmtTime(ms: number): string {
	if (!Number.isFinite(ms)) return '—';
	if (ms < 1) return `${(ms * 1000).toFixed(ms < 0.1 ? 1 : 0)} µs`;
	if (ms < 100) return `${ms.toFixed(2)} ms`;
	if (ms < 10_000) return `${ms.toFixed(0)} ms`;
	return `${(ms / 1000).toFixed(1)} s`;
}
const fmtRate = (v: number) =>
	Number.isFinite(v)
		? v >= 100
			? Math.round(v).toLocaleString('en-US')
			: v.toFixed(1)
		: '—';
const fmtNum = (v: number, digits = 1) =>
	Number.isFinite(v)
		? v.toLocaleString('en-US', {
				maximumFractionDigits: digits,
				minimumFractionDigits: digits,
			})
		: '—';
const pm = (s: Stat) =>
	Number.isFinite(s.median) && s.n > 1 && s.median !== 0
		? ` ±${(Math.max(Math.abs(s.hi - s.median), Math.abs(s.median - s.lo)) / Math.abs(s.median)) * 100 < 0.5 ? '<1' : ((Math.max(Math.abs(s.hi - s.median), Math.abs(s.median - s.lo)) / Math.abs(s.median)) * 100).toFixed(0)}%`
		: '';

type Fmt = (v: number) => string;
/**
 * A table: one row per `rows` entry, one column per driver. `pick` returns
 * the Stat for a row and driver; best per row is bold (`lower` = lower is
 * better). `ci` appends ±% of the bootstrap CI.
 */
function table(
	title: string,
	rowHead: string,
	rows: {
		label: string;
		pick: (driver: string) => Stat | undefined | 'unsupported';
		lower?: boolean;
		fmt?: Fmt;
	}[],
	drivers: readonly string[],
	fmt: Fmt,
	lower: boolean,
	withCi = false,
): string {
	const present = drivers.filter((d) =>
		rows.some((r) => {
			const s = r.pick(d);
			return s !== undefined;
		}),
	);
	if (present.length === 0 || rows.length === 0) return '';
	const lines = [
		`**${title}**`,
		'',
		`| ${rowHead} | ${present.map(label).join(' | ')} |`,
		`|---|${present.map(() => '---:').join('|')}|`,
	];
	for (const r of rows) {
		const cells = present.map((d) => r.pick(d));
		const values = cells.map((c) =>
			c && c !== 'unsupported' ? c.median : Number.NaN,
		);
		const finite = values.filter(Number.isFinite);
		if (finite.length === 0) continue;
		const rowLower = r.lower ?? lower;
		const rowFmt = r.fmt ?? fmt;
		const best = rowLower ? Math.min(...finite) : Math.max(...finite);
		lines.push(
			`| ${r.label} | ${cells
				.map((c, i) => {
					if (c === 'unsupported') return 'n/a';
					if (!c || !Number.isFinite(values[i]!)) return '—';
					const text = rowFmt(values[i]!) + (withCi ? pm(c) : '');
					return values[i] === best && finite.length > 1 ? `**${text}**` : text;
				})
				.join(' | ')} |`,
		);
	}
	return lines.join('\n') + '\n';
}

const metric =
	(name: string) =>
	(a: Agg | undefined): Stat | undefined | 'unsupported' =>
		a
			? a.unsupported
				? 'unsupported'
				: a.runs > 0
					? a.m[name]
					: undefined
			: undefined;
const mainPick =
	(
		runtime: string,
		scenario: string,
		name: string,
		transform?: (v: number) => number,
	) =>
	(driver: string) => {
		const s = metric(name)(get('main', runtime, driver, scenario));
		if (!s || s === 'unsupported' || !transform) return s;
		return {
			median: transform(s.median),
			lo: transform(s.lo),
			hi: transform(s.hi),
			n: s.n,
		};
	};

const RUNTIMES = ['node', 'bun', 'deno'];
const RT = { node: 'Node 24', bun: 'Bun 1.4', deno: 'Deno 2.9' } as Record<
	string,
	string
>;
const driversIn = (phase: string, runtime: string) => {
	const order = Object.keys(LABEL);
	const seen = new Set<string>();
	for (const a of aggs.values())
		if (a.cell.phase === phase && a.cell.runtime === runtime)
			seen.add(a.cell.driver);
	return order.filter((d) => seen.has(d));
};
const CORE = new Set([
	'quarry',
	'quarry-candidate',
	'pg',
	'pg-named',
	'pg-native',
	'postgres.js',
	'neon',
	'bun.sql',
	'deno-postgres-nodelay',
]);
const coreIn = (phase: string, runtime: string) =>
	driversIn(phase, runtime).filter((d) => CORE.has(d));

const out: string[] = [];
const summary: Record<string, unknown> = {};
const title = (id: string) => byId.get(id)?.title ?? id;

// ------------------------------------------------------------ correctness
{
	const lines = [
		'### Correctness',
		'',
		'Every result compared in canonical form (see `canon.ts`) against the majority digest for its runtime and scenario.',
		'',
	];
	const bad: string[] = [];
	let checked = 0;
	for (const runtime of RUNTIMES) {
		const byScenario = new Map<string, Agg[]>();
		for (const a of aggs.values())
			if (a.cell.phase === 'verify' && a.cell.runtime === runtime)
				byScenario.set(a.cell.scenario, [
					...(byScenario.get(a.cell.scenario) ?? []),
					a,
				]);
		for (const [scenario, list] of byScenario) {
			const counts = new Map<string, number>();
			for (const a of list)
				if (a.digest) counts.set(a.digest, (counts.get(a.digest) ?? 0) + 1);
			const majority = [...counts.entries()].toSorted(
				(a, b) => b[1] - a[1],
			)[0]?.[0];
			for (const a of list) {
				if (a.unsupported) continue;
				checked++;
				if (!a.digest)
					bad.push(
						`- ${RT[runtime]} ${label(a.cell.driver)} ${scenario}: error ${a.errors[0] ?? ''}`,
					);
				else if (a.digest !== majority)
					bad.push(
						`- ${RT[runtime]} ${label(a.cell.driver)} ${scenario}: digest ${a.digest} ≠ majority ${majority}`,
					);
			}
		}
	}
	lines.push(
		`${checked} (runtime, client, scenario) results checked; ${bad.length} differ from the majority${bad.length ? ':' : '.'}`,
		'',
		...bad,
		'',
	);
	out.push(lines.join('\n'));
	summary['verify'] = { checked, bad };
}

// ------------------------------------------------------------ errors in runs
{
	const failing = [...aggs.values()].filter((a) => a.errors.length > 0);
	if (failing.length) {
		out.push(
			[
				'### Failed runs',
				'',
				...failing.map(
					(a) =>
						`- ${a.cell.phase} ${a.cell.runtime} ${label(a.cell.driver)} ${a.cell.scenario} (max ${a.cell.max}, c ${a.cell.concurrency ?? '-'}, rtt ${a.cell.rtt ?? '-'}): ${a.errors.length} failed: ${a.errors[0]?.split('\n')[0]}`,
				),
				'',
			].join('\n'),
		);
	}
}

// ------------------------------------------------------------ main tables per runtime
const LAT_SCENARIOS = [
	'select1',
	'pk',
	'range100',
	'fetch1k',
	'params100',
	'params1000',
	'any1000-js',
	'insert1',
	'insert-multi100',
	'update',
	'upsert',
	'delete',
	'tx-empty',
	'tx-insert',
	'savepoints',
	'error',
	'notify-latency',
];
const BIG = [
	'fetch100k',
	'fetch1m',
	'wide',
	'large-text',
	'large-bytea',
	'large-jsonb',
	'arrays',
	'bulk-unnest',
	'bulk-unnest-js',
	'bulk-unnest-js1k',
	'bulk-copy',
	'stream1m',
	'stream-slow',
];
for (const runtime of RUNTIMES) {
	const drivers = coreIn('main', runtime);
	if (drivers.length === 0) continue;
	out.push(`## ${RT[runtime]}\n`);
	out.push(
		table(
			`${RT[runtime]}: median latency (p50), sequential (one query at a time)`,
			'Scenario',
			LAT_SCENARIOS.map((s) => ({
				label: title(s),
				pick: mainPick(runtime, s, 'p50'),
			})),
			drivers,
			fmtTime,
			true,
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: throughput, sequential (operations/s)`,
			'Scenario',
			LAT_SCENARIOS.map((s) => ({
				label: title(s),
				pick: mainPick(runtime, s, 'throughput'),
			})),
			drivers,
			fmtRate,
			false,
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: tail latency p99, sequential`,
			'Scenario',
			LAT_SCENARIOS.map((s) => ({
				label: title(s),
				pick: mainPick(runtime, s, 'p99'),
			})),
			drivers,
			fmtTime,
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: tail latency p99.9, sequential`,
			'Scenario',
			LAT_SCENARIOS.map((s) => ({
				label: title(s),
				pick: mainPick(runtime, s, 'p999'),
			})),
			drivers,
			fmtTime,
			true,
		),
	);
	for (const s of ['select1', 'pk']) {
		out.push(
			table(
				`${RT[runtime]}: latency distribution, ${title(s)}`,
				'Percentile',
				['p50', 'p90', 'p99', 'p999', 'pmax'].map((p) => ({
					label: p === 'p999' ? 'p99.9' : p === 'pmax' ? 'max' : p,
					pick: mainPick(runtime, s, p),
				})),
				drivers,
				fmtTime,
				true,
				true,
			),
		);
	}
	out.push(
		table(
			`${RT[runtime]}: large results and bulk work, time per operation (median)`,
			'Scenario',
			BIG.map((s) => ({ label: title(s), pick: mainPick(runtime, s, 'p50') })),
			drivers,
			fmtTime,
			true,
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: rows per second (median)`,
			'Scenario',
			[
				'fetch1k',
				'fetch100k',
				'fetch1m',
				'wide',
				'arrays',
				'stream1m',
				'bulk-unnest',
				'bulk-unnest-js',
				'bulk-unnest-js1k',
				'bulk-copy',
			].map((s) => ({
				label: title(s),
				pick: mainPick(
					runtime,
					s,
					'throughput',
					(v) => v * (byId.get(s) as { rowsPerOp?: number }).rowsPerOp!,
				),
			})),
			drivers,
			fmtRate,
			false,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)`,
			'Scenario',
			SCENARIOS.filter((s) => s.kind === 'ops' && s.memOps !== undefined).map(
				(s) => ({
					label: `${s.title} × ${(s as { memOps?: number }).memOps}`,
					pick: (driver: string) =>
						metric('rssPeakMB')(
							get('main', runtime, driver, s.id, {
								memOps: (s as { memOps?: number }).memOps,
							}),
						),
				}),
			),
			drivers,
			(v) => fmtNum(v, 0),
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)`,
			'Scenario',
			[
				'pk',
				'fetch100k',
				'fetch1m',
				'stream1m',
				'stream-slow',
				'large-text',
				'large-bytea',
				'large-jsonb',
			].map((s) => ({
				label: title(s),
				pick: mainPick(runtime, s, 'rssPeakMB'),
			})),
			drivers,
			(v) => fmtNum(v, 0),
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream`,
			'Metric',
			[
				{
					label: 'RSS growth during pause',
					pick: mainPick(runtime, 'stream-pause', 'rssGrowthMB'),
				},
			],
			drivers,
			(v) => fmtNum(v, 1),
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: per-type decode cost, ns per value (100k rows × 1 column)`,
			'Type',
			Object.entries(TYPE_NAMES).map(([col, name]) => ({
				label: name,
				pick: mainPick(
					runtime,
					`type-${col}`,
					'p50',
					(v) => (v * 1e6) / 100_000,
				),
			})),
			driversIn('main', runtime).filter(
				(d) => CORE.has(d) || d === 'quarry-lossless',
			),
			(v) => fmtNum(v, 0),
			true,
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: writes, operations/s (bulk rows: batches per second)`,
			'Scenario',
			[
				'insert1',
				'insert1-c50',
				'insert-multi100',
				'bulk-unnest',
				'bulk-unnest-js',
				'bulk-unnest-js1k',
				'bulk-copy',
				'update',
				'upsert',
				'delete',
			].map((s) => ({
				label: title(s),
				pick: mainPick(runtime, s, 'throughput'),
			})),
			drivers,
			fmtRate,
			false,
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: transactions, operations/s`,
			'Scenario',
			['tx-empty', 'tx-insert', 'savepoints'].map((s) => ({
				label: title(s),
				pick: mainPick(runtime, s, 'throughput'),
			})),
			drivers,
			fmtRate,
			false,
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: client CPU per operation (µs, all threads)`,
			'Scenario',
			[
				'select1',
				'pk',
				'fetch1k',
				'fetch100k',
				'insert1',
				'insert1-c50',
				'tx-insert',
				'error',
			].map((s) => ({
				label: title(s),
				pick: mainPick(runtime, s, 'cpuUsPerOp'),
			})),
			drivers,
			(v) => fmtNum(v, v < 100 ? 1 : 0),
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: server CPU per operation (µs, all PostgreSQL processes)`,
			'Scenario',
			[
				'select1',
				'pk',
				'fetch1k',
				'params100',
				'insert1',
				'insert1-c50',
				'tx-insert',
			].map((s) => ({
				label: title(s),
				pick: mainPick(runtime, s, 'serverCpuUsPerOp'),
			})),
			drivers,
			(v) => fmtNum(v, v < 100 ? 1 : 0),
			true,
		),
	);
	if (runtime === 'node') {
		out.push(
			table(
				`${RT[runtime]}: GC time (ms per second of run) / longest GC pause`,
				'Scenario',
				[
					'pk',
					'insert1-c50',
					'fetch1k',
					'fetch100k',
					'fetch1m',
					'wide',
					'large-jsonb',
				].flatMap((s) => [
					{
						label: `${title(s)}: GC ms/s`,
						pick: mainPick(runtime, s, 'gcMsPerSec'),
					},
					{
						label: `${title(s)}: max pause ms`,
						pick: mainPick(runtime, s, 'gcMaxMs'),
					},
				]),
				drivers,
				(v) => fmtNum(v, 1),
				true,
			),
		);
	}
	out.push(
		table(
			`${RT[runtime]}: event-loop lag p99 / max (ms) while the scenario runs`,
			'Scenario',
			[
				'pk',
				'insert1-c50',
				'fetch1k',
				'fetch100k',
				'fetch1m',
				'stream1m',
			].flatMap((s) => [
				{ label: `${title(s)}: p99`, pick: mainPick(runtime, s, 'lagP99') },
				{ label: `${title(s)}: max`, pick: mainPick(runtime, s, 'lagMax') },
			]),
			drivers,
			(v) => fmtNum(v, 1),
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: connections (median time per operation)`,
			'Scenario',
			[
				'connect-plain-trust',
				'connect-plain-scram',
				'connect-tls-trust',
				'connect-tls-scram',
				'pool-warmup',
			].map((s) => ({ label: title(s), pick: mainPick(runtime, s, 'p50') })),
			driversIn('main', runtime).filter(
				(d) => CORE.has(d) || d === 'deno-postgres',
			),
			fmtTime,
			true,
			true,
		),
	);
	out.push(
		table(
			`${RT[runtime]}: cancellation, notifications, errors`,
			'Scenario',
			[
				{
					label: 'cancel: time from cancel() to rejection (p50)',
					pick: mainPick(runtime, 'cancel', 'p50'),
					lower: true,
					fmt: fmtTime,
				},
				{
					label: 'cancel: share of queries actually cancelled',
					pick: mainPick(runtime, 'cancel', 'cancelled'),
					lower: false,
					fmt: (v) => `${v.toFixed(0)}%`,
				},
				{
					label: 'NOTIFY latency p50',
					pick: mainPick(runtime, 'notify-latency', 'p50'),
					lower: true,
					fmt: fmtTime,
				},
				{
					label: 'NOTIFY latency p99',
					pick: mainPick(runtime, 'notify-latency', 'p99'),
					lower: true,
					fmt: fmtTime,
				},
				{
					label: 'NOTIFY throughput (notifications/s)',
					pick: mainPick(
						runtime,
						'notify-throughput',
						'throughput',
						(v) => v * 20_000,
					),
					lower: false,
					fmt: fmtRate,
				},
				{
					label: 'error path: failing queries/s',
					pick: mainPick(runtime, 'error', 'throughput'),
					lower: false,
					fmt: fmtRate,
				},
			],
			drivers,
			fmtRate,
			false,
		),
	);
	// prepared vs unprepared
	const pairs: [string, string][] =
		runtime === 'node'
			? [
					['quarry', 'quarry-noprep'],
					['pg-named', 'pg'],
					['pg-native-named', 'pg-native'],
					['postgres.js', 'postgres.js-noprep'],
				]
			: runtime === 'bun'
				? [
						['quarry', 'quarry-noprep'],
						['pg-named', 'pg'],
						['postgres.js', 'postgres.js-noprep'],
						['bun.sql', 'bun.sql-noprep'],
					]
				: [
						['quarry', 'quarry-noprep'],
						['pg-named', 'pg'],
						['postgres.js', 'postgres.js-noprep'],
					];
	const prepRows: string[] = [
		`**${RT[runtime]}: prepared vs unprepared, operations/s (prepared / unprepared / gain)**`,
		'',
		`| Scenario | ${pairs.map(([p]) => label(p.replace(/-named$/, ''))).join(' | ')} |`,
		`|---|${pairs.map(() => '---:').join('|')}|`,
	];
	for (const s of [
		'select1',
		'pk',
		'range100',
		'fetch1k',
		'params100',
		'params1000',
		'insert1',
		'upsert',
	]) {
		prepRows.push(
			`| ${title(s)} | ${pairs
				.map(([p, u]) => {
					const a =
						get('main', runtime, p, s)?.m['throughput']?.median ?? Number.NaN;
					const b =
						get('main', runtime, u, s)?.m['throughput']?.median ?? Number.NaN;
					return Number.isFinite(a) && Number.isFinite(b)
						? `${fmtRate(a)} / ${fmtRate(b)} / ${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(0)}%`
						: '—';
				})
				.join(' | ')} |`,
		);
	}
	out.push(prepRows.join('\n') + '\n');
	// lossless vs compat decoding
	if (driversIn('main', runtime).includes('quarry-lossless')) {
		out.push(
			table(
				`${RT[runtime]}: quarry decoding modes (time per op)`,
				'Scenario',
				[
					'pk',
					'fetch1k',
					'fetch100k',
					'fetch1m',
					'wide',
					'arrays',
					'type-i8',
					'type-ts',
					'type-d',
				].map((s) => ({ label: title(s), pick: mainPick(runtime, s, 'p50') })),
				['quarry', 'quarry-lossless'],
				fmtTime,
				true,
				true,
			),
		);
	}
	const variants = driversIn('main', runtime).filter(
		(d) => d === 'neon-default' || d === 'deno-postgres',
	);
	if (variants.length) {
		const base = variants.map((v) =>
			v === 'neon-default' ? 'neon' : 'deno-postgres-nodelay',
		);
		out.push(
			table(
				`${RT[runtime]}: shipped defaults vs tuned (median latency)`,
				'Scenario',
				[
					'select1',
					'pk',
					'fetch1k',
					'insert1',
					'tx-insert',
					'connect-plain-trust',
				].map((s) => ({ label: title(s), pick: mainPick(runtime, s, 'p50') })),
				[...base, ...variants],
				fmtTime,
				true,
			),
		);
	}
}

// ------------------------------------------------------------ cross-runtime
{
	const rows = [
		'select1',
		'pk',
		'fetch1k',
		'fetch100k',
		'insert1',
		'insert1-c50',
		'tx-insert',
	];
	const cols: [string, string][] = [];
	for (const runtime of RUNTIMES)
		for (const d of coreIn('main', runtime)) cols.push([runtime, d]);
	if (cols.length) {
		const lines = [
			'## Across runtimes',
			'',
			'**Throughput (operations/s) by runtime**',
			'',
			`| Scenario | ${cols.map(([r, d]) => `${label(d)} (${r})`).join(' | ')} |`,
			`|---|${cols.map(() => '---:').join('|')}|`,
		];
		for (const s of rows)
			lines.push(
				`| ${title(s)} | ${cols.map(([r, d]) => fmtRate(get('main', r, d, s)?.m['throughput']?.median ?? Number.NaN)).join(' | ')} |`,
			);
		out.push(lines.join('\n') + '\n');
	}
}

// ------------------------------------------------------------ concurrency sweep
const CONC = [1, 10, 50, 100, 500, 1000];
const POOLS = [1, 5, 10, 50];
summary['conc'] = {};
for (const runtime of RUNTIMES) {
	const drivers = driversIn('conc', runtime);
	if (drivers.length === 0) continue;
	out.push(`## Concurrency sweep (${RT[runtime]}): point lookups/s\n`);
	const data: Record<
		string,
		Record<string, Record<string, Stat | undefined>>
	> = {};
	for (const max of POOLS) {
		out.push(
			table(
				`${RT[runtime]}: pool size ${max}, point lookups/s by concurrency`,
				'Concurrency',
				CONC.map((c) => ({
					label: String(c),
					pick: (d: string) =>
						metric('throughput')(
							get('conc', runtime, d, 'pk', { max, concurrency: c }),
						),
				})),
				drivers,
				fmtRate,
				false,
				true,
			),
		);
		out.push(
			table(
				`${RT[runtime]}: pool size ${max}, p99 latency by concurrency`,
				'Concurrency',
				CONC.map((c) => ({
					label: String(c),
					pick: (d: string) =>
						metric('p99')(
							get('conc', runtime, d, 'pk', { max, concurrency: c }),
						),
				})),
				drivers,
				fmtTime,
				true,
			),
		);
		for (const d of drivers)
			for (const c of CONC) {
				const a = get('conc', runtime, d, 'pk', { max, concurrency: c });
				((data[d] ??= {})[String(max)] ??= {})[String(c)] = a?.m['throughput'];
			}
	}
	(summary['conc'] as Record<string, unknown>)[runtime] = data;
}

// ------------------------------------------------------------ pipelining depth
{
	const rows: {
		label: string;
		pick: (d: string) => Stat | undefined | 'unsupported';
	}[] = [];
	// undefined: the default, adaptive depth
	const depths = [1, 2, 4, 8, 16, 32, 64, 100, undefined];
	const series: Record<string, Record<string, Stat | undefined>> = {};
	for (const rtt of [0, 5]) {
		for (const p of depths) {
			const a = get('pipeline', 'node', 'quarry', 'pk', { pipeline: p, rtt });
			(series[String(rtt)] ??= {})[p === undefined ? 'adaptive' : String(p)] =
				a?.m['throughput'];
		}
	}
	for (const p of depths)
		rows.push({
			label: p === undefined ? 'adaptive (default)' : String(p),
			pick: (rtt) =>
				metric('throughput')(
					get('pipeline', 'node', 'quarry', 'pk', {
						pipeline: p,
						rtt: Number(rtt),
					}),
				),
		});
	const t = table(
		'quarry, one connection, 100 concurrent point lookups: throughput by `pipeline` depth (columns: RTT ms)',
		'pipeline',
		rows,
		['0', '5'],
		fmtRate,
		false,
		true,
	);
	if (t) out.push(`## Pipelining depth\n\n${t}`);
	summary['pipeline'] = series;
}

// ------------------------------------------------------------ db.batch
{
	const batchIds = SCENARIOS.filter((s) => s.group === 'batches').map(
		(s) => s.id,
	);
	const series: Record<string, Record<string, Stat | undefined>> = {};
	for (const id of batchIds)
		for (const rtt of [0, 5])
			(series[id] ??= {})[String(rtt)] = get('batch', 'node', 'quarry-db', id, {
				rtt,
			})?.m['throughput'];
	const t = table(
		"quarry's query builder, 3 statements per operation: operations/s (columns: RTT ms)",
		'Scenario',
		batchIds.map((id) => ({
			label: title(id),
			pick: (rtt: string) =>
				metric('throughput')(
					get('batch', 'node', 'quarry-db', id, { rtt: Number(rtt) }),
				),
		})),
		['0', '5'],
		fmtRate,
		false,
		true,
	);
	if (t) out.push(`## db.batch\n\n${t}`);
	summary['batch'] = series;
}

// ------------------------------------------------------------ RTT sweep
summary['rtt'] = {};
{
	const variants: [string, number, number | undefined, string][] = [
		['select1', 10, undefined, 'select 1, sequential'],
		['pk', 10, undefined, 'point lookup, sequential'],
		['pk', 10, 50, 'point lookup, 50 concurrent, pool 10'],
		['pk', 1, 100, 'point lookup, 100 concurrent, pool 1 (pipelining)'],
		['pk', 1, 500, 'point lookup, 500 concurrent, pool 1 (deep pipelining)'],
		['fetch1k', 10, undefined, 'fetch 1k rows, sequential'],
		[
			'tx-insert',
			10,
			undefined,
			'transaction (begin; insert; commit), sequential',
		],
		['insert1-c50', 10, undefined, 'insert, 50 concurrent, pool 10'],
		['connect-plain-trust', 10, undefined, 'connect + select 1 + close'],
	];
	const sections: string[] = [];
	for (const runtime of RUNTIMES) {
		const drivers = driversIn('rtt', runtime);
		if (drivers.length === 0) continue;
		const data: Record<
			string,
			Record<string, Record<string, Stat | undefined>>
		> = {};
		for (const [s, max, c, name] of variants) {
			const latencyView = c === undefined && s !== 'insert1-c50';
			sections.push(
				table(
					`${RT[runtime]}: ${name}: ${latencyView ? 'median latency' : 'operations/s'} by RTT`,
					'RTT',
					[0, 1, 5, 20].map((rtt) => ({
						label: `${rtt} ms`,
						pick: (d: string) =>
							metric(latencyView ? 'p50' : 'throughput')(
								get('rtt', runtime, d, s, { max, rtt, concurrency: c }),
							),
					})),
					drivers,
					latencyView ? fmtTime : fmtRate,
					latencyView,
					true,
				),
			);
			for (const d of drivers)
				for (const rtt of [0, 1, 5, 20]) {
					const a = get('rtt', runtime, d, s, { max, rtt, concurrency: c });
					((data[`${s}|${max}|${c ?? ''}`] ??= {})[d] ??= {})[String(rtt)] =
						a?.m['throughput'];
				}
		}
		(summary['rtt'] as Record<string, unknown>)[runtime] = data;
	}
	if (sections.length)
		out.push(
			`## Network latency (RTT through Toxiproxy)\n\n${sections.join('\n')}`,
		);
}

// ------------------------------------------------------------ PgBouncer
{
	const sections: string[] = [];
	const rows: [string, number | undefined][] = [
		['select1', undefined],
		['pk', undefined],
		['pk', 50],
		['fetch1k', undefined],
		['insert1', undefined],
		['tx-insert', undefined],
		['insert1-c50', undefined],
		['error', undefined],
	];
	for (const runtime of RUNTIMES) {
		const drivers = driversIn('bouncer', runtime);
		if (drivers.length === 0) continue;
		sections.push(
			table(
				`${RT[runtime]} through PgBouncer 1.26 (transaction mode): operations/s`,
				'Scenario',
				rows.map(([s, c]) => ({
					label: c ? `${title(s)}, concurrency ${c}` : title(s),
					pick: (d: string) =>
						metric('throughput')(
							get('bouncer', runtime, d, s, { concurrency: c }),
						),
				})),
				drivers,
				fmtRate,
				false,
				true,
			),
		);
		sections.push(
			table(
				`${RT[runtime]} through PgBouncer: median latency`,
				'Scenario',
				rows.map(([s, c]) => ({
					label: c ? `${title(s)}, concurrency ${c}` : title(s),
					pick: (d: string) =>
						metric('p50')(get('bouncer', runtime, d, s, { concurrency: c })),
				})),
				drivers,
				fmtTime,
				true,
			),
		);
		const direct = (d: string, s: string) =>
			get('main', runtime, d, s, { concurrency: undefined })?.m['throughput']
				?.median ?? Number.NaN;
		sections.push(
			table(
				`${RT[runtime]}: PgBouncer throughput relative to direct (same client, sequential)`,
				'Scenario',
				['select1', 'pk', 'fetch1k', 'insert1', 'tx-insert'].map((s) => ({
					label: title(s),
					pick: (d: string) => {
						const b = get('bouncer', runtime, d, s, { concurrency: undefined })
							?.m['throughput'];
						const dir = direct(d, s);
						return b && Number.isFinite(dir)
							? {
									median: b.median / dir,
									lo: b.lo / dir,
									hi: b.hi / dir,
									n: b.n,
								}
							: undefined;
					},
				})),
				drivers,
				(v) => `${(v * 100).toFixed(0)}%`,
				false,
			),
		);
	}
	if (sections.length) out.push(`## PgBouncer\n\n${sections.join('\n')}`);
}

// ------------------------------------------------------------ reconnect
{
	const rows: string[] = [];
	for (const runtime of RUNTIMES)
		for (const d of driversIn('reconnect', runtime)) {
			const a = get('reconnect', runtime, d, 'reconnect');
			if (!a) continue;
			const raw = groups.get(keyOf(a.cell)) ?? [];
			const recovered = raw.filter((r) => r.result['extra']?.recovered).length;
			rows.push(
				`| ${RT[runtime]} | ${label(d)} | ${recovered}/${raw.length} | ${fmtTime(a.m['recoveryMs']!.median)} | ${fmtNum(a.m['failedQueries']!.median, 0)} |`,
			);
		}
	if (rows.length)
		out.push(
			[
				'## Server restart',
				'',
				'`pg_ctl restart -m fast` while a pool runs `select 1` every 5 ms (2 s client timeout per query).',
				'',
				'| Runtime | Client | Recovered | Time from server up to first success (median) | Failed queries (median) |',
				'|---|---|---:|---:|---:|',
				...rows,
				'',
			].join('\n'),
		);
}

// ------------------------------------------------------------ footprint
for (const id of ids) {
	const file = join(import.meta.dirname, 'results', id, 'footprint.json');
	if (!existsSync(file)) continue;
	const f = JSON.parse(readFileSync(file, 'utf8'));
	summary['footprint'] = f;
	const lines = [
		'## Footprint and cold start',
		'',
		'| Package | Installed size | Packages installed |',
		'|---|---:|---:|',
	];
	for (const [k, v] of Object.entries(
		f.install as Record<string, { bytes?: number; packages?: number }>,
	))
		lines.push(
			`| ${k} | ${v.bytes === undefined ? '—' : `${(v.bytes / 1024).toFixed(0)} KiB`} | ${v.packages ?? '—'} |`,
		);
	lines.push(
		'',
		'| Bundle (esbuild, minified, platform node) | Size | gzip |',
		'|---|---:|---:|',
	);
	for (const [k, v] of Object.entries(
		f.bundle as Record<
			string,
			{ bytes?: number; gzip?: number; note?: string }
		>,
	))
		lines.push(
			`| ${k} | ${v.bytes ? `${(v.bytes / 1024).toFixed(1)} KiB` : (v.note ?? '—')} | ${v.gzip ? `${(v.gzip / 1024).toFixed(1)} KiB` : ''} |`,
		);
	lines.push(
		'',
		'| Runtime / client | Import | Connect + first query | Process start → first result | Wall time of the process |',
		'|---|---:|---:|---:|---:|',
	);
	for (const [k, v] of Object.entries(
		f.cold as Record<
			string,
			{
				importMs: number;
				firstQueryMs: number;
				sinceStartMs: number;
				wallMs: number;
			}
		>,
	))
		lines.push(
			`| ${k} | ${fmtTime(v.importMs)} | ${fmtTime(v.firstQueryMs)} | ${fmtTime(v.sinceStartMs)} | ${fmtTime(v.wallMs)} |`,
		);
	out.push(lines.join('\n') + '\n');
}

// ------------------------------------------------------------ summary for charts
const flat: Record<string, unknown>[] = [];
for (const a of aggs.values())
	flat.push({
		...a.cell,
		runs: a.runs,
		unsupported: a.unsupported,
		errors: a.errors.length,
		...Object.fromEntries(Object.entries(a.m).map(([k, s]) => [k, s])),
	});
summary['cells'] = flat;
summary['scenarios'] = Object.fromEntries(
	SCENARIOS.map((s) => [
		s.id,
		{
			title: s.title,
			group: s.group,
			rowsPerOp: (s as { rowsPerOp?: number }).rowsPerOp ?? null,
			memOps: (s as { memOps?: number }).memOps ?? null,
		},
	]),
);
summary['labels'] = LABEL;
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary));
writeFileSync(join(outDir, 'tables.md'), out.filter(Boolean).join('\n'));
console.error(
	`wrote ${join(outDir, 'tables.md')} and summary.json (${aggs.size} cells from ${raws.length} runs)`,
);
