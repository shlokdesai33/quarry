import { describe, expectTypeOf, it } from 'vitest';
import {
	array,
	bigint,
	bytea,
	integer,
	jsonb,
	text,
	timestamptz,
	tstzrange,
	vector,
} from '../src/column-factories.js';
import { defineTable } from '../src/define-table.js';
import { defineType } from '../src/define-type.js';
import {
	arrayOf,
	defineCodec,
	type Codec,
	type CodecInput,
	type CodecOutput,
} from '../src/driver/codec.js';
import { codecs, type JsonValue } from '../src/driver/codecs.js';
import { expressionBuilder } from '../src/expression-builder.js';
import type { Range } from '../src/range.js';
import { selectFrom } from '../src/select-query-builder.js';
import type { InferInsertType, InferSelectType } from '../src/types.js';

describe('column types derived from codecs', () => {
	it('follow the factories’ codecs', () => {
		expectTypeOf(integer().$select).toEqualTypeOf<number>();
		expectTypeOf(bigint().$select).toEqualTypeOf<string>();
		expectTypeOf(timestamptz().$select).toEqualTypeOf<Date>();
		expectTypeOf(tstzrange().$select).toEqualTypeOf<Range<Date>>();
		expectTypeOf(vector().$select).toEqualTypeOf<number[]>();
		expectTypeOf(integer().$select).toEqualTypeOf<
			CodecOutput<typeof codecs.int4>
		>();
	});

	it('read jsonb as any JSON value, JSON null included', () => {
		expectTypeOf(jsonb().$select).toEqualTypeOf<JsonValue>();
		expectTypeOf<null>().toExtend<JsonValue>();
		expectTypeOf(jsonb<{ theme: string }>().$select).toEqualTypeOf<{
			theme: string;
		}>();
	});

	it('read bytea as a plain Uint8Array, never narrowed to a Buffer', () => {
		expectTypeOf(bytea().$select).toEqualTypeOf<Uint8Array>();
		expectTypeOf<Buffer>().toExtend<
			typeof bytea extends () => { $insert: infer I } ? I : never
		>();
		// @ts-expect-error -- bytea isn't narrowed: what is read is never a Buffer
		bytea<Buffer>();
	});

	it('swap to a codec’s input and output with useCodec, keeping nullability and write rules', () => {
		expectTypeOf(
			timestamptz().useCodec(codecs.raw).$select,
		).toEqualTypeOf<string>();
		expectTypeOf(
			timestamptz().nullable().useCodec(codecs.raw).$select,
		).toEqualTypeOf<string | null>();
		const big = bigint().default().useCodec(codecs.int8);
		expectTypeOf(big.$select).toEqualTypeOf<bigint>();
		expectTypeOf(big.$insert).toEqualTypeOf<
			bigint | number | string | undefined
		>();
		const generated = text().generated().useCodec(codecs.raw);
		expectTypeOf(generated.$insert).toEqualTypeOf<never>();
		expectTypeOf(generated.$update).toEqualTypeOf<never>();
		const id = integer().identity().useCodec(codecs.int8);
		expectTypeOf(id.$select).toEqualTypeOf<bigint>();
		expectTypeOf(id.$insert).toEqualTypeOf<never>();
		expectTypeOf(array(text().useCodec(codecs.raw)).$select).toEqualTypeOf<
			string[]
		>();
	});

	it('type columns of a defineType by its codec, narrowed by the factory', () => {
		const points = defineType({ sql: 'points', codec: codecs.int4 });
		expectTypeOf(points().$select).toEqualTypeOf<number>();
		expectTypeOf(points<1 | 2>().$select).toEqualTypeOf<1 | 2>();
		expectTypeOf(points<1 | 2>().$insert).toEqualTypeOf<1 | 2>();
		const tags = defineType({
			sql: 'tag_set',
			codec: defineCodec({
				name: 'tag_set',
				encode: (value: ReadonlySet<string>) => [...value].join(','),
				decodeText: (output) => new Set(output.split(',')),
			}),
		});
		expectTypeOf(tags().$select).toEqualTypeOf<Set<string>>();
		expectTypeOf(tags().$insert).toEqualTypeOf<ReadonlySet<string>>();
	});

	it('flow into tables, rows and comparisons', () => {
		const points = defineType({ sql: 'points', codec: codecs.int4 });
		const t = defineTable('t', {
			columns: {
				p: points(),
				at: timestamptz().useCodec(codecs.raw),
				doc: jsonb(),
			},
		});
		type Row = InferSelectType<typeof t>;
		expectTypeOf<Row['p']>().toEqualTypeOf<number>();
		expectTypeOf<Row['at']>().toEqualTypeOf<string>();
		expectTypeOf<Row['doc']>().toEqualTypeOf<JsonValue>();
		type Insert = InferInsertType<typeof t>;
		expectTypeOf<Insert['p']>().toEqualTypeOf<number>();
		expectTypeOf<Insert['at']>().toEqualTypeOf<string>();
		const eb = expressionBuilder(t);
		eb.ref('t.p').gt(1);
		eb.ref('t.p').eq(eb.ref('t.p'));
		// @ts-expect-error -- a value of the codec's type
		eb.ref('t.p').eq('1');
		eb.ref('t.at').eq('2024-01-01 00:00:00+00');
		const row = selectFrom(t).select(['t.p', 't.at']);
		expectTypeOf<Awaited<ReturnType<typeof row.execute>>>().toEqualTypeOf<
			{ p: number; at: string }[]
		>();
	});
});

describe('codecs', () => {
	it('infer their input and output', () => {
		const c = defineCodec({
			name: 'x',
			encode: (value: { n: number }) => String(value.n),
			decodeText: (output) => ({ n: Number(output) }),
		});
		expectTypeOf(c).toEqualTypeOf<Codec<{ n: number }, { n: number }>>();
		expectTypeOf<CodecInput<typeof codecs.int8>>().toEqualTypeOf<
			bigint | number | string
		>();
		expectTypeOf<CodecOutput<typeof codecs.int8>>().toEqualTypeOf<bigint>();
		expectTypeOf(arrayOf(codecs.int4)).toEqualTypeOf<
			Codec<readonly (number | null)[], (number | null)[]>
		>();
	});

	it('type a parameter given to eb.val', () => {
		const t = defineTable('t', { columns: { r: tstzrange() } });
		const eb = expressionBuilder(t);
		eb.fn.concat(eb.val(new Date(), codecs.timestamptz));
		// @ts-expect-error -- the codec takes a Date
		eb.fn.concat(eb.val('now', codecs.timestamptz));
	});
});
