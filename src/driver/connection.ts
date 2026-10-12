import { md5Password } from './auth/md5.js';
import {
	ScramClient,
	serverEndPoint,
	type ChannelBinding,
} from './auth/scram.js';
import {
	checkServerVersion,
	detectCapabilities,
	type Capabilities,
} from './capabilities.js';
import {
	findPgpassPassword,
	type AuthMethod,
	type HostTarget,
	type ResolvedConfig,
} from './config.js';
import {
	AbortError,
	ConnectionError,
	DriverError,
	PostgresError,
	ProtocolError,
	postgresError,
} from './errors.js';
import { toNotice, type Notice, type Notification } from './notice.js';
import {
	CopyFromOp,
	CopyToOp,
	CursorOp,
	DescribeOp,
	Op,
	QueryOp,
	SimpleQueryOp,
	closedError,
	type Description,
	type OpContext,
	type OpTiming,
	type QueryOpOptions,
	type QueryResult,
	type Statement,
} from './ops.js';
import * as fe from './protocol/frontend.js';
import type { BackendMessage } from './protocol/messages.js';
import { Reader } from './protocol/reader.js';
import { Writer } from './protocol/writer.js';
import { asResult, asRows, type RowMode } from './rows.js';
import type { DriverSocket } from './socket.js';
import { startQuerySpan } from './telemetry.js';
import { Transaction, type TransactionOptions } from './transaction.js';
import {
	copyChunks,
	defaultTypes,
	encodeParams,
	type TypeParsers,
} from './types.js';

export interface QueryOptions {
	/** `object` (default) rows keyed by column name, or positional `array` rows. */
	readonly rowMode?: RowMode;
	/** Parsers for this query, overriding the connection's. */
	readonly types?: TypeParsers;
	/** Use a cached named prepared statement (default: the connection's `prepare` option). */
	readonly prepare?: boolean;
	/** Parameter type OIDs; 0 or missing entries let the server infer. */
	readonly paramTypes?: readonly number[];
	/** Cancels the query when aborted. A query not yet sent is dropped without contacting the server. */
	readonly signal?: AbortSignal;
	/** Cancels the query after this many milliseconds, from the client. */
	readonly timeout?: number;
	/**
	 * A server-side `statement_timeout` for this query only (milliseconds,
	 * or a Postgres interval such as `'2s'`). Applied with
	 * `set_config(…, true)`: outside a transaction the query is wrapped in
	 * `begin … commit`; inside one, the previous value is restored after it.
	 */
	readonly statementTimeout?: number | string;
	/** Receives where the query spent its time once it settles. */
	readonly onTiming?: (timing: OpTiming) => void;
	/** A label for telemetry: the span name and `db.query.summary` (quarry's `tag()`). */
	readonly tag?: string;
	/**
	 * Ask for binary results for columns whose parser has a binary twin
	 * (default: the connection's `binaryResults`). Values decode the same;
	 * only cached statements, from their second run, use it.
	 */
	readonly binary?: boolean;
}

export interface CursorOptions extends QueryOptions {
	/** Rows fetched per round trip (default 1000). */
	readonly batchSize?: number;
}

/** What a connection needs to know about how it was opened. */
export interface OpenInfo {
	readonly host: HostTarget;
	readonly version: number;
	/** Sends a cancel request for this backend over a new connection. */
	readonly cancel: (pid: number, key: Uint8Array) => Promise<void>;
}

type Listener<T> = (value: T) => void;

/**
 * One session with the server. Queries can be issued concurrently: they
 * are pipelined, written together in one socket write per tick, and their
 * results come back in order. An error in one query does not affect the
 * others (each has its own Sync), except inside a transaction, where
 * Postgres aborts the transaction as usual.
 */
export class Connection implements AsyncDisposable {
	readonly #socket: DriverSocket;
	readonly #config: ResolvedConfig;
	readonly #info: OpenInfo;
	readonly #reader: Reader;
	readonly #writer = new Writer();
	readonly #types: TypeParsers;
	readonly #queue: Op[] = [];
	/** How many operations at the front of the queue have been written. */
	#written = 0;
	#flushScheduled = false;
	/** An exclusive operation that has been written: nothing more is written until it completes. */
	#blocking: Op | undefined;
	/** An operation this client asked the server to cancel: nothing more is written until it completes. */
	#canceling: Op | undefined;
	/** The operation the cancel request was sent for, once it is running. */
	#cancelSent: Op | undefined;
	readonly #statements = new Map<string, Statement>();
	#statementCount = 0;
	#status: 'I' | 'T' | 'E' = 'I';
	#closed = false;
	#ending = false;
	#fatal: PostgresError | undefined;
	#failure: Error | undefined;
	#starting = true;
	readonly #inbox: BackendMessage[] = [];
	#inboxWaiter: ((msg: BackendMessage) => void) | undefined;
	#startupError: ((error: Error) => void) | undefined;
	#pid = 0;
	#secretKey: Uint8Array = new Uint8Array(0);
	#protocolMinor: number;
	#unrecognizedOptions: readonly string[] = [];
	#saslMechanisms: readonly string[] = [];
	#capabilities: Capabilities | undefined;
	readonly #parameters = new Map<string, string>();
	readonly #noticeListeners = new Set<Listener<Notice>>();
	readonly #notificationListeners = new Set<Listener<Notification>>();
	readonly #channels = new Map<string, Set<Listener<Notification>>>();
	readonly #closeListeners = new Set<Listener<Error | undefined>>();
	readonly #drainWaiters: (() => void)[] = [];
	readonly #idleWaiters: (() => void)[] = [];
	readonly #closedPromise: Promise<void>;
	#resolveClosed: () => void = () => {};
	/** When the connection was opened (ms since epoch). */
	readonly createdAt = Date.now();
	readonly #ctx: OpContext;

	private constructor(
		socket: DriverSocket,
		config: ResolvedConfig,
		info: OpenInfo,
	) {
		this.#socket = socket;
		this.#config = config;
		this.#info = info;
		this.#reader = new Reader(config.maxMessageSize);
		this.#types = config.types ?? defaultTypes;
		this.#protocolMinor = info.version & 0xffff;
		this.#closedPromise = new Promise((resolve) => {
			this.#resolveClosed = resolve;
		});
		if (config.onNotice) this.#noticeListeners.add(config.onNotice);
		if (config.onNotification)
			this.#notificationListeners.add(config.onNotification);
		socket.onData((chunk) => this.#onData(chunk));
		socket.onClose(() => this.#onSocketClose());
		socket.onError((error) => this.#fail(error));
		socket.onDrain(() => {
			for (const resolve of this.#drainWaiters.splice(0)) resolve();
		});
		this.#ctx = {
			writer: this.#writer,
			types: this.#types,
			statement: (sql, types) => this.#statement(sql, types),
			forget: (statement) => {
				if (this.#statements.get(statement.key) === statement)
					this.#statements.delete(statement.key);
			},
			send: (bytes) => this.#socket.write(bytes),
			drain: () => new Promise((resolve) => this.#drainWaiters.push(resolve)),
			pause: () => this.#socket.pause(),
			resume: () => this.#socket.resume(),
			retry: (op) => {
				this.#queue.push(op);
				this.#schedule();
			},
		};
	}

	/** @internal Runs the startup handshake on a connected socket. */
	static async open(
		socket: DriverSocket,
		config: ResolvedConfig,
		info: OpenInfo,
	): Promise<Connection> {
		const connection = new Connection(socket, config, info);
		try {
			await connection.#startup();
		} catch (error) {
			connection.#closed = true;
			socket.destroy();
			connection.#resolveClosed();
			throw error;
		}
		return connection;
	}

	/** The backend's process ID. */
	get processId(): number {
		return this.#pid;
	}

	/** The negotiated protocol version, e.g. `3.2`. */
	get protocol(): `3.${number}` {
		return `3.${this.#protocolMinor}`;
	}

	/** What the server supports; see `Capabilities`. */
	get capabilities(): Capabilities {
		this.#capabilities ??= detectCapabilities(
			this.#protocolMinor,
			this.#parameters,
			this.#saslMechanisms,
		);
		return this.#capabilities;
	}

	/** Protocol options (`_pq_.*`) the server did not recognize, from NegotiateProtocolVersion. */
	get unrecognizedProtocolOptions(): readonly string[] {
		return this.#unrecognizedOptions;
	}

	/** Run-time parameters the server reported (`server_version`, `TimeZone`, `in_hot_standby`, …). */
	get parameters(): ReadonlyMap<string, string> {
		return this.#parameters;
	}

	/** `idle`, `transaction`, or `failed` (in a transaction that has failed). */
	get transactionStatus(): 'idle' | 'transaction' | 'failed' {
		return this.#status === 'I'
			? 'idle'
			: this.#status === 'T'
				? 'transaction'
				: 'failed';
	}

	/** Whether the connection is closed or closing. */
	get closed(): boolean {
		return this.#closed || this.#ending;
	}

	/** Queries sent or waiting to be sent. */
	get pending(): number {
		return this.#queue.length;
	}

	/** The host this connection reached. */
	get host(): HostTarget {
		return this.#info.host;
	}

	// --- startup ---------------------------------------------------------

	#nextStartupMessage(): Promise<BackendMessage> {
		const queued = this.#inbox.shift();
		if (queued !== undefined) return Promise.resolve(queued);
		if (this.#closed) return Promise.reject(this.#failure ?? closedError());
		return new Promise((resolve, reject) => {
			this.#inboxWaiter = resolve;
			this.#startupError = reject;
		});
	}

	async #password(): Promise<string> {
		const source = this.#config.password;
		if (typeof source === 'function') return source();
		if (source !== undefined) return source;
		const file = await readPgpass(this.#config.passfile);
		const found =
			file === undefined
				? undefined
				: findPgpassPassword(file, {
						...this.#info.host,
						database: this.#config.database,
						user: this.#config.user,
					});
		if (found === undefined)
			throw new ConnectionError(
				'The server requested a password, but none was given',
			);
		return found;
	}

	/* oxlint-disable no-await-in-loop -- the handshake is a sequence of round trips */
	async #startup(): Promise<void> {
		const config = this.#config;
		const params: Record<string, string> = {
			user: config.user,
			database: config.database,
			client_encoding: 'UTF8',
			DateStyle: 'ISO, MDY',
			...(config.applicationName === undefined
				? {}
				: { application_name: config.applicationName }),
			...config.params,
		};
		this.#socket.write(
			fe.startup(this.#writer, this.#info.version, params).take(),
		);
		let method: AuthMethod | undefined;
		let scram: ScramClient | undefined;
		let scramVerified = false;
		for (;;) {
			const msg = await this.#nextStartupMessage();
			switch (msg.type) {
				case 'AuthenticationCleartextPassword':
					method = this.#allow('password', 'a cleartext password');
					this.#refuseWithoutBinding('a cleartext password');
					this.#socket.write(
						fe.password(this.#writer, await this.#password()).take(),
					);
					break;
				case 'AuthenticationMD5Password':
					method = this.#allow('md5', 'an MD5 password');
					this.#refuseWithoutBinding('an MD5 password');
					this.#socket.write(
						fe
							.password(
								this.#writer,
								md5Password(config.user, await this.#password(), msg.salt),
							)
							.take(),
					);
					break;
				case 'AuthenticationSASL': {
					this.#saslMechanisms = msg.mechanisms;
					if (!msg.mechanisms.some((m) => m.startsWith('SCRAM-SHA-256'))) {
						throw this.#unsupportedSasl(msg.mechanisms);
					}
					method = this.#allow('scram-sha-256', 'SCRAM-SHA-256');
					scram = await this.#scram(msg.mechanisms);
					this.#socket.write(
						fe
							.saslInitialResponse(this.#writer, scram.mechanism, scram.first())
							.take(),
					);
					break;
				}
				case 'AuthenticationSASLContinue':
					if (scram === undefined)
						throw new ProtocolError('SASLContinue before SASL');
					this.#socket.write(
						fe.saslResponse(this.#writer, await scram.final(msg.data)).take(),
					);
					break;
				case 'AuthenticationSASLFinal':
					if (scram === undefined)
						throw new ProtocolError('SASLFinal before SASL');
					scram.verify(msg.data);
					scramVerified = true;
					break;
				case 'AuthenticationOk':
					if (scram !== undefined && !scramVerified) {
						throw new ConnectionError(
							'The server ended SCRAM authentication without proving it knows the password',
						);
					}
					if (method === undefined) {
						this.#allow('none', 'no');
						this.#refuseWithoutBinding('no password');
					}
					break;
				case 'AuthenticationUnsupported':
					throw this.#unsupported(msg.code);
				case 'NegotiateProtocolVersion':
					this.#negotiated(msg.minor, msg.unrecognized);
					break;
				case 'BackendKeyData':
					this.#pid = msg.pid;
					this.#secretKey = msg.key;
					break;
				case 'ErrorResponse':
					throw postgresError(msg.fields);
				case 'ReadyForQuery':
					this.#status = msg.status;
					checkServerVersion(this.#parameters.get('server_version'));
					this.#capabilities = detectCapabilities(
						this.#protocolMinor,
						this.#parameters,
						this.#saslMechanisms,
					);
					this.#starting = false;
					this.#startupError = undefined;
					return;
				default:
					throw new ProtocolError(`Unexpected ${msg.type} during startup`);
			}
		}
	}

	/* oxlint-enable no-await-in-loop */

	/** Applies NegotiateProtocolVersion: the server speaks at most 3.`minor`. */
	#negotiated(minor: number, unrecognized: readonly string[]): void {
		if (minor < this.#config.protocol.min) {
			throw new ConnectionError(
				`The server supports protocol 3.${minor} at most, but min_protocol_version is 3.${this.#config.protocol.min}`,
				{ code: 'EPROTOCOL' },
			);
		}
		this.#protocolMinor = Math.min(minor, this.#protocolMinor);
		this.#unrecognizedOptions = unrecognized;
	}

	/** Checks a method against `require_auth`. */
	#allow(method: AuthMethod, label: string): AuthMethod {
		const allowed = this.#config.requireAuth;
		if (allowed !== undefined && !allowed.has(method)) {
			throw new ConnectionError(
				`The server requested ${label} authentication (${method}), but require_auth allows only ${[...allowed].join(', ')}`,
				{ code: 'EAUTHMETHOD' },
			);
		}
		return method;
	}

	#unsupported(code: number): ConnectionError {
		const names: Readonly<Record<number, [AuthMethod, string]>> = {
			2: ['gss', 'Kerberos V5'],
			7: ['gss', 'GSSAPI'],
			8: ['gss', 'GSSAPI'],
			9: ['sspi', 'SSPI'],
		};
		const known = names[code];
		if (known === undefined) {
			return new ConnectionError(
				`The server requested an unknown authentication method (request code ${code})`,
				{
					code: 'EAUTHMETHOD',
				},
			);
		}
		this.#allow(known[0], known[1]);
		return new ConnectionError(
			`The server requested ${known[1]} authentication, which this driver does not support (GSSAPI, SSPI and Kerberos are out of scope)`,
			{ code: 'EAUTHMETHOD' },
		);
	}

	/** A SASL request offering no SCRAM mechanism, e.g. only `OAUTHBEARER`. */
	#unsupportedSasl(mechanisms: readonly string[]): ConnectionError {
		const offered = mechanisms.length > 0 ? mechanisms.join(', ') : 'none';
		return new ConnectionError(
			`The server requested SASL authentication with ${offered}, an authentication method this driver does not support (it supports SCRAM-SHA-256 and SCRAM-SHA-256-PLUS)`,
			{ code: 'EAUTHMETHOD' },
		);
	}

	#refuseWithoutBinding(method: string): void {
		if (this.#config.channelBinding === 'require') {
			throw new ConnectionError(
				`channel_binding=require, but the server authenticated with ${method}`,
			);
		}
	}

	async #scram(mechanisms: readonly string[]): Promise<ScramClient> {
		const mode = this.#config.channelBinding;
		const encrypted = this.#socket.encrypted;
		const plusOffered = mechanisms.includes('SCRAM-SHA-256-PLUS');
		let binding: ChannelBinding | undefined;
		if (encrypted && plusOffered && mode !== 'disable') {
			const cert = this.#socket.peerCertificate();
			if (cert !== undefined) binding = await serverEndPoint(cert);
		}
		if (mode === 'require' && binding === undefined) {
			throw new ConnectionError(
				'channel_binding=require, but channel binding is not possible on this connection',
			);
		}
		if (binding === undefined && !mechanisms.includes('SCRAM-SHA-256')) {
			throw new ConnectionError(
				`No supported SASL mechanism among ${mechanisms.join(', ')}`,
			);
		}
		const password = await this.#password();
		return new ScramClient(
			password,
			binding,
			encrypted && mode !== 'disable' && !plusOffered,
		);
	}

	// --- incoming ----------------------------------------------------------

	#onData(chunk: Uint8Array): void {
		const reader = this.#reader;
		try {
			reader.push(chunk);
			for (let type = reader.nextType(); type >= 0; type = reader.nextType()) {
				if (type === 0x44 && !this.#starting) {
					// rows go straight from the buffer to the operation's decoder
					const op = this.#queue[0];
					if (op?.written && op.dataRow(reader.bytes, reader.start, reader.end))
						continue;
				}
				this.#dispatch(reader.parse());
				if (this.#closed) return;
			}
		} catch (error) {
			this.#fail(
				error instanceof Error ? error : new ProtocolError(String(error)),
			);
		}
	}

	#emit<T>(listeners: Iterable<Listener<T>>, value: T): void {
		for (const listener of listeners) {
			try {
				listener(value);
			} catch (error) {
				queueMicrotask(() => {
					throw error;
				});
			}
		}
	}

	#dispatch(msg: BackendMessage): void {
		switch (msg.type) {
			case 'NoticeResponse':
				this.#emit(this.#noticeListeners, toNotice(msg.fields));
				return;
			case 'NotificationResponse': {
				const notification = {
					pid: msg.pid,
					channel: msg.channel,
					payload: msg.payload,
				};
				this.#emit(this.#notificationListeners, notification);
				const channel = this.#channels.get(msg.channel);
				if (channel) this.#emit(channel, notification);
				return;
			}
			case 'ParameterStatus':
				this.#parameters.set(msg.name, msg.value);
				return;
			default:
		}
		if (this.#starting) {
			const waiter = this.#inboxWaiter;
			if (waiter) {
				this.#inboxWaiter = undefined;
				waiter(msg);
			} else {
				this.#inbox.push(msg);
			}
			return;
		}
		if (
			msg.type === 'ErrorResponse' &&
			(msg.fields['V'] === 'FATAL' || msg.fields['V'] === 'PANIC')
		) {
			this.#fatal = postgresError(msg.fields);
		}
		const op = this.#queue[0];
		if (op === undefined || !op.written) {
			if (msg.type === 'ErrorResponse') {
				// e.g. idle_session_timeout or an administrator terminating the backend
				this.#fail(this.#fatal ?? postgresError(msg.fields));
				return;
			}
			throw new ProtocolError(`Unexpected ${msg.type} with no query in flight`);
		}
		if (msg.type === 'ReadyForQuery') this.#status = msg.status;
		if (!op.handle(msg, this.#ctx)) return;
		this.#queue.shift();
		this.#written--;
		let unblocked = false;
		if (this.#blocking === op) {
			this.#blocking = undefined;
			unblocked = true;
		}
		if (this.#cancelSent === op) this.#cancelSent = undefined;
		if (this.#canceling === op) {
			// later writes stay held back while another aborted query is pending
			this.#canceling = this.#queue.find(
				(next) => next.written && next.canceledBy !== undefined,
			);
			unblocked = this.#canceling === undefined;
		}
		this.#cancelAtHead();
		if (unblocked || this.#written < this.#queue.length) this.#schedule();
		if (this.#queue.length === 0)
			for (const resolve of this.#idleWaiters.splice(0)) resolve();
	}

	// --- outgoing ----------------------------------------------------------

	#schedule(): void {
		if (this.#flushScheduled) return;
		this.#flushScheduled = true;
		queueMicrotask(() => this.#flush());
	}

	/** Writes every queued operation that may go out now, in one socket write. */
	#flush(): void {
		this.#flushScheduled = false;
		if (this.#closed) return;
		while (
			this.#written < this.#queue.length &&
			this.#blocking === undefined &&
			this.#canceling === undefined
		) {
			const op = this.#queue[this.#written];
			if (op === undefined) break;
			this.#written++;
			if (op.onTiming !== undefined) op.writtenAt = performance.now();
			const before = this.#writer.length;
			try {
				op.write(this.#ctx);
			} catch (error) {
				// a request that can't be encoded fails alone; nothing of it is sent
				this.#writer.truncate(before);
				this.#written--;
				this.#queue.splice(this.#written, 1);
				op.fail(
					error instanceof Error ? error : new DriverError(String(error)),
				);
				continue;
			}
			op.written = true;
			if (op.exclusive) this.#blocking = op;
		}
		if (this.#writer.length > 0) this.#socket.write(this.#writer.take());
	}

	#statement(
		sql: string,
		types: readonly number[],
	): { statement: Statement; created: boolean } {
		const key = types.length === 0 ? sql : `${types.join(',')}\0${sql}`;
		const existing = this.#statements.get(key);
		if (existing !== undefined) {
			this.#statements.delete(key);
			this.#statements.set(key, existing);
			return { statement: existing, created: false };
		}
		const statement: Statement = {
			name: `q${++this.#statementCount}`,
			key,
			parsed: false,
			fields: undefined,
			paramTypes: undefined,
			error: undefined,
			decoders: new Map(),
			plans: new Map(),
		};
		this.#statements.set(key, statement);
		if (this.#statements.size > this.#config.statementCacheSize) {
			const [oldestKey, oldest] = this.#statements.entries().next().value ?? [];
			if (oldestKey !== undefined && oldest !== undefined) {
				this.#statements.delete(oldestKey);
				// written before the new statement's Parse; the op ignores the CloseComplete
				fe.close(this.#writer, 'S', oldest.name);
			}
		}
		return { statement, created: true };
	}

	#enqueue(op: Op, signal?: AbortSignal, timeout?: number): void {
		if (this.#closed || this.#ending) {
			op.fail(closedError(this.#fatal));
			return;
		}
		if (signal?.aborted) {
			op.fail(
				new AbortError('The query was aborted before it was sent', {
					cause: signal.reason,
				}),
			);
			return;
		}
		if (op.onTiming !== undefined) op.queuedAt = performance.now();
		this.#queue.push(op);
		this.#schedule();
		if (signal) {
			const onAbort = () => this.#abort(op, 'abort', signal.reason);
			signal.addEventListener('abort', onAbort, { once: true });
			op.onSettle(() => signal.removeEventListener('abort', onAbort));
		}
		if (timeout !== undefined && timeout > 0) {
			const timer = setTimeout(() => this.#abort(op, 'timeout'), timeout);
			op.onSettle(() => clearTimeout(timer));
		}
	}

	#abort(op: Op, reason: 'abort' | 'timeout', cause?: unknown): void {
		if (op.done) return;
		if (!op.written) {
			const index = this.#queue.indexOf(op);
			if (index >= 0) this.#queue.splice(index, 1);
			op.fail(
				new AbortError(
					reason === 'timeout'
						? 'The query timed out before it was sent'
						: 'The query was aborted before it was sent',
					cause === undefined ? undefined : { cause },
				),
			);
			return;
		}
		op.canceledBy = reason;
		// hold back later queries so the cancel can't hit one of them
		this.#canceling ??= op;
		this.#cancelAtHead();
	}

	/**
	 * Sends a cancel request once an aborted operation is the one the server
	 * is running: sent while an earlier pipelined query still runs, it would
	 * cancel that one instead.
	 */
	#cancelAtHead(): void {
		const op = this.#queue[0];
		if (
			op === undefined ||
			!op.written ||
			op.canceledBy === undefined ||
			this.#cancelSent === op
		)
			return;
		this.#cancelSent = op;
		// the server drops a cancel that arrives while it is still reading the
		// query's messages, so it is repeated, with backoff, until the query ends
		const send = (attempt: number) => {
			if (op.done || this.#closed || this.#queue[0] !== op) return;
			this.cancel().catch(() => {});
			if (attempt >= 5) return;
			const timer = setTimeout(() => send(attempt + 1), 50 * 2 ** attempt);
			if (typeof timer === 'object' && 'unref' in timer) timer.unref();
			op.onSettle(() => clearTimeout(timer));
		};
		send(0);
	}

	#options(options: QueryOptions | undefined): QueryOpOptions {
		return {
			rowMode: options?.rowMode ?? 'object',
			types: options?.types,
			prepare:
				(options?.prepare ?? this.#config.prepare) &&
				this.#config.statementCacheSize > 0,
			paramTypes: options?.paramTypes ?? [],
			binary: options?.binary ?? this.#config.binaryResults,
		};
	}

	// --- public API --------------------------------------------------------

	/**
	 * Runs one statement with parameters through the extended protocol.
	 * Parameters are encoded by `encodeParam`: strings pass through as they
	 * are, which is how quarry sends values it has encoded itself. An
	 * `undefined` parameter or array element rejects with
	 * `UndefinedParameterError`; pass `null` for NULL.
	 */
	query<R = Record<string, unknown>>(
		sql: string,
		params: readonly unknown[] = [],
		options?: QueryOptions,
	): Promise<QueryResult<R>> {
		if (this.#config.telemetry === undefined && !this.#config.captureStack)
			return this.#query<R>(sql, params, options);
		return this.#observe(
			sql,
			options?.tag,
			() => this.#query<R>(sql, params, options),
			(r) => r.rowCount,
		);
	}

	/**
	 * Runs `run`, reporting it as a span and adding the caller's stack to
	 * its error, as configured.
	 */
	async #observe<T>(
		sql: string,
		tag: string | undefined,
		run: () => Promise<T>,
		rowCount: (result: T) => number | null | undefined,
	): Promise<T> {
		const callsite = this.#config.captureStack ? new Error() : undefined;
		const telemetry = this.#config.telemetry;
		const span =
			telemetry === undefined
				? undefined
				: startQuerySpan(
						telemetry,
						{ database: this.#config.database, ...this.#info.host },
						sql,
						tag,
					);
		try {
			const result = await run();
			span?.finish({ rowCount: rowCount(result) });
			return result;
		} catch (error) {
			span?.finish(undefined, error);
			if (callsite?.stack && error instanceof Error && error.stack) {
				error.stack = `${error.stack}\n    --- query issued at ---\n${callsite.stack.slice(callsite.stack.indexOf('\n') + 1)}`;
			}
			throw error;
		}
	}

	#query<R>(
		sql: string,
		params: readonly unknown[],
		options: QueryOptions | undefined,
	): Promise<QueryResult<R>> {
		if (options?.statementTimeout !== undefined) {
			return this.#queryWithTimeout<R>(
				sql,
				params,
				options,
				options.statementTimeout,
			);
		}
		return new Promise((resolve, reject) => {
			const invalid = invalidSql(sql);
			if (invalid) {
				reject(invalid);
				return;
			}
			let values;
			try {
				values = encodeParams(sql, params);
			} catch (error) {
				reject(error);
				return;
			}
			const op = new QueryOp(
				sql,
				params,
				values,
				this.#options(options),
				(result) => resolve(asResult<R>(result)),
				reject,
			);
			op.onTiming = options?.onTiming;
			this.#enqueue(op, options?.signal, options?.timeout);
		});
	}

	async #queryWithTimeout<R>(
		sql: string,
		params: readonly unknown[],
		options: QueryOptions,
		timeout: number | string,
	): Promise<QueryResult<R>> {
		const { statementTimeout: _, ...rest } = options;
		const value = typeof timeout === 'number' ? `${timeout}ms` : timeout;
		const set = "select set_config('statement_timeout', $1, true) as previous";
		if (this.#status === 'I') {
			// pipelined together, so they reach the server back to back
			const settled = await Promise.allSettled([
				this.#query('begin', [], undefined),
				this.#query(set, [value], undefined),
				this.#query<R>(sql, params, rest),
				this.#query('commit', [], undefined),
			]);
			const result = settled[2];
			if (result?.status === 'rejected') throw result.reason;
			const failed = settled.find((s) => s.status === 'rejected');
			if (failed?.status === 'rejected') throw failed.reason;
			if (result?.status !== 'fulfilled')
				throw new ConnectionError('Query did not run');
			return result.value;
		}
		const previous = this.#query<{ previous: string }>(
			"select current_setting('statement_timeout') as previous, set_config('statement_timeout', $1, true)",
			[value],
			undefined,
		);
		const [before, result] = await Promise.allSettled([
			previous,
			this.#query<R>(sql, params, rest),
		]);
		if (before.status === 'fulfilled' && this.#status === 'T') {
			this.#query(
				set,
				[before.value.rows[0]?.previous ?? '0'],
				undefined,
			).catch(() => {});
		}
		if (result.status === 'rejected') throw result.reason;
		if (before.status === 'rejected') throw before.reason;
		return result.value;
	}

	/**
	 * Runs `fn` in a transaction: committed when it resolves, rolled back
	 * when it throws. Serialization failures and deadlocks can be retried,
	 * and settings applied with bound parameters.
	 */
	transaction<T>(
		fn: (tx: Transaction) => Promise<T>,
		options?: TransactionOptions,
	): Promise<T> {
		return Transaction.run(this, fn, options);
	}

	/**
	 * Runs one or more statements through the simple protocol (no
	 * parameters), returning one result per statement. Useful for scripts
	 * and statements that can't be prepared.
	 */
	simpleQuery<R = Record<string, unknown>>(
		sql: string,
		options?: Pick<
			QueryOptions,
			'rowMode' | 'types' | 'signal' | 'timeout' | 'tag'
		>,
	): Promise<QueryResult<R>[]> {
		if (this.#config.telemetry === undefined && !this.#config.captureStack)
			return this.#simpleQuery<R>(sql, options);
		return this.#observe(
			sql,
			options?.tag,
			() => this.#simpleQuery<R>(sql, options),
			(r) => r.at(-1)?.rowCount,
		);
	}

	#simpleQuery<R>(
		sql: string,
		options:
			| Pick<QueryOptions, 'rowMode' | 'types' | 'signal' | 'timeout'>
			| undefined,
	): Promise<QueryResult<R>[]> {
		return new Promise((resolve, reject) => {
			const invalid = invalidSql(sql);
			if (invalid) {
				reject(invalid);
				return;
			}
			const op = new SimpleQueryOp(
				sql,
				options?.types,
				options?.rowMode ?? 'object',
				(results) => resolve(results.map((r) => asResult<R>(r))),
				reject,
			);
			this.#enqueue(op, options?.signal, options?.timeout);
		});
	}

	/** The parameter types and result columns of a statement, without running it. */
	describe(
		sql: string,
		options?: Pick<QueryOptions, 'paramTypes' | 'signal' | 'timeout'>,
	): Promise<Description> {
		return new Promise((resolve, reject) => {
			const invalid = invalidSql(sql);
			if (invalid) {
				reject(invalid);
				return;
			}
			this.#enqueue(
				new DescribeOp(sql, options?.paramTypes ?? [], resolve, reject),
				options?.signal,
				options?.timeout,
			);
		});
	}

	/**
	 * Reads a query's rows in batches through a portal, so large results
	 * never sit in memory at once. The connection runs nothing else until
	 * the iteration ends; breaking out early closes the portal.
	 */
	cursor<R = Record<string, unknown>>(
		sql: string,
		params: readonly unknown[] = [],
		options?: CursorOptions,
	): AsyncIterable<R[]> {
		const invalid = invalidSql(sql);
		if (invalid) {
			return {
				[Symbol.asyncIterator]: () => ({
					next: () => Promise.reject(invalid),
				}),
			};
		}
		return {
			[Symbol.asyncIterator]: () => {
				const op = new CursorOp(
					sql,
					params,
					encodeParams(sql, params),
					this.#options(options),
					options?.batchSize ?? 1000,
				);
				let started = false;
				let failed: Error | undefined;
				const start = () => {
					if (started) return;
					started = true;
					const original = op.fail.bind(op);
					op.fail = (error: Error) => {
						failed = error;
						original(error);
					};
					this.#enqueue(op, options?.signal, options?.timeout);
				};
				return {
					next: async (): Promise<IteratorResult<R[]>> => {
						start();
						if (failed && !op.written) throw failed;
						const rows = await op.next();
						return rows === undefined
							? { done: true, value: undefined }
							: { done: false, value: asRows<R>(rows) };
					},
					return: async (): Promise<IteratorResult<R[]>> => {
						if (started) await op.close();
						return { done: true, value: undefined };
					},
				};
			},
		};
	}

	/** Like `cursor`, one row at a time. */
	async *stream<R = Record<string, unknown>>(
		sql: string,
		params: readonly unknown[] = [],
		options?: CursorOptions,
	): AsyncGenerator<R, void, undefined> {
		for await (const batch of this.cursor<R>(sql, params, options))
			yield* batch;
	}

	/**
	 * Runs `COPY … FROM STDIN`, sending `source`'s chunks as the data.
	 * Returns the number of rows copied.
	 */
	copyFrom(
		sql: string,
		source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
		options?: Pick<QueryOptions, 'signal' | 'timeout' | 'tag'>,
	): Promise<number> {
		if (this.#config.telemetry !== undefined || this.#config.captureStack) {
			return this.#observe(
				sql,
				options?.tag,
				() => this.#copyFrom(sql, source, options),
				(n) => n,
			);
		}
		return this.#copyFrom(sql, source, options);
	}

	#copyFrom(
		sql: string,
		source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
		options: Pick<QueryOptions, 'signal' | 'timeout'> | undefined,
	): Promise<number> {
		return new Promise((resolve, reject) => {
			const invalid = invalidSql(sql);
			if (invalid) {
				reject(invalid);
				return;
			}
			this.#enqueue(
				new CopyFromOp(sql, source, resolve, reject),
				options?.signal,
				options?.timeout,
			);
		});
	}

	/**
	 * Bulk-loads rows with `COPY … FROM STDIN` in text format, the fastest
	 * way to insert many rows. Each row is an array of values in the
	 * statement's column order, encoded like query parameters. Returns the
	 * number of rows copied.
	 *
	 * @example
	 * await conn.copyRows('copy users (id, name) from stdin', [[1, 'Ada'], [2, 'Grace']]);
	 */
	copyRows(
		sql: string,
		rows: AsyncIterable<readonly unknown[]> | Iterable<readonly unknown[]>,
		options?: Pick<QueryOptions, 'signal' | 'timeout'>,
	): Promise<number> {
		return this.copyFrom(sql, copyChunks(rows), options);
	}

	/** Runs `COPY … TO STDOUT`, yielding the data in chunks, with backpressure. */
	copyTo(
		sql: string,
		options?: Pick<QueryOptions, 'signal' | 'timeout'> & {
			highWaterMark?: number;
		},
	): AsyncIterable<Uint8Array> {
		const invalid = invalidSql(sql);
		if (invalid) {
			return {
				[Symbol.asyncIterator]: () => ({
					next: () => Promise.reject(invalid),
				}),
			};
		}
		return {
			[Symbol.asyncIterator]: () => {
				const op = new CopyToOp(sql, options?.highWaterMark ?? 1 << 20);
				let started = false;
				return {
					next: async (): Promise<IteratorResult<Uint8Array>> => {
						if (!started) {
							started = true;
							this.#enqueue(op, options?.signal, options?.timeout);
						}
						const chunk = await op.next();
						return chunk === undefined
							? { done: true, value: undefined }
							: { done: false, value: chunk };
					},
					return: async (): Promise<IteratorResult<Uint8Array>> => {
						if (started && !op.done) {
							op.canceledBy = 'abort';
							await this.cancel();
							// oxlint-disable-next-line no-await-in-loop
							while ((await op.next().catch(() => undefined)) !== undefined) {
								// drain until the server stops
							}
						}
						return { done: true, value: undefined };
					},
				};
			},
		};
	}

	/**
	 * Subscribes to a channel (`LISTEN`). Returns a function that removes the
	 * handler, and runs `UNLISTEN` once no handlers remain.
	 */
	async listen(
		channel: string,
		handler: (notification: Notification) => void,
	): Promise<() => Promise<void>> {
		let handlers = this.#channels.get(channel);
		if (handlers === undefined) {
			handlers = new Set();
			this.#channels.set(channel, handlers);
			try {
				await this.query(`listen ${quoteIdentifier(channel)}`, [], {
					prepare: false,
				});
			} catch (error) {
				this.#channels.delete(channel);
				throw error;
			}
		}
		handlers.add(handler);
		const set = handlers;
		return async () => {
			set.delete(handler);
			if (set.size === 0 && this.#channels.get(channel) === set) {
				this.#channels.delete(channel);
				if (!this.closed)
					await this.query(`unlisten ${quoteIdentifier(channel)}`, [], {
						prepare: false,
					});
			}
		};
	}

	/** Channels with `LISTEN` active on this connection. */
	get channels(): readonly string[] {
		return [...this.#channels.keys()];
	}

	/** Sends `NOTIFY` (through `pg_notify`, so the payload is a parameter). */
	async notify(channel: string, payload = ''): Promise<void> {
		await this.query('select pg_notify($1, $2)', [channel, payload]);
	}

	onNotice(listener: (notice: Notice) => void): () => void {
		this.#noticeListeners.add(listener);
		return () => this.#noticeListeners.delete(listener);
	}

	onNotification(listener: (notification: Notification) => void): () => void {
		this.#notificationListeners.add(listener);
		return () => this.#notificationListeners.delete(listener);
	}

	/** Called once when the connection closes, with the error if it failed. */
	onClose(listener: (error: Error | undefined) => void): () => void {
		this.#closeListeners.add(listener);
		return () => this.#closeListeners.delete(listener);
	}

	/**
	 * Asks the server to cancel whatever this connection is running, over a
	 * separate connection. Resolves once the request was delivered; the
	 * running query then fails with `QueryCanceled`.
	 */
	cancel(): Promise<void> {
		return this.#info.cancel(this.#pid, this.#secretKey);
	}

	/** Resolves when no queries are queued or running. */
	idle(): Promise<void> {
		if (this.#queue.length === 0) return Promise.resolve();
		return new Promise((resolve) => this.#idleWaiters.push(resolve));
	}

	/**
	 * Waits for queued queries, then closes gracefully. With `timeout`
	 * (milliseconds), queries still running after it are failed and the
	 * socket destroyed.
	 */
	async close(options: { timeout?: number } = {}): Promise<void> {
		if (this.#closed) return;
		const timer =
			options.timeout === undefined
				? undefined
				: setTimeout(
						() =>
							this.#fail(
								new ConnectionError(
									`The connection was closed after waiting ${options.timeout}ms for queries`,
								),
							),
						options.timeout,
					);
		try {
			await this.#close();
		} finally {
			clearTimeout(timer);
		}
	}

	async #close(): Promise<void> {
		if (this.#closed) return;
		if (!this.#ending) {
			this.#ending = true;
			await this.idle();
			if (!this.#closed) {
				this.#socket.write(fe.terminate(this.#writer).take());
				this.#socket.end();
			}
		}
		await this.#closedPromise;
	}

	/** Closes immediately, failing anything queued. */
	destroy(error?: Error): void {
		this.#fail(error ?? closedError());
	}

	[Symbol.asyncDispose](): Promise<void> {
		return this.close();
	}

	#onSocketClose(): void {
		if (this.#closed) return;
		if (this.#ending && this.#queue.length === 0) {
			this.#closed = true;
			this.#resolveClosed();
			this.#emit(this.#closeListeners, undefined);
			return;
		}
		this.#fail(
			this.#fatal ?? new ConnectionError('The server closed the connection'),
		);
	}

	#fail(error: Error): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#failure = error;
		this.#socket.destroy();
		this.#startupError?.(error);
		const ops = this.#queue.splice(0);
		this.#written = 0;
		for (const op of ops) op.fail(error);
		for (const resolve of this.#idleWaiters.splice(0)) resolve();
		for (const resolve of this.#drainWaiters.splice(0)) resolve();
		this.#resolveClosed();
		this.#emit(this.#closeListeners, error);
	}
}

/** Why `sql` can't be sent, if it can't: Postgres takes text without NUL bytes. */
function invalidSql(sql: unknown): DriverError | undefined {
	if (typeof sql !== 'string')
		return new DriverError(`The SQL text must be a string, not ${typeof sql}`);
	const nul = sql.indexOf('\0');
	if (nul >= 0)
		return new DriverError(
			`The SQL text contains a NUL byte (at character ${nul + 1}), which PostgreSQL does not accept`,
		);
	return undefined;
}

export function quoteIdentifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

async function readPgpass(
	passfile: string | undefined,
): Promise<string | undefined> {
	try {
		const [{ readFile }, { homedir }, { join }] = await Promise.all([
			import('node:fs/promises'),
			import('node:os'),
			import('node:path'),
		]);
		return await readFile(passfile ?? join(homedir(), '.pgpass'), 'utf8');
	} catch {
		return undefined;
	}
}
