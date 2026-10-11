import { ProtocolError } from './errors.js';
import type { Field } from './protocol/messages.js';
import { utf8 } from './protocol/text.js';
import type { QueryResult } from './ops.js';
import type { TextParser, TypeParsers } from './types.js';

/** `object` rows are keyed by column name (the last wins on duplicates); `array` rows are positional. */
export type RowMode = 'object' | 'array';

/** Decodes one DataRow body into a row. */
export type RowDecoder = (payload: Uint8Array) => unknown;

function int32(bytes: Uint8Array, at: number): number {
	return (
		((bytes[at] ?? 0) << 24) |
		((bytes[at + 1] ?? 0) << 16) |
		((bytes[at + 2] ?? 0) << 8) |
		(bytes[at + 3] ?? 0)
	);
}

/** Builds a decoder for rows of `fields`, parsing text values by type OID. */
export function rowDecoder(
	fields: readonly Field[],
	types: TypeParsers,
	mode: RowMode,
): RowDecoder {
	const count = fields.length;
	const names = fields.map((field) => field.name);
	const binary = fields.map((field) => field.format === 1);
	const parsers: (TextParser | undefined)[] = fields.map((field) =>
		field.format === 1 ? undefined : types[field.typeOid],
	);

	const value = (
		payload: Uint8Array,
		i: number,
		start: number,
		end: number,
	): unknown => {
		if (binary[i]) return payload.slice(start, end);
		const text = utf8(payload, start, end);
		const parse = parsers[i];
		return parse === undefined ? text : parse(text);
	};

	const check = (payload: Uint8Array): void => {
		if (
			payload.length < 2 ||
			((payload[0] ?? 0) << 8) + (payload[1] ?? 0) !== count
		) {
			throw new ProtocolError(
				'DataRow column count does not match RowDescription',
			);
		}
	};

	if (mode === 'array') {
		return (payload) => {
			check(payload);
			const row: unknown[] = [];
			let pos = 2;
			for (let i = 0; i < count; i++) {
				if (pos + 4 > payload.length)
					throw new ProtocolError('DataRow too short');
				const length = int32(payload, pos);
				pos += 4;
				if (length === -1) {
					row[i] = null;
					continue;
				}
				const end = pos + length;
				if (length < 0 || end > payload.length)
					throw new ProtocolError('Invalid value length in DataRow');
				row[i] = value(payload, i, pos, end);
				pos = end;
			}
			return row;
		};
	}
	return (payload) => {
		check(payload);
		const row: Record<string, unknown> = {};
		let pos = 2;
		for (let i = 0; i < count; i++) {
			if (pos + 4 > payload.length)
				throw new ProtocolError('DataRow too short');
			const length = int32(payload, pos);
			pos += 4;
			const name = names[i] ?? '';
			if (length === -1) {
				row[name] = null;
				continue;
			}
			const end = pos + length;
			if (length < 0 || end > payload.length)
				throw new ProtocolError('Invalid value length in DataRow');
			row[name] = value(payload, i, pos, end);
			pos = end;
		}
		return row;
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
