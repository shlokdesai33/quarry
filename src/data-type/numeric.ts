import type { ComparableOperators } from '../operators.js';
import { DataType } from './data-type.js';

export class SmallIntType extends DataType {
	declare readonly $kind: 'smallint';
	declare readonly $native: number;
	declare readonly $operators: ComparableOperators<this['$value']>;
}

export class IntegerType extends DataType {
	declare readonly $kind: 'integer';
	declare readonly $native: number;
	declare readonly $operators: ComparableOperators<this['$value']>;
}

/** Arrives as a string: its range exceeds that of a JavaScript number. */
export class BigIntType extends DataType {
	declare readonly $kind: 'bigint';
	declare readonly $native: string;
	declare readonly $operators: ComparableOperators<this['$value']>;
}

/** The types a column can be `generated always as identity` with. */
export type IdentityType = SmallIntType | IntegerType | BigIntType;

export class RealType extends DataType {
	declare readonly $kind: 'real';
	declare readonly $native: number;
	declare readonly $operators: ComparableOperators<this['$value']>;
}

export class DoublePrecisionType extends DataType {
	declare readonly $kind: 'double precision';
	declare readonly $native: number;
	declare readonly $operators: ComparableOperators<this['$value']>;
}

/** Arrives as a string, so no precision is lost. */
export class DecimalType extends DataType {
	declare readonly $kind: 'decimal';
	declare readonly $native: string;
	declare readonly $operators: ComparableOperators<this['$value']>;
}
