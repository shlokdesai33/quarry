import type { Codec } from './driver/codec.js';
import {
	base64Decode,
	base64Encode,
	utf8Decode,
	utf8Encode,
} from './driver/auth/encoding.js';
import type { RunOptions } from './executor.js';
import type {
	OperationNode,
	OrderNode,
	ReferenceNode,
	SelectNode,
} from './node.js';
import type { Ref, RefsOf } from './refs.js';
import type { KeyOf } from './row.js';
import type { AnyTable } from './table.js';

/** The order of a keyset: every key column ascending, or every one descending. */
export type KeyDirection = 'asc' | 'desc';

/**
 * The columns of the tables `T` that can key the rows `O`: non-null, and
 * selected under their own name, since each page's last row gives the next
 * page's start.
 */
export type KeyColumn<T extends readonly AnyTable[], O> = {
	[K in Ref<RefsOf<T>>]: null extends RefsOf<T>[K]['$select']
		? never
		: KeyOf<K> extends keyof O
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
export function rowCount(method: string, name: string, count: number): void {
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
		const isSelected = node.selections.some(
			({ alias, expression }) =>
				alias === key.alias &&
				expression.kind === 'reference' &&
				expression.table === key.node.table &&
				expression.column === key.node.column,
		);
		if (!isSelected) {
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

/** The `order by` of a keyset. */
export function orderBy({ keys, direction }: Keyset): OrderNode[] {
	return keys.map((key) => ({
		expression: key.node,
		direction,
		nulls: undefined,
	}));
}

/**
 * The query, from the row after the key values `after` (by the key's
 * order), for `limit` rows; from the first row without `after`.
 */
export function seekPage(
	node: SelectNode,
	keyset: Keyset,
	after: readonly OperationNode[] | undefined,
	limit: number,
): SelectNode {
	return {
		...node,
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
	after: readonly OperationNode[],
): OperationNode {
	const operator = direction === 'asc' ? '>' : '<';
	const [key] = keys;
	const [value] = after;
	if (keys.length === 1 && value !== undefined) {
		return { kind: 'binary', left: key.node, operator, right: value };
	}
	return {
		kind: 'binary',
		left: { kind: 'value_list', values: keys.map((k) => k.node) },
		operator,
		right: { kind: 'value_list', values: after },
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

/** The key values of `row`, as parameters encoded with the key columns' codecs. */
export function keyValues(
	keyset: Keyset,
	row: unknown,
	method: string,
): readonly unknown[] {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rows are objects keyed by the select list, which has the key columns
	const record = row as Readonly<Record<string, unknown>>;
	return keyset.keys.map((key) => {
		const value = record[key.alias];
		if (value === null || value === undefined) {
			throw new Error(`${method}() can't seek past a null ${key.ref}`);
		}
		return value;
	});
}

/** The key values as parameters, with their columns' codecs. */
export function keyParams(
	keyset: Keyset,
	values: readonly unknown[],
): OperationNode[] {
	return keyset.keys.map((key, i) => ({
		kind: 'value',
		value: values[i],
		codec: key.codec,
	}));
}

/**
 * What a cursor holds: the key it was made for, and the last row's key
 * values as their codecs encode them (Postgres's text, or base64 of a
 * binary encoding), which the next query sends as they are.
 */
interface CursorData {
	readonly by: readonly string[];
	readonly direction: KeyDirection;
	readonly after: readonly (string | { readonly b: string })[];
}

/** The cursor of the page after the row with the key `values`: base64url JSON. */
export function encodeCursor(
	keyset: Keyset,
	values: readonly unknown[],
): string {
	const data: CursorData = {
		by: keyset.keys.map((key) => key.ref),
		direction: keyset.direction,
		after: keyset.keys.map((key, i) => {
			const encoded = key.codec.encode(values[i]);
			return typeof encoded === 'string'
				? encoded
				: { b: base64Encode(encoded) };
		}),
	};
	return base64Encode(utf8Encode(JSON.stringify(data)))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

/** The key values `cursor` holds, as parameters; throws `InvalidCursorError` for one not made for `keyset`. */
export function decodeCursor(keyset: Keyset, cursor: string): OperationNode[] {
	if (typeof cursor !== 'string' || !/^[\w-]*$/.test(cursor)) {
		throw new InvalidCursorError('not a cursor paginateByCursor() made');
	}
	let data: unknown;
	try {
		data = JSON.parse(
			utf8Decode(
				base64Decode(cursor.replaceAll('-', '+').replaceAll('_', '/')),
			),
		);
	} catch {
		throw new InvalidCursorError('not a cursor paginateByCursor() made');
	}
	if (!isCursorData(data, keyset.keys.length)) {
		throw new InvalidCursorError('not a cursor paginateByCursor() made');
	}
	const by = keyset.keys.map((key) => key.ref);
	if (data.by.join() !== by.join() || data.direction !== keyset.direction) {
		throw new InvalidCursorError(
			`made for by ${data.by.join(', ')} ${data.direction}, not ${by.join(', ')} ${keyset.direction}`,
		);
	}
	return keyset.keys.map((key, i) => {
		const value = data.after[i];
		return {
			kind: 'value',
			value: typeof value === 'string' ? value : base64Decode(value?.b ?? ''),
			codec: preEncoded(key.codec),
		};
	});
}

function isCursorData(data: unknown, keys: number): data is CursorData {
	if (typeof data !== 'object' || data === null) return false;
	const { by, direction, after } = data as Partial<
		Record<keyof CursorData, unknown>
	>;
	return (
		Array.isArray(by) &&
		by.length === keys &&
		by.every((ref) => typeof ref === 'string') &&
		(direction === 'asc' || direction === 'desc') &&
		Array.isArray(after) &&
		after.length === keys &&
		after.every(
			(value: unknown) =>
				typeof value === 'string' ||
				(typeof value === 'object' &&
					value !== null &&
					typeof (value as { b?: unknown }).b === 'string'),
		)
	);
}

const encodedCodecs = new WeakMap<Codec, Codec>();

/** `codec`, for a value it has already encoded: sent as it is, with the codec's type. */
function preEncoded(codec: Codec): Codec {
	let known = encodedCodecs.get(codec);
	if (known === undefined) {
		known = Object.freeze({
			...codec,
			encode: (value: unknown) => {
				if (typeof value === 'string' || value instanceof Uint8Array)
					return value;
				throw new TypeError('A cursor value is text or bytes');
			},
		});
		encodedCodecs.set(codec, known);
	}
	return known;
}
