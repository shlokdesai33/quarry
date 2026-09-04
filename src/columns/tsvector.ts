import { Column } from '../column.js';

export class TsvectorColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: {
		is: null;
		'is not': null;
		// matches a tsquery
		'@@': string;
	};

	override nullable() {
		return new TsvectorColumn<S | null, I | null, U | null>();
	}

	override default() {
		return new TsvectorColumn<S, I | undefined, U>();
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new TsvectorColumn<X, Y, Z>();
	}
}
