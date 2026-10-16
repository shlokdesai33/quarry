import type { Codec } from './driver/codec.js';
import { codecs } from './driver/codecs.js';
import { createCodecRegistry } from './driver/registry.js';
import type { Kind } from './operators.js';

/**
 * The codec each column factory's type is read and sent with: what makes a
 * column's TypeScript type true at run time. int8 and numeric arrive as
 * strings (no digits lost), timestamptz as a Date, date, time, timestamp
 * and interval as the server's text, ranges as `Range`, jsonb parsed
 * (JSON `null` included), bytea as a `Uint8Array`, vector as the float32
 * values stored.
 */
export const kindCodecs = {
	smallint: codecs.int2,
	integer: codecs.int4,
	bigint: codecs.int8AsString,
	decimal: codecs.numeric,
	real: codecs.float4,
	'double precision': codecs.float8,
	boolean: codecs.bool,
	text: codecs.text,
	varchar: codecs.varchar,
	uuid: codecs.uuid,
	bytea: codecs.bytea,
	date: codecs.date,
	time: codecs.time,
	timestamp: codecs.timestamp,
	timestamptz: codecs.timestamptz,
	interval: codecs.interval,
	jsonb: codecs.jsonb,
	inet: codecs.inet,
	tsvector: codecs.tsvector,
	vector: codecs.vector,
	daterange: codecs.daterange,
	tstzrange: codecs.tstzrange,
} as const satisfies Partial<Record<Kind, Codec>>;

/** The kinds with a codec of their own; enums, arrays and custom types are given theirs. */
export type CodecKind = keyof typeof kindCodecs;

/** The kinds' codecs, as a table of every kind (no kind is an `Object` member). */
const byKind: Partial<Record<Kind, Codec>> = kindCodecs;

/** The codec a kind's values are sent and read with. */
export function kindCodec(kind: Kind): Codec {
	return byKind[kind] ?? codecs.raw;
}

/**
 * How quarry reads a column no query chose a codec for (raw SQL, an
 * expression of unknown type): the driver's default codecs, with the
 * choices the column factories make, and pgvector's types.
 */
export const quarryRegistry = createCodecRegistry([
	codecs.int8AsString,
	codecs.timestamptz,
	codecs.daterange,
	codecs.tstzrange,
	codecs.vector,
	codecs.halfvec,
]);
