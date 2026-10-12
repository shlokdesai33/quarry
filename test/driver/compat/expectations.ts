// Why upstream tests that don't pass against quarry's driver are allowed to
// fail. Every entry names a category and a reason; the runner fails on any
// failure without an entry and on any entry whose test now passes.
//
// - intentional: quarry deliberately behaves differently (documented).
// - not-applicable: the test exercises the upstream library's own API or
//   internals (option and event names, message text, callback signatures,
//   its Connection class, pg-native, replication), not driver behaviour.
// - shim: the behaviour is quarry's to match, but the thin shim can't
//   express the scenario (the test reaches into pg's Connection); it is
//   covered by the quarry-native test named in the reason instead.
//
// `fixed` marks tests that failed because of a driver bug fixed here; they
// pass now, and the runner counts them.

export type Category = 'intentional' | 'not-applicable' | 'shim';

export interface Expectation {
	readonly category?: Category;
	readonly reason: string;
	/** The driver bug this test found, fixed in this change (it passes now). */
	readonly fixed?: string;
	/** Passes or fails by timing; don't flag either outcome. */
	readonly flaky?: boolean;
	/** Only through PgBouncer (or only directly). */
	readonly target?: 'bouncer' | 'direct';
	/** Matched a whole file (`*`): its tests that pass aren't flagged. */
	readonly wildcard?: boolean;
}

type Table = Record<string, Record<string, Expectation>>;

const GRACEFUL_CLOSE: Expectation = {
	category: 'intentional',
	reason:
		'close() is graceful: queries already issued finish before the connection closes (destroy() closes at once); pg ends the socket under a running query',
};
const UNDEFINED_REFUSED: Expectation = {
	category: 'intentional',
	reason:
		'undefined parameters are refused (UndefinedParameterError) rather than sent as NULL; pass null',
};
const NO_MAX_USES: Expectation = {
	category: 'intentional',
	reason: 'quarry has no maxUses; maxLifetime recycles connections instead',
};
const QUERY_ERRORS_KEEP_CONNECTIONS: Expectation = {
	category: 'intentional',
	reason:
		'a query error does not discard its connection (pg-pool destroys a client released with an error from pool.query); the session is still sound',
};
const PG_CONNECTION_INTERNALS = (covered: string): Expectation => ({
	category: 'shim',
	reason: `reaches into pg's Connection (client.connection, its stream or events); covered by ${covered}`,
});
const MOCK_CLIENT: Expectation = {
	category: 'not-applicable',
	reason: "replaces pg-pool's Client class with a mock (the Client option)",
};
const PIPELINE_MODE: Expectation = {
	category: 'not-applicable',
	reason:
		"pg's opt-in pipeline mode refuses portal queries; quarry always pipelines and runs portals exclusively, so it accepts them (integration/streaming.test.ts: queues other queries behind an open cursor)",
};
const HANGS_AFTER_FAILURE: Expectation = {
	category: 'not-applicable',
	reason:
		'the file ends abnormally (it hangs, or a late callback throws) only because of a failed test listed here, which leaves a client or query behind; every test in it has its own outcome',
};
const PROTOCOL_LAYOUT: Expectation = {
	category: 'not-applicable',
	reason:
		'compares bytes with the format-code layout pg chose; quarry sends no per-parameter format codes when every value is text, and no result-format code for all-text, which the protocol defines as equivalent (values are byte-identical)',
};
const NO_REPLICATION: Expectation = {
	category: 'intentional',
	reason: 'logical replication (the replication protocol) is out of scope',
};

const expectations: Record<string, Table> = {
	pg: {
		'test/integration/client/api-tests.js': {
			'null and undefined are both inserted as NULL': UNDEFINED_REFUSED,
			'raises error if cannot connect': {
				category: 'intentional',
				reason:
					"connection strings follow libpq, which takes only postgres:// and postgresql:// URIs, and a malformed one throws when the pool is created instead of at connect (here 'pg://…')",
			},
			'(file)': HANGS_AFTER_FAILURE,
		},
		'test/integration/client/async-stack-trace-tests.js': {
			'promise API async stack trace in pool': {
				category: 'shim',
				reason:
					"the pool shim settles pg's promise from a callback, which cuts V8's async stack; quarry's own pool.query keeps the caller's frames (integration/compat.test.ts: keeps the caller's async frames in a pooled query's error)",
			},
		},
		'test/integration/client/error-handling-tests.js': {
			'query receives error on client shutdown': GRACEFUL_CLOSE,
			'connected, idle client error': PG_CONNECTION_INTERNALS(
				'integration/pool.test.ts: replaces connections that die while idle (the test emits an error on client.connection)',
			),
			'(file)': HANGS_AFTER_FAILURE,
		},
		'test/integration/client/pipeline-portal-tests.js': {
			'rejects a custom query class': PIPELINE_MODE,
			'rejects the rows option': PIPELINE_MODE,
			'(file)': HANGS_AFTER_FAILURE,
		},
		'test/integration/client/pipelining-tests.js': {
			'query_timeout on sent pipelined query destroys connection to unblock': {
				category: 'intentional',
				reason:
					"a client-side timeout cancels the query on the server and keeps the connection; pg's query_timeout abandons the query and, in pipeline mode, destroys the connection",
			},
			'(file)': HANGS_AFTER_FAILURE,
		},
		'test/integration/client/query-error-handling-prepared-statement-tests.js':
			{
				'client end during query execution of prepared statement':
					GRACEFUL_CLOSE,
			},
		'test/integration/client/sasl-scram-tests.js': {
			'can connect using sasl/scram with channel binding enabled (if using SSL)':
				PG_CONNECTION_INTERNALS(
					'integration/connect.test.ts: SCRAM-SHA-256-PLUS with channel binding over TLS',
				),
			'can connect using sasl/scram with channel binding disabled':
				PG_CONNECTION_INTERNALS(
					'integration/connect.test.ts: SCRAM-SHA-256-PLUS with channel binding over TLS, channel_binding=require refuses connections that cannot bind',
				),
			'sasl/scram fails when password is wrong': PG_CONNECTION_INTERNALS(
				'integration/connect.test.ts: rejects a wrong password with a typed error',
			),
			'sasl/scram fails when password is empty': PG_CONNECTION_INTERNALS(
				'integration/connect.test.ts: rejects a wrong password with a typed error',
			),
			'sasl/scram authenticates a password requiring SASLprep (raw form)':
				PG_CONNECTION_INTERNALS(
					'integration/connect.test.ts: SCRAM-SHA-256 with a non-ASCII password (SASLprep), whose password normalizes differently under NFKC',
				),
			'sasl/scram fails when unicode password is wrong':
				PG_CONNECTION_INTERNALS(
					'integration/connect.test.ts: rejects a wrong password with a typed error',
				),
		},
		'test/integration/client/ssl-tests.js': {
			'can connect with direct SSL negotiation': PG_CONNECTION_INTERNALS(
				'integration/connect.test.ts: direct TLS (sslnegotiation=direct); the connection and query here pass, only the ALPN check on pg’s socket cannot run',
			),
			'(file)': HANGS_AFTER_FAILURE,
		},
		'test/integration/client/timezone-tests.js': {
			'timestamp without time zone': {
				category: 'intentional',
				reason:
					"Dates are sent as UTC timestamps, so a timestamp without time zone receives the UTC wall-clock time whatever the process's TZ; pg sends the local time",
			},
		},
		'test/integration/client/type-parser-override-tests.js': {
			'(file)': {
				reason:
					'calls pool.end() while a client is checked out with queries to run',
				fixed: 'B1',
			},
		},
		'test/integration/connection-pool/error-tests.js': {
			'handles socket error during pool.query and destroys it immediately':
				PG_CONNECTION_INTERNALS(
					'integration/compat.test.ts: fails a pooled query whose connection dies, then carries on (the test emits an error on pool._clients[0].connection.stream)',
				),
			'(file)': HANGS_AFTER_FAILURE,
			'connection-level errors cause queued queries to fail': {
				category: 'intentional',
				reason:
					'queries queued behind a FATAL error fail with the server’s error (57P01 terminating connection due to administrator command) rather than a generic "Connection terminated unexpectedly"',
			},
		},
		'test/integration/gh-issues/1382-tests.js': {
			'calling end during active query should return a promise': GRACEFUL_CLOSE,
			'calling end during an active query should call end callback':
				GRACEFUL_CLOSE,
		},
		'test/integration/gh-issues/2627-tests.js': {
			'client should fail to connect': {
				category: 'not-applicable',
				reason:
					"the connection to a non-Postgres server fails as it should; the test matches pg-protocol's message text ('invalid response')",
			},
			'(file)': HANGS_AFTER_FAILURE,
		},
		'test/integration/gh-issues/3772-tests.js': {
			'a real extended-protocol query does not mark the connection as ending':
				PG_CONNECTION_INTERNALS(
					'the driver’s own pipelining tests (integration/query.test.ts)',
				),
			'(file)': HANGS_AFTER_FAILURE,
		},
		'test/integration/gh-issues/699-tests.js': {
			'(file)': PG_CONNECTION_INTERNALS(
				'integration/compat.test.ts: COPY, as pg-copy-streams tests it (pg-copy-streams is a submittable that drives pg’s Connection)',
			),
		},
	},
	'pg-pool': {
		'test/connection-timeout.js': {
			'connection timeout continues processing after a connection failure':
				MOCK_CLIENT,
			'connection timeout releases newly connected clients if the queued already timed out':
				MOCK_CLIENT,
			'connection timeout should connect if timeout is passed, but native client in connected state':
				{
					category: 'not-applicable',
					reason: 'needs pg-native',
				},
			'connection timeout "after all" hook for "should connect if timeout is passed, but native client in connected state"':
				{
					category: 'not-applicable',
					reason: 'fails because the pg-native test before it could not run',
				},
		},
		'test/ending.js': {
			'pool ending allows client to finish': {
				reason: 'pool.end() right after pool.query()',
				fixed: 'B1',
			},
			'pool ending pool.end() - finish pending queries': {
				reason: 'pool.end() with 20 queries waiting',
				fixed: 'B1',
			},
		},
		'test/error-handling.js': {
			'pool error handling should continue with queued items after a connection failure':
				{
					reason: 'two callers waiting while connecting fails',
					fixed: 'B3',
				},
			'pool error handling handles post-checkout client failures in pool.query':
				PG_CONNECTION_INTERNALS(
					'integration/compat.test.ts: fails a pooled query whose connection dies, then carries on (the test ends pool._clients[0])',
				),
			'pool error handling pool with lots of errors continues to work and provide new clients':
				QUERY_ERRORS_KEEP_CONNECTIONS,
		},
		'test/events.js': {
			'events emits "connect" only with a successful connection': MOCK_CLIENT,
			'events emits acquire every time a client is acquired': {
				category: 'not-applicable',
				reason:
					"counts acquire events from pool.query too; quarry's pool.query runs on (or pipelines onto) a connection without checking a client out",
			},
			'events emits release every time a client is released': {
				category: 'not-applicable',
				reason:
					"counts release events from pool.query too; quarry's pool.query runs on (or pipelines onto) a connection without checking a client out",
			},
		},
		'test/lifetime-timeout.js': {
			'lifetime timeout connection lifetime should expire and remove the client':
				{
					reason: 'an idle connection past maxLifetime',
					fixed: 'B2',
				},
		},
		'test/idle-timeout.js': {
			'idle timeout unrefs the connections and timeouts so the program can exit when idle when the allowExitOnIdle option is set':
				{
					category: 'intentional',
					reason:
						'quarry has no allowExitOnIdle: idle connections keep the process alive until idleTimeout closes them (call end() to exit sooner)',
				},
		},
		'test/index.js': {
			'pool with callbacks passes props to clients': {
				category: 'not-applicable',
				reason: "pg's binary option",
			},
			'pool with callbacks does not pass client to error callback': {
				category: 'not-applicable',
				reason:
					"pg-pool's callback signature (a release function alongside the error)",
			},
			'pool with callbacks removes client if it errors in background':
				PG_CONNECTION_INTERNALS(
					'integration/pool.test.ts: replaces connections that die while idle (the pool error event itself passes in events.js)',
				),
			'pool with promises enables pipeline on clients when configured': {
				category: 'not-applicable',
				reason: "pg's pipeline client option; quarry always pipelines",
			},
			'pool with promises does not enable pipeline by default': {
				category: 'not-applicable',
				reason: "pg's pipeline client option; quarry always pipelines",
			},
			'pool with promises recovers from query errors':
				QUERY_ERRORS_KEEP_CONNECTIONS,
		},
		'test/logging.js': {
			'logging logs to supplied log function if given': {
				category: 'not-applicable',
				reason: "pg-pool's log option",
			},
		},
		'test/max-uses.js': {
			'maxUses getting a connection a second time returns the same connection and releasing it also closes it':
				NO_MAX_USES,
			'maxUses getting a connection a third time returns a new connection':
				NO_MAX_USES,
			'maxUses getting a connection from a pending request gets a fresh client when the released candidate is expended':
				NO_MAX_USES,
			'maxUses logs when removing an expended client': NO_MAX_USES,
		},
		'test/releasing-clients.js': {
			'releasing clients removes a client which cannot be queried':
				PG_CONNECTION_INTERNALS(
					'integration/pool.test.ts: replaces connections that die while idle (a released connection that is closed is never reused)',
				),
		},
		'test/sizing.js': {
			'pool size of 1 does remove clients when at or below min if maxUses is reached':
				NO_MAX_USES,
			'pool size of 1 does remove clients when at or below min if maxLifetimeSeconds is reached':
				{
					category: 'intentional',
					reason:
						"quarry's min keeps that many connections open, replacing expired ones at once (integration/pool.test.ts: recycles idle connections when their lifetime ends, even at min); pg-pool's min only stops idle reaping",
				},
		},
	},
	'pg-cursor': {
		'test/close.js': {
			'close keeps the client usable after closing before the first response':
				PG_CONNECTION_INTERNALS(
					'integration/compat.test.ts: keeps a connection usable after a cursor closed before its first response',
				),
		},
		'test/index.js': {
			'cursor returns rowCount on insert': {
				category: 'intentional',
				reason:
					"quarry's cursor() yields row batches only, without the command tag; query() reports rowCount",
			},
		},
		'test/late-messages.js': {
			'*': {
				category: 'not-applicable',
				reason:
					"feeds protocol messages to pg-cursor's own handlers on a fake connection",
			},
		},
	},
	'pg-query-stream': {},
	'pg-protocol': {
		'dist/inbound-parser.test.js': {
			'PgPacketStream cleans up the reader after handling a packet': {
				category: 'not-applicable',
				reason: "inspects pg-protocol's Parser buffer",
			},
			'PgPacketStream parses replication start message receives and parses replicationStart':
				NO_REPLICATION,
		},
		'dist/outbound-serializer.test.js': {
			'serializer with custom valueMapper': PROTOCOL_LAYOUT,
			'serializer with named statement, portal, and buffer value':
				PROTOCOL_LAYOUT,
			'serializer bind messages with no values': PROTOCOL_LAYOUT,
			'serializer bind messages with named statement, portal, and values':
				PROTOCOL_LAYOUT,
			'serializer bind messages encodes a multi-byte string param with its UTF-8 byte length, not char length':
				PROTOCOL_LAYOUT,
			'serializer bind error recovery produces correct bind output after a valueMapper exception':
				PROTOCOL_LAYOUT,
		},
	},
	postgres: {
		'tests/index.js': {
			'Throws on illegal transactions': {
				category: 'not-applicable',
				reason:
					"postgres.js's UNSAFE_TRANSACTION guard; quarry discards a pooled connection released mid-transaction instead",
			},
			'Ensure reserve on connection throws proper error': {
				category: 'not-applicable',
				reason:
					'a non-Error thrown by the socket option is wrapped in an Error',
			},
			'listen reconnects': {
				category: 'intentional',
				reason:
					'pool.listen re-subscribes after reconnecting without reporting it or exposing the listening backend (integration/pool.test.ts: listens on a dedicated connection and re-subscribes after it drops)',
			},
			'listen result reports correct connection state after reconnection': {
				category: 'intentional',
				reason:
					'pool.listen does not expose the listening backend (its pid), so the test cannot terminate it',
			},
			'requests works after single connect_timeout': {
				category: 'not-applicable',
				reason:
					'changes connect_timeout between attempts through valueOf(); quarry reads its options once (through PgBouncer the first connection can beat the 0.1 ms timeout, so it passes there)',
				flaky: true,
			},
			'Catches connection config errors': {
				category: 'not-applicable',
				reason:
					'postgres.js coerces options to strings (a user whose toString throws); quarry takes typed options',
			},
			'Catches connection config errors with end': {
				category: 'not-applicable',
				reason:
					'postgres.js coerces options to strings (a user whose toString throws); quarry takes typed options',
			},
			connect_timeout: {
				category: 'not-applicable',
				reason:
					'timing: the 200 ms connect timeout fires at 199–202 ms, and the test truncates the elapsed time to tenths of a second',
				flaky: true,
			},
			'Multiple hosts': {
				category: 'not-applicable',
				reason: 'needs a second server on port 5433 (their CI runs two)',
			},
			subscribe: NO_REPLICATION,
			'subscribe with transform': NO_REPLICATION,
			'subscribe reconnects and calls onsubscribe': NO_REPLICATION,
			'Catches type serialize errors': {
				category: 'intentional',
				reason:
					'postgres.js serializes parameters by the type the server infers (it describes each new statement first); quarry encodes values by their JavaScript type, without that round trip',
			},
			'Catches type serialize errors in transactions': {
				category: 'intentional',
				reason:
					'postgres.js serializes parameters by the type the server infers (it describes each new statement first); quarry encodes values by their JavaScript type, without that round trip',
			},
			'Ensure transactions throw if connection is closed dwhile there is no query':
				{
					category: 'intentional',
					reason:
						'a transaction learns that its connection closed at its next statement; postgres.js rejects begin() as soon as the connection closes (here the next statement uses the ended root sql, hence CONNECTION_ENDED)',
				},
			'query during copy error': {
				category: 'intentional',
				reason:
					'a query issued during COPY waits for it instead of failing with COPY_IN_PROGRESS (with max: 1 it waits for the COPY that the test only ends afterwards)',
			},
			'big query body': {
				reason: '50 000 parameters',
				fixed: 'B6',
			},
			'Cancel piped query': {
				reason: 'cancels a query pipelined behind another',
				fixed: 'B5',
			},
			'Recreate prepared statements on transformAssignedExpr error': {
				reason: 'a cached INSERT after the column type changed',
				fixed: 'B7',
			},
			'Point type array': {
				reason:
					'through PgBouncer, re-preparing after the table changed hit PgBouncer’s stale statement',
				fixed: 'B10',
				target: 'bouncer',
			},
			'Catches query format errors': {
				reason: 'SQL that is not a string',
				fixed: 'B4',
			},
		},
	},
};

/**
 * Tests that pass directly but not through PgBouncer in transaction mode,
 * because of what a transaction pooler is: each transaction may run on a
 * different server connection, and PgBouncer (as configured here, as most
 * deployments do) authenticates clients itself, without TLS, and ignores
 * startup parameters.
 */
const SESSION_STATE: Expectation = {
	category: 'not-applicable',
	reason:
		'relies on session state across transactions (temporary tables, SET, LISTEN), which transaction pooling does not keep',
	target: 'bouncer',
};
const POOLER_AUTH: Expectation = {
	category: 'not-applicable',
	reason:
		'PgBouncer authenticates clients itself (trust here), so server authentication is not exercised',
	target: 'bouncer',
};
const POOLER_TLS: Expectation = {
	category: 'not-applicable',
	reason: 'PgBouncer here accepts clients without TLS',
	target: 'bouncer',
};
const STARTUP_PARAMETERS: Expectation = {
	category: 'not-applicable',
	reason:
		'PgBouncer ignores startup parameters (options, statement_timeout, …)',
	target: 'bouncer',
};
const BACKEND_PID: Expectation = {
	category: 'not-applicable',
	reason:
		"terminates the backend by the client's process ID, which through PgBouncer is PgBouncer's own, not a server backend's",
	target: 'bouncer',
};

const throughBouncer: Record<string, Table> = {
	pg: {
		'test/integration/client/big-simple-query-tests.js': { '*': SESSION_STATE },
		'test/integration/client/connection-parameter-tests.js': {
			'*': STARTUP_PARAMETERS,
		},
		'test/integration/client/error-handling-tests.js': { '*': SESSION_STATE },
		'test/integration/client/idle_in_transaction_session_timeout-tests.js': {
			'*': STARTUP_PARAMETERS,
		},
		'test/integration/client/no-data-tests.js': { '*': SESSION_STATE },
		'test/integration/client/notice-tests.js': { '*': SESSION_STATE },
		'test/integration/client/prepared-statement-tests.js': {
			'*': SESSION_STATE,
		},
		'test/integration/client/sasl-scram-tests.js': { '*': POOLER_AUTH },
		'test/integration/client/simple-query-tests.js': { '*': SESSION_STATE },
		'test/integration/client/ssl-tests.js': { '*': POOLER_TLS },
		'test/integration/client/statement_timeout-tests.js': {
			'*': STARTUP_PARAMETERS,
		},
		'test/integration/client/transaction-tests.js': { '*': SESSION_STATE },
		'test/integration/client/type-coercion-tests.js': { '*': SESSION_STATE },
		'test/integration/client/type-parser-override-tests.js': {
			'*': SESSION_STATE,
		},
		'test/integration/connection-pool/error-tests.js': { '*': BACKEND_PID },
		'test/integration/gh-issues/130-tests.js': { '*': BACKEND_PID },
		'test/integration/gh-issues/2085-tests.js': { '*': POOLER_TLS },
		'test/integration/gh-issues/2862-tests.js': { '*': SESSION_STATE },
	},
	postgres: {
		'tests/index.js': {
			'Connect using SSL': POOLER_TLS,
			'Connect using SSL require': POOLER_TLS,
			'Connect using SSL direct': POOLER_TLS,
			'Reconnect using SSL': POOLER_TLS,
			'listen and notify': SESSION_STATE,
			'double listen': SESSION_STATE,
			'multiple listeners work after a reconnect': SESSION_STATE,
			'listen and notify with weird name': SESSION_STATE,
			'listen and notify with upper case': SESSION_STATE,
			'unlisten removes subscription': SESSION_STATE,
			'listen after unlisten': SESSION_STATE,
			'multiple listeners and unlisten one': SESSION_STATE,
			'connection parameters': STARTUP_PARAMETERS,
			'throws correct error when authentication fails': POOLER_AUTH,
			'Unix socket': {
				category: 'not-applicable',
				reason: 'PgBouncer here listens on TCP only',
				target: 'bouncer',
			},
			'Connection destroyed': {
				category: 'not-applicable',
				reason:
					'timing: races an empty query against end({ timeout: 0 }) on the next tick, which a local PgBouncer can answer first',
				target: 'bouncer',
				flaky: true,
			},
		},
	},
};

/** Files not run at all, with why: their whole subject is the upstream library's own machinery. */
export const skippedFiles: Record<string, Record<string, string>> = {};

export function notRun(suite: string, file: string): boolean {
	return skippedFiles[suite]?.[file] !== undefined;
}

/**
 * Errors that only arise when session state (a temporary table, a
 * prepared name) leaks between transactions a pooler ran on different
 * server connections. Which connection a transaction gets varies, so
 * through PgBouncer such a test can pass or fail from run to run.
 */
const SESSION_STATE_SYMPTOM =
	/(relation|column|prepared statement) "[^"]+" (already exists|does not exist)/;

export function classify(
	suite: string,
	file: string,
	name: string,
	target: string,
	error?: string,
): Expectation | undefined {
	const bouncer = target.startsWith('PgBouncer');
	const lookup = (
		table: Record<string, Expectation> | undefined,
	): Expectation | undefined => {
		const exact = table?.[name];
		if (exact !== undefined) return exact;
		const any = table?.['*'];
		return any === undefined ? undefined : { ...any, wildcard: true };
	};
	const found = lookup(expectations[suite]?.[file]);
	const applies =
		found !== undefined && !(found.target === 'bouncer' && !bouncer);
	if (!bouncer) return applies ? found : undefined;
	// a bug fixed here records no category: through PgBouncer the pooler's reason may still apply
	if (applies && found.category !== undefined) return found;
	const pooled = lookup(throughBouncer[suite]?.[file]);
	if (pooled !== undefined)
		return applies
			? {
					...pooled,
					...(found.fixed === undefined ? {} : { fixed: found.fixed }),
				}
			: pooled;
	if (applies) return found;
	return error !== undefined && SESSION_STATE_SYMPTOM.test(error)
		? { ...SESSION_STATE, flaky: true, wildcard: true }
		: undefined;
}

/** Every expectation, for the report. */
export function allExpectations(): readonly {
	suite: string;
	file: string;
	name: string;
	expectation: Expectation;
}[] {
	return Object.entries(expectations).flatMap(([suite, files]) =>
		Object.entries(files).flatMap(([file, tests]) =>
			Object.entries(tests).map(([name, expectation]) => ({
				suite,
				file,
				name,
				expectation,
			})),
		),
	);
}
