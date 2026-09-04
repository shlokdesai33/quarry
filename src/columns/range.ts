import { Column } from '../column.js';

export type RangeType = 'daterange' | 'tstzrange';

// read back in postgres' literal form, e.g. `[2024-01-01,2024-02-01)`
export class RangeColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: {
		'=': NonNullable<S>;
		'<>': NonNullable<S>;
		'!=': NonNullable<S>;
		is: null;
		'is not': null;
		// contains a range, or a single element
		'@>': NonNullable<S> | Date | string;
		// contained by
		'<@': NonNullable<S>;
		// overlaps
		'&&': NonNullable<S>;
		// strictly left of
		'<<': NonNullable<S>;
		// strictly right of
		'>>': NonNullable<S>;
		// adjacent to
		'-|-': NonNullable<S>;
	};

	/**
	 * The postgres type this column is declared as.
	 */
	readonly type: RangeType;

	constructor(type: RangeType) {
		super();
		this.type = type;
	}

	override nullable() {
		return new RangeColumn<S | null, I | null, U | null>(this.type);
	}

	override default() {
		return new RangeColumn<S, I | undefined, U>(this.type);
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new RangeColumn<X, Y, Z>(this.type);
	}
}
