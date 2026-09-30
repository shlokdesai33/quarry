import type { EqualityOperators } from '../operators.js';
import { DataType } from './data-type.js';

export class UUIDType extends DataType {
	declare readonly $kind: 'uuid';
	declare readonly $native: string;
	declare readonly $operators: EqualityOperators<this['$value']>;
}
