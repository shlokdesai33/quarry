import { compile, type CompiledQuery } from './compile.js';
import type { DataType } from './data-type/data-type.js';
import type {
	Executor,
	NoRowError,
	QueryDescription,
	RunOptions,
	StreamOptions,
	TooManyRowsError,
} from './executor.js';
import { RowStream } from './driver/row-stream.js';
import { Expression, type TypedExpression } from './expression.js';
import {
	allSelections,
	type ExpressionBuilder,
	expressionBuilder,
} from './expression-builder.js';
import type {
	AliasNode,
	JoinNode,
	LockNode,
	OperationNode,
	OrderNode,
	SelectNode,
	SelectionNode,
	TableNode,
} from './node.js';
import type { AnyPredicate, EqualsValue } from './operators.js';
import {
	checkSize,
	type CursorPage,
	type CursorPageOptions,
	decodeCursor,
	encodeCursor,
	type KeyColumn,
	type KeysetOptions,
	type OffsetPage,
	type OffsetPageOptions,
	orderBy,
	readKeys,
	resolveKeyset,
	runOptions,
	seekPage,
	settled,
} from './pagination.js';
import { type Query, rejectAwait } from './query.js';
import type { Ref, Refs, RefsOf } from './refs.js';
import {
	type AddRow,
	checkUniqueKeys,
	type RowOf,
	type Selection,
	selectionNodes,
	type TableRefs,
	type UniqueColumns,
	type UniqueKeys,
} from './row.js';
import {
	allRows,
	type ColumnValue,
	type ErrorFor,
	errorArg,
	expectAtMostOne,
	expectFirst,
	expectNonEmpty,
	expectOne,
	expectValue,
	type Shape,
	shapedQuery,
	takeFirst,
	takeValue,
	type ValueArgs,
} from './shape.js';
import {
	type AnyTable,
	type NullableTable,
	type NullableTables,
	tableNode,
} from './table.js';
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

/**
 * The result row after `when`, whose `build` selected the columns `P`: they
 * are optional, since it may not have run. `O` itself when it selected none.
 */
type WhenRow<O, P> = [keyof P] extends [never] ? O : Prettify<O & Partial<P>>;

/**
 * What the latest locking clause of a query still takes, so that its
 * modifiers can only follow it:
 *
 * - `'none'`: the query has no locking clause
 * - `'strength'`: one was just added; it takes `of` and a wait policy
 * - `'of'`: it has its tables; it takes a wait policy
 * - `'done'`: it takes nothing more: it has a wait policy, or `when` or
 *   `pipe` may have added it
 */
export type LockState = 'none' | 'strength' | 'of' | 'done';

/**
 * The lock state `L` after applying a piece whose own query ended in `B`:
 * unchanged when the piece added no locking clause.
 */
type LockAfter<L extends LockState, B> = B extends 'none' ? L : 'done';

/** A table `of` takes: one in scope, or the name it's referenced by there. */
type LockTarget<T extends readonly AnyTable[]> = T[number] | T[number]['name'];

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
	readonly $lock: LockState;
	toNode(): SelectNode;
}

/** The tables the fragment's query `Q` joined onto its tables `P`. */
type JoinedBy<Q, P extends readonly AnyTable[]> =
	Q extends SelectQueryBuilder<infer T, infer _O, infer _L>
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

/**
 * Nothing when no table of `T` goes by the name of `J`; otherwise one more
 * argument, so the call fails: a second table of the same name would make
 * every reference to it ambiguous. A self-join joins the table under an
 * alias.
 */
type NewName<
	T extends readonly AnyTable[],
	J extends AnyTable,
> = J['name'] extends T[number]['name']
	? [
			alreadyJoined: `"${J['name']}" is already in the query: join it under another name, e.g. ${J['name']}.as('other')`,
		]
	: [];

/**
 * The row `O` once the tables it was selected from are on the outer side of
 * a join: every column nullable.
 */
type NullableRow<O> = [keyof O] extends [never]
	? O
	: { [K in keyof O]: O[K] | null };

/** `NullableTables`, as a scope `JoinBuilder` takes. */
type OuterTables<T extends readonly AnyTable[]> =
	NullableTables<T> extends infer N extends readonly AnyTable[] ? N : never;

/**
 * What `group by`, `order by` and `distinct on` take over scope `R` with the
 * row `O`: a column, a selected column by its key in the row, or an
 * expression.
 */
type Key<R extends Refs, O> = Ref<R> | (keyof O & string) | Expression<unknown>;

/** A key as `#keys` reads it: a string, an expression, or a callback making one. */
type KeyArg<R extends Refs> =
	| string
	| Expression<unknown>
	| ((eb: ExpressionBuilder<R>) => string | Expression<unknown>);

/** What a `select` over the tables `T` has recorded so far. */
interface SelectState<T extends readonly AnyTable[]> {
	readonly tables: T;
	readonly from: TableNode;
	readonly joins: readonly JoinNode[];
	readonly where: WhereBuilder<RefsOf<T>>;
	readonly distinct: SelectNode['distinct'];
	readonly selections: readonly SelectionNode[];
	readonly groupBy: readonly (OperationNode | AliasNode)[];
	readonly having: WhereBuilder<RefsOf<T>>;
	readonly orderBy: readonly OrderNode[];
	readonly limit: number | undefined;
	readonly offset: number | undefined;
	readonly locks: readonly LockNode[];
	/** The label set by `tag()`. */
	readonly tag: string | undefined;
	/** What the query runs on; `undefined` when it was built on its own. */
	readonly executor: Executor | undefined;
}

/**
 * Starts a `select` from `table`, built without a database: it can be
 * inspected and composed, and run by a database's `batch`, but `execute()`
 * runs only a query started from `database(...)`.
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
	const eb = expressionBuilder(...tables);
	return new SelectQueryBuilder<[T], Record<never, never>>({
		tables,
		from: tableNode(table),
		joins: [],
		where: new WhereBuilder(eb),
		distinct: undefined,
		selections: [],
		groupBy: [],
		having: new WhereBuilder(eb),
		orderBy: [],
		limit: undefined,
		offset: undefined,
		locks: [],
		tag: undefined,
		executor,
	});
}

/**
 * A `select` query over the tables `T` (the `from` table, then each join),
 * whose result rows are `O`. Every reference is resolved against `T`, so a
 * column can only be used once its table has been joined.
 *
 * Nothing runs until `execute()` (or `stream`, or `db.batch`): the
 * `take…` and `expect…` shapes only set how the result is read, and never
 * change the SQL.
 *
 * Immutable: every method returns a new builder. `L` is what its latest
 * locking clause still takes, if it has one.
 *
 * @example
 * const user = await db.selectFrom(users).where('users.id', id).select(['users.email']).expectOne().execute();
 */
export class SelectQueryBuilder<
	T extends readonly AnyTable[],
	O,
	L extends LockState = 'none',
> {
	/** The type of a result row. Never set. */
	declare readonly $output: O;

	/** What the latest locking clause still takes. Never set. */
	declare readonly $lock: L;

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
	readonly where: Condition<RefsOf<T>, SelectQueryBuilder<T, O, L>> = (
		...args: ConditionArgs<RefsOf<T>>
	) =>
		new SelectQueryBuilder<T, O, L>({
			...this.#state,
			where: this.#state.where.add(args),
		});

	/**
	 * `inner join table on …`: rows of the tables so far with a matching row
	 * of `table`, whose columns are in scope from `on` onwards. A table
	 * already in the query is joined again under an alias:
	 * `innerJoin(users.as('managers'))`.
	 */
	innerJoin<J extends AnyTable>(
		table: J,
		..._newName: NewName<T, J>
	): JoinBuilder<T, J, O, L> {
		return new JoinBuilder<T, J, O, L>('inner', this.#joined(table), table);
	}

	/**
	 * `left join table on …`: like `innerJoin`, but keeps the rows with no
	 * match, with nulls for `table`'s columns, so they are all nullable in
	 * the row.
	 *
	 * @example .leftJoin(posts).on('posts.authorId', 'users.id')
	 */
	leftJoin<J extends AnyTable>(
		table: J,
		..._newName: NewName<T, J>
	): JoinBuilder<T, NullableTable<J>, O, L> {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the nullable table is the same table, typed for the rows without a match
		const state = this.#joined(table) as unknown as SelectState<
			[...T, NullableTable<J>]
		>;
		return new JoinBuilder<T, NullableTable<J>, O, L>('left', state, table);
	}

	/**
	 * `right join table on …`: like `innerJoin`, but keeps the rows of
	 * `table` with no match, with nulls for the columns of the tables joined
	 * before, so those are all nullable, the columns already selected
	 * included.
	 */
	rightJoin<J extends AnyTable>(
		table: J,
		..._newName: NewName<T, J>
	): JoinBuilder<OuterTables<T>, J, NullableRow<O>, L> {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the nullable tables are the same tables, typed for the rows without a match
		const state = this.#joined(table) as unknown as SelectState<
			[...OuterTables<T>, J]
		>;
		return new JoinBuilder<OuterTables<T>, J, NullableRow<O>, L>(
			'right',
			state,
			table,
		);
	}

	/**
	 * `full join table on …`: keeps the rows with no match on either side,
	 * so every column is nullable, the columns already selected included.
	 */
	fullJoin<J extends AnyTable>(
		table: J,
		..._newName: NewName<T, J>
	): JoinBuilder<OuterTables<T>, NullableTable<J>, NullableRow<O>, L> {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the nullable tables are the same tables, typed for the rows without a match
		const state = this.#joined(table) as unknown as SelectState<
			[...OuterTables<T>, NullableTable<J>]
		>;
		return new JoinBuilder<OuterTables<T>, NullableTable<J>, NullableRow<O>, L>(
			'full',
			state,
			table,
		);
	}

	/**
	 * `cross join table`: every row of the tables so far with every row of
	 * `table`. It takes no condition.
	 *
	 * @example .crossJoin(regions)
	 */
	crossJoin<J extends AnyTable>(
		table: J,
		..._newName: NewName<T, J>
	): SelectQueryBuilder<[...T, J], O, L> {
		const state = this.#joined(table);
		return new SelectQueryBuilder<[...T, J], O, L>({
			...state,
			joins: [
				...state.joins,
				{ kind: 'cross', table: tableNode(table), on: undefined },
			],
		});
	}

	/**
	 * Adds to the select list. A column is keyed by its name, an expression
	 * by its alias. Each key can be in the row once: selecting a second
	 * column of the same name is a type error, which `.as()` resolves.
	 *
	 * @example .select(['users.id', 'contacts.email'])
	 * @example .select((eb) => [eb.fn.lower('users.email').as('email')])
	 * @example .select((eb) => ['users.email', eb.ref('managers.email').as('managerEmail')])
	 */
	select<const S extends readonly Selection<RefsOf<T>>[]>(
		selections: S | ((eb: ExpressionBuilder<RefsOf<T>>) => S),
		..._unique: UniqueKeys<O, S>
	): SelectQueryBuilder<T, AddRow<O, RowOf<RefsOf<T>, S[number]>>, L> {
		const eb = expressionBuilder(...this.#state.tables);
		const list = typeof selections === 'function' ? selections(eb) : selections;
		return new SelectQueryBuilder<T, AddRow<O, RowOf<RefsOf<T>, S[number]>>, L>(
			this.#selecting(selectionNodes(eb, list)),
		);
	}

	/**
	 * Selects every column of `table`, the name a table goes by in the query
	 * (its alias, or its name when not aliased), each keyed by its name.
	 * Each column is listed, never `*`, so it is keyed and decoded like a
	 * selected column. Two tables with a column of the same name can't both
	 * be selected whole: select one with `select` and `.as()`.
	 *
	 * @example .selectAll('users')
	 * @example .selectAll('u') // after selectFrom(users.as('u'))
	 */
	selectAll<N extends T[number]['name']>(
		table: N,
		..._unique: UniqueColumns<O, TableRefs<RefsOf<T>, N>>
	): SelectQueryBuilder<
		T,
		AddRow<O, RowOf<RefsOf<T>, TableRefs<RefsOf<T>, N>>>,
		L
	> {
		const tables = tablesNamed(this.#state.tables, table);
		if (tables.length === 0) {
			throw new Error(`selectAll: "${table}" is not in the query`);
		}
		const [only] = tables;
		return new SelectQueryBuilder<
			T,
			AddRow<O, RowOf<RefsOf<T>, TableRefs<RefsOf<T>, N>>>,
			L
		>(
			tables.length === 1 &&
				only !== undefined &&
				this.#state.selections.length === 0
				? // one table's columns, keyed by its column keys: unique
					{ ...this.#state, selections: allSelections(only) }
				: this.#selecting(tables.flatMap((t) => allSelections(t))),
		);
	}

	/**
	 * Adds `distinct`: the query returns each distinct row once, compared
	 * over every selected column.
	 *
	 * @example .select(['users.role']).distinct()
	 */
	distinct(): SelectQueryBuilder<T, O, L> {
		return new SelectQueryBuilder<T, O, L>({ ...this.#state, distinct: true });
	}

	/**
	 * Adds `distinct on (keys)`: the query returns the first row of each
	 * group of rows with equal `keys`, first by `orderBy`, whose leading keys
	 * must be these. Replaces `distinct`, and an earlier `distinctOn`.
	 *
	 * @example .distinctOn(['posts.authorId']).orderBy('posts.authorId').orderBy('posts.createdAt', 'desc') // latest post per author
	 */
	distinctOn(
		keys:
			| readonly [Key<RefsOf<T>, O>, ...Key<RefsOf<T>, O>[]]
			| ((
					eb: ExpressionBuilder<RefsOf<T>>,
			  ) => readonly [Key<RefsOf<T>, O>, ...Key<RefsOf<T>, O>[]]),
	): SelectQueryBuilder<T, O, L> {
		return new SelectQueryBuilder<T, O, L>({
			...this.#state,
			distinct: this.#keys(keys),
		});
	}

	/**
	 * Adds to the `group by` list: a column, a selected column by its key in
	 * the row, or an expression, so the query returns one row per group and
	 * its aggregates (`eb.fn.count()` and the like) are per group. Postgres
	 * checks that every other selected column is grouped or aggregated.
	 *
	 * @example .groupBy(['users.id'])
	 * @example .groupBy((eb) => [eb.fn.dateTrunc('month', 'orders.createdAt')])
	 */
	groupBy(
		keys:
			| readonly Key<RefsOf<T>, O>[]
			| ((eb: ExpressionBuilder<RefsOf<T>>) => readonly Key<RefsOf<T>, O>[]),
	): SelectQueryBuilder<T, O, L> {
		return new SelectQueryBuilder<T, O, L>({
			...this.#state,
			groupBy: [...this.#state.groupBy, ...this.#keys(keys)],
		});
	}

	/**
	 * Adds a condition to the `having` clause, which filters the groups of
	 * `groupBy` (or the one group of an aggregate query), in any form
	 * `where` takes, joined to the others by `and`.
	 *
	 * @example .having((eb) => eb.fn.count('posts.id').gte(5))
	 */
	readonly having: Condition<RefsOf<T>, SelectQueryBuilder<T, O, L>> = (
		...args: ConditionArgs<RefsOf<T>>
	) =>
		new SelectQueryBuilder<T, O, L>({
			...this.#state,
			having: this.#state.having.add(args),
		});

	/**
	 * Adds a key to the `order by` list, after those before: a column, a
	 * selected column by its key in the row, or an expression, ascending
	 * unless `direction` is `'desc'`. `nulls` puts nulls first or last;
	 * postgres puts them last when ascending, first when descending.
	 *
	 * @example .orderBy('posts.createdAt', 'desc')
	 * @example .orderBy('postCount', 'desc')
	 * @example .orderBy((eb) => eb.fn.lower('users.name'), 'asc', { nulls: 'last' })
	 */
	orderBy(
		key:
			| Key<RefsOf<T>, O>
			| ((eb: ExpressionBuilder<RefsOf<T>>) => Key<RefsOf<T>, O>),
		direction?: 'asc' | 'desc',
		options?: { readonly nulls?: 'first' | 'last' | undefined },
	): SelectQueryBuilder<T, O, L> {
		const [expression] = this.#keys([key]);
		if (expression === undefined) throw new Error('orderBy needs a key');
		return new SelectQueryBuilder<T, O, L>({
			...this.#state,
			orderBy: [
				...this.#state.orderBy,
				{ expression, direction, nulls: options?.nulls },
			],
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
	when<P, B extends LockState>(
		condition: boolean,
		build: (qb: Fragment<T>) => SelectQueryBuilder<T, P, B>,
	): SelectQueryBuilder<T, WhenRow<O, P>, LockAfter<L, B>> {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the row type doesn't affect what `build` can do; `WhenRow` adds the earlier columns back
		const query = condition ? build(this as unknown as Fragment<T>) : this;
		return new SelectQueryBuilder<T, WhenRow<O, P>, LockAfter<L, B>>(
			query.#state,
		);
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
	): SelectQueryBuilder<
		[...T, ...JoinedBy<Q, P>],
		AddRow<O, Q['$output']>,
		LockAfter<L, Q['$lock']>
	> {
		type Tables = [...T, ...JoinedBy<Q, P>];
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- `InScope` checks every reference the fragment can make is in scope here
		const query = piece(this as unknown as Fragment<P>);
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the fragment returned a query built on this one's state
		const built = query as unknown as this;
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- that state has these tables, then the fragment's joins
		const state = built.#state as unknown as SelectState<Tables>;
		return new SelectQueryBuilder<
			Tables,
			AddRow<O, Q['$output']>,
			LockAfter<L, Q['$lock']>
		>(state);
	}

	/**
	 * Adds `for update`: locks the rows the query returns against updates,
	 * deletes and other locks until the transaction ends, so run it in
	 * `db.transaction`; on its own, the statement's transaction releases the
	 * locks as it returns. The other strengths are `forNoKeyUpdate`,
	 * `forShare` and `forKeyShare`.
	 *
	 * Right after it, `of(...)` limits the lock to some of the query's tables,
	 * and `skipLocked()` or `noWait()` says what to do with rows already
	 * locked (by default, wait for them). A query can have several locking
	 * clauses, usually each `of` different tables; postgres takes the
	 * strongest lock where they overlap. A query with a locking clause can't
	 * select aggregates: compiling it throws.
	 *
	 * The result shapes add no `limit`, so every row the query returns is
	 * locked: `.limit(1)` locks one.
	 *
	 * @example .forUpdate()
	 * @example .forUpdate().of(jobs).skipLocked()
	 * @example .forUpdate().of(jobs).forShare().of(users)
	 */
	forUpdate(): SelectQueryBuilder<T, O, 'strength'> {
		return this.#lock('update');
	}

	/**
	 * Adds `for no key update`: like `forUpdate`, but doesn't block inserts
	 * that reference the rows by foreign key (`forKeyShare`). The lock an
	 * `update` that leaves the key alone takes.
	 */
	forNoKeyUpdate(): SelectQueryBuilder<T, O, 'strength'> {
		return this.#lock('no key update');
	}

	/**
	 * Adds `for share`: other transactions can share-lock the rows too, but
	 * not update, delete or `forUpdate` them.
	 */
	forShare(): SelectQueryBuilder<T, O, 'strength'> {
		return this.#lock('share');
	}

	/**
	 * Adds `for key share`: like `forShare`, but blocks only `forUpdate`,
	 * deletes and updates that change the key, not other updates. The lock a
	 * foreign key check takes.
	 */
	forKeyShare(): SelectQueryBuilder<T, O, 'strength'> {
		return this.#lock('key share');
	}

	/**
	 * Limits the latest locking clause to `tables`, each in this query: a
	 * table, or the name it's referenced by (its alias, for an aliased table).
	 * Rows of the other tables are read without a lock.
	 *
	 * @example .forUpdate().of(jobs)
	 * @example .forUpdate().of('jobs', 'workers')
	 */
	of(
		this: SelectQueryBuilder<T, O, 'strength'>,
		...tables: readonly [LockTarget<T>, ...LockTarget<T>[]]
	): SelectQueryBuilder<T, O, 'of'> {
		const of = tables.map((table) =>
			typeof table === 'string' ? table : table.name,
		);
		return this.#modifyLock<'of'>('of()', (lock) => {
			if (lock.of.length > 0 || lock.wait !== undefined) {
				throw new Error(
					'of() comes right after forUpdate(), forNoKeyUpdate(), forShare() or forKeyShare()',
				);
			}
			return { ...lock, of };
		});
	}

	/**
	 * Skips the rows another transaction has locked, rather than waiting for
	 * them: for workers claiming jobs from a queue, each a different one.
	 *
	 * @example await tx.selectFrom(jobs).select(['jobs.id']).where('jobs.status', 'queued').forUpdate().skipLocked().limit(1).takeFirst().execute()
	 */
	skipLocked(
		this: SelectQueryBuilder<T, O, 'strength' | 'of'>,
	): SelectQueryBuilder<T, O, 'done'> {
		return this.#wait('skip locked');
	}

	/**
	 * Fails with `LockNotAvailable` if a row is locked by another
	 * transaction, rather than waiting for it.
	 */
	noWait(
		this: SelectQueryBuilder<T, O, 'strength' | 'of'>,
	): SelectQueryBuilder<T, O, 'done'> {
		return this.#wait('nowait');
	}

	/**
	 * Labels the query, e.g. for logging or tracing. The tag goes to the
	 * executor with the compiled query and is never written into its SQL. A
	 * later call replaces it.
	 *
	 * @example .tag('users.findByEmail')
	 */
	tag(name: string): SelectQueryBuilder<T, O, L> {
		return new SelectQueryBuilder<T, O, L>({ ...this.#state, tag: name });
	}

	/**
	 * Adds `limit count`: the query returns at most `count` rows. No result
	 * shape adds one. A later call replaces it.
	 *
	 * @example .forUpdate().skipLocked().limit(1)
	 */
	limit(count: number): SelectQueryBuilder<T, O, L> {
		if (!Number.isInteger(count) || count < 0) {
			throw new RangeError(`limit takes a whole number of rows, not ${count}`);
		}
		return new SelectQueryBuilder<T, O, L>({ ...this.#state, limit: count });
	}

	/**
	 * Adds `offset count`: the query skips its first `count` rows. Postgres
	 * still reads the rows it skips, so a deep offset is slow; keyset
	 * pagination (`paginateByCursor`, `iterateChunks`) is not. A
	 * later call replaces it.
	 *
	 * @example .orderBy('posts.id').limit(20).offset(40)
	 */
	offset(count: number): SelectQueryBuilder<T, O, L> {
		if (!Number.isInteger(count) || count < 0) {
			throw new RangeError(`offset takes a whole number of rows, not ${count}`);
		}
		return new SelectQueryBuilder<T, O, L>({ ...this.#state, offset: count });
	}

	/**
	 * The first row, if any; runs with `execute()`. Never throws for the
	 * number of rows, and adds no `limit`: the query returns every row it
	 * finds and only the first is decoded. Add `.limit(1)` to fetch (or
	 * lock) only one.
	 *
	 * @example await db.selectFrom(users).where('users.email', email).select(['users.id']).takeFirst().execute()
	 */
	takeFirst(): Query<O | undefined> {
		return this.#query(takeFirst<O>());
	}

	/**
	 * The value of the one selected column in the first row, if any; runs
	 * with `execute()`. Never throws for the number of rows, and adds no
	 * `limit`. The row must have one column, since its type doesn't record
	 * which comes first.
	 *
	 * @example await db.selectFrom(users).select((eb) => [eb.fn.count().as('count')]).takeValue().execute()
	 */
	takeValue(
		..._oneColumn: ValueArgs<O, []>
	): Query<ColumnValue<O> | undefined> {
		return this.#query(takeValue<ColumnValue<O>>());
	}

	/**
	 * Every row, as a non-empty array; runs with `execute()`, which throws
	 * `NoRowError` (or what `err` makes of it) when there is none.
	 *
	 * @example .expectNonEmpty(() => new HttpError(404, 'No posts'))
	 */
	expectNonEmpty(err?: ErrorFor<NoRowError>): Query<[O, ...O[]]> {
		return this.#query(expectNonEmpty<O>(err));
	}

	/**
	 * The first row; runs with `execute()`, which throws `NoRowError` (or
	 * what `err` makes of it) when there is none. Other rows are ignored;
	 * the shape adds no `limit`.
	 */
	expectFirst(err?: ErrorFor<NoRowError>): Query<O> {
		return this.#query(expectFirst<O>(err));
	}

	/**
	 * The one row; runs with `execute()`, which throws `NoRowError` when
	 * there is none and `TooManyRowsError` when there are several, with
	 * their `count`; `err` makes the error to throw instead. The shape adds
	 * no `limit`, and decodes at most two rows.
	 *
	 * @example .expectOne()
	 * @example .expectOne((error) => (error instanceof NoRowError ? new HttpError(404) : error))
	 */
	expectOne(err?: ErrorFor<NoRowError | TooManyRowsError>): Query<O> {
		return this.#query(expectOne<O>(err));
	}

	/**
	 * The row, if any; runs with `execute()`, which throws
	 * `TooManyRowsError` (or what `err` makes of it) when there are
	 * several. The shape adds no `limit`.
	 */
	expectAtMostOne(err?: ErrorFor<TooManyRowsError>): Query<O | undefined> {
		return this.#query(expectAtMostOne<O>(err));
	}

	/**
	 * The value of the one selected column in the first row; runs with
	 * `execute()`, which throws `NoRowError` (or what `err` makes of it)
	 * when there is no row. The row must have one column.
	 *
	 * @example .select(['users.email']).expectValue()
	 */
	expectValue(
		...args: ValueArgs<O, [err?: ErrorFor<NoRowError>]>
	): Query<ColumnValue<O>> {
		return this.#query(expectValue<ColumnValue<O>>(errorArg(args)));
	}

	/** Runs the query and returns every row. */
	execute(options?: RunOptions): Promise<O[]> {
		return this.toQuery().execute(options);
	}

	/** The SQL and parameters `execute()` sends. */
	toSQL(): CompiledQuery {
		return compile(this.toNode());
	}

	/** The query `execute()` runs: every row. */
	toQuery(): Query<O[]> {
		return this.#query(allRows<O>());
	}

	/** @deprecated A query runs with `execute()`; awaiting one rejects. */
	// oxlint-disable-next-line unicorn/no-thenable -- so that a forgotten execute() fails loudly
	readonly then = rejectAwait;

	/**
	 * Runs the query through a cursor and yields its rows, decoded as
	 * `execute()` decodes them. Rows are fetched `batchSize` (default 1000)
	 * at a time, each batch once the rows before it are taken, so a large
	 * result never sits in memory at once and a slow loop holds one batch.
	 * Nothing runs until the first row is asked for.
	 *
	 * On a pool, the stream has a connection of its own until it ends:
	 * read to the end, left early (`break`, `return`, a throw) or aborted
	 * with `signal`. Inside `db.transaction`, other queries of the
	 * transaction can run in the loop, between batches. A `timeout` bounds
	 * the whole stream, the loop's time included.
	 *
	 * Only every row streams: the `take…` and `expect…` shapes read a whole
	 * result, so they have no `stream`.
	 *
	 * @example
	 * for await (const user of db.selectFrom(users).select(['users.id']).stream()) { … }
	 *
	 * @example
	 * Readable.from(db.selectFrom(users).select(['users.email']).stream({ batchSize: 500, signal }))
	 */
	stream(options?: StreamOptions): RowStream<O> {
		const executor = this.#executor();
		const batchSize = options?.batchSize;
		if (
			batchSize !== undefined &&
			(!Number.isInteger(batchSize) || batchSize < 1)
		) {
			throw new RangeError(
				`batchSize takes a whole number of rows from 1, not ${batchSize}`,
			);
		}
		const query = compile(this.toNode());
		const iterate = () => {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the select list supplies the row type
			const batches = executor.stream(query, options) as AsyncIterable<
				readonly O[]
			>;
			return batches[Symbol.asyncIterator]();
		};
		return new RowStream<O>({ [Symbol.asyncIterator]: iterate });
	}

	/** The query's parameter and result types, as the server reports them without running it. */
	describe(): Promise<QueryDescription> {
		return this.#executor().describe(compile(this.toNode()));
	}

	/**
	 * Runs the query in batches of `size` rows, ordered by the key `by`, and
	 * yields each batch as it arrives: keyset pagination, each batch its own
	 * query. A batch adds `order by key limit size` to the query, and every
	 * batch after the first `where key > last key` (`(a, b) > (…)` for a
	 * composite key; `<` with `direction: 'desc'`): no `offset`, so a batch
	 * costs the same however far in it is, and holds no connection or cursor
	 * open between batches, unlike `stream()`. The iteration ends with a
	 * batch of fewer than `size` rows, or an empty one. Breaking out of the
	 * loop stops it.
	 *
	 * It owns the order and the limit: on a query that already has
	 * `orderBy()`, `limit()` or `offset()`, it throws, rather than combine
	 * them. Order with `by` and `direction` instead.
	 *
	 * The key columns must together be unique and non-null, and be selected,
	 * since each batch's last row gives the next one's start. They are read
	 * as the server's text and decoded by their codecs, so the next batch
	 * seeks from the exact value even where the decoded one is rounded (a
	 * timestamptz's microseconds, in a `Date`). Each batch sees
	 * the rows committed when it runs: rows inserted ahead of the key's
	 * position show up, those behind it don't, and no row is read twice.
	 * Run in `db.transaction` (`repeatable read`, for one snapshot) to see
	 * the table as of one moment, or to keep the locks of a `forUpdate()`.
	 *
	 * @example
	 * for await (const batch of db.selectFrom(users).select(['users.id', 'users.email']).iterateChunks(1000, { by: 'users.id' })) { … }
	 * @example .iterateChunks(500, { by: ['posts.createdAt', 'posts.id'], direction: 'desc' })
	 */
	async *iterateChunks(
		size: number,
		options: KeysetOptions<KeyColumn<T, O>>,
	): AsyncGenerator<O[], void, undefined> {
		checkSize('iterateChunks', 'size', size);
		const executor = this.#executor();
		const base = this.toNode();
		const keyset = resolveKeyset(
			'iterateChunks',
			this.#state.tables,
			base,
			options.by,
			options.direction,
			true,
		);
		const run = runOptions(options);
		let after: readonly string[] | undefined;
		for (;;) {
			const query = compile(seekPage(base, keyset, after, size));
			// oxlint-disable-next-line no-await-in-loop -- each batch starts after the last
			const { rows } = await executor.execute(query, run);
			after = readKeys(keyset, rows, 'iterateChunks');
			if (after === undefined) return;
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the select list supplies the row type
			yield rows as O[];
			if (rows.length < size) return;
		}
	}

	/**
	 * Runs the query for one page of `perPage` rows, ordered by the key `by`,
	 * from the row after the cursor `after`: keyset pagination, for APIs.
	 * Adds `order by key limit perPage + 1` to the query, and with `after`,
	 * `where key > cursor's key` (`<` with `direction: 'desc'`); the extra row
	 * only tells whether there is a next page. `nextCursor` is what `after`
	 * takes for the next page, or `null` on the last.
	 *
	 * It owns the order and the limit: on a query that already has
	 * `orderBy()`, `limit()` or `offset()`, it throws, rather than combine
	 * them. Order with `by` and `direction` instead.
	 *
	 * The key columns must together be unique and non-null, and be selected;
	 * as with `iterateChunks`, the cursor holds their exact values. A
	 * cursor is base64url JSON of the last row's key values: opaque to
	 * clients, but not signed or encrypted. A cursor made for another key or
	 * direction, or altered, rejects with `InvalidCursorError`.
	 *
	 * @example
	 * const { rows, nextCursor, hasMore } = await db.selectFrom(posts).select(['posts.id', 'posts.title']).paginateByCursor({ perPage: 20, by: 'posts.id', after: request.query.cursor });
	 */
	async paginateByCursor(
		options: CursorPageOptions<KeyColumn<T, O>>,
	): Promise<CursorPage<O>> {
		const { perPage, after } = options;
		checkSize('paginateByCursor', 'perPage', perPage);
		const executor = this.#executor();
		const base = this.toNode();
		const keyset = resolveKeyset(
			'paginateByCursor',
			this.#state.tables,
			base,
			options.by,
			options.direction,
			true,
		);
		const start =
			after === undefined || after === null
				? undefined
				: decodeCursor(keyset, after);
		const { rows } = await executor.execute(
			compile(seekPage(base, keyset, start, perPage + 1)),
			runOptions(options),
		);
		const page = rows.slice(0, perPage);
		const last = readKeys(keyset, page, 'paginateByCursor');
		const hasMore = rows.length > perPage && last !== undefined;
		return {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the select list supplies the row type
			rows: page as O[],
			nextCursor: hasMore ? encodeCursor(keyset, last) : null,
			hasMore,
		};
	}

	/**
	 * Runs the query for page `page` (from 1) of `perPage` rows, ordered by
	 * `by`: offset pagination, for numbered pages. Adds `order by by limit
	 * perPage + 1 offset (page - 1) * perPage` to the query; the extra row
	 * only tells whether there is a next page. The server still reads every
	 * row before the page, so deep pages get slower; `paginateByCursor`
	 * doesn't. Rows inserted or deleted between requests shift the pages.
	 *
	 * It owns the order and the limit: on a query that already has
	 * `orderBy()`, `limit()` or `offset()`, it throws, rather than combine
	 * them. Order with `by` and `direction` instead.
	 *
	 * `by` should be unique, so that every row is on exactly one page. With
	 * `countTotal: true`, it also runs `select count(*)` over the query's
	 * joins and `where`, in the same round trip, into `total`.
	 *
	 * @example await db.selectFrom(users).select(['users.id', 'users.email']).paginateByOffset({ page: 2, perPage: 50, by: 'users.id' })
	 * @example .paginateByOffset({ page, perPage: 50, by: ['users.lastName', 'users.id'], countTotal: true })
	 */
	paginateByOffset(
		options: OffsetPageOptions<Ref<RefsOf<T>>> & { readonly countTotal: true },
	): Promise<OffsetPage<O> & { readonly total: number }>;
	paginateByOffset(
		options: OffsetPageOptions<Ref<RefsOf<T>>>,
	): Promise<OffsetPage<O>>;
	async paginateByOffset(
		options: OffsetPageOptions<Ref<RefsOf<T>>>,
	): Promise<OffsetPage<O> & { readonly total?: number }> {
		const { page, perPage, countTotal = false } = options;
		checkSize('paginateByOffset', 'perPage', perPage);
		if (!Number.isInteger(page) || page < 1) {
			throw new RangeError(
				`paginateByOffset() takes a page from 1, not ${page}`,
			);
		}
		const executor = this.#executor();
		const base = this.toNode();
		const keyset = resolveKeyset(
			'paginateByOffset',
			this.#state.tables,
			base,
			options.by,
			options.direction,
			false,
		);
		const query = compile({
			...base,
			orderBy: orderBy(keyset),
			limit: perPage + 1,
			offset: (page - 1) * perPage,
		});
		const run = runOptions(options);
		let rows: readonly unknown[];
		let total: number | undefined;
		if (countTotal) {
			const unlocked: SelectNode = { ...base, locks: [] };
			// a grouped or distinct query counts its result rows, not the table's
			const count = compile(
				base.distinct !== undefined ||
					(base.groupBy?.length ?? 0) > 0 ||
					base.having !== undefined
					? {
							kind: 'raw',
							fragments: [
								'select count(*) as "count" from (',
								') as "quarry_rows"',
							],
							nodes: [unlocked],
						}
					: {
							...unlocked,
							selections: [
								{
									expression: {
										kind: 'function',
										name: 'count',
										args: [{ kind: 'raw', fragments: ['*'], nodes: [] }],
									},
									alias: 'count',
									codec: undefined,
								},
							],
						},
			);
			const [pageResult, countResult] = await executor.batch(
				[{ query }, { query: count, rowMode: 'array' }],
				run,
			);
			rows = settled(pageResult).rows;
			const [countRow] = settled(countResult).rows;
			total = Number(Array.isArray(countRow) ? countRow[0] : countRow);
		} else {
			({ rows } = await executor.execute(query, run));
		}
		return {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the select list supplies the row type
			rows: rows.slice(0, perPage) as O[],
			page,
			perPage,
			hasMore: rows.length > perPage,
			...(total === undefined ? {} : { total }),
		};
	}

	/** The whole query as one node. */
	toNode(): SelectNode {
		const state = this.#state;
		return {
			kind: 'select',
			distinct: state.distinct,
			selections: state.selections,
			from: state.from,
			joins: state.joins,
			where: state.where.toNode(),
			groupBy: state.groupBy,
			having: state.having.toNode(),
			orderBy: state.orderBy,
			limit: state.limit,
			offset: state.offset,
			locks: state.locks,
			tag: state.tag,
		};
	}

	/** The state with `table` joined, its scope widened to it; throws when its name is taken. */
	#joined<J extends AnyTable>(table: J): SelectState<[...T, J]> {
		if (this.#state.tables.some((t) => t.name === table.name)) {
			throw new Error(
				`"${table.name}" is already in the query: join it under another name, e.g. ${table.name}.as('other')`,
			);
		}
		const tables: [...T, J] = [...this.#state.tables, table];
		const eb = expressionBuilder(...tables);
		return {
			...this.#state,
			tables,
			where: this.#state.where.rescope(eb),
			having: this.#state.having.rescope(eb),
		};
	}

	/** The state with `added` selected; throws when a key is taken. */
	#selecting(added: readonly SelectionNode[]): SelectState<T> {
		const { selections } = this.#state;
		checkUniqueKeys(selections, added);
		return {
			...this.#state,
			// lists are never changed in place, so the first one is kept as is
			selections: selections.length === 0 ? added : [...selections, ...added],
		};
	}

	/**
	 * The nodes of `group by`, `order by` or `distinct on` keys: a reference
	 * (`table.column`), a selected column by its key (no dot), an
	 * expression, or a callback making one.
	 */
	#keys(
		keys:
			| readonly KeyArg<RefsOf<T>>[]
			| ((eb: ExpressionBuilder<RefsOf<T>>) => readonly KeyArg<RefsOf<T>>[]),
	): (OperationNode | AliasNode)[] {
		const eb = expressionBuilder(...this.#state.tables);
		const list = typeof keys === 'function' ? keys(eb) : keys;
		return list.map((key): OperationNode | AliasNode => {
			const item = typeof key === 'function' ? key(eb) : key;
			if (typeof item !== 'string') return item._quarry.node;
			if (item.includes('.')) return eb.ref(item)._quarry.node;
			if (!this.#state.selections.some((s) => s.alias === item)) {
				throw new Error(
					`"${item}" is not a key of the row: select it first, or name a column as 'table.column'`,
				);
			}
			return { kind: 'alias', alias: item };
		});
	}

	/**
	 * The `where` clause as one node, `undefined` when it is empty. For
	 * inspecting the conditions on their own.
	 */
	toWhereNode(): OperationNode | undefined {
		return this.#state.where.toNode();
	}

	#lock(strength: LockNode['strength']): SelectQueryBuilder<T, O, 'strength'> {
		return new SelectQueryBuilder<T, O, 'strength'>({
			...this.#state,
			locks: [...this.#state.locks, { strength, of: [], wait: undefined }],
		});
	}

	#wait(wait: LockNode['wait']): SelectQueryBuilder<T, O, 'done'> {
		const method = wait === 'nowait' ? 'noWait()' : 'skipLocked()';
		return this.#modifyLock<'done'>(method, (lock) => {
			if (lock.wait !== undefined) {
				throw new Error(
					'A locking clause takes one of skipLocked() and noWait()',
				);
			}
			return { ...lock, wait };
		});
	}

	/** Replaces the latest locking clause with what `modify` makes of it. */
	#modifyLock<N extends LockState>(
		method: string,
		modify: (lock: LockNode) => LockNode,
	): SelectQueryBuilder<T, O, N> {
		const { locks } = this.#state;
		const latest = locks.at(-1);
		if (latest === undefined) {
			throw new Error(
				`${method} needs a locking clause first: forUpdate(), forNoKeyUpdate(), forShare() or forKeyShare()`,
			);
		}
		return new SelectQueryBuilder<T, O, N>({
			...this.#state,
			locks: [...locks.slice(0, -1), modify(latest)],
		});
	}

	#executor(): Executor {
		const { executor } = this.#state;
		if (executor === undefined) {
			throw new Error(
				'The query has no database to run on: start it from `database(...).selectFrom(...)`',
			);
		}
		return executor;
	}

	/** The query, read by `shape`. */
	#query<R>(shape: Shape<R>): Query<R> {
		return shapedQuery(
			this.#state.executor,
			compile(this.toNode()),
			this.#state.from.name,
			shape,
		);
	}
}

/** The tables in scope named `name`. */
function tablesNamed<T extends readonly AnyTable[]>(
	tables: T,
	name: string,
): readonly T[number][] {
	return tables.filter((t) => t.name === name);
}

/**
 * A join of `J` onto the tables `T`, waiting for its `on` condition. The
 * joined table is already in scope, so the condition can reference it.
 */
export class JoinBuilder<
	T extends readonly AnyTable[],
	J extends AnyTable,
	O,
	L extends LockState = 'none',
> {
	readonly #kind: JoinNode['kind'];
	readonly #state: SelectState<[...T, J]>;
	readonly #table: AnyTable;

	constructor(
		kind: JoinNode['kind'],
		state: SelectState<[...T, J]>,
		table: AnyTable,
	) {
		this.#kind = kind;
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
		SelectQueryBuilder<[...T, J], O, L>
	> = (...args: OnArgs<RefsOf<[...T, J]>>) =>
		new SelectQueryBuilder<[...T, J], O, L>({
			...this.#state,
			joins: [
				...this.#state.joins,
				{
					kind: this.#kind,
					table: tableNode(this.#table),
					on: this.#conditionOf(args),
				},
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
