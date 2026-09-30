import {
	DateType,
	IntervalType,
	TimestampType,
	TimestampTzType,
	TimeType,
} from './data-type/datetime.js';

import {
	BigIntType,
	DecimalType,
	DoublePrecisionType,
	IntegerType,
	RealType,
	SmallIntType,
} from './data-type/numeric.js';

import { Column } from './column/column.js';
import { IntegerColumn } from './column/integer-column.js';
import { ByteaType } from './data-type/bytea.js';
import { BooleanType } from './data-type/boolean.js';
import { TextType, VarcharType } from './data-type/character.js';
import { JsonbType } from './data-type/jsonb.js';
import { InetType } from './data-type/inet.js';
import { DateRangeType, TstzRangeType } from './data-type/range.js';
import { TsVectorType } from './data-type/tsvector.js';
import { UUIDType } from './data-type/uuid.js';
import { VectorType } from './data-type/vector.js';

export function smallint<T extends SmallIntType['$native']>(name?: string) {
	return new IntegerColumn<SmallIntType, T>({
		dataType: new SmallIntType(),
		name,
	});
}

export function integer<T extends IntegerType['$native']>(name?: string) {
	return new IntegerColumn<IntegerType, T>({
		dataType: new IntegerType(),
		name,
	});
}

export function bigint<T extends BigIntType['$native']>(name?: string) {
	return new IntegerColumn<BigIntType, T>({
		dataType: new BigIntType(),
		name,
	});
}

export function real<T extends RealType['$native']>(name?: string) {
	return new Column<RealType, T>({
		dataType: new RealType(),
		name,
	});
}

export function doublePrecision<T extends DoublePrecisionType['$native']>(
	name?: string,
) {
	return new Column<DoublePrecisionType, T>({
		dataType: new DoublePrecisionType(),
		name,
	});
}

export function decimal<T extends DecimalType['$native']>(name?: string) {
	return new Column<DecimalType, T>({
		dataType: new DecimalType(),
		name,
	});
}

export function boolean<T extends BooleanType['$native']>(name?: string) {
	return new Column<BooleanType, T>({
		dataType: new BooleanType(),
		name,
	});
}

export function text<T extends TextType['$native']>(name?: string) {
	return new Column<TextType, T>({
		dataType: new TextType(),
		name,
	});
}

export function varchar<T extends VarcharType['$native']>(name?: string) {
	return new Column<VarcharType, T>({
		dataType: new VarcharType(),
		name,
	});
}

export function uuid<T extends UUIDType['$native']>(name?: string) {
	return new Column<UUIDType, T>({
		dataType: new UUIDType(),
		name,
	});
}

export function bytea<T extends ByteaType['$native']>(name?: string) {
	return new Column<ByteaType, T>({
		dataType: new ByteaType(),
		name,
	});
}

export function date<T extends DateType['$native']>(name?: string) {
	return new Column<DateType, T>({
		dataType: new DateType(),
		name,
	});
}

export function time<T extends TimeType['$native']>(name?: string) {
	return new Column<TimeType, T>({
		dataType: new TimeType(),
		name,
	});
}

export function timestamp<T extends TimestampType['$native']>(name?: string) {
	return new Column<TimestampType, T>({
		dataType: new TimestampType(),
		name,
	});
}

export function timestamptz<T extends TimestampTzType['$native']>(
	name?: string,
) {
	return new Column<TimestampTzType, T>({
		dataType: new TimestampTzType(),
		name,
	});
}

export function interval<T extends IntervalType['$native']>(name?: string) {
	return new Column<IntervalType, T>({
		dataType: new IntervalType(),
		name,
	});
}

export function jsonb<T extends JsonbType['$native']>(name?: string) {
	return new Column<JsonbType, T>({
		dataType: new JsonbType(),
		name,
	});
}

export function inet<T extends InetType['$native']>(name?: string) {
	return new Column<InetType, T>({
		dataType: new InetType(),
		name,
	});
}

export function tsvector<T extends TsVectorType['$native']>(name?: string) {
	return new Column<TsVectorType, T>({
		dataType: new TsVectorType(),
		name,
	});
}

export function daterange<T extends DateRangeType['$native']>(name?: string) {
	return new Column<DateRangeType, T>({
		dataType: new DateRangeType(),
		name,
	});
}

export function tstzrange<T extends TstzRangeType['$native']>(name?: string) {
	return new Column<TstzRangeType, T>({
		dataType: new TstzRangeType(),
		name,
	});
}

export function vector<T extends VectorType['$native']>(name?: string) {
	return new Column<VectorType, T>({
		dataType: new VectorType(),
		name,
	});
}
