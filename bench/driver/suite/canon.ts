/**
 * Canonical form of query results, for checking that every driver returned
 * the same rows and values. Representation differences that are a decoding
 * choice, not a different value, are normalized: int8 as bigint or string,
 * bytea as Buffer or Uint8Array, a timestamptz or date as text or `Date`.
 */
import { createHash } from 'node:crypto';

const TIMESTAMPTZ = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d+)?)\+00$/;
const DATE = /^\d{4}-\d\d-\d\d$/;

export function canonValue(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'number') return String(value);
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Uint8Array)
		return `\\x${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex')}`;
	if (typeof value === 'string') {
		const ts = TIMESTAMPTZ.exec(value);
		if (ts) return new Date(`${ts[1]}T${ts[2]}Z`).toISOString();
		if (DATE.test(value)) return new Date(`${value}T00:00:00Z`).toISOString();
		return value;
	}
	if (Array.isArray(value)) return value.map(canonValue);
	if (typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).toSorted())
			out[key] = canonValue((value as Record<string, unknown>)[key]);
		return out;
	}
	return value;
}

/** Rows as arrays of canonical values, in column order. */
export function canonRows(rows: readonly unknown[]): unknown[] {
	return rows.map((row) => Object.values(row as object).map(canonValue));
}

export function digest(value: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(value))
		.digest('hex')
		.slice(0, 16);
}
