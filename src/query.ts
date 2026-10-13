import type { CompiledQuery } from './compile.js';
import type { ExecuteResult, Executor, RunOptions } from './executor.js';

/** What a `Query` holds. */
interface QueryState<T> {
	readonly query: CompiledQuery;
	/** What `execute` runs on; `undefined` when it was built on its own. */
	readonly executor: Executor | undefined;
	/** Reads the result: the rows wanted, or throws as `one` and `expectRows` do. */
	readonly read: (result: ExecuteResult) => T;
	/**
	 * Whether `read` can throw once the statement has run, so a batch's
	 * transaction must wait for it before committing.
	 */
	readonly checked: boolean;
}

/**
 * A compiled query and how its result is read: every row, the first, the
 * one row, or a write's row count. The builders' `asAll`, `asFirst`,
 * `asOne`, `asMaybeOne` and (for writes) `asExecute` make one, without
 * running anything; `all`, `first`, `one`, … run it at once. `db.batch`
 * runs several in one round trip, and `execute` runs one on its own.
 *
 * @example
 * const [user, posts] = await db.batch([
 *   db.selectFrom(users).where('users.id', id).select(['users.email']).asOne(),
 *   db.selectFrom(posts).where('posts.userId', id).select(['posts.title']).asAll(),
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
		const { executor, query, read } = this._quarry;
		if (executor === undefined) {
			throw new Error(
				'The query has no database to run on: start it from `database(...)`',
			);
		}
		return read(await executor.execute(query, options));
	}
}

/** Any query, whatever its result. */
export type AnyQuery = Query<unknown>;
