import { type CaseStart, caseOf } from './case.js';
import type { AnyColumn } from './column/any-column.js';
import { nameReference } from './comparison.js';
import { shareColumn } from './compile.js';
import type { DataType } from './data-type/data-type.js';
import type { Codec } from './driver/codec.js';
import type { Expression, TypedExpression } from './expression.js';
import { param, predicate, typedExpression } from './expression-methods.js';
import { type Functions, functions } from './functions.js';
import { type JsonFunctions, jsonFunctions } from './json.js';
import { nestOf } from './nest.js';
import type { OperationNode, ReferenceNode, SelectionNode } from './node.js';
import type { AnyPredicate, Expr, Predicate, Value } from './operators.js';
import type { NullOf, Ref, Refs, RefsOf } from './refs.js';
import type { AnyTable } from './table.js';

/**
 * Builds expressions over the references in scope `R`. Only visible columns
 * can be referenced. A condition is a method of an expression, typed by the
 * expression's SQL type: only the comparisons that type has, each taking the
 * values and expressions it accepts.
 *
 * Its members don't depend on `this`, so it can be destructured.
 *
 * `R` is declared invariant, for type-checking speed: a builder is only ever
 * used with its own scope, and without the annotation the compiler measures
 * the variance by comparing the whole interface, once per program, and
 * editors once per edit.
 *
 * @example eb.ref('users.email').like('%@example.com')
 * @example eb.ref('users.age').between([18, eb.ref('users.maxAge')])
 * @example eb.fn.lower('users.email').eq('ada@example.com')
 * @example eb.val('admin').eq(eb.fn.any('users.tags'))
 */
export interface ExpressionBuilder<in out R extends Refs> {
	/**
	 * A column reference, with the comparison methods of its SQL type.
	 *
	 * @example eb.ref('users.firstName').eq(eb.ref('users.lastName'))
	 */
	readonly ref: <C extends Ref<R>>(
		column: C,
	) => Expr<R[C]['$select'], R[C]['_quarry']['dataType']>;

	/**
	 * A parameter, for positions that take a reference by default. Its SQL
	 * type is whatever postgres infers, so its only comparisons are with
	 * `any` / `all` of an array, whose element type encodes it. A comparison
	 * takes a plain value instead, except for an array as a whole: `in` and
	 * `any` / `all` take an array parameter and encode its items. As a
	 * `coalesce` fallback it is encoded by the first argument's codec.
	 * Elsewhere it is encoded by `codec`, which also declares its type, or
	 * without one, by its JavaScript type.
	 *
	 * @example eb.fn.concat('users.firstName', eb.val(' '), 'users.lastName')
	 * @example eb.ref('users.id').in(eb.val(ids))
	 * @example eb.fn.concat(eb.val(range, codecs.tstzrange))
	 */
	readonly val: {
		<T extends readonly unknown[]>(
			value: T,
			codec?: Codec<NoInfer<T>, unknown>,
		): Value<T>;
		<const T>(value: T, codec?: Codec<NoInfer<T>, unknown>): Value<T>;
	};

	/**
	 * The SQL functions.
	 *
	 * @example eb.fn.lower('users.email')
	 */
	readonly fn: Functions<R>;

	/**
	 * The jsonb functions: reading a field or path, and testing keys and
	 * jsonpaths.
	 *
	 * @example eb.json.text('users.settings', 'theme').eq('dark')
	 * @example eb.json.hasKey('users.settings', 'theme')
	 */
	readonly json: JsonFunctions<R>;

	/** `(a and b and ...)`; `true` when empty. */
	readonly and: <const E extends readonly AnyPredicate[]>(
		expressions: E,
	) => Predicate<NullOf<E[number]['_quarry']['$type']>>;

	/** `(a or b or ...)`; `false` when empty. */
	readonly or: <const E extends readonly AnyPredicate[]>(
		expressions: E,
	) => Predicate<NullOf<E[number]['_quarry']['$type']>>;

	/** `not (expression)`. */
	readonly not: <E extends AnyPredicate>(
		expression: E,
	) => Predicate<NullOf<E['_quarry']['$type']>>;

	/**
	 * `case when … then … else … end`: the result of the first branch whose
	 * condition holds. Its type is the union of the results, plus `null`
	 * without an `else`.
	 *
	 * @example
	 * eb.case()
	 *   .when(eb.ref('orders.total').gte(1000), 'large')
	 *   .when(eb.ref('orders.total').gte(100), 'medium')
	 *   .else('small')
	 *   .end()
	 *   .as('size')
	 */
	readonly case: () => CaseStart;
}

/** `kind` of the operands, unwrapping those that are `kind` themselves. */
const junction =
	(kind: 'and' | 'or') => (expressions: readonly AnyPredicate[]) =>
		predicate({
			kind,
			operands: expressions.flatMap((expression) => {
				const node = expression._quarry.node;
				return node.kind === kind ? node.operands : [node];
			}),
		});

/**
 * A column reference, resolved: its node, its column, what `ref` returns,
 * and its entry in a select or returning list, keyed by the column's key.
 */
export interface ResolvedColumn {
	readonly node: ReferenceNode;
	readonly column: AnyColumn;
	readonly expression: TypedExpression<unknown, DataType>;
	readonly selection: SelectionNode;
}

/**
 * Each table's resolved columns, by key. Nodes and expressions are
 * immutable, so every query over the table shares them, and the compiler
 * can cache what it renders for them.
 */
const resolvedColumns = new WeakMap<AnyTable, Map<string, ResolvedColumn>>();

/** `table`'s column `key`, resolved once per table. */
function resolveColumn(
	table: AnyTable,
	key: string,
): ResolvedColumn | undefined {
	let columns = resolvedColumns.get(table);
	if (columns === undefined) {
		columns = new Map();
		resolvedColumns.set(table, columns);
	}
	let resolved = columns.get(key);
	if (resolved !== undefined) return resolved;
	if (!Object.hasOwn(table.schema.columns, key)) return undefined;
	const column = table.schema.columns[key];
	if (column === undefined) return undefined;
	const node: ReferenceNode = {
		kind: 'reference',
		table: table.name,
		column: column._quarry.columnName ?? key,
	};
	nameReference(node, `${table.name}.${key}`);
	const { dataType } = column._quarry;
	const selection: SelectionNode = {
		expression: node,
		alias: key,
		codec: dataType.codec,
	};
	shareColumn(node, selection);
	resolved = {
		node,
		column,
		expression: typedExpression(node, dataType),
		selection,
	};
	columns.set(key, resolved);
	return resolved;
}

/** Each table's every column, as `selectAll` and `returningAll` list them. */
const everyColumn = new WeakMap<AnyTable, readonly SelectionNode[]>();

/**
 * The selection of every column of `table`, in the order the schema lists
 * them: one frozen list per table, shared by every query that selects or
 * returns them all.
 */
export function allSelections(table: AnyTable): readonly SelectionNode[] {
	let list = everyColumn.get(table);
	if (list === undefined) {
		list = Object.freeze(
			Object.keys(table.schema.columns).map((key) => {
				const resolved = resolveColumn(table, key);
				if (resolved === undefined) {
					throw new Error(`Unknown column reference "${table.name}.${key}"`);
				}
				return resolved.selection;
			}),
		);
		everyColumn.set(table, list);
	}
	return list;
}

/** The expression builder of each single-table scope: it holds nothing per query. */
const singleTable = new WeakMap<AnyTable, ExpressionBuilder<Refs>>();

/**
 * Creates an expression builder with the given tables in scope. The
 * implementation only builds nodes; `ExpressionBuilder` supplies the types.
 * A builder holds no state, so a scope's is made once and shared.
 *
 * @example
 * const eb = expressionBuilder(users, posts.as('p'));
 * eb.ref('p.authorId').eq(eb.ref('users.id'))
 */
export function expressionBuilder<const T extends readonly AnyTable[]>(
	...tables: T
): ExpressionBuilder<RefsOf<T>> {
	const [only] = tables;
	if (only === undefined) return makeBuilder(tables);
	if (tables.length > 1) return joinedBuilder(only, tables);
	let eb = singleTable.get(only);
	if (eb === undefined) {
		eb = Object.freeze(makeBuilder([only]));
		singleTable.set(only, eb);
	}
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the builder of this very scope
	return eb as unknown as ExpressionBuilder<RefsOf<T>>;
}

/**
 * The builders of joined scopes, by their first table: a query's every
 * callback after a join (each `where`, `on`, `select`) asked for one, and
 * making one builds its function namespaces and reference map. A list per
 * first table, compared table by table; at most `JOINED_SCOPES` each, since
 * aliased tables made per query make new scopes.
 */
const joinedScopes = new WeakMap<
	AnyTable,
	{
		readonly tables: readonly AnyTable[];
		readonly eb: ExpressionBuilder<Refs>;
	}[]
>();
const JOINED_SCOPES = 64;

function joinedBuilder<const T extends readonly AnyTable[]>(
	first: AnyTable,
	tables: T,
): ExpressionBuilder<RefsOf<T>> {
	let scopes = joinedScopes.get(first);
	if (scopes === undefined) {
		scopes = [];
		joinedScopes.set(first, scopes);
	}
	search: for (const scope of scopes) {
		if (scope.tables.length !== tables.length) continue;
		for (let i = 1; i < tables.length; i++)
			if (scope.tables[i] !== tables[i]) continue search;
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the builder of these very tables
		return scope.eb as unknown as ExpressionBuilder<RefsOf<T>>;
	}
	const eb = Object.freeze(makeBuilder(tables));
	if (scopes.length < JOINED_SCOPES) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stored untyped, returned to the same scope
		const stored = eb as unknown as ExpressionBuilder<Refs>;
		scopes.push({ tables: [...tables], eb: stored });
	}
	return eb;
}

function makeBuilder<const T extends readonly AnyTable[]>(
	tables: T,
): ExpressionBuilder<RefsOf<T>> {
	type R = RefsOf<T>;

	/** This scope's references, as written: `users.email`. */
	const references = new Map<string, ResolvedColumn>();
	const resolve = (reference: string): ResolvedColumn => {
		let resolved = references.get(reference);
		if (resolved !== undefined) return resolved;
		const dot = reference.indexOf('.');
		const tableName = reference.slice(0, dot);
		const table = tables.find((candidate) => candidate.name === tableName);
		resolved =
			table === undefined
				? undefined
				: resolveColumn(table, reference.slice(dot + 1));
		if (resolved === undefined) {
			throw new Error(`Unknown column reference "${reference}"`);
		}
		references.set(reference, resolved);
		return resolved;
	};

	const node = (arg: string | Expression<unknown>): OperationNode =>
		typeof arg === 'string' ? resolve(arg).node : arg._quarry.node;

	const dataType = (
		arg: string | TypedExpression<unknown, DataType>,
	): DataType =>
		typeof arg === 'string'
			? resolve(arg).column._quarry.dataType
			: arg._quarry.dataType;

	// `nest` is typed for select lists only, by `SelectBuilder`
	const eb: ExpressionBuilder<R> &
		Resolver & { readonly nest: ReturnType<typeof nestOf> } = {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- the signature supplies the type
		ref: (column: string) => resolve(column).expression as never,
		[RESOLVE]: resolve,
		val: (value: unknown, codec?: Codec) => param(value, codec),
		fn: functions<R>({ node, dataType }),
		json: jsonFunctions<R>({ node }),
		and: junction('and'),
		or: junction('or'),
		not: (expression: AnyPredicate) =>
			predicate({ kind: 'not', operand: expression._quarry.node }),
		case: caseOf,
		nest: nestOf(tables),
	};
	return eb;
}

const RESOLVE = Symbol('quarry.resolve');

/** How a builder made here resolves a reference; not part of `ExpressionBuilder`. */
interface Resolver {
	readonly [RESOLVE]: (reference: string) => ResolvedColumn;
}

/**
 * Resolves `reference` in `eb`'s scope to the shared node, column,
 * expression and selection. Throws as `ref` does.
 */
export function resolveReference<R extends Refs>(
	eb: ExpressionBuilder<R>,
	reference: string,
): ResolvedColumn {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- every builder is made by makeBuilder
	return (eb as unknown as Resolver)[RESOLVE](reference);
}
