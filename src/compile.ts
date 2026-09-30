import type { OperationNode } from './node.js';

export interface CompiledQuery {
	readonly sql: string;
	readonly params: readonly unknown[];
}

/**
 * Renders a node tree to SQL text and a positional parameter list.
 * Parameters are numbered in the order they are encountered.
 */
export function compile(node: OperationNode): CompiledQuery {
	const params: unknown[] = [];
	const sql = render(node, params);
	return { sql, params };
}

function render(node: OperationNode, params: unknown[]): string {
	switch (node.kind) {
		case 'reference':
			return `${identifier(node.table)}.${identifier(node.column)}`;
		case 'value':
			params.push(node.value);
			return `$${params.length}`;
		case 'value_list':
			return `(${node.values.map((value) => render(value, params)).join(', ')})`;
		case 'literal':
			return String(node.value);
		case 'binary':
			return `${renderOperand(node.left, params)} ${node.operator} ${renderOperand(node.right, params)}`;
		case 'and':
			return renderLogical(node.operands, 'and', 'true', params);
		case 'or':
			return renderLogical(node.operands, 'or', 'false', params);
		case 'not':
			return `not (${render(node.operand, params)})`;
		case 'function':
			return `${node.name}(${node.args.map((arg) => render(arg, params)).join(', ')})`;
		case 'raw':
			return node.nodes.reduce(
				(sql, embedded, i) =>
					sql + render(embedded, params) + (node.fragments[i + 1] ?? ''),
				node.fragments[0] ?? '',
			);
	}
}

/** Nested comparisons are parenthesised so postgres precedence cannot regroup them. */
function renderOperand(node: OperationNode, params: unknown[]): string {
	const sql = render(node, params);
	return rendersAsBinary(node) ? `(${sql})` : sql;
}

/** A single-operand `and` / `or` renders as its operand, unparenthesised. */
function rendersAsBinary(node: OperationNode): boolean {
	if (node.kind === 'and' || node.kind === 'or') {
		const [only, ...rest] = node.operands;
		return only !== undefined && rest.length === 0 && rendersAsBinary(only);
	}
	return node.kind === 'binary';
}

function renderLogical(
	operands: readonly OperationNode[],
	operator: 'and' | 'or',
	empty: 'true' | 'false',
	params: unknown[],
): string {
	const [first, ...rest] = operands;
	if (first === undefined) return empty;
	if (rest.length === 0) return render(first, params);
	const rendered = operands.map((operand) => render(operand, params));
	return `(${rendered.join(` ${operator} `)})`;
}

function identifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}
