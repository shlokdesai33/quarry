/**
 * Operators shared by every type that supports equality.
 */
export type EqualityOperators<S> = {
	'=': NonNullable<S>;
	'<>': NonNullable<S>;
	'!=': NonNullable<S>;
	is: null;
	'is not': null;
};

/**
 * Operators shared by every type with a total ordering.
 */
export type ComparableOperators<S> = {
	'=': NonNullable<S>;
	'<>': NonNullable<S>;
	'!=': NonNullable<S>;
	'>': NonNullable<S>;
	'>=': NonNullable<S>;
	'<': NonNullable<S>;
	'<=': NonNullable<S>;
	is: null;
	'is not': null;
	between: [NonNullable<S>, NonNullable<S>];
	'not between': [NonNullable<S>, NonNullable<S>];
};
