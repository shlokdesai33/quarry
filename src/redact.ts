import {
	type CompiledQuery,
	queryInfo,
	type QueryInfo,
	REDACTED,
} from './compile.js';
import { type Codec, codecText } from './driver/codec.js';
import { DecodeError, PostgresError } from './driver/index.js';
import { arrayLiteral, textOf } from './driver/types.js';

/**
 * The shortest sensitive value searched for in a server error's message and
 * detail: shorter ones would match too much of the text around them.
 */
const SHORTEST_SEARCHED = 3;

/**
 * The text each sensitive parameter was sent as, by its codec (or, without
 * one, as the driver sends its JavaScript value), and each element's for an
 * array: what a server error may quote.
 */
function sensitiveTexts(query: CompiledQuery, info: QueryInfo): string[] {
	const texts: string[] = [];
	const add = (value: unknown, codec: Codec | undefined): void => {
		if (value === null || value === undefined) return;
		if (Array.isArray(value) && codec?.element !== undefined) {
			for (const item of value) add(item, codec.element);
		} else if (Array.isArray(value) && codec === undefined) {
			for (const item of value) add(item, undefined);
		}
		const text =
			codec === undefined
				? Array.isArray(value)
					? arrayLiteral(value)
					: textOf(value)
				: codecText(codec, value);
		if (text.length >= SHORTEST_SEARCHED) texts.push(text);
	};
	query.params.forEach((value, i) => {
		const param = info.params[i];
		if (param?.sensitive) add(value, param.codec);
	});
	// longest first, so a value containing another is replaced whole
	return texts.toSorted((a, b) => b.length - a.length);
}

/** Every sensitive column of the tables the query names. */
function sensitiveColumns(info: QueryInfo): Set<string> {
	const all = new Set<string>();
	for (const columns of info.sensitiveColumns.values())
		for (const column of columns) all.add(column);
	return all;
}

function unquote(name: string): string {
	return name.startsWith('"') && name.endsWith('"')
		? name.slice(1, -1).replaceAll('""', '"')
		: name;
}

/**
 * A constraint error's detail with the values of sensitive columns
 * redacted: `Key (email)=(ada@example.com) already exists.` becomes
 * `Key (email)=([redacted]) already exists.`, and `Failing row contains
 * (…)`, which lists every column, loses its values. `undefined` when there
 * is nothing to redact.
 */
export function redactDetail(
	detail: string,
	sensitive: ReadonlySet<string>,
): string | undefined {
	if (sensitive.size === 0) return undefined;
	if (detail.startsWith('Failing row contains ('))
		return `Failing row contains (${REDACTED}).`;
	const key = /^Key \((.*?)\)=\(/s.exec(detail);
	const columns = key?.[1];
	if (columns === undefined) return undefined;
	if (!columns.split(', ').some((column) => sensitive.has(unquote(column))))
		return undefined;
	const conflict = / conflicts with (existing )?key \((.*?)\)=\(.*\)\.$/s.exec(
		detail,
	);
	if (conflict !== null) {
		return `Key (${columns})=(${REDACTED}) conflicts with ${conflict[1] ?? ''}key (${conflict[2] ?? ''})=(${REDACTED}).`;
	}
	const rest =
		/\) (already exists\.|is not present in table ".*"\.|is still referenced from table ".*"\.)$/s.exec(
			detail,
		);
	return `Key (${columns})=(${REDACTED})${rest === null ? '' : ` ${rest[1]}`}`;
}

/** Replaces the message in an error's stack, whose first line repeats it. */
function setMessage(error: Error, message: string): void {
	const previous = error.message;
	if (previous === message) return;
	error.message = message;
	if (error.stack?.includes(previous))
		error.stack = error.stack.replace(previous, message);
}

function redactPostgresError(
	error: PostgresError,
	query: CompiledQuery,
	info: QueryInfo,
): void {
	const texts = sensitiveTexts(query, info);
	const scrub = (text: string): string =>
		texts.reduce((out, value) => out.replaceAll(value, REDACTED), text);
	const fields = error.fields as Record<string, string | undefined>;
	if (error.detail !== undefined) {
		const detail = scrub(
			redactDetail(error.detail, sensitiveColumns(info)) ?? error.detail,
		);
		if (detail !== error.detail) {
			Object.defineProperty(error, 'detail', {
				value: detail,
				enumerable: true,
			});
			fields['D'] = detail;
		}
	}
	const message = scrub(error.message);
	if (message !== error.message) {
		setMessage(error, message);
		fields['M'] = message;
	}
}

/** A decode error's message never has the value; its parser's error, the `cause`, may. */
function redactDecodeError(error: DecodeError, info: QueryInfo): void {
	if (!info.sensitiveFields.has(error.column)) return;
	Reflect.deleteProperty(error, 'cause');
}

/**
 * Redacts what `error` repeats of the values of `query`'s sensitive
 * columns: a server error's message and constraint detail, and a decode
 * error's cause. A no-op for queries without sensitive columns.
 */
export function redactError(error: unknown, query: CompiledQuery): void {
	const info = queryInfo(query);
	if (info === undefined) return;
	if (error instanceof PostgresError) redactPostgresError(error, query, info);
	else if (error instanceof DecodeError) redactDecodeError(error, info);
}
