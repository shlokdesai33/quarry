import type { TsvectorOperators } from '../operators.js';
import { DataType } from './data-type.js';

export class TsVectorType extends DataType {
	declare readonly $kind: 'tsvector';
	declare readonly $native: string;
	declare readonly $operators: TsvectorOperators;
}
