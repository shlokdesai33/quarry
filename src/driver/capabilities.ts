/**
 * What the server on the other end of a connection supports, detected from
 * the negotiated protocol version and the parameters the server reported.
 * Code that depends on a server feature consults this rather than
 * comparing version numbers itself, so supporting a new release means
 * adding a field here.
 *
 * Behind a pooler, `server_version` may be the pooler's own setting or
 * missing; version-derived fields are then false, and callers should
 * treat them as "not known to be supported".
 */
export interface Capabilities {
	/** The negotiated protocol version, e.g. `3.2`. */
	readonly protocol: `3.${number}`;
	/** The negotiated protocol minor version. */
	readonly protocolMinor: number;
	/** `server_version` as reported, e.g. `18.6 (Ubuntu 18.6-1.pgdg24.04+2)`. */
	readonly serverVersion: string | undefined;
	/**
	 * The server version as a number, like `server_version_num` (`180006`).
	 * Parsed from `server_version`, since `server_version_num` itself is not
	 * reported at startup; undefined when it can't be parsed.
	 */
	readonly serverVersionNum: number | undefined;
	/** Cancel keys longer than 4 bytes (protocol 3.2). */
	readonly longCancelKeys: boolean;
	/** `in_hot_standby` is reported, so the server's role is known without a query (PostgreSQL 14+). */
	readonly reportsHotStandby: boolean;
	/** `pg_prepared_statements.result_types` (PostgreSQL 16+). */
	readonly preparedStatementResultTypes: boolean;
	/** Direct TLS negotiation, `sslnegotiation=direct` (PostgreSQL 17+). */
	readonly directTls: boolean;
	/** The `transaction_timeout` setting (PostgreSQL 17+). */
	readonly transactionTimeout: boolean;
	/** `RETURNING` in `MERGE` (PostgreSQL 17+). */
	readonly mergeReturning: boolean;
	/** `RETURNING old.*, new.*` (PostgreSQL 18+). */
	readonly returningOldNew: boolean;
	/** SASL mechanisms the server offered during authentication, e.g. `OAUTHBEARER` (PostgreSQL 18+). */
	readonly saslMechanisms: readonly string[];
}

/**
 * Parses `server_version` (`18.6`, `16.4 (Debian …)`, `19devel`, `9.6.24`)
 * into the `server_version_num` form: `180006`, `160004`, `190000`, `90624`.
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

export function detectCapabilities(
	protocolMinor: number,
	parameters: ReadonlyMap<string, string>,
	saslMechanisms: readonly string[],
): Capabilities {
	const serverVersion = parameters.get('server_version');
	const num = parseServerVersion(serverVersion);
	const atLeast = (major: number) => num !== undefined && num >= major * 10000;
	return {
		protocol: `3.${protocolMinor}`,
		protocolMinor,
		serverVersion,
		serverVersionNum: num,
		longCancelKeys: protocolMinor >= 2,
		reportsHotStandby: parameters.has('in_hot_standby'),
		preparedStatementResultTypes: atLeast(16),
		directTls: atLeast(17),
		transactionTimeout: atLeast(17),
		mergeReturning: atLeast(17),
		returningOldNew: atLeast(18),
		saslMechanisms,
	};
}
