/* oxlint-disable no-await-in-loop -- closed-loop benchmark workers */
/**
 * Runs one benchmark cell (one client configuration × one scenario) in a
 * fresh process and prints one JSON line. Started by orchestrate.ts under
 * Node, Bun or Deno, pinned to the client CPUs.
 *
 *   node worker.ts '<job json>'
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { digest } from './canon.ts';
import { DRIVERS, type Driver, type Target } from './drivers.ts';
import {
	byId,
	type Ctx,
	type CustomResult,
	type OpsScenario,
} from './scenarios.ts';

export interface Job {
	readonly driver: string;
	readonly scenario: string;
	readonly target: Target;
	readonly caFile: string;
	readonly max: number;
	readonly concurrency?: number | undefined;
	readonly pipeline?: number | false | undefined;
	readonly durationMs?: number | undefined;
	readonly warmupMs?: number | undefined;
	readonly verify?: boolean | undefined;
	/** Equal-work memory: exactly this many measured operations, after a fixed warm-up. */
	readonly memOps?: number | undefined;
}

export interface CellResult {
	readonly ok: true;
	readonly ops: number;
	readonly elapsedMs: number;
	readonly throughput: number;
	readonly lat: {
		p50: number;
		p90: number;
		p99: number;
		p999: number;
		max: number;
		mean: number;
		n: number;
	};
	readonly cpuUsPerOp: number;
	readonly serverCpuUsPerOp: number | null;
	readonly rssBaseMB: number;
	readonly rssPeakMB: number;
	readonly heapPeakMB: number;
	readonly gc: { count: number; totalMs: number; maxMs: number } | null;
	readonly loopLag: { p50: number; p99: number; max: number };
	readonly extra?: Record<string, unknown> | undefined;
}

const job: Job = JSON.parse(
	process.argv[2] ?? process.argv[process.argv.length - 1]!,
);
const runtime = Reflect.has(globalThis, 'Bun')
	? 'bun'
	: Reflect.has(globalThis, 'Deno')
		? 'deno'
		: 'node';

function gcNow(): void {
	const bun = Reflect.get(globalThis, 'Bun') as
		| { gc?: (sync: boolean) => void }
		| undefined;
	if (bun?.gc) bun.gc(true);
	else (Reflect.get(globalThis, 'gc') as (() => void) | undefined)?.();
}

/** CPU time (µs) of every PostgreSQL process, from /proc. */
function serverCpuUs(): number | null {
	try {
		let ticks = 0;
		for (const pid of readdirSync('/proc')) {
			if (!/^\d+$/.test(pid)) continue;
			let stat: string;
			try {
				stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
			} catch {
				continue;
			}
			const close = stat.lastIndexOf(')');
			if (!stat.slice(stat.indexOf('(') + 1, close).startsWith('postgres'))
				continue;
			const fields = stat.slice(close + 2).split(' ');
			ticks += Number(fields[11]) + Number(fields[12]);
		}
		return (ticks * 1_000_000) / 100;
	} catch {
		return null;
	}
}

function percentile(sorted: Float64Array, p: number): number {
	if (sorted.length === 0) return Number.NaN;
	const i = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
	);
	return sorted[i]!;
}

function summarize(latencies: Float64Array) {
	const s = latencies.toSorted();
	let sum = 0;
	for (const v of s) sum += v;
	return {
		p50: percentile(s, 50),
		p90: percentile(s, 90),
		p99: percentile(s, 99),
		p999: percentile(s, 99.9),
		max: s[s.length - 1] ?? Number.NaN,
		mean: sum / Math.max(1, s.length),
		n: s.length,
	};
}

/** RSS, heap and event-loop lag, sampled every 10 ms; GC pauses where the runtime reports them. */
const mb = (b: number) => b / 1048576;

async function monitor() {
	let rssPeak = 0;
	let heapPeak = 0;
	const lags: number[] = [];
	let running = true;
	let expected = performance.now() + 10;
	const tick = () => {
		if (!running) return;
		const now = performance.now();
		lags.push(Math.max(0, now - expected));
		const m = process.memoryUsage();
		rssPeak = Math.max(rssPeak, m.rss);
		heapPeak = Math.max(heapPeak, m.heapUsed);
		expected = now + 10;
		setTimeout(tick, 10);
	};
	setTimeout(tick, 10);
	let gc: { count: number; totalMs: number; maxMs: number } | null = null;
	let observer: { disconnect(): void } | undefined;
	try {
		const { PerformanceObserver } = await import('node:perf_hooks');
		if (
			runtime === 'node' &&
			PerformanceObserver.supportedEntryTypes.includes('gc')
		) {
			gc = { count: 0, totalMs: 0, maxMs: 0 };
			const g = gc;
			const o = new PerformanceObserver((list) => {
				for (const e of list.getEntries()) {
					g.count++;
					g.totalMs += e.duration;
					g.maxMs = Math.max(g.maxMs, e.duration);
				}
			});
			o.observe({ entryTypes: ['gc'] });
			observer = o;
		}
	} catch {
		gc = null;
	}
	return {
		stop() {
			running = false;
			observer?.disconnect();
			const m = process.memoryUsage();
			rssPeak = Math.max(rssPeak, m.rss);
			heapPeak = Math.max(heapPeak, m.heapUsed);
			const sorted = Float64Array.from(lags).toSorted();
			return {
				rssPeakMB: mb(rssPeak),
				heapPeakMB: mb(heapPeak),
				gc,
				loopLag: {
					p50: percentile(sorted, 50),
					p99: percentile(sorted, 99),
					max: sorted[sorted.length - 1] ?? 0,
				},
			};
		},
	};
}

async function runOps(
	s: OpsScenario,
	d: Driver,
	ctx: Ctx,
): Promise<CellResult> {
	const concurrency = job.concurrency ?? s.concurrency ?? 1;
	const equalWork = job.memOps !== undefined;
	// equal work: no time-based warm-up or window, only operation counts
	const durationMs = equalWork ? 0 : (job.durationMs ?? s.durationMs ?? 1000);
	const warmupMs = equalWork ? 0 : (job.warmupMs ?? s.warmupMs ?? 500);
	const warmupOps = Math.max(s.warmupOps ?? 3, Math.min(concurrency, 3));
	const minOps = job.memOps ?? s.minOps ?? 10;
	const maxOps = equalWork
		? warmupOps + job.memOps!
		: (s.maxOps ?? Number.POSITIVE_INFINITY);
	await s.setup?.(d, ctx);
	let seq = 0;
	const loopFor = async (
		ms: number,
		min: number,
		record?: (ms: number) => void,
	) => {
		const start = performance.now();
		let done = 0;
		await Promise.all(
			Array.from({ length: concurrency }, async () => {
				while ((done < min || performance.now() - start < ms) && seq < maxOps) {
					const i = seq++;
					const t = performance.now();
					const r = await s.op(d, i, ctx);
					const took = performance.now() - t;
					record?.(took);
					s.check?.(r, i);
					done++;
				}
			}),
		);
		return { done, elapsed: performance.now() - start };
	};
	// warm-up: JIT, prepared statements, every pool connection opened
	await loopFor(warmupMs, warmupOps);
	gcNow();
	let lat = new Float64Array(1 << 14);
	let n = 0;
	const record = (ms: number) => {
		if (n === lat.length) {
			const grown = new Float64Array(lat.length * 2);
			grown.set(lat);
			lat = grown;
		}
		lat[n++] = ms;
	};
	const rssBase = process.memoryUsage().rss / 1048576;
	const mon = await monitor();
	const srv0 = serverCpuUs();
	const cpu0 = process.cpuUsage();
	const { done, elapsed } = await loopFor(durationMs, minOps, record);
	const cpu = process.cpuUsage(cpu0);
	const srv1 = serverCpuUs();
	const m = mon.stop();
	return {
		ok: true,
		ops: done,
		elapsedMs: elapsed,
		throughput: (done / elapsed) * 1000,
		lat: summarize(lat.subarray(0, n)),
		cpuUsPerOp: (cpu.user + cpu.system) / done,
		serverCpuUsPerOp:
			srv0 === null || srv1 === null ? null : (srv1 - srv0) / done,
		rssBaseMB: rssBase,
		...m,
	};
}

async function main() {
	const scenario = byId.get(job.scenario);
	if (!scenario) throw new Error(`unknown scenario ${job.scenario}`);
	const factory = DRIVERS[job.driver];
	if (!factory) throw new Error(`unknown driver ${job.driver}`);
	const make = (max: number) =>
		factory.make({ target: job.target, max, pipeline: job.pipeline });
	const ctx: Ctx = {
		data: { caFile: job.caFile, make },
		target: job.target,
		driverName: job.driver,
	};
	const needsPool = scenario.kind === 'ops' || !scenario.noPool;
	const d = needsPool ? await make(job.max) : undefined;
	if (scenario.needs && d && d[scenario.needs] === undefined) {
		console.log(JSON.stringify({ ok: false, unsupported: true }));
		await d.end();
		process.exit(0);
	}
	if (job.verify) {
		if (scenario.kind !== 'ops' || !scenario.verify)
			throw new Error('nothing to verify');
		const value = await scenario.verify(d!, ctx);
		const n = Array.isArray(value) ? value.length : 0;
		console.log(
			JSON.stringify({
				ok: true,
				digest: digest(value),
				n,
				sample: JSON.stringify(Array.isArray(value) ? value[0] : value).slice(
					0,
					300,
				),
			}),
		);
	} else if (scenario.kind === 'ops') {
		console.log(JSON.stringify(await runOps(scenario, d!, ctx)));
	} else {
		const stdin =
			scenario.id === 'reconnect'
				? createInterface({ input: process.stdin })[Symbol.asyncIterator]()
				: undefined;
		gcNow();
		const rssBase = process.memoryUsage().rss / 1048576;
		const mon = await monitor();
		const cpu0 = process.cpuUsage();
		const r: CustomResult = await scenario.run(d, ctx, {
			durationMs: job.durationMs ?? 1500,
			stdin,
		});
		const cpu = process.cpuUsage(cpu0);
		const m = mon.stop();
		const result: CellResult = {
			ok: true,
			ops: r.ops,
			elapsedMs: r.elapsedMs,
			throughput: (r.ops / r.elapsedMs) * 1000,
			lat: summarize(Float64Array.from(r.latencies)),
			cpuUsPerOp: (cpu.user + cpu.system) / Math.max(1, r.ops),
			serverCpuUsPerOp: null,
			rssBaseMB: rssBase,
			...m,
			extra: r.extra,
		};
		console.log(JSON.stringify(result));
	}
	await Promise.race([d?.end(), new Promise((r) => setTimeout(r, 3000))]);
	process.exit(0);
}

main().catch((error: unknown) => {
	console.log(
		JSON.stringify({
			ok: false,
			error: String((error as Error)?.stack ?? error).slice(0, 2000),
		}),
	);
	process.exit(1);
});
