import { Column } from '../column.js';
import type { ComparableOperators } from '../operators.js';

export type TemporalType =
	| 'date'
	| 'time'
	| 'timestamp'
	| 'timestamptz'
	| 'interval';

export class TemporalColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: ComparableOperators<S>;

	/**
	 * The postgres type this column is declared as.
	 */
	readonly type: TemporalType;

	constructor(type: TemporalType) {
		super();
		this.type = type;
	}

	override nullable() {
		return new TemporalColumn<S | null, I | null, U | null>(this.type);
	}

	override default() {
		return new TemporalColumn<S, I | undefined, U>(this.type);
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new TemporalColumn<X, Y, Z>(this.type);
	}
}
