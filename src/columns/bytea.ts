import { Column } from '../column.js';
import type { EqualityOperators } from '../operators.js';

export class ByteaColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: EqualityOperators<S>;

	override nullable() {
		return new ByteaColumn<S | null, I | null, U | null>();
	}

	override default() {
		return new ByteaColumn<S, I | undefined, U>();
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new ByteaColumn<X, Y, Z>();
	}
}
