import { DriverError } from './errors.js';
import { parseArray, type TextParser, type TypeParsers } from './types.js';

const TIMESTAMPTZ =
	/^(\d{4,})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(\.\d+)?([+-])(\d\d)(?::?(\d\d))?(?::?(\d\d))?( BC)?$/;

/** The largest and smallest Dates, standing in for `infinity` and `-infinity`. */
const MAX_DATE = 8.64e15;

/**
 * Parses `timestamptz` output (DateStyle ISO) into a Date, keeping
 * milliseconds. `infinity` and `-infinity` become the largest and smallest
 * representable Dates.
 */
export function parseTimestamptz(text: string): Date {
	const fast = fastTimestamptz(text);
	if (fast !== undefined) return new Date(fast);
	if (text === 'infinity') return new Date(MAX_DATE);
	if (text === '-infinity') return new Date(-MAX_DATE);
	const m = TIMESTAMPTZ.exec(text);
	if (m === null)
		throw new DriverError(
			`Invalid timestamptz output (${text.length} characters)`,
		);
	let year = Number(m[1]);
	if (m[12] !== undefined) year = 1 - year;
	const ms = m[7] === undefined ? 0 : Math.floor(Number(m[7]) * 1000);
	const offset =
		(m[8] === '-' ? -1 : 1) *
		(Number(m[9]) * 3600 + Number(m[10] ?? 0) * 60 + Number(m[11] ?? 0));
	const date = new Date(0);
	date.setUTCFullYear(year, Number(m[2]) - 1, Number(m[3]));
	date.setUTCHours(Number(m[4]), Number(m[5]), Number(m[6]), ms);
	return new Date(date.getTime() - offset * 1000);
}

function digits(text: string, at: number, count: number): number {
	let value = 0;
	for (let i = at; i < at + count; i++) {
		const d = text.charCodeAt(i) - 48;
		if (d < 0 || d > 9) return -1;
		value = value * 10 + d;
	}
	return value;
}

/**
 * The common case without a regex: `YYYY-MM-DD HH:MM:SS[.f…]±HH[:MM[:SS]]`
 * for years 100–9999. Undefined for anything else.
 */
function fastTimestamptz(text: string): number | undefined {
	if (
		text.length < 22 ||
		text.charCodeAt(4) !== 45 ||
		text.charCodeAt(10) !== 32 ||
		text.charCodeAt(19) === 32
	)
		return undefined;
	const year = digits(text, 0, 4);
	const month = digits(text, 5, 2);
	const day = digits(text, 8, 2);
	const hour = digits(text, 11, 2);
	const minute = digits(text, 14, 2);
	const second = digits(text, 17, 2);
	if (
		year < 100 ||
		month < 0 ||
		day < 0 ||
		hour < 0 ||
		minute < 0 ||
		second < 0
	)
		return undefined;
	let pos = 19;
	let ms = 0;
	if (text.charCodeAt(pos) === 46) {
		pos++;
		let scale = 100;
		while (pos < text.length) {
			const d = text.charCodeAt(pos) - 48;
			if (d < 0 || d > 9) break;
			ms += d * scale;
			scale /= 10;
			pos++;
		}
		ms = Math.floor(ms + 1e-9);
	}
	const sign = text.charCodeAt(pos);
	if (sign !== 43 && sign !== 45) return undefined;
	let offset = digits(text, pos + 1, 2) * 3600;
	pos += 3;
	if (text.charCodeAt(pos) === 58) {
		offset += digits(text, pos + 1, 2) * 60;
		pos += 3;
		if (text.charCodeAt(pos) === 58) {
			offset += digits(text, pos + 1, 2);
			pos += 3;
		}
	}
	if (pos !== text.length || offset < 0) return undefined;
	return (
		Date.UTC(year, month - 1, day, hour, minute, second, ms) -
		(sign === 45 ? -offset : offset) * 1000
	);
}

/**
 * Parses range output (`[2024-01-01,2024-02-01)`, `(,"a b"]`, `empty`) into
 * a `RangeValue`, each bound through `parse`.
 */
/** A range value: `empty`, or bounds (`null` when unbounded) with their inclusivity. */
export type RangeValue<T> =
	| {
			readonly empty: false;
			readonly lower: T | null;
			readonly upper: T | null;
			readonly bounds: '[)' | '(]' | '[]' | '()';
	  }
	| { readonly empty: true };

export function parseRange<T>(
	text: string,
	parse: (bound: string) => T,
): RangeValue<T> {
	if (text === 'empty') return { empty: true };
	const open = text[0];
	const close = text[text.length - 1];
	if ((open !== '[' && open !== '(') || (close !== ']' && close !== ')')) {
		throw new DriverError(`Invalid range output (${text.length} characters)`);
	}
	const bounds: (string | null)[] = [];
	let i = 1;
	const end = text.length - 1;
	for (let n = 0; n < 2; n++) {
		if (text[i] === '"') {
			let value = '';
			i++;
			while (i < end) {
				const ch = text[i];
				if (ch === '\\') {
					value += text[i + 1] ?? '';
					i += 2;
				} else if (ch === '"') {
					if (text[i + 1] === '"') {
						value += '"';
						i += 2;
					} else {
						i++;
						break;
					}
				} else {
					value += ch;
					i++;
				}
			}
			bounds.push(value);
		} else {
			const stop = n === 0 ? text.indexOf(',', i) : end;
			if (stop < 0)
				throw new DriverError(
					`Invalid range output (${text.length} characters)`,
				);
			const token = text.slice(i, stop);
			bounds.push(token === '' ? null : token);
			i = stop;
		}
		if (n === 0) {
			if (text[i] !== ',')
				throw new DriverError(
					`Invalid range output (${text.length} characters)`,
				);
			i++;
		}
	}
	const [lower, upper] = bounds;
	return {
		empty: false,
		lower: lower === null || lower === undefined ? null : parse(lower),
		upper: upper === null || upper === undefined ? null : parse(upper),
		bounds: `${open}${close}`,
	};
}

/** pgvector's `vector` and `halfvec` output, `[1,2.5,3]`. */
export const parseVector: TextParser = (text) => JSON.parse(text);

/** One row of the catalog query. */
export interface CatalogType {
	readonly oid: number;
	readonly name: string;
	/** For arrays, the element type's OID; 0 otherwise. */
	readonly elem: number;
	readonly delim: string;
}

/** Arrays of every type, plus pgvector's types, by OID. */
export const catalogQuery = `select t.oid::int as oid, t.typname as name, t.typelem::int as elem, t.typdelim as delim
from pg_type t
where t.typname in ('vector', 'halfvec') or t.typinput = 'array_in'::regproc`;

/** Adds parsers for extension types and arrays from the catalog, keeping every parser `base` already has. */
export function catalogTypes(
	base: TypeParsers,
	catalog: readonly CatalogType[],
): TypeParsers {
	const parsers: Record<number, TextParser> = {};
	for (const type of catalog) {
		if (type.elem === 0 && (type.name === 'vector' || type.name === 'halfvec'))
			parsers[type.oid] = parseVector;
	}
	for (const type of catalog) {
		if (type.elem === 0 || base[type.oid] !== undefined) continue;
		const element = base[type.elem] ?? parsers[type.elem];
		parsers[type.oid] = (text) => parseArray(text, element, type.delim);
	}
	return Object.freeze({ ...parsers, ...base });
}
