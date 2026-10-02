import { DataType } from './data-type.js';

/**
 * jsonb is always serialised: the driver would otherwise send a top-level
 * array as a postgres array and a string unquoted, neither of which is valid
 * jsonb. `null` is SQL `NULL`, not the JSON value `null`, as it is when the
 * driver reads either back.
 *
 * Every jsonb operator in the comparison table takes jsonb. The key and path
 * operators (`?`, `?|`, `?&`, `@?`, `@@`), whose operands are text, are
 * `eb.json` functions instead.
 */
export class JsonbType extends DataType<'jsonb'> {
	constructor() {
		super('jsonb');
	}

	override serialize(value: unknown) {
		return value === null ? value : JSON.stringify(value);
	}
}
