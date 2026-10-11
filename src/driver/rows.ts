import { binaryParser, type BinaryParser } from './binary.js';
import { ProtocolError } from './errors.js';
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

/**
 * A function building `{ name0: v[0], … }` for one result shape: an object
 * literal gives every row the same hidden class from the start. Undefined
 * where `new Function` is forbidden (e.g. Cloudflare Workers) or a name
 * can't be written as a plain property (`__proto__`).
 */
function literalBuilder(names: readonly string[]): Build | undefined {
	if (names.includes('__proto__')) return undefined;
	const body = `return {${names.map((name, i) => `${JSON.stringify(name)}: v[${i}]`).join(', ')}};`;
	try {
		// oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-type-assertion
		return new Function('v', body) as Build;
	} catch {
		return undefined;
	}
}

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
			if (decode !== undefined) {
				row.push(decode(bytes, pos, valueEnd));
			} else {
				const parse = parsers[i];
				const text = utf8(bytes, pos, valueEnd);
				row.push(parse === undefined ? text : parse(text));
			}
			pos = valueEnd;
		}
		return row;
	};

	if (mode === 'array') return values;
	const names = fields.map((field) => field.name);
	const build = literalBuilder(names) ?? assignBuilder(names);
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
