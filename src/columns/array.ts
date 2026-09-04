import { Column } from '../column.js';

export class ArrayColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: {
		'=': NonNullable<S>;
		'<>': NonNullable<S>;
		'!=': NonNullable<S>;
		is: null;
		'is not': null;
		// contains
		'@>': NonNullable<S>;
		// contained by
		'<@': NonNullable<S>;
		// overlaps
		'&&': NonNullable<S>;
	};

	override nullable() {
		return new ArrayColumn<S | null, I | null, U | null>();
	}

	override default() {
		return new ArrayColumn<S, I | undefined, U>();
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new ArrayColumn<X, Y, Z>();
	}
}
