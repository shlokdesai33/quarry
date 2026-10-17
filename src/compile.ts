import type {
	AliasNode,
	DeleteNode,
	InsertNode,
	JoinNode,
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
import { arrayOf, declareParamType, type Codec } from './driver/codec.js';

export interface CompiledQuery {
	readonly sql: string;
	/** The parameters' values, as given. */
	readonly params: readonly unknown[];
	/**
	 * The driver codec of each parameter, by position: chosen by the column
	 * or expression it is compared with or written to, so the driver
	 * encodes it once and declares its type. `undefined` where nothing
	 * types it (`eb.val` on its own); absent when no parameter has one.
	 * Like `resultCodecs`, not an own property: a copy made by spreading
	 * the query leaves the values to the driver's defaults.
	 */
	readonly paramCodecs?: readonly (Codec | undefined)[] | undefined;
	/**
	 * The codec of each result column, by position, where its SQL type is
	 * known; `null` elsewhere. The driver reads each column with its codec
	 * while the column has that type, in the codec's format once the
	 * statement's columns are described.
	 */
	readonly resultCodecs?: readonly (Codec | null)[] | undefined;
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
	const params: Params = { values: [], codecs: [], typed: false };
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
	const selections =
		node.kind === 'select'
			? node.selections
			: node.kind === 'insert' ||
				  node.kind === 'update' ||
				  node.kind === 'delete'
				? node.returning
				: [];
	let resultCodecs: (Codec | null)[] | undefined;
	for (let i = 0; i < selections.length; i++) {
		const codec = selections[i]?.codec;
		if (codec === undefined) continue;
		resultCodecs ??= selections.map(() => null);
		resultCodecs[i] = codec;
	}
	return new Compiled(
		sql,
		params.values,
		tag,
		params.typed ? params.codecs : undefined,
		resultCodecs,
	);
}

/**
 * A compiled query. Its codecs are read through getters, not own
 * properties: what the executor reads, kept out of logs and comparisons.
 */
class Compiled implements CompiledQuery {
	readonly sql: string;
	readonly params: readonly unknown[];
	declare readonly tag?: string;
	readonly #paramCodecs: readonly (Codec | undefined)[] | undefined;
	readonly #resultCodecs: readonly (Codec | null)[] | undefined;

	constructor(
		sql: string,
		params: readonly unknown[],
		tag: string | undefined,
		paramCodecs: readonly (Codec | undefined)[] | undefined,
		resultCodecs: readonly (Codec | null)[] | undefined,
	) {
		this.sql = sql;
		this.params = params;
		if (tag !== undefined) Object.assign(this, { tag });
		this.#paramCodecs = paramCodecs;
		this.#resultCodecs = resultCodecs;
	}

	get paramCodecs(): readonly (Codec | undefined)[] | undefined {
		return this.#paramCodecs;
	}

	get resultCodecs(): readonly (Codec | null)[] | undefined {
		return this.#resultCodecs;
	}
}

/** The parameters rendered so far, and the codec of each. */
interface Params {
	readonly values: unknown[];
	readonly codecs: (Codec | undefined)[];
	/** Whether any parameter has a codec. */
	typed: boolean;
}

/** Adds a parameter and returns its placeholder. */
function param(params: Params, value: unknown, codec?: Codec): string {
	params.values.push(value);
	params.codecs.push(codec);
	if (codec !== undefined) params.typed = true;
	return `$${params.values.length}`;
}

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
		const codec = rows.codecs[i];
		const placeholder = param(
			params,
			rows.rows.map((row) => {
				const cell = row[i];
				return cell?.kind === 'value' ? cell.value : null;
			}),
			// the cast pins the array's type, so it can be declared
			codec === undefined || codec.element !== undefined
				? undefined
				: declareParamType(arrayOf(codec)),
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

function renderUpdate(node: UpdateNode, params: Params): string {
	if (node.set.length === 0) throw new Error('An update needs columns to set');
	let sql = `update ${renderTable(node.table)} set ${renderSets(node.set, params)}`;
	const { from } = node;
	if (from !== undefined) {
		if (!unnestable(from.rows)) {
			throw new Error(
				'setEach sends its rows with unnest: every value must be a plain value, and array columns are not supported',
			);
		}
		sql += ` from ${renderUnnest(from.rows, params)} as ${identifier(from.alias)}(${from.rows.columns.map(identifier).join(', ')})`;
	}
	if (node.where !== undefined) sql += ` where ${render(node.where, params)}`;
	else if (!node.allRows)
		throw new Error('An update needs where() or allRows()');
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
			return param(params, node.value, node.codec);
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
		case 'function': {
			const args = node.args.map((arg) => render(arg, params)).join(', ');
			return `${node.name}(${node.distinct === true ? `distinct ${args}` : args})`;
		}
		case 'case': {
			let sql = 'case';
			for (const branch of node.branches) {
				sql += ` when ${render(branch.when, params)} then ${render(branch.result, params)}`;
			}
			if (node.otherwise !== undefined)
				sql += ` else ${render(node.otherwise, params)}`;
			return `${sql} end`;
		}
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

/** A `group by`, `order by` or `distinct on` key: an expression, or a selected column by its alias. */
function renderKey(node: OperationNode | AliasNode, params: Params): string {
	return node.kind === 'alias' ? identifier(node.alias) : render(node, params);
}

function renderKeys(
	keys: readonly (OperationNode | AliasNode)[],
	params: Params,
): string {
	return keys.map((key) => renderKey(key, params)).join(', ');
}

function renderJoin(join: JoinNode, params: Params): string {
	const table = renderTable(join.table);
	if (join.kind === 'cross') return ` cross join ${table}`;
	if (join.on === undefined)
		throw new Error(`A ${join.kind} join needs an on() condition`);
	return ` ${join.kind} join ${table} on ${render(join.on, params)}`;
}

function renderSelect(node: SelectNode, params: Params): string {
	let sql = 'select';
	if (node.distinct === true) sql += ' distinct';
	else if (node.distinct !== undefined)
		sql += ` distinct on (${renderKeys(node.distinct, params)})`;
	const selections = node.selections.map(
		(selection) =>
			`${render(selection.expression, params)} as ${identifier(selection.alias)}`,
	);
	if (selections.length > 0) sql += ` ${selections.join(', ')}`;
	sql += ` from ${renderTable(node.from)}`;
	for (const join of node.joins) sql += renderJoin(join, params);
	if (node.where !== undefined) {
		sql += ` where ${render(node.where, params)}`;
	}
	if (node.groupBy !== undefined && node.groupBy.length > 0) {
		sql += ` group by ${renderKeys(node.groupBy, params)}`;
	}
	if (node.having !== undefined) {
		sql += ` having ${render(node.having, params)}`;
	}
	if (node.orderBy !== undefined && node.orderBy.length > 0) {
		const keys = node.orderBy.map((key) => {
			let rendered = renderKey(key.expression, params);
			if (key.direction !== undefined) rendered += ` ${key.direction}`;
			if (key.nulls !== undefined) rendered += ` nulls ${key.nulls}`;
			return rendered;
		});
		sql += ` order by ${keys.join(', ')}`;
	}
	if (node.limit !== undefined) {
		sql += ` limit ${param(params, node.limit)}`;
	}
	if (node.offset !== undefined) {
		sql += ` offset ${param(params, node.offset)}`;
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
const aggregates = new Set([
	'count',
	'min',
	'max',
	'sum',
	'avg',
	'array_agg',
	'string_agg',
	'bool_and',
	'bool_or',
]);

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
		case 'case':
			return (
				node.branches.some(
					(branch) => hasAggregate(branch.when) || hasAggregate(branch.result),
				) ||
				(node.otherwise !== undefined && hasAggregate(node.otherwise))
			);
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

/**
 * Operands that are operations themselves (comparisons, arithmetic, `not`)
 * are parenthesised, so postgres precedence cannot regroup them: `not` binds
 * looser than `is`, so `not (a) is null` would read as `not ((a) is null)`.
 */
function renderOperand(node: OperationNode, params: Params): string {
	const sql = render(node, params);
	return rendersAsOperation(node) ? `(${sql})` : sql;
}

/** A single-operand `and` / `or` renders as its operand, unparenthesised. */
function rendersAsOperation(node: OperationNode): boolean {
	if (node.kind === 'and' || node.kind === 'or') {
		const [only, ...rest] = node.operands;
		return only !== undefined && rest.length === 0 && rendersAsOperation(only);
	}
	return node.kind === 'binary' || node.kind === 'not';
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

/** `name` as a quoted identifier. */
export function identifier(name: string): string {
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
