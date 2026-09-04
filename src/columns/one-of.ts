import { Column } from '../column.js';
import type { EqualityOperators } from '../operators.js';

export class OneOfColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: EqualityOperators<S>;

	/**
	 * The members of the enum, as declared in `create type ... as enum (...)`.
	 */
	readonly values: readonly string[];

	constructor(values: readonly string[]) {
		super();
		this.values = values;
	}

	override nullable() {
		return new OneOfColumn<S | null, I | null, U | null>(this.values);
	}

	override default() {
		return new OneOfColumn<S, I | undefined, U>(this.values);
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new OneOfColumn<X, Y, Z>(this.values);
	}
}
