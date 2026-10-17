import type { CompiledQuery } from '../../src/compile.js';

/** A compiled query's SQL, parameters and tag, without the codecs chosen for them. */
export function plain(query: CompiledQuery): {
	sql: string;
	params: readonly unknown[];
	tag?: string;
} {
	return {
		sql: query.sql,
		params: query.params,
		...(query.tag === undefined ? {} : { tag: query.tag }),
	};
}

/** The names of the codecs a compiled query chose for its parameters and result columns. */
export function codecNames(query: CompiledQuery): {
	params: readonly (string | undefined)[];
	results: readonly (string | null)[];
} {
	return {
		params: query.paramCodecs?.map((codec) => codec?.name) ?? [],
		results: query.resultCodecs?.map((codec) => codec?.name ?? null) ?? [],
	};
}
