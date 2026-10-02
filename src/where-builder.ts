import { Expression, type Param } from './expression.js';
import type { ExpressionBuilder } from './expression-builder.js';
import type { Functions } from './functions.js';
import type { JsonFunctions } from './json.js';
import type { OperationNode } from './node.js';
import type { Operand, OperatorsOf, Ref, Refs } from './refs.js';

/** A boolean expression, possibly null. */
export type AnyPredicate = Expression<boolean | null>;

/** A group callback: builds conditions that are parenthesised together. */
export type Group<R extends Refs> = (
	q: WhereBuilder<R>,
) => WhereBuilder<R> | AnyPredicate;

/**
 * The forms `where` and `orWhere` take, returning `B`:
 *
 * - `(left, operator, value)`: a comparison, typed like `eb(...)`, including
 *   `(q.val(x), operator, q.fn.any(array))`
 * - `(q => q.where(...).orWhere(...))`: a parenthesised group
 * - `(predicate)`: any boolean expression
 */
export interface Condition<R extends Refs, B> {
	<
		L extends Operand<R> | Param<unknown>,
		O extends keyof OperatorsOf<R, L> & string,
	>(
		left: L,
		operator: O,
		value: OperatorsOf<R, L>[O],
	): B;
	(group: Group<R>): B;
	(predicate: AnyPredicate): B;
}

/** The arguments of any form of `Condition`. */
export type ConditionArgs<R extends Refs> =
	| readonly [left: unknown, operator: string, value: unknown]
	| readonly [group: Group<R>]
	| readonly [predicate: AnyPredicate];

/** How a condition joins the ones before it. */
type Connector = 'and' | 'or';

interface Entry {
	readonly connector: Connector;
	readonly node: OperationNode;
}

/**
 * Collects the conditions of a `where` clause over the references in scope
 * `R`, each joined to the ones before it by `and` (`where`) or `or`
 * (`orWhere`). They combine as written in SQL, where `and` binds tighter than
 * `or`: `a.where(b).orWhere(c).where(d)` is `(a and b) or (c and d)`. A group
 * callback is how to combine them otherwise.
 *
 * Immutable: every method returns a new builder.
 *
 * @example q.where('users.age', '>=', 18).orWhere('users.role', '=', 'admin')
 * @example q.where('posts.authorId', '=', q.ref('users.id'))
 */
export class WhereBuilder<R extends Refs> {
	readonly #eb: ExpressionBuilder<R>;
	readonly #entries: readonly Entry[];

	/** The SQL functions. */
	readonly fn: Functions<R>;

	/** The jsonb functions. */
	readonly json: JsonFunctions<R>;

	constructor(eb: ExpressionBuilder<R>, entries: readonly Entry[] = []) {
		this.#eb = eb;
		this.#entries = entries;
		this.fn = eb.fn;
		this.json = eb.json;
	}

	/**
	 * A column reference, for comparing two columns.
	 *
	 * @example q.where('posts.authorId', '=', q.ref('users.id'))
	 */
	ref<C extends Ref<R>>(column: C) {
		return this.#eb.ref(column);
	}

	/**
	 * A parameter, for positions that take a reference by default.
	 *
	 * @example q.where('users.id', 'in', q.val(ids))
	 */
	val<T extends readonly unknown[]>(value: T): Param<T>;
	val<const T>(value: T): Param<T>;
	val(value: unknown) {
		return this.#eb.val(value);
	}

	/** Adds a condition joined by `and`. */
	readonly where: Condition<R, WhereBuilder<R>> = (...args: ConditionArgs<R>) =>
		this.add('and', args);

	/** Adds a condition joined by `or`. */
	readonly orWhere: Condition<R, WhereBuilder<R>> = (
		...args: ConditionArgs<R>
	) => this.add('or', args);

	/**
	 * Adds a condition given in any form of `Condition`. An empty group adds
	 * nothing.
	 */
	add(connector: Connector, args: ConditionArgs<R>): WhereBuilder<R> {
		const node = this.#nodeOf(args);
		return node === undefined
			? this
			: new WhereBuilder(this.#eb, [...this.#entries, { connector, node }]);
	}

	/** The same conditions over a wider scope, e.g. after a join. */
	rescope<S extends Refs>(eb: ExpressionBuilder<S>): WhereBuilder<S> {
		return new WhereBuilder(eb, this.#entries);
	}

	/**
	 * The conditions as one node, `undefined` when there are none. Runs of
	 * `and` are grouped first, then joined by `or`.
	 */
	toNode(): OperationNode | undefined {
		const groups: OperationNode[][] = [];
		for (const { connector, node } of this.#entries) {
			const last = groups.at(-1);
			if (last === undefined || connector === 'or') {
				groups.push([node]);
			} else {
				last.push(node);
			}
		}

		const operands = groups.map((group): OperationNode =>
			group.length === 1 && group[0] !== undefined
				? group[0]
				: { kind: 'and', operands: group },
		);
		if (operands.length <= 1) return operands[0];
		return { kind: 'or', operands };
	}

	#nodeOf(args: ConditionArgs<R>): OperationNode | undefined {
		if (args.length === 3) {
			return this.#compare(...args).toNode();
		}
		const [first] = args;
		if (Expression.is(first)) {
			return first.toNode();
		}
		return first(new WhereBuilder(this.#eb)).toNode();
	}

	#compare(left: unknown, operator: string, value: unknown): AnyPredicate {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- `Condition` checks the arguments
		const compare = this.#eb as unknown as (
			left: unknown,
			operator: string,
			value: unknown,
		) => AnyPredicate;
		return compare(left, operator, value);
	}
}
