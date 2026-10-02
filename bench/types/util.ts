/** The value at the given percentile (0–100), by nearest rank. */
export function percentile(values: readonly number[], p: number) {
	const sorted = values.toSorted((a, b) => a - b);
	const rank = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]!;
}

export const median = (values: readonly number[]) => percentile(values, 50);

/** `value` relative to `reference`, e.g. `+3.2%`. */
export function pct(value: number, reference: number) {
	const delta = ((value - reference) / reference) * 100;
	return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

/** The value of `--name` on the command line, or `fallback`. */
export function arg(name: string, fallback: string) {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? fallback : process.argv[index + 1]!;
}
