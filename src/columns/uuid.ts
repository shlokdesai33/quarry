import { Column } from '../column.js';
import type { EqualityOperators } from '../operators.js';

export class UUIDColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: EqualityOperators<S>;

	override nullable() {
		return new UUIDColumn<S | null, I | null, U | null>();
	}

	override default() {
		return new UUIDColumn<S, I | undefined, U>();
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new UUIDColumn<X, Y, Z>();
	}
}
