import { ConnectionError } from './errors.js';

/** The oldest PostgreSQL release the driver supports, as `server_version_num`. */
export const MIN_SERVER_VERSION_NUM = 180000;

/**
 * What the other end of a connection supports beyond PostgreSQL 18
 * itself, which the driver requires: things a pooler or proxy in between
 * may change, and what the server offered during authentication.
 */
export interface Capabilities {
	/** The negotiated protocol version, e.g. `3.2`; poolers may negotiate 3.0. */
	readonly protocol: `3.${number}`;
	/** The negotiated protocol minor version. */
	readonly protocolMinor: number;
	/** Cancel keys longer than 4 bytes (protocol 3.2). */
	readonly longCancelKeys: boolean;
	/** `server_version` as reported, e.g. `18.6 (Ubuntu 18.6-1.pgdg24.04+2)`; poolers may hide or replace it. */
	readonly serverVersion: string | undefined;
	/** `in_hot_standby` is reported, so the server's role is known without a query. */
	readonly reportsHotStandby: boolean;
	/** SASL mechanisms offered during authentication, e.g. `SCRAM-SHA-256` and `SCRAM-SHA-256-PLUS`. */
	readonly saslMechanisms: readonly string[];
	/** PgBouncer in between, when it says so at login (1.26+). */
	readonly pgbouncer: PgBouncerInfo | undefined;
}

/** What PgBouncer 1.26+ reports about itself at login. */
export interface PgBouncerInfo {
	/** e.g. `1.26.0`. */
	readonly version: string;
	/** `session`, `transaction` or `statement`. */
	readonly poolMode: string | undefined;
	/** Its `max_prepared_statements`: 0 when it doesn't track named prepared statements. */
	readonly maxPreparedStatements: number | undefined;
}

/**
 * How named prepared statements fare through the other end:
 * - `kept`: as sent (a server, or a pooler in session mode);
 * - `rewritten`: a pooler maps each one to its own statement on whichever
 *   server connection runs it, rewriting every Bind (PgBouncer in
 *   transaction or statement mode, with `max_prepared_statements`);
 * - `unsupported`: a pooler switches server connections between
 *   transactions without tracking them, so one may be missing.
 */
export type StatementNames = 'kept' | 'rewritten' | 'unsupported';

export function statementNames(
	pgbouncer: PgBouncerInfo | undefined,
): StatementNames {
	if (pgbouncer?.poolMode === undefined || pgbouncer.poolMode === 'session')
		return 'kept';
	return pgbouncer.maxPreparedStatements === 0 ? 'unsupported' : 'rewritten';
}

function pgbouncerInfo(
	parameters: ReadonlyMap<string, string>,
): PgBouncerInfo | undefined {
	const version = parameters.get('pgbouncer.version');
	if (version === undefined) return undefined;
	const max = parameters.get('pgbouncer.max_prepared_statements');
	const maxPreparedStatements = max === undefined ? undefined : Number(max);
	return {
		version,
		poolMode: parameters.get('pgbouncer.pool_mode'),
		maxPreparedStatements: Number.isNaN(maxPreparedStatements)
			? undefined
			: maxPreparedStatements,
	};
}

/**
 * Parses `server_version` (`18.6`, `18.6 (Debian …)`, `19devel`, `9.6.24`)
 * into the `server_version_num` form (`180006`, `190000`, `90624`), or
 * undefined when it isn't a version (e.g. set by a pooler).
 */
export function parseServerVersion(
	text: string | undefined,
): number | undefined {
	const match = text?.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
	if (!match) return undefined;
	const major = Number(match[1]);
	const minor = Number(match[2] ?? 0);
	if (major >= 10) return major * 10000 + minor;
	return major * 10000 + minor * 100 + Number(match[3] ?? 0);
}

/**
 * Fails for servers older than PostgreSQL 18. A version that can't be
 * read (a pooler hiding it) passes: the server is assumed to be 18+.
 */
export function checkServerVersion(serverVersion: string | undefined): void {
	const num = parseServerVersion(serverVersion);
	if (num !== undefined && num < MIN_SERVER_VERSION_NUM) {
		throw new ConnectionError(
			`quarry requires PostgreSQL 18 or later; the server reports version ${serverVersion}`,
			{
				code: 'EVERSION',
			},
		);
	}
}

export function detectCapabilities(
	protocolMinor: number,
	parameters: ReadonlyMap<string, string>,
	saslMechanisms: readonly string[],
): Capabilities {
	return {
		protocol: `3.${protocolMinor}`,
		protocolMinor,
		longCancelKeys: protocolMinor >= 2,
		serverVersion: parameters.get('server_version'),
		reportsHotStandby: parameters.has('in_hot_standby'),
		saslMechanisms,
		pgbouncer: pgbouncerInfo(parameters),
	};
}
