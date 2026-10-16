import type { RangeValue } from './driver/parsers.js';

/**
 * A postgres range value. Postgres canonicalises any range with no points
 * (e.g. `[3,3)`) to the single value `empty`, which is modelled as its own
 * variant so that `lower`/`upper` are only reachable once it has been ruled
 * out. Bounds are `null` when unbounded; `bounds` says which are inclusive.
 * The driver's range codecs read and write it.
 */
export type Range<T> = RangeValue<T>;

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
