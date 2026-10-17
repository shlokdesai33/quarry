import type { CallSite } from '../call-site.js';
import type { ColumnFill } from '../column/base-column.js';
import { EnumType } from '../data-type/enum.js';
import { ArrayType } from '../data-type/array.js';
import type { AnyTable } from '../table.js';
import { codeType, type SqlType } from './sql-type.js';

/** An enum as the code declares it. */
export interface EnumSpec {
	readonly name: string;
	readonly labels: readonly string[];
	readonly site: CallSite | undefined;
}

/** A column as the code declares it. */
export interface ColumnSpec {
	/** The key it is declared under. */
	readonly key: string;
	/** Its name in the database. */
	readonly name: string;
	readonly type: SqlType;
	readonly enum: EnumSpec | undefined;
	readonly nullable: boolean;
	readonly fill: ColumnFill;
	readonly site: CallSite | undefined;
}

/**
 * A table as the code declares it: what `db.verify` compares against the
 * catalog, and what a SQL diff would render.
 */
export interface TableSpec {
	/** Its name in the database. */
	readonly name: string;
	readonly columns: readonly ColumnSpec[];
	readonly site: CallSite | undefined;
}

/** What the code declares for each table, once per table name. */
export function describeTables(tables: readonly AnyTable[]): TableSpec[] {
	const specs = new Map<string, TableSpec>();
	for (const table of tables) {
		const name = table._quarry.source;
		if (specs.has(name)) continue;
		specs.set(name, describeTable(table));
	}
	return [...specs.values()];
}

/** What the code declares for a table. */
function describeTable(table: AnyTable): TableSpec {
	return {
		name: table._quarry.source,
		site: table._quarry.site,
		columns: Object.entries(table.schema.columns).map(([key, column]) => {
			const { dataType, columnName, nullable, fill, site } = column._quarry;
			const element =
				dataType instanceof ArrayType ? dataType.element : dataType;
			return {
				key,
				name: columnName ?? key,
				type: codeType(dataType),
				enum:
					element instanceof EnumType
						? {
								name: element.enumName,
								labels: element.values,
								site: element.site,
							}
						: undefined,
				nullable,
				fill,
				site,
			};
		}),
	};
}
