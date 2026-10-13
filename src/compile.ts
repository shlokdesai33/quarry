import type {
	DeleteNode,
	InsertNode,
	LockNode,
	OnConflictNode,
	OperationNode,
	RowsNode,
	SelectionNode,
	SelectNode,
	SetNode,
	TableNode,
	UpdateNode,
} from './node.js';
import { arrayOids } from './driver/types.js';

export interface CompiledQuery {
	readonly sql: string;
	readonly params: readonly unknown[];
	/**
	 * Type OIDs declared for the parameters, 0 where the server infers the
	 * type; absent when none is declared. Only arrays are declared, where
	 * the type is certain, so the driver can send them in binary.
	 */
	readonly paramTypes?: readonly number[];
	/** The query's label from `tag()`, if any. It is not part of `sql`. */
	readonly tag?: string;
}

/** A whole statement: a query or a write. */
export type StatementNode =
	| OperationNode
	| InsertNode
	| UpdateNode
	| DeleteNode;

/**
 * Renders a node tree to SQL text and a positional parameter list.
 * Parameters are numbered in the order they are encountered. A query's tag
 * is carried over as is.
 */
export function compile(node: StatementNode): CompiledQuery {
	const params: Params = { values: [], types: [] };
	let sql: string;
	switch (node.kind) {
		case 'insert':
			sql = renderInsert(node, params);
			break;
		case 'update':
			sql = renderUpdate(node, params);
			break;
		case 'delete':
			sql = renderDelete(node, params);
			break;
		default:
			sql = render(node, params);
	}
	const tag = 'tag' in node ? node.tag : undefined;
	return {
		sql,
		params: params.values,
		...(params.types.some((type) => type !== 0)
			? { paramTypes: params.types }
			: {}),
		...(tag === undefined ? {} : { tag }),
	};
}

/** The parameters rendered so far, and the type OID declared for each (0 for none). */
interface Params {
	readonly values: unknown[];
	readonly types: number[];
}

/** Adds a parameter and returns its placeholder. */
function param(params: Params, value: unknown, type = 0): string {
	params.values.push(value);
	params.types.push(type);
	return `$${params.values.length}`;
}

/** The array types `unnest` declares, by the cast's element type: those the driver sends in binary. */
const unnestTypes: Readonly<Record<string, number>> = {
	smallint: arrayOids.int2,
	integer: arrayOids.int4,
	bigint: arrayOids.int8,
	'double precision': arrayOids.float8,
	boolean: arrayOids.bool,
	timestamptz: arrayOids.timestamptz,
	text: arrayOids.text,
	varchar: arrayOids.varchar,
	uuid: arrayOids.uuid,
	jsonb: arrayOids.jsonb,
	bytea: arrayOids.bytea,
};

/** Whether rows can go as one array parameter per column: plain values only, no defaults, no array columns. */
function unnestable(rows: RowsNode): boolean {
	return (
		rows.types.length === rows.columns.length &&
		rows.types.every((type) => !type.endsWith(']')) &&
		rows.rows.every((row) => row.every((cell) => cell?.kind === 'value'))
	);
}

/** `unnest($1::integer[], $2::text[])`, one array parameter per column. */
function renderUnnest(rows: RowsNode, params: Params): string {
	const arrays = rows.columns.map((_, i) => {
		const type = rows.types[i] ?? '';
		const placeholder = param(
			params,
			rows.rows.map((row) => {
				const cell = row[i];
				return cell?.kind === 'value' ? cell.value : null;
			}),
			unnestTypes[type],
		);
		return `${placeholder}::${type}[]`;
	});
	return `unnest(${arrays.join(', ')})`;
}

function renderSets(sets: readonly SetNode[], params: Params): string {
	return sets
		.map((set) => `${identifier(set.column)} = ${render(set.value, params)}`)
		.join(', ');
}

function renderReturning(
	returning: readonly SelectionNode[],
	params: Params,
): string {
	if (returning.length === 0) return '';
	return ` returning ${returning.map((s) => `${render(s.expression, params)} as ${identifier(s.alias)}`).join(', ')}`;
}

function renderOnConflict(
	onConflict: OnConflictNode,
	inserted: readonly string[],
	params: Params,
): string {
	let sql = ` on conflict (${onConflict.target.map(identifier).join(', ')})`;
	if (onConflict.where !== undefined)
		sql += ` where ${render(onConflict.where, params)}`;
	const { action } = onConflict;
	if (action.kind === 'nothing') return `${sql} do nothing`;
	const sets =
		action.kind === 'update'
			? renderSets(action.set, params)
			: (action.columns ?? inserted)
					.map((c) => `${identifier(c)} = excluded.${identifier(c)}`)
					.join(', ');
	if (sets === '')
		throw new Error('An upsert that merges needs columns to set');
	sql += ` do update set ${sets}`;
	if (action.where !== undefined)
		sql += ` where ${render(action.where, params)}`;
	return sql;
}

function renderInsert(node: InsertNode, params: Params): string {
	const { columns, rows } = node.values;
	if (rows.length === 0) throw new Error('An insert needs at least one row');
	let sql = `insert into ${renderTable(node.table)}`;
	if (columns.length === 0) {
		if (rows.length > 1)
			throw new Error(
				'An insert of several rows needs at least one column to set',
			);
		sql += ' default values';
	} else if (node.values.strategy === 'unnest' && unnestable(node.values)) {
		sql += ` (${columns.map(identifier).join(', ')}) select * from ${renderUnnest(node.values, params)}`;
	} else {
		const values = rows.map(
			(row) =>
				`(${row.map((cell) => (cell === undefined ? 'default' : render(cell, params))).join(', ')})`,
		);
		sql += ` (${columns.map(identifier).join(', ')}) values ${values.join(', ')}`;
	}
	if (node.onConflict !== undefined)
		sql += renderOnConflict(node.onConflict, columns, params);
	return sql + renderReturning(node.returning, params);
}

/** The alias `updateMany`'s rows are joined under. */
const MANY = 'quarry_rows';

function renderUpdate(node: UpdateNode, params: Params): string {
	const target = identifier(node.table.alias ?? node.table.name);
	const sets: string[] = [];
	if (node.set.length > 0) sets.push(renderSets(node.set, params));
	const where: string[] = [];
	let from = '';
	const { many } = node;
	if (many !== undefined) {
		if (!unnestable(many)) {
			throw new Error(
				'updateMany needs every row to set the same columns, each to a plain value',
			);
		}
		const updated = many.columns.filter((c) => !many.by.includes(c));
		if (updated.length > 0) {
			sets.push(
				updated
					.map((c) => `${identifier(c)} = ${identifier(MANY)}.${identifier(c)}`)
					.join(', '),
			);
		}
		from = ` from ${renderUnnest(many, params)} as ${identifier(MANY)}(${many.columns.map(identifier).join(', ')})`;
		where.push(
			...many.by.map(
				(c) =>
					`${target}.${identifier(c)} = ${identifier(MANY)}.${identifier(c)}`,
			),
		);
	}
	if (sets.length === 0) throw new Error('An update needs columns to set');
	if (node.where !== undefined) where.push(render(node.where, params));
	else if (!node.allRows && many === undefined)
		throw new Error('An update needs where() or allRows()');
	let sql = `update ${renderTable(node.table)} set ${sets.join(', ')}${from}`;
	if (where.length > 0)
		sql += ` where ${where.length === 1 ? where[0] : where.map((w) => `(${w})`).join(' and ')}`;
	return sql + renderReturning(node.returning, params);
}

function renderDelete(node: DeleteNode, params: Params): string {
	let sql = `delete from ${renderTable(node.table)}`;
	if (node.where !== undefined) sql += ` where ${render(node.where, params)}`;
	else if (!node.allRows)
		throw new Error('A delete needs where() or allRows()');
	return sql + renderReturning(node.returning, params);
}

function render(node: OperationNode, params: Params): string {
	switch (node.kind) {
		case 'reference':
			return `${identifier(node.table)}.${identifier(node.column)}`;
		case 'value':
			return param(params, node.value, node.typeOid);
		case 'value_list':
			return `(${node.values.map((value) => render(value, params)).join(', ')})`;
		case 'literal':
			return typeof node.value === 'string'
				? stringLiteral(node.value)
				: String(node.value);
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
		case 'select':
			return renderSelect(node, params);
	}
}

function renderSelect(node: SelectNode, params: Params): string {
	const selections = node.selections.map(
		(selection) =>
			`${render(selection.expression, params)} as ${identifier(selection.alias)}`,
	);
	let sql =
		selections.length === 0 ? 'select' : `select ${selections.join(', ')}`;
	sql += ` from ${renderTable(node.from)}`;
	for (const join of node.joins) {
		sql += ` inner join ${renderTable(join.table)} on ${render(join.on, params)}`;
	}
	if (node.where !== undefined) {
		sql += ` where ${render(node.where, params)}`;
	}
	if (node.limit !== undefined) {
		sql += ` limit ${param(params, node.limit)}`;
	}
	if (node.locks.length > 0) {
		if (node.selections.some((s) => hasAggregate(s.expression))) {
			throw new Error(
				'A locking clause (forUpdate() and the like) cannot be used with aggregate functions',
			);
		}
		for (const lock of node.locks) sql += renderLock(lock);
	}
	return sql;
}

function renderLock(lock: LockNode): string {
	let sql = ` for ${lock.strength}`;
	if (lock.of.length > 0) sql += ` of ${lock.of.map(identifier).join(', ')}`;
	if (lock.wait !== undefined) sql += ` ${lock.wait}`;
	return sql;
}

/** The aggregate functions `eb.fn` builds. */
const aggregates = new Set(['count', 'min', 'max']);

/** Whether `node` calls an aggregate of its own query, not of a subquery's. */
function hasAggregate(node: OperationNode): boolean {
	switch (node.kind) {
		case 'function':
			return aggregates.has(node.name) || node.args.some(hasAggregate);
		case 'binary':
			return hasAggregate(node.left) || hasAggregate(node.right);
		case 'and':
		case 'or':
			return node.operands.some(hasAggregate);
		case 'not':
			return hasAggregate(node.operand);
		case 'value_list':
			return node.values.some(hasAggregate);
		case 'raw':
			return node.nodes.some(hasAggregate);
		default:
			return false;
	}
}

function renderTable(table: TableNode): string {
	return table.alias === undefined
		? identifier(table.name)
		: `${identifier(table.name)} as ${identifier(table.alias)}`;
}

/** Nested comparisons are parenthesised so postgres precedence cannot regroup them. */
function renderOperand(node: OperationNode, params: Params): string {
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
	params: Params,
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

/**
 * A quoted string literal, escaped as postgres's `quote_literal` does: quotes
 * doubled, and backslashes doubled inside an `E'...'` literal, so it reads the
 * same whatever `standard_conforming_strings` is.
 */
function stringLiteral(value: string): string {
	if (value.includes('\0')) {
		throw new Error('A string literal cannot contain a NUL character');
	}
	const quoted = value.replaceAll("'", "''");
	return value.includes('\\')
		? `E'${quoted.replaceAll('\\', '\\\\')}'`
		: `'${quoted}'`;
}
