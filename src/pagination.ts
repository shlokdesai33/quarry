import { type Codec, decodesAsText } from './driver/codec.js';
import { codecs } from './driver/codecs.js';
import {
	base64Decode,
	base64Encode,
	hex,
	utf8Decode,
	utf8Encode,
} from './driver/auth/encoding.js';
import type { RunOptions } from './executor.js';
import type {
	OperationNode,
	OrderNode,
	ReferenceNode,
	SelectionNode,
	SelectNode,
} from './node.js';
import type { Ref, RefsOf } from './refs.js';
import type { KeyOf } from './row.js';
import type { AnyTable } from './table.js';

/** The order of a keyset: every key column ascending, or every one descending. */
export type KeyDirection = 'asc' | 'desc';

/**
 * The columns of the tables `T` that can key the rows `O`: non-null, and
 * selected under their own name (not a key `N` of `nest`'s objects), since
 * each page's last row gives the next page's start.
 */
export type KeyColumn<
	T extends readonly AnyTable[],
	O,
	N extends string = never,
> = {
	[K in Ref<RefsOf<T>>]: null extends RefsOf<T>[K]['$select']
		? never
		: KeyOf<K> extends Exclude<keyof O, N>
			? K
			: never;
}[Ref<RefsOf<T>>];

/** One column, or several, most significant first. */
export type KeyColumns<C extends string> = C | readonly [C, ...C[]];

/** What `iterateChunks` and `paginateByCursor` order and seek by. */
export interface KeysetOptions<C extends string> extends RunOptions {
	/**
	 * The key: a column, or several, that together are unique and non-null,
	 * e.g. the primary key, or `['posts.createdAt', 'posts.id']`. A key that
	 * isn't unique skips the rows that tie with the last row of a page.
	 */
	readonly by: KeyColumns<C>;
	/** Default `asc`; applies to every key column. */
	readonly direction?: KeyDirection | undefined;
}

/** The options of `paginateByCursor`. */
export interface CursorPageOptions<C extends string> extends KeysetOptions<C> {
	/** Rows per page. */
	readonly perPage: number;
	/** The `nextCursor` of the previous page; none (or `null`) for the first. */
	readonly after?: string | null | undefined;
}

/** One page of `paginateByCursor`. */
export interface CursorPage<O> {
	readonly rows: O[];
	/** What `after` takes for the next page; `null` on the last page. */
	readonly nextCursor: string | null;
	/** Whether there is a next page. */
	readonly hasMore: boolean;
}

/** The options of `paginateByOffset`. */
export interface OffsetPageOptions<C extends string> extends RunOptions {
	/** The page, from 1. */
	readonly page: number;
	/** Rows per page. */
	readonly perPage: number;
	/**
	 * The order: a column, or several, most significant first, that together
	 * are unique, so that every row is on exactly one page.
	 */
	readonly by: KeyColumns<C>;
	/** Default `asc`; applies to every column. */
	readonly direction?: KeyDirection | undefined;
	/** Also counts every row the query matches, into `total`: a second query, in the same round trip. */
	readonly countTotal?: boolean | undefined;
}

/** One page of `paginateByOffset`. */
export interface OffsetPage<O> {
	readonly rows: O[];
	readonly page: number;
	readonly perPage: number;
	/** Whether there is a next page. */
	readonly hasMore: boolean;
}

/**
 * The `after` cursor given to `paginateByCursor` isn't one it made for the
 * same key and direction: it was altered, or comes from another query.
 */
export class InvalidCursorError extends Error {
	constructor(reason: string) {
		super(`Invalid cursor: ${reason}`);
		this.name = 'InvalidCursorError';
	}
}

/** Checks a batch or page size: a whole number of rows, at least one. */
export function checkSize(method: string, name: string, count: number): void {
	if (!Number.isInteger(count) || count < 1) {
		throw new RangeError(
			`${method}() takes a whole number of rows, at least 1, as ${name}, not ${count}`,
		);
	}
}

/** The options that go to the executor. */
export function runOptions({ signal, timeout }: RunOptions): RunOptions {
	return { signal, timeout };
}

/** A batch query's result, or its error thrown. */
export function settled<T>(outcome: PromiseSettledResult<T> | undefined): T {
	if (outcome === undefined) throw new Error('The batch returned no result');
	if (outcome.status === 'rejected') throw outcome.reason;
	return outcome.value;
}
/** A key column, resolved. */
export interface Key {
	/** As written, e.g. `posts.id`. */
	readonly ref: string;
	readonly node: ReferenceNode;
	readonly codec: Codec;
	/** Its key in the result row, for the keysets that read it back. */
	readonly alias: string;
}

/** A query's key, resolved, and its direction. */
export interface Keyset {
	readonly keys: readonly [Key, ...Key[]];
	readonly direction: KeyDirection;
}

/**
 * Resolves `by` against the query's tables. `selected` checks each column
 * is non-null and in the select list under its own name, for reading the
 * last row's key back.
 */
export function resolveKeyset(
	method: string,
	tables: readonly AnyTable[],
	node: SelectNode,
	by: KeyColumns<string>,
	direction: KeyDirection | undefined,
	selected: boolean,
): Keyset {
	const set = [
		node.orderBy !== undefined && node.orderBy.length > 0 && 'orderBy()',
		node.limit !== undefined && 'limit()',
		node.offset !== undefined && 'offset()',
	].filter((clause) => clause !== false);
	if (set.length > 0) {
		throw new Error(
			`${method}() sets the query's order by, limit and offset itself: remove ${set.join(', ')}, and order with \`by\` and \`direction\``,
		);
	}
	if (direction !== undefined && direction !== 'asc' && direction !== 'desc') {
		throw new TypeError(
			`direction is 'asc' or 'desc', not ${String(direction)}`,
		);
	}
	const refs: readonly string[] = typeof by === 'string' ? [by] : by;
	const keys = refs.map((ref): Key => {
		const dot = ref.indexOf('.');
		const tableName = ref.slice(0, dot);
		const column = tables.find((table) => table.name === tableName)?.schema
			.columns[ref.slice(dot + 1)];
		if (column === undefined) {
			throw new Error(`Unknown column reference "${ref}"`);
		}
		const key: Key = {
			ref,
			node: {
				kind: 'reference',
				table: tableName,
				column: column._quarry.columnName ?? ref.slice(dot + 1),
			},
			codec: column._quarry.dataType.codec,
			alias: ref.slice(dot + 1),
		};
		if (!selected) return key;
		if (column._quarry.nullable) {
			throw new Error(
				`${method}() can't seek past a null: ${ref} is nullable; key by non-null columns`,
			);
		}
		if (!node.selections.some((selection) => isKey(key, selection))) {
			throw new Error(
				`${method}() reads the key from each page's last row: select ${ref}`,
			);
		}
		return key;
	});
	const [first, ...rest] = keys;
	if (first === undefined) {
		throw new Error(`${method}() needs at least one column in \`by\``);
	}
	return { keys: [first, ...rest], direction: direction ?? 'asc' };
}

/** Whether `selection` is the column `key`, under its own name. */
function isKey(key: Key, { alias, expression }: SelectionNode): boolean {
	return (
		alias === key.alias &&
		expression.kind === 'reference' &&
		expression.table === key.node.table &&
		expression.column === key.node.column
	);
}

/** The `order by` of a keyset. */
export function orderBy({ keys, direction }: Keyset): OrderNode[] {
	return keys.map((key) => ({
		expression: key.node,
		direction,
		nulls: undefined,
	}));
}

/**
 * The query, from the row after the key `after` (by the key's order), for
 * `limit` rows; from the first row without `after`. The key columns are
 * read as the server's text, which `readKeys` decodes: the SQL is the
 * same, but a value the codec decodes losslessly (a timestamptz's
 * microseconds, as a `Date`) still seeks exactly.
 */
export function seekPage(
	node: SelectNode,
	keyset: Keyset,
	after: readonly string[] | undefined,
	limit: number,
): SelectNode {
	return {
		...node,
		selections: node.selections.map((selection) =>
			keyset.keys.some((key) => isKey(key, selection))
				? { ...selection, codec: codecs.raw }
				: selection,
		),
		where:
			after === undefined ? node.where : and(node.where, seek(keyset, after)),
		orderBy: orderBy(keyset),
		limit,
	};
}

/**
 * `key > $1`, or `(a, b) > ($1, $2)` for several columns (`<` descending):
 * a row comparison, which a btree index on the key columns serves.
 */
function seek(
	{ keys, direction }: Keyset,
	after: readonly string[],
): OperationNode {
	const operator = direction === 'asc' ? '>' : '<';
	const values = keys.map((key, i): OperationNode => ({
		kind: 'value',
		value: after[i],
		codec: asText(key.codec),
	}));
	const [value] = values;
	if (keys.length === 1 && value !== undefined) {
		return { kind: 'binary', left: keys[0].node, operator, right: value };
	}
	return {
		kind: 'binary',
		left: { kind: 'value_list', values: keys.map((key) => key.node) },
		operator,
		right: { kind: 'value_list', values },
	};
}

function and(
	where: OperationNode | undefined,
	condition: OperationNode,
): OperationNode {
	if (where === undefined) return condition;
	return {
		kind: 'and',
		operands: [...(where.kind === 'and' ? where.operands : [where]), condition],
	};
}

/**
 * Decodes the key columns of `rows`, which `seekPage` read as the
 * server's text, with their codecs, and returns the last row's key as
 * that text. An executor that decoded them anyway gives values, which
 * are encoded back.
 */
export function readKeys(
	keyset: Keyset,
	rows: readonly unknown[],
	method: string,
): readonly string[] | undefined {
	let last: string[] | undefined;
	for (const row of rows) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rows are objects keyed by the select list, which has the key columns
		const record = row as Record<string, unknown>;
		last = keyset.keys.map((key) => {
			const value = record[key.alias];
			if (value === null || value === undefined) {
				throw new Error(`${method}() can't seek past a null ${key.ref}`);
			}
			if (typeof value !== 'string') return textOf(key, value, method);
			if (!decodesAsText(key.codec)) {
				record[key.alias] = key.codec.decodeText(value);
			}
			return value;
		});
	}
	return last;
}

/** A decoded key value as the server's text. */
function textOf(key: Key, value: unknown, method: string): string {
	const encoded = key.codec.encode(value);
	if (typeof encoded === 'string') return encoded;
	if (key.codec.oid === BYTEA) return `\\x${hex(encoded)}`;
	throw new Error(
		`${method}() can't send ${key.ref} back as text: its codec encodes it in binary`,
	);
}

const BYTEA = 17;

const textCodecs = new WeakMap<Codec, Codec>();

/** `codec`, for a key value as the server's text: sent as it is, with the codec's type. */
function asText(codec: Codec): Codec {
	let known = textCodecs.get(codec);
	if (known === undefined) {
		known = Object.freeze({
			...codec,
			paramFormat: 'text',
			encode: (value: unknown) => String(value),
		});
		textCodecs.set(codec, known);
	}
	return known;
}

/**
 * What a cursor holds: the key it was made for, and the last row's key
 * values as the server's text.
 */
interface CursorData {
	readonly by: readonly string[];
	readonly direction: KeyDirection;
	readonly after: readonly string[];
}

/** The cursor of the page after the row with the key `after`: base64url JSON. */
export function encodeCursor(keyset: Keyset, after: readonly string[]): string {
	const data: CursorData = {
		by: keyset.keys.map((key) => key.ref),
		direction: keyset.direction,
		after,
	};
	return base64Encode(utf8Encode(JSON.stringify(data)))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

/** The key `cursor` holds; throws `InvalidCursorError` for one not made for `keyset`. */
export function decodeCursor(
	keyset: Keyset,
	cursor: string,
): readonly string[] {
	const invalid = new InvalidCursorError(
		'not a cursor paginateByCursor() made',
	);
	if (typeof cursor !== 'string' || !/^[\w-]+$/.test(cursor)) throw invalid;
	let data: unknown;
	try {
		data = JSON.parse(
			utf8Decode(
				base64Decode(cursor.replaceAll('-', '+').replaceAll('_', '/')),
			),
		);
	} catch {
		throw invalid;
	}
	if (!isCursorData(data, keyset.keys.length)) throw invalid;
	const by = keyset.keys.map((key) => key.ref);
	if (data.by.join() !== by.join() || data.direction !== keyset.direction) {
		throw new InvalidCursorError(
			`made for by ${data.by.join(', ')} ${data.direction}, not ${by.join(', ')} ${keyset.direction}`,
		);
	}
	return data.after;
}

function isCursorData(data: unknown, keys: number): data is CursorData {
	if (typeof data !== 'object' || data === null) return false;
	const { by, direction, after } = data as Partial<
		Record<keyof CursorData, unknown>
	>;
	const strings = (value: unknown) =>
		Array.isArray(value) &&
		value.length === keys &&
		value.every((item) => typeof item === 'string');
	return (
		strings(by) &&
		strings(after) &&
		(direction === 'asc' || direction === 'desc')
	);
}
