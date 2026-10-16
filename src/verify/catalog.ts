import type { CompiledQuery } from '../compile.js';
import type { Executor } from '../executor.js';
import type { TableResult } from './report.js';
import { catalogType, type SqlType } from './sql-type.js';

/** A column as the catalog describes it. */
export interface CatalogColumn {
	readonly name: string;
	/** The type, with a domain resolved to its base type. */
	readonly type: SqlType;
	/** `format_type(atttypid, atttypmod)`: the declared type, e.g. a domain's name. */
	readonly declared: string;
	/** The domain the column is declared with, if any. */
	readonly domain: string | undefined;
	readonly notNull: boolean;
	readonly identity: 'always' | 'by default' | undefined;
	readonly generated: 'stored' | 'virtual' | undefined;
	/** The default's expression, or the generation expression of a generated column. */
	readonly expression: string | undefined;
	/** The labels in `enumsortorder`, when the element type is an enum. */
	readonly enumLabels: readonly string[] | undefined;
}

/** A relation as the catalog describes it. */
export interface CatalogRelation {
	readonly schema: string;
	readonly name: string;
	/** `undefined` for relations that aren't tables or views, e.g. sequences. */
	readonly kind: TableResult['kind'];
	/** `pg_class.relkind`. */
	readonly relkind: string;
	readonly columns: readonly CatalogColumn[];
}

/**
 * Describes the relations named in `$1` (a `text[]` literal of identifiers,
 * qualified or resolved through `search_path` as `to_regclass` does) and
 * their columns, one row per column in table and attribute order. A table
 * that isn't found, or has no columns, has one row with a null column.
 *
 * It only reads the catalog, and is written so every driver returns the same
 * rows: each value is text, a boolean or an `int4`, with no array or json
 * values (enum labels are a JSON array as text), and the one parameter is a
 * string. Aliases are lowercase single words so that column-name transforms
 * leave them alone.
 */
const catalogSql = `with wanted as (
  select w.ord::int4 as ord, pg_catalog.to_regclass(w.name) as oid
  from pg_catalog.unnest($1::text[]) with ordinality as w(name, ord)
)
select
  wanted.ord as tableindex,
  n.nspname::text as schemaname,
  c.relname::text as relname,
  c.relkind::text as relkind,
  a.attname::text as colname,
  pg_catalog.format_type(a.atttypid, a.atttypmod) as declared,
  case when t.typtype = 'd' then t.typname::text end as domainname,
  a.attnotnull as notnull,
  a.attidentity::text as identity,
  a.attgenerated::text as generated,
  pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) as expression,
  (r.typcategory = 'A') as isarray,
  e.typname::text as typname,
  en.nspname::text as typschema,
  pg_catalog.format_type(e.oid, null) as formatted,
  (e.typtype = 'e') as isenum,
  (case when t.typtype = 'd' then t.typtypmod else a.atttypmod end)::int4 as typmod,
  case when e.typtype = 'e' then (
    select coalesce(
      pg_catalog.json_agg(l.enumlabel::text order by l.enumsortorder)::text,
      '[]'
    )
    from pg_catalog.pg_enum l
    where l.enumtypid = e.oid
  ) end as enumlabels
from wanted
left join pg_catalog.pg_class c on c.oid = wanted.oid
left join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_attribute a
  on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_catalog.pg_attrdef ad
  on ad.adrelid = a.attrelid and ad.adnum = a.attnum
left join pg_catalog.pg_type t on t.oid = a.atttypid
left join pg_catalog.pg_type r
  on r.oid = case when t.typtype = 'd' then t.typbasetype else t.oid end
left join pg_catalog.pg_type e
  on e.oid = case when r.typcategory = 'A' then r.typelem else r.oid end
left join pg_catalog.pg_namespace en on en.oid = e.typnamespace
order by wanted.ord, a.attnum`;

/** A postgres array literal of text, e.g. `{"users","a \\"b\\""}`. */
export function textArrayLiteral(values: readonly string[]): string {
	const elements = values.map(
		(value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
	);
	return `{${elements.join(',')}}`;
}

function quote(part: string): string {
	return `"${part.replaceAll('"', '""')}"`;
}

/** A quoted identifier, as `to_regclass` parses it. */
function regclassName(name: string, schema: string | undefined): string {
	return schema === undefined ? quote(name) : `${quote(schema)}.${quote(name)}`;
}

/** The catalog query for the tables `names`. */
export function catalogQuery(
	names: readonly string[],
	schema: string | undefined,
): CompiledQuery {
	return {
		sql: catalogSql,
		params: [textArrayLiteral(names.map((name) => regclassName(name, schema)))],
		tag: 'quarry:verify',
	};
}

/**
 * Reads the relations named `names` from the catalog, in order: `undefined`
 * for each one that doesn't exist.
 */
export async function readCatalog(
	executor: Executor,
	names: readonly string[],
	schema: string | undefined,
): Promise<(CatalogRelation | undefined)[]> {
	const { rows } = await executor.execute(catalogQuery(names, schema));
	return parseCatalogRows(rows, names.length);
}

const kinds: Record<string, TableResult['kind']> = {
	r: 'table',
	p: 'partitioned table',
	v: 'view',
	m: 'materialized view',
	f: 'foreign table',
};

/** The relations in the catalog query's rows, by table index from 1. */
export function parseCatalogRows(
	rows: readonly unknown[],
	count: number,
): (CatalogRelation | undefined)[] {
	const relations: (
		| (Omit<CatalogRelation, 'columns'> & { columns: CatalogColumn[] })
		| undefined
	)[] = Array.from({ length: count }, () => undefined);
	for (const row of rows) {
		const index = Number(field(row, 'tableindex')) - 1;
		const name = text(field(row, 'relname'));
		if (name === undefined || index < 0 || index >= count) continue;
		const relkind = text(field(row, 'relkind')) ?? '';
		const relation = (relations[index] ??= {
			schema: text(field(row, 'schemaname')) ?? '',
			name,
			kind: kinds[relkind],
			relkind,
			columns: [],
		});
		const column = text(field(row, 'colname'));
		if (column !== undefined) relation.columns.push(parseColumn(row, column));
	}
	return relations;
}

function parseColumn(row: unknown, name: string): CatalogColumn {
	const identity = text(field(row, 'identity'));
	const generated = text(field(row, 'generated'));
	const labels = text(field(row, 'enumlabels'));
	return {
		name,
		type: catalogType({
			typname: text(field(row, 'typname')) ?? '',
			schema: text(field(row, 'typschema')) ?? '',
			formatted: text(field(row, 'formatted')) ?? '',
			isEnum: bool(field(row, 'isenum')),
			array: bool(field(row, 'isarray')),
			typmod: Number(field(row, 'typmod') ?? -1),
		}),
		declared: text(field(row, 'declared')) ?? '',
		domain: text(field(row, 'domainname')),
		notNull: bool(field(row, 'notnull')),
		identity:
			identity === 'a' ? 'always' : identity === 'd' ? 'by default' : undefined,
		generated:
			generated === 's' ? 'stored' : generated === 'v' ? 'virtual' : undefined,
		expression: text(field(row, 'expression')),
		enumLabels: labels === undefined ? undefined : parseLabels(labels),
	};
}

function parseLabels(json: string): string[] {
	const value: unknown = JSON.parse(json);
	return Array.isArray(value) ? value.map(String) : [];
}

function field(row: unknown, key: string): unknown {
	return typeof row === 'object' && row !== null
		? Reflect.get(row, key)
		: undefined;
}

/** A text value; drivers return `null`, or `undefined` for a missing field. */
function text(value: unknown): string | undefined {
	if (typeof value === 'string') return value === '' ? undefined : value;
	return typeof value === 'number' || typeof value === 'bigint'
		? String(value)
		: undefined;
}

/** A boolean, whether the driver parsed it or returned postgres's text. */
function bool(value: unknown): boolean {
	return value === true || value === 't' || value === 'true';
}
