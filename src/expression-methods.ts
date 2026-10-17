import {
	comparison,
	undefinedComparison,
	type CodecFor,
} from './comparison.js';
import { DataType } from './data-type/data-type.js';
import { codecs } from './driver/codecs.js';
import { isRange } from './range.js';
import {
	Expression,
	Param,
	Quantified,
	TypedExpression,
} from './expression.js';
import { declareParamType, type Codec } from './driver/codec.js';
import { kindCodec } from './kind-codecs.js';
import type { OperationNode } from './node.js';
import type { Kind, Predicate } from './operators.js';

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

/** The operators whose right-hand side is not of the left's type, and isn't encoded by its codec. */
const OTHER_OPERAND = new Set(['@@']);

/**
 * How a value compared with an expression of SQL type `type` is encoded:
 * by its codec, except a point a range is tested to contain (`@>`), by its
 * point type's, and a tsquery matched against a tsvector, whose type
 * postgres infers.
 */
function codecFor(type: DataType, operator: string): CodecFor {
	if (OTHER_OPERAND.has(operator)) return () => undefined;
	if (operator === '@>' && type.kind === 'daterange')
		return (value) => (isRange(value) ? type.codec : codecs.date);
	if (operator === '@>' && type.kind === 'tstzrange')
		return (value) => (value instanceof Date ? codecs.timestamptz : type.codec);
	return () => type.codec;
}

/**
 * `left operator value`. `left` encodes plain values and parameters on the
 * right with its codec; a parameter on the left, which has no SQL type, is
 * encoded by the element codec of the `any` / `all` array on the right.
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
		if (left._quarry.value === undefined) throw undefinedComparison(undefined);
		const codec = left._quarry.codec ?? element.codec;
		return predicate(
			comparison(
				{ kind: 'value', value: left._quarry.value, codec },
				operator,
				value,
				() => element.codec,
			),
		);
	}
	if (!(left instanceof TypedExpression)) {
		throw new TypeError('Only an expression of known SQL type is compared');
	}
	const type: DataType = left._quarry.dataType;
	return predicate(
		comparison(left._quarry.node, operator, value, codecFor(type, operator)),
	);
}

/** The arithmetic methods and the operator each applies. */
const ARITHMETIC = {
	plus: '+',
	minus: '-',
	times: '*',
	dividedBy: '/',
	mod: '%',
	l2Distance: '<->',
	cosineDistance: '<=>',
	innerProduct: '<#>',
} as const;

const NUMBER_KINDS: readonly string[] = [
	'smallint',
	'integer',
	'bigint',
	'decimal',
	'real',
	'double precision',
];

const EXACT_KINDS: readonly string[] = [
	'smallint',
	'integer',
	'bigint',
	'decimal',
];

/** The kind of `a op b` for numeric kinds, as `WiderKind` types it. */
function widerKind(a: Kind, b: Kind): Kind {
	if (a === b) return a;
	if (EXACT_KINDS.includes(a) && EXACT_KINDS.includes(b)) {
		return EXACT_KINDS.indexOf(a) > EXACT_KINDS.indexOf(b) ? a : b;
	}
	return 'double precision';
}

/**
 * The kind of `left op right`, and the codec a plain value on the right is
 * sent with, for a left side of kind `left`; `right` is the right side's
 * kind when it is an expression.
 */
function arithmeticOf(
	left: Kind,
	operator: string,
	right: Kind | undefined,
	value: unknown,
): { kind: Kind; codec: Codec } {
	if (operator === '<->' || operator === '<=>' || operator === '<#>')
		return { kind: 'double precision', codec: kindCodec('vector') };
	if (NUMBER_KINDS.includes(left))
		return { kind: widerKind(left, right ?? left), codec: kindCodec(left) };
	if (left === 'date') {
		const days = right === undefined ? typeof value === 'number' : right !== 'date';
		return days
			? { kind: 'date', codec: codecs.int4 }
			: { kind: 'integer', codec: codecs.date };
	}
	if (left === 'timestamp' || left === 'timestamptz') {
		const interval =
			right === undefined ? typeof value === 'string' : right === 'interval';
		return interval
			? { kind: left, codec: codecs.interval }
			: { kind: 'interval', codec: kindCodec(left) };
	}
	return { kind: left, codec: kindCodec(left) };
}

/**
 * `left operator value`, an arithmetic (or distance) expression whose SQL
 * type follows postgres's: see `arithmeticOf`. A plain value or parameter
 * on the right is sent with its type declared, so postgres resolves the
 * operator by it (`timestamptz - $1` is otherwise ambiguous).
 */
export function arithmetic(
	left: Expression<unknown>,
	operator: string,
	value: unknown,
): unknown {
	if (!(left instanceof TypedExpression)) {
		throw new TypeError('Only an expression of known SQL type has arithmetic');
	}
	if (value === undefined) throw undefinedComparison(left._quarry.node);
	const leftKind = left._quarry.dataType.kind;
	const rightKind =
		value instanceof TypedExpression ? value._quarry.dataType.kind : undefined;
	const inner = value instanceof Param ? value._quarry.value : value;
	if (inner === undefined) throw undefinedComparison(left._quarry.node);
	const { kind, codec } = arithmeticOf(leftKind, operator, rightKind, inner);
	const right: OperationNode =
		value instanceof Param
			? {
					kind: 'value',
					value: inner,
					codec: value._quarry.codec ?? declareParamType(codec),
				}
			: Expression.is(value)
				? value._quarry.node
				: { kind: 'value', value, codec: declareParamType(codec) };
	return typedExpression(
		{ kind: 'binary', left: left._quarry.node, operator, right },
		new DataType(kind),
	);
}

const methods: Record<
	string,
	(this: Expression<unknown>, value: never) => unknown
> = {};
for (const [name, operator] of Object.entries(ARITHMETIC)) {
	methods[name] = function (this: Expression<unknown>, value: unknown) {
		return arithmetic(this, operator, value);
	};
}
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
export function param(value: unknown, codec?: Codec): never {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the signature supplies the type
	return new MethodParam(value, codec) as never;
}

/** A boolean expression, with the boolean methods. */
export function predicate(node: OperationNode): Predicate {
	return typedExpression(node, new DataType('boolean'));
}
