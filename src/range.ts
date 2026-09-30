/**
 * A postgres range value. Postgres canonicalises any range with no points
 * (e.g. `[3,3)`) to the single value `empty`, which is modelled as its own
 * variant so that `lower`/`upper` are only reachable once it has been ruled
 * out.
 */
export type Range<T> =
	| {
			readonly empty: false;
			/** the lower bound, or `null` when unbounded */
			readonly lower: T | null;
			/** the upper bound, or `null` when unbounded */
			readonly upper: T | null;
			/** which bounds are inclusive; postgres canonicalises discrete ranges to `[)` */
			readonly bounds: '[)' | '(]' | '[]' | '()';
	  }
	| { readonly empty: true };

/**
 * Whether `value` is a range.
 */
export function isRange(value: unknown): value is Range<unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		'empty' in value &&
		typeof value.empty === 'boolean'
	);
}

/**
 * Renders a range in postgres input syntax, e.g. `["2024-01-01","2024-02-01")`
 * or `empty`. `bound` formats a single bound; the result is always quoted so
 * that bound text can never be mistaken for syntax.
 */
export function serializeRange<T>(
	range: Range<T>,
	bound: (value: T) => string,
): string {
	if (range.empty) return 'empty';
	const lower = range.lower === null ? '' : quote(bound(range.lower));
	const upper = range.upper === null ? '' : quote(bound(range.upper));
	return `${range.bounds[0]}${lower},${upper}${range.bounds[1]}`;
}

function quote(text: string): string {
	return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
