import type { JsonbOperators } from '../operators.js';
import { DataType } from './data-type.js';

export class JsonbType extends DataType {
	declare readonly $kind: 'jsonb';
	declare readonly $native: NonNullable<unknown>;
	declare readonly $operators: JsonbOperators<this['$value']>;

	/**
	 * Always serialised: the driver would otherwise send a top-level array as
	 * a postgres array and a string unquoted, neither of which is valid jsonb.
	 */
	override encode(value: unknown) {
		return value === null ? null : JSON.stringify(value);
	}

	/**
	 * The key and path operators take text, not json: `?` a key, `?|`/`?&` a
	 * text array, `@?`/`@@` a jsonpath.
	 */
	override encodeOperand(operator: string, value: unknown) {
		switch (operator) {
			case '?':
			case '?|':
			case '?&':
			case '@?':
			case '@@':
				return value;
			default:
				return this.encode(value);
		}
	}
}
