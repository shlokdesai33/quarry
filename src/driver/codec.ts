import { arrayDecoder, TEXT, type BinaryParser } from './binary.js';
import { binaryArray } from './array-params.js';
import { DriverError } from './errors.js';
import { parseArray } from './types.js';

/** How a value travels: as Postgres text, or in the type's binary format. */
export type CodecFormat = 'text' | 'binary';

/**
 * How values of one Postgres type are sent and read: the one place a
 * type's encoding lives, for parameters and results alike. The driver owns
 * the built-in codecs (`codecs`), `arrayOf`, and the registry that decodes
 * a result column by its type OID; a query builder only chooses which codec
 * each parameter and column uses.
 *
 * `In` is what `encode` takes, `Out` what the decoders return.
 */
export interface Codec<In = unknown, Out = In> {
	/**
	 * The type's name as SQL writes it (`int4`, `user_status`, `vector`). A
	 * codec whose `oid` is 0 is looked up by it in `pg_type`, once per pool.
	 * Empty for a codec that takes any type (`codecs.raw`).
	 */
	readonly name: string;
	/** The type's OID; 0 for a type looked up by `name` (enums, domains, extension types). */
	readonly oid: number;
	/** The OID of the type's array type, when fixed; otherwise looked up with the type. */
	readonly arrayOid?: number | undefined;
	/** What `encode` returns: text, or bytes in the type's binary format. */
	readonly paramFormat: CodecFormat;
	/** The format results are asked for in; `binary` needs `decodeBinary`. */
	readonly resultFormat: CodecFormat;
	/**
	 * Leaves a parameter's type for the server to infer (OID 0) instead of
	 * declaring `oid`. For text-like types: a value declared `text` against
	 * a `citext`, enum or `char(n)` column would change how it compares, or
	 * fail with "column is of type X but expression is of type text".
	 */
	readonly inferParamType?: boolean | undefined;
	/** For an array codec, its elements' codec. */
	readonly element?: Codec | undefined;
	/** For an array codec, the element delimiter (`,`; `;` for `box`). */
	readonly delimiter?: string | undefined;
	/** A non-null value as the server reads it: text, or bytes for `paramFormat: 'binary'`. */
	encode(value: In): string | Uint8Array;
	/** A non-null value from the server's text output. */
	decodeText(text: string): Out;
	/** A non-null value from its binary format, `bytes[start, end)`. */
	decodeBinary?(bytes: Uint8Array, start: number, end: number): Out;
}

/** What a codec's `encode` takes. */
export type CodecInput<C> = C extends {
	encode(value: infer In): string | Uint8Array;
}
	? In
	: never;

/** What a codec's decoders return. */
export type CodecOutput<C> = C extends { decodeText(text: string): infer Out }
	? Out
	: never;

/** What `defineCodec` takes: a codec, with defaults for everything but its name and conversions. */
export interface CodecSpec<In, Out> {
	readonly name: string;
	/** Default 0: looked up by `name` in `pg_type`. */
	readonly oid?: number | undefined;
	readonly arrayOid?: number | undefined;
	/** Default `text`. */
	readonly paramFormat?: CodecFormat | undefined;
	/** Default `binary` when `decodeBinary` is given, `text` otherwise. */
	readonly resultFormat?: CodecFormat | undefined;
	readonly inferParamType?: boolean | undefined;
	encode(value: In): string | Uint8Array;
	decodeText(text: string): Out;
	decodeBinary?(bytes: Uint8Array, start: number, end: number): Out;
}

/**
 * A codec for a type of your own, an extension's or a domain's: values are
 * text both ways unless it says otherwise. Without an `oid`, the type is
 * looked up by `name` once per pool, so parameters declare it exactly and
 * results are checked against it.
 *
 * @example
 * const citext = defineCodec({
 *   name: 'citext',
 *   inferParamType: true,
 *   encode: (value: string) => value,
 *   decodeText: (text) => text,
 * });
 */
export function defineCodec<In, Out = In>(
	spec: CodecSpec<In, Out>,
): Codec<In, Out> {
	const codec: Codec<In, Out> = {
		name: spec.name,
		oid: spec.oid ?? 0,
		arrayOid: spec.arrayOid,
		paramFormat: spec.paramFormat ?? 'text',
		resultFormat:
			spec.resultFormat ??
			(spec.decodeBinary === undefined ? 'text' : 'binary'),
		inferParamType: spec.inferParamType,
		encode: (value) => spec.encode(value),
		decodeText: (text) => spec.decodeText(text),
		...(spec.decodeBinary === undefined
			? {}
			: {
					decodeBinary: (bytes: Uint8Array, start: number, end: number) =>
						// oxlint-disable-next-line typescript/no-non-null-assertion -- checked above
						spec.decodeBinary!(bytes, start, end),
				}),
	};
	return Object.freeze(codec);
}

/** Returns the text it is given: the decoder of types read as the server's text. */
export const passThrough = (text: string): string => text;

/** Whether `codec` decodes text by returning it as it is, so a decoder can skip calling it. */
export const decodesAsText = (codec: Codec): boolean =>
	codec.decodeText === passThrough;

/**
 * Element codecs whose arrays are read in binary although their own values
 * are text: text-like types (the same bytes either way, but one slice of
 * the whole array beats parsing its literal) and json (a version byte and
 * the same text).
 */
const binaryInArrays = new WeakSet<Codec>();

/** Element codecs the driver has an in-place binary array encoder for. */
const binaryArrayEncoders = new WeakSet<Codec>();

/** @internal Marks a built-in codec's arrays as read in binary. */
export function readArraysInBinary(codec: Codec): void {
	binaryInArrays.add(codec);
}

/** @internal Marks a built-in codec's arrays as sent in binary. */
export function sendArraysInBinary(codec: Codec): void {
	binaryArrayEncoders.add(codec);
}

/** Element codecs whose values are themselves JavaScript arrays (json, vector): an array element is a value, not a dimension. */
const arrayValued = new WeakSet<Codec>();

/** @internal Marks a codec whose values may be JavaScript arrays. */
export function markArrayValued(codec: Codec): void {
	arrayValued.add(codec);
}

/** Codecs whose binary format is their UTF-8 text. */
const textLike = new WeakSet<Codec>();

/** @internal Marks a codec whose binary format is its text. */
export function markTextLike(codec: Codec): void {
	textLike.add(codec);
}

/** Whether a codec's binary format is its UTF-8 text. */
const isTextLike = (codec: Codec): boolean => textLike.has(codec);

const HEX_DIGITS = '0123456789abcdef';

function hexOf(bytes: Uint8Array): string {
	let out = '\\x';
	for (const byte of bytes)
		out += (HEX_DIGITS[byte >> 4] ?? '0') + (HEX_DIGITS[byte & 15] ?? '0');
	return out;
}

/** Characters that make an array element's text need quotes, by delimiter. */
const SPECIAL: Readonly<Record<string, RegExp>> = {
	',': /[{}"\\,\s]/,
	';': /[{}"\\;\s]/,
};

/** Whether an array element's text must be quoted: empty, `NULL`, or holding syntax, a quote, a backslash or white space. */
function needsQuotes(text: string, delimiter: string): boolean {
	if (text.length === 0) return true;
	if (text.length === 4 && text.toUpperCase() === 'NULL') return true;
	const special = SPECIAL[delimiter];
	if (special !== undefined) return special.test(text);
	return /[{}"\\\s]/.test(text) || text.includes(delimiter);
}

const BACKSLASH_OR_QUOTE = /[\\"]/g;
const HAS_BACKSLASH_OR_QUOTE = /[\\"]/;

/** An array literal of `values`, each element through `element.encode`. */
function arrayText(
	values: readonly unknown[],
	element: Codec,
	delimiter: string,
): string {
	let out = '{';
	for (let i = 0; i < values.length; i++) {
		if (i > 0) out += delimiter;
		const value = values[i];
		if (value === null || value === undefined) {
			out += 'NULL';
			continue;
		}
		if (Array.isArray(value) && !arrayValued.has(element)) {
			out += arrayText(value, element, delimiter);
			continue;
		}
		const encoded = element.encode(value);
		const text = typeof encoded === 'string' ? encoded : hexOf(encoded);
		if (!needsQuotes(text, delimiter)) out += text;
		else if (HAS_BACKSLASH_OR_QUOTE.test(text))
			out += `"${text.replace(BACKSLASH_OR_QUOTE, '\\$&')}"`;
		else out += `"${text}"`;
	}
	return `${out}}`;
}

/** The binary decoder of `element`'s arrays, if it has one. */
function arrayBinary(element: Codec): BinaryParser | undefined {
	if (element.decodeBinary === undefined) return undefined;
	const decode = isTextLike(element)
		? TEXT
		: (bytes: Uint8Array, start: number, end: number): unknown =>
				// oxlint-disable-next-line typescript/no-non-null-assertion -- checked above
				element.decodeBinary!(bytes, start, end);
	return arrayDecoder(element.oid, decode);
}

const arrays = new WeakMap<Codec, Map<string, Codec>>();

/**
 * The codec of arrays of `element` (`int4[]`, `user_status[]`), of any
 * number of dimensions; NULL elements are `null`. It is the same object for
 * the same element, so caches keyed by codec find it.
 *
 * Arrays are sent in binary where the driver has an encoder for the element
 * and every element fits it, and as an array literal otherwise; read in
 * binary where the element is (and for text-like and json elements).
 */
export function arrayOf<In, Out>(
	element: Codec<In, Out>,
	delimiter = element.name === 'box' ? ';' : ',',
): Codec<readonly (In | null)[], (Out | null)[]> {
	let byDelimiter = arrays.get(element);
	if (byDelimiter === undefined) {
		byDelimiter = new Map();
		arrays.set(element, byDelimiter);
	}
	const known = byDelimiter.get(delimiter);
	if (known !== undefined) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- built below for this element
		return known as Codec<readonly (In | null)[], (Out | null)[]>;
	}
	if (element.element !== undefined)
		throw new DriverError(
			'Postgres has no arrays of arrays: use one array codec of any dimensions',
		);
	const arrayOid = element.arrayOid ?? 0;
	const binaryEncode = binaryArrayEncoders.has(element) && arrayOid !== 0;
	const decodeBinary = arrayBinary(element);
	const elementText = decodesAsText(element)
		? undefined
		: (text: string) => element.decodeText(text);
	const codec: Codec<readonly (In | null)[], (Out | null)[]> = {
		name: `${element.name}[]`,
		oid: arrayOid,
		paramFormat: binaryEncode ? 'binary' : 'text',
		resultFormat:
			decodeBinary !== undefined &&
			(element.resultFormat === 'binary' || binaryInArrays.has(element))
				? 'binary'
				: 'text',
		inferParamType: element.inferParamType,
		element,
		delimiter,
		encode(values) {
			if (typeof values === 'string') return values;
			if (!Array.isArray(values))
				throw new DriverError(
					`An ${element.name}[] parameter must be an array`,
				);
			if (binaryEncode) {
				const bytes = binaryArray(values, arrayOid, true);
				if (bytes !== undefined) return bytes;
			}
			return arrayText(values, element, delimiter);
		},
		decodeText: (text) =>
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- elements through the element's decoder
			parseArray(text, elementText, delimiter) as (Out | null)[],
		...(decodeBinary === undefined
			? {}
			: {
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- elements through the element's decoder
					decodeBinary: decodeBinary as (
						bytes: Uint8Array,
						start: number,
						end: number,
					) => (Out | null)[],
				}),
	};
	Object.freeze(codec);
	byDelimiter.set(delimiter, codec);
	return codec;
}

const declared = new WeakMap<Codec, Codec>();

/**
 * `codec`, declaring its type for parameters even where it would leave it
 * to the server (`inferParamType`): for a parameter whose type the SQL
 * pins anyway, as `$1::text[]` does. Arrays of text-like types then go in
 * binary.
 */
export function declareParamType<In, Out>(
	codec: Codec<In, Out>,
): Codec<In, Out> {
	if (codec.inferParamType !== true || codec.oid === 0) return codec;
	const known = declared.get(codec);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- made below from this codec
	if (known !== undefined) return known as Codec<In, Out>;
	const element = codec.element;
	const binary =
		element !== undefined &&
		isTextLike(element) &&
		element.arrayOid !== undefined;
	const copy: Codec<In, Out> = Object.freeze({
		...codec,
		inferParamType: false,
		...(binary
			? {
					paramFormat: 'binary' as const,
					encode: (value: In) =>
						(Array.isArray(value)
							? binaryArray(value, codec.oid)
							: undefined) ?? codec.encode(value),
				}
			: {}),
	});
	declared.set(codec, copy);
	return copy;
}

/**
 * A parameter with its codec: encoded by it once, and sent with its type's
 * OID (unless the codec leaves the type to the server). Without one, a
 * parameter is encoded by its JavaScript type and its type is inferred.
 *
 * @example await pool.query('select $1 @> $2', [typed(range, codecs.tstzrange), typed(now, codecs.timestamptz)]);
 */
export function typed<In>(
	value: In | null,
	codec: Codec<In, unknown>,
): TypedValue {
	return new TypedValue(value, codec);
}

/** A parameter `typed` gave a codec. */
export class TypedValue {
	readonly value: unknown;
	readonly codec: Codec;

	constructor(value: unknown, codec: Codec<never, unknown>) {
		this.value = value;
		this.codec = codec;
	}
}
