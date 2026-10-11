import type { NoticeFields } from './protocol/messages.js';

/** An error raised by the driver itself rather than reported by the server. */
export class DriverError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'DriverError';
	}
}

/** The server sent bytes that are not valid protocol. The connection is closed. */
export class ProtocolError extends DriverError {
	constructor(message: string) {
		super(message);
		this.name = 'ProtocolError';
	}
}

/**
 * The connection failed or was lost: it could not be opened, TLS or
 * authentication failed on the client side, or the socket closed.
 */
export class ConnectionError extends DriverError {
	/** The system error code, e.g. `ECONNREFUSED`, when there is one. */
	readonly code: string | undefined;

	constructor(message: string, options?: ErrorOptions & { code?: string }) {
		super(message, options);
		this.name = 'ConnectionError';
		this.code = options?.code;
	}
}

/** A query or connection attempt was aborted by an `AbortSignal` or a client-side timeout. */
export class AbortError extends DriverError {
	constructor(message = 'The operation was aborted', options?: ErrorOptions) {
		super(message, options);
		this.name = 'AbortError';
	}
}

/** Where a query error came from, kept off the enumerable properties so params don't leak into logs. */
export interface ErrorQuery {
	readonly sql: string;
	readonly params: readonly unknown[];
	/** The query's label (quarry's `tag()`), when it has one. */
	readonly tag?: string | undefined;
}

/**
 * An error reported by the server (ErrorResponse), with every field it
 * sent. Subclasses classify common SQLSTATEs; `postgresError` picks one.
 */
export class PostgresError extends Error {
	/** `ERROR`, `FATAL` or `PANIC` (not localized). */
	readonly severity: string;
	/** The SQLSTATE code, e.g. `23505`. */
	readonly code: string;
	readonly detail: string | undefined;
	readonly hint: string | undefined;
	/** 1-based character position in the query where the error occurred. */
	readonly position: number | undefined;
	readonly internalPosition: number | undefined;
	readonly internalQuery: string | undefined;
	/** The call stack context (PL/pgSQL functions, SQL functions). */
	readonly where: string | undefined;
	readonly schema: string | undefined;
	readonly table: string | undefined;
	readonly column: string | undefined;
	readonly dataType: string | undefined;
	readonly constraint: string | undefined;
	readonly file: string | undefined;
	readonly line: number | undefined;
	readonly routine: string | undefined;
	/** Every field as sent, keyed by protocol code. */
	declare readonly fields: NoticeFields;
	/** The query that failed, when there was one. Not enumerable. */
	declare readonly query: ErrorQuery | undefined;

	constructor(fields: NoticeFields, query?: ErrorQuery) {
		super(fields['M'] ?? 'Unknown postgres error');
		this.name = 'PostgresError';
		this.severity = fields['V'] ?? fields['S'] ?? 'ERROR';
		this.code = fields['C'] ?? 'XX000';
		this.detail = fields['D'];
		this.hint = fields['H'];
		this.position = toInt(fields['P']);
		this.internalPosition = toInt(fields['p']);
		this.internalQuery = fields['q'];
		this.where = fields['W'];
		this.schema = fields['s'];
		this.table = fields['t'];
		this.column = fields['c'];
		this.dataType = fields['d'];
		this.constraint = fields['n'];
		this.file = fields['F'];
		this.line = toInt(fields['L']);
		this.routine = fields['R'];
		Object.defineProperty(this, 'fields', { value: fields });
		Object.defineProperty(this, 'query', { value: query, writable: true });
	}

	/**
	 * Whether re-running the transaction may succeed: a serialization
	 * failure (40001) or a deadlock (40P01).
	 */
	get isRetryable(): boolean {
		return this.code === '40001' || this.code === '40P01';
	}

	/** Whether the server closes the session after this error (FATAL or PANIC). */
	get isFatal(): boolean {
		return this.severity === 'FATAL' || this.severity === 'PANIC';
	}
}

/** A constraint check failed (SQLSTATE class 23). */
export class IntegrityConstraintViolation extends PostgresError {
	/**
	 * The columns named in the error: from the `column` field, or parsed
	 * from a `Key (a, b)=(…)` detail. Undefined when neither says.
	 */
	get columns(): readonly string[] | undefined {
		if (this.column !== undefined) return [this.column];
		const match = this.detail?.match(/^Key \((.*?)\)=/);
		return match?.[1]?.split(', ').map(unquoteIdentifier);
	}
}

/** 23505: a unique or primary-key constraint. */
export class UniqueViolation extends IntegrityConstraintViolation {}
/** 23503: a foreign-key constraint. */
export class ForeignKeyViolation extends IntegrityConstraintViolation {}
/** 23502: a NOT NULL constraint. */
export class NotNullViolation extends IntegrityConstraintViolation {}
/** 23514: a CHECK constraint. */
export class CheckViolation extends IntegrityConstraintViolation {}
/** 23P01: an exclusion constraint. */
export class ExclusionViolation extends IntegrityConstraintViolation {}
/** 40001: a serializable transaction conflicted with another; retry it. */
export class SerializationFailure extends PostgresError {}
/** 40P01: a deadlock was detected and this transaction was chosen to abort; retry it. */
export class DeadlockDetected extends PostgresError {}
/** 55P03: a lock could not be taken (`nowait`, `lock_timeout`). */
export class LockNotAvailable extends PostgresError {}
/** 25006: a write was attempted in a read-only transaction. */
export class ReadOnlyTransaction extends PostgresError {}
/** 42P01: the table does not exist. */
export class UndefinedTable extends PostgresError {}
/** 42703: the column does not exist. */
export class UndefinedColumn extends PostgresError {}

/** Why a statement was canceled. */
export type CancelReason =
	/** The server's `statement_timeout` (including a per-query timeout). */
	| 'statement_timeout'
	/** A cancel request from this or another client (`pg_cancel_backend`). */
	| 'user'
	/** This client canceled it through an `AbortSignal`. */
	| 'abort'
	/** This client canceled it when its client-side `timeout` expired. */
	| 'timeout';

/** 57014: the statement was canceled. */
export class QueryCanceled extends PostgresError {
	#by: 'abort' | 'timeout' | undefined;

	/** Why it was canceled. */
	get reason(): CancelReason {
		if (this.#by !== undefined) return this.#by;
		return this.message.includes('statement timeout')
			? 'statement_timeout'
			: 'user';
	}

	/** @internal Records that this client requested the cancel, and why. */
	canceledBy(reason: 'abort' | 'timeout'): void {
		this.#by = reason;
	}
}

const classes: Readonly<
	Record<
		string,
		new (fields: NoticeFields, query?: ErrorQuery) => PostgresError
	>
> = {
	'23505': UniqueViolation,
	'23503': ForeignKeyViolation,
	'23502': NotNullViolation,
	'23514': CheckViolation,
	'23P01': ExclusionViolation,
	'40001': SerializationFailure,
	'40P01': DeadlockDetected,
	'55P03': LockNotAvailable,
	'25006': ReadOnlyTransaction,
	'42P01': UndefinedTable,
	'42703': UndefinedColumn,
	'57014': QueryCanceled,
};

/** The `PostgresError` subclass for an ErrorResponse's SQLSTATE. */
export function postgresError(
	fields: NoticeFields,
	query?: ErrorQuery,
): PostgresError {
	const code = fields['C'] ?? '';
	const Class =
		classes[code] ??
		(code.startsWith('23') ? IntegrityConstraintViolation : PostgresError);
	return new Class(fields, query);
}

function toInt(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const n = Number.parseInt(value, 10);
	return Number.isNaN(n) ? undefined : n;
}

function unquoteIdentifier(name: string): string {
	return name.startsWith('"') && name.endsWith('"')
		? name.slice(1, -1).replaceAll('""', '"')
		: name;
}
