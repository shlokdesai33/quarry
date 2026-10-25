import type { AnyColumn } from './column/any-column.js';
import { codecs } from './driver/codecs.js';
import type { Executor } from './executor.js';
import {
	allSelections,
	type ExpressionBuilder,
	expressionBuilder,
} from './expression-builder.js';
import { predicate } from './expression-methods.js';
import type {
	OperationNode,
	ReferenceNode,
	SelectionNode,
	SetNode,
	UpdateNode,
} from './node.js';
import type { Ref, Refs, RefsOf } from './refs.js';
import {
	type AddRow,
	returningNodes,
	type RowOf,
	type Selection,
	selectionNodes,
	type UniqueColumns,
	type UniqueKeys,
} from './row.js';
import { type AnyTable, Table, tableNode } from './table.js';
import type { Prettify } from './types.js';
import {
	type Condition,
	type ConditionArgs,
	WhereBuilder,
} from './where-builder.js';
import {
	type ColumnKey,
	columnOf,
	rowsNode,
	setNodes,
	type SetValues,
	type UpdateKey,
	WriteQueryBuilder,
} from './write-query.js';

/** The columns of the table `T`, by the keys they are declared under. */
type Columns<T extends AnyTable> = T['schema']['columns'];

/** What an `update` of `T` over the references `R` has recorded so far. */
interface UpdateState<T extends AnyTable, R extends Refs> {
	readonly table: T;
	/** The tables in scope: `table`, and the rows of a `setEach`. */
	readonly scope: readonly AnyTable[];
	/** An expression builder over the references in scope. */
	readonly eb: ExpressionBuilder<R>;
	readonly set: readonly SetNode[];
	readonly from: UpdateNode['from'];
	readonly where: WhereBuilder<R>;
	readonly allRows: boolean;
	readonly returning: readonly SelectionNode[];
	readonly tag: string | undefined;
	/** What the query runs on; `undefined` when it was built on its own. */
	readonly executor: Executor | undefined;
}

/** What an update still needs before it can run. */
type UpdateNeeds = 'set' | 'where';

/**
 * Starts an `update` of `table`, built without a database. It needs `set`
 * and a `where` (or `allRows()`), or a `setEach`, before it can run.
 *
 * @example update(users).set({ name: 'Ada' }).where('users.id', id)
 * @example update(users).setEach(rows, { key: 'id' })
 */
export function update<T extends AnyTable>(
	table: T,
): UpdateQueryBuilder<T, undefined, UpdateNeeds> {
	return updateWith(table, undefined);
}

/** `update`, with the executor the query runs on. */
export function updateWith<T extends AnyTable>(
	table: T,
	executor: Executor | undefined,
): UpdateQueryBuilder<T, undefined, UpdateNeeds> {
	const eb = expressionBuilder(table);
	return new UpdateQueryBuilder({
		table,
		scope: [table],
		eb,
		set: [],
		from: undefined,
		where: new WhereBuilder(eb),
		allRows: false,
		returning: [],
		tag: undefined,
		executor,
	});
}

/** How `setEach` matches its rows to the table's, and names them. */
export interface SetEachOptions<K extends string, A extends string> {
	/** The columns that identify a row: its key, or a composite one. */
	readonly key: K | readonly [K, ...K[]];
	/**
	 * The name the rows are referenced by in `set`, `where` and
	 * `returning`: `row` unless given.
	 */
	readonly as?: A;
}

/**
 * A row of a `setEach`: its `key` columns `K`, which match it to the
 * table's row, and any of the columns an update can set. A column a row
 * leaves out (or sets to `undefined`) keeps its value in that row; `null`
 * sets it to null.
 */
export type SetEachRow<T extends AnyTable, K extends ColumnKey<T>> = Prettify<
	{ readonly [C in K]: NonNullable<Columns<T>[C]['$select']> } & {
		readonly [C in Exclude<UpdateKey<T>, K>]?: Columns<T>[C]['$update'];
	}
>;

/** A column of `setEach`'s rows: the table's column `C`, read as `S`. */
interface RowColumn<C extends AnyColumn, S> {
	readonly $select: S;
	readonly $insert: never;
	readonly $update: never;
	readonly _quarry: C['_quarry'];
}

/**
 * The references to `setEach`'s rows, named `A`: each key column `K`, and
 * each column an update can set, which is null in a row that leaves it out.
 */
export type SetEachRefs<
	T extends AnyTable,
	K extends ColumnKey<T>,
	A extends string,
> = {
	[C in K | UpdateKey<T> as `${A}.${C}`]: RowColumn<
		Columns<T>[C],
		C extends K
			? NonNullable<Columns<T>[C]['$select']>
			: Columns<T>[C]['$select'] | null
	>;
};

/**
 * An `update` of `T` whose `returning` rows are `O` (`undefined` without
 * `returning`). `M` is what it still needs before it can run: `'set'` until
 * `set` or `setEach` is called, `'where'` until `where`, `allRows` or
 * `setEach` is. Running it is a type error until `M` is `never`. `R` is
 * the references in scope: the table's, and after `setEach`, its rows'.
 *
 * It runs with `execute()` (or in `db.batch`), never when awaited;
 * the `take…` and `expect…` shapes read its `returning` rows (and
 * `expectNonEmpty` and `expectRows` its row count).
 *
 * Immutable: every method returns a new builder.
 */
export class UpdateQueryBuilder<
	T extends AnyTable,
	O,
	M extends UpdateNeeds,
	R extends Refs = RefsOf<[T]>,
> extends WriteQueryBuilder<O, M> {
	readonly #state: UpdateState<T, R>;

	constructor(state: UpdateState<T, R>) {
		super(state.executor);
		this.#state = state;
	}

	/**
	 * Columns to set, typed by their update types; read-only columns aren't
	 * offered. A value can be an expression, over `setEach`'s rows too.
	 * Adds to the columns set before, replacing a column set again.
	 *
	 * @example .set({ name: 'Ada' })
	 * @example .set((eb) => ({ name: eb.fn.lower('users.name') }))
	 */
	set(
		values: SetValues<T> | ((eb: ExpressionBuilder<R>) => SetValues<T>),
	): UpdateQueryBuilder<T, O, Exclude<M, 'set'>, R> {
		const given =
			typeof values === 'function' ? values(this.#state.eb) : values;
		return new UpdateQueryBuilder({
			...this.#state,
			set: setNodes(this.#state.table, this.#state.set, given),
		});
	}

	/**
	 * Updates each of `rows` to its own values, in one statement: each row
	 * is matched to the table's row with the same `key` columns, and sets
	 * the other columns it has. A row may leave out columns another sets;
	 * those keep their value in that row. The rows are sent with `unnest`,
	 * one array parameter per column, and the key match is the `where`, so
	 * the update can run as is; `where` adds conditions to it.
	 *
	 * The rows are in scope as `row` (or `as`): `set`, `where` and
	 * `returning` can reference them, and a later `set` of a column replaces
	 * the row's value with an expression of it.
	 *
	 * Throws when there are no rows, a row lacks a key column, two rows
	 * have the same key, `as` is the table's name, or it was called before.
	 *
	 * @example .setEach([{ id: 1, name: 'Ada' }, { id: 2, email: null }], { key: 'id' })
	 * @example .setEach(rows, { key: ['tenantId', 'slug'] }).expectRows(rows.length)
	 * @example .setEach(rows, { key: 'id' }).set((eb) => ({ stock: eb.fn.coalesce('row.stock', 'products.stock') }))
	 */
	setEach<const K extends ColumnKey<T>, const A extends string = 'row'>(
		rows: readonly NoInfer<SetEachRow<T, K>>[],
		options: SetEachOptions<K, A>,
	): UpdateQueryBuilder<
		T,
		O,
		Exclude<M, UpdateNeeds>,
		R & SetEachRefs<T, K, A>
	> {
		const { table } = this.#state;
		const alias: string = options.as ?? 'row';
		const keys: readonly string[] =
			typeof options.key === 'string' ? [options.key] : options.key;
		const given: readonly Readonly<Record<string, unknown>>[] = rows;
		checkEachRows(table, given, keys, alias, this.#state.from !== undefined);
		const target = (name: string): ReferenceNode => ({
			kind: 'reference',
			table: table.name,
			column: name,
		});
		const row = (name: string): ReferenceNode => ({
			kind: 'reference',
			table: alias,
			column: name,
		});

		// the key columns first, then the others in the order they appear
		const values = rowsNode(
			table,
			given.map((each) =>
				Object.assign(
					Object.fromEntries(keys.map((key) => [key, each[key]])),
					each,
				),
			),
			'unnest',
		);
		const keyNames = new Set(keys.map((key) => columnOf(table, key).name));
		const set = new Map(this.#state.set.map((node) => [node.column, node]));
		const columns = [...values.columns];
		const types = [...values.types];
		const valueCodecs = [...values.codecs];
		const cells = values.rows.map((cellsOf) =>
			cellsOf.map(
				(cell, i): OperationNode =>
					cell ?? { kind: 'value', value: null, codec: values.codecs[i] },
			),
		);
		values.columns.forEach((name, i) => {
			if (keyNames.has(name)) return;
			let value: OperationNode = row(name);
			if (values.rows.some((cellsOf) => cellsOf[i] === undefined)) {
				// a row that leaves the column out keeps its value
				const flag = `set:${name}`;
				columns.push(flag);
				types.push('boolean');
				valueCodecs.push(codecs.bool);
				values.rows.forEach((cellsOf, r) =>
					cells[r]?.push({
						kind: 'value',
						value: cellsOf[i] !== undefined,
						codec: codecs.bool,
					}),
				);
				value = {
					kind: 'case',
					branches: [{ when: row(flag), result: row(name) }],
					otherwise: target(name),
				};
			}
			set.set(name, { column: name, value });
		});

		const scope = [...this.#state.scope, new Table(alias, table.schema)];
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `scope` holds the tables the references were made from
		const eb = expressionBuilder(...scope) as unknown as ExpressionBuilder<
			R & SetEachRefs<T, K, A>
		>;
		let where = this.#state.where.rescope(eb);
		for (const name of keyNames) {
			where = where.add([
				predicate({
					kind: 'binary',
					left: target(name),
					operator: '=',
					right: row(name),
				}),
			]);
		}
		return new UpdateQueryBuilder({
			...this.#state,
			scope,
			eb,
			set: [...set.values()],
			from: {
				rows: {
					columns,
					types,
					codecs: valueCodecs,
					rows: cells,
					strategy: 'unnest',
				},
				alias,
			},
			where,
		});
	}

	/**
	 * Adds a condition the updated rows must meet, in any form a select's
	 * `where` takes, joined to the others by `and`.
	 *
	 * @example .where('users.id', id)
	 * @example .where((eb) => eb.ref('users.lastSeen').lt(cutoff))
	 */
	readonly where: Condition<
		R,
		UpdateQueryBuilder<T, O, Exclude<M, 'where'>, R>
	> = (...args: ConditionArgs<R>) =>
		new UpdateQueryBuilder<T, O, Exclude<M, 'where'>, R>({
			...this.#state,
			where: this.#state.where.add(args),
		});

	/** Updates every row of the table: what the query needs instead of a `where`. */
	allRows(): UpdateQueryBuilder<T, O, Exclude<M, 'where'>, R> {
		return new UpdateQueryBuilder({ ...this.#state, allRows: true });
	}

	/**
	 * Adds to the `returning` list, typed like a `select` list.
	 *
	 * @example .returning(['users.id', 'users.name'])
	 */
	returning<const S extends readonly Selection<R>[]>(
		selections: S | ((eb: ExpressionBuilder<R>) => S),
		..._unique: UniqueKeys<O, S>
	): UpdateQueryBuilder<T, AddRow<O, RowOf<R, S[number]>>, M, R> {
		const { eb } = this.#state;
		const list = typeof selections === 'function' ? selections(eb) : selections;
		return new UpdateQueryBuilder({
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
		..._unique: [keyof O] extends [never]
			? []
			: UniqueColumns<O, Ref<RefsOf<[T]>>>
	): UpdateQueryBuilder<
		T,
		AddRow<O, RowOf<RefsOf<[T]>, Ref<RefsOf<[T]>>>>,
		M,
		R
	> {
		return new UpdateQueryBuilder({
			...this.#state,
			returning: returningNodes(
				this.#state.returning,
				allSelections(this.#state.table),
			),
		});
	}

	/** Labels the query; see `SelectQueryBuilder.tag`. */
	tag(name: string): UpdateQueryBuilder<T, O, M, R> {
		return new UpdateQueryBuilder({ ...this.#state, tag: name });
	}

	/**
	 * Applies `build` only when `condition` holds. What it does doesn't count
	 * towards what the query needs, since it may not have run: a `where` in
	 * it doesn't stand in for the required one.
	 *
	 * @example .when(onlyActive, (qb) => qb.where('users.active', true))
	 */
	when(
		condition: boolean,
		build: (
			qb: UpdateQueryBuilder<T, O, M, R>,
		) => UpdateQueryBuilder<T, O, M, R>,
	): UpdateQueryBuilder<T, O, M, R> {
		return condition ? build(this) : this;
	}

	override toNode(): UpdateNode {
		const { table, set, from, where, allRows, returning, tag } = this.#state;
		return {
			kind: 'update',
			table: tableNode(table),
			set,
			from,
			where: where.toNode(),
			allRows,
			returning,
			tag,
		};
	}
}

/** A key value as a string, or `undefined` when it has no faithful one. */
function keyString(value: unknown): string | undefined {
	if (value instanceof Date) return `date:${value.getTime()}`;
	switch (typeof value) {
		case 'string':
		case 'number':
		case 'bigint':
		case 'boolean':
			return `${typeof value}:${value}`;
		default:
			return undefined;
	}
}

/**
 * Checks what `setEach` was given, throwing for what the types can't rule
 * out: no rows, a row without a key column, two rows with the same key
 * (postgres would update the table's row from either), a name for the rows
 * that the table already has, or a second `setEach`.
 */
function checkEachRows(
	table: AnyTable,
	rows: readonly Readonly<Record<string, unknown>>[],
	keys: readonly string[],
	alias: string,
	again: boolean,
): void {
	if (again) throw new Error('An update takes one setEach');
	if (keys.length === 0) throw new Error('setEach needs a key column');
	for (const key of keys) columnOf(table, key);
	if (alias === table.name) {
		throw new Error(
			`setEach's rows can't be named "${alias}", the table's name in the update: pass another \`as\``,
		);
	}
	if (rows.length === 0) {
		throw new Error(
			`setEach needs at least one row: there is nothing to update "${table.name}" to`,
		);
	}
	const seen = new Map<string, number>();
	rows.forEach((row, index) => {
		const values = keys.map((key) => row[key]);
		const missing = keys.filter(
			(_, i) => values[i] === undefined || values[i] === null,
		);
		if (missing.length > 0) {
			throw new Error(
				`Each row of setEach needs its key columns: row ${index} is missing "${missing.join('", "')}"`,
			);
		}
		const strings = values.map(keyString);
		if (!strings.every((s) => s !== undefined)) return;
		const id = strings.join('\0');
		const first = seen.get(id);
		if (first !== undefined) {
			throw new Error(
				`Rows ${first} and ${index} of setEach have the same key (${keys.join(', ')}): postgres would update "${table.name}"'s row from either`,
			);
		}
		seen.set(id, index);
	});
}
