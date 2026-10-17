import type { AsyncLocalStorage } from 'node:async_hooks';
import { type CompiledQuery, redactedQuery } from './compile.js';

/**
 * Limits on the queries one unit of work (a request, a job) runs on a
 * database, as `db.budget` takes them. Without `onExceeded`, going over
 * throws `QueryBudgetError`; with it, the callback is told once and the
 * queries go on.
 */
export interface QueryBudget {
	/** The most queries it may run. */
	readonly maxQueries?: number | undefined;
	/** The most time its queries may take together, in milliseconds. */
	readonly maxDurationMs?: number | undefined;
	/**
	 * Reports the budget being exceeded instead of throwing: called once,
	 * with the usage at that point, by the query that went over.
	 */
	readonly onExceeded?: ((usage: BudgetUsage) => void) | undefined;
}

/** What a budget's queries have used so far. */
export interface BudgetUsage {
	/** Queries run (or refused for going over `maxQueries`). */
	readonly queries: number;
	/** The time those that settled took together, in milliseconds. */
	readonly durationMs: number;
	/** Which limit was exceeded first, once one has been. */
	readonly exceeded: 'queries' | 'duration' | undefined;
}

/**
 * A query went over its `db.budget`. A query over `maxQueries` is refused
 * before it is sent; the query that takes the total time over
 * `maxDurationMs` has run, and throws this instead of returning (inside a
 * transaction, the error rolls it back). Every later query in the budget is
 * refused.
 */
export class QueryBudgetError extends Error {
	/** The limit that was exceeded. */
	readonly limit: 'queries' | 'duration';
	/** The budget's limits. */
	readonly budget: {
		readonly maxQueries?: number;
		readonly maxDurationMs?: number;
	};
	readonly usage: { readonly queries: number; readonly durationMs: number };
	/** The query that was refused or went over. Not enumerable. */
	declare readonly query: CompiledQuery;

	constructor(budget: Budget, query: CompiledQuery) {
		const limit = budget.exceeded ?? 'queries';
		const { maxQueries, maxDurationMs } = budget.limits;
		super(
			limit === 'queries'
				? `The query budget allows ${maxQueries} quer${maxQueries === 1 ? 'y' : 'ies'}, and this would be query ${budget.queries}`
				: `The query budget allows ${maxDurationMs}ms of queries, and they have taken ${Math.round(budget.durationMs)}ms`,
		);
		this.name = 'QueryBudgetError';
		this.limit = limit;
		this.budget = {
			...(maxQueries === undefined ? {} : { maxQueries }),
			...(maxDurationMs === undefined ? {} : { maxDurationMs }),
		};
		this.usage = { queries: budget.queries, durationMs: budget.durationMs };
		Object.defineProperty(this, 'query', { value: redactedQuery(query) });
	}
}

/** One running budget, counting the queries of the database that owns it. */
export class Budget implements BudgetUsage {
	readonly owner: object;
	readonly limits: QueryBudget;
	queries = 0;
	durationMs = 0;
	exceeded: 'queries' | 'duration' | undefined;

	constructor(owner: object, limits: QueryBudget) {
		this.owner = owner;
		this.limits = limits;
	}

	/** Whether going over throws, rather than being reported. */
	get throws(): boolean {
		return this.limits.onExceeded === undefined;
	}

	/** Marks the limit exceeded; reports it the first time, unless it throws. */
	exceed(limit: 'queries' | 'duration'): void {
		if (this.exceeded !== undefined) return;
		this.exceeded = limit;
		if (this.throws) return;
		try {
			this.limits.onExceeded?.(this.usage());
		} catch (error) {
			queueMicrotask(() => {
				throw error;
			});
		}
	}

	usage(): BudgetUsage {
		return {
			queries: this.queries,
			durationMs: this.durationMs,
			exceeded: this.exceeded,
		};
	}
}

let storage: AsyncLocalStorage<readonly Budget[]> | undefined;

/** The budgets the current async context runs in that count `owner`'s queries. */
export function budgetsOf(owner: object): Budget[] {
	const budgets = storage?.getStore();
	if (budgets === undefined) return [];
	return budgets.filter((budget) => budget.owner === owner);
}

function checkLimit(name: string, value: number | undefined): void {
	if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
		throw new RangeError(
			`${name} takes a number of at least 0, not ${String(value)}`,
		);
	}
}

/** Runs `fn` with a budget for `owner`'s queries, inside any it already runs in. */
export function runBudget<T>(
	owner: object,
	limits: QueryBudget,
	fn: (usage: BudgetUsage) => Promise<T>,
): Promise<T> {
	try {
		checkLimit('maxQueries', limits.maxQueries);
		checkLimit('maxDurationMs', limits.maxDurationMs);
	} catch (error) {
		return Promise.reject(error);
	}
	if (storage === undefined) {
		const hooks =
			typeof process === 'object' &&
			typeof process.getBuiltinModule === 'function'
				? process.getBuiltinModule('node:async_hooks')
				: undefined;
		if (hooks === undefined) {
			return Promise.reject(
				new Error(
					'db.budget needs AsyncLocalStorage from node:async_hooks, which this runtime lacks',
				),
			);
		}
		storage = new hooks.AsyncLocalStorage();
	}
	const budget = new Budget(owner, limits);
	const outer = storage.getStore() ?? [];
	return storage.run([...outer, budget], () => fn(budget));
}

/**
 * Counts a query against `budgets` before it is sent: throws
 * `QueryBudgetError` for a budget that throws and is exceeded, or that this
 * query takes over `maxQueries`.
 */
export function startQuery(
	budgets: readonly Budget[],
	query: CompiledQuery,
): void {
	startQueries(budgets, [query]);
}

/**
 * Counts the queries of a batch against `budgets` before any is sent, as
 * `startQuery` does each: a batch that would take a budget that throws over
 * `maxQueries` is refused whole, every query of it counted, and the error
 * names the first query over.
 */
export function startQueries(
	budgets: readonly Budget[],
	queries: readonly CompiledQuery[],
): void {
	const [first] = queries;
	if (first === undefined) return;
	for (const budget of budgets) {
		if (budget.exceeded !== undefined && budget.throws) {
			throw new QueryBudgetError(budget, first);
		}
	}
	for (const budget of budgets) {
		const { maxQueries } = budget.limits;
		if (
			budget.throws &&
			maxQueries !== undefined &&
			budget.queries + queries.length > maxQueries
		) {
			const over = queries[Math.max(0, maxQueries - budget.queries)] ?? first;
			budget.queries += queries.length;
			budget.exceed('queries');
			throw new QueryBudgetError(budget, over);
		}
	}
	for (const budget of budgets) {
		budget.queries += queries.length;
		const { maxQueries } = budget.limits;
		if (maxQueries !== undefined && budget.queries > maxQueries)
			budget.exceed('queries');
	}
}

/**
 * Adds a settled query's time to `budgets`: the error to throw instead of
 * its result when it takes one that throws over `maxDurationMs`.
 */
export function endQuery(
	budgets: readonly Budget[],
	query: CompiledQuery,
	durationMs: number,
): QueryBudgetError | undefined {
	let failure: QueryBudgetError | undefined;
	for (const budget of budgets) {
		budget.durationMs += durationMs;
		const { maxDurationMs } = budget.limits;
		if (
			maxDurationMs !== undefined &&
			budget.durationMs > maxDurationMs &&
			budget.exceeded === undefined
		) {
			budget.exceed('duration');
			if (budget.throws) failure ??= new QueryBudgetError(budget, query);
		}
	}
	return failure;
}
