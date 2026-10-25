/* oxlint-disable no-await-in-loop -- hosts, TLS fallbacks and protocol versions are tried one after another */
import {
	resolveConfig,
	type ConnectionOptions,
	type HostTarget,
	type ResolvedConfig,
	type TargetSessionAttrs,
} from './config.js';
import { Connection } from './connection.js';
import { ConnectionError, PostgresError } from './errors.js';
import { nodeSockets, preloadNodeSockets } from './node-socket.js';
import * as fe from './protocol/frontend.js';
import type {
	DriverSocket,
	SocketTarget,
	TlsConnectOptions,
} from './socket.js';

/**
 * Opens a connection. Options can be a connection string (`postgres://…`
 * or `key=value`); `PG*` environment variables fill in what is missing.
 *
 * @example
 * await using conn = await connect('postgres://app@db.internal/app');
 * const { rows } = await conn.query('select * from users where id = $1', [id]);
 */
export async function connect(
	options?: ConnectionOptions | string,
	{ signal }: { signal?: AbortSignal } = {},
): Promise<Connection> {
	return openConnection(
		resolveConfig(
			typeof options === 'string' ? { connectionString: options } : options,
		),
		signal,
	);
}

/** Loads the socket modules a configuration's connections will need, ahead of its first connect. */
export function preloadSockets(config: ResolvedConfig): void {
	if (config.socket !== undefined) return;
	preloadNodeSockets(
		config.ssl.mode !== 'disable' &&
			config.hosts.some((host) => !host.host.startsWith('/')),
	);
}

/** Opens a connection from a resolved configuration, trying each host in turn. */
export async function openConnection(
	config: ResolvedConfig,
	signal?: AbortSignal,
): Promise<Connection> {
	const errors: Error[] = [];
	const passes: TargetSessionAttrs[] =
		config.targetSessionAttrs === 'prefer-standby'
			? ['standby', 'any']
			: [config.targetSessionAttrs];
	for (const pass of passes) {
		for (const host of config.hosts) {
			signal?.throwIfAborted();
			let connection: Connection;
			try {
				connection = await connectHost(config, host, signal);
			} catch (error) {
				errors.push(
					error instanceof Error ? error : new ConnectionError(String(error)),
				);
				continue;
			}
			if (pass === 'any' || (await matchesTarget(connection, pass)))
				return connection;
			await connection.close().catch(() => {});
			errors.push(
				new ConnectionError(`${describeHost(host)} is not a ${pass} server`),
			);
		}
	}
	if (errors.length === 1 && errors[0] !== undefined) throw errors[0];
	throw new ConnectionError(
		`Could not connect to any host: ${errors.map((e) => e.message).join('; ')}`,
		{ cause: new AggregateError(errors) },
	);
}

function describeHost(host: HostTarget): string {
	return host.host.startsWith('/')
		? `${host.host}/.s.PGSQL.${host.port}`
		: `${host.host}:${host.port}`;
}

/** Reads the server's role from reported parameters, querying older servers that don't report them. */
async function matchesTarget(
	connection: Connection,
	target: TargetSessionAttrs,
): Promise<boolean> {
	let standby = connection.parameters.get('in_hot_standby');
	let readOnly = connection.parameters.get('default_transaction_read_only');
	if (standby === undefined || readOnly === undefined) {
		const { rows } = await connection.query<{
			standby: boolean;
			read_only: string;
		}>(
			"select pg_is_in_recovery() as standby, current_setting('transaction_read_only') as read_only",
		);
		standby = rows[0]?.standby ? 'on' : 'off';
		readOnly = rows[0]?.read_only ?? 'off';
	}
	const isStandby = standby === 'on';
	const isReadOnly = isStandby || readOnly === 'on';
	switch (target) {
		case 'read-write':
			return !isReadOnly;
		case 'read-only':
			return isReadOnly;
		case 'primary':
			return !isStandby;
		case 'standby':
			return isStandby;
		default:
			return true;
	}
}

type TlsPlan = 'plain' | 'tls' | 'tls-optional' | 'direct';

function socketTarget(host: HostTarget): SocketTarget {
	return host.host.startsWith('/')
		? { kind: 'unix', path: `${host.host}/.s.PGSQL.${host.port}` }
		: { kind: 'tcp', host: host.host, port: host.port };
}

const isIp = (host: string) =>
	/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':');

async function readText(path: string): Promise<string> {
	const { readFile } = await import('node:fs/promises');
	return readFile(path, 'utf8');
}

/** Reads `~/.postgresql/<name>` when it exists, as libpq's default certificate locations. */
async function readDefault(name: string): Promise<string | undefined> {
	try {
		const [{ readFile }, { homedir }, { join }] = await Promise.all([
			import('node:fs/promises'),
			import('node:os'),
			import('node:path'),
		]);
		return await readFile(join(homedir(), '.postgresql', name), 'utf8');
	} catch {
		return undefined;
	}
}

async function tlsOptions(
	config: ResolvedConfig,
	host: HostTarget,
	direct: boolean,
): Promise<TlsConnectOptions> {
	const { ssl } = config;
	const verifyChain = ssl.mode === 'verify-ca' || ssl.mode === 'verify-full';
	let ca =
		ssl.ca ??
		(ssl.rootCertFile === undefined
			? undefined
			: await readText(ssl.rootCertFile));
	if (ca === undefined && verifyChain) ca = await readDefault('root.crt');
	let cert =
		ssl.cert ??
		(ssl.certFile === undefined ? undefined : await readText(ssl.certFile));
	let key =
		ssl.key ??
		(ssl.keyFile === undefined ? undefined : await readText(ssl.keyFile));
	if (cert === undefined && key === undefined) {
		const [defaultCert, defaultKey] = await Promise.all([
			readDefault('postgresql.crt'),
			readDefault('postgresql.key'),
		]);
		if (defaultCert !== undefined && defaultKey !== undefined) {
			cert = defaultCert;
			key = defaultKey;
		}
	}
	if ((cert === undefined) !== (key === undefined)) {
		throw new ConnectionError(
			'A client certificate needs both sslcert and sslkey',
		);
	}
	return {
		servername: isIp(host.host) ? undefined : host.host,
		ca,
		cert,
		key,
		passphrase: ssl.passphrase,
		verifyChain,
		verifyHostname: ssl.mode === 'verify-full',
		host: host.host,
		alpn: direct ? ['postgresql'] : undefined,
	};
}

/** Sends an SSLRequest and reads the one-byte answer: `S` to start TLS, `N` to continue without. */
function requestSsl(socket: DriverSocket): Promise<'S' | 'N'> {
	return new Promise((resolve, reject) => {
		socket.onData((chunk) => {
			socket.onData(() => {});
			const answer = String.fromCharCode(chunk[0] ?? 0);
			if (chunk.length > 1) {
				// bytes after the answer could only come from someone in the middle
				reject(
					new ConnectionError('Unexpected data after the SSLRequest answer'),
				);
			} else if (answer === 'S' || answer === 'N') {
				resolve(answer);
			} else {
				reject(
					new ConnectionError(
						`Unexpected SSLRequest answer ${JSON.stringify(answer)}`,
					),
				);
			}
		});
		socket.onClose(() =>
			reject(
				new ConnectionError(
					'The server closed the connection during the SSLRequest',
				),
			),
		);
		socket.onError(reject);
		socket.write(fe.sslRequest());
	});
}

interface Attempt {
	socket: DriverSocket | undefined;
}

async function attempt(
	config: ResolvedConfig,
	host: HostTarget,
	plan: TlsPlan,
	version: number,
	state: Attempt,
): Promise<Connection> {
	const factory = config.socket ?? nodeSockets;
	const target = socketTarget(host);
	// certificate files are read while the TCP connection and SSLRequest are under way
	const tls =
		plan === 'plain' ? undefined : tlsOptions(config, host, plan === 'direct');
	tls?.catch(() => {});
	const connecting = factory.connect({
		target,
		tls: plan === 'direct' ? await tls : undefined,
		keepAlive: config.keepAlive,
		keepAliveInitialDelay: config.keepAliveInitialDelay,
	});
	// node:tls loads (~3 ms on a cold start) while the TCP handshake is in flight
	if (tls !== undefined && plan !== 'direct' && factory === nodeSockets) {
		preloadNodeSockets(true);
	}
	const socket = await connecting;
	state.socket = socket;
	try {
		if ((plan === 'tls' || plan === 'tls-optional') && tls !== undefined) {
			const [answer, options] = await Promise.all([requestSsl(socket), tls]);
			if (answer === 'S') await socket.startTls(options);
			else if (plan === 'tls') {
				throw new ConnectionError(
					`The server does not support TLS, but sslmode=${config.ssl.mode} requires it`,
				);
			}
		}
		const cancelPlan: TlsPlan = socket.encrypted
			? plan === 'direct'
				? 'direct'
				: 'tls'
			: 'plain';
		return await Connection.open(socket, config, {
			host,
			version,
			cancel: (pid, key) => sendCancel(config, host, cancelPlan, pid, key),
		});
	} catch (error) {
		socket.destroy();
		throw error;
	}
}

/** Whether a startup error means the server or pooler rejected the requested protocol version. */
function rejectsProtocol32(error: unknown): boolean {
	if (error instanceof PostgresError) {
		return (
			/protocol/i.test(error.message) &&
			['08P01', '0A000', 'XX000', '08004'].includes(error.code)
		);
	}
	return error instanceof ConnectionError && /protocol/i.test(error.message);
}

async function connectHost(
	config: ResolvedConfig,
	host: HostTarget,
	signal?: AbortSignal,
): Promise<Connection> {
	const unix = host.host.startsWith('/');
	const mode = config.ssl.mode;
	const plans: TlsPlan[] =
		mode === 'disable' || (unix && (mode === 'prefer' || mode === 'allow'))
			? ['plain']
			: mode === 'allow'
				? ['plain', 'tls']
				: mode === 'prefer'
					? ['tls-optional', 'plain']
					: [config.ssl.negotiation === 'direct' ? 'direct' : 'tls'];
	// ask for the newest version; retry with the oldest accepted one when a
	// pooler rejects the request outright instead of negotiating
	const versions = [
		config.protocol.max,
		...(config.protocol.min < config.protocol.max ? [config.protocol.min] : []),
	].map(fe.protocolVersion);

	const state: Attempt = { socket: undefined };
	const run = async (): Promise<Connection> => {
		let lastError: unknown;
		for (let p = 0; p < plans.length; p++) {
			const plan = plans[p] ?? 'plain';
			for (let v = 0; v < versions.length; v++) {
				try {
					return await attempt(
						config,
						host,
						plan,
						versions[v] ?? fe.PROTOCOL_3_0,
						state,
					);
				} catch (error) {
					lastError = error;
					if (v + 1 < versions.length && rejectsProtocol32(error)) continue;
					break;
				}
			}
			const retryPlain =
				plan === 'tls-optional' &&
				lastError instanceof ConnectionError &&
				!(lastError instanceof PostgresError);
			const retryTls =
				plan === 'plain' &&
				mode === 'allow' &&
				lastError instanceof PostgresError &&
				lastError.code.startsWith('28');
			if (!retryPlain && !retryTls) break;
		}
		throw lastError;
	};

	const timeout = config.connectTimeout;
	if (timeout <= 0 && signal === undefined) return run();
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			fn();
		};
		const abandon = (error: Error) =>
			finish(() => {
				state.socket?.destroy();
				reject(error);
			});
		const onAbort = () =>
			abandon(
				new ConnectionError('Connecting was aborted', {
					cause: signal?.reason,
				}),
			);
		const timer =
			timeout > 0
				? setTimeout(
						() =>
							abandon(
								new ConnectionError(
									`Timed out connecting to ${describeHost(host)} after ${timeout}ms`,
									{ code: 'ETIMEDOUT' },
								),
							),
						timeout,
					)
				: undefined;
		signal?.addEventListener('abort', onAbort, { once: true });
		run().then(
			(connection) => {
				if (settled) connection.destroy();
				else finish(() => resolve(connection));
				return undefined;
			},
			(error: unknown) => finish(() => reject(error)),
		);
	});
}

/** Sends a CancelRequest on a new connection, with the same TLS as the original. */
async function sendCancel(
	config: ResolvedConfig,
	host: HostTarget,
	plan: TlsPlan,
	pid: number,
	key: Uint8Array,
): Promise<void> {
	const factory = config.socket ?? nodeSockets;
	const tls =
		plan === 'plain'
			? undefined
			: await tlsOptions(config, host, plan === 'direct');
	const socket = await factory.connect({
		target: socketTarget(host),
		tls: plan === 'direct' ? tls : undefined,
		keepAlive: false,
		keepAliveInitialDelay: 0,
	});
	try {
		if (plan === 'tls' && tls !== undefined) {
			if ((await requestSsl(socket)) === 'S') await socket.startTls(tls);
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, 5000);
			socket.onClose(() => {
				clearTimeout(timer);
				resolve();
			});
			socket.onError(() => {});
			socket.onData(() => {});
			socket.write(fe.cancelRequest(pid, key));
		});
	} finally {
		socket.destroy();
	}
}
