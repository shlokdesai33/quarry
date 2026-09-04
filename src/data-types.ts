import { ArrayColumn } from './columns/array.js';
import { BigintColumn } from './columns/bigint.js';
import { BooleanColumn } from './columns/boolean.js';
import { ByteaColumn } from './columns/bytea.js';
import { DecimalColumn } from './columns/decimal.js';
import { DoublePrecisionColumn } from './columns/double-precision.js';
import { InetColumn } from './columns/inet.js';
import { IntegerColumn } from './columns/integer.js';
import { JsonbColumn } from './columns/jsonb.js';
import { OneOfColumn } from './columns/one-of.js';
import { RangeColumn } from './columns/range.js';
import { RealColumn } from './columns/real.js';
import { SmallintColumn } from './columns/smallint.js';
import { TemporalColumn } from './columns/temporal.js';
import { TextColumn } from './columns/text.js';
import { TsvectorColumn } from './columns/tsvector.js';
import { UUIDColumn } from './columns/uuid.js';

export function smallint<T extends number = number>() {
	return new SmallintColumn<T>();
}

export function integer<T extends number = number>() {
	return new IntegerColumn<T>();
}

export function bigint<T extends string = string>() {
	return new BigintColumn<T>();
}

export function real<T extends number = number>() {
	return new RealColumn<T>();
}

export function doublePrecision<T extends number = number>() {
	return new DoublePrecisionColumn<T>();
}

export function decimal<T extends string = string>() {
	return new DecimalColumn<T>();
}

export function boolean<T extends boolean = boolean>() {
	return new BooleanColumn<T>();
}

export function text<T extends string = string>() {
	return new TextColumn<T>('text');
}

export function varchar<T extends string = string>() {
	return new TextColumn<T>('varchar');
}

export function uuid<T extends string = string>() {
	return new UUIDColumn<T>();
}

export function bytea<T extends Uint8Array = Uint8Array>() {
	return new ByteaColumn<T>();
}

export function date<T extends Date = Date>() {
	return new TemporalColumn<T>('date');
}

export function time<T extends string = string>() {
	return new TemporalColumn<T>('time');
}

export function timestamp<T extends Date = Date>() {
	return new TemporalColumn<T>('timestamp');
}

export function timestamptz<T extends Date = Date>() {
	return new TemporalColumn<T>('timestamptz');
}

export function interval<T extends string = string>() {
	return new TemporalColumn<T>('interval');
}

export function jsonb<T extends NonNullable<unknown>>() {
	return new JsonbColumn<T>();
}

export function inet<T extends string = string>() {
	return new InetColumn<T>();
}

export function tsvector<T extends string = string>() {
	return new TsvectorColumn<T>();
}

export function daterange<T extends string = string>() {
	return new RangeColumn<T>('daterange');
}

export function tstzrange<T extends string = string>() {
	return new RangeColumn<T>('tstzrange');
}

export function oneOf<const T extends string>(values: readonly T[]) {
	return new OneOfColumn<T>(values);
}

export function array<T extends unknown[]>() {
	return new ArrayColumn<T>();
}
