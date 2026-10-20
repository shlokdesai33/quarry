import type {
	AliasNode,
	DeleteNode,
	InsertNode,
	JoinNode,
	LockNode,
	OnConflictNode,
	OperationNode,
	ReferenceNode,
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
	const out = output();
	switch (node.kind) {
		case 'insert':
			renderInsert(node, out);
			break;
		case 'update':
			renderUpdate(node, out);
			break;
		case 'delete':
			renderDelete(node, out);
			break;
		default:
			render(node, out);
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
		sqlOf(out),
		out.values,
		tag,
		out.typed ? out.codecs : undefined,
		resultCodecs,
		node.kind === 'select' ||
			node.kind === 'insert' ||
			node.kind === 'update' ||
			node.kind === 'delete',
	);
}

/**
 * Whether `query` was compiled here from a select, insert, update or
 * delete: a statement that leaves no session or transaction state behind.
 * False for SQL written by hand (`db.sql`) and for queries made elsewhere,
 * a copy of a compiled one included.
 */
export function isDataStatement(query: CompiledQuery): boolean {
	return Compiled.isDataStatement(query);
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
	readonly #data: boolean;

	constructor(
		sql: string,
		params: readonly unknown[],
		tag: string | undefined,
		paramCodecs: readonly (Codec | undefined)[] | undefined,
		resultCodecs: readonly (Codec | null)[] | undefined,
		data: boolean,
	) {
		this.sql = sql;
		this.params = params;
		if (tag !== undefined) Object.assign(this, { tag });
		this.#paramCodecs = paramCodecs;
		this.#resultCodecs = resultCodecs;
		this.#data = data;
	}

	static isDataStatement(query: CompiledQuery): boolean {
		return #data in query && query.#data;
	}

	get paramCodecs(): readonly (Codec | undefined)[] | undefined {
		return this.#paramCodecs;
	}

	get resultCodecs(): readonly (Codec | null)[] | undefined {
		return this.#resultCodecs;
	}
}

/**
 * The SQL rendered so far, as a trie of the pieces it is written from:
 * keywords, quoted names, the shared SQL of columns, placeholders. A
 * query is rendered by walking it, so a query of a shape rendered before
 * ends on the same prefix and gets the same string. The driver keys its
 * statement cache by the SQL: a string used again keeps its hash and
 * matches its entry by identity, where a string built per query is
 * flattened, hashed and compared in full every time. Walking costs about
 * what concatenating the pieces did.
 */
class Prefix {
	readonly parent: Prefix | undefined;
	readonly piece: string;
	/** How many pieces it has. */
	readonly depth: number;
	/** The child taken last: a query rendered again takes the same path. */
	#lastPiece: string | undefined;
	#last: Prefix | undefined;
	/** Every child, once there are two. */
	#children: Map<string, Prefix> | undefined;
	#sql: string | undefined;

	constructor(parent: Prefix | undefined, piece: string) {
		this.parent = parent;
		this.piece = piece;
		this.depth = parent === undefined ? 0 : parent.depth + 1;
	}

	/** The prefix that `piece` extends this one to, if there is one yet. */
	child(piece: string): Prefix | undefined {
		if (piece === this.#lastPiece) return this.#last;
		const found = this.#children?.get(piece);
		if (found !== undefined) {
			this.#lastPiece = piece;
			this.#last = found;
		}
		return found;
	}

	/** Adds the prefix that `piece` extends this one to. */
	add(piece: string): Prefix {
		const child = new Prefix(this, piece);
		if (this.#last !== undefined) {
			// oxlint-disable-next-line typescript/no-non-null-assertion -- set with #last
			this.#children ??= new Map([[this.#lastPiece!, this.#last]]);
			this.#children.set(piece, child);
		}
		this.#lastPiece = piece;
		this.#last = child;
		return child;
	}

	/** The SQL of a query that ends here, made the first time one does. */
	get sql(): string {
		if (this.#sql === undefined) {
			this.#sql = spell(this);
			trieChars += this.#sql.length;
		}
		return this.#sql;
	}
}

/** The text of `prefix`, one flat string. */
function spell(prefix: Prefix): string {
	const pieces: string[] = [];
	for (let at = prefix; at.parent !== undefined; at = at.parent)
		pieces.push(at.piece);
	return pieces.reverse().join('');
}

/**
 * Bounds of the trie. A query takes it no further than `MAX_DEPTH`
 * pieces, nor with a piece longer than `MAX_PIECE` (a long literal):
 * the rest of its SQL is written out as a string, as a long multi-row
 * insert or a one-off literal would only fill the trie. The trie starts
 * over once it holds `MAX_PREFIXES` prefixes or `MAX_CHARS` characters,
 * so shapes made at run time can't grow it without bound.
 */
const MAX_DEPTH = 1024;
const MAX_PIECE = 4096;
const MAX_PREFIXES = 16_384;
const MAX_CHARS = 1 << 20;

let trie = new Prefix(undefined, '');
let triePrefixes = 0;
let trieChars = 0;

/** A query's SQL and parameters, as they are rendered. */
interface Output {
	/** Where its SQL so far ends in the trie; undefined once it is written out in `text`. */
	at: Prefix | undefined;
	text: string;
	readonly values: unknown[];
	/** The codec of each parameter. */
	readonly codecs: (Codec | undefined)[];
	/** Whether any parameter has a codec. */
	typed: boolean;
}

function output(): Output {
	if (triePrefixes > MAX_PREFIXES || trieChars > MAX_CHARS) {
		trie = new Prefix(undefined, '');
		triePrefixes = 0;
		trieChars = 0;
	}
	return { at: trie, text: '', values: [], codecs: [], typed: false };
}

/** Appends `piece` to the query's SQL. */
function write(out: Output, piece: string): void {
	const at = out.at;
	if (at === undefined) {
		out.text += piece;
		return;
	}
	out.at = at.child(piece) ?? extend(out, at, piece);
}

/** A new prefix of `at` and `piece`; none past the trie's bounds, with the SQL written out instead. */
function extend(out: Output, at: Prefix, piece: string): Prefix | undefined {
	if (at.depth >= MAX_DEPTH || piece.length > MAX_PIECE) {
		out.text = spell(at) + piece;
		return undefined;
	}
	triePrefixes++;
	trieChars += piece.length;
	return at.add(piece);
}

function sqlOf(out: Output): string {
	return out.at === undefined ? out.text : out.at.sql;
}

/** `$1`, `$2`, …, made once each. */
const placeholders: string[] = [];

/** Adds a parameter and writes its placeholder. */
function param(out: Output, value: unknown, codec?: Codec): void {
	out.values.push(value);
	out.codecs.push(codec);
	if (codec !== undefined) out.typed = true;
	const n = out.values.length;
	write(out, (placeholders[n] ??= `$${n}`));
}

/** Writes `items` separated by `, `, each with `each`. */
function list<T>(
	out: Output,
	items: readonly T[],
	each: (item: T, out: Output) => void,
): void {
	for (let i = 0; i < items.length; i++) {
		if (i > 0) write(out, ', ');
		// oxlint-disable-next-line typescript/no-non-null-assertion -- within bounds
		each(items[i]!, out);
	}
}

function writeIdentifier(name: string, out: Output): void {
	write(out, identifier(name));
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
function renderUnnest(rows: RowsNode, out: Output): void {
	write(out, 'unnest(');
	for (let i = 0; i < rows.columns.length; i++) {
		if (i > 0) write(out, ', ');
		const codec = rows.codecs[i];
		param(
			out,
			rows.rows.map((row) => {
				const cell = row[i];
				return cell?.kind === 'value' ? cell.value : null;
			}),
			// the cast pins the array's type, so it can be declared
			codec === undefined || codec.element !== undefined
				? undefined
				: declareParamType(arrayOf(codec)),
		);
		write(out, '::');
		write(out, rows.types[i] ?? '');
		write(out, '[]');
	}
	write(out, ')');
}

function renderSets(sets: readonly SetNode[], out: Output): void {
	list(out, sets, renderSet);
}

function renderSet(set: SetNode, out: Output): void {
	writeIdentifier(set.column, out);
	write(out, ' = ');
	render(set.value, out);
}

function renderReturning(
	returning: readonly SelectionNode[],
	out: Output,
): void {
	renderSelections(returning, ' returning ', out);
}

function renderSelection(selection: SelectionNode, out: Output): void {
	const sql = shared.get(selection);
	if (sql !== undefined) {
		write(out, sql);
		return;
	}
	render(selection.expression, out);
	write(out, ' as ');
	writeIdentifier(selection.alias, out);
}

/** A select or returning list after `prefix`; nothing when it is empty. */
function renderSelections(
	selections: readonly SelectionNode[],
	prefix: string,
	out: Output,
): void {
	if (selections.length === 0) return;
	write(out, prefix);
	list(out, selections, renderSelection);
}

function renderOnConflict(
	onConflict: OnConflictNode,
	inserted: readonly string[],
	out: Output,
): void {
	write(out, ' on conflict (');
	list(out, onConflict.target, writeIdentifier);
	write(out, ')');
	if (onConflict.where !== undefined) {
		write(out, ' where ');
		render(onConflict.where, out);
	}
	const { action } = onConflict;
	if (action.kind === 'nothing') {
		write(out, ' do nothing');
		return;
	}
	const merged = action.kind === 'update' ? [] : (action.columns ?? inserted);
	if (action.kind === 'update' ? action.set.length === 0 : merged.length === 0)
		throw new Error('An upsert that merges needs columns to set');
	write(out, ' do update set ');
	if (action.kind === 'update') renderSets(action.set, out);
	else {
		list(out, merged, (column) => {
			writeIdentifier(column, out);
			write(out, ' = excluded.');
			writeIdentifier(column, out);
		});
	}
	if (action.where !== undefined) {
		write(out, ' where ');
		render(action.where, out);
	}
}

function renderInsert(node: InsertNode, out: Output): void {
	const { columns, rows } = node.values;
	if (rows.length === 0) throw new Error('An insert needs at least one row');
	write(out, 'insert into ');
	renderTable(node.table, out);
	if (columns.length === 0) {
		if (rows.length > 1)
			throw new Error(
				'An insert of several rows needs at least one column to set',
			);
		write(out, ' default values');
	} else if (node.values.strategy === 'unnest' && unnestable(node.values)) {
		write(out, ' (');
		list(out, columns, writeIdentifier);
		write(out, ') select * from ');
		renderUnnest(node.values, out);
	} else {
		write(out, ' (');
		list(out, columns, writeIdentifier);
		write(out, ') values ');
		list(out, rows, renderRow);
	}
	if (node.onConflict !== undefined)
		renderOnConflict(node.onConflict, columns, out);
	renderReturning(node.returning, out);
}

function renderRow(row: RowsNode['rows'][number], out: Output): void {
	write(out, '(');
	list(out, row, renderCell);
	write(out, ')');
}

function renderCell(
	cell: RowsNode['rows'][number][number],
	out: Output,
): void {
	if (cell === undefined) write(out, 'default');
	else render(cell, out);
}

function renderUpdate(node: UpdateNode, out: Output): void {
	if (node.set.length === 0) throw new Error('An update needs columns to set');
	write(out, 'update ');
	renderTable(node.table, out);
	write(out, ' set ');
	renderSets(node.set, out);
	const { from } = node;
	if (from !== undefined) {
		if (!unnestable(from.rows)) {
			throw new Error(
				'setEach sends its rows with unnest: every value must be a plain value, and array columns are not supported',
			);
		}
		write(out, ' from ');
		renderUnnest(from.rows, out);
		write(out, ' as ');
		writeIdentifier(from.alias, out);
		write(out, '(');
		list(out, from.rows.columns, writeIdentifier);
		write(out, ')');
	}
	if (node.where !== undefined) {
		write(out, ' where ');
		render(node.where, out);
	} else if (!node.allRows)
		throw new Error('An update needs where() or allRows()');
	renderReturning(node.returning, out);
}

function renderDelete(node: DeleteNode, out: Output): void {
	write(out, 'delete from ');
	renderTable(node.table, out);
	if (node.where !== undefined) {
		write(out, ' where ');
		render(node.where, out);
	} else if (!node.allRows)
		throw new Error('A delete needs where() or allRows()');
	renderReturning(node.returning, out);
}

/**
 * The SQL of the nodes the builders make once per table and column and
 * share across queries (see `resolveColumn`). Nodes are immutable, so a
 * column is quoted once rather than in every query, and its SQL is one
 * piece of the trie. Only shared nodes are kept: adding the nodes each
 * query makes would cost more than it saves.
 */
const shared = new WeakMap<ReferenceNode | SelectionNode, string>();

/** Renders a column's shared reference and selection nodes once, for every query that uses them. */
export function shareColumn(
	reference: ReferenceNode,
	selection: SelectionNode,
): void {
	const sql = `${identifier(reference.table)}.${identifier(reference.column)}`;
	shared.set(reference, sql);
	shared.set(selection, `${sql} as ${identifier(selection.alias)}`);
}

function renderReference(node: ReferenceNode, out: Output): void {
	const sql = shared.get(node);
	if (sql !== undefined) {
		write(out, sql);
		return;
	}
	writeIdentifier(node.table, out);
	write(out, '.');
	writeIdentifier(node.column, out);
}

function render(node: OperationNode, out: Output): void {
	switch (node.kind) {
		case 'reference':
			renderReference(node, out);
			return;
		case 'value':
			param(out, node.value, node.codec);
			return;
		case 'value_list':
			write(out, '(');
			list(out, node.values, render);
			write(out, ')');
			return;
		case 'literal':
			write(
				out,
				typeof node.value === 'string'
					? stringLiteral(node.value)
					: String(node.value),
			);
			return;
		case 'binary':
			renderOperand(node.left, out);
			write(out, ' ');
			write(out, node.operator);
			write(out, ' ');
			renderOperand(node.right, out);
			return;
		case 'and':
			renderLogical(node.operands, ' and ', 'true', out);
			return;
		case 'or':
			renderLogical(node.operands, ' or ', 'false', out);
			return;
		case 'not':
			write(out, 'not (');
			render(node.operand, out);
			write(out, ')');
			return;
		case 'function':
			write(out, node.name);
			write(out, node.distinct === true ? '(distinct ' : '(');
			list(out, node.args, render);
			write(out, ')');
			return;
		case 'case':
			write(out, 'case');
			for (const branch of node.branches) {
				write(out, ' when ');
				render(branch.when, out);
				write(out, ' then ');
				render(branch.result, out);
			}
			if (node.otherwise !== undefined) {
				write(out, ' else ');
				render(node.otherwise, out);
			}
			write(out, ' end');
			return;
		case 'raw':
			write(out, node.fragments[0] ?? '');
			for (let i = 0; i < node.nodes.length; i++) {
				// oxlint-disable-next-line typescript/no-non-null-assertion -- within bounds
				render(node.nodes[i]!, out);
				write(out, node.fragments[i + 1] ?? '');
			}
			return;
		case 'select':
			renderSelect(node, out);
	}
}

/** A `group by`, `order by` or `distinct on` key: an expression, or a selected column by its alias. */
function renderKey(node: OperationNode | AliasNode, out: Output): void {
	if (node.kind === 'alias') writeIdentifier(node.alias, out);
	else render(node, out);
}

function renderJoin(join: JoinNode, out: Output): void {
	if (join.kind === 'cross') {
		write(out, ' cross join ');
		renderTable(join.table, out);
		return;
	}
	if (join.on === undefined)
		throw new Error(`A ${join.kind} join needs an on() condition`);
	write(out, ' ');
	write(out, join.kind);
	write(out, ' join ');
	renderTable(join.table, out);
	write(out, ' on ');
	render(join.on, out);
}

function renderSelect(node: SelectNode, out: Output): void {
	write(out, 'select');
	if (node.distinct === true) write(out, ' distinct');
	else if (node.distinct !== undefined) {
		write(out, ' distinct on (');
		list(out, node.distinct, renderKey);
		write(out, ')');
	}
	renderSelections(node.selections, ' ', out);
	write(out, ' from ');
	renderTable(node.from, out);
	for (const join of node.joins) renderJoin(join, out);
	if (node.where !== undefined) {
		write(out, ' where ');
		render(node.where, out);
	}
	if (node.groupBy !== undefined && node.groupBy.length > 0) {
		write(out, ' group by ');
		list(out, node.groupBy, renderKey);
	}
	if (node.having !== undefined) {
		write(out, ' having ');
		render(node.having, out);
	}
	if (node.orderBy !== undefined && node.orderBy.length > 0) {
		write(out, ' order by ');
		list(out, node.orderBy, renderOrderKey);
	}
	if (node.limit !== undefined) {
		write(out, ' limit ');
		param(out, node.limit);
	}
	if (node.offset !== undefined) {
		write(out, ' offset ');
		param(out, node.offset);
	}
	if (node.locks.length > 0) {
		if (node.selections.some((s) => hasAggregate(s.expression))) {
			throw new Error(
				'A locking clause (forUpdate() and the like) cannot be used with aggregate functions',
			);
		}
		for (const lock of node.locks) renderLock(lock, out);
	}
}

function renderOrderKey(
	key: NonNullable<SelectNode['orderBy']>[number],
	out: Output,
): void {
	renderKey(key.expression, out);
	if (key.direction !== undefined) {
		write(out, ' ');
		write(out, key.direction);
	}
	if (key.nulls !== undefined) {
		write(out, ' nulls ');
		write(out, key.nulls);
	}
}

function renderLock(lock: LockNode, out: Output): void {
	write(out, ' for ');
	write(out, lock.strength);
	if (lock.of.length > 0) {
		write(out, ' of ');
		list(out, lock.of, writeIdentifier);
	}
	if (lock.wait !== undefined) {
		write(out, ' ');
		write(out, lock.wait);
	}
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

function renderTable(table: TableNode, out: Output): void {
	writeIdentifier(table.name, out);
	if (table.alias !== undefined) {
		write(out, ' as ');
		writeIdentifier(table.alias, out);
	}
}

/**
 * Operands that are operations themselves (comparisons, arithmetic, `not`)
 * are parenthesised, so postgres precedence cannot regroup them: `not` binds
 * looser than `is`, so `not (a) is null` would read as `not ((a) is null)`.
 */
function renderOperand(node: OperationNode, out: Output): void {
	if (!rendersAsOperation(node)) {
		render(node, out);
		return;
	}
	write(out, '(');
	render(node, out);
	write(out, ')');
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
	operator: ' and ' | ' or ',
	empty: 'true' | 'false',
	out: Output,
): void {
	const [first] = operands;
	if (first === undefined) {
		write(out, empty);
		return;
	}
	if (operands.length === 1) {
		render(first, out);
		return;
	}
	write(out, '(');
	for (let i = 0; i < operands.length; i++) {
		if (i > 0) write(out, operator);
		// oxlint-disable-next-line typescript/no-non-null-assertion -- within bounds
		render(operands[i]!, out);
	}
	write(out, ')');
}

/**
 * Quoted identifiers, by name: table, column and alias names repeat in
 * every query. Cleared when full, so names made at run time can't grow it
 * without bound.
 */
const identifiers = new Map<string, string>();

/** `name` as a quoted identifier. */
export function identifier(name: string): string {
	let quoted = identifiers.get(name);
	if (quoted === undefined) {
		quoted = `"${name.replaceAll('"', '""')}"`;
		if (identifiers.size >= 4096) identifiers.clear();
		identifiers.set(name, quoted);
	}
	return quoted;
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
