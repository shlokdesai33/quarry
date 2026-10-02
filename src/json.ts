import type { ArrayType } from './data-type/array.js';
import { DataType } from './data-type/data-type.js';
import { JsonbType } from './data-type/jsonb.js';
import { Expression, type Param, TypedExpression } from './expression.js';
import type { Scope } from './functions.js';
import type { OperationNode } from './node.js';
import type { JsonValue, TextKind } from './operators.js';
import type { NullOf, Operand, Refs, TypeOf } from './refs.js';

type Jsonb = DataType<'jsonb'>;

/** Any character type. */
type Text = DataType<TextKind>;

/** An object key, or an array index (negative counts from the end). */
type Key = string | number;

type Primitive = string | number | boolean | null | undefined;

/**
 * The keys a jsonb value of type `T` has: an object's own, an array's
 * indices, or any key when `T` says nothing (an untyped `jsonb()`).
 */
type KeyOf<T> = T extends Primitive
	? never
	: T extends readonly unknown[]
		? number
		: [keyof T] extends [never]
			? Key
			: keyof T & string;

/** The value at key `K` of a jsonb value of type `T`. */
type Member<T, K> = T extends Primitive
	? never
	: T extends readonly (infer E)[]
		? K extends number
			? E
			: never
		: [keyof T] extends [never]
			? JsonValue
			: K extends keyof T
				? T[K]
				: never;

/** The keys `P` may hold, each checked against the value the ones before reach. */
type PathIn<T, P> = P extends readonly [infer K, ...infer Rest]
	? readonly [KeyOf<T>, ...PathIn<Member<T, K>, Rest>]
	: readonly [];

/** The value at path `P` of a jsonb value of type `T`. */
type At<T, P> = P extends readonly [infer K, ...infer Rest]
	? At<Member<T, K>, Rest>
	: T;

/** The non-null jsonb value an operand holds. */
type JsonOf<R extends Refs, A> = NonNullable<TypeOf<R, A>>;

/** `null` if an argument can be. */
type NullIn<V> = V extends Expression<infer T> ? NullOf<T> : never;

/** A boolean result, nullable when `N` is `null`. */
type Predicate<N> = TypedExpression<boolean | N, DataType<'boolean'>>;

/** What `jsonb_typeof` returns. */
type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

/**
 * The jsonb functions available in scope `R`: reading a field or path, and
 * testing keys and jsonpaths. Each takes a jsonb column or expression first.
 *
 * Reading yields an expression, so it compares like any other: with `text`'s
 * operators, or with jsonb's, whose values are encoded as jsonb. The key and
 * path tests are predicates, for `where(predicate)` and `eb.and`.
 */
export interface JsonFunctions<R extends Refs> {
	/**
	 * `json -> key -> ...`: the jsonb value at the path, null where it is
	 * missing. Each key is an object key or an array index, checked against
	 * the column's type. Keys are written into the SQL, so an expression index
	 * on the same `->` chain applies.
	 *
	 * @example eb.json.get('users.settings', 'theme')
	 * @example eb(eb.json.get('users.settings', 'prefs'), '@>', { beta: true })
	 */
	get<A extends Operand<R, Jsonb>, const P extends readonly [Key, ...Key[]]>(
		json: A,
		...path: P & PathIn<JsonOf<R, A>, P>
	): TypedExpression<Exclude<At<JsonOf<R, A>, P>, undefined> | null, JsonbType>;

	/**
	 * `json -> ... ->> key`: the value at the path as text, null where it is
	 * missing (or is JSON `null`). Cast it to compare as a number or a date.
	 *
	 * @example eb(eb.json.text('users.settings', 'theme'), '=', 'dark')
	 * @example eb.fn.cast(eb.json.text('users.settings', 'age'), 'integer')
	 */
	text<A extends Operand<R, Jsonb>, const P extends readonly [Key, ...Key[]]>(
		json: A,
		...path: P & PathIn<JsonOf<R, A>, P>
	): TypedExpression<string | null, DataType<'text'>>;

	/**
	 * `json ? key`: the key is a top-level key (or, for an array, a string
	 * element).
	 *
	 * @example eb.json.hasKey('users.settings', 'theme')
	 */
	hasKey<
		A extends Operand<R, Jsonb>,
		K extends string | Param<string> | TypedExpression<string | null, Text>,
	>(
		json: A,
		key: K,
	): Predicate<NullOf<TypeOf<R, A>> | NullIn<K>>;

	/**
	 * `json ?| keys`: any of the keys is a top-level key.
	 *
	 * @example eb.json.hasAnyKey('users.settings', ['theme', 'lang'])
	 */
	hasAnyKey<A extends Operand<R, Jsonb>, K extends Keys>(
		json: A,
		keys: K,
	): Predicate<NullOf<TypeOf<R, A>> | NullIn<K>>;

	/**
	 * `json ?& keys`: all of the keys are top-level keys.
	 *
	 * @example eb.json.hasAllKeys('users.settings', ['theme', 'lang'])
	 */
	hasAllKeys<A extends Operand<R, Jsonb>, K extends Keys>(
		json: A,
		keys: K,
	): Predicate<NullOf<TypeOf<R, A>> | NullIn<K>>;

	/**
	 * `json @? path`: the jsonpath yields at least one item.
	 *
	 * @example eb.json.pathExists('users.settings', '$.tags[*] ? (@ == "a")')
	 */
	pathExists<A extends Operand<R, Jsonb>>(
		json: A,
		path: string | Param<string>,
	): Predicate<NullOf<TypeOf<R, A>>>;

	/**
	 * `json @@ path`: the jsonpath predicate is true (null if it yields no
	 * boolean).
	 *
	 * @example eb.json.pathMatches('users.settings', '$.price > 10')
	 */
	pathMatches<A extends Operand<R, Jsonb>>(
		json: A,
		path: string | Param<string>,
	): Predicate<NullOf<TypeOf<R, A>> | null>;

	/** `jsonb_typeof(json)`: the kind of JSON value. */
	typeOf<A extends Operand<R, Jsonb>>(
		json: A,
	): TypedExpression<JsonType | NullOf<TypeOf<R, A>>, DataType<'text'>>;

	/** `jsonb_array_length(json)`: the number of elements; an error unless an array. */
	length<A extends Operand<R, Jsonb>>(
		json: A,
	): TypedExpression<number | NullOf<TypeOf<R, A>>, DataType<'integer'>>;
}

/** A list of keys: values, a parameter, or a text array expression. */
type Keys =
	| readonly string[]
	| Param<readonly string[]>
	| TypedExpression<readonly string[] | null, ArrayType<Text>>;

/** `JsonFunctions` supplies the types, so this returns the bottom type. */
function result(node: OperationNode, dataType: DataType): never {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the signature supplies the type
	return new TypedExpression(node, dataType) as never;
}

function key(value: Key): OperationNode {
	if (typeof value === 'number' && !Number.isInteger(value)) {
		throw new Error(`A jsonb array index must be an integer, not ${value}`);
	}
	return { kind: 'literal', value };
}

/** A key or path operand: values and parameters are sent as is, as text. */
function operand(value: unknown): OperationNode {
	return Expression.is(value) ? value.toNode() : { kind: 'value', value };
}

export function jsonFunctions<R extends Refs>({
	node,
}: Scope<R>): JsonFunctions<R> {
	const walk =
		(last: '->' | '->>', type: DataType) =>
		(json: Operand<R, Jsonb>, ...path: readonly Key[]) =>
			result(
				path.reduce<OperationNode>(
					(left, step, i) => ({
						kind: 'binary',
						left,
						operator: i === path.length - 1 ? last : '->',
						right: key(step),
					}),
					node(json),
				),
				type,
			);

	const test =
		(operator: string) => (json: Operand<R, Jsonb>, right: unknown) =>
			result(
				{ kind: 'binary', left: node(json), operator, right: operand(right) },
				new DataType('boolean'),
			);

	const call = (name: string, type: DataType) => (json: Operand<R, Jsonb>) =>
		result({ kind: 'function', name, args: [node(json)] }, type);

	return {
		get: walk('->', new JsonbType()),
		text: walk('->>', new DataType('text')),
		hasKey: test('?'),
		hasAnyKey: test('?|'),
		hasAllKeys: test('?&'),
		pathExists: test('@?'),
		pathMatches: test('@@'),
		typeOf: call('jsonb_typeof', new DataType('text')),
		length: call('jsonb_array_length', new DataType('integer')),
	};
}
