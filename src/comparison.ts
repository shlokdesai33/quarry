import { Expression } from './expression.js';
import type { OperationNode } from './node.js';

/** `value = any(col)` and `value <> all(col)`: the value goes on the left. */
const QUANTIFIED = {
	'= any': ['=', 'any'],
	'<> all': ['<>', 'all'],
} as const;

/**
 * Builds the node for `left operator value`. Operators whose right-hand side
 * is not a single value are lowered to generic nodes, so `compile` needs no
 * operator-specific rendering. Plain values go through `encode`.
 */
export function comparison(
	left: OperationNode,
	operator: string,
	value: unknown,
	encode: (value: unknown) => unknown,
): OperationNode {
	const operand = (item: unknown): OperationNode =>
		Expression.is(item)
			? item.toNode()
			: { kind: 'value', value: encode(item) };

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
			// uses the equivalent `x = any(arr)` / `x <> all(arr)`
			const [op, fn] = QUANTIFIED[operator === 'in' ? '= any' : '<> all'];

			return {
				kind: 'binary',
				left,
				operator: op,
				right: { kind: 'function', name: fn, args: [operand(value)] },
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
		case '= any':
		case '<> all': {
			const [op, fn] = QUANTIFIED[operator];
			return {
				kind: 'binary',
				left: operand(value),
				operator: op,
				right: { kind: 'function', name: fn, args: [left] },
			};
		}
	}

	return { kind: 'binary', left, operator, right: operand(value) };
}
