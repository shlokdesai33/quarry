import type { SourceLocation } from '../call-site.js';

/** How serious a difference between the code and the database is. */
export type Severity = 'error' | 'warning' | 'info';

/**
 * The stable code of each check, for filtering and documentation. Codes are
 * never renamed or reused.
 */
export type RuleCode =
	/** A table in the code is missing from the database. */
	| 'table-missing'
	/** A column in the code is missing from the database. */
	| 'column-missing'
	/** A column's SQL type, its modifiers or its arrayness differ. */
	| 'column-type-mismatch'
	/** The database allows null in a column the code says is never null. */
	| 'column-nullable-mismatch'
	/** The code allows null in a column the database declares `not null`. */
	| 'column-not-null-mismatch'
	/** The code declares `default()` but the database has no default. */
	| 'column-default-missing'
	/** The database fills a column in that the code requires on insert. */
	| 'column-default-undeclared'
	/** The code declares `identity()` but the column isn't an identity. */
	| 'column-identity-missing'
	/** The column is `generated always as identity`, but the code writes it. */
	| 'column-identity-undeclared'
	/** The code declares `generated()` but the column isn't generated. */
	| 'column-generated-missing'
	/** The column is generated, but the code writes it. */
	| 'column-generated-undeclared'
	/** An enum's labels differ between the code and the database. */
	| 'enum-label-mismatch'
	/** An enum has the same labels but in another order, which `<` follows. */
	| 'enum-label-order'
	/** The database has a column the code doesn't declare. */
	| 'column-extra';

/** One difference between the code and the database. */
export interface Diagnostic {
	readonly severity: Severity;
	readonly code: RuleCode;
	/** One line describing the difference, e.g. `users.age is bigint in the database`. */
	readonly message: string;
	/** The table's name in the database, as the code gives it. */
	readonly table: string;
	/** The column's name in the database, for column checks. */
	readonly column?: string;
	/** The key the column is declared under in the code, when it has one. */
	readonly key?: string;
	/** What the code declares, e.g. `integer`, `not null` or `['a', 'b']`. */
	readonly expected?: string;
	/** What the database has. */
	readonly actual?: string;
	/** A short label for the code frame, e.g. `found bigint`. */
	readonly label?: string;
	/** What to do, besides `fix`, e.g. to change the code instead. */
	readonly hint?: string;
	/** SQL that brings the database in line with the code. */
	readonly fix?: string;
	/** Where the table, column or enum was defined. */
	readonly source?: SourceLocation;
}

/** How a column compares, for the per-table view. */
export interface ColumnResult {
	/** The key in the code, or `undefined` for a column only the database has. */
	readonly key: string | undefined;
	/** The name in the database. */
	readonly name: string;
	/** The type the code declares, e.g. `varchar(32)[] null`. */
	readonly expected: string | undefined;
	/** The type in the database, or `undefined` if the column is missing. */
	readonly actual: string | undefined;
	/** The most severe diagnostic for the column, or `ok`. */
	readonly status: Severity | 'ok';
	readonly codes: readonly RuleCode[];
}

/** How a table compares, for the per-table view. */
export interface TableResult {
	/** The table's name as the code gives it. */
	readonly name: string;
	/** `schema.name` in the database, or `undefined` if it is missing. */
	readonly relation: string | undefined;
	/** What the relation is, or `undefined` if it is missing. */
	readonly kind:
		| 'table'
		| 'partitioned table'
		| 'view'
		| 'materialized view'
		| 'foreign table'
		| undefined;
	readonly status: Severity | 'ok';
	readonly columns: readonly ColumnResult[];
}

/** The result of `db.verify`. */
export interface VerifyReport {
	/** `true` when there are no errors. */
	readonly ok: boolean;
	/** Every difference, errors first, then in table and column order. */
	readonly diagnostics: readonly Diagnostic[];
	readonly tables: readonly TableResult[];
	readonly summary: {
		readonly errors: number;
		readonly warnings: number;
		readonly infos: number;
		/** Tables checked. */
		readonly tables: number;
		/** Columns checked, counting those only the code or the database has. */
		readonly columns: number;
		readonly durationMs: number;
	};
}

/** Options of `db.verify`. */
export interface VerifyOptions {
	/**
	 * Treat columns only the database has as errors, for a CI check that the
	 * code declares the whole schema. Defaults to `false`, where they are
	 * informational.
	 */
	readonly strict?: boolean | undefined;
	/**
	 * Look the tables up in this schema instead of through the session's
	 * `search_path`, as queries do.
	 */
	readonly schema?: string | undefined;
}
