import { Column } from '../column.js';

export class BooleanColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: {
		'=': NonNullable<S>;
		'<>': NonNullable<S>;
		'!=': NonNullable<S>;
		// `is true` / `is false` are null-safe, unlike `= true`
		is: boolean | null;
		'is not': boolean | null;
	};

	override nullable() {
		return new BooleanColumn<S | null, I | null, U | null>();
	}

	override default() {
		return new BooleanColumn<S, I | undefined, U>();
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new BooleanColumn<X, Y, Z>();
	}
}
