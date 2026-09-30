import type { BooleanOperators } from '../operators.js';
import { DataType } from './data-type.js';

/** Also the type of every comparison, so predicates can be compared. */
export class BooleanType extends DataType {
	declare readonly $kind: 'boolean';
	declare readonly $native: boolean;
	declare readonly $operators: BooleanOperators;
}
