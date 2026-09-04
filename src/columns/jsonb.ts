import { Column } from '../column.js';

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export class JsonbColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: {
		'=': NonNullable<S>;
		'<>': NonNullable<S>;
		'!=': NonNullable<S>;
		is: null;
		'is not': null;
		// contains
		'@>': JsonValue;
		// contained by
		'<@': JsonValue;
		// top-level key exists
		'?': string;
		// any of the keys exist
		'?|': string[];
		// all of the keys exist
		'?&': string[];
	};

	override nullable() {
		return new JsonbColumn<S | null, I | null, U | null>();
	}

	override default() {
		return new JsonbColumn<S, I | undefined, U>();
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new JsonbColumn<X, Y, Z>();
	}
}
