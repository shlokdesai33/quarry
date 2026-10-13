import { compile, type CompiledQuery } from './compile.js';
import type { DataType } from './data-type/data-type.js';
import {
	type Executor,
	NoRowError,
	type QueryDescription,
	type RunOptions,
	type StreamOptions,
	TooManyRowsError,
} from './executor.js';
import { Expression, type TypedExpression } from './expression.js';
import {
	type ExpressionBuilder,
	expressionBuilder,
} from './expression-builder.js';
import type {
	JoinNode,
	LockNode,
	OperationNode,
	SelectNode,
	SelectionNode,
	TableNode,
} from './node.js';
import type { AnyPredicate, EqualsValue } from './operators.js';
import { Query, rejectAwait } from './query.js';
import type { Ref, Refs, RefsOf } from './refs.js';
import {
	type AddRow,
	type RowOf,
	type Selection,
	selectionNodes,
} from './row.js';
import { type AnyTable, tableNode } from './table.js';
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
	Q extends SelectQueryBuilder<infer T, unknown, LockState>
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
	return new SelectQueryBuilder<[T], Record<never, never>>({
		tables,
		from: tableNode(table),
		joins: [],
		where: new WhereBuilder(expressionBuilder(...tables)),
		selections: [],
		limit: undefined,
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
 * Nothing runs until `execute()` (or `stream`, or `db.batch`): `all`,
 * `first`, `one` and `maybeOne` only set the shape of the result, keeping
 * its locking clauses.
 *
 * Immutable: every method returns a new builder. `L` is what its latest
 * locking clause still takes, if it has one.
 *
 * @example
 * const user = await db.selectFrom(users).where('users.id', id).select(['users.email']).one().execute();
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

	/** Joins `table`, whose columns are in scope from `on` onwards. */
	innerJoin<J extends AnyTable>(table: J): JoinBuilder<T, J, O, L> {
		const tables: [...T, J] = [...this.#state.tables, table];
		return new JoinBuilder<T, J, O, L>(
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
	): SelectQueryBuilder<T, AddRow<O, RowOf<RefsOf<T>, S[number]>>, L> {
		const eb = expressionBuilder(...this.#state.tables);
		const list = typeof selections === 'function' ? selections(eb) : selections;
		const added = selectionNodes(eb, list);
		return new SelectQueryBuilder<T, AddRow<O, RowOf<RefsOf<T>, S[number]>>, L>(
			{
				...this.#state,
				selections: [...this.#state.selections, ...added],
			},
		);
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
	 * `one()` and `maybeOne()` fetch two rows to tell if there are several,
	 * so they lock up to two; `first()` locks one.
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
	 * @example await tx.selectFrom(jobs).select(['jobs.id']).where('jobs.status', 'queued').forUpdate().skipLocked().first().execute()
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

	/** Every row; runs with `execute()`. */
	all(): Query<O[]> {
		return this.#query(undefined, false, (rows) => rows);
	}

	/** The row, if any, with `limit 1`; runs with `execute()`. */
	first(): Query<O | undefined> {
		return this.#query(1, false, (rows) => rows[0]);
	}

	/**
	 * The one row; runs with `execute()`, which throws `NoRowError` when
	 * there is none and `TooManyRowsError` when there are several. Fetches at
	 * most two rows (`limit 2`), enough to tell.
	 */
	one(): Query<O> {
		return this.#query(2, true, (rows, query) => {
			const [row, ...rest] = rows;
			if (row === undefined) {
				throw new NoRowError(query, this.#state.from.name);
			}
			if (rest.length > 0) {
				throw new TooManyRowsError(query, this.#state.from.name);
			}
			return row;
		});
	}

	/**
	 * The row, if any; runs with `execute()`, which throws
	 * `TooManyRowsError` when there are several. Fetches at most two rows.
	 */
	maybeOne(): Query<O | undefined> {
		return this.#query(2, true, (rows, query) => {
			const [row, ...rest] = rows;
			if (rest.length > 0) {
				throw new TooManyRowsError(query, this.#state.from.name);
			}
			return row;
		});
	}

	/** Runs the query and returns every row, as `all().execute()` does. */
	execute(options?: RunOptions): Promise<O[]> {
		return this.all().execute(options);
	}

	/** The SQL and parameters `execute()` sends. */
	toSQL(): CompiledQuery {
		return compile(this.toNode());
	}

	/** The query `execute()` runs: every row. */
	toQuery(): Query<O[]> {
		return this.all();
	}

	/** @deprecated A query runs with `execute()`; awaiting one rejects. */
	// oxlint-disable-next-line unicorn/no-thenable -- so that a forgotten execute() fails loudly
	readonly then = rejectAwait;

	/**
	 * Runs the query and yields its rows as they arrive, fetching
	 * `batchSize` (default 1000) at a time through a cursor, so a large
	 * result never sits in memory at once. Breaking out of the loop stops
	 * the query.
	 *
	 * @example
	 * for await (const user of db.selectFrom(users).select(['users.id']).stream()) { … }
	 */
	async *stream(options?: StreamOptions): AsyncGenerator<O, void, undefined> {
		const executor = this.#executor();
		for await (const batch of executor.stream(
			compile(this.toNode()),
			options,
		)) {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the select list supplies the row type
			yield* batch as readonly O[];
		}
	}

	/** The query's parameter and result types, as the server reports them without running it. */
	describe(): Promise<QueryDescription> {
		return this.#executor().describe(compile(this.toNode()));
	}

	/** The whole query as one node. */
	toNode(): SelectNode {
		const { from, joins, where, selections, limit, locks, tag } = this.#state;
		return {
			kind: 'select',
			selections,
			from,
			joins,
			where: where.toNode(),
			limit,
			locks,
			tag,
		};
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

	/** The query, fetching at most `limit` rows besides any limit of its own, read by `read`. */
	#query<R>(
		limit: number | undefined,
		checked: boolean,
		read: (rows: O[], query: CompiledQuery) => R,
	): Query<R> {
		const node = this.toNode();
		const query = compile(
			limit === undefined
				? node
				: { ...node, limit: Math.min(node.limit ?? limit, limit) },
		);
		return new Query({
			query,
			executor: this.#state.executor,
			checked,
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the select list supplies the row type
			read: ({ rows }) => read(rows as O[], query),
		});
	}
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
		SelectQueryBuilder<[...T, J], O, L>
	> = (...args: OnArgs<RefsOf<[...T, J]>>) =>
		new SelectQueryBuilder<[...T, J], O, L>({
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
