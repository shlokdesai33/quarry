import type { Executor } from './executor.js';
import {
	type ExpressionBuilder,
	expressionBuilder,
} from './expression-builder.js';
import type {
	ConflictActionNode,
	InsertNode,
	OnConflictNode,
	SelectionNode,
} from './node.js';
import type { AnyPredicate } from './operators.js';
import type { Ref, RefsOf } from './refs.js';
import {
	type AddRow,
	allColumns,
	returningNodes,
	type RowOf,
	type Selection,
	selectionNodes,
	type UniqueColumns,
	type UniqueKeys,
} from './row.js';
import { type AnyTable, tableNode } from './table.js';
import type { InferInsertType } from './types.js';
import {
	type Condition,
	type ConditionArgs,
	WhereBuilder,
} from './where-builder.js';
import {
	type ColumnKey,
	columnOf,
	type Current,
	excluded,
	type Excluded,
	rowsNode,
	setNodes,
	type SetValues,
	type UpdateKey,
	WriteQueryBuilder,
} from './write-query.js';

/** What an `insert` into `T` has recorded so far. */
interface InsertState<T extends AnyTable> {
	readonly table: T;
	readonly values: InsertNode['values'];
	readonly onConflict: OnConflictNode | undefined;
	readonly returning: readonly SelectionNode[];
	readonly tag: string | undefined;
	/** What the query runs on; `undefined` when it was built on its own. */
	readonly executor: Executor | undefined;
}

/** The columns an upsert's conflict names: one, or several for a composite key. */
export type ConflictTarget<T extends AnyTable> =
	| ColumnKey<T>
	| readonly [ColumnKey<T>, ...ColumnKey<T>[]];

/**
 * Options of an upsert's update: `where` limits it to the conflicting rows
 * for which a condition holds, and can read the proposed row.
 */
export interface ConflictUpdateOptions<T extends AnyTable> {
	readonly where?:
		| AnyPredicate
		| ((
				eb: ExpressionBuilder<RefsOf<[T]>>,
				excluded: Excluded<T>,
		  ) => AnyPredicate);
}

/**
 * Starts an `insert` into `table`, built without a database.
 *
 * @example insertInto(users).values({ email: 'ada@example.com' })
 */
export function insertInto<T extends AnyTable>(
	table: T,
): InsertQueryBuilder<T, undefined, 'values'> {
	return insertIntoWith(table, undefined);
}

/** `insertInto`, with the executor the query runs on. */
export function insertIntoWith<T extends AnyTable>(
	table: T,
	executor: Executor | undefined,
): InsertQueryBuilder<T, undefined, 'values'> {
	return new InsertQueryBuilder({
		table,
		values: {
			columns: [],
			types: [],
			codecs: [],
			rows: [],
			strategy: 'values',
		},
		onConflict: undefined,
		returning: [],
		tag: undefined,
		executor,
	});
}

/**
 * An `insert` into `T` whose `returning` rows are `O` (`undefined` without
 * `returning`). `M` is what it still needs before it can run: `'values'`
 * until `values` is called.
 *
 * It runs with `execute()` (or in `db.batch`), never when awaited;
 * the `take…` and `expect…` shapes read its `returning` rows (and
 * `expectNonEmpty` and `expectRows` its row count).
 *
 * Immutable: every method returns a new builder.
 */
export class InsertQueryBuilder<
	T extends AnyTable,
	O,
	M extends 'values',
> extends WriteQueryBuilder<O, M> {
	readonly #state: InsertState<T>;

	constructor(state: InsertState<T>) {
		super(state.executor);
		this.#state = state;
	}

	/**
	 * The row, or rows, to insert, typed by the columns' insert types:
	 * required columns must be given, those with a default may be. Replaces
	 * any values given before. Several rows are sent with `unnest`, one array
	 * parameter per column, so the SQL is the same whatever their number.
	 *
	 * @example .values({ email: 'ada@example.com' })
	 * @example .values([{ email: 'ada@example.com' }, { email: 'alan@example.com' }])
	 */
	values(
		rows: InferInsertType<T> | readonly InferInsertType<T>[],
	): InsertQueryBuilder<T, O, never> {
		const list: readonly object[] = Array.isArray(rows) ? rows : [rows];
		return new InsertQueryBuilder({
			...this.#state,
			values: rowsNode(
				this.#state.table,
				list,
				Array.isArray(rows) ? 'unnest' : 'values',
			),
		});
	}

	/**
	 * An upsert: what to do when a row conflicts with an existing one on the
	 * unique columns `target`.
	 *
	 * @example .onConflict('email').doNothing()
	 * @example .onConflict(['tenantId', 'slug']).merge(['title'])
	 * @example .onConflict('email').doUpdate((excluded) => ({ name: excluded.name }))
	 */
	onConflict(target: ConflictTarget<T>): OnConflictBuilder<T, O, M> {
		const columns: readonly string[] =
			typeof target === 'string' ? [target] : target;
		return new OnConflictBuilder(
			this.#state,
			columns.map((key) => columnOf(this.#state.table, key).name),
			new WhereBuilder(expressionBuilder(this.#state.table)),
		);
	}

	/**
	 * Adds to the `returning` list, typed like a `select` list: a column is
	 * keyed by its name, an expression by its alias.
	 *
	 * @example .returning(['users.id'])
	 */
	returning<const S extends readonly Selection<RefsOf<[T]>>[]>(
		selections: S | ((eb: ExpressionBuilder<RefsOf<[T]>>) => S),
		..._unique: UniqueKeys<O, S>
	): InsertQueryBuilder<T, AddRow<O, RowOf<RefsOf<[T]>, S[number]>>, M> {
		const eb = expressionBuilder(this.#state.table);
		const list = typeof selections === 'function' ? selections(eb) : selections;
		return new InsertQueryBuilder({
			...this.#state,
			returning: returningNodes(
				this.#state.returning,
				selectionNodes(eb, list),
			),
		});
	}

	/**
	 * Adds every column of the table to the `returning` list, each keyed by
	 * its name and listed, never `*`.
	 *
	 * @example .returningAll()
	 */
	returningAll(
		..._unique: UniqueColumns<O, Ref<RefsOf<[T]>>>
	): InsertQueryBuilder<T, AddRow<O, RowOf<RefsOf<[T]>, Ref<RefsOf<[T]>>>>, M> {
		const eb = expressionBuilder(this.#state.table);
		return new InsertQueryBuilder({
			...this.#state,
			returning: returningNodes(
				this.#state.returning,
				selectionNodes(eb, allColumns(this.#state.table)),
			),
		});
	}

	/** Labels the query; see `SelectQueryBuilder.tag`. */
	tag(name: string): InsertQueryBuilder<T, O, M> {
		return new InsertQueryBuilder({ ...this.#state, tag: name });
	}

	/**
	 * Applies `build` only when `condition` holds. What it does doesn't count
	 * towards what the query needs, since it may not have run.
	 *
	 * @example .when(skipDuplicates, (qb) => qb.onConflict('email').doNothing())
	 */
	when(
		condition: boolean,
		build: (qb: InsertQueryBuilder<T, O, M>) => InsertQueryBuilder<T, O, M>,
	): InsertQueryBuilder<T, O, M> {
		return condition ? build(this) : this;
	}

	override toNode(): InsertNode {
		const { table, values, onConflict, returning, tag } = this.#state;
		return {
			kind: 'insert',
			table: tableNode(table),
			values,
			onConflict,
			returning,
			tag,
		};
	}
}

/**
 * An upsert's conflict, waiting for what to do about it. `where` narrows the
 * target to a partial unique index, by its predicate.
 */
export class OnConflictBuilder<T extends AnyTable, O, M extends 'values'> {
	readonly #state: InsertState<T>;
	readonly #target: readonly string[];
	readonly #where: WhereBuilder<RefsOf<[T]>>;

	constructor(
		state: InsertState<T>,
		target: readonly string[],
		where: WhereBuilder<RefsOf<[T]>>,
	) {
		this.#state = state;
		this.#target = target;
		this.#where = where;
	}

	/**
	 * The predicate of the partial unique index the target names, in any form
	 * `where` takes.
	 *
	 * @example .onConflict('email').where('users.deleted', false).doNothing()
	 */
	readonly where: Condition<RefsOf<[T]>, OnConflictBuilder<T, O, M>> = (
		...args: ConditionArgs<RefsOf<[T]>>
	) =>
		new OnConflictBuilder<T, O, M>(
			this.#state,
			this.#target,
			this.#where.add(args),
		);

	/** `do nothing`: keep the existing row. */
	doNothing(): InsertQueryBuilder<T, O, M> {
		return this.#then({ kind: 'nothing' });
	}

	/**
	 * `do update` setting `columns` from the proposed row, or every inserted
	 * column when none are given.
	 *
	 * @example .onConflict('email').merge(['name'])
	 */
	merge(
		columns?: readonly UpdateKey<T>[],
		options?: ConflictUpdateOptions<T>,
	): InsertQueryBuilder<T, O, M> {
		return this.#then({
			kind: 'merge',
			columns: columns?.map((key) => columnOf(this.#state.table, key).name),
			where: this.#updateWhere(options),
		});
	}

	/**
	 * `do update set ...`, from the proposed row as `excluded`, typed like
	 * an update's `set`. An `inc` / `dec` changes the existing row's value,
	 * e.g. by the proposed one.
	 *
	 * @example .onConflict('email').doUpdate((excluded) => ({ name: excluded.name }))
	 * @example .onConflict('key').doUpdate((excluded) => ({ hits: inc(excluded.hits) }))
	 */
	doUpdate(
		set: (
			excluded: Excluded<T>,
			eb: ExpressionBuilder<RefsOf<[T]>>,
		) => SetValues<T>,
		options?: ConflictUpdateOptions<T>,
	): InsertQueryBuilder<T, O, M> {
		const { table } = this.#state;
		const existing: Current = (column) => ({
			kind: 'reference',
			table: table.name,
			column,
		});
		return this.#then({
			kind: 'update',
			set: setNodes(
				table,
				[],
				set(excluded(table), expressionBuilder(table)),
				existing,
			),
			where: this.#updateWhere(options),
		});
	}

	#updateWhere(options: ConflictUpdateOptions<T> | undefined) {
		const where = options?.where;
		if (where === undefined) return undefined;
		const { table } = this.#state;
		const predicate =
			typeof where === 'function'
				? where(expressionBuilder(table), excluded(table))
				: where;
		return predicate._quarry.node;
	}

	#then(action: ConflictActionNode): InsertQueryBuilder<T, O, M> {
		return new InsertQueryBuilder({
			...this.#state,
			onConflict: {
				target: this.#target,
				where: this.#where.toNode(),
				action,
			},
		});
	}
}
