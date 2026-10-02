import { DataType } from './data-type.js';

/**
 * pgvector's input syntax is `[1,2,3]`; left as an array the driver would
 * send a postgres array (`{1,2,3}`) instead.
 */
export class VectorType extends DataType<'vector'> {
	constructor() {
		super('vector');
	}

	override serialize(value: unknown) {
		return value === null ? value : JSON.stringify(value);
	}
}
