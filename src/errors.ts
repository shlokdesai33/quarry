import type { IntegrityConstraintViolation } from './driver/errors.js';
import type { AnyTable } from './table.js';
import type { ColumnKey } from './write-query.js';

/**
 * The columns a constraint error names, by the keys `table` declares them
 * under (`email` for a column named `email_address` in the database).
 * Undefined when the error is about another table, names no columns (most
 * check constraints), or names one `table` doesn't have, such as an
 * expression in a unique index.
 *
 * @example
 * catch (error) {
 *   if (error instanceof UniqueViolation && violatedColumns(error, users)?.includes('email'))
 *     return reply.status(409).send({ field: 'email' });
 *   throw error;
 * }
 */
export function violatedColumns<T extends AnyTable>(
	error: IntegrityConstraintViolation,
	table: T,
): ColumnKey<T>[] | undefined {
	if (error.table !== undefined && error.table !== table._quarry.source)
		return undefined;
	const names = error.columns;
	if (names === undefined) return undefined;
	const keys = new Map<string, string>();
	for (const [key, column] of Object.entries(table.schema.columns))
		keys.set(column._quarry.columnName ?? key, key);
	const found = names.map((name) => keys.get(name));
	return found.every((key) => key !== undefined) ? found : undefined;
}
