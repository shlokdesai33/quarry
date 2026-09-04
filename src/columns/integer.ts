import { Column } from '../column.js';
import type { ComparableOperators } from '../operators.js';

export class IntegerColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: ComparableOperators<S>;

	override nullable() {
		return new IntegerColumn<S | null, I | null, U | null>();
	}

	override default() {
		return new IntegerColumn<S, I | undefined, U>();
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new IntegerColumn<X, Y, Z>();
	}

	/**
	 * Declares the column `generated always as identity`: the value comes from
	 * an implicit sequence and can never be written by the application.
	 */
	identity() {
		return new IntegerColumn<S, never, never>();
	}
}
