import type { CompiledQuery } from '../../src/compile.js';
import type {
	ExecuteOptions,
	ExecuteResult,
	Executor,
	TransactionExecutor,
} from '../../src/executor.js';

type Execute = (
	query: CompiledQuery,
	options?: ExecuteOptions,
) => Promise<{
	readonly rows: readonly unknown[];
	readonly rowCount?: number | null;
}>;

/**
 * A complete executor from an `execute` function, for tests without a
 * database: streams the rows in one batch, runs transactions inline
 * (callbacks after `fn` settles), and can't describe. It returns the rows
 * as `rowMode` and `keepRows` ask, from the object rows `execute` gives.
 */
export function executorFrom(execute: Execute): Executor {
	const run = async (
		query: CompiledQuery,
		options?: ExecuteOptions,
	): Promise<ExecuteResult> => {
		const { rows, rowCount } = await execute(query, options);
		const kept = rows.slice(0, options?.keepRows);
		return {
			rows:
				options?.rowMode === 'array'
					? kept.map((row) =>
							typeof row === 'object' && row !== null
								? Object.values(row)
								: [row],
						)
					: kept,
			rowCount: rowCount ?? rows.length,
			command: query.sql.split(' ')[0]?.toUpperCase() ?? '',
		};
	};
	const executor: Executor = {
		execute: run,
		async *stream(query, options) {
			yield (await run(query, options)).rows;
		},
		describe: () => Promise.reject(new Error('describe needs a database')),
		async batch(queries, options = {}) {
			const settled = await Promise.allSettled(
				queries.map(({ query, ...read }) =>
					run(query, { ...options, ...read }),
				),
			);
			if (options.transaction === undefined) return settled;
			const values = settled.map((outcome) => {
				if (outcome.status === 'rejected') throw outcome.reason;
				return outcome.value;
			});
			options.verify?.(values);
			return settled;
		},
		async transaction(fn) {
			const committed: (() => unknown)[] = [];
			const rolledBack: (() => unknown)[] = [];
			const tx: TransactionExecutor = {
				...executor,
				afterCommit: (callback) => committed.push(callback),
				afterRollback: (callback) => rolledBack.push(callback),
				setLocal: async (name, value) => {
					await run({
						sql: 'select set_config($1, $2, true)',
						params: [name, String(value)],
					});
				},
			};
			try {
				const result = await fn(tx);
				for (const callback of committed) callback();
				return result;
			} catch (error) {
				for (const callback of rolledBack) callback();
				throw error;
			}
		},
		close: async () => {},
	};
	return executor;
}

/** An executor returning `rows` for every query, recording the queries it ran. */
export function fakeExecutor(rows: readonly unknown[] = []): {
	executor: Executor;
	ran: CompiledQuery[];
} {
	const ran: CompiledQuery[] = [];
	return {
		ran,
		executor: executorFrom(async (query) => {
			ran.push(query);
			return { rows };
		}),
	};
}
