import type { CompiledQuery } from './compile.js';
import type {
	ExecuteResult,
	Executor,
	ReadOptions,
	RunOptions,
} from './executor.js';

/** What a `Query` holds. */
interface QueryState<T> {
	readonly query: CompiledQuery;
	/** What `execute` runs on; `undefined` when it was built on its own. */
	readonly executor: Executor | undefined;
	/** Reads the result: the rows wanted, or throws as the `expect` shapes do. */
	readonly read: (result: ExecuteResult) => T;
	/**
	 * Whether `read` can throw once the statement has run, so a batch's
	 * transaction must wait for it before committing.
	 */
	readonly checked: boolean;
	/** How the executor returns the rows, for `read`. */
	readonly rows: ReadOptions | undefined;
}

declare const notExecuted: unique symbol;

/**
 * What awaiting a query gives, at the type level, instead of its result:
 * a query runs with `execute()`, and awaiting one rejects.
 */
export interface NotExecuted {
	readonly [notExecuted]: 'A query runs with execute(): await q.expectOne().execute()';
}

/**
 * Makes awaiting a query or builder reject with a hint, rather than resolve
 * to the query unrun (a write that silently never happens).
 */
export function rejectAwait(
	_resolve: (value: NotExecuted) => unknown,
	reject: (reason: unknown) => unknown,
): void {
	reject(
		new TypeError(
			'A query runs with execute(), not when awaited: `await q.expectOne().execute()`, or `await db.batch([...])` for several',
		),
	);
}

/**
 * A query with the shape of its result. The builders' shapes make one and
 * nothing runs until `execute()`, or `db.batch`, which runs several in one
 * round trip. No shape changes the SQL:
 *
 * - `take…` shapes never throw: `takeFirst()` and `takeValue()`.
 * - `expect…` shapes throw when the rows aren't what they expect:
 *   `expectNonEmpty()`, `expectFirst()`, `expectOne()`,
 *   `expectAtMostOne()`, `expectValue()`, and `expectRows(n)` for writes.
 *   Each takes a function making the error to throw instead.
 *
 * @example
 * const user = await db.selectFrom(users).where('users.id', id).select(['users.email']).expectOne().execute();
 *
 * @example
 * const [user, posts] = await db.batch([
 *   db.selectFrom(users).where('users.id', id).select(['users.email']).takeFirst(),
 *   db.selectFrom(posts).where('posts.userId', id).select(['posts.title']),
 * ]);
 */
export class Query<T> {
	/** The type of the result. Never set. */
	declare readonly $result: T;

	/** @internal */
	readonly _quarry: QueryState<T>;

	/** @internal */
	constructor(state: QueryState<T>) {
		this._quarry = state;
	}

	/** Runs the query on the database it was started from. */
	async execute(options?: RunOptions): Promise<T> {
		const { executor, query, read, rows } = this._quarry;
		if (executor === undefined) {
			throw new Error(
				'The query has no database to run on: start it from `database(...)`',
			);
		}
		return read(
			await executor.execute(
				query,
				rows === undefined ? options : { ...options, ...rows },
			),
		);
	}

	/** The SQL and parameters `execute` sends: the builder's, whatever the shape. */
	toSQL(): CompiledQuery {
		return this._quarry.query;
	}

	/** The query itself: what `db.batch` takes from a query or a builder. */
	toQuery(): this {
		return this;
	}

	/** @deprecated A query runs with `execute()`; awaiting one rejects. */
	// oxlint-disable-next-line unicorn/no-thenable -- so that a forgotten execute() fails loudly
	readonly then = rejectAwait;
}

/** Any query, whatever its result. */
export type AnyQuery = Query<unknown>;

/**
 * What `db.batch` takes: a query, or a builder, which runs with its
 * default shape (`execute()` without a shape).
 */
export interface Executable<T> {
	toQuery(): Query<T>;
}

/** A builder that still needs the clauses `M` before it can run. */
export interface Missing<M extends string> {
	readonly missing: M;
}
