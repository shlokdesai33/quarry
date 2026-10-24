import { arrayOf, type Codec } from './driver/codec.js';
import { Expression, Param, Quantified } from './expression.js';
import type { OperationNode } from './node.js';

/** The reference each `eb.ref` node was made from, as written (`users.firstName`), for errors. */
const references = new WeakMap<OperationNode, string>();

/** Records that `node` is the column reference `reference`, to name it in errors. */
export function nameReference(node: OperationNode, reference: string): void {
	references.set(node, reference);
}

/**
 * The error for comparing `left` with `undefined`: never sent as NULL, which
 * would quietly match nothing, so an optional filter has to be explicit.
 */
export function undefinedComparison(
	left: OperationNode | undefined,
): TypeError {
	const name =
		left === undefined
			? undefined
			: (references.get(left) ??
				(left.kind === 'reference'
					? `${left.table}.${left.column}`
					: undefined));
	const subject = name ?? 'An expression';
	const where = name === undefined ? '…' : `'${name}', value`;
	return new TypeError(
		`${subject} is compared with undefined. For an optional filter, use .when(): .when(value !== undefined, (qb) => qb.where(${where})). For SQL NULL, use isNull().`,
	);
}

/** `x in arr` is `x = any(arr)`, and `x not in arr` is `x <> all(arr)`. */
const QUANTIFIED = {
	in: ['=', 'any'],
	'not in': ['<>', 'all'],
} as const;

/** How the values of a comparison are encoded: the codec for one value. */
export type CodecFor = (value: unknown) => Codec | undefined;

/** The codec of an array of values each encoded by `codecFor`, by its first non-null one. */
function arrayCodec(
	values: readonly unknown[],
	codecFor: CodecFor,
): Codec | undefined {
	const sample = values.find((value) => value !== null && value !== undefined);
	const element = codecFor(sample);
	return element === undefined || element.element !== undefined
		? undefined
		: arrayOf(element);
}

/**
 * Builds the node for `left operator value`. Operators whose right-hand side
 * is not a single value are lowered to generic nodes, so `compile` needs no
 * operator-specific rendering. Plain values and parameters become
 * parameters with the codec `codecFor` gives them (a parameter's own, if
 * `eb.val` was given one); other expressions are used as-is. An array of
 * operands, as `in` against an array and `any` / `all` take, is one
 * parameter, encoded by `arrayOf` that codec. `undefined`, as the value or
 * one of the items, throws.
 */
export function comparison(
	left: OperationNode,
	operator: string,
	value: unknown,
	codecFor: CodecFor,
): OperationNode {
	if (value instanceof Quantified) {
		return {
			kind: 'binary',
			left,
			operator,
			right: {
				kind: 'function',
				name: value._quarry.quantifier,
				args: [arrayNode(left, value._quarry.array, codecFor)],
			},
		};
	}

	switch (operator) {
		case 'is':
		case 'is not': {
			// the typed methods only pass these; a literal is inlined, so check
			if (value !== null && typeof value !== 'boolean') {
				throw new TypeError(
					`\`${operator}\` compares with true, false or null`,
				);
			}
			return {
				kind: 'binary',
				left,
				operator,
				right: { kind: 'literal', value },
			};
		}
		case 'in':
		case 'not in': {
			if (Array.isArray(value)) {
				if (value.length === 0) {
					return {
						kind: 'literal',
						value: operator === 'not in',
					};
				}

				return {
					kind: 'binary',
					left,
					operator,
					right: {
						kind: 'value_list',
						values: operandNodes(left, value, codecFor),
					},
				};
			}

			// postgres's `in` only takes a list, so an array-valued expression
			// uses the equivalent quantified comparison
			const [op, fn] = QUANTIFIED[operator];
			return {
				kind: 'binary',
				left,
				operator: op,
				right: {
					kind: 'function',
					name: fn,
					args: [arrayNode(left, value, codecFor)],
				},
			};
		}
		case 'between':
		case 'not between': {
			if (Array.isArray(value)) {
				return {
					kind: 'binary',
					left,
					operator,
					right: {
						kind: 'raw',
						fragments: ['', ' and ', ''],
						nodes: [
							operandNode(left, value[0], codecFor),
							operandNode(left, value[1], codecFor),
						],
					},
				};
			}
			break;
		}
	}

	return {
		kind: 'binary',
		left,
		operator,
		right: operandNode(left, value, codecFor),
	};
}

/** `item`, unless it is `undefined`, which throws. */
function checked(left: OperationNode, item: unknown): unknown {
	if (item === undefined) throw undefinedComparison(left);
	return item;
}

/** One operand: a parameter for a plain value or `eb.val`, an expression as is. */
function operandNode(
	left: OperationNode,
	item: unknown,
	codecFor: CodecFor,
): OperationNode {
	if (item instanceof Param) {
		const inner = checked(left, item._quarry.value);
		return {
			kind: 'value',
			value: inner,
			codec: item._quarry.codec ?? codecFor(inner),
		};
	}
	return Expression.is(item)
		? item._quarry.node
		: { kind: 'value', value: checked(left, item), codec: codecFor(item) };
}

function operandNodes(
	left: OperationNode,
	items: readonly unknown[],
	codecFor: CodecFor,
): OperationNode[] {
	return items.map((item) => operandNode(left, item, codecFor));
}

/** An array of operands as one parameter, encoded by `arrayOf` their codec; any other operand as `operandNode` makes it. */
function arrayNode(
	left: OperationNode,
	items: unknown,
	codecFor: CodecFor,
): OperationNode {
	const values = items instanceof Param ? items._quarry.value : items;
	if (!Array.isArray(values)) return operandNode(left, items, codecFor);
	for (const item of values) checked(left, item);
	return {
		kind: 'value',
		value: values,
		codec:
			(items instanceof Param ? items._quarry.codec : undefined) ??
			arrayCodec(values, codecFor),
	};
}
