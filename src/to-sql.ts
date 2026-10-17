import {
	compile,
	type CompiledQuery,
	compileWith,
	type ParamInfo,
	REDACTED,
	type StatementNode,
	stringLiteral,
	withSQL,
} from './compile.js';
import { type Codec, codecText } from './driver/codec.js';
import { codecs } from './driver/codecs.js';
import { arrayLiteral, textOf } from './driver/types.js';

/** How `toSQL` renders a query. */
export interface ToSQLOptions {
	/**
	 * Writes each parameter into the SQL as a Postgres literal of its SQL
	 * type (`'{"a","b"}'::text[]`, `'{"a":1}'::jsonb`, `NULL`), for reading
	 * and pasting into psql. Values bound against `sensitive()` columns show
	 * as `'[redacted]'`. For debugging and logs only: never execute inlined
	 * SQL built from untrusted input; run the query, whose values are sent
	 * as parameters.
	 */
	readonly inline?: boolean | undefined;
	/** Puts each clause, list item and top-level condition on its own line. */
	readonly pretty?: boolean | undefined;
}

/**
 * Renders `node` as `toSQL` does; runs nothing. Without options, what
 * `execute()` sends. With `inline`, the values are written into the SQL and
 * `params` is empty; `pretty` changes only the whitespace.
 */
export function toSQL(
	node: StatementNode,
	options: ToSQLOptions = {},
): CompiledQuery {
	const { inline = false, pretty = false } = options;
	if (!inline && !pretty) return compile(node);
	const query = compileWith(node, inline ? inlineLiteral : undefined);
	const sql = pretty ? prettySQL(query.sql) : query.sql;
	if (!inline) return withSQL(query, sql);
	return query.tag === undefined
		? { sql, params: [] }
		: { sql, params: [], tag: query.tag };
}

/** The codecs whose values read as SQL without quotes or a cast. */
const bare = new Set<Codec>([codecs.bool, codecs.int2, codecs.int4]);

/**
 * A parameter as a Postgres literal: the text its codec would send (or, for
 * a parameter without one, the driver's text of its JavaScript value),
 * quoted, and cast to the codec's type, unless the SQL casts it already or
 * the codec leaves the type to the server (text-like types, which a cast
 * would make compare differently with a citext, enum or char(n) column).
 */
export function inlineLiteral(value: unknown, info: ParamInfo): string {
	if (info.sensitive) return stringLiteral(REDACTED);
	if (value === undefined) {
		throw new TypeError(
			'A parameter is undefined, which is never sent; pass null for SQL NULL',
		);
	}
	if (value === null) return 'NULL';
	const { codec } = info;
	if (codec === undefined) {
		if (typeof value === 'boolean') return value ? 'true' : 'false';
		if (
			(typeof value === 'number' && Number.isFinite(value)) ||
			typeof value === 'bigint'
		)
			return textOf(value);
		return stringLiteral(
			Array.isArray(value) ? arrayLiteral(value) : textOf(value),
		);
	}
	const text = codecText(codec, value);
	if (bare.has(codec)) {
		if (codec !== codecs.bool) return text;
		return text === 't' ? 'true' : 'false';
	}
	const literal = stringLiteral(text);
	return info.cast !== undefined ||
		codec.inferParamType === true ||
		codec.name === ''
		? literal
		: `${literal}::${codec.name}`;
}

type TokenType =
	| 'space'
	| 'word'
	| 'quoted'
	| 'open'
	| 'close'
	| 'comma'
	| 'other';

interface Token {
	readonly type: TokenType;
	readonly text: string;
}

/** The end of the quoted string or identifier starting at `start`. */
function quotedEnd(sql: string, start: number, quote: string): number {
	const escapes = sql[start] === 'E';
	let i = start + (escapes ? 2 : 1);
	while (i < sql.length) {
		const c = sql[i];
		if (escapes && c === '\\') i += 2;
		else if (c === quote) {
			if (sql[i + 1] !== quote) return i + 1;
			i += 2;
		} else i++;
	}
	return i;
}

/** Splits SQL into tokens whose texts concatenate back to it. */
function tokenize(sql: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < sql.length) {
		const c = sql[i] ?? '';
		let end = i + 1;
		let type: TokenType = 'other';
		if (/\s/.test(c)) {
			while (end < sql.length && /\s/.test(sql[end] ?? '')) end++;
			type = 'space';
		} else if (c === "'" || (c === 'E' && sql[i + 1] === "'")) {
			end = quotedEnd(sql, i, "'");
			type = 'quoted';
		} else if (c === '"') {
			end = quotedEnd(sql, i, '"');
			type = 'quoted';
		} else if (c === '(') type = 'open';
		else if (c === ')') type = 'close';
		else if (c === ',') type = 'comma';
		else if (/[A-Za-z_]/.test(c)) {
			while (end < sql.length && /[\w$]/.test(sql[end] ?? '')) end++;
			type = 'word';
		}
		tokens.push({ type, text: sql.slice(i, end) });
		i = end;
	}
	return tokens;
}

/** The clauses that start a line, and whether each lists items one per line. */
const clauses: Readonly<Record<string, boolean>> = {
	select: true,
	from: false,
	'inner join': false,
	where: false,
	limit: false,
	returning: true,
	set: true,
	values: true,
	'on conflict': false,
};

/** One statement being laid out: the top level, or a subquery. */
interface Frame {
	/** The paren depth of its clauses. */
	readonly depth: number;
	readonly indent: number;
	/** The clause it is in, e.g. `where`. */
	clause: string;
}

/** What an open paren started, to close it the same way. */
type Paren = 'plain' | 'subquery' | 'conditions';

/**
 * Lays SQL out over lines: each clause on its own line, select, set,
 * values and returning lists one item per line, and the top-level
 * conditions of a `where` one per line. It only adds or replaces
 * whitespace outside quotes, so the statement means the same.
 */
export function prettySQL(sql: string): string {
	const tokens = tokenize(sql);
	const lower = (i: number) => tokens[i]?.text.toLowerCase();
	const isWord = (i: number) => tokens[i]?.type === 'word';

	/** The index of the paren closing the one opened at each index. */
	const closing = new Map<number, number>();
	const open: number[] = [];
	tokens.forEach((token, i) => {
		if (token.type === 'open') open.push(i);
		else if (token.type === 'close') {
			const from = open.pop();
			if (from !== undefined) closing.set(from, i);
		}
	});

	/** The clause starting with the word at `i`, if one does. */
	const clauseAt = (i: number): string | undefined => {
		const two = `${lower(i)} ${isWord(i + 2) ? lower(i + 2) : ''}`;
		if (tokens[i + 1]?.type === 'space' && two in clauses) return two;
		const one = lower(i) ?? '';
		if (!(one in clauses)) return undefined;
		const before = tokens[i - 1]?.type === 'space' ? i - 2 : i - 1;
		const previous = isWord(before) ? lower(before) : undefined;
		if (one === 'from' && (previous === 'delete' || previous === 'distinct'))
			return undefined;
		return one;
	};

	/** Whether nothing of the clause follows index `i`. */
	const endsClause = (i: number): boolean => {
		const next = tokens[i + 1];
		if (next === undefined || next.type === 'close') return true;
		return (
			next.type === 'space' && isWord(i + 2) && clauseAt(i + 2) !== undefined
		);
	};

	const frames: Frame[] = [
		{ depth: 0, indent: 0, clause: (isWord(0) && clauseAt(0)) || '' },
	];
	const parens: Paren[] = [];
	/** Depths where a `between` waits for its `and`. */
	const betweens = new Set<number>();
	let depth = 0;
	let lineIndent = 0;
	let out = '';
	const newline = (indent: number) => {
		lineIndent = indent;
		return `\n${'  '.repeat(indent)}`;
	};

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === undefined) break;
		const frame = frames.at(-1) ?? { depth: 0, indent: 0, clause: '' };
		const atFrame = depth === frame.depth;
		const lists = clauses[frame.clause] === true;
		switch (token.type) {
			case 'space': {
				const clause = atFrame && isWord(i + 1) ? clauseAt(i + 1) : undefined;
				if (clause !== undefined) {
					frame.clause = clause;
					// `do update set` stays on the `on conflict` line
					out +=
						clause === 'set' && lower(i - 1) === 'update'
							? ' '
							: newline(frame.indent);
					continue;
				}
				if (
					atFrame &&
					lists &&
					isWord(i - 1) &&
					lower(i - 1) === frame.clause.split(' ')[0]
				) {
					out += newline(frame.indent + 1);
					continue;
				}
				const parent = parens.at(-1);
				const conditions =
					(frame.clause === 'where' && atFrame) ||
					(parent === 'conditions' && depth === frame.depth + 1);
				const word = lower(i + 1);
				if (conditions && (word === 'and' || word === 'or')) {
					if (word === 'and' && betweens.has(depth)) betweens.delete(depth);
					else {
						out += newline(frame.indent + 1);
						continue;
					}
				}
				out += ' ';
				continue;
			}
			case 'word':
				if (lower(i) === 'between') betweens.add(depth);
				out += token.text;
				continue;
			case 'comma':
				out += ',';
				if (atFrame && lists && tokens[i + 1]?.type === 'space') {
					out += newline(frame.indent + 1);
					i++;
				}
				continue;
			case 'open': {
				depth++;
				const end = closing.get(i);
				if (isWord(i + 1) && lower(i + 1) === 'select') {
					parens.push('subquery');
					frames.push({ depth, indent: lineIndent + 1, clause: 'select' });
					out += `(${newline(lineIndent + 1)}`;
				} else if (
					atFrame &&
					frame.clause === 'where' &&
					end !== undefined &&
					endsClause(end) &&
					tokens[i - 1]?.type === 'space' &&
					lower(i - 2) === 'where'
				) {
					parens.push('conditions');
					out += `(${newline(frame.indent + 1)}`;
				} else {
					parens.push('plain');
					out += '(';
				}
				continue;
			}
			case 'close': {
				const paren = parens.pop();
				betweens.delete(depth);
				depth--;
				if (paren === 'subquery') {
					const closed = frames.pop();
					out += `${newline((closed?.indent ?? 1) - 1)})`;
				} else if (paren === 'conditions') {
					out += `${newline(frame.indent)})`;
				} else out += ')';
				continue;
			}
			default:
				out += token.text;
		}
	}
	return out;
}
