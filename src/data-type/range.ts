import { isRange, serializeRange } from '../range.js';
import { DataType } from './data-type.js';

/**
 * `daterange`: a range becomes its literal. Bounds and points are date
 * strings, already in postgres input syntax, so a single date (for `@>`) and
 * `null` are sent as they are.
 */
export class DateRangeType extends DataType<'daterange'> {
	constructor() {
		super('daterange');
	}

	override serialize(value: unknown) {
		return isRange(value) ? serializeRange(value, String) : value;
	}
}

/** A timestamp bound or point in postgres input syntax. */
function timestamp(value: unknown): string {
	return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * `tstzrange`: a range becomes its literal, and a single timestamp (for `@>`)
 * its text. Bounds and points are `Date`s.
 */
export class TstzRangeType extends DataType<'tstzrange'> {
	constructor() {
		super('tstzrange');
	}

	override serialize(value: unknown) {
		if (value === null) return value;
		return isRange(value) ? serializeRange(value, timestamp) : timestamp(value);
	}
}
