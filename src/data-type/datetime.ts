import type { ComparableOperators } from '../operators.js';
import { DataType } from './data-type.js';

export class DateType extends DataType {
	declare readonly $kind: 'date';
	declare readonly $native: string;
	declare readonly $operators: ComparableOperators<this['$value']>;
}

export class TimeType extends DataType {
	declare readonly $kind: 'time';
	declare readonly $native: string;
	declare readonly $operators: ComparableOperators<this['$value']>;
}

export class TimestampType extends DataType {
	declare readonly $kind: 'timestamp';
	declare readonly $native: string;
	declare readonly $operators: ComparableOperators<this['$value']>;
}

export class TimestampTzType extends DataType {
	declare readonly $kind: 'timestamptz';
	declare readonly $native: Date;
	declare readonly $operators: ComparableOperators<this['$value']>;
}

export class IntervalType extends DataType {
	declare readonly $kind: 'interval';
	declare readonly $native: string;
	declare readonly $operators: ComparableOperators<this['$value']>;
}
