import { DriverError } from './errors.js';
import { LATEST_PROTOCOL_MINOR } from './protocol/frontend.js';
import type { Notice, Notification } from './notice.js';
import type { SocketFactory } from './socket.js';
import type { TelemetryOptions } from './telemetry.js';
import type { TypeParsers } from './types.js';

/** How hard to insist on TLS, with libpq's meanings. */
export type SslMode =
	/** Never use TLS. */
	| 'disable'
	/** Try without TLS; retry with TLS if the server refuses. */
	| 'allow'
	/** Try TLS; continue without it if the server doesn't support it. The default for localhost and Unix sockets. */
	| 'prefer'
	/** Require TLS, without verifying the certificate. */
	| 'require'
	/** Require TLS and a certificate signed by a trusted CA. */
	| 'verify-ca'
	/** Require TLS, a trusted certificate, and a matching host name. The default for remote hosts. */
	| 'verify-full';

export interface SslOptions {
	readonly mode?: SslMode | undefined;
	/** Trusted CA certificates (PEM). Without them, verify modes use the platform's CA store. */
	readonly ca?: string | readonly string[] | undefined;
	/** A file of trusted CA certificates, or `system` for the platform's store (implies `verify-full`). */
	readonly rootCertFile?: string | undefined;
	/**
	 * Client certificate and key (PEM), or files holding them, for `cert`
	 * authentication (mutual TLS). Without either, `~/.postgresql/postgresql.crt`
	 * and `postgresql.key` are used when they exist, as libpq does.
	 */
	readonly cert?: string | undefined;
	readonly key?: string | undefined;
	readonly certFile?: string | undefined;
	readonly keyFile?: string | undefined;
	/** The passphrase of an encrypted client key (libpq's `sslpassword`). */
	readonly passphrase?: string | undefined;
	/**
	 * `postgres` (default) sends an SSLRequest first; `direct` starts the
	 * TLS handshake immediately (PostgreSQL 17+), saving a round trip.
	 */
	readonly negotiation?: 'postgres' | 'direct' | undefined;
}

/** A protocol version of major version 3, e.g. `3.2`. */
export type ProtocolVersion = `3.${number}`;

/** Authentication methods, as named by libpq's `require_auth`. */
export type AuthMethod =
	| 'password'
	| 'md5'
	| 'scram-sha-256'
	| 'gss'
	| 'sspi'
	| 'none';

const AUTH_METHODS: readonly AuthMethod[] = [
	'password',
	'md5',
	'scram-sha-256',
	'gss',
	'sspi',
	'none',
];

/** Which server to accept when several hosts are listed, as libpq's `target_session_attrs`. */
export type TargetSessionAttrs =
	| 'any'
	| 'read-write'
	| 'read-only'
	| 'primary'
	| 'standby'
	| 'prefer-standby';

export type PasswordSource = string | (() => string | Promise<string>);

export interface ConnectionOptions {
	/** A `postgres://` URL or a `key=value` string. Explicit options override it. */
	readonly connectionString?: string | undefined;
	/** Host name, IP address, or Unix-socket directory (starting with `/`). Comma-separated for failover. */
	readonly host?: string | undefined;
	readonly port?: number | string | undefined;
	readonly user?: string | undefined;
	/** A password, or a function returning one (e.g. a short-lived IAM token). */
	readonly password?: PasswordSource | undefined;
	readonly database?: string | undefined;
	readonly applicationName?: string | undefined;
	readonly ssl?: SslMode | SslOptions | undefined;
	/** SCRAM channel binding: `prefer` (default) uses it when TLS allows; `require` refuses to authenticate without it. */
	readonly channelBinding?: 'disable' | 'prefer' | 'require' | undefined;
	/** Time allowed to connect and authenticate, in milliseconds (0 for none). Default 30s. */
	readonly connectTimeout?: number | undefined;
	readonly keepAlive?: boolean | undefined;
	readonly keepAliveInitialDelay?: number | undefined;
	/**
	 * The protocol version to speak. `auto` (default) asks for the newest
	 * version the driver knows (3.2) and accepts whatever the server or
	 * pooler negotiates down to; `3.x` insists on exactly that version.
	 */
	readonly protocol?: 'auto' | ProtocolVersion | undefined;
	/** The oldest protocol version to accept (default `3.0`), as libpq's `min_protocol_version`. */
	readonly minProtocolVersion?: ProtocolVersion | 'latest' | undefined;
	/** The newest protocol version to ask for (default `latest`), as libpq's `max_protocol_version`. */
	readonly maxProtocolVersion?: ProtocolVersion | 'latest' | undefined;
	/**
	 * The authentication methods to accept, as libpq's `require_auth`: e.g.
	 * `'scram-sha-256'`, `['scram-sha-256', 'none']`, or negated with `!`
	 * (`'!password,!md5'`). Methods: `password`, `md5`, `scram-sha-256`,
	 * `gss`, `sspi`, `none`. A server asking for anything else is refused,
	 * so it can't downgrade the client to a weaker method. `oauth` is
	 * rejected: the driver does not support OAuth (`OAUTHBEARER`).
	 */
	readonly requireAuth?: string | readonly string[] | undefined;
	/** Extra startup parameters (run-time settings), e.g. `{ search_path: 'app' }`. */
	readonly params?: Readonly<Record<string, string>> | undefined;
	/** Command-line options sent to the server, as `PGOPTIONS` (e.g. `-c statement_timeout=5s`). */
	readonly options?: string | undefined;
	readonly targetSessionAttrs?: TargetSessionAttrs | undefined;
	/** A password file in `.pgpass` format; defaults to `PGPASSFILE` or `~/.pgpass`. */
	readonly passfile?: string | undefined;
	/** How result values are decoded: `defaultTypes` (default), `rawTypes`, or your own. */
	readonly types?: TypeParsers | undefined;
	/** Use named prepared statements, cached per connection (default true). */
	readonly prepare?: boolean | undefined;
	/** The most prepared statements kept per connection (default 100). */
	readonly statementCacheSize?: number | undefined;
	/**
	 * Receive columns in binary where the configured parser has a binary
	 * twin (int2/int4/oid, float8, bool, bytea, timestamptz as Date),
	 * from a cached statement's second run (default true). Values are
	 * identical either way; custom and raw types always stay text.
	 */
	readonly binaryResults?: boolean | undefined;
	/**
	 * Reports every query as an OpenTelemetry client span: pass a tracer
	 * (`trace.getTracer('app')`). SQL text is recorded unless
	 * `queryText: false`; parameters never are.
	 */
	readonly telemetry?: TelemetryOptions | undefined;
	/**
	 * Append the stack of the code that issued a query to its error (a few
	 * hundred nanoseconds per query; default false — the quarry adapter does
	 * its own).
	 */
	readonly captureStack?: boolean | undefined;
	/** How sockets are opened; defaults to Node's `net`/`tls`. */
	readonly socket?: SocketFactory | undefined;
	readonly onNotice?: (notice: Notice) => void | undefined;
	readonly onNotification?: (notification: Notification) => void | undefined;
	/** The largest message accepted from the server, in bytes. */
	readonly maxMessageSize?: number | undefined;
	/** Environment variables to read `PG*` settings from; defaults to `process.env` where it exists. */
	readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

export interface HostTarget {
	readonly host: string;
	readonly port: number;
}

/** Options with every default and environment variable applied. */
export interface ResolvedConfig {
	readonly hosts: readonly HostTarget[];
	readonly user: string;
	readonly database: string;
	readonly password: PasswordSource | undefined;
	readonly passfile: string | undefined;
	readonly applicationName: string | undefined;
	readonly ssl: {
		readonly mode: SslMode;
		readonly negotiation: 'postgres' | 'direct';
		readonly ca: string | readonly string[] | undefined;
		readonly rootCertFile: string | undefined;
		readonly cert: string | undefined;
		readonly key: string | undefined;
		readonly certFile: string | undefined;
		readonly keyFile: string | undefined;
		readonly passphrase: string | undefined;
	};
	readonly channelBinding: 'disable' | 'prefer' | 'require';
	readonly connectTimeout: number;
	readonly keepAlive: boolean;
	readonly keepAliveInitialDelay: number;
	/** The protocol minor versions to accept: ask for `max`, accept down to `min`. */
	readonly protocol: { readonly min: number; readonly max: number };
	/** The authentication methods allowed, or undefined for any. */
	readonly requireAuth: ReadonlySet<AuthMethod> | undefined;
	readonly params: Readonly<Record<string, string>>;
	readonly targetSessionAttrs: TargetSessionAttrs;
	readonly types: TypeParsers | undefined;
	readonly prepare: boolean;
	readonly statementCacheSize: number;
	readonly binaryResults: boolean;
	readonly telemetry: TelemetryOptions | undefined;
	readonly captureStack: boolean;
	readonly socket: SocketFactory | undefined;
	readonly onNotice: ((notice: Notice) => void) | undefined;
	readonly onNotification: ((notification: Notification) => void) | undefined;
	readonly maxMessageSize: number | undefined;
}

const SSL_MODES = [
	'disable',
	'allow',
	'prefer',
	'require',
	'verify-ca',
	'verify-full',
] as const;
const TARGETS = [
	'any',
	'read-write',
	'read-only',
	'primary',
	'standby',
	'prefer-standby',
] as const;

/**
 * Parses a connection string into libpq keywords: either a URL
 * (`postgres://user:pw@host:5432,host2/db?sslmode=require`) or `key=value`
 * pairs (`host=localhost dbname='my db'`).
 */
export function parseConnectionString(text: string): Record<string, string> {
	const trimmed = text.trim();
	return /^postgres(ql)?:\/\//i.test(trimmed)
		? parseUrl(trimmed)
		: parseKeywords(trimmed);
}

function decode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		throw new DriverError(
			// never echo the value: it may be the password
			'Invalid percent-encoding in the connection string',
		);
	}
}

function parseUrl(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	const rest = text.slice(text.indexOf('://') + 3);
	const queryAt = rest.indexOf('?');
	const beforeQuery = queryAt < 0 ? rest : rest.slice(0, queryAt);
	const query = queryAt < 0 ? '' : rest.slice(queryAt + 1);
	const slash = beforeQuery.indexOf('/');
	const authority = slash < 0 ? beforeQuery : beforeQuery.slice(0, slash);
	const path = slash < 0 ? '' : beforeQuery.slice(slash + 1);
	const at = authority.lastIndexOf('@');
	if (at >= 0) {
		const userinfo = authority.slice(0, at);
		const colon = userinfo.indexOf(':');
		const user = colon < 0 ? userinfo : userinfo.slice(0, colon);
		if (user) out['user'] = decode(user);
		if (colon >= 0) out['password'] = decode(userinfo.slice(colon + 1));
	}
	const hostList = at >= 0 ? authority.slice(at + 1) : authority;
	if (hostList) {
		const hosts: string[] = [];
		const ports: string[] = [];
		for (const entry of hostList.split(',')) {
			const match = entry.match(/^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/);
			if (!match)
				throw new DriverError(`Invalid host in connection string: ${entry}`);
			const host = match[1] ?? '';
			hosts.push(decode(host.startsWith('[') ? host.slice(1, -1) : host));
			ports.push(match[2] ?? '');
		}
		if (hosts.some((h) => h !== '')) out['host'] = hosts.join(',');
		if (ports.some((p) => p !== '')) out['port'] = ports.join(',');
	}
	if (path) out['dbname'] = decode(path);
	for (const pair of query.split('&')) {
		if (!pair) continue;
		const eq = pair.indexOf('=');
		const key = decode(eq < 0 ? pair : pair.slice(0, eq));
		out[key === 'ssl' ? 'ssl' : key] = decode(
			eq < 0 ? '' : pair.slice(eq + 1).replaceAll('+', ' '),
		);
	}
	if (out['ssl'] !== undefined) {
		// `?ssl=true` as accepted by node-postgres
		if (out['sslmode'] === undefined && /^(true|1)$/.test(out['ssl']))
			out['sslmode'] = 'require';
		delete out['ssl'];
	}
	return out;
}

function parseKeywords(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	let i = 0;
	const skipSpace = () => {
		while (i < text.length && /\s/.test(text[i] ?? '')) i++;
	};
	while (true) {
		skipSpace();
		if (i >= text.length) break;
		const keyStart = i;
		while (i < text.length && text[i] !== '=' && !/\s/.test(text[i] ?? '')) i++;
		const key = text.slice(keyStart, i);
		skipSpace();
		if (text[i] !== '=')
			throw new DriverError(`Missing "=" after "${key}" in connection string`);
		i++;
		skipSpace();
		let value = '';
		if (text[i] === "'") {
			i++;
			while (i < text.length && text[i] !== "'") {
				if (text[i] === '\\') i++;
				value += text[i] ?? '';
				i++;
			}
			if (text[i] !== "'")
				throw new DriverError('Unterminated quoted value in connection string');
			i++;
		} else {
			while (i < text.length && !/\s/.test(text[i] ?? '')) {
				if (text[i] === '\\') i++;
				value += text[i] ?? '';
				i++;
			}
		}
		out[key] = value;
	}
	return out;
}

const KNOWN_KEYWORDS = new Set([
	'host',
	'hostaddr',
	'port',
	'dbname',
	'user',
	'password',
	'passfile',
	'channel_binding',
	'connect_timeout',
	'options',
	'application_name',
	'fallback_application_name',
	'keepalives',
	'keepalives_idle',
	'sslmode',
	'sslnegotiation',
	'sslcert',
	'sslkey',
	'sslrootcert',
	'target_session_attrs',
	'max_protocol_version',
	'min_protocol_version',
	'require_auth',
	'sslpassword',
	'client_encoding',
]);

const ENV_KEYWORDS: Readonly<Record<string, string>> = {
	PGHOST: 'host',
	PGHOSTADDR: 'hostaddr',
	PGPORT: 'port',
	PGDATABASE: 'dbname',
	PGUSER: 'user',
	PGPASSWORD: 'password',
	PGPASSFILE: 'passfile',
	PGCHANNELBINDING: 'channel_binding',
	PGOPTIONS: 'options',
	PGAPPNAME: 'application_name',
	PGSSLMODE: 'sslmode',
	PGSSLNEGOTIATION: 'sslnegotiation',
	PGSSLCERT: 'sslcert',
	PGSSLKEY: 'sslkey',
	PGSSLROOTCERT: 'sslrootcert',
	PGCONNECT_TIMEOUT: 'connect_timeout',
	PGTARGETSESSIONATTRS: 'target_session_attrs',
	PGMAXPROTOCOLVERSION: 'max_protocol_version',
	PGMINPROTOCOLVERSION: 'min_protocol_version',
	PGREQUIREAUTH: 'require_auth',
};

function processEnv(): Readonly<Record<string, string | undefined>> {
	const proc = Reflect.get(globalThis, 'process');
	const env: unknown = proc ? Reflect.get(proc, 'env') : undefined;
	if (typeof env !== 'object' || env === null) return {};
	const out: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === 'string') out[key] = value;
	}
	return out;
}

function oneOf<const A extends readonly string[]>(
	value: string,
	allowed: A,
	what: string,
): A[number] {
	const found = allowed.find((option) => option === value);
	if (found === undefined) {
		throw new DriverError(
			`Invalid ${what} "${value}"; expected one of ${allowed.join(', ')}`,
		);
	}
	return found;
}

function toMs(seconds: string): number {
	const n = Number(seconds);
	if (!Number.isFinite(n) || n < 0)
		throw new DriverError(`Invalid connect_timeout "${seconds}"`);
	// libpq treats values below 2 seconds as 2
	return n === 0 ? 0 : Math.max(2, n) * 1000;
}

function protocolMinor(version: string, what: string): number {
	if (version === 'latest') return LATEST_PROTOCOL_MINOR;
	const match = /^3\.(\d+)$/.exec(version);
	const minor = match ? Number(match[1]) : Number.NaN;
	if (!(minor >= 0 && minor <= LATEST_PROTOCOL_MINOR) || minor === 1) {
		throw new DriverError(
			`Unsupported ${what} "${version}"; this driver speaks 3.0 to 3.${LATEST_PROTOCOL_MINOR} (3.1 was never used)`,
		);
	}
	return minor;
}

function protocolRange(
	options: ConnectionOptions,
	kw: (key: string) => string | undefined,
): { min: number; max: number } {
	if (options.protocol !== undefined && options.protocol !== 'auto') {
		const exact = protocolMinor(options.protocol, 'protocol');
		return { min: exact, max: exact };
	}
	const min = protocolMinor(
		options.minProtocolVersion ?? kw('min_protocol_version') ?? '3.0',
		'min_protocol_version',
	);
	const max = protocolMinor(
		options.maxProtocolVersion ?? kw('max_protocol_version') ?? 'latest',
		'max_protocol_version',
	);
	if (min > max)
		throw new DriverError(
			`min_protocol_version 3.${min} is above max_protocol_version 3.${max}`,
		);
	return { min, max };
}

/** Parses `require_auth`: a list of methods, or of negated methods (`!md5`), never mixed. */
export function parseRequireAuth(
	value: string | readonly string[] | undefined,
): ReadonlySet<AuthMethod> | undefined {
	if (value === undefined) return undefined;
	const entries = (typeof value === 'string' ? value.split(',') : value)
		.map((e) => e.trim())
		.filter((e) => e !== '');
	if (entries.length === 0) return undefined;
	const negated = entries.map((e) => e.startsWith('!'));
	if (negated.some((n) => n !== negated[0])) {
		throw new DriverError(
			'require_auth cannot mix negated (!method) and plain methods',
		);
	}
	if (entries.includes('oauth')) {
		throw new DriverError(
			'require_auth method "oauth" is not supported: this driver does not implement OAuth (OAUTHBEARER) authentication',
		);
	}
	// `!oauth` excludes a method the driver never uses anyway, so it is accepted
	const methods = entries
		.filter((e) => e !== '!oauth')
		.map((e) =>
			oneOf(e.replace(/^!/, ''), AUTH_METHODS, 'require_auth method'),
		);
	return new Set(
		negated[0] ? AUTH_METHODS.filter((m) => !methods.includes(m)) : methods,
	);
}

/** Unix sockets and loopback addresses, where `prefer` stays the default sslmode. */
function isLocalHost(host: string): boolean {
	return (
		host.startsWith('/') ||
		host === 'localhost' ||
		host === '::1' ||
		/^127\.\d+\.\d+\.\d+$/.test(host)
	);
}

/** Applies the connection string, `PG*` environment variables and defaults to `options`. */
export function resolveConfig(options: ConnectionOptions = {}): ResolvedConfig {
	const env = options.env ?? processEnv();
	const fromEnv: Record<string, string> = {};
	for (const [name, keyword] of Object.entries(ENV_KEYWORDS)) {
		const value = env[name];
		if (value !== undefined && value !== '') fromEnv[keyword] = value;
	}
	const fromString = options.connectionString
		? parseConnectionString(options.connectionString)
		: {};
	const kw = (key: string): string | undefined =>
		fromString[key] ?? fromEnv[key];

	const hostText = options.host ?? kw('host') ?? kw('hostaddr') ?? 'localhost';
	const hostNames = hostText.split(',').map((h) => h.trim() || 'localhost');

	const sslOptions: SslOptions =
		typeof options.ssl === 'string'
			? { mode: options.ssl }
			: (options.ssl ?? {});
	const rootCertFile = sslOptions.rootCertFile ?? kw('sslrootcert');
	const defaultMode = hostNames.every(isLocalHost) ? 'prefer' : 'verify-full';
	let mode = oneOf(
		sslOptions.mode ?? kw('sslmode') ?? defaultMode,
		SSL_MODES,
		'sslmode',
	);
	if (
		rootCertFile === 'system' &&
		sslOptions.mode === undefined &&
		kw('sslmode') === undefined
	)
		mode = 'verify-full';
	if (rootCertFile === 'system' && mode !== 'verify-full') {
		throw new DriverError('sslrootcert=system requires sslmode=verify-full');
	}
	const negotiation = oneOf(
		sslOptions.negotiation ?? kw('sslnegotiation') ?? 'postgres',
		['postgres', 'direct'],
		'sslnegotiation',
	);
	if (
		negotiation === 'direct' &&
		!['require', 'verify-ca', 'verify-full'].includes(mode)
	) {
		throw new DriverError(
			'sslnegotiation=direct requires sslmode require, verify-ca or verify-full',
		);
	}

	const portText =
		options.port === undefined ? (kw('port') ?? '5432') : String(options.port);
	const ports = portText.split(',').map((p) => p.trim());
	if (ports.length !== 1 && ports.length !== hostNames.length) {
		throw new DriverError(
			`${ports.length} ports given for ${hostNames.length} hosts`,
		);
	}
	const hosts = hostNames.map((host, i) => {
		const port = Number(ports.length === 1 ? ports[0] : ports[i]) || 5432;
		if (!Number.isInteger(port) || port < 1 || port > 65535)
			throw new DriverError(`Invalid port ${port}`);
		return { host, port };
	});

	const user =
		options.user ?? kw('user') ?? env['USER'] ?? env['USERNAME'] ?? 'postgres';
	const params: Record<string, string> = {};
	for (const [key, value] of Object.entries(fromString)) {
		if (!KNOWN_KEYWORDS.has(key)) params[key] = value;
	}
	const pgOptions = options.options ?? kw('options');
	if (pgOptions) params['options'] = pgOptions;
	Object.assign(params, options.params);

	const protocol = protocolRange(options, kw);

	const timeout =
		options.connectTimeout ??
		(kw('connect_timeout') === undefined
			? 30_000
			: toMs(kw('connect_timeout') ?? '0'));
	const keepalives = kw('keepalives');
	const keepalivesIdle = kw('keepalives_idle');

	return {
		hosts,
		user,
		database: options.database ?? kw('dbname') ?? user,
		password: options.password ?? kw('password'),
		passfile: options.passfile ?? kw('passfile'),
		applicationName:
			options.applicationName ??
			kw('application_name') ??
			kw('fallback_application_name'),
		ssl: {
			mode,
			negotiation,
			ca: sslOptions.ca,
			rootCertFile: rootCertFile === 'system' ? undefined : rootCertFile,
			cert: sslOptions.cert,
			key: sslOptions.key,
			certFile: sslOptions.certFile ?? kw('sslcert'),
			keyFile: sslOptions.keyFile ?? kw('sslkey'),
			passphrase: sslOptions.passphrase ?? kw('sslpassword'),
		},
		channelBinding: oneOf(
			options.channelBinding ?? kw('channel_binding') ?? 'prefer',
			['disable', 'prefer', 'require'],
			'channel_binding',
		),
		connectTimeout: timeout,
		keepAlive: options.keepAlive ?? keepalives !== '0',
		keepAliveInitialDelay:
			options.keepAliveInitialDelay ??
			(keepalivesIdle ? Number(keepalivesIdle) * 1000 : 0),
		protocol,
		requireAuth: parseRequireAuth(options.requireAuth ?? kw('require_auth')),
		params,
		targetSessionAttrs: oneOf(
			options.targetSessionAttrs ?? kw('target_session_attrs') ?? 'any',
			TARGETS,
			'target_session_attrs',
		),
		types: options.types,
		prepare: options.prepare ?? true,
		statementCacheSize: options.statementCacheSize ?? 100,
		binaryResults: options.binaryResults ?? true,
		telemetry: options.telemetry,
		captureStack: options.captureStack ?? false,
		socket: options.socket,
		onNotice: options.onNotice,
		onNotification: options.onNotification,
		maxMessageSize: options.maxMessageSize,
	};
}

const matches = (pattern: string | undefined, value: string) =>
	pattern === '*' || pattern === value;

/**
 * Finds a password in `.pgpass` text for the given connection. Lines are
 * `host:port:database:user:password`, `*` matches anything, and `\` escapes
 * `:` and `\`. A Unix-socket connection matches host `localhost`.
 */
export function findPgpassPassword(
	text: string,
	target: { host: string; port: number; database: string; user: string },
): string | undefined {
	const host = target.host.startsWith('/') ? 'localhost' : target.host;
	for (const line of text.split(/\r?\n/)) {
		if (line === '' || line.startsWith('#')) continue;
		const fields: string[] = [];
		let current = '';
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (ch === '\\' && i + 1 < line.length) current += line[++i];
			else if (ch === ':' && fields.length < 4) {
				fields.push(current);
				current = '';
			} else current += ch;
		}
		fields.push(current);
		if (fields.length !== 5) continue;
		const [h, p, d, u, password] = fields;
		if (
			matches(h, host) &&
			matches(p, String(target.port)) &&
			matches(d, target.database) &&
			matches(u, target.user)
		) {
			return password;
		}
	}
	return undefined;
}
