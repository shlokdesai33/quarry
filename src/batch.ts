import type {
	BatchOptions,
	ExecuteBatchOptions,
	ExecuteResult,
	Executor,
} from './executor.js';
import type { Executable } from './query.js';

/** The results of the queries `Q`, by position. */
export type BatchResults<Q extends readonly Executable<unknown>[]> = {
	-readonly [K in keyof Q]: Q[K] extends Executable<infer T> ? T : never;
};

/**
 * Queries of a batch that ran outside a transaction failed. The others ran,
 * and what they wrote stays: `results` has each query's outcome, by
 * position, and `errors` the failures, in order.
 */
export class BatchError extends AggregateError {
	/** Each query's outcome, by position: its result, or why it failed. */
	readonly results: readonly PromiseSettledResult<unknown>[];

	constructor(results: readonly PromiseSettledResult<unknown>[]) {
		const errors = results.flatMap((outcome) =>
			outcome.status === 'rejected' ? [outcome.reason] : [],
		);
		super(
			errors,
			`${errors.length} of the ${results.length} queries in the batch failed; the others ran`,
		);
		this.name = 'BatchError';
		this.results = results;
	}
}

/** Runs `queries` on `executor` in one round trip; see `Database.batch`. */
export async function batchWith<const Q extends readonly Executable<unknown>[]>(
	executor: Executor,
	items: Q,
	options: BatchOptions = {},
): Promise<BatchResults<Q>> {
	const { transaction, ...run } = options;
	const queries = items.map((item) => item.toQuery());
	const read = (result: ExecuteResult, i: number) =>
		queries[i]!._quarry.read(result);
	let values: unknown[] | undefined;
	if (queries.length === 0) values = [];
	else {
		const execute: ExecuteBatchOptions = {
			...run,
			...(transaction === undefined || transaction === false
				? {}
				: { transaction: transaction === true ? {} : transaction }),
			// read before the transaction commits, so a failed check rolls it back
			...(queries.some((query) => query._quarry.checked)
				? {
						verify: (results: readonly ExecuteResult[]) => {
							values = results.map(read);
						},
					}
				: {}),
		};
		const settled = await executor.batch(
			queries.map((query) => query._quarry.query),
			execute,
		);
		values ??= valuesOf(settled, read);
	}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each value was read by its query, in order
	return values as BatchResults<Q>;
}

/** The value of each outcome, read; throws `BatchError` when any failed, or fails to read. */
function valuesOf(
	settled: readonly PromiseSettledResult<ExecuteResult>[],
	read: (result: ExecuteResult, i: number) => unknown,
): unknown[] {
	const outcomes = settled.map((outcome, i): PromiseSettledResult<unknown> => {
		if (outcome.status === 'rejected') return outcome;
		try {
			return { status: 'fulfilled', value: read(outcome.value, i) };
		} catch (reason) {
			return { status: 'rejected', reason };
		}
	});
	if (outcomes.some((outcome) => outcome.status === 'rejected')) {
		throw new BatchError(outcomes);
	}
	return outcomes.map((outcome) =>
		outcome.status === 'fulfilled' ? outcome.value : undefined,
	);
}
