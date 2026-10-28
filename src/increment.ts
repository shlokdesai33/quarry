import type { Expression } from './expression.js';
import type { Kind, NumberKind } from './operators.js';

/** How `inc` and `dec` treat a column that is null. */
export interface IncrementOptions {
	/**
	 * Counts a null column as `0`: `coalesce("views", 0) + $1`. Without it the
	 * column stays null, as `null + 1` is null in postgres.
	 */
	readonly coalesce?: boolean;
}

/**
 * A change to a numeric column relative to its current value, as `inc` and
 * `dec` create: `"views" = "views" + $1`. `V` is the amount, a value of the
 * column's update type or an expression of one. Only an update's `set`, an
 * upsert's `doUpdate` and the rows of an `updateMany` take it.
 *
 * Not an expression: what it adds to is the column it is set on, which only
 * the `set` knows.
 */
export class Increment<V> {
	/** The type of the amount. Never set. */
	declare readonly $amount: V;

	/** What the library reads: not part of the API. */
	readonly _quarry: {
		readonly operator: '+' | '-';
		readonly amount: unknown;
		readonly coalesce: boolean;
	};

	constructor(
		operator: '+' | '-',
		amount: unknown,
		options: IncrementOptions | undefined,
	) {
		if (amount === null || amount === undefined) {
			throw new TypeError(
				`${operator === '+' ? 'inc' : 'dec'}() needs an amount, not ${String(amount)}`,
			);
		}
		this._quarry = {
			operator,
			amount,
			coalesce: options?.coalesce ?? false,
		};
	}
}

/** What `inc` and `dec` take: a value, or an expression of one. */
type Amount = number | string | Expression<unknown>;

/**
 * Adds `amount` to a numeric column in one statement, so concurrent updates
 * don't overwrite each other: `"views" = "views" + $1`. The amount has the
 * column's update type (a `string` for `bigint` and `decimal`) and is encoded
 * by its SQL type; it can also be a numeric expression, such as an upsert's
 * `excluded` column.
 *
 * A null column stays null, as in postgres, unless `coalesce` counts it as 0.
 *
 * @example update(posts).set({ views: inc(1) }).where('posts.id', id)
 * @example update(accounts).set({ balance: inc('10.50') }).where('accounts.id', id)
 * @example insertInto(counters).values(row).onConflict('key').doUpdate((excluded) => ({ count: inc(excluded.count) }))
 * @example update(posts).set({ likes: inc(1, { coalesce: true }) }).where('posts.id', id)
 */
export function inc<const V extends Amount>(
	amount: V,
	options?: IncrementOptions,
): Increment<V> {
	return new Increment('+', amount, options);
}

/**
 * Subtracts `amount` from a numeric column in one statement:
 * `"stock" = "stock" - $1`. Otherwise the same as `inc`.
 *
 * @example update(products).set({ stock: dec(quantity) }).where('products.id', id)
 */
export function dec<const V extends Amount>(
	amount: V,
	options?: IncrementOptions,
): Increment<V> {
	return new Increment('-', amount, options);
}

const NUMBER_KINDS: ReadonlySet<Kind> = new Set<NumberKind>([
	'smallint',
	'integer',
	'bigint',
	'decimal',
	'real',
	'double precision',
]);

/** Whether a column of SQL type `kind` can be incremented. */
export function isNumberKind(kind: Kind): boolean {
	return NUMBER_KINDS.has(kind);
}
