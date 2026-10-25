import { md5Password } from './auth/md5.js';
import {
	ScramClient,
	scramCrypto,
	serverEndPoint,
	type ChannelBinding,
} from './auth/scram.js';
import {
	checkServerVersion,
	detectCapabilities,
	statementNames,
	type Capabilities,
	type StatementNames,
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
import { CursorIterator, type CursorHost } from './cursor.js';
import { toNotice, type Notice, type Notification } from './notice.js';
import {
	CopyFromOp,
	CopyToOp,
	CursorOp,
	DescribeOp,
	Op,
	QueryOp,
	SimpleQueryOp,
	STATEMENT_TIMEOUT,
	SyncGroupOp,
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
import { ChannelNames, decodeNotification, Reader } from './protocol/reader.js';
import { Writer } from './protocol/writer.js';
import { Queue } from './queue.js';
import { RowStream } from './row-stream.js';
import {
	asResult,
	asResultPromise,
	checkNested,
	type NestedObject,
	type RowMode,
} from './rows.js';
import type { DriverSocket } from './socket.js';
import { startQuerySpan } from './telemetry.js';
import { Transaction, type TransactionOptions } from './transaction.js';
import type { Codec } from './codec.js';
import {
	encodeParams,
	paramOids,
	unresolvedParams,
	type ParamCodecs,
} from './params.js';
import {
	catalogQuery,
	CodecRegistry,
	createCodecRegistry,
	defaultRegistry,
	type CatalogType,
} from './registry.js';
import type { ResultCodecs } from './results.js';
import { copyChunks } from './types.js';

export interface QueryOptions {
	/** `object` (default) rows keyed by column name, or positional `array` rows. */
	readonly rowMode?: RowMode;
	/**
	 * Codecs for this query's result columns, by type OID, over the
	 * connection's: a registry (`createCodecRegistry`), or a list.
	 */
	readonly codecs?: CodecRegistry | readonly Codec[];
	/**
	 * Use a cached named prepared statement, once the SQL has run
	 * `prepareThreshold` times (default: the connection's `prepare` option).
	 */
	readonly prepare?: boolean;
	/**
	 * The codec of each parameter, by position (as `typed` gives one): the
	 * value is encoded by it, and its type declared unless the codec leaves
	 * it to the server. A missing entry is encoded by its JavaScript type.
	 */
	readonly paramCodecs?: ParamCodecs;
	/**
	 * The codec each result column is expected in, by position: read with
	 * it while the column has its type (once a cached statement's columns
	 * are described, in binary where it reads it so). A missing entry, or a
	 * column of another type, is read with the registry's codec for its
	 * type.
	 */
	readonly resultCodecs?: ResultCodecs;
	/**
	 * Parameter type OIDs; 0 or missing entries let the server infer. An
	 * array whose type is declared here is sent in binary where it can be.
	 * A parameter's codec declares its type itself.
	 */
	readonly paramTypes?: readonly number[];
	/** Cancels the query when aborted. A query not yet sent is dropped without contacting the server. */
	readonly signal?: AbortSignal;
	/**
	 * Cancels the query after this many milliseconds, from the client. The
	 * time counts from when the query is queued on its connection, so it
	 * includes the wait behind queries pipelined ahead of it there, not only
	 * the server's work. A pool's wait for a connection or a pipeline slot
	 * comes before, bounded by `acquireTimeout`.
	 */
	readonly timeout?: number;
	/**
	 * A server-side `statement_timeout` for this query only (milliseconds,
	 * or a Postgres interval such as `'2s'`). Applied with
	 * `set_config(…, true)` just before the query and restored just after
	 * it, all three under the query's Sync, so it bounds this query alone,
	 * in a transaction or not, whatever else is pipelined.
	 */
	readonly statementTimeout?: number | string;
	/** Receives where the query spent its time once it settles. */
	readonly onTiming?: (timing: OpTiming) => void;
	/** A label for telemetry: the span name and `db.query.summary` (quarry's `tag()`). */
	readonly tag?: string;
	/**
	 * Ask for binary results for columns whose codec reads them so (default:
	 * the connection's `binaryResults`). Values decode the same. Only a
	 * statement whose columns the server has described asks for it, from a
	 * cached statement's second run, so no format is requested before the
	 * column's type is known.
	 */
	readonly binary?: boolean;
	/**
	 * Keeps only the first `keepRows` rows, without decoding the others; the
	 * query still runs to completion, and `rowCount` counts every row. A
	 * value that fails to decode in a row not kept goes unnoticed.
	 */
	readonly keepRows?: number;
	/**
	 * Columns read into objects of the row, each in place of its marker
	 * column, and null where the marker is false (see `NestedObject`).
	 */
	readonly nested?: readonly NestedObject[];
}

/** A statement of `Connection.queryGroup`; per-query cancellation and timing don't apply. */
export interface GroupStatement {
	readonly sql: string;
	readonly params?: readonly unknown[] | undefined;
	readonly options?:
		| Omit<QueryOptions, 'signal' | 'timeout' | 'statementTimeout' | 'onTiming'>
		| undefined;
}

/**
 * A cursor's options: a query's, without `keepRows` (a cursor reads every
 * row it fetches). `signal` and `timeout` stop the whole cursor, whenever
 * they fire; `statementTimeout` bounds it from its first batch to its last,
 * the consumer's time included, and is refused by a `Transaction` (on a
 * plain connection it holds the connection between batches, as outside a
 * transaction).
 */
export interface CursorOptions extends Omit<QueryOptions, 'keepRows'> {
	/** Rows fetched per round trip (default 1000), each batch once the one before is taken. */
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
 * Encoded bytes handed to the socket at a time when a flush covers many
 * queries, so a long queue is encoded only as fast as the socket takes it.
 */
const FLUSH_BYTES = 65_536;

const STATEMENT_TIMEOUT_OPTIONS = { paramTypes: [25] } as const;

/**
 * One session with the server. Queries can be issued concurrently: they
 * are pipelined, written together in one socket write per tick (in 64 KiB
 * chunks, pausing while the socket's buffer is full), and their results
 * come back in order. An error in one query does not affect the
 * others (each has its own Sync), except inside a transaction, where
 * Postgres aborts the transaction as usual.
 */
export class Connection implements AsyncDisposable {
	readonly #socket: DriverSocket;
	readonly #config: ResolvedConfig;
	readonly #info: OpenInfo;
	readonly #reader: Reader;
	readonly #writer = new Writer();
	readonly #queue = new Queue<Op>();
	/** How many operations at the front of the queue have been written. */
	#written = 0;
	#flushScheduled = false;
	/** The socket's write buffer is full: nothing more is encoded until it drains. */
	#backpressure = false;
	/** An exclusive operation that has been written: nothing more is written until it completes. */
	#blocking: Op | undefined;
	/** An operation this client asked the server to cancel: nothing more is written until it completes. */
	#canceling: Op | undefined;
	/** The operation the cancel request was sent for, once it is running. */
	#cancelSent: Op | undefined;
	readonly #statements = new Map<string, Statement>();
	/** Statement keys never prepared again on this connection (see `OpContext.unprepare`). */
	readonly #unprepared = new Set<string>();
	#statementCount = 0;
	#portalCount = 0;
	#cursorHost: CursorHost | undefined;
	#statementUses = 0;
	/** Which cached statements are written named: every one, those written alone, or none (see `OpContext.named`). */
	#naming: 'always' | 'alone' | 'never' = 'always';
	#status: 'I' | 'T' | 'E' = 'I';
	#closed = false;
	#ending = false;
	#closing: Promise<void> | undefined;
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
	readonly #channelNames = new ChannelNames();
	readonly #closeListeners = new Set<Listener<Error | undefined>>();
	readonly #drainWaiters: (() => void)[] = [];
	readonly #idleWaiters: (() => void)[] = [];
	readonly #closedPromise: Promise<void>;
	#resolveClosed: () => void = () => {};
	/** When the connection was opened (ms since epoch). */
	readonly createdAt = Date.now();
	/**
	 * @internal Runs again, elsewhere, a query of `queryThen` that provably
	 * never ran here: the connection failed before it was written, or the
	 * server's first answer after it was written ended the session
	 * (`TERMINATED`). Set by a pool.
	 */
	rerun:
		| ((
				sql: string,
				params: readonly unknown[],
				options: QueryOptions | undefined,
				resolve: (result: QueryResult<unknown>) => void,
				reject: (error: Error) => void,
		  ) => void)
		| undefined;
	readonly #ctx: OpContext;
	#defaultOptions: QueryOpOptions | undefined;
	readonly #flushTask = () => this.#flush();

	private constructor(
		socket: DriverSocket,
		config: ResolvedConfig,
		info: OpenInfo,
	) {
		this.#socket = socket;
		this.#config = config;
		this.#info = info;
		this.#reader = new Reader(config.maxMessageSize);
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
			this.#backpressure = false;
			for (const resolve of this.#drainWaiters.splice(0)) resolve();
			if (this.#written < this.#queue.length) this.#schedule();
		});
		this.#ctx = {
			writer: this.#writer,
			registry: config.registry,
			catalog: config.catalog,
			specs: {
				binary: {
					registry: config.registry,
					catalog: config.catalog,
					expected: undefined,
					binary: true,
				},
				text: {
					registry: config.registry,
					catalog: config.catalog,
					expected: undefined,
					binary: false,
				},
			},
			statement: (sql, types, named) => this.#statement(sql, types, named),
			// alone: nothing else in flight or waiting on the connection, nor
			// another statement under its Sync that may be named
			named: () =>
				this.#naming === 'always' ||
				(this.#naming === 'alone' &&
					this.#queue.length === 1 &&
					(this.#queue.at(0)?.prepares ?? 0) <= 1),
			unprepare: (statement) =>
				this.#unprepared.add(statementKey(statement.sql, statement.types)),
			preparable: (sql, types) =>
				this.#unprepared.size === 0 ||
				!this.#unprepared.has(statementKey(sql, types)),
			forget: (statement) => {
				if (this.#statements.get(statement.key) === statement)
					this.#statements.delete(statement.key);
			},
			send: (bytes) => this.#send(bytes),
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
		// a likely SCRAM exchange: load the crypto module (~3 ms on a cold
		// start) while the server starts the backend, not after it asks
		if (config.password !== undefined) scramCrypto();
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
					this.#naming = naming(
						statementNames(this.#capabilities.pgbouncer),
						this.#config.preparePipelined,
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
		const client = new ScramClient(
			password,
			binding,
			encrypted && mode !== 'disable' && !plusOffered,
		);
		client.maxIterations = this.#config.scramMaxIterations;
		return client;
	}

	// --- incoming ----------------------------------------------------------

	#onData(chunk: Uint8Array): void {
		const reader = this.#reader;
		try {
			reader.push(chunk);
			for (let type = reader.nextType(); type >= 0; type = reader.nextType()) {
				if (type === 0x44 && !this.#starting) {
					// rows go straight from the buffer to the operation's decoder
					const op = this.#queue.at(0);
					if (op?.written && op.dataRow(reader.bytes, reader.start, reader.end)) {
						op.answered = true;
						continue;
					}
				} else if (type === 0x41) {
					this.#notify(
						decodeNotification(
							reader.bytes,
							reader.start,
							reader.end,
							this.#channelNames,
						),
					);
					if (this.#closed) return;
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

	#notify(notification: Notification): void {
		for (const listener of this.#notificationListeners) {
			try {
				listener(notification);
			} catch (error) {
				queueMicrotask(() => {
					throw error;
				});
			}
		}
		if (this.#channels.size === 0) return;
		const channel = this.#channels.get(notification.channel);
		if (channel) this.#emit(channel, notification);
	}

	#dispatch(msg: BackendMessage): void {
		switch (msg.type) {
			case 'NoticeResponse':
				this.#emit(this.#noticeListeners, toNotice(msg.fields));
				return;
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
			const fatal = postgresError(msg.fields);
			this.#fatal = fatal;
			const head = this.#queue.at(0);
			if (
				TERMINATED.has(fatal.code) &&
				(head === undefined || !head.written || !head.answered)
			) {
				// sent before the server answered anything written: it ran none of it
				this.#fail(fatal, true);
				return;
			}
		}
		const op = this.#queue.at(0);
		if (op === undefined || !op.written) {
			if (msg.type === 'ErrorResponse') {
				// e.g. idle_session_timeout or an administrator terminating the backend
				this.#fail(this.#fatal ?? postgresError(msg.fields));
				return;
			}
			throw new ProtocolError(`Unexpected ${msg.type} with no query in flight`);
		}
		if (msg.type === 'ReadyForQuery') this.#status = msg.status;
		op.answered = true;
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
		if (this.#queue.length === 0 && this.#idleWaiters.length > 0)
			for (const resolve of this.#idleWaiters.splice(0)) resolve();
		this.#finished(op);
	}

	/** Runs a settled operation's `onDone`, once it has left the queue. */
	#finished(op: Op): void {
		const onDone = op.onDone;
		if (onDone === undefined) return;
		op.onDone = undefined;
		onDone();
	}

	// --- outgoing ----------------------------------------------------------

	#schedule(): void {
		if (this.#flushScheduled) return;
		this.#flushScheduled = true;
		queueMicrotask(this.#flushTask);
	}

	/**
	 * Writes the queued operations that may go out now: in one socket write,
	 * or in chunks of `FLUSH_BYTES` for a long queue. Once the socket's
	 * buffer is full, the rest stay queued, unencoded, until it drains.
	 */
	#flush(): void {
		this.#flushScheduled = false;
		if (this.#closed || this.#backpressure) return;
		while (
			this.#written < this.#queue.length &&
			this.#blocking === undefined &&
			this.#canceling === undefined
		) {
			const op = this.#queue.at(this.#written);
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
				this.#queue.removeAt(this.#written);
				op.fail(
					error instanceof Error ? error : new DriverError(String(error)),
				);
				this.#finished(op);
				continue;
			}
			op.written = true;
			if (op.exclusive) this.#blocking = op;
			if (
				this.#writer.length >= FLUSH_BYTES &&
				!this.#send(this.#writer.take())
			)
				return;
		}
		if (this.#writer.length > 0) this.#send(this.#writer.take());
	}

	#send(bytes: Uint8Array): boolean {
		if (this.#socket.write(bytes)) return true;
		this.#backpressure = true;
		return false;
	}

	/**
	 * The cached statement for `sql` with the parameter types `types`, or a
	 * new one. A statement is keyed by its SQL alone, and the types are
	 * compared: a SQL string used again keeps its hash, where a key built
	 * per query (types and SQL) would be hashed in full every time. The same
	 * SQL with other types is keyed by both.
	 *
	 * With `named`, SQL is prepared on its `prepareThreshold`th run: before
	 * that its entry is unnamed, keeping only the columns its runs
	 * described, so SQL run once never takes a server-side statement or
	 * pushes a prepared one out. Only runs that succeeded count, so a
	 * statement isn't prepared in the middle of a pipeline that repeats it,
	 * behind a statement that may fail and make the server skip its Parse.
	 * It is prepared like new SQL (described, its results in text that
	 * run): its columns may have changed since. When the cache is full, the
	 * least recently used unnamed entry goes first.
	 */
	#statement(sql: string, types: readonly number[], named: boolean): Statement {
		let key = sql;
		let existing = this.#statements.get(sql);
		if (existing === undefined || !sameTypes(existing.types, types)) {
			const variant = variantKey(sql, types);
			const found = this.#statements.get(variant);
			if (existing !== undefined || found !== undefined) {
				key = variant;
				existing = found;
			}
		}
		const threshold = this.#config.prepareThreshold;
		if (existing !== undefined) {
			// a use stamp instead of moving the entry to the Map's end: deleting
			// and re-adding a key on every hit makes the Map rehash, garbage
			// that adds up to GC pauses on small queries
			existing.used = ++this.#statementUses;
			if (!named || existing.name !== '' || existing.seen + 1 < threshold)
				return existing;
			// run often enough: replaced by a named statement
			this.#statements.delete(key);
		}
		const statement: Statement = {
			name:
				named && (existing !== undefined || threshold <= 1)
					? `q${++this.#statementCount}`
					: '',
			key,
			sql,
			// a copy: `paramTypes` is the caller's array
			types: [...types],
			used: ++this.#statementUses,
			seen: existing?.seen ?? 0,
			unwritten: true,
			parsed: false,
			fields: undefined,
			error: undefined,
			plans: [],
		};
		if (this.#statements.size >= this.#config.statementCacheSize) {
			let oldest: Statement | undefined;
			let oldestUnnamed: Statement | undefined;
			for (const candidate of this.#statements.values()) {
				if (oldest === undefined || candidate.used < oldest.used)
					oldest = candidate;
				if (
					candidate.name === '' &&
					(oldestUnnamed === undefined || candidate.used < oldestUnnamed.used)
				)
					oldestUnnamed = candidate;
			}
			const evicted = oldestUnnamed ?? oldest;
			if (evicted !== undefined) {
				this.#statements.delete(evicted.key);
				// written before the new statement's Parse; the op ignores the CloseComplete
				if (evicted.name !== '') fe.close(this.#writer, 'S', evicted.name);
			}
		}
		this.#statements.set(key, statement);
		return statement;
	}

	#enqueue(op: Op, signal?: AbortSignal, timeout?: number): void {
		if (this.#closed || this.#ending) {
			op.fail(closedError(this.#fatal));
			this.#finished(op);
			return;
		}
		if (signal?.aborted) {
			op.fail(
				new AbortError('The query was aborted before it was sent', {
					cause: signal.reason,
				}),
			);
			this.#finished(op);
			return;
		}
		if (op.onTiming !== undefined) op.queuedAt = performance.now();
		this.#queue.push(op);
		this.#schedule();
		// in methods of their own: closures here would cost every query a context
		if (signal) this.#abortOn(op, signal);
		if (timeout !== undefined && timeout > 0) this.#timeOut(op, timeout);
	}

	#abortOn(op: Op, signal: AbortSignal): void {
		const onAbort = () => this.#abort(op, 'abort', signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
		op.onSettle(() => signal.removeEventListener('abort', onAbort));
	}

	#timeOut(op: Op, timeout: number): void {
		const timer = setTimeout(() => this.#abort(op, 'timeout'), timeout);
		op.onSettle(() => clearTimeout(timer));
	}

	#abort(op: Op, reason: 'abort' | 'timeout', cause?: unknown): void {
		if (op.done) return;
		if (!op.written) {
			const index = this.#queue.indexOf(op);
			if (index >= 0) this.#queue.removeAt(index);
			op.fail(
				new AbortError(
					reason === 'timeout'
						? 'The query timed out before it was sent'
						: 'The query was aborted before it was sent',
					cause === undefined ? undefined : { cause },
				),
			);
			this.#finished(op);
			return;
		}
		op.canceledBy = reason;
		if (op.interrupt(reason, cause)) return;
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
		const op = this.#queue.at(0);
		if (
			op === undefined ||
			!op.written ||
			op.canceledBy === undefined ||
			this.#cancelSent === op
		)
			return;
		this.#cancelSent = op;
		// the server drops a cancel that arrives while it is still reading the
		// query's messages, so it is repeated, with backoff, until the query
		// ends; once the server answered part of it, it has read all of it, so
		// the cancel sent then is the last: one sent after the query finished
		// would hit a query pipelined behind it
		const send = (attempt: number) => {
			if (op.done || this.#closed || this.#queue.at(0) !== op) return;
			const last = op.answered;
			this.cancel().catch(() => {});
			if (last || attempt >= 5) return;
			const timer = setTimeout(() => send(attempt + 1), 50 * 2 ** attempt);
			if (typeof timer === 'object' && 'unref' in timer) timer.unref();
			op.onSettle(() => clearTimeout(timer));
		};
		send(0);
	}

	#options(options: QueryOptions | undefined): QueryOpOptions {
		if (
			options === undefined ||
			(options.codecs === undefined &&
				options.resultCodecs === undefined &&
				options.prepare === undefined &&
				options.binary === undefined &&
				options.keepRows === undefined &&
				options.rowMode === undefined &&
				options.nested === undefined)
		)
			return (this.#defaultOptions ??= this.#optionsOf({}));
		return this.#optionsOf(options);
	}

	#optionsOf(options: QueryOptions): QueryOpOptions {
		if (options.nested !== undefined) checkNested(options.nested);
		return {
			rowMode: options.rowMode ?? 'object',
			registry: this.#registryOf(options),
			resultCodecs: options.resultCodecs,
			prepare:
				(options.prepare ?? this.#config.prepare) &&
				this.#config.statementCacheSize > 0,
			binary: options.binary ?? this.#config.binaryResults,
			keepRows: options.keepRows ?? Infinity,
			nested: options.nested,
		};
	}

	/** The registry a query's options name; undefined for the connection's. */
	#registryOf(
		options: Pick<QueryOptions, 'codecs'> | undefined,
	): CodecRegistry | undefined {
		const codecs = options?.codecs;
		if (codecs instanceof CodecRegistry) return codecs;
		if (codecs !== undefined) {
			let registry = listRegistries.get(codecs);
			if (registry === undefined) {
				registry = createCodecRegistry(codecs, this.#config.registry);
				listRegistries.set(codecs, registry);
			}
			return registry;
		}
		return undefined;
	}

	/** The type OIDs a query's parameters declare: their codecs', or `paramTypes`. */
	#types(
		params: readonly unknown[],
		options: QueryOptions | undefined,
	): readonly number[] {
		return paramOids(
			params,
			options?.paramCodecs,
			options?.paramTypes,
			this.#config.catalog,
		);
	}

	/**
	 * Loads the catalog behind a query that needs it (a codec for a type
	 * looked up by name): after the query, which goes out with that type
	 * inferred and its columns read as text, so queries keep their order.
	 */
	#loadTypesAfter(
		params: readonly unknown[],
		options: QueryOptions | undefined,
	): void {
		const catalog = this.#config.catalog;
		if (catalog.loaded || catalog.loading || this.#status === 'E') return;
		const registry = this.#registryOf(options) ?? this.#config.registry;
		let needed =
			registry.needsCatalog ||
			unresolvedParams(params, options?.paramCodecs, catalog);
		needed ||=
			options?.resultCodecs?.some(
				(codec) =>
					codec !== undefined && codec !== null && catalog.unresolved(codec),
			) ?? false;
		if (needed) this.loadTypes().catch(() => {});
	}

	/**
	 * Looks up the types the codecs name (enums, domains, extension types
	 * and their arrays) in `pg_type`, once for the pool: queries then declare
	 * their parameters' types and read their columns in binary. Queries load
	 * it on their own the first time they need it; this loads it before.
	 */
	loadTypes(): Promise<void> {
		return this.#config.catalog.load(() => this.#catalogRows());
	}

	/**
	 * Looks up the types again, for types created (or changed) since they
	 * were loaded; the whole pool then uses the new lookup.
	 */
	reloadTypes(): Promise<void> {
		return this.#config.catalog.load(() => this.#catalogRows(), true);
	}

	#catalogRows(): Promise<readonly CatalogType[]> {
		return this.#query<CatalogType>(catalogQuery, [], {
			prepare: false,
			codecs: defaultRegistry,
		}).then(({ rows }) => rows);
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
	 * @internal `query`, calling `onDone` once it settles, before callbacks
	 * on the returned promise run (see `Op.onDone`).
	 */
	queryThen<R = Record<string, unknown>>(
		sql: string,
		params: readonly unknown[] | undefined,
		options: QueryOptions | undefined,
		onDone: () => void,
		rerunnable = false,
	): Promise<QueryResult<R>> {
		if (this.#config.telemetry === undefined && !this.#config.captureStack)
			return this.#query<R>(sql, params ?? [], options, onDone, rerunnable);
		const result = this.#observe(
			sql,
			options?.tag,
			() => this.#query<R>(sql, params ?? [], options, undefined, rerunnable),
			(r) => r.rowCount,
		);
		result.then(onDone, onDone);
		return result;
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
		onDone?: () => void,
		rerunnable = false,
	): Promise<QueryResult<R>> {
		if (options?.statementTimeout !== undefined) {
			const refused = outsideTransactionOnly(sql);
			if (refused !== undefined) {
				onDone?.();
				return Promise.reject(refused);
			}
			return this.#queryWithTimeout<R>(
				sql,
				params,
				options,
				options.statementTimeout,
				onDone,
			);
		}
		// one shared executor: one closing over this query would cost a
		// closure and its context per query
		const promise = new Promise<QueryResult<unknown>>(capture);
		const resolve = capturedResolve;
		const reject = capturedReject;
		capturedResolve = noop;
		capturedReject = noop;
		let op: QueryOp | undefined;
		try {
			const invalid = invalidSql(sql);
			if (invalid) throw invalid;
			op = new QueryOp(
				sql,
				params,
				encodeParams(sql, params, options?.paramCodecs, options?.paramTypes),
				this.#types(params, options),
				this.#options(options),
				resolve,
				reject,
			);
			op.onTiming = options?.onTiming;
			op.onDone = onDone;
			// `null`: no options, but rerunnable
			if (rerunnable) op.rerunOptions = options ?? null;
			this.#enqueue(op, options?.signal, options?.timeout);
			if (!this.#config.catalog.loaded) this.#loadTypesAfter(params, options);
		} catch (error) {
			// thrown before the operation was queued: nothing else ends it
			if (op === undefined) onDone?.();
			else if (this.#queue.indexOf(op) < 0) this.#finished(op);
			reject(error);
		}
		return asResultPromise<R>(promise);
	}

	/**
	 * @internal Runs statements under one Sync: once one fails, the server
	 * skips the rest, and they reject with its error. One that can't be
	 * sent skips the rest the same way. `signal` cancels the whole group.
	 */
	queryGroup(
		statements: readonly GroupStatement[],
		{ signal }: { readonly signal?: AbortSignal | undefined } = {},
	): Promise<QueryResult<unknown>>[] {
		const results = this.#queryGroup(statements, signal);
		if (this.#config.telemetry === undefined && !this.#config.captureStack)
			return results;
		return results.map((result, i) =>
			this.#observe(
				statements[i]?.sql ?? '',
				statements[i]?.options?.tag,
				() => result,
				(r) => r.rowCount,
			),
		);
	}

	/**
	 * `queryGroup`, with the group's client `timeout`, `onTiming` and
	 * `onDone`. `whole`: a statement that can't be sent fails the whole
	 * group, sending none of it.
	 */
	#queryGroup(
		statements: readonly GroupStatement[],
		signal: AbortSignal | undefined,
		group?: {
			readonly timeout?: number | undefined;
			readonly onTiming?: ((timing: OpTiming) => void) | undefined;
			readonly onDone?: (() => void) | undefined;
			readonly whole?: boolean;
		},
	): Promise<QueryResult<unknown>>[] {
		const ops: QueryOp[] = [];
		let invalid: { error: unknown } | undefined;
		const results = statements.map(
			({ sql, params = [], options }) =>
				new Promise<QueryResult<unknown>>((resolve, reject) => {
					let values;
					if (invalid === undefined) {
						const error = invalidSql(sql);
						if (error) invalid = { error };
						else {
							try {
								values = encodeParams(
									sql,
									params,
									options?.paramCodecs,
									options?.paramTypes,
								);
							} catch (caught) {
								invalid = { error: caught };
							}
						}
					}
					if (invalid !== undefined || values === undefined) {
						reject(invalid?.error);
						return;
					}
					ops.push(
						new QueryOp(
							sql,
							params,
							values,
							this.#types(params, options),
							this.#options(options),
							(result) => resolve(asResult(result)),
							reject,
							// a stale statement can't be retried alone: the ones after it were skipped
							true,
						),
					);
				}),
		);
		if (invalid !== undefined && group?.whole === true) {
			const error =
				invalid.error instanceof Error
					? invalid.error
					: new DriverError(String(invalid.error));
			for (const op of ops) op.fail(error);
			ops.length = 0;
		}
		if (ops.length > 0) {
			const op = new SyncGroupOp(ops);
			op.onTiming = group?.onTiming;
			op.onDone = group?.onDone;
			this.#enqueue(op, signal, group?.timeout);
		} else group?.onDone?.();
		if (!this.#config.catalog.loaded) {
			for (const { params = [], options } of statements)
				this.#loadTypesAfter(params, options);
		}
		return results;
	}

	/**
	 * The query between a statement setting `statement_timeout` and one
	 * restoring it, all under one Sync. Outside a transaction block, the
	 * three run in one implicit transaction, which ends the setting at the
	 * Sync; inside one, the restore ends it. Either way it bounds the query
	 * alone, whatever else is pipelined on the connection, so the framing
	 * can't depend on the transaction status, which only says how the last
	 * answered query left the connection.
	 */
	async #queryWithTimeout<R>(
		sql: string,
		params: readonly unknown[],
		options: QueryOptions,
		statementTimeout: number | string,
		onDone: (() => void) | undefined,
	): Promise<QueryResult<R>> {
		const { statementTimeout: _, signal, timeout, onTiming, ...rest } = options;
		const interval =
			typeof statementTimeout === 'number'
				? `${statementTimeout}ms`
				: statementTimeout;
		const [set, query, restore] = this.#queryGroup(
			[
				{
					sql: STATEMENT_TIMEOUT,
					params: [interval],
					options: STATEMENT_TIMEOUT_OPTIONS,
				},
				{ sql, params, options: rest },
				{
					sql: STATEMENT_TIMEOUT,
					params: [null],
					options: STATEMENT_TIMEOUT_OPTIONS,
				},
			],
			signal,
			// whole: a query that can't be sent mustn't leave the setting behind, in a transaction
			{ timeout, onTiming, onDone, whole: true },
		);
		// a failed set skips the query, which rejects with its error
		set?.catch(() => {});
		restore?.catch(() => {});
		if (query === undefined || restore === undefined)
			throw new ConnectionError('Query did not run');
		const result = await query;
		// outside a transaction block, a failed restore rolled the query back
		await restore;
		return asResult<R>(result);
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
			'rowMode' | 'codecs' | 'signal' | 'timeout' | 'tag'
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
			| Pick<QueryOptions, 'rowMode' | 'codecs' | 'signal' | 'timeout'>
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
				this.#registryOf(options),
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
	 * never sit in memory at once: each batch is fetched once the one
	 * before it is taken. Its columns come in the formats their codecs read
	 * (binary where they can), described first if not cached.
	 *
	 * Outside a transaction, the portal holds the connection until it is
	 * read or closed: other queries on it wait. Inside one, other queries of
	 * the transaction run between its batches. Breaking out early closes
	 * the portal.
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
		const batchSize = options?.batchSize ?? 1000;
		const request = {
			sql,
			params,
			batchSize,
			signal: options?.signal,
			timeout: options?.timeout,
			statementTimeout: options?.statementTimeout,
			open: (
				portal: string,
				held: boolean,
				statementTimeout: string | undefined,
			) => {
				const op = new CursorOp(
					sql,
					params,
					encodeParams(sql, params, options?.paramCodecs, options?.paramTypes),
					this.#types(params, options),
					this.#options(options),
					batchSize,
					portal,
					held,
					statementTimeout,
				);
				if (!this.#config.catalog.loaded) this.#loadTypesAfter(params, options);
				return op;
			},
		};
		const iterate = (): AsyncIterator<R[]> =>
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rows are typed by the caller, as in `asRows`
			new CursorIterator(this.#cursors(), request) as AsyncIterator<R[]>;
		return { [Symbol.asyncIterator]: iterate };
	}

	#cursors(): CursorHost {
		return (this.#cursorHost ??= {
			status: () => this.#status,
			enqueue: (op, signal, timeout) => this.#enqueue(op, signal, timeout),
			abort: (op, reason, cause) => this.#abort(op, reason, cause),
			portal: () => `quarry_${++this.#portalCount}`,
		});
	}

	/** Like `cursor`, one row at a time. */
	stream<R = Record<string, unknown>>(
		sql: string,
		params: readonly unknown[] = [],
		options?: CursorOptions,
	): RowStream<R> {
		return new RowStream(this.cursor<R>(sql, params, options));
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

	#close(): Promise<void> {
		if (this.#closed) return Promise.resolve();
		this.#closing ??= this.#terminate();
		return this.#closing;
	}

	async #terminate(): Promise<void> {
		this.#ending = true;
		await this.idle();
		if (this.#closed) return;
		this.#socket.write(fe.terminate(this.#writer).take());
		// Like libpq, done once the Terminate is sent: waiting for the server
		// to close the socket would wait for its backend to exit (~1.3 ms).
		const sent = this.#socket.end();
		await (sent === undefined
			? this.#closedPromise
			: Promise.race([sent, this.#closedPromise]));
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

	/**
	 * Closes the connection, failing what is queued with `error`. With
	 * `terminated`, the server ended the session before answering anything
	 * written: none of it ran.
	 */
	#fail(error: Error, terminated = false): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#failure = error;
		this.#socket.destroy();
		this.#startupError?.(error);
		const ops = this.#queue.drain();
		this.#written = 0;
		const rerun = this.rerun;
		for (const op of ops) {
			if (
				rerun !== undefined &&
				op instanceof QueryOp &&
				op.rerunOptions !== undefined &&
				(terminated || !op.written)
			) {
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- set from the query's own options
				const options = (op.rerunOptions ?? undefined) as
					| QueryOptions
					| undefined;
				op.redirect((resolve, reject) =>
					rerun(op.sql, op.params, options, resolve, reject),
				);
			} else op.fail(error);
		}
		for (const resolve of this.#idleWaiters.splice(0)) resolve();
		for (const resolve of this.#drainWaiters.splice(0)) resolve();
		this.#resolveClosed();
		this.#emit(this.#closeListeners, error);
		for (const op of ops) this.#finished(op);
	}
}

/**
 * Which cached statements to write named. A pooler that rewrites named
 * statements (PgBouncer) flushes what it holds and writes the new name
 * apart from the rest of every named Bind: each named query reaches the
 * server in two writes, where unnamed ones share one. Under load that costs
 * the single-threaded pooler more than parsing them again costs the server.
 */
function naming(
	names: StatementNames,
	preparePipelined: boolean | undefined,
): 'always' | 'alone' | 'never' {
	if (names === 'unsupported') return 'never';
	return (preparePipelined ?? names === 'kept') ? 'always' : 'alone';
}

const noop = () => {};

/**
 * SQLSTATEs of a server ending the session on its own: an administrator
 * (`pg_terminate_backend`) or a shutdown, another backend's crash, a server
 * starting or stopping, `idle_session_timeout`.
 */
const TERMINATED: ReadonlySet<string> = new Set([
	'57P01',
	'57P02',
	'57P03',
	'57P05',
]);

/**
 * The resolving functions of the promise `capture` just executed for. Reset
 * as soon as they're read: a resolving function keeps its promise, and so
 * the settled result, reachable for as long as it is.
 */
let capturedResolve: (result: QueryResult<unknown>) => void = noop;
let capturedReject: (error: unknown) => void = noop;
const capture = (
	resolve: (result: QueryResult<unknown>) => void,
	reject: (error: unknown) => void,
) => {
	capturedResolve = resolve;
	capturedReject = reject;
};

/** Registries of the codec lists queries name, made once per list. */
const listRegistries = new WeakMap<readonly Codec[], CodecRegistry>();

/** The statement cache's key: the SQL, prefixed with the parameter types declared. */
function statementKey(sql: string, types: readonly number[]): string {
	return types.length === 0 ? sql : `${types.join(',')}\0${sql}`;
}

/** The cache key of `sql` with types other than its first statement's: never a SQL text, which has no NUL. */
function variantKey(sql: string, types: readonly number[]): string {
	return `${types.join(',')}\0${sql}`;
}

function sameTypes(a: readonly number[], b: readonly number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
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

/**
 * Statements PostgreSQL refuses inside a transaction block, by their first
 * words (after comments): a `statementTimeout` frames its query in one.
 */
const TRANSACTION_REFUSED =
	/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(vacuum|create\s+database|drop\s+database|alter\s+system|create\s+tablespace|drop\s+tablespace|(?:create\s+(?:unique\s+)?|drop\s+)index\s+concurrently|reindex\s+(?:\([^)]*\)\s*)?(?:system|database)|reindex\b[^;]*?\bconcurrently|cluster\s*(?:\([^)]*\)\s*)?(?:;|$)|discard\s+all|(?:commit|rollback)\s+prepared|(?:create|drop)\s+subscription|alter\s+subscription\s+\S+\s+(?:refresh|enable|disable)|alter\s+database\s+\S+\s+set\s+tablespace)\b/i;

/** Why `sql` can't take a `statementTimeout`, if it can't. */
function outsideTransactionOnly(sql: string): DriverError | undefined {
	const match = TRANSACTION_REFUSED.exec(sql);
	if (match === null) return undefined;
	const statement = (match[1] ?? '').replace(/\s+/g, ' ').toLowerCase();
	return new DriverError(
		`A statementTimeout can't bound ${statement}: it runs only outside a transaction block, and the timeout is set and restored in one around its query. Use a client-side timeout, or set statement_timeout on the session first`,
	);
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
