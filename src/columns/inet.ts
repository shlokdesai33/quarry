import { Column } from '../column.js';

export class InetColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: {
		'=': NonNullable<S>;
		'<>': NonNullable<S>;
		'!=': NonNullable<S>;
		'>': NonNullable<S>;
		'>=': NonNullable<S>;
		'<': NonNullable<S>;
		'<=': NonNullable<S>;
		is: null;
		'is not': null;
		between: [NonNullable<S>, NonNullable<S>];
		'not between': [NonNullable<S>, NonNullable<S>];
		// is contained by
		'<<': NonNullable<S>;
		// is contained by or equals
		'<<=': NonNullable<S>;
		// contains
		'>>': NonNullable<S>;
		// contains or equals
		'>>=': NonNullable<S>;
		// contains or is contained by
		'&&': NonNullable<S>;
	};

	override nullable() {
		return new InetColumn<S | null, I | null, U | null>();
	}

	override default() {
		return new InetColumn<S, I | undefined, U>();
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new InetColumn<X, Y, Z>();
	}
}
