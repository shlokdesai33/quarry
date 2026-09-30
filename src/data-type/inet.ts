import type { InetOperators } from '../operators.js';
import { DataType } from './data-type.js';

export class InetType extends DataType {
	declare readonly $kind: 'inet';
	declare readonly $native: string;
	declare readonly $operators: InetOperators<this['$value']>;
}
