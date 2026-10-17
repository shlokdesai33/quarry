import type { CallSite } from '../call-site.js';
import { passThrough, type Codec } from '../driver/codec.js';
import { DataType } from './data-type.js';

/** The codec of an enum: text both ways, its OID looked up by name, so parameters declare it. */
function enumCodec(name: string): Codec<string> {
	return Object.freeze<Codec<string>>({
		name,
		oid: 0,
		paramFormat: 'text',
		resultFormat: 'text',
		encode: (value) => value,
		decodeText: passThrough,
	});
}

/**
 * A postgres enum type, declared once with `defineEnum` and shared by every
 * column that uses it. `N` is its name: each enum is its own SQL type, which
 * postgres compares with no other.
 */
export class EnumType<N extends string = string> extends DataType<'enum'> {
	/**
	 * The name of the postgres enum type, as declared in `create type ... as
	 * enum (...)`.
	 *
	 * @example 'user_status'
	 */
	readonly enumName: N;

	/**
	 * The members of the enum, in declaration order.
	 *
	 * @example ['active', 'inactive']
	 */
	readonly values: readonly string[];

	/** Where `defineEnum` was called, for `db.verify`. */
	readonly site: CallSite | undefined;

	constructor(enumName: N, values: readonly string[], site?: CallSite) {
		super('enum', { codec: enumCodec(enumName) });
		this.enumName = enumName;
		this.values = values;
		this.site = site;
	}
}
