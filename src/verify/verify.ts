import type { Executor } from '../executor.js';
import type { AnyTable } from '../table.js';
import { readCatalog } from './catalog.js';
import { compare } from './compare.js';
import type { VerifyOptions, VerifyReport } from './report.js';
import { describeTables } from './spec.js';

/**
 * Compares the tables the code declares with the database, through one
 * read-only catalog query on `executor`. See `Database.verify`.
 */
export async function verifyWith(
	executor: Executor,
	tables: readonly AnyTable[],
	options: VerifyOptions = {},
): Promise<VerifyReport> {
	const start = performance.now();
	const specs = describeTables(tables);
	const relations =
		specs.length === 0
			? []
			: await readCatalog(
					executor,
					specs.map((spec) => spec.name),
					options.schema,
				);
	const {
		diagnostics,
		tables: results,
		columns,
	} = compare(specs, relations, options);
	const count = (severity: string) =>
		diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
	const errors = count('error');
	return {
		ok: errors === 0,
		diagnostics,
		tables: results,
		summary: {
			errors,
			warnings: count('warning'),
			infos: count('info'),
			tables: specs.length,
			columns,
			durationMs: performance.now() - start,
		},
	};
}
