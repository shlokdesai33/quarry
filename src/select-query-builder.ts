import type { DataType } from './data-type/data-type.js';
import type { AliasedExpression, TypedExpression } from './expression.js';
import {
	type ExpressionBuilder,
	expressionBuilder,
} from './expression-builder.js';
import type { OperationNode } from './node.js';
import type { AnyPredicate, EqualsValue } from './operators.js';
import type { Ref, Refs, RefsOf } from './refs.js';
import type { AnyTable } from './table.js';
import type { Prettify } from './types.js';
import {
	type Condition,
	type ConditionArgs,
	type Group,
	type Unconstrained,
	WhereBuilder,
} from './where-builder.js';

/** The expressions the operand `V` takes, one per SQL type it accepts. */
type ExpressionsIn<V> = Extract<V, TypedExpression<unknown, DataType>>;

/**
 * The columns of the tables `T` that can be the operand `V`: those of a SQL
 * type it takes.
 *
 * Each column's SQL type is matched against the SQL types of the expressions
 * `V` takes, rather than building an expression for every column and
 * checking it against all of `V`, for type-checking speed.
 */
type JoinColumn<T extends readonly AnyTable[], V> =
	ExpressionsIn<V> extends infer E
		? E extends TypedExpression<unknown, infer D extends DataType>
			? TableColumn<T[number], D>
			: never
		: never;

/**
 * The columns of the table `X` of SQL type `D`. Scanned per table rather than
 * over the merged scope, so each join of a chain reuses the scans of the
 * tables joined before it.
 */
type TableColumn<X, D> = X extends AnyTable
	? {
			[K in keyof X['$refs'] & string]: X['$refs'][K] extends {
				readonly _quarry: { readonly dataType: D };
			}
				? K
				: never;
		}[keyof X['$refs'] & string]
	: never;

/**
 * The forms `on` takes over scope `R`, where `PT` are the tables joined before
 * and `JR` the joined table's references, returning `B`:
 *
 * - `(joinedColumn, earlierColumn)`: the two columns are equal
 * - `(eb => condition)`: any condition
 * - `(predicate)`: any boolean expression
 */
interface JoinCondition<
	R extends Refs,
	PT extends readonly AnyTable[],
	JR extends Refs,
	B,
> {
	<L extends Ref<JR>>(
		left: L,
		right: Unconstrained<
			JoinColumn<
				PT,
				EqualsValue<NonNullable<JR[L]['$select']>, JR[L]['_quarry']['dataType']>
			>
		>,
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
 *   .on('contacts.userId', 'users.id')
 *   .where('users.role', 'admin')
 *   .where((eb) => eb.ref('users.age').gte(18).or(eb.ref('users.verified').isTrue()))
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
	 * Adds a condition to the `where` clause, joined to the others by `and`:
	 * `column = value`, or any condition built in a callback.
	 *
	 * @example .where('users.role', 'admin')
	 * @example .where((eb) => eb.ref('users.age').gte(18))
	 * @example .where((eb) => eb.or([eb.ref('users.age').lt(13), eb.ref('users.age').gt(65)]))
	 */
	readonly where: Condition<RefsOf<T>, SelectQueryBuilder<T, O>> = (
		...args: ConditionArgs<RefsOf<T>>
	) => new SelectQueryBuilder<T, O>(this.#tables, this.#where.add(args));

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
	 * The join condition. The shorthand is `joinedColumn = earlierColumn`: a
	 * column of the joined table equal to a column of a table joined before,
	 * of a SQL type its `=` takes. Any other condition (other operators,
	 * values, expressions, several conditions) goes in a callback.
	 *
	 * Not implemented yet: the condition is checked but not recorded.
	 *
	 * @example .on('contacts.userId', 'users.id')
	 * @example .on((eb) => eb.ref('contacts.userId').eq(eb.ref('users.id')).and(eb.ref('contacts.kind').eq('primary')))
	 */
	readonly on: JoinCondition<
		RefsOf<[...T, J]>,
		T,
		RefsOf<[J]>,
		SelectQueryBuilder<[...T, J], O>
	> = () => this.#query;
}
