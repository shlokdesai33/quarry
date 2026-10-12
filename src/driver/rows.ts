import { binaryParser, type BinaryParser } from './binary.js';
import { DecodeError, ProtocolError } from './errors.js';
import type { QueryResult } from './ops.js';
import type { Field } from './protocol/messages.js';
import { utf8 } from './protocol/text.js';
import type { TextParser, TypeParsers } from './types.js';

/** `object` rows are keyed by column name (the last wins on duplicates); `array` rows are positional. */
export type RowMode = 'object' | 'array';

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
	binary: readonly (BinaryParser | undefined)[],
	parsers: readonly (TextParser | undefined)[],
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
 */
function factorySource(
	names: readonly string[],
	binary: readonly (BinaryParser | undefined)[],
	parsers: readonly (TextParser | undefined)[],
	mode: RowMode,
): string {
	const out: string[] = [];
	const calls: string[] = [];
	const repeated = new Set(
		names.filter((name, i) => mode === 'object' && names.indexOf(name) !== i),
	);
	for (let from = 0; from < names.length; from += COLUMNS_PER_FUNCTION) {
		const to = Math.min(from + COLUMNS_PER_FUNCTION, names.length);
		const body: string[] = [];
		for (let i = from; i < to; i++) {
			let value = 'utf8(b, pos, pos + length)';
			if (binary[i] !== undefined) {
				out.push(`const d${i} = d[${i}];`);
				value = `d${i}(b, pos, pos + length)`;
			} else if (parsers[i] !== undefined) {
				out.push(`const p${i} = p[${i}];`);
				value = `p${i}(${value})`;
			}
			const key = mode === 'object' ? JSON.stringify(names[i]) : String(i);
			body.push(
				'if (pos + 4 > end) throw short();',
				'length = (b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];',
				'pos += 4;',
				'if (length !== -1) {',
				'if (length < 0 || pos + length > end) throw invalid();',
				`column = ${i};`,
				`row[${key}] = ${value};`,
				'column = -1;',
				'pos += length;',
				// a later NULL still replaces an earlier column of the same name
				repeated.has(names[i] ?? '') ? `} else row[${key}] = null;` : '}',
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
			? `{${names.map((name) => `${JSON.stringify(name)}: null`).join(', ')}}`
			: `[${names.map(() => 'null').join(', ')}]`;
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
			'd',
			'p',
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
	binary: readonly (BinaryParser | undefined)[],
	parsers: readonly (TextParser | undefined)[],
	mode: RowMode,
): RowDecoder | undefined {
	const names = fields.map((field) => field.name);
	if (mode === 'object' && names.includes('__proto__')) return undefined;
	const make = factory(factorySource(names, binary, parsers, mode));
	return make?.(
		fields.length,
		binary,
		parsers,
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

/** Builds a decoder for rows of `fields`, parsing text values by type OID. */
export function rowDecoder(
	fields: readonly Field[],
	types: TypeParsers,
	mode: RowMode,
): RowDecoder {
	const count = fields.length;
	const binary: (BinaryParser | undefined)[] = fields.map((field) =>
		field.format === 1
			? (binaryParser(field.typeOid, types[field.typeOid]) ?? copy)
			: undefined,
	);
	const parsers: (TextParser | undefined)[] = fields.map((field) =>
		field.format === 1 ? undefined : types[field.typeOid],
	);

	const compiled = compiledDecoder(fields, binary, parsers, mode);
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
			const decode = binary[i];
			try {
				if (decode !== undefined) {
					row.push(decode(bytes, pos, valueEnd));
				} else {
					const parse = parsers[i];
					const text = utf8(bytes, pos, valueEnd);
					row.push(parse === undefined ? text : parse(text));
				}
			} catch (error) {
				const field = fields[i];
				throw new DecodeError(field?.name ?? '', field?.typeOid ?? 0, error);
			}
			pos = valueEnd;
		}
		return row;
	};

	if (mode === 'array') return values;
	const build = assignBuilder(fields.map((field) => field.name));
	return (bytes, start, end) => build(values(bytes, start, end));
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
