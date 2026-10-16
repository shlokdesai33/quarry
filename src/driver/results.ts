import type { Codec } from './codec.js';
import type { Field } from './protocol/messages.js';
import type { CodecRegistry, TypeCatalog } from './registry.js';
import { rowDecoder, type RowDecoder, type RowMode } from './rows.js';

/** The codecs a query expects its result columns in, by position; null where it doesn't know. */
export type ResultCodecs = readonly (Codec | null | undefined)[];

/** How a query's results are read. */
export interface ResultSpec {
	readonly registry: CodecRegistry;
	readonly catalog: TypeCatalog;
	readonly expected: ResultCodecs | undefined;
	/** Whether columns may come in binary. */
	readonly binary: boolean;
}

/**
 * How the columns of one result are read: the format of each (as asked for
 * at Bind), and the codec it is read with.
 */
export interface ResultPlan {
	readonly formats: readonly number[] | 0;
	/** The columns, with those formats. */
	readonly fields: readonly Field[];
	readonly codecs: readonly (Codec | undefined)[];
	/** A column sent in binary that nothing can read: it changed type since the statement was described. */
	readonly unreadable: Field | undefined;
	readonly decoders: Map<RowMode, RowDecoder>;
}

/** text, varchar, bpchar and name: types whose binary format is their text. */
const TEXT_LIKE = new Set([25, 1043, 1042, 19]);

/** Whether a codec's values can be asked for in binary, given the OID it is for. */
function binaryCodec(codec: Codec | undefined, oid: number): boolean {
	return (
		codec !== undefined &&
		codec.resultFormat === 'binary' &&
		codec.decodeBinary !== undefined &&
		oid !== 0
	);
}

/**
 * The codec column `i` is read with: the expected one when the column has
 * its type (or its type can't be checked: a codec for any type, or one not
 * looked up yet), the registry's for the column's type otherwise.
 */
function columnCodec(
	spec: ResultSpec,
	field: Field,
	i: number,
): { codec: Codec | undefined; oid: number } {
	const expected = spec.expected?.[i] ?? undefined;
	if (expected !== undefined) {
		const oid = spec.catalog.resultOidOf(expected);
		if (oid === 0 || oid === field.typeOid) return { codec: expected, oid };
	}
	return {
		codec: spec.registry.codecFor(field.typeOid, spec.catalog),
		oid: field.typeOid,
	};
}

/**
 * The plan for `fields`. Without `requested`, each column is asked for in
 * binary where its codec reads it so; with it, the formats were already
 * asked for (or, with `fields`, the portal's description gives them).
 */
export function resultPlan(
	fields: readonly Field[],
	spec: ResultSpec,
	requested?: readonly number[] | 0 | 'fields',
): ResultPlan {
	const codecs: (Codec | undefined)[] = [];
	const formats: number[] = [];
	let anyBinary = false;
	let unreadable: Field | undefined;
	for (let i = 0; i < fields.length; i++) {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- within bounds
		const field = fields[i]!;
		const { codec, oid } = columnCodec(spec, field, i);
		codecs.push(codec);
		let format: number;
		if (requested === undefined)
			format = spec.binary && binaryCodec(codec, oid) ? 1 : 0;
		else if (requested === 'fields') format = field.format;
		else format = requested === 0 ? 0 : (requested[i] ?? 0);
		if (format === 1 && codec?.decodeBinary === undefined) {
			// its binary is its text: read as text, as it would have been
			if (TEXT_LIKE.has(field.typeOid)) format = 2;
			else unreadable ??= field;
		}
		if (format !== 0) anyBinary = true;
		formats.push(format);
	}
	return {
		formats: anyBinary ? formats.map((format) => (format === 0 ? 0 : 1)) : 0,
		fields: anyBinary
			? fields.map((field, i) => {
					// 2: sent in binary, read as text
					const read = formats[i] === 1 ? 1 : 0;
					return field.format === read ? field : { ...field, format: read };
				})
			: fields.some((field) => field.format !== 0)
				? fields.map((field) => ({ ...field, format: 0 }))
				: fields,
		codecs,
		unreadable,
		decoders: new Map(),
	};
}

/** The plan's row decoder for `mode`, built once. */
export function planDecoder(plan: ResultPlan, mode: RowMode): RowDecoder {
	let decoder = plan.decoders.get(mode);
	if (decoder === undefined) {
		decoder = rowDecoder(plan.fields, plan.codecs, mode);
		plan.decoders.set(mode, decoder);
	}
	return decoder;
}

/** Whether two plans ask for the same formats. */
export function sameFormats(
	a: readonly number[] | 0,
	b: readonly number[] | 0,
): boolean {
	if (a === b) return true;
	if (a === 0 || b === 0) return false;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** Whether two queries expect the same codecs, column by column. */
export function sameCodecs(
	a: ResultCodecs | undefined,
	b: ResultCodecs | undefined,
): boolean {
	if (a === b) return true;
	if (a === undefined || b === undefined || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++)
		if ((a[i] ?? null) !== (b[i] ?? null)) return false;
	return true;
}

/** A plan cached on a statement, for the columns, registry, expected codecs and catalog it was made with. */
export interface CachedPlan {
	readonly fields: readonly Field[];
	readonly registry: CodecRegistry;
	readonly expected: ResultCodecs | undefined;
	readonly binary: boolean;
	readonly generation: number;
	readonly plan: ResultPlan;
}

/** At most this many plans per statement: a statement mostly sees one. */
const MAX_PLANS = 8;

/** The cached plan of `fields` for `spec`, made once. */
export function cachedPlan(
	plans: CachedPlan[],
	fields: readonly Field[],
	spec: ResultSpec,
): ResultPlan {
	for (const cached of plans) {
		if (
			cached.fields === fields &&
			cached.registry === spec.registry &&
			cached.binary === spec.binary &&
			cached.generation === spec.catalog.generation &&
			sameCodecs(cached.expected, spec.expected)
		)
			return cached.plan;
	}
	const plan = resultPlan(fields, spec);
	if (plans.length >= MAX_PLANS) plans.shift();
	plans.push({
		fields,
		registry: spec.registry,
		expected: spec.expected,
		binary: spec.binary,
		generation: spec.catalog.generation,
		plan,
	});
	return plan;
}
