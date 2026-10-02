import { Column } from './column/column.js';
import { IntegerColumn } from './column/integer-column.js';
import { ArrayType } from './data-type/array.js';
import { DataType } from './data-type/data-type.js';
import type { Kind } from './operators.js';
import { JsonbType } from './data-type/jsonb.js';
import { DateRangeType, TstzRangeType } from './data-type/range.js';
import { VectorType } from './data-type/vector.js';
import type { Range } from './range.js';

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
export function smallint<T extends number>() {
	return new IntegerColumn<DataType<'smallint'>, T>({
		dataType: new DataType('smallint'),
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
export function integer<T extends number>() {
	return new IntegerColumn<DataType<'integer'>, T>({
		dataType: new DataType('integer'),
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
 * accepted on the other side of a comparison.
 *
 * @example views: bigint()
 * @example id: bigint<OrderId>().identity()
 */
export function bigint<T extends string>() {
	return new IntegerColumn<DataType<'bigint'>, T>({
		dataType: new DataType('bigint'),
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
export function real<T extends number>() {
	return new Column<DataType<'real'>, T>({
		dataType: new DataType('real'),
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
export function doublePrecision<T extends number>() {
	return new Column<DataType<'double precision'>, T>({
		dataType: new DataType('double precision'),
	});
}

/**
 * A `decimal` column: an exact number with arbitrary precision, whose value
 * is a `string`. It arrives as a string so no digits are lost, which a
 * JavaScript number would do, and values are written as strings for the same
 * reason. `T` narrows it.
 *
 * Precision and scale aren't modelled; the column holds any number of digits
 * on either side of the decimal point. It is ordered, and compares with every
 * other numeric type.
 *
 * @example price: decimal()
 * @example balance: decimal().default()
 */
export function decimal<T extends string>() {
	return new Column<DataType<'decimal'>, T>({
		dataType: new DataType('decimal'),
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
export function boolean<T extends boolean>() {
	return new Column<DataType<'boolean'>, T>({
		dataType: new DataType('boolean'),
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
export function text<T extends string>() {
	return new Column<DataType<'text'>, T>({
		dataType: new DataType('text'),
	});
}

/**
 * A `varchar` column, whose value is a `string`. `T` narrows it.
 *
 * A length limit isn't modelled, and postgres treats a `varchar` without one
 * like `text`. It admits the same operators as `text()` and compares with it,
 * so the two can be mixed in a comparison.
 *
 * @example nickname: varchar()
 * @example code: varchar<'US' | 'CA'>()
 */
export function varchar<T extends string>() {
	return new Column<DataType<'varchar'>, T>({
		dataType: new DataType('varchar'),
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
export function uuid<T extends string>() {
	return new Column<DataType<'uuid'>, T>({
		dataType: new DataType('uuid'),
	});
}

/**
 * A `bytea` column: binary data, whose value is a `Uint8Array` (a Node
 * `Buffer` is one). `T` narrows it.
 *
 * It admits equality only, which compares the bytes.
 *
 * @example avatar: bytea().nullable()
 * @example hash: bytea()
 */
export function bytea<T extends Uint8Array>() {
	return new Column<DataType<'bytea'>, T>({
		dataType: new DataType('bytea'),
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
export function date<T extends string>() {
	return new Column<DataType<'date'>, T>({
		dataType: new DataType('date'),
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
export function time<T extends string>() {
	return new Column<DataType<'time'>, T>({
		dataType: new DataType('time'),
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
export function timestamp<T extends string>() {
	return new Column<DataType<'timestamp'>, T>({
		dataType: new DataType('timestamp'),
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
export function timestamptz<T extends Date>() {
	return new Column<DataType<'timestamptz'>, T>({
		dataType: new DataType('timestamptz'),
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
export function interval<T extends string>() {
	return new Column<DataType<'interval'>, T>({
		dataType: new DataType('interval'),
	});
}

/**
 * A `jsonb` column: a JSON document, whose value is any non-null JSON value
 * unless `T` gives its shape. `T` is trusted, not checked against what the
 * database holds.
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
export function jsonb<T extends NonNullable<unknown>>() {
	return new Column<JsonbType, T>({
		dataType: new JsonbType(),
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
export function inet<T extends string>() {
	return new Column<DataType<'inet'>, T>({
		dataType: new DataType('inet'),
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
export function tsvector<T extends string>() {
	return new Column<DataType<'tsvector'>, T>({
		dataType: new DataType('tsvector'),
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
export function daterange<T extends Range<string>>() {
	return new Column<DateRangeType, T>({
		dataType: new DateRangeType(),
	});
}

/**
 * A `tstzrange` column: a range of instants, whose value is a `Range<Date>`,
 * or `{ empty: true }` for the empty range. `T` narrows it.
 *
 * A range is sent as its literal, with each bound in ISO 8601 form, and an
 * unbounded side is a `null` bound. It keeps the bounds it was written with.
 *
 * It admits equality and the range operators; `@>` also takes a single
 * `Date`, or a `date`, `timestamp` or `timestamptz` expression, to test
 * whether the range contains it.
 *
 * @example active: tstzrange()
 * @example history: array(tstzrange())
 */
export function tstzrange<T extends Range<Date>>() {
	return new Column<TstzRangeType, T>({
		dataType: new TstzRangeType(),
	});
}

/**
 * A `vector` column from the pgvector extension, which must be installed in
 * the database, whose value is a `number[]`. `T` narrows it.
 *
 * Values are sent in pgvector's syntax, e.g. `[1,2.5,3]`, rather than as a
 * postgres array. The number of dimensions isn't modelled, and neither are
 * the distance operators, so it admits only the null checks.
 *
 * @example embedding: vector()
 * @example embedding: vector().nullable()
 */
export function vector<T extends number[]>() {
	return new Column<VectorType, T>({
		dataType: new VectorType(),
	});
}

/**
 * An array of `element`: `array(text())` is a `text[]` column whose value is
 * `string[]`. Elements are encoded by the element type and typed by the
 * element column, so `array(text().nullable())` holds `(string | null)[]`.
 * Modifiers on the result apply to the array column. A name given to the
 * element carries over.
 *
 * The element is a fresh or nullable column: a default, a generated value or
 * an identity belongs to the array column, not its elements.
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
export function array<D extends DataType<Exclude<Kind, 'array'>>, S>(
	element: Column<D, S, unknown, unknown>,
) {
	return new Column<ArrayType<D>, S[]>({
		dataType: new ArrayType(element.dataType),
		columnName: element.columnName,
	});
}
