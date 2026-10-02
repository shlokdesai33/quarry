import type { AliasedExpression, TypedExpression } from './expression.js';
import {
	type ExpressionBuilder,
	expressionBuilder,
} from './expression-builder.js';
import type { OperationNode } from './node.js';
import type { OperatorsOf, Ref, Refs, RefsOf } from './refs.js';
import type { AnyTable } from './table.js';
import type { Prettify } from './types.js';
import {
	type AnyPredicate,
	type Condition,
	type ConditionArgs,
	type Group,
	WhereBuilder,
} from './where-builder.js';

/**
 * The columns that can be the right-hand side `V` of a join condition: those
 * in scope `R` whose values the operator takes.
 */
type JoinColumn<R extends Refs, V> = {
	[K in Ref<R>]: TypedExpression<R[K]['$select'], R[K]['dataType']> extends V
		? K
		: never;
}[Ref<R>];

/**
 * The operators of the joined column `L` that some column can be the
 * right-hand side of: not `is`, which takes a keyword, nor `between`, which
 * takes a pair.
 */
type JoinOperator<R extends Refs, L> = {
	[O in keyof OperatorsOf<R, L> & string]: [
		JoinColumn<R, OperatorsOf<R, L>[O]>,
	] extends [never]
		? never
		: O;
}[keyof OperatorsOf<R, L> & string];

/**
 * The forms `on` takes over scope `R`, where `JR` are the joined table's
 * references, returning `B`:
 *
 * - `(joinedColumn, operator, column)`: compares two columns
 * - `(q => q.where(...).orWhere(...))`: any conditions
 * - `(predicate)`: any boolean expression
 */
interface JoinCondition<R extends Refs, JR extends Refs, B> {
	<L extends Ref<JR>, O extends keyof OperatorsOf<R, L> & JoinOperator<R, L>>(
		left: L,
		operator: O,
		right: JoinColumn<R, OperatorsOf<R, L>[O]>,
	): B;
	(group: Group<R>): B;
	(predicate: AnyPredicate): B;
}

/** An entry of a select list: a column reference or a named expression. */
type Selection<R extends Refs> = Ref<R> | AliasedExpression<unknown, string>;

/** The key a selection has in the result row. */
type KeyOf<S> = S extends `${string}.${infer C}`
	? C
	: S extends AliasedExpression<unknown, infer A>
		? A
		: never;

/** The type a selection has in the result row. */
type ValueOf<R extends Refs, S> =
	S extends Ref<R>
		? R[S]['$select']
		: S extends AliasedExpression<infer T, string>
			? T
			: never;

/** The result row of the selections `S`. */
type Row<R extends Refs, S> = { [K in S as KeyOf<K>]: ValueOf<R, K> };

/**
 * Starts a `select` from `table`.
 *
 * @example
 * selectFrom(users)
 *   .innerJoin(contacts)
 *   .on('contacts.userId', '=', 'users.id')
 *   .where('users.age', '>=', 18)
 *   .orWhere((q) => q.where('users.role', '=', 'admin'))
 *   .select(['users.id', 'contacts.email'])
 */
export function selectFrom<T extends AnyTable>(
	table: T,
): SelectQueryBuilder<[T], Record<never, never>> {
	const tables: [T] = [table];
	return new SelectQueryBuilder<[T], Record<never, never>>(
		tables,
		new WhereBuilder(expressionBuilder(...tables)),
	);
}

/**
 * A `select` query over the tables `T` (the `from` table, then each join),
 * whose result rows are `O`. Every reference is resolved against `T`, so a
 * column can only be used once its table has been joined.
 *
 * Immutable: every method returns a new builder.
 */
export class SelectQueryBuilder<T extends readonly AnyTable[], O> {
	/** The type of a result row. Never set. */
	declare readonly $output: O;

	readonly #tables: T;
	readonly #where: WhereBuilder<RefsOf<T>>;

	constructor(tables: T, where: WhereBuilder<RefsOf<T>>) {
		this.#tables = tables;
		this.#where = where;
	}

	/**
	 * Adds a condition to the `where` clause, joined by `and`.
	 *
	 * @example .where('users.age', '>=', 18)
	 * @example .where((q) => q.where('users.age', '<', 13).orWhere('users.age', '>', 65))
	 */
	readonly where: Condition<RefsOf<T>, SelectQueryBuilder<T, O>> = (
		...args: ConditionArgs<RefsOf<T>>
	) => new SelectQueryBuilder<T, O>(this.#tables, this.#where.add('and', args));

	/**
	 * Adds a condition to the `where` clause, joined by `or`. `and` binds
	 * tighter, as in SQL: `.where(a).orWhere(b).where(c)` is `a or (b and c)`.
	 *
	 * @example .where('users.age', '>=', 18).orWhere('users.role', '=', 'admin')
	 */
	readonly orWhere: Condition<RefsOf<T>, SelectQueryBuilder<T, O>> = (
		...args: ConditionArgs<RefsOf<T>>
	) => new SelectQueryBuilder<T, O>(this.#tables, this.#where.add('or', args));

	/**
	 * Joins `table`, whose columns are in scope from `on` onwards.
	 *
	 * Not implemented yet: only puts the table in scope; the join itself is
	 * not recorded.
	 */
	innerJoin<J extends AnyTable>(table: J): JoinBuilder<T, J, O> {
		const tables: [...T, J] = [...this.#tables, table];
		return new JoinBuilder<T, J, O>(
			new SelectQueryBuilder<[...T, J], O>(
				tables,
				this.#where.rescope(expressionBuilder(...tables)),
			),
		);
	}

	/**
	 * Sets the select list. A column is keyed by its name, an expression by
	 * its alias.
	 *
	 * Not implemented yet: only types the result row.
	 *
	 * @example .select(['users.id', 'contacts.email'])
	 * @example .select((eb) => [eb.fn.lower('users.email').as('email')])
	 */
	select<const S extends readonly Selection<RefsOf<T>>[]>(
		selections: S | ((eb: ExpressionBuilder<RefsOf<T>>) => S),
	): SelectQueryBuilder<T, Prettify<O & Row<RefsOf<T>, S[number]>>> {
		void selections;
		return new SelectQueryBuilder<T, Prettify<O & Row<RefsOf<T>, S[number]>>>(
			this.#tables,
			this.#where,
		);
	}

	/**
	 * The `where` clause as one node, `undefined` when it is empty. For
	 * inspecting the conditions until the query compiles as a whole.
	 */
	toWhereNode(): OperationNode | undefined {
		return this.#where.toNode();
	}
}

/**
 * A join of `J` onto the tables `T`, waiting for its `on` condition. The
 * joined table is already in scope, so the condition can reference it.
 */
export class JoinBuilder<T extends readonly AnyTable[], J extends AnyTable, O> {
	readonly #query: SelectQueryBuilder<[...T, J], O>;

	constructor(query: SelectQueryBuilder<[...T, J], O>) {
		this.#query = query;
	}

	/**
	 * The join condition. The shorthand compares a column of the joined table
	 * with any column in scope, both checked against the operator; any other
	 * condition (values, expressions, several conditions) goes in a callback.
	 *
	 * Not implemented yet: the condition is checked but not recorded.
	 *
	 * @example .on('contacts.userId', '=', 'users.id')
	 * @example .on((q) => q.where('contacts.userId', '=', q.ref('users.id')).where('contacts.kind', '=', 'primary'))
	 */
	readonly on: JoinCondition<
		RefsOf<[...T, J]>,
		RefsOf<[J]>,
		SelectQueryBuilder<[...T, J], O>
	> = () => this.#query;
}
