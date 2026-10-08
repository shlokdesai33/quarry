import { Expression, Param, Quantified } from './expression.js';
import type { OperationNode } from './node.js';

/** `x in arr` is `x = any(arr)`, and `x not in arr` is `x <> all(arr)`. */
const QUANTIFIED = {
	in: ['=', 'any'],
	'not in': ['<>', 'all'],
} as const;

/**
 * Builds the node for `left operator value`. Operators whose right-hand side
 * is not a single value are lowered to generic nodes, so `compile` needs no
 * operator-specific rendering. Plain values and parameters go through
 * `serialize`; other expressions are used as-is. An array of operands, as `in`
 * against an array and `any` / `all` take, is one parameter whose items are
 * each encoded.
 */
export function comparison(
	left: OperationNode,
	operator: string,
	value: unknown,
	serialize: (value: unknown) => unknown,
): OperationNode {
	const operand = (item: unknown): OperationNode => {
		if (item instanceof Param) {
			return { kind: 'value', value: serialize(item._quarry.value) };
		}
		return Expression.is(item)
			? item._quarry.node
			: { kind: 'value', value: serialize(item) };
	};

	const array = (items: unknown): OperationNode => {
		const values = items instanceof Param ? items._quarry.value : items;
		return Array.isArray(values)
			? { kind: 'value', value: values.map(serialize) }
			: operand(items);
	};

	if (value instanceof Quantified) {
		return {
			kind: 'binary',
			left,
			operator,
			right: {
				kind: 'function',
				name: value._quarry.quantifier,
				args: [array(value._quarry.array)],
			},
		};
	}

	switch (operator) {
		case 'is':
		case 'is not': {
			return {
				kind: 'binary',
				left,
				operator,
				right: {
					kind: 'literal',
					value: value as boolean | null,
				},
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
						values: value.map(operand),
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
				right: { kind: 'function', name: fn, args: [array(value)] },
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
						nodes: [operand(value[0]), operand(value[1])],
					},
				};
			}
			break;
		}
	}

	return { kind: 'binary', left, operator, right: operand(value) };
}
