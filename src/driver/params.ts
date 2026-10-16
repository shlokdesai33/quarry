import { TypedValue, type Codec } from './codec.js';
import { DriverError, UndefinedParameterError } from './errors.js';
import type { WireValue } from './protocol/frontend.js';
import { binaryArray } from './array-params.js';
import type { TypeCatalog } from './registry.js';
import { encodeDefined, undefinedAt } from './types.js';

/** The codecs a query's parameters are encoded with, by position; none where the JavaScript type decides. */
export type ParamCodecs = readonly (Codec | null | undefined)[];

/** The protocol counts parameters in 16 bits. */
const MAX_PARAMETERS = 65535;

const NO_TYPES: readonly number[] = [];
const NO_VALUES: readonly WireValue[] = [];

/** Parameter `i`'s codec: its `typed` one, or the query's. */
function codecAt(
	value: unknown,
	i: number,
	codecs: ParamCodecs | undefined,
): Codec | undefined {
	if (value instanceof TypedValue) return value.codec;
	const codec = codecs?.[i];
	return codec === null ? undefined : codec;
}

/**
 * Encodes a query's parameters: each with its codec (from `typed`, or the
 * query's `paramCodecs`), encoded once; without one, by its JavaScript type
 * (`encodeParam`), an array of a type `paramTypes` declares in binary where
 * every element fits. `undefined`, as a parameter or an array element, is
 * refused rather than sent as NULL.
 */
export function encodeParams(
	sql: string,
	params: readonly unknown[],
	codecs: ParamCodecs | undefined,
	paramTypes: readonly number[] | undefined,
): readonly WireValue[] {
	if (params.length === 0) return NO_VALUES;
	if (params.length > MAX_PARAMETERS) {
		throw new DriverError(
			`A query can have at most ${MAX_PARAMETERS} parameters; this one has ${params.length}`,
		);
	}
	const types = paramTypes ?? NO_TYPES;
	// oxlint-disable-next-line unicorn/no-new-array -- sized up front: growing by push allocates room for 16 more
	const values = new Array<WireValue>(params.length);
	for (let i = 0; i < params.length; i++) {
		const param = params[i];
		const value = param instanceof TypedValue ? param.value : param;
		const element = undefinedAt(value);
		if (element !== undefined)
			throw new UndefinedParameterError(sql, i + 1, element);
		if (value === null) {
			values[i] = null;
			continue;
		}
		const codec =
			codecs === undefined && !(param instanceof TypedValue)
				? undefined
				: codecAt(param, i, codecs);
		if (codec !== undefined) {
			values[i] = codec.encode(value);
			continue;
		}
		const type = types[i];
		values[i] =
			(type !== undefined && type !== 0 && Array.isArray(value)
				? binaryArray(value, type)
				: undefined) ?? encodeDefined(value);
	}
	return values;
}

/**
 * The type OIDs declared at Parse: a codec's, when it declares one and its
 * type is known; a `paramTypes` entry; otherwise 0, for the server to
 * infer. Empty when every one is 0.
 */
export function paramOids(
	params: readonly unknown[],
	codecs: ParamCodecs | undefined,
	paramTypes: readonly number[] | undefined,
	catalog: TypeCatalog,
): readonly number[] {
	const types = paramTypes ?? NO_TYPES;
	if (codecs === undefined) {
		let typed = false;
		for (let i = 0; i < params.length && !typed; i++)
			typed = params[i] instanceof TypedValue;
		if (!typed) return types;
	}
	let oids: number[] | undefined;
	for (let i = 0; i < params.length; i++) {
		const declared = types[i] ?? 0;
		let oid = declared;
		if (oid === 0) {
			const codec = codecAt(params[i], i, codecs);
			if (codec !== undefined && codec.inferParamType !== true)
				oid = catalog.oidOf(codec);
		}
		if (oid !== 0) {
			// oxlint-disable-next-line unicorn/no-new-array -- sized up front, then filled
			oids ??= new Array<number>(params.length).fill(0);
			oids[i] = oid;
		}
	}
	return oids ?? NO_TYPES;
}

/** Whether a parameter's codec is for a type looked up by name that the catalog hasn't resolved yet. */
export function unresolvedParams(
	params: readonly unknown[],
	codecs: ParamCodecs | undefined,
	catalog: TypeCatalog,
): boolean {
	if (catalog.loaded) return false;
	for (let i = 0; i < params.length; i++) {
		const param = params[i];
		const codec = param instanceof TypedValue ? param.codec : codecs?.[i];
		if (codec !== undefined && codec !== null && catalog.unresolved(codec))
			return true;
	}
	return false;
}
