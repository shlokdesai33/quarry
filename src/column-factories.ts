import { captureCallSite } from './call-site.js';
import { Column } from './column/column.js';
import { IntegerColumn } from './column/integer-column.js';
import { ArrayType } from './data-type/array.js';
import { DataType } from './data-type/data-type.js';
import type { CodecOutput } from './driver/codec.js';
import type { CodecKind, kindCodecs } from './kind-codecs.js';
import type { Kind } from './operators.js';

/** What a kind's codec reads: the TypeScript type of its columns, which `T` may narrow. */
type Out<K extends CodecKind> = CodecOutput<(typeof kindCodecs)[K]>;

/**
 * A `smallint` column: a two-byte integer from -32768 to 32767, whose value
 * is a `number`. `T` narrows it, e.g. to a union of literals or a branded id.
 *
 * As one of the integer types it can be an identity. It is ordered, and
 * compares with every other numeric type, so it can be checked against an
 * `integer` or `decimal` expression without a cast.
 *
 * @example priority: smallint()
 * @example level: smallint<1 | 2 | 3>().default()
 * @example id: smallint().identity()
 */
export function smallint<T extends Out<'smallint'> = Out<'smallint'>>() {
	return new IntegerColumn<DataType<'smallint'>, T>({
		dataType: new DataType('smallint'),
		site: captureCallSite(smallint),
	});
}

/**
 * An `integer` column: a four-byte integer from -2147483648 to 2147483647,
 * whose value is a `number`. `T` narrows it, e.g. to a branded id.
 *
 * As one of the integer types it can be an identity, the usual choice for a
 * primary key. It is ordered, and compares with every other numeric type.
 *
 * @example age: integer()
 * @example id: integer().identity()
 * @example authorId: integer<UserId>().name('author_id')
 */
export function integer<T extends Out<'integer'> = Out<'integer'>>() {
	return new IntegerColumn<DataType<'integer'>, T>({
		dataType: new DataType('integer'),
		site: captureCallSite(integer),
	});
}

/**
 * A `bigint` column: an eight-byte integer, whose value is a `string`. It
 * arrives as a string because its range exceeds what a JavaScript number can
 * hold exactly, and values are written as strings for the same reason. `T`
 * narrows it, e.g. to a branded id.
 *
 * As one of the integer types it can be an identity. It is ordered, and
 * compares with every other numeric type, so an `integer` expression is
 * accepted on the other side of a comparison although its values are
 * numbers.
 *
 * @example views: bigint()
 * @example id: bigint<OrderId>().identity()
 */
export function bigint<T extends Out<'bigint'> = Out<'bigint'>>() {
	return new IntegerColumn<DataType<'bigint'>, T>({
		dataType: new DataType('bigint'),
		site: captureCallSite(bigint),
	});
}

/**
 * A `real` column: a four-byte floating point number with about six decimal
 * digits of precision, whose value is a `number`. `T` narrows it.
 *
 * Values are inexact, so `=` may not match a value that prints the same; use
 * `decimal()` for amounts that must be exact. It is ordered, and compares
 * with every other numeric type.
 *
 * @example ratio: real()
 * @example weight: real().nullable()
 */
export function real<T extends Out<'real'> = Out<'real'>>() {
	return new Column<DataType<'real'>, T>({
		dataType: new DataType('real'),
		site: captureCallSite(real),
	});
}

/**
 * A `double precision` column: an eight-byte floating point number with
 * about fifteen decimal digits of precision, the same as a JavaScript
 * number, whose value is a `number`. `T` narrows it.
 *
 * Values are inexact, so `=` may not match a value that prints the same; use
 * `decimal()` for amounts that must be exact. It is ordered, and compares
 * with every other numeric type.
 *
 * @example latitude: doublePrecision()
 * @example score: doublePrecision().default()
 */
export function doublePrecision<
	T extends Out<'double precision'> = Out<'double precision'>,
>() {
	return new Column<DataType<'double precision'>, T>({
		dataType: new DataType('double precision'),
		site: captureCallSite(doublePrecision),
	});
}

/**
 * A `decimal` column: an exact number with arbitrary precision, whose value
 * is a `string`. It arrives as a string so no digits are lost, which a
 * JavaScript number would do, and values are written as strings for the same
 * reason. `T` narrows it.
 *
 * Without a precision the column holds any number of digits on either side
 * of the decimal point. A precision and scale, as in `numeric(10, 2)`, are
 * checked by `db.verify` only; values aren't. It is ordered, and compares
 * with every other numeric type.
 *
 * @example price: decimal(10, 2)
 * @example balance: decimal().default()
 */
export function decimal<T extends Out<'decimal'> = Out<'decimal'>>(
	precision?: number,
	scale?: number,
) {
	return new Column<DataType<'decimal'>, T>({
		dataType: new DataType('decimal', {
			modifiers: modifiers(precision, scale),
		}),
		site: captureCallSite(decimal),
	});
}

/**
 * A `boolean` column, whose value is a `boolean`. `T` narrows it, e.g. to
 * `true` for a column that is never false.
 *
 * Besides equality it admits `is` and `is not` with `true`, `false` or
 * `null`, which, unlike `=`, never yield unknown for a null column. A
 * comparison has this type too, so one predicate can be compared with
 * another.
 *
 * @example admin: boolean()
 * @example verified: boolean().default()
 */
export function boolean<T extends Out<'boolean'> = Out<'boolean'>>() {
	return new Column<DataType<'boolean'>, T>({
		dataType: new DataType('boolean'),
		site: captureCallSite(boolean),
	});
}

/**
 * A `text` column: a string of any length, whose value is a `string`. `T`
 * narrows it, e.g. to a union of literals for a column checked against a
 * fixed set of values.
 *
 * It is ordered by its collation, admits pattern matching (`like`, `ilike`,
 * the POSIX regular expression operators and `^@`), and compares with
 * `varchar`, so the two can be mixed in a comparison.
 *
 * @example name: text()
 * @example email: text().nullable()
 * @example role: text<'admin' | 'member'>()
 */
export function text<T extends Out<'text'> = Out<'text'>>() {
	return new Column<DataType<'text'>, T>({
		dataType: new DataType('text'),
		site: captureCallSite(text),
	});
}

/**
 * A `varchar` column, whose value is a `string`. `T` narrows it.
 *
 * Postgres treats a `varchar` without a length limit like `text`. A limit is
 * checked by `db.verify` only; values aren't. It admits the same operators as
 * `text()` and compares with it, so the two can be mixed in a comparison.
 *
 * @example nickname: varchar(32)
 * @example code: varchar<'US' | 'CA'>()
 */
export function varchar<T extends Out<'varchar'> = Out<'varchar'>>(
	length?: number,
) {
	return new Column<DataType<'varchar'>, T>({
		dataType: new DataType('varchar', { modifiers: modifiers(length) }),
		site: captureCallSite(varchar),
	});
}

/**
 * A `uuid` column, whose value is a `string` in the hyphenated form, e.g.
 * `'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'`. `T` narrows it, e.g. to a branded
 * id.
 *
 * It admits equality only. Its values are strings, but a `text` expression is
 * still rejected on the other side of a comparison, since postgres won't
 * compare the two without a cast.
 *
 * @example token: uuid()
 * @example id: uuid<UserId>().default()
 */
export function uuid<T extends Out<'uuid'> = Out<'uuid'>>() {
	return new Column<DataType<'uuid'>, T>({
		dataType: new DataType('uuid'),
		site: captureCallSite(uuid),
	});
}

/**
 * A `bytea` column: binary data. A value written may be any `Uint8Array`
 * (a Node `Buffer` is one); what is read is always a plain `Uint8Array`,
 * never a `Buffer`, so the type isn't narrowed. It is sent and read in
 * binary.
 *
 * It admits equality only, which compares the bytes.
 *
 * @example avatar: bytea().nullable()
 * @example hash: bytea()
 */
export function bytea() {
	return new Column<DataType<'bytea'>, Out<'bytea'>>({
		dataType: new DataType('bytea'),
		site: captureCallSite(bytea),
	});
}

/**
 * A `date` column: a calendar day, whose value is a `string` such as
 * `'2024-01-31'`. It is a string because a `Date` would add a time of day and
 * a time zone the value doesn't have. `T` narrows it.
 *
 * It is ordered, and compares with `timestamp` and `timestamptz`.
 *
 * @example birthday: date().nullable()
 * @example dueOn: date().name('due_on')
 */
export function date<T extends Out<'date'> = Out<'date'>>() {
	return new Column<DataType<'date'>, T>({
		dataType: new DataType('date'),
		site: captureCallSite(date),
	});
}

/**
 * A `time` column: a time of day without a date or time zone, whose value is
 * a `string` such as `'13:45:00'`. `T` narrows it.
 *
 * It is ordered, but compares only with other `time` values.
 *
 * @example opensAt: time().name('opens_at')
 */
export function time<T extends Out<'time'> = Out<'time'>>() {
	return new Column<DataType<'time'>, T>({
		dataType: new DataType('time'),
		site: captureCallSite(time),
	});
}

/**
 * A `timestamp` column: a date and time without a time zone, whose value is a
 * `string` such as `'2024-01-31 13:45:00'`. It is a string because a `Date`
 * is an instant, and reading the value as one would have to assume a time
 * zone it doesn't record. `T` narrows it.
 *
 * Use `timestamptz()` for instants. It is ordered, and compares with `date`
 * and `timestamptz`.
 *
 * @example scheduledFor: timestamp().name('scheduled_for')
 */
export function timestamp<T extends Out<'timestamp'> = Out<'timestamp'>>() {
	return new Column<DataType<'timestamp'>, T>({
		dataType: new DataType('timestamp'),
		site: captureCallSite(timestamp),
	});
}

/**
 * A `timestamptz` column: an instant in time, whose value is a `Date`. `T`
 * narrows it.
 *
 * Postgres stores the instant in UTC and converts on the way in and out, so
 * the value doesn't depend on the session's time zone. It is ordered, and
 * compares with `date` and `timestamp`.
 *
 * @example createdAt: timestamptz().name('created_at').default()
 * @example deletedAt: timestamptz().name('deleted_at').nullable()
 */
export function timestamptz<
	T extends Out<'timestamptz'> = Out<'timestamptz'>,
>() {
	return new Column<DataType<'timestamptz'>, T>({
		dataType: new DataType('timestamptz'),
		site: captureCallSite(timestamptz),
	});
}

/**
 * An `interval` column: a span of time, whose value is a `string` in postgres
 * syntax, e.g. `'1 day 02:00:00'`. `T` narrows it.
 *
 * It is ordered, but compares only with other `interval` values.
 *
 * @example duration: interval()
 * @example retention: interval().default()
 */
export function interval<T extends Out<'interval'> = Out<'interval'>>() {
	return new Column<DataType<'interval'>, T>({
		dataType: new DataType('interval'),
		site: captureCallSite(interval),
	});
}

/**
 * A `jsonb` column: a JSON document, whose value is any JSON value
 * (`JsonValue`, JSON `null` included: a column can hold it) unless `T`
 * gives its shape. `T` is trusted, not checked against what the database
 * holds.
 *
 * Values are always sent as JSON text, so a top-level array or string is
 * stored as JSON rather than as a postgres array or bare text. `null` is SQL
 * `NULL`, not the JSON value `null`, so a column that may be empty needs
 * `nullable()`.
 *
 * It admits equality and containment (`@>`, `<@`) against another JSON
 * value. Reading a field or path and testing keys or jsonpaths, whose
 * operands are text, are `eb.json` functions instead.
 *
 * @example data: jsonb()
 * @example settings: jsonb<{ theme: string }>()
 * @example profile: jsonb<{ address: { city: string } }>().nullable()
 */
export function jsonb(): Column<DataType<'jsonb'>, Out<'jsonb'>>;
export function jsonb<T>(): Column<DataType<'jsonb'>, T>;
// an overload without a type parameter, so where a column is expected the
// value type isn't inferred from there, and an untyped one is a JsonValue
export function jsonb<T>() {
	return new Column<DataType<'jsonb'>, T>({
		dataType: new DataType('jsonb'),
		site: captureCallSite(jsonb),
	});
}

/**
 * An `inet` column: an IPv4 or IPv6 host address, optionally with a subnet,
 * whose value is a `string` such as `'192.168.0.1'` or `'10.0.0.0/8'`. `T`
 * narrows it.
 *
 * It is ordered, and admits the network containment operators: `<<` and
 * `<<=` for "is a subnet of", `>>` and `>>=` for "contains", and `&&` for
 * either containing the other.
 *
 * @example ip: inet()
 * @example lastSeenFrom: inet().name('last_seen_from').nullable()
 */
export function inet<T extends Out<'inet'> = Out<'inet'>>() {
	return new Column<DataType<'inet'>, T>({
		dataType: new DataType('inet'),
		site: captureCallSite(inet),
	});
}

/**
 * A `tsvector` column: a document prepared for full text search, whose value
 * is a `string` in tsvector syntax, e.g. `"'fat':2 'rat':3"`. `T` narrows it.
 *
 * It admits only `@@`, which matches it against a tsquery given as a string
 * such as `'fat & rat'`, besides the null checks. It is usually generated
 * from other columns.
 *
 * @example search: tsvector().generated()
 */
export function tsvector<T extends Out<'tsvector'> = Out<'tsvector'>>() {
	return new Column<DataType<'tsvector'>, T>({
		dataType: new DataType('tsvector'),
		site: captureCallSite(tsvector),
	});
}

/**
 * A `daterange` column: a range of calendar days, whose value is a
 * `Range<string>` with bounds such as `'2024-01-31'`, or `{ empty: true }`
 * for the empty range. `T` narrows it.
 *
 * A range is sent as its literal, e.g. `["2024-01-01","2024-02-01")`, and an
 * unbounded side is a `null` bound. Postgres canonicalises a `daterange` to
 * `[)` bounds, so that is what arrives whatever was written.
 *
 * It admits equality and the range operators; `@>` also takes a single date,
 * to test whether the range contains it.
 *
 * @example vacation: daterange().nullable()
 * @example season: daterange()
 */
export function daterange<T extends Out<'daterange'> = Out<'daterange'>>() {
	return new Column<DataType<'daterange'>, T>({
		dataType: new DataType('daterange'),
		site: captureCallSite(daterange),
	});
}

/**
 * A `tstzrange` column: a range of instants, whose value is a `Range<Date>`,
 * or `{ empty: true }` for the empty range. `T` narrows it.
 *
 * A range is sent as its literal, each bound as a timestamp in UTC (years
 * past 9999 and BC included), and an unbounded side is a `null` bound. It keeps the bounds it was written with.
 *
 * It admits equality and the range operators; `@>` also takes a single
 * `Date`, or a `date`, `timestamp` or `timestamptz` expression, to test
 * whether the range contains it.
 *
 * @example active: tstzrange()
 * @example history: array(tstzrange())
 */
export function tstzrange<T extends Out<'tstzrange'> = Out<'tstzrange'>>() {
	return new Column<DataType<'tstzrange'>, T>({
		dataType: new DataType('tstzrange'),
		site: captureCallSite(tstzrange),
	});
}

/**
 * A `vector` column from the pgvector extension, which must be installed in
 * the database, whose value is a `number[]`. `T` narrows it.
 *
 * Values are sent in pgvector's syntax, e.g. `[1,2.5,3]`, rather than as a
 * postgres array. It admits the null checks and pgvector's distances:
 * `l2Distance` (`<->`), `cosineDistance` (`<=>`) and `innerProduct`
 * (`<#>`), each a `double precision`.
 *
 * @example embedding: vector()
 * @example embedding: vector().nullable()
 */
export function vector<T extends Out<'vector'> = Out<'vector'>>() {
	return new Column<DataType<'vector'>, T>({
		dataType: new DataType('vector'),
		site: captureCallSite(vector),
	});
}

/**
 * An array of `element`: `array(text())` is a `text[]` column whose value is
 * `string[]`. Elements are encoded by the element type and typed by the
 * element column, so `array(text().nullable())` holds `(string | null)[]`.
 * Modifiers on the result apply to the array column.
 *
 * The element is a fresh or nullable column: a default, a generated value,
 * an identity or a name belongs to the array column, not its elements, and a
 * name given to the element is ignored.
 *
 * Only one dimension is modelled, so the element can't itself be an array.
 * Postgres treats `integer[][]` as the same type as `integer[]`, with a
 * rectangularity rule TypeScript cannot express, and `any` / `all` compare
 * against the base element rather than a row.
 *
 * @example tags: array(text())
 * @example scores: array(integer().nullable())
 * @example labels: array(text()).name('label_list').nullable()
 */
export function array<D extends DataType<Exclude<Kind, 'array'>>, T>(
	element:
		| Column<D, T, unknown, unknown>
		| IntegerColumn<D, T, unknown, unknown>,
) {
	return new Column<ArrayType<D>, T[]>({
		dataType: new ArrayType(element._quarry.dataType),
		site: captureCallSite(array),
	});
}

/** The type modifiers given, up to the first one left out. */
function modifiers(...values: (number | undefined)[]) {
	const given: number[] = [];
	for (const value of values) {
		if (value === undefined) break;
		given.push(value);
	}
	return given.length > 0 ? given : undefined;
}
