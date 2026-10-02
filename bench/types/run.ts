/**
 * Compile benchmark: how much work a full type check of the workload (see
 * `generate.ts`) does with each variant's library, over `--tables` tables.
 * Run with:
 *
 *   node bench/types/run.ts [--tables 50,200] [--runs 7] [--variants src,other=path/to/src]
 *
 * The first variant listed is the baseline the others are compared with.
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
	generate,
	KINDS,
	out,
	parseVariants,
	root,
	type Variant,
} from './generate.ts';
import { arg, median, pct } from './util.ts';

const tsc = join(root, 'node_modules', '.bin', 'tsc');

interface Sample {
	readonly types: number;
	readonly instantiations: number;
	readonly memoryKb: number;
	readonly checkMs: number;
	readonly totalMs: number;
}

function compile(dir: string): Sample {
	let output: string;
	try {
		output = execFileSync(
			tsc,
			['-p', dir, '--extendedDiagnostics', '--singleThreaded'],
			{ encoding: 'utf8' },
		);
	} catch (error) {
		const { stdout } = error as { stdout: string };
		throw new Error(`type errors in ${relative(root, dir)}:\n${stdout}`, {
			cause: error,
		});
	}
	const metric = (name: string) => {
		const match = new RegExp(`^${name}:\\s+([\\d.]+)`, 'm').exec(output);
		if (!match) {
			throw new Error(`no "${name}" in tsc output:\n${output}`);
		}
		return Number(match[1]);
	};
	return {
		types: metric('Types'),
		instantiations: metric('Instantiations'),
		memoryKb: metric('Memory used'),
		checkMs: metric('Check time') * 1000,
		totalMs: metric('Total time') * 1000,
	};
}

const sizes = arg('tables', '50,200').split(',').map(Number);
const runs = Number(arg('runs', '7'));
const variants = parseVariants(arg('variants', 'src'));
const baseline = variants[0]!;
const base = join(out, 'compile');

rmSync(base, { recursive: true, force: true });

for (const tables of sizes) {
	const dirs = new Map(variants.map((v) => [v, generate(v, tables, base)]));
	const samples = new Map<Variant, Sample[]>(variants.map((v) => [v, []]));

	// one warm-up per variant, which also fails fast on type errors
	for (const variant of variants) {
		compile(dirs.get(variant)!);
	}
	// interleaved, rotating the order, so drift affects every variant alike
	for (let run = 0; run < runs; run++) {
		for (let n = 0; n < variants.length; n++) {
			const variant = variants[(run + n) % variants.length]!;
			samples.get(variant)!.push(compile(dirs.get(variant)!));
		}
	}

	const reference = samples.get(baseline)!;
	const baseCheck = median(reference.map((s) => s.checkMs));
	const baseInst = reference[0]!.instantiations;
	const baseTypes = reference[0]!.types;
	const vs = `vs ${baseline.name}`;

	console.log(
		`\n${tables} tables × ${KINDS.length + 1} columns, ${runs} runs each (single-threaded, median check time)\n`,
	);
	console.log(
		`| variant | check time | ${vs} | total time | types | ${vs} | instantiations | ${vs} | memory |`,
	);
	console.log('|---|---|---|---|---|---|---|---|---|');
	for (const variant of variants) {
		const list = samples.get(variant)!;
		const check = median(list.map((s) => s.checkMs));
		const total = median(list.map((s) => s.totalMs));
		const { types, instantiations } = list[0]!;
		const memory = median(list.map((s) => s.memoryKb));
		console.log(
			`| ${variant.name} | ${check.toFixed(0)} ms | ${pct(check, baseCheck)} | ${total.toFixed(0)} ms | ${types} | ${pct(types, baseTypes)} | ${instantiations} | ${pct(instantiations, baseInst)} | ${(memory / 1024).toFixed(0)} MB |`,
		);
	}
}
