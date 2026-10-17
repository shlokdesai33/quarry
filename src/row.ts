import type { Codec } from './driver/codec.js';
import {
	Param,
	TypedExpression,
	type AliasedExpression,
	type Expression,
} from './expression.js';
import type { ExpressionBuilder } from './expression-builder.js';
import type { SelectionNode } from './node.js';
import type { Ref, Refs } from './refs.js';
import type { AnyTable } from './table.js';
import type { Prettify } from './types.js';

/** An entry of a select list: a column reference or a named expression. */
export type Selection<R extends Refs> =
	| Ref<R>
	| AliasedExpression<unknown, string>;

/** The key a selection has in the result row. */
export type KeyOf<S> = S extends `${string}.${infer C}`
	? C
	: S extends AliasedExpression<unknown, infer A>
		? A
		: never;

/** The type a selection has in the result row. */
export type ValueOf<R extends Refs, S> =
	S extends Ref<R>
		? R[S]['$select']
		: S extends AliasedExpression<infer T, string>
			? T
			: never;

/** The row the selections `S` over the references `R` produce. */
export type RowOf<R extends Refs, S> = {
	[K in S as KeyOf<K>]: ValueOf<R, K>;
};

/**
 * The row `O` with the columns `A` added. Either alone when the other is
 * empty, which saves flattening an intersection for every first selection
 * and every fragment that selects nothing; `A` must then be written out
 * rather than named, for hovers to list its columns.
 */
export type AddRow<O, A> = [keyof O] extends [never]
	? A
	: [keyof A] extends [never]
		? O
		: Prettify<O & A>;

/** The keys the selections `S` have in the row, in order. */
type KeysOf<S extends readonly unknown[]> = { [I in keyof S]: KeyOf<S[I]> };

/** The keys of the list `K` that repeat one before them or one in `Seen`. */
type Repeated<K extends readonly unknown[], Seen> = K extends readonly [
	infer H,
	...infer Rest,
]
	? string extends H
		? Repeated<Rest, Seen>
		: (H extends Seen ? H : never) | Repeated<Rest, Seen | H>
	: never;

/** Nothing when `D` is empty; otherwise one more argument naming its keys, so the call fails. */
type NoneOf<D> = [D] extends [never]
	? []
	: [
			duplicateKeys: `select each key once: "${D & string}" is already in the row; rename one with .as()`,
		];

/**
 * Nothing when the selections `S` add keys new to the row `O` and to each
 * other; otherwise one more argument, naming the keys, so the call fails:
 * a row holds one value per key, so a second column of the same key would
 * silently replace the first.
 */
export type UniqueKeys<O, S extends readonly unknown[]> = NoneOf<
	Repeated<KeysOf<S>, keyof O>
>;

/** `true` (among others) when `X` is a union. */
type IsUnion<X, Y = X> = X extends unknown
	? [Y] extends [X]
		? false
		: true
	: never;

/** The column keys more than one of the references `P` has. */
type RepeatedColumns<P extends string> = {
	[C in KeyOf<P>]: true extends IsUnion<Extract<P, `${string}.${C}`>>
		? C
		: never;
}[KeyOf<P>];

/** `UniqueKeys`, for the columns of the references `P`. */
export type UniqueColumns<O, P extends string> = NoneOf<
	RepeatedColumns<P> | Extract<KeyOf<P>, keyof O>
>;

/** The references in scope `R` of the tables named `N`. */
export type TableRefs<R extends Refs, N extends string> = Extract<
	Ref<R>,
	`${N}.${string}`
>;

/**
 * Throws when a key of `added` is in `existing` or repeats one before it:
 * the row would keep only the last.
 */
export function checkUniqueKeys(
	existing: readonly SelectionNode[],
	added: readonly SelectionNode[],
): void {
	const keys = new Set(existing.map((selection) => selection.alias));
	for (const { alias } of added) {
		if (keys.has(alias)) {
			throw new Error(
				`select each key once: "${alias}" is already in the row; rename one with .as()`,
			);
		}
		keys.add(alias);
	}
}

/** `existing` with `added` after it, checked by `checkUniqueKeys`. */
export function returningNodes(
	existing: readonly SelectionNode[],
	added: readonly SelectionNode[],
): SelectionNode[] {
	checkUniqueKeys(existing, added);
	return [...existing, ...added];
}

/** A reference to every column of `table`, as `selectAll` and `returningAll` list them. */
export function allColumns(table: AnyTable): string[] {
	return Object.keys(table.schema.columns).map((key) => `${table.name}.${key}`);
}

/**
 * The nodes of a select or returning list. A column is keyed by its name, an
 * expression by its alias.
 */
export function selectionNodes<R extends Refs>(
	eb: ExpressionBuilder<R>,
	selections: readonly Selection<R>[],
): SelectionNode[] {
	return selections.map((selection): SelectionNode => {
		if (typeof selection === 'string') {
			const ref = eb.ref(selection);
			return {
				expression: ref._quarry.node,
				alias: selection.slice(selection.indexOf('.') + 1),
				codec: ref._quarry.dataType.codec,
			};
		}
		return {
			expression: selection.expression._quarry.node,
			alias: selection.alias,
			codec: codecOf(selection.expression),
		};
	});
}

/** The codec an expression's values are read with, when its SQL type is known. */
function codecOf(expression: Expression<unknown>): Codec | undefined {
	if (expression instanceof TypedExpression)
		return expression._quarry.dataType.codec;
	if (expression instanceof Param) {
		const { node } = expression._quarry;
		return node.kind === 'value' ? node.codec : undefined;
	}
	return undefined;
}
