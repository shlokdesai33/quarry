import { PostgresError } from './errors.js';

/**
 * The parts of an OpenTelemetry `Tracer` the driver uses, so
 * `trace.getTracer('…')` from `@opentelemetry/api` can be passed in without
 * the driver depending on it.
 */
export interface TracerLike {
	startSpan(
		name: string,
		options?: {
			kind?: number;
			attributes?: Record<string, string | number | boolean>;
		},
	): SpanLike;
}

export interface SpanLike {
	setAttribute(key: string, value: string | number | boolean): unknown;
	setStatus(status: { code: number; message?: string }): unknown;
	recordException(exception: Error): unknown;
	end(): void;
}

export interface TelemetryOptions {
	readonly tracer: TracerLike;
	/** Record the SQL text as `db.query.text` (default true). Parameters are never recorded. */
	readonly queryText?: boolean | undefined;
}

const SPAN_KIND_CLIENT = 2;
const STATUS_ERROR = 2;

/** The first keyword of a statement, upper-cased: `SELECT`, `INSERT`, `WITH`, … */
function operation(sql: string): string {
	const match = /^\s*(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*([A-Za-z]+)/.exec(
		sql,
	);
	return match?.[1]?.toUpperCase() ?? 'QUERY';
}

export interface SpanTarget {
	readonly database: string;
	readonly host: string;
	readonly port: number;
}

/** A span in progress; `finish` ends it with the row count or the error. */
export interface QuerySpan {
	finish(
		result: { rowCount?: number | null | undefined } | undefined,
		error?: unknown,
	): void;
}

/**
 * Starts a client span for a query, following OpenTelemetry's database
 * conventions: named by `tag`, or by the operation (the SQL's first
 * keyword, or `name`: `TRANSACTION`, whose span has no SQL text) and the
 * database.
 */
export function startQuerySpan(
	telemetry: TelemetryOptions,
	target: SpanTarget,
	sql: string,
	tag: string | undefined,
	name?: string,
): QuerySpan {
	const op = name ?? operation(sql);
	const attributes: Record<string, string | number | boolean> = {
		'db.system.name': 'postgresql',
		'db.namespace': target.database,
		'db.operation.name': op,
		'server.address': target.host,
	};
	if (!target.host.startsWith('/')) attributes['server.port'] = target.port;
	if (telemetry.queryText !== false && sql !== '')
		attributes['db.query.text'] = sql;
	if (tag !== undefined) attributes['db.query.summary'] = tag;
	const span = telemetry.tracer.startSpan(tag ?? `${op} ${target.database}`, {
		kind: SPAN_KIND_CLIENT,
		attributes,
	});
	return {
		finish(result, error) {
			try {
				if (error === undefined) {
					const rows = result?.rowCount;
					if (typeof rows === 'number')
						span.setAttribute('db.response.returned_rows', rows);
				} else {
					const err =
						error instanceof Error
							? error
							: new Error('A non-Error value was thrown', { cause: error });
					if (error instanceof PostgresError)
						span.setAttribute('db.response.status_code', error.code);
					span.setAttribute(
						'error.type',
						error instanceof PostgresError ? error.code : err.name,
					);
					span.recordException(err);
					span.setStatus({ code: STATUS_ERROR, message: err.message });
				}
			} finally {
				span.end();
			}
		},
	};
}
