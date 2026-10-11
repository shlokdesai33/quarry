import type { AliasedExpression } from './expression.js';
import type { ExpressionBuilder } from './expression-builder.js';
import type { SelectionNode } from './node.js';
import type { Ref, Refs } from './refs.js';
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

/**
 * The nodes of a select or returning list. A column is keyed by its name, an
 * expression by its alias.
 */
export function selectionNodes<R extends Refs>(
	eb: ExpressionBuilder<R>,
	selections: readonly Selection<R>[],
): SelectionNode[] {
	return selections.map((selection): SelectionNode =>
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
}
