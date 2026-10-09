import { comparison } from './comparison.js';
import { DataType } from './data-type/data-type.js';
import {
	type Expression,
	Param,
	Quantified,
	TypedExpression,
} from './expression.js';
import type { OperationNode } from './node.js';
import type { Predicate } from './operators.js';

/**
 * The SQL operator each comparison method applies. Names describe the
 * meaning for the type that has them, so one operator can have several:
 * `<<` is `strictlyLeftOf` for a range and `isSubnetOf` for an inet.
 */
const OPERATORS = {
	eq: '=',
	ne: '<>',
	isDistinctFrom: 'is distinct from',
	isNotDistinctFrom: 'is not distinct from',
	in: 'in',
	notIn: 'not in',
	gt: '>',
	gte: '>=',
	lt: '<',
	lte: '<=',
	between: 'between',
	notBetween: 'not between',
	like: 'like',
	notLike: 'not like',
	ilike: 'ilike',
	notIlike: 'not ilike',
	regex: '~',
	notRegex: '!~',
	iregex: '~*',
	notIregex: '!~*',
	startsWith: '^@',
	contains: '@>',
	containedBy: '<@',
	overlaps: '&&',
	strictlyLeftOf: '<<',
	strictlyRightOf: '>>',
	doesNotExtendRightOf: '&<',
	doesNotExtendLeftOf: '&>',
	adjacentTo: '-|-',
	isSubnetOf: '<<',
	isSubnetOrEqual: '<<=',
	isSupernetOf: '>>',
	isSupernetOrEqual: '>>=',
	matches: '@@',
} as const;

/** The `is` tests: operator and keyword. */
const TESTS = {
	isNull: ['is', null],
	isNotNull: ['is not', null],
	isTrue: ['is', true],
	isNotTrue: ['is not', true],
	isFalse: ['is', false],
	isNotFalse: ['is not', false],
} as const;

/**
 * `left operator value`. `left` encodes plain values and parameters on the
 * right by its SQL type; a parameter on the left, which has none, is encoded
 * by the element type of the `any` / `all` array on the right.
 */
export function compare(
	left: Expression<unknown>,
	operator: string,
	value: unknown,
): Predicate<null> {
	if (left instanceof Param) {
		const element =
			value instanceof Quantified ? value._quarry.element : undefined;
		if (element === undefined) {
			throw new Error(
				'A parameter on the left needs any() or all() of an array column or expression on the right',
			);
		}
		const serialize = (item: unknown) => element.serialize(item);
		return predicate(
			comparison(
				{ kind: 'value', value: serialize(left._quarry.value) },
				operator,
				value,
				serialize,
			),
		);
	}
	if (!(left instanceof TypedExpression)) {
		throw new TypeError('Only an expression of known SQL type is compared');
	}
	const type: DataType = left._quarry.dataType;
	return predicate(
		comparison(left._quarry.node, operator, value, (item) =>
			type.serialize(item),
		),
	);
}

const methods: Record<
	string,
	(this: Expression<unknown>, value: never) => unknown
> = {};
for (const [name, operator] of Object.entries(OPERATORS)) {
	methods[name] = function (this: Expression<unknown>, value: unknown) {
		return compare(this, operator, value);
	};
}
for (const [name, [operator, keyword]] of Object.entries(TESTS)) {
	methods[name] = function (this: Expression<unknown>) {
		return compare(this, operator, keyword);
	};
}

/** A typed expression with the methods. `Expr` types it per kind. */
class MethodExpression<T, D extends DataType> extends TypedExpression<T, D> {}

/** A parameter with the methods. `Value` types the ones it has. */
class MethodParam<T> extends Param<T> {}

for (const prototype of [MethodExpression.prototype, MethodParam.prototype]) {
	for (const [name, method] of Object.entries(methods)) {
		Object.defineProperty(prototype, name, {
			value: method,
			writable: true,
			configurable: true,
		});
	}
}

/**
 * An expression of the given SQL type, with its methods. The caller's
 * signature supplies its type, so this returns the bottom type.
 */
export function typedExpression(
	node: OperationNode,
	dataType: DataType,
): never {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the signature supplies the type
	return new MethodExpression(node, dataType) as never;
}

/** A parameter, with its methods. Like `typedExpression`, typed by the caller. */
export function param(value: unknown): never {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the signature supplies the type
	return new MethodParam(value) as never;
}

/** A boolean expression, with the boolean methods. */
export function predicate(node: OperationNode): Predicate {
	return typedExpression(node, new DataType('boolean'));
}
