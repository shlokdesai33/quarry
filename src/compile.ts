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
import { readsSensitive } from './comparison.js';
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

/** What the compiler knows about one parameter besides its value. */
export interface ParamInfo {
	/** The codec the value is encoded with, when something types it. */
	readonly codec: Codec | undefined;
	/** Bound against a `sensitive()` column. */
	readonly sensitive: boolean;
	/** The cast the SQL writes right after the placeholder, e.g. `integer[]`. */
	readonly cast: string | undefined;
}

/** What a compiled query's SQL and params don't say: kept beside it, never sent. */
export interface QueryInfo {
	/** What the query was compiled from, to render it again (`toSQL`'s options). */
	readonly node: StatementNode;
	/** Per parameter, in order. */
	readonly params: readonly ParamInfo[];
	/** The result columns (select list or `returning` aliases) that read a sensitive column. */
	readonly sensitiveFields: ReadonlySet<string>;
	/**
	 * Whether every result column counts as sensitive: a statement written
	 * with `sql` that reads a sensitive column, whose columns aren't known.
	 */
	readonly everyFieldSensitive: boolean;
	/** The sensitive columns of the tables the query names, by table name in the database. */
	readonly sensitiveColumns: ReadonlyMap<string, ReadonlySet<string>>;
}

const infos = new WeakMap<CompiledQuery, QueryInfo>();

/** What `compile` recorded about `query`, if it compiled it. */
export function queryInfo(query: CompiledQuery): QueryInfo | undefined {
	return infos.get(query);
}

/** What a sensitive value is shown as. */
export const REDACTED = '[redacted]';

/** `query`'s params with those bound against sensitive columns redacted. */
export function redactedParams(query: CompiledQuery): readonly unknown[] {
	const info = infos.get(query);
	if (info === undefined || !info.params.some((p) => p.sensitive))
		return query.params;
	return query.params.map((value, i) =>
		info.params[i]?.sensitive ? REDACTED : value,
	);
}

/**
 * `query` with its sensitive params redacted, for errors and events: the
 * query itself when it has none, otherwise a copy without its codecs.
 */
export function redactedQuery(query: CompiledQuery): CompiledQuery {
	const params = redactedParams(query);
	if (params === query.params) return query;
	return query.tag === undefined
		? { sql: query.sql, params }
		: { sql: query.sql, params, tag: query.tag };
}

/** Renders a parameter in place of `$n`. */
export type Inline = (value: unknown, info: ParamInfo) => string;

/**
 * Renders a node tree to SQL text and a positional parameter list.
 * Parameters are numbered in the order they are encountered. A query's tag
 * is carried over as is.
 */
export function compile(node: StatementNode): CompiledQuery {
	return compileWith(node, undefined);
}

/**
 * `compile`, with each parameter rendered by `inline` instead of as `$n`
 * when it is given (its values and codecs are still collected).
 */
export function compileWith(
	node: StatementNode,
	inline: Inline | undefined,
): CompiledQuery {
	const params = new Params(inline);
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
	const query = new Compiled(
		sql,
		params.values,
		tag,
		params.typed ? params.codecs : undefined,
		resultCodecs,
	);
	infos.set(query, {
		node,
		params: params.info,
		sensitiveFields: params.sensitiveFields,
		everyFieldSensitive: node.kind === 'raw' && readsSensitive(node),
		sensitiveColumns: params.sensitiveColumns,
	});
	return query;
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

/** `query` with its SQL replaced by `sql`, keeping its params, tag, codecs and info. */
export function withSQL(query: CompiledQuery, sql: string): CompiledQuery {
	const copy = new Compiled(
		sql,
		query.params,
		query.tag,
		query.paramCodecs,
		query.resultCodecs,
	);
	const info = infos.get(query);
	if (info !== undefined) infos.set(copy, info);
	return copy;
}

/** Collects a statement's parameters, and what is known about them, as it renders. */
class Params {
	readonly values: unknown[] = [];
	readonly codecs: (Codec | undefined)[] = [];
	/** Whether any parameter has a codec. */
	typed = false;
	readonly info: ParamInfo[] = [];
	readonly sensitiveFields = new Set<string>();
	readonly sensitiveColumns = new Map<string, Set<string>>();
	readonly #inline: Inline | undefined;

	constructor(inline: Inline | undefined) {
		this.#inline = inline;
	}

	table(table: TableNode): void {
		if (table.sensitive === undefined) return;
		let columns = this.sensitiveColumns.get(table.name);
		if (columns === undefined) {
			columns = new Set();
			this.sensitiveColumns.set(table.name, columns);
		}
		for (const column of table.sensitive) columns.add(column);
	}

	selection(selection: SelectionNode): void {
		if (readsSensitive(selection.expression))
			this.sensitiveFields.add(selection.alias);
	}

	/** Adds a parameter; returns its placeholder, or its literal when inlining. */
	add(
		value: unknown,
		codec: Codec | undefined,
		sensitive: boolean,
		cast: string | undefined,
	): string {
		const info = { codec, sensitive, cast };
		this.values.push(value);
		this.codecs.push(codec);
		this.info.push(info);
		if (codec !== undefined) this.typed = true;
		return this.#inline === undefined
			? `$${this.values.length}`
			: this.#inline(value, info);
	}
}

/** Adds a parameter and returns its placeholder (its literal, when inlining). */
function param(
	params: Params,
	value: unknown,
	codec?: Codec,
	sensitive = false,
	cast?: string,
): string {
	return params.add(value, codec, sensitive, cast);
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
		const cells = rows.rows.map((row) => row[i]);
		const placeholder = param(
			params,
			cells.map((cell) => (cell?.kind === 'value' ? cell.value : null)),
			// the cast pins the array's type, so it can be declared
			codec === undefined || codec.element !== undefined
				? undefined
				: declareParamType(arrayOf(codec)),
			cells.some((cell) => cell?.kind === 'value' && cell.sensitive === true),
			`${type}[]`,
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
	for (const selection of returning) params.selection(selection);
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
	let sql = `insert into ${renderTable(node.table, params)}`;
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
	let sql = `update ${renderTable(node.table, params)} set ${renderSets(node.set, params)}`;
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
	let sql = `delete from ${renderTable(node.table, params)}`;
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
			return param(params, node.value, node.codec, node.sensitive === true);
		case 'value_list':
			return `(${node.values.map((value) => render(value, params)).join(', ')})`;
		case 'literal':
			return typeof node.value === 'string'
				? stringLiteral(node.value)
				: String(node.value);
		case 'binary':
			return `${renderOperand(node.left, params, readsSensitive(node.right))} ${node.operator} ${renderOperand(node.right, params, readsSensitive(node.left))}`;
		case 'and':
			return renderLogical(node.operands, 'and', 'true', params);
		case 'or':
			return renderLogical(node.operands, 'or', 'false', params);
		case 'not':
			return `not (${render(node.operand, params)})`;
		case 'function': {
			const sensitive = node.args.some(readsSensitive);
			const args = node.args
				.map((arg) => renderBeside(arg, params, sensitive))
				.join(', ');
			return `${node.name}(${node.distinct === true ? `distinct ${args}` : args})`;
		}
		case 'case': {
			const results = node.branches.map((branch) => branch.result);
			if (node.otherwise !== undefined) results.push(node.otherwise);
			const sensitive = results.some(readsSensitive);
			let sql = 'case';
			for (const branch of node.branches) {
				sql += ` when ${render(branch.when, params)} then ${renderBeside(branch.result, params, sensitive)}`;
			}
			if (node.otherwise !== undefined)
				sql += ` else ${renderBeside(node.otherwise, params, sensitive)}`;
			return `${sql} end`;
		}
		case 'raw': {
			if (node.table !== undefined) params.table(node.table);
			const sensitive = readsSensitive(node);
			return node.nodes.reduce(
				(sql, embedded, i) =>
					sql +
					renderBeside(embedded, params, sensitive) +
					(node.fragments[i + 1] ?? ''),
				node.fragments[0] ?? '',
			);
		}
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
	const table = renderTable(join.table, params);
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
	const selections = node.selections.map((selection) => {
		params.selection(selection);
		return `${render(selection.expression, params)} as ${identifier(selection.alias)}`;
	});
	if (selections.length > 0) sql += ` ${selections.join(', ')}`;
	sql += ` from ${renderTable(node.from, params)}`;
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

function renderTable(table: TableNode, params: Params): string {
	params.table(table);
	return table.alias === undefined
		? identifier(table.name)
		: `${identifier(table.name)} as ${identifier(table.alias)}`;
}

/**
 * Operands that are operations themselves (comparisons, arithmetic, `not`)
 * are parenthesised, so postgres precedence cannot regroup them: `not` binds
 * looser than `is`, so `not (a) is null` would read as `not ((a) is null)`.
 */
function renderOperand(
	node: OperationNode,
	params: Params,
	sensitive = false,
): string {
	const sql = renderBeside(node, params, sensitive);
	return rendersAsOperation(node) ? `(${sql})` : sql;
}

/**
 * `node`, a parameter redacted when `sensitive`: one written beside an
 * operand that reads a `sensitive()` column (the other side of an operator,
 * another argument of a function, a raw fragment's column or table, another
 * result of a case), whatever built it.
 */
function renderBeside(
	node: OperationNode,
	params: Params,
	sensitive: boolean,
): string {
	return sensitive && node.kind === 'value'
		? param(params, node.value, node.codec, true)
		: render(node, params);
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
export function stringLiteral(value: string): string {
	if (value.includes('\0')) {
		throw new Error('A string literal cannot contain a NUL character');
	}
	const quoted = value.replaceAll("'", "''");
	return value.includes('\\')
		? `E'${quoted.replaceAll('\\', '\\\\')}'`
		: `'${quoted}'`;
}
