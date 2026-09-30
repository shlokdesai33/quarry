import type { RangeOperators } from '../operators.js';
import { isRange, type Range, serializeRange } from '../range.js';
import { DataType } from './data-type.js';

export class DateRangeType extends DataType {
	declare readonly $kind: 'daterange';
	declare readonly $native: Range<string>;
	declare readonly $operators: RangeOperators<this['$value']>;

	// a range becomes its literal; a single date (for `@>`) passes through.
	override encode(value: unknown) {
		return isRange(value) ? serializeRange(value, String) : value;
	}
}

export class TstzRangeType extends DataType {
	declare readonly $kind: 'tstzrange';
	declare readonly $native: Range<Date>;
	declare readonly $operators: RangeOperators<this['$value']>;

	// a range becomes its literal; a single timestamp (for `@>`) passes through.
	override encode(value: unknown) {
		return isRange(value)
			? serializeRange(value, (bound) =>
					bound instanceof Date ? bound.toISOString() : String(bound),
				)
			: value;
	}
}
