import type { TextOperators } from '../operators.js';
import { DataType } from './data-type.js';

export class TextType extends DataType {
	declare readonly $kind: 'text';
	declare readonly $native: string;
	declare readonly $operators: TextOperators<this['$value']>;
}

export class VarcharType extends DataType {
	declare readonly $kind: 'varchar';
	declare readonly $native: string;
	declare readonly $operators: TextOperators<this['$value']>;
}
