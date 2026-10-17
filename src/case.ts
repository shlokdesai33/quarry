import { DataType } from './data-type/data-type.js';
import { declareParamType } from './driver/codec.js';
import { Expression, Param, TypedExpression } from './expression.js';
import { typedExpression } from './expression-methods.js';
import type { CaseNode, OperationNode } from './node.js';
import type {
	AnyPredicate,
	Expr,
	Kind,
	NumberKind,
	TextKind,
	TimestampKind,
} from './operators.js';

/** A plain result value, typed by its JavaScript type. */
type Plain = string | number | boolean | bigint | Date;

/** The SQL type a plain value is sent as. */
type PlainType<X> = X extends string
	? DataType<'text'>
	: X extends number
		? DataType<'integer'>
		: X extends boolean
			? DataType<'boolean'>
			: X extends bigint
				? DataType<'bigint'>
				: X extends Date
					? DataType<'timestamptz'>
					: never;

/** A literal type widened to its primitive, for the values later branches take. */
type Widen<V> = V extends string
	? string
	: V extends number
		? number
		: V extends boolean
			? boolean
			: V;

/** The kinds postgres resolves a `case` of kind `K`'s results with. */
type Compatible<K extends Kind> = K extends TextKind
	? TextKind
	: K extends NumberKind
		? NumberKind
		: K extends TimestampKind
			? TimestampKind
			: K;

/**
 * What a result takes, once the results so far are of type `V` and SQL type
 * `D`: anything at first; then a value of their type, an expression of a
 * SQL type postgres resolves with theirs, or null.
 */
export type CaseResult<V, D extends DataType> = [D] extends [never]
	? Plain | null | Expression<unknown>
	:
			| Widen<NonNullable<V>>
			| null
			| Param<Widen<NonNullable<V>> | null>
			| TypedExpression<unknown, DataType<Compatible<D['kind']>>>;

/** The type a result `X` adds to the `case`'s. */
type TypeOfResult<X> = X extends Expression<infer T> ? T : X;

/** The SQL type a result `X` gives the `case`, when it is the first to. */
type DataTypeOfResult<X> =
	X extends TypedExpression<unknown, infer D extends DataType>
		? D
		: X extends Expression<infer T>
			? PlainType<NonNullable<T>>
			: PlainType<X>;

/** `D`, or the SQL type of `X` when `D` is still unknown. */
type Next<D extends DataType, X> = [D] extends [never]
	? DataTypeOfResult<X>
	: D;

/**
 * `case` before its first `when`, as `eb.case()` starts it: postgres needs
 * at least one.
 */
export interface CaseStart {
	/**
	 * `when condition then result`. A result is a value (`'large'`, `42`),
	 * an expression (`eb.ref('orders.total')`), or null; the first fixes the
	 * SQL type of the others.
	 */
	when<const X extends CaseResult<never, never>>(
		condition: AnyPredicate,
		result: X,
	): CaseWhen<TypeOfResult<X>, DataTypeOfResult<X>>;
}

/**
 * A `case` with its `when` branches so far, of results of type `V` and SQL
 * type `D`.
 */
export interface CaseWhen<V, D extends DataType> {
	/** `when condition then result`: another branch, tried in order. */
	when<const X extends CaseResult<V, D>>(
		condition: AnyPredicate,
		result: X,
	): CaseWhen<V | TypeOfResult<X>, Next<D, X>>;
	/** `else result`: the result when no branch matches. */
	else<const X extends CaseResult<V, D>>(
		result: X,
	): CaseElse<V | TypeOfResult<X>, Next<D, X>>;
	/** `end`, without an `else`: null when no branch matches. */
	end(): Expr<V | null, D>;
}

/** A `case` with its `else`. */
export interface CaseElse<V, D extends DataType> {
	/** `end`: the `case` as an expression. */
	end(): Expr<V, D>;
}

/** A branch as given: its condition's node and its result, not yet encoded. */
interface Branch {
	readonly when: OperationNode;
	readonly then: unknown;
}

/** The SQL type a plain value is sent as, by its JavaScript type. */
function plainKind(value: unknown): Kind | undefined {
	switch (typeof value) {
		case 'string':
			return 'text';
		case 'number':
			return Number.isInteger(value) && Math.abs(value) <= 2147483647
				? 'integer'
				: 'double precision';
		case 'boolean':
			return 'boolean';
		case 'bigint':
			return 'bigint';
		default:
			return value instanceof Date ? 'timestamptz' : undefined;
	}
}

/**
 * The SQL type of a `case` with these results: the first expression's of
 * known type, otherwise the plain values' (an `integer` once a number is
 * fractional is a `double precision`).
 */
function caseType(results: readonly unknown[]): DataType {
	for (const result of results) {
		if (result instanceof TypedExpression) return result._quarry.dataType;
	}
	const kinds = new Set<Kind>();
	for (const result of results) {
		const value = result instanceof Param ? result._quarry.value : result;
		const kind = plainKind(value);
		if (kind !== undefined) kinds.add(kind);
	}
	if (kinds.has('integer') && kinds.has('double precision'))
		kinds.delete('integer');
	const [kind, ...others] = kinds;
	if (kind === undefined) {
		throw new Error(
			'A case needs a result whose type is known: a value or an expression of known type, not only nulls',
		);
	}
	if (others.length > 0) {
		throw new Error(
			`The results of a case have different types: ${[kind, ...others].join(', ')}`,
		);
	}
	return new DataType(kind);
}

/** A result's node: an expression as is, a value sent as `type`. */
function resultNode(result: unknown, type: DataType): OperationNode {
	if (result === undefined) {
		throw new TypeError(
			'A case result is undefined; for SQL NULL, pass null',
		);
	}
	const codec = declareParamType(type.codec);
	if (result instanceof Param) {
		return {
			kind: 'value',
			value: result._quarry.value,
			codec: result._quarry.codec ?? codec,
		};
	}
	return Expression.is(result)
		? result._quarry.node
		: { kind: 'value', value: result, codec };
}

/** The runtime of `CaseStart`, `CaseWhen` and `CaseElse`. Immutable. */
class CaseBuilder {
	readonly #branches: readonly Branch[];
	readonly #otherwise: { readonly result: unknown } | undefined;

	constructor(
		branches: readonly Branch[],
		otherwise: { readonly result: unknown } | undefined,
	) {
		this.#branches = branches;
		this.#otherwise = otherwise;
	}

	when(condition: AnyPredicate, result: unknown): CaseBuilder {
		return new CaseBuilder(
			[...this.#branches, { when: condition._quarry.node, then: result }],
			undefined,
		);
	}

	else(result: unknown): CaseBuilder {
		return new CaseBuilder(this.#branches, { result });
	}

	end(): unknown {
		const results = this.#branches.map((branch) => branch.then);
		if (this.#otherwise !== undefined) results.push(this.#otherwise.result);
		const type = caseType(results);
		const node: CaseNode = {
			kind: 'case',
			branches: this.#branches.map((branch) => ({
				when: branch.when,
				then: resultNode(branch.then, type),
			})),
			otherwise:
				this.#otherwise === undefined
					? undefined
					: resultNode(this.#otherwise.result, type),
		};
		return typedExpression(node, type);
	}
}

/** `case`, before its first `when`. */
export function caseOf(): CaseStart {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- `CaseStart` and the interfaces it leads to type the builder's methods
	return new CaseBuilder([], undefined) as unknown as CaseStart;
}
