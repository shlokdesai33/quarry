/**
 * Compares two result sets cell by cell (e.g. main against a QUARRY_DIST
 * candidate): median throughput and p99 of each, and the change.
 *
 *   node compare.ts <baseline id> <candidate id> [--driver quarry] [--runtime node]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [baseId, candId] = process.argv
	.slice(2)
	.filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
const opt = (name: string) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const driver = opt('driver') ?? 'quarry';
const runtime = opt('runtime') ?? 'node';

interface Raw {
	cell: {
		phase: string;
		runtime: string;
		driver: string;
		scenario: string;
		max: number;
		concurrency?: number;
		pipeline?: number;
		rtt?: number;
	};
	result: { ok: boolean; throughput: number; lat: { p99: number } };
}
const load = (id: string) =>
	readFileSync(join(import.meta.dirname, 'results', id, 'raw.jsonl'), 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Raw)
		.filter(
			(r) =>
				r.result.ok &&
				r.result.lat !== undefined &&
				r.cell.driver === driver &&
				r.cell.runtime === runtime,
		);
const median = (v: number[]) => {
	const s = v.toSorted((a, b) => a - b);
	return s.length % 2
		? s[s.length >> 1]!
		: (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const key = (c: Raw['cell']) =>
	[
		c.phase,
		c.scenario,
		c.max,
		c.concurrency ?? '',
		c.pipeline ?? '',
		c.rtt ?? '',
	].join('|');
const group = (rs: Raw[]) => {
	const m = new Map<string, Raw[]>();
	for (const r of rs) m.set(key(r.cell), [...(m.get(key(r.cell)) ?? []), r]);
	return m;
};
const base = group(load(baseId!));
const cand = group(load(candId!));
const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
const ms = (v: number) =>
	v < 1 ? `${(v * 1000).toFixed(0)} µs` : `${v.toFixed(2)} ms`;
console.log(
	`| Cell | ${baseId} ops/s | ${candId} ops/s | change | ${baseId} p99 | ${candId} p99 |`,
);
console.log('|---|---:|---:|---:|---:|---:|');
for (const [k, rs] of [...cand.entries()].toSorted(([a], [b]) =>
	a.localeCompare(b),
)) {
	const b = base.get(k);
	if (!b) continue;
	const [phase, scenario, max, c, p, rtt] = k.split('|');
	const bt = median(b.map((r) => r.result.throughput));
	const ct = median(rs.map((r) => r.result.throughput));
	console.log(
		`| ${phase} ${scenario} pool ${max}${c ? ` c=${c}` : ''}${p ? ` pipeline=${p}` : ''}${rtt ? ` rtt=${rtt}ms` : ''} | ${fmt(bt)} | ${fmt(ct)} | ${ct >= bt ? '+' : ''}${(((ct - bt) / bt) * 100).toFixed(0)}% | ${ms(median(b.map((r) => r.result.lat.p99)))} | ${ms(median(rs.map((r) => r.result.lat.p99)))} |`,
	);
}
