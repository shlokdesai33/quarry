import type { Codec } from '../driver/codec.js';
import { kindCodec } from '../kind-codecs.js';
import type { Kind } from '../operators.js';

/** What a data type is constructed from, besides its kind. */
type Options = {
	/** How values are sent and read; the kind's built-in codec by default. */
	readonly codec?: Codec | undefined;
	/**
	 * The type modifiers, e.g. `[255]` for `varchar(255)` or `[10, 2]` for
	 * `numeric(10, 2)`.
	 */
	readonly modifiers?: readonly number[] | undefined;
};

/**
 * A SQL type of kind `K`: the codec its values are sent and read with, and,
 * through `MethodsByKind`, the comparisons they admit. Columns and
 * expressions of the type share it, so a value is encoded the same way
 * whether it is compared against a column or against a computed expression,
 * and a selected column or expression is read with it.
 *
 * It says nothing about the TypeScript type of its values, which lives on
 * the column or expression instead (derived from the codec by the column
 * factories): `text`, `text null` and `text` narrowed to a union of
 * literals are all the same SQL type.
 *
 * Instances are immutable.
 */
export class DataType<K extends Kind = Kind> {
	/**
	 * The name of the SQL type, which keys its methods in `MethodsByKind`.
	 * It also keeps types that admit the same comparisons, such as `integer`
	 * and `real`, distinct.
	 */
	readonly kind: K;

	/**
	 * The type modifiers, e.g. `[255]` for `varchar(255)`, or `undefined`
	 * when none were given and the column takes any. Only `db.verify` reads
	 * them; values aren't checked against them.
	 */
	readonly modifiers: readonly number[] | undefined;

	/**
	 * The driver codec values of the type are sent and read with: chosen
	 * here, owned by the driver.
	 */
	readonly codec: Codec;

	/**
	 * Creates a data type of the given kind.
	 *
	 * @param kind the name of the SQL type.
	 * @param options its codec, if not the kind's, and its modifiers.
	 */
	constructor(kind: K, options: Options = {}) {
		this.kind = kind;
		this.modifiers = options.modifiers;
		this.codec = options.codec ?? kindCodec(kind);
	}

	/** The same type, read and sent with `codec`. */
	withCodec(codec: Codec): this {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a copy of this instance, of its class
		const copy = Object.create(Object.getPrototypeOf(this)) as this;
		return Object.freeze(Object.assign(copy, this, { codec }));
	}
}
