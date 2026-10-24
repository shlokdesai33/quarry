import type { BinaryParser } from './binary.js';
import { decodesAsText, type Codec } from './codec.js';
import { DecodeError, DriverError, ProtocolError } from './errors.js';
import type { QueryResult } from './ops.js';
import type { Field } from './protocol/messages.js';
import { utf8 } from './protocol/text.js';

/** `object` rows are keyed by column name (the last wins on duplicates); `array` rows are positional. */
export type RowMode = 'object' | 'array';

/**
 * Result columns read into one object of the row: the object takes the
 * place of its `marker` column, keyed `key` in an `object` row, and is
 * null where the marker is false or null. Each of its `columns` (by
 * position, after the marker, each in one object) is a property of it,
 * under its own key, and not a value of the row. A column null where the
 * marker is false is never read, so the object's columns must all be
 * null there: those of a joined table, with a marker true where it has
 * a row.
 */
export interface NestedObject {
	readonly key: string;
	readonly marker: number;
	readonly columns: readonly (readonly [position: number, key: string])[];
}

/** Throws unless each nested object's columns come after its marker, and no column is in two. */
export function checkNested(nested: readonly NestedObject[]): void {
	const used = new Set<number>();
	const take = (position: number) => {
		if (!Number.isInteger(position) || position < 0 || used.has(position)) {
			throw new DriverError(
				`nested: column ${position} is not a position, or is in two objects`,
			);
		}
		used.add(position);
	};
	for (const { marker, columns } of nested) {
		take(marker);
		for (const [position] of columns) {
			take(position);
			if (position < marker) {
				throw new DriverError(
					`nested: column ${position} comes before its object's marker, ${marker}`,
				);
			}
		}
	}
}

/**
 * A value of a row, in order: a column's, or for a nested object's marker,
 * the object.
 */
interface Entry {
	readonly key: string;
	readonly column: number;
	readonly object: NestedObject | undefined;
}

/** The values of rows of `names`, with `nested` objects in place of their markers. */
function entriesOf(
	names: readonly string[],
	nested: readonly NestedObject[] | undefined,
): Entry[] {
	const markers = new Map<number, NestedObject>();
	const inner = new Set<number>();
	for (const object of nested ?? []) {
		if (object.marker >= names.length) continue;
		markers.set(object.marker, object);
		for (const [position] of object.columns) inner.add(position);
	}
	const entries: Entry[] = [];
	for (let i = 0; i < names.length; i++) {
		const object = markers.get(i);
		if (object !== undefined)
			entries.push({ key: object.key, column: i, object });
		else if (!inner.has(i))
			entries.push({ key: names[i] ?? '', column: i, object: undefined });
	}
	return entries;
}

/** Whether a nested object's marker holds: true, as its codec or the server's text reads it. */
const holds = (marker: unknown) => marker === true || marker === 't';

/** Decodes one DataRow body, `bytes[start, end)`, into a row. */
export type RowDecoder = (
	bytes: Uint8Array,
	start: number,
	end: number,
) => unknown;

type Build = (values: unknown[]) => Record<string, unknown>;

/** Binary values without a decoder: a copy, so rows never alias the read buffer. */
const copy: BinaryParser = (b, s, e) => new Uint8Array(b.subarray(s, e));

/** Builds rows with plain assignments; `__proto__` is defined as an own property, never as the prototype. */
function assignBuilder(names: readonly string[]): Build {
	return (values) => {
		const row: Record<string, unknown> = {};
		for (let i = 0; i < names.length; i++) {
			const name = names[i] ?? '';
			if (name === '__proto__') {
				Object.defineProperty(row, name, {
					value: values[i],
					enumerable: true,
					writable: true,
					configurable: true,
				});
			} else {
				row[name] = values[i];
			}
		}
		return row;
	};
}

/**
 * Columns per generated function. V8's optimizing compilers need memory that
 * grows faster than a function's size, and the process keeps it: one
 * function for 100 columns cost about 70 MB of native memory (Node 24),
 * 8-column pieces under 10 MB.
 */
const COLUMNS_PER_FUNCTION = 8;

type MakeDecoder = (
	count: number,
	codecs: readonly (Codec | undefined)[],
	copy: BinaryParser,
	text: typeof utf8,
	mismatch: () => Error,
	short: () => Error,
	invalid: () => Error,
	failed: (index: number, error: unknown) => Error,
) => RowDecoder;

/**
 * Compiled decoder factories by source. Decoders of the same shape (on
 * every connection, and for unprepared queries) share their functions, so
 * they are compiled and optimized once. Undefined marks a forbidden
 * `new Function`.
 */
const factories = new Map<string, MakeDecoder | undefined>();
/** The cache is dropped when its sources pass this many characters. */
const MAX_FACTORY_SOURCE = 4_000_000;
let factorySourceLength = 0;

const mismatch = () =>
	new ProtocolError('DataRow column count does not match RowDescription');
const short = () => new ProtocolError('DataRow too short');
const invalid = () => new ProtocolError('Invalid value length in DataRow');

/**
 * The source of a decoder factory. Each value is stored into a row literal
 * of nulls as it is decoded (holding values in locals until the end makes
 * compiling cost grow with columns²), by functions of at most
 * `COLUMNS_PER_FUNCTION` columns, each returning where the next value starts.
 * A nested object's marker stores a row literal of its own, which its
 * columns are stored into.
 */
function factorySource(
	names: readonly string[],
	how: readonly Decode[],
	mode: RowMode,
	nested: readonly NestedObject[] | undefined,
): string {
	const out: string[] = [];
	const calls: string[] = [];
	const entries = entriesOf(names, nested);
	const keys = entries.map((entry) => entry.key);
	/** Where each column's value is stored. */
	const targets: string[] = [];
	/** The row literal each nested object's marker stores, by column. */
	const objects: (string | undefined)[] = [];
	/** The columns whose NULL still replaces an earlier column of the same name. */
	const repeated = new Set<number>();
	for (let e = 0; e < entries.length; e++) {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- within bounds
		const { key, column, object } = entries[e]!;
		const target = `row[${mode === 'object' ? JSON.stringify(key) : e}]`;
		targets[column] = target;
		if (mode === 'object' && keys.indexOf(key) !== e) repeated.add(column);
		if (object === undefined) continue;
		objects[column] =
			`{${object.columns.map(([, k]) => `${JSON.stringify(k)}: null`).join(', ')}}`;
		for (const [position, k] of object.columns)
			targets[position] = `${target}[${JSON.stringify(k)}]`;
	}
	for (let from = 0; from < names.length; from += COLUMNS_PER_FUNCTION) {
		const to = Math.min(from + COLUMNS_PER_FUNCTION, names.length);
		const body: string[] = [];
		for (let i = from; i < to; i++) {
			let value = 'utf8(b, pos, pos + length)';
			switch (how[i]) {
				case 'binary':
					out.push(`const c${i} = c[${i}];`);
					value = `c${i}.decodeBinary(b, pos, pos + length)`;
					break;
				case 'copy':
					value = 'copy(b, pos, pos + length)';
					break;
				case 'parse':
					out.push(`const c${i} = c[${i}];`);
					value = `c${i}.decodeText(${value})`;
					break;
				default:
			}
			const target = targets[i] ?? '';
			const object = objects[i];
			body.push(
				'if (pos + 4 > end) throw short();',
				'length = (b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];',
				'pos += 4;',
				'if (length !== -1) {',
				'if (length < 0 || pos + length > end) throw invalid();',
				`column = ${i};`,
				object === undefined
					? `${target} = ${value};`
					: `{ const m = ${value}; if (m === true || m === 't') ${target} = ${object}; }`,
				'column = -1;',
				'pos += length;',
				// a later NULL still replaces an earlier column of the same name
				repeated.has(i) ? `} else ${target} = null;` : '}',
			);
		}
		out.push(
			`function columns${from}(b, pos, end, row) {`,
			'let length = 0, column = -1;',
			'try {',
			...body,
			'} catch (error) { throw column < 0 ? error : failed(column, error); }',
			'return pos;',
			'}',
		);
		calls.push(`pos = columns${from}(b, pos, end, row);`);
	}
	const row =
		mode === 'object'
			? `{${keys.map((key) => `${JSON.stringify(key)}: null`).join(', ')}}`
			: `[${keys.map(() => 'null').join(', ')}]`;
	out.push(
		'return function decodeRow(b, start, end) {',
		'if (end - start < 2 || ((b[start] << 8) | b[start + 1]) !== count) throw mismatch();',
		`const row = ${row};`,
		'let pos = start + 2;',
		...calls,
		'return row;',
		'};',
	);
	return out.join('\n');
}

function factory(source: string): MakeDecoder | undefined {
	if (factories.has(source)) return factories.get(source);
	let make: MakeDecoder | undefined;
	try {
		// oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-type-assertion
		make = new Function(
			'count',
			'c',
			'copy',
			'utf8',
			'mismatch',
			'short',
			'invalid',
			'failed',
			source,
		) as MakeDecoder;
	} catch {
		make = undefined;
	}
	if (factorySourceLength + source.length > MAX_FACTORY_SOURCE) {
		factories.clear();
		factorySourceLength = 0;
	}
	factories.set(source, make);
	factorySourceLength += source.length;
	return make;
}

/**
 * A decoder compiled for one result shape: it decodes each value straight
 * into the row, so no temporary values array is allocated per row, and every
 * row gets the same hidden class. Undefined where `new Function` is
 * forbidden (e.g. Cloudflare Workers) or when a name can't be written as a
 * plain property (`__proto__`).
 */
function compiledDecoder(
	fields: readonly Field[],
	codecs: readonly (Codec | undefined)[],
	how: readonly Decode[],
	mode: RowMode,
	nested: readonly NestedObject[] | undefined,
): RowDecoder | undefined {
	const names = fields.map((field) => field.name);
	if (mode === 'object' && names.includes('__proto__')) return undefined;
	if (
		nested?.some(
			({ key, columns }) =>
				key === '__proto__' || columns.some(([, k]) => k === '__proto__'),
		)
	)
		return undefined;
	const make = factory(factorySource(names, how, mode, nested));
	return make?.(
		fields.length,
		codecs,
		copy,
		utf8,
		mismatch,
		short,
		invalid,
		(i, error) => {
			const field = fields[i];
			return new DecodeError(field?.name ?? '', field?.typeOid ?? 0, error);
		},
	);
}

/** How one column's values are read: its codec's binary or text decoder, the bytes, or the text as it is. */
type Decode = 'binary' | 'copy' | 'parse' | 'text';

function decodeOf(field: Field, codec: Codec | undefined): Decode {
	if (field.format === 1)
		return codec?.decodeBinary === undefined ? 'copy' : 'binary';
	return codec === undefined || decodesAsText(codec) ? 'text' : 'parse';
}

/**
 * Builds a decoder for rows of `fields`, each column through its codec:
 * its binary decoder for a column sent in binary (the bytes, copied, where
 * it has none), its text decoder otherwise. A column without a codec is
 * the server's text. The columns of `nested` objects are read into them.
 */
export function rowDecoder(
	fields: readonly Field[],
	codecs: readonly (Codec | undefined)[],
	mode: RowMode,
	nested?: readonly NestedObject[],
): RowDecoder {
	const count = fields.length;
	const how = fields.map((field, i) => decodeOf(field, codecs[i]));

	const compiled = compiledDecoder(fields, codecs, how, mode, nested);
	if (compiled !== undefined) return compiled;

	// without generated code: `new Function` is forbidden, or a column is named `__proto__`
	const values = (bytes: Uint8Array, start: number, end: number): unknown[] => {
		if (
			end - start < 2 ||
			(((bytes[start] ?? 0) << 8) | (bytes[start + 1] ?? 0)) !== count
		) {
			throw new ProtocolError(
				'DataRow column count does not match RowDescription',
			);
		}
		const row: unknown[] = [];
		let pos = start + 2;
		for (let i = 0; i < count; i++) {
			if (pos + 4 > end) throw new ProtocolError('DataRow too short');
			const length =
				((bytes[pos] ?? 0) << 24) |
				((bytes[pos + 1] ?? 0) << 16) |
				((bytes[pos + 2] ?? 0) << 8) |
				(bytes[pos + 3] ?? 0);
			pos += 4;
			if (length === -1) {
				row.push(null);
				continue;
			}
			const valueEnd = pos + length;
			if (length < 0 || valueEnd > end)
				throw new ProtocolError('Invalid value length in DataRow');
			const codec = codecs[i];
			try {
				switch (how[i]) {
					case 'binary':
						// oxlint-disable-next-line typescript/no-non-null-assertion -- `decodeOf` checked it
						row.push(codec!.decodeBinary!(bytes, pos, valueEnd));
						break;
					case 'copy':
						row.push(copy(bytes, pos, valueEnd));
						break;
					case 'parse':
						// oxlint-disable-next-line typescript/no-non-null-assertion -- `decodeOf` checked it
						row.push(codec!.decodeText(utf8(bytes, pos, valueEnd)));
						break;
					default:
						row.push(utf8(bytes, pos, valueEnd));
				}
			} catch (error) {
				const field = fields[i];
				throw new DecodeError(field?.name ?? '', field?.typeOid ?? 0, error);
			}
			pos = valueEnd;
		}
		return row;
	};

	if (nested !== undefined && nested.length > 0) {
		const build = nestedBuilder(
			entriesOf(
				fields.map((field) => field.name),
				nested,
			),
			mode,
		);
		return (bytes, start, end) => build(values(bytes, start, end));
	}
	if (mode === 'array') return values;
	const build = assignBuilder(fields.map((field) => field.name));
	return (bytes, start, end) => build(values(bytes, start, end));
}

/** Builds rows of `entries`, nested objects included, from their columns' values. */
function nestedBuilder(
	entries: readonly Entry[],
	mode: RowMode,
): (values: unknown[]) => unknown {
	const assign = assignBuilder(entries.map((entry) => entry.key));
	const objects = entries.map(
		({ object }) =>
			object && assignBuilder(object.columns.map(([, key]) => key)),
	);
	return (values) => {
		const row = entries.map(({ column, object }, e) => {
			const build = objects[e];
			if (object === undefined || build === undefined) return values[column];
			if (!holds(values[column])) return null;
			return build(object.columns.map(([position]) => values[position]));
		});
		return mode === 'array' ? row : assign(row);
	};
}

/**
 * Types decoded rows as `R`. Like every driver, the row type is the
 * caller's claim about the query; nothing checks it at run time.
 */
export function asRows<R>(rows: unknown[]): R[] {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return rows as R[];
}

export function asResult<R>(result: QueryResult<unknown>): QueryResult<R> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return result as QueryResult<R>;
}

/** `asResult` for a pending result, without a callback per query to cast it. */
export function asResultPromise<R>(
	result: Promise<QueryResult<unknown>>,
): Promise<QueryResult<R>> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	return result as Promise<QueryResult<R>>;
}
