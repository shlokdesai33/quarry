import { Column } from '../column.js';
import type { ComparableOperators } from '../operators.js';

export class DoublePrecisionColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: ComparableOperators<S>;

	override nullable() {
		return new DoublePrecisionColumn<S | null, I | null, U | null>();
	}

	override default() {
		return new DoublePrecisionColumn<S, I | undefined, U>();
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new DoublePrecisionColumn<X, Y, Z>();
	}
}
