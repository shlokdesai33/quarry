import { arrayOf, type Codec } from './driver/codec.js';
import { Expression, Param, Quantified } from './expression.js';
import type { OperationNode, ValueNode } from './node.js';

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

/** Whether `node` reads a `sensitive()` column anywhere within it. */
export function readsSensitive(node: OperationNode): boolean {
	switch (node.kind) {
		case 'reference':
			return node.sensitive === true;
		case 'value':
		case 'literal':
			return false;
		case 'value_list':
			return node.values.some(readsSensitive);
		case 'binary':
			return readsSensitive(node.left) || readsSensitive(node.right);
		case 'and':
		case 'or':
			return node.operands.some(readsSensitive);
		case 'not':
			return readsSensitive(node.operand);
		case 'function':
			return node.args.some(readsSensitive);
		case 'raw':
			return node.nodes.some(readsSensitive);
		case 'select':
			return false;
	}
}

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
 * one of the items, throws. The parameters are marked `sensitive` when
 * `left` reads a `sensitive()` column, or when `sensitive` says so.
 */
export function comparison(
	left: OperationNode,
	operator: string,
	value: unknown,
	codecFor: CodecFor,
	sensitive = readsSensitive(left),
): OperationNode {
	const parameter = (inner: unknown, codec: Codec | undefined): ValueNode =>
		sensitive
			? { kind: 'value', value: inner, codec, sensitive: true }
			: { kind: 'value', value: inner, codec };
	const check = (item: unknown): unknown => {
		if (item === undefined) throw undefinedComparison(left);
		return item;
	};
	const operand = (item: unknown): OperationNode => {
		if (item instanceof Param) {
			const inner = check(item._quarry.value);
			return parameter(inner, item._quarry.codec ?? codecFor(inner));
		}
		return Expression.is(item)
			? item._quarry.node
			: parameter(check(item), codecFor(item));
	};

	const array = (items: unknown): OperationNode => {
		const values = items instanceof Param ? items._quarry.value : items;
		if (!Array.isArray(values)) return operand(items);
		for (const item of values) check(item);
		return parameter(
			values,
			(items instanceof Param ? items._quarry.codec : undefined) ??
				arrayCodec(values, codecFor),
		);
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
