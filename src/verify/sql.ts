/**
 * The reserved key words of postgres's grammar, which can't be identifiers
 * unquoted, plus those that can't be column names.
 */
const reserved = new Set(
	`all analyse analyze and any array as asc asymmetric authorization binary
	both case cast check collate collation column concurrently constraint create
	cross current_catalog current_date current_role current_schema current_time
	current_timestamp current_user default deferrable desc distinct do else end
	except false fetch for foreign freeze from full grant group having ilike in
	initially inner intersect into is isnull join lateral leading left like limit
	localtime localtimestamp natural not notnull null offset on only or order
	outer overlaps placing primary references returning right select session_user
	similar some symmetric system_user table tablesample then to trailing true
	union unique user using variadic verbose when where window with between bigint
	bit boolean char character coalesce dec decimal exists extract float greatest
	grouping inout int integer interval json least national nchar none normalize
	nullif numeric out overlay position precision real row setof smallint
	substring time timestamp treat trim values varchar xmlattributes xmlconcat
	xmlelement xmlexists xmlforest xmlnamespaces xmlparse xmlpi xmlroot
	xmlserialize xmltable`.split(/\s+/),
);

/**
 * An identifier as SQL for people to read: bare when postgres reads it back
 * unchanged, quoted otherwise.
 */
export function quoteIdentifier(name: string): string {
	return /^[a-z_][a-z0-9_$]*$/.test(name) && !reserved.has(name)
		? name
		: `"${name.replaceAll('"', '""')}"`;
}

/** A table name, qualified unless it is in `public`. */
export function quoteTable(name: string, schema: string | undefined): string {
	return schema === undefined || schema === 'public'
		? quoteIdentifier(name)
		: `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

/** A string literal, for enum labels. */
export function quoteLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}
