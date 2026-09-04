import { Column } from '../column.js';

export type TextType = 'text' | 'varchar';

export class TextColumn<S, I = S, U = I> extends Column<S, I, U> {
	declare readonly $operators: {
		'=': NonNullable<S>;
		'<>': NonNullable<S>;
		'!=': NonNullable<S>;
		is: null;
		'is not': null;
		like: string;
		'not like': string;
		ilike: string;
		'not ilike': string;
	};

	/** the postgres type this column is declared as */
	readonly type: TextType;

	constructor(type: TextType) {
		super();
		this.type = type;
	}

	override nullable() {
		return new TextColumn<S | null, I | null, U | null>(this.type);
	}

	override default() {
		return new TextColumn<S, I | undefined, U>(this.type);
	}

	override as<X extends S, Y extends I & X, Z extends U & X>() {
		return new TextColumn<X, Y, Z>(this.type);
	}
}
