import { type CallSite, resolveCallSite } from '../call-site.js';
import type { CatalogColumn, CatalogRelation } from './catalog.js';
import type {
	ColumnResult,
	Diagnostic,
	RuleCode,
	Severity,
	TableResult,
} from './report.js';
import { quoteIdentifier, quoteLiteral, quoteTable } from './sql.js';
import { renderType, sameType, type SqlType } from './sql-type.js';
import type { ColumnSpec, TableSpec } from './spec.js';

/** What comparing the code with the catalog found. */
export interface Comparison {
	readonly diagnostics: Diagnostic[];
	readonly tables: TableResult[];
	readonly columns: number;
}

/**
 * Compares each table the code declares with the catalog's relation of the
 * same index (`undefined` when it is missing). The result is plain data,
 * so it can be rendered as a report or, later, as a SQL diff.
 */
export function compare(
	specs: readonly TableSpec[],
	relations: readonly (CatalogRelation | undefined)[],
	options: {
		readonly strict?: boolean | undefined;
		readonly schema?: string | undefined;
	} = {},
): Comparison {
	const context: Context = {
		strict: options.strict === true,
		schema: options.schema,
		diagnostics: [],
		enumsChecked: new Set(),
	};
	const tables: TableResult[] = [];
	let columns = 0;
	specs.forEach((spec, i) => {
		const table = compareTable(spec, relations[i], context);
		columns += table.columns.length;
		tables.push(table);
	});
	return { diagnostics: context.diagnostics, tables, columns };
}

interface Context {
	readonly strict: boolean;
	/** The schema tables were looked up in, or `undefined` for `search_path`. */
	readonly schema: string | undefined;
	readonly diagnostics: Diagnostic[];
	/** Enums whose labels were already compared, reported once each. */
	readonly enumsChecked: Set<string>;
}

type DiagnosticInput = Omit<Diagnostic, 'source'> & {
	readonly site: CallSite | undefined;
};

function report(context: Context, input: DiagnosticInput): Diagnostic {
	const { site, ...rest } = input;
	const source = resolveCallSite(site);
	const diagnostic: Diagnostic = source ? { ...rest, source } : rest;
	context.diagnostics.push(diagnostic);
	return diagnostic;
}

function compareTable(
	spec: TableSpec,
	relation: CatalogRelation | undefined,
	context: Context,
): TableResult {
	const table = quoteTable(spec.name, context.schema);
	if (relation?.kind === undefined) {
		const message = relation
			? `${spec.name} is not a table or view in the database (relkind '${relation.relkind}')`
			: `table ${spec.name} does not exist in the database`;
		report(context, {
			severity: 'error',
			code: 'table-missing',
			message,
			table: spec.name,
			label: relation ? 'not a table' : 'not in the database',
			fix: createTable(spec, table),
			site: spec.site,
		});
		return {
			name: spec.name,
			relation: undefined,
			kind: undefined,
			status: 'error',
			columns: spec.columns.map((column) => ({
				key: column.key,
				name: column.name,
				expected: describeCode(column),
				actual: undefined,
				status: 'error',
				codes: ['table-missing'],
			})),
		};
	}

	const byName = new Map(
		relation.columns.map((column) => [column.name, column]),
	);
	const results: ColumnResult[] = [];
	for (const column of spec.columns) {
		const actual = byName.get(column.name);
		byName.delete(column.name);
		const before = context.diagnostics.length;
		if (actual === undefined) {
			report(context, {
				severity: 'error',
				code: 'column-missing',
				message: `column ${spec.name}.${column.name} does not exist in the database`,
				table: spec.name,
				column: column.name,
				key: column.key,
				expected: describeCode(column),
				label: 'not in the database',
				fix: `alter table ${table} add column ${columnDefinition(column)};`,
				site: column.site,
			});
		} else {
			compareColumn(spec, column, actual, relation, table, context);
		}
		results.push(
			columnResult(
				column.key,
				column.name,
				describeCode(column),
				actual && describeCatalog(actual),
				context.diagnostics.slice(before),
			),
		);
	}

	for (const extra of byName.values()) {
		const before = context.diagnostics.length;
		const omittable =
			!extra.notNull ||
			extra.expression !== undefined ||
			extra.identity !== undefined;
		const severity: Severity = context.strict
			? 'error'
			: omittable
				? 'info'
				: 'warning';
		report(context, {
			severity,
			code: 'column-extra',
			message: omittable
				? `column ${spec.name}.${extra.name} is in the database but not in the code`
				: `column ${spec.name}.${extra.name} is in the database but not in the code, and is not null without a default, so inserts will fail`,
			table: spec.name,
			column: extra.name,
			actual: describeCatalog(extra),
			label: `${extra.name} is not declared`,
			hint: `declare it: ${camelCase(extra.name)}: ${suggestCode(extra)}`,
			...(context.strict && {
				fix: `alter table ${table} drop column ${quoteIdentifier(extra.name)};`,
			}),
			site: spec.site,
		});
		results.push(
			columnResult(
				undefined,
				extra.name,
				undefined,
				describeCatalog(extra),
				context.diagnostics.slice(before),
			),
		);
	}

	return {
		name: spec.name,
		relation: `${relation.schema}.${relation.name}`,
		kind: relation.kind,
		status: worst(results.map((result) => result.status)),
		columns: results,
	};
}

function compareColumn(
	spec: TableSpec,
	column: ColumnSpec,
	actual: CatalogColumn,
	relation: CatalogRelation,
	table: string,
	context: Context,
) {
	const name = `${spec.name}.${column.name}`;
	const ident = quoteIdentifier(column.name);
	const alter = `alter table ${table} alter column ${ident}`;
	const base = {
		table: spec.name,
		column: column.name,
		key: column.key,
		site: column.site,
	};

	if (!sameType(column.type, actual.type) && !sameDomain(column.type, actual)) {
		const expected = renderType(column.type);
		const found = describeType(actual);
		const code = suggestType(actual.type);
		report(context, {
			...base,
			severity: 'error',
			code: 'column-type-mismatch',
			message: `${name} is ${found} in the database, but ${expected} in the code`,
			expected,
			actual: found,
			label: `found ${found}`,
			...(code !== undefined && { hint: `or declare it as ${code}` }),
			fix: `${alter} type ${expected} using ${ident}::${expected};`,
		});
	} else if (column.enum && actual.enumLabels) {
		compareEnum(spec.name, column, actual.enumLabels, context);
	}

	// views report every column as nullable and without defaults
	if (relation.kind === 'view' || relation.kind === 'materialized view') {
		return;
	}

	if (!column.nullable && !actual.notNull) {
		report(context, {
			...base,
			severity: 'error',
			code: 'column-nullable-mismatch',
			message: `${name} allows null in the database, but not in the code`,
			expected: 'not null',
			actual: 'null',
			label: 'nullable in the database',
			hint: 'or add .nullable() in the code',
			fix: `${alter} set not null;`,
		});
	} else if (column.nullable && actual.notNull) {
		report(context, {
			...base,
			severity: 'warning',
			code: 'column-not-null-mismatch',
			message: `${name} is not null in the database, but nullable in the code`,
			expected: 'null',
			actual: 'not null',
			label: 'never null in the database',
			hint: 'remove .nullable() from the code, or allow null in the database',
			fix: `${alter} drop not null;`,
		});
	}

	compareFill(name, column, actual, alter, base, context);
}

function compareFill(
	name: string,
	column: ColumnSpec,
	actual: CatalogColumn,
	alter: string,
	base: Pick<DiagnosticInput, 'table' | 'column' | 'key' | 'site'>,
	context: Context,
) {
	const fill = catalogFill(actual);
	const found = describeFill(actual);
	const add = (
		severity: Severity,
		code: RuleCode,
		message: string,
		rest: Partial<Pick<Diagnostic, 'label' | 'hint' | 'fix'>> = {},
	) =>
		report(context, {
			...base,
			severity,
			code,
			message,
			expected: column.fill ?? 'no default',
			actual: found,
			...rest,
		});

	switch (column.fill) {
		case 'default':
			if (fill === undefined) {
				add(
					'error',
					'column-default-missing',
					`${name} has no default in the database, but the code declares default()`,
					{
						label: 'no default in the database',
						hint: 'or remove .default() from the code',
						fix: `${alter} set default <expression>;`,
					},
				);
			} else if (fill === 'generated') {
				generatedUndeclared();
			} else if (actual.identity === 'always') {
				identityUndeclared();
			}
			return;
		case 'identity':
			if (fill === undefined || fill === 'default') {
				add(
					fill === undefined ? 'error' : 'warning',
					'column-identity-missing',
					fill === undefined
						? `${name} is not an identity in the database, but the code declares identity()`
						: `${name} has a default (${actual.expression ?? ''}) in the database, not an identity`,
					{
						label: fill === undefined ? 'not an identity' : `default ${found}`,
						fix: `${alter} add generated always as identity;`,
					},
				);
			}
			return;
		case 'generated':
			if (fill === undefined) {
				add(
					actual.notNull ? 'error' : 'warning',
					'column-generated-missing',
					actual.notNull
						? `${name} is not generated in the database, and is not null without a default, so inserts will fail`
						: `${name} is not generated in the database, but the code declares generated()`,
					{
						label: 'not generated in the database',
						hint: 'recreate the column as generated always as (...) stored, or declare it .default() or .nullable()',
					},
				);
			}
			return;
		case undefined:
			if (fill === 'generated') {
				generatedUndeclared();
			} else if (actual.identity === 'always') {
				identityUndeclared();
			} else if (fill !== undefined) {
				add(
					'info',
					'column-default-undeclared',
					`${name} has a default in the database, so inserts could omit it`,
					{
						label: found,
						hint:
							fill === 'identity'
								? 'declare it .identity() or .default()'
								: 'declare it .default()',
					},
				);
			}
			return;
	}

	function generatedUndeclared() {
		add(
			'error',
			'column-generated-undeclared',
			`${name} is generated in the database, so inserts and updates that set it fail`,
			{
				label: `generated always as (${actual.expression ?? ''})`,
				hint: 'declare it .generated()',
			},
		);
	}

	function identityUndeclared() {
		add(
			'error',
			'column-identity-undeclared',
			`${name} is generated always as identity in the database, so inserts that set it fail`,
			{
				label: 'generated always as identity',
				hint: 'declare it .identity()',
				fix: `${alter} set generated by default;`,
			},
		);
	}
}

function compareEnum(
	table: string,
	column: ColumnSpec,
	labels: readonly string[],
	context: Context,
) {
	const spec = column.enum;
	if (spec === undefined || context.enumsChecked.has(spec.name)) return;
	context.enumsChecked.add(spec.name);
	const type = quoteIdentifier(spec.name);
	const missing = spec.labels.filter((label) => !labels.includes(label));
	const extra = labels.filter((label) => !spec.labels.includes(label));
	const base = {
		table,
		column: column.name,
		key: column.key,
		expected: spec.labels.map(quoteLiteral).join(', '),
		actual: labels.map(quoteLiteral).join(', '),
		site: spec.site ?? column.site,
	};
	if (missing.length > 0 || extra.length > 0) {
		const parts = [
			missing.length > 0 &&
				`the database lacks ${missing.map(quoteLiteral).join(', ')}`,
			extra.length > 0 &&
				`the code lacks ${extra.map(quoteLiteral).join(', ')}`,
		].filter((part) => part !== false);
		const fix = missing
			.map((label) => {
				const i = spec.labels.indexOf(label);
				const after = spec.labels
					.slice(0, i)
					.findLast((previous) => labels.includes(previous));
				const position =
					after === undefined ? '' : ` after ${quoteLiteral(after)}`;
				return `alter type ${type} add value ${quoteLiteral(label)}${position};`;
			})
			.join('\n');
		report(context, {
			...base,
			severity: 'error',
			code: 'enum-label-mismatch',
			message: `enum ${spec.name} differs: ${parts.join('; ')}`,
			label: parts.join('; '),
			...(extra.length > 0 && {
				hint: `add ${extra.map(quoteLiteral).join(', ')} to defineEnum('${spec.name}', ...); postgres can't drop enum labels`,
			}),
			...(fix !== '' && { fix }),
		});
	} else if (spec.labels.some((label, i) => labels[i] !== label)) {
		report(context, {
			...base,
			severity: 'warning',
			code: 'enum-label-order',
			message: `enum ${spec.name} has its labels in another order in the database, which < and > follow`,
			label: `database order: ${labels.map(quoteLiteral).join(', ')}`,
			hint: `list them as [${labels.map(quoteLiteral).join(', ')}] in defineEnum`,
		});
	}
}

function columnResult(
	key: string | undefined,
	name: string,
	expected: string | undefined,
	actual: string | undefined,
	diagnostics: readonly Diagnostic[],
): ColumnResult {
	return {
		key,
		name,
		expected,
		actual,
		status: worst(diagnostics.map((diagnostic) => diagnostic.severity)),
		codes: diagnostics.map((diagnostic) => diagnostic.code),
	};
}

const rank = { ok: 0, info: 1, warning: 2, error: 3 } as const;

function worst(statuses: readonly (Severity | 'ok')[]): Severity | 'ok' {
	let result: Severity | 'ok' = 'ok';
	for (const status of statuses) {
		if (rank[status] > rank[result]) result = status;
	}
	return result;
}

function catalogFill(column: CatalogColumn): ColumnSpec['fill'] {
	if (column.identity !== undefined) return 'identity';
	if (column.generated !== undefined) return 'generated';
	if (column.expression !== undefined) return 'default';
	return undefined;
}

function describeFill(column: CatalogColumn): string {
	if (column.identity !== undefined) {
		return `generated ${column.identity} as identity`;
	}
	if (column.generated !== undefined) {
		return `generated always as (${column.expression ?? ''}) ${column.generated}`;
	}
	if (column.expression !== undefined) return `default ${column.expression}`;
	return 'no default';
}

/** Whether the code names the domain the column is declared with (a `defineType` of it). */
function sameDomain(expected: SqlType, actual: CatalogColumn): boolean {
	if (actual.domain === undefined || expected.array !== actual.type.array)
		return false;
	const name = expected.name.split('.').at(-1)?.replaceAll('"', '');
	return name === actual.domain;
}

/** The database's type, naming the domain it is declared with. */
function describeType(column: CatalogColumn): string {
	const type = renderType(column.type);
	return column.domain ? `${type} (domain ${column.declared})` : type;
}

/** The code's column for the per-table view, e.g. `text null`. */
function describeCode(column: ColumnSpec): string {
	return `${renderType(column.type)}${column.nullable ? ' null' : ''}`;
}

/** The database's column for the per-table view, e.g. `text null`. */
function describeCatalog(column: CatalogColumn): string {
	return `${describeType(column)}${column.notNull ? '' : ' null'}`;
}

/** A column's definition, as `create table` and `add column` take it. */
function columnDefinition(column: ColumnSpec): string {
	const parts = [quoteIdentifier(column.name), renderType(column.type)];
	if (column.fill === 'identity') {
		parts.push('generated always as identity');
	} else {
		if (!column.nullable) parts.push('not null');
		if (column.fill === 'default') parts.push('default <expression>');
		if (column.fill === 'generated') {
			parts.push('generated always as (<expression>) stored');
		}
	}
	return parts.join(' ');
}

function createTable(spec: TableSpec, name: string): string {
	const columns = spec.columns.map((column) => `  ${columnDefinition(column)}`);
	return `create table ${name} (\n${columns.join(',\n')}\n);`;
}

/** The quarry factories of the database types they map to. */
const factories: Record<string, string> = {
	smallint: 'smallint',
	integer: 'integer',
	bigint: 'bigint',
	real: 'real',
	'double precision': 'doublePrecision',
	numeric: 'decimal',
	boolean: 'boolean',
	text: 'text',
	varchar: 'varchar',
	uuid: 'uuid',
	bytea: 'bytea',
	date: 'date',
	time: 'time',
	timestamp: 'timestamp',
	timestamptz: 'timestamptz',
	interval: 'interval',
	jsonb: 'jsonb',
	inet: 'inet',
	tsvector: 'tsvector',
	daterange: 'daterange',
	tstzrange: 'tstzrange',
	vector: 'vector',
};

/** The quarry column for a database type, e.g. `array(varchar(32))`. */
function suggestType(type: SqlType): string | undefined {
	const factory = type.isEnum ? undefined : factories[type.name];
	if (factory === undefined) return undefined;
	const args =
		(type.name === 'varchar' || type.name === 'numeric') && type.modifiers
			? type.modifiers.join(', ')
			: '';
	const element = `${factory}(${args})`;
	return type.array ? `array(${element})` : element;
}

/** The quarry column for a column only the database has. */
function suggestCode(column: CatalogColumn): string {
	const type = suggestType(column.type) ?? `/* ${describeType(column)} */`;
	const key = camelCase(column.name);
	const modifiers = [
		key === column.name ? '' : `.name('${column.name}')`,
		column.notNull ? '' : '.nullable()',
		column.identity === 'always'
			? '.identity()'
			: column.generated
				? '.generated()'
				: column.expression || column.identity
					? '.default()'
					: '',
	];
	return `${type}${modifiers.join('')}`;
}

function camelCase(name: string): string {
	return name.replace(/_+([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}
