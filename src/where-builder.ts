import { Expression } from './expression.js';
import type { ExpressionBuilder } from './expression-builder.js';
import { compare } from './expression-methods.js';
import type { OperationNode } from './node.js';
import type { AnyPredicate, EqualsValue } from './operators.js';
import type { Ref, Refs } from './refs.js';

/** A condition callback: builds one condition from the expression builder. */
export type Group<R extends Refs> = (eb: ExpressionBuilder<R>) => AnyPredicate;

/**
 * `T`, but with no constraint while `T` is generic, for type-checking speed.
 * For a literal argument, the compiler asks whether the parameter type keeps
 * literals before applying the call's inferred type arguments, so it resolves
 * a generic parameter type through its constraint: for a column's value, the
 * type for every reference in scope. The check is a no-op here; this makes it
 * free. Once `T` is concrete, this is `T`, and errors print it as `T`.
 */
export type Unconstrained<T> = [T] extends [infer U] ? U : never;

/**
 * The forms `where` takes, returning `B`:
 *
 * - `(column, value)`: `column = value`, the value typed like `eq`'s
 * - `(eb => condition)`: any condition, e.g. `eb.ref(column).gte(value)`
 * - `(predicate)`: any boolean expression
 */
export interface Condition<R extends Refs, B> {
	<C extends Ref<R>>(
		column: C,
		value: Unconstrained<
			EqualsValue<NonNullable<R[C]['$select']>, R[C]['_quarry']['dataType']>
		>,
	): B;
	(group: Group<R>): B;
	(predicate: AnyPredicate): B;
}

/** The arguments of any form of `Condition`. */
export type ConditionArgs<R extends Refs> =
	| readonly [column: string, value: unknown]
	| readonly [group: Group<R>]
	| readonly [predicate: AnyPredicate];

/**
 * Collects the conditions of a `where` clause over the references in scope
 * `R`, joined by `and`. Any other combination is one condition built with
 * `and` / `or`.
 *
 * Immutable: every method returns a new builder.
 */
export class WhereBuilder<R extends Refs> {
	readonly #eb: ExpressionBuilder<R>;
	readonly #conditions: readonly OperationNode[];

	constructor(
		eb: ExpressionBuilder<R>,
		conditions: readonly OperationNode[] = [],
	) {
		this.#eb = eb;
		this.#conditions = conditions;
	}

	/** Adds a condition given in any form of `Condition`. */
	add(args: ConditionArgs<R>): WhereBuilder<R> {
		return new WhereBuilder(this.#eb, [
			...this.#conditions,
			this.#nodeOf(args),
		]);
	}

	/** The same conditions over a wider scope, e.g. after a join. */
	rescope<S extends Refs>(eb: ExpressionBuilder<S>): WhereBuilder<S> {
		return new WhereBuilder(eb, this.#conditions);
	}

	/** The conditions as one node, `undefined` when there are none. */
	toNode(): OperationNode | undefined {
		const [only, ...rest] = this.#conditions;
		return rest.length === 0
			? only
			: { kind: 'and', operands: this.#conditions };
	}

	#nodeOf(args: ConditionArgs<R>): OperationNode {
		if (args.length === 2) {
			return compare(this.#eb.ref(args[0]), '=', args[1])._quarry.node;
		}
		const [first] = args;
		return Expression.is(first)
			? first._quarry.node
			: first(this.#eb)._quarry.node;
	}
}
