import { compile } from './compile.js';
import type { DataType } from './data-type/data-type.js';
import { type Executor, NoRowError, TooManyRowsError } from './executor.js';
import {
	type AliasedExpression,
	Expression,
	type TypedExpression,
} from './expression.js';
import {
	type ExpressionBuilder,
	expressionBuilder,
} from './expression-builder.js';
import type {
	JoinNode,
	OperationNode,
	SelectNode,
	SelectionNode,
	TableNode,
} from './node.js';
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

/**
 * The row `O` with the columns `A` added. Either alone when the other is
 * empty, which saves flattening an intersection for every first selection
 * and every fragment that selects nothing; `A` must then be written out
 * rather than named, for hovers to list its columns.
 */
type AddRow<O, A> = [keyof O] extends [never]
	? A
	: [keyof A] extends [never]
		? O
		: Prettify<O & A>;

/**
 * The result row after `when`, whose `build` selected the columns `P`: they
 * are optional, since it may not have run. `O` itself when it selected none.
 */
type WhenRow<O, P> = [keyof P] extends [never] ? O : Prettify<O & Partial<P>>;

/**
 * What a fragment builds on: a query over the tables `T` it needs, with
 * nothing selected yet.
 */
export type Fragment<T extends readonly AnyTable[]> = SelectQueryBuilder<
	T,
	Record<never, never>
>;

/**
 * Any select query, by shape: a query over particular tables isn't assignable
 * to one over any tables, since the tables appear in parameter types.
 */
interface AnyQuery {
	readonly $output: unknown;
	toNode(): SelectNode;
}

/** The tables the fragment's query `Q` joined onto its tables `P`. */
type JoinedBy<Q, P extends readonly AnyTable[]> =
	Q extends SelectQueryBuilder<infer T, unknown>
		? T extends readonly [...P, ...infer J extends AnyTable[]]
			? J
			: never
		: never;

/**
 * Nothing when the tables `P` are all among `T`; otherwise one more argument,
 * so the call fails, labelled with the tables missing.
 */
type InScope<T extends readonly AnyTable[], P extends readonly AnyTable[]> = [
	P[number],
] extends [T[number]]
	? []
	: [missingTables: Exclude<P[number], T[number]>['name']];

/** The arguments of any form of `on`. */
type OnArgs<R extends Refs> =
	| readonly [left: string, right: unknown]
	| readonly [group: Group<R>]
	| readonly [predicate: AnyPredicate];

/** What a `select` over the tables `T` has recorded so far. */
interface SelectState<T extends readonly AnyTable[]> {
	readonly tables: T;
	readonly from: TableNode;
	readonly joins: readonly JoinNode[];
	readonly where: WhereBuilder<RefsOf<T>>;
	readonly selections: readonly SelectionNode[];
	readonly limit: number | undefined;
	/** What the query runs on; `undefined` when it was built on its own. */
	readonly executor: Executor | undefined;
}

/** A table as `from` and `join` render it. */
const tableNode = (table: AnyTable): TableNode => ({
	name: table._quarry.source,
	alias: table.name === table._quarry.source ? undefined : table.name,
});

/**
 * Starts a `select` from `table`, built without a database: it can be
 * inspected and composed, but runs only when started from `database(...)`.
 *
 * @example
 * selectFrom(users)
 *   .innerJoin(contacts)
 *   .on('contacts.userId', 'users.id')
 *   .where('users.role', 'admin')
 *   .where((eb) => eb.or([eb.ref('users.age').gte(18), eb.ref('users.verified').isTrue()]))
 *   .select(['users.id', 'contacts.email'])
 */
export function selectFrom<T extends AnyTable>(
	table: T,
): SelectQueryBuilder<[T], Record<never, never>> {
	return selectFromWith(table, undefined);
}

/**
 * A reusable piece of a query (conditions, joins, columns) over the tables it
 * needs: one table, or several in an array. `pipe` applies it to any query
 * those tables are in, in any position.
 *
 * @example
 * const active = fragment(users, (qb) => qb.where('users.status', 'active'));
 * const withContacts = fragment(users, (qb) =>
 *   qb.innerJoin(contacts).on('contacts.userId', 'users.id'),
 * );
 * selectFrom(users).pipe(withContacts).pipe(active).select(['contacts.email'])
 *
 * @example
 * const sameEmail = fragment([users, contacts], (qb) =>
 *   qb.where((eb) => eb.ref('contacts.email').eq(eb.ref('users.email'))),
 * );
 */
export function fragment<X extends AnyTable, Q extends AnyQuery>(
	table: X,
	build: (qb: Fragment<[X]>) => Q,
): (qb: Fragment<[X]>) => Q;
export function fragment<
	const T extends readonly AnyTable[],
	Q extends AnyQuery,
>(tables: T, build: (qb: Fragment<[...T]>) => Q): (qb: Fragment<[...T]>) => Q;
export function fragment<Q>(_tables: unknown, build: Q): Q {
	return build;
}

/** `selectFrom`, with the executor the query runs on. */
export function selectFromWith<T extends AnyTable>(
	table: T,
	executor: Executor | undefined,
): SelectQueryBuilder<[T], Record<never, never>> {
	const tables: [T] = [table];
	return new SelectQueryBuilder<[T], Record<never, never>>({
		tables,
		from: tableNode(table),
		joins: [],
		where: new WhereBuilder(expressionBuilder(...tables)),
		selections: [],
		limit: undefined,
		executor,
	});
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

	readonly #state: SelectState<T>;

	constructor(state: SelectState<T>) {
		this.#state = state;
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
	) =>
		new SelectQueryBuilder<T, O>({
			...this.#state,
			where: this.#state.where.add(args),
		});

	/** Joins `table`, whose columns are in scope from `on` onwards. */
	innerJoin<J extends AnyTable>(table: J): JoinBuilder<T, J, O> {
		const tables: [...T, J] = [...this.#state.tables, table];
		return new JoinBuilder<T, J, O>(
			{
				...this.#state,
				tables,
				where: this.#state.where.rescope(expressionBuilder(...tables)),
			},
			table,
		);
	}

	/**
	 * Adds to the select list. A column is keyed by its name, an expression
	 * by its alias.
	 *
	 * @example .select(['users.id', 'contacts.email'])
	 * @example .select((eb) => [eb.fn.lower('users.email').as('email')])
	 */
	select<const S extends readonly Selection<RefsOf<T>>[]>(
		selections: S | ((eb: ExpressionBuilder<RefsOf<T>>) => S),
	): SelectQueryBuilder<
		T,
		AddRow<O, { [K in S[number] as KeyOf<K>]: ValueOf<RefsOf<T>, K> }>
	> {
		const eb = expressionBuilder(...this.#state.tables);
		const list = typeof selections === 'function' ? selections(eb) : selections;
		const added = list.map((selection): SelectionNode =>
			typeof selection === 'string'
				? {
						expression: eb.ref(selection)._quarry.node,
						alias: selection.slice(selection.indexOf('.') + 1),
					}
				: {
						expression: selection.expression._quarry.node,
						alias: selection.alias,
					},
		);
		return new SelectQueryBuilder({
			...this.#state,
			selections: [...this.#state.selections, ...added],
		});
	}

	/**
	 * Applies `build` only when `condition` holds, for the parts of a query
	 * that depend on input. It keeps the tables, so it can't join; the
	 * columns it selects are optional in the result row. Like a fragment,
	 * `build` starts from nothing selected, so its row is just its columns.
	 *
	 * @example .when(onlyActive, (qb) => qb.where('users.status', 'active'))
	 * @example .when(withEmail, (qb) => qb.select(['users.email']))
	 */
	when<P>(
		condition: boolean,
		build: (qb: Fragment<T>) => SelectQueryBuilder<T, P>,
	): SelectQueryBuilder<T, WhenRow<O, P>> {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the row type doesn't affect what `build` can do; `WhenRow` adds the earlier columns back
		const query = condition ? build(this as unknown as Fragment<T>) : this;
		return new SelectQueryBuilder<T, WhenRow<O, P>>(query.#state);
	}

	/**
	 * Applies a reusable piece of a query made with `fragment`. Its tables
	 * must be in this query, in any position; the tables it joins are added to
	 * this query's, and the columns it selects to this query's row.
	 *
	 * @example
	 * const active = fragment(users, (qb) => qb.where('users.status', 'active'));
	 * selectFrom(users).innerJoin(contacts).on('contacts.userId', 'users.id').pipe(active)
	 */
	pipe<P extends readonly AnyTable[], Q extends AnyQuery>(
		piece: (qb: Fragment<P>) => Q,
		..._inScope: InScope<T, P>
	): SelectQueryBuilder<[...T, ...JoinedBy<Q, P>], AddRow<O, Q['$output']>> {
		type Tables = [...T, ...JoinedBy<Q, P>];
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- `InScope` checks every reference the fragment can make is in scope here
		const query = piece(this as unknown as Fragment<P>);
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the fragment returned a query built on this one's state
		const built = query as unknown as this;
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- that state has these tables, then the fragment's joins
		const state = built.#state as unknown as SelectState<Tables>;
		return new SelectQueryBuilder<Tables, AddRow<O, Q['$output']>>(state);
	}

	/** Runs the query and returns every row. */
	async all(): Promise<O[]> {
		return (await this.#execute(undefined)).rows;
	}

	/** Runs the query with `limit 1` and returns its row, if any. */
	async first(): Promise<O | undefined> {
		const [row] = (await this.#execute(1)).rows;
		return row;
	}

	/**
	 * Runs the query and returns its one row: throws `NoRowError` when there
	 * is none and `TooManyRowsError` when there are several. Fetches at most
	 * two rows, enough to tell.
	 */
	async one(): Promise<O> {
		const { query, rows } = await this.#execute(2);
		const [row, ...rest] = rows;
		if (row === undefined) {
			throw new NoRowError(query);
		}
		if (rest.length > 0) {
			throw new TooManyRowsError(query);
		}
		return row;
	}

	/**
	 * Runs the query and returns its row, if any: throws `TooManyRowsError`
	 * when there are several. Fetches at most two rows, enough to tell.
	 */
	async maybeOne(): Promise<O | undefined> {
		const { query, rows } = await this.#execute(2);
		const [row, ...rest] = rows;
		if (rest.length > 0) {
			throw new TooManyRowsError(query);
		}
		return row;
	}

	/** The whole query as one node. */
	toNode(): SelectNode {
		const { from, joins, where, selections, limit } = this.#state;
		return {
			kind: 'select',
			selections,
			from,
			joins,
			where: where.toNode(),
			limit,
		};
	}

	/**
	 * The `where` clause as one node, `undefined` when it is empty. For
	 * inspecting the conditions on their own.
	 */
	toWhereNode(): OperationNode | undefined {
		return this.#state.where.toNode();
	}

	/** Runs the query, fetching at most `limit` rows besides any limit of its own. */
	async #execute(limit: number | undefined) {
		const { executor } = this.#state;
		if (executor === undefined) {
			throw new Error(
				'The query has no database to run on: start it from `database(executor).selectFrom(...)`',
			);
		}
		const node = this.toNode();
		const query = compile(
			limit === undefined
				? node
				: { ...node, limit: Math.min(node.limit ?? limit, limit) },
		);
		const { rows } = await executor.execute(query);
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the select list supplies the row type
		return { query, rows: rows as O[] };
	}
}

/**
 * A join of `J` onto the tables `T`, waiting for its `on` condition. The
 * joined table is already in scope, so the condition can reference it.
 */
export class JoinBuilder<T extends readonly AnyTable[], J extends AnyTable, O> {
	readonly #state: SelectState<[...T, J]>;
	readonly #table: J;

	constructor(state: SelectState<[...T, J]>, table: J) {
		this.#state = state;
		this.#table = table;
	}

	/**
	 * The join condition. The shorthand is `joinedColumn = earlierColumn`: a
	 * column of the joined table equal to a column of a table joined before,
	 * of a SQL type its `=` takes. Any other condition (other operators,
	 * values, expressions, several conditions) goes in a callback.
	 *
	 * @example .on('contacts.userId', 'users.id')
	 * @example .on((eb) => eb.and([eb.ref('contacts.userId').eq(eb.ref('users.id')), eb.ref('contacts.kind').eq('primary')]))
	 */
	readonly on: JoinCondition<
		RefsOf<[...T, J]>,
		T,
		RefsOf<[J]>,
		SelectQueryBuilder<[...T, J], O>
	> = (...args: OnArgs<RefsOf<[...T, J]>>) =>
		new SelectQueryBuilder<[...T, J], O>({
			...this.#state,
			joins: [
				...this.#state.joins,
				{ table: tableNode(this.#table), on: this.#conditionOf(args) },
			],
		});

	#conditionOf(args: OnArgs<RefsOf<[...T, J]>>): OperationNode {
		const eb = expressionBuilder(...this.#state.tables);
		if (args.length === 2) {
			const [left, right] = args;
			return {
				kind: 'binary',
				left: eb.ref(left)._quarry.node,
				operator: '=',
				right: eb.ref(String(right))._quarry.node,
			};
		}
		const [first] = args;
		return Expression.is(first) ? first._quarry.node : first(eb)._quarry.node;
	}
}
