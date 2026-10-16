import { captureCallSite } from './call-site.js';
import { Column } from './column/column.js';
import { CustomType } from './data-type/custom.js';
import type { Codec } from './driver/codec.js';

/** What `defineType` takes: the type's name as DDL writes it, and its codec. */
export interface TypeDefinition<N extends string, In, Out> {
	/** The type's name as DDL writes it, e.g. `citext` or `app.positive_int`. */
	readonly sql: N;
	/**
	 * How its values are sent and read: a built-in codec (`codecs.text` for
	 * a text-like type, the base type's for a domain), or your own
	 * (`defineCodec`). Its input and output types are the columns'.
	 */
	readonly codec: Codec<In, Out>;
}

/**
 * Declares a SQL type quarry has no factory for (an extension's, a domain,
 * a type of your own) once, so it can back columns in any number of
 * tables. Returns a column factory like the other data types; `T` narrows
 * the codec's output. Its columns admit every operator, with values of the
 * type or expressions of the same type: postgres decides which apply.
 *
 * @example
 * const citext = defineType({ sql: 'citext', codec: codecs.text });
 * defineTable('users', { columns: { email: citext() } });
 *
 * @example
 * const money = defineType({ sql: 'money_cents', codec: codecs.int8 });
 */
export function defineType<const N extends string, In, Out>(
	definition: TypeDefinition<N, In, Out>,
) {
	const dataType = new CustomType(
		definition.sql,
		definition.codec,
		captureCallSite(defineType),
	);
	return function $defineType<T extends Out = Out>() {
		return new Column<CustomType<N>, T, [Out] extends [T] ? In : T>({
			dataType,
			site: captureCallSite($defineType),
		});
	};
}
