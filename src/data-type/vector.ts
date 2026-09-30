import type { NullOperators } from '../operators.js';
import { DataType } from './data-type.js';

export class VectorType extends DataType {
	declare readonly $kind: 'vector';
	declare readonly $native: number[];
	declare readonly $operators: NullOperators;

	/**
	 * pgvector's input syntax is `[1,2,3]`; left as an array the driver would
	 * send a postgres array (`{1,2,3}`) instead.
	 */
	override encode(value: unknown) {
		return Array.isArray(value) ? JSON.stringify(value) : value;
	}
}
