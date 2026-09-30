import type { EqualityOperators } from '../operators.js';
import { DataType } from './data-type.js';

export class ByteaType extends DataType {
	declare readonly $kind: 'bytea';
	declare readonly $native: Uint8Array;
	declare readonly $operators: EqualityOperators<this['$value']>;
}
