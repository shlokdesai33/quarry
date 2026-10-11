export { connect, openConnection } from './connect.js';
export {
	parseConnectionString,
	resolveConfig,
	type ConnectionOptions,
	type HostTarget,
	type PasswordSource,
	type ResolvedConfig,
	type SslMode,
	type SslOptions,
	type TargetSessionAttrs,
} from './config.js';
export {
	Connection,
	quoteIdentifier,
	type CursorOptions,
	type QueryOptions,
} from './connection.js';
export * from './errors.js';
export type { Notice, Notification } from './notice.js';
export type { Description, OpTiming, QueryResult } from './ops.js';
export type { Field } from './protocol/messages.js';
export type { RowMode } from './rows.js';
export type {
	DriverSocket,
	SocketConnectOptions,
	SocketFactory,
	SocketTarget,
	TlsConnectOptions,
} from './socket.js';
export { nodeSockets } from './node-socket.js';
export {
	arrayLiteral,
	copyChunks,
	copyLine,
	defaultTypes,
	encodeParam,
	formatTimestamp,
	oids,
	parseArray,
	parseBytea,
	rawTypes,
	type TextParser,
	type TypeParsers,
} from './types.js';
export {
	createPool,
	Pool,
	PoolClient,
	type PoolOptions,
	type PoolStats,
} from './pool.js';
export {
	Transaction,
	TransactionRolledBack,
	type IsolationLevel,
	type SettingValue,
	type TransactionOptions,
} from './transaction.js';
export {
	executorTypes,
	PgExecutor,
	pgExecutor,
	type ExecutorSource,
	type PgExecutorOptions,
	type QueryEvent,
} from './quarry.js';
export {
	parseRange,
	parseTimestamptz,
	parseVector,
	quarryTypes,
} from './quarry-types.js';
export { OAuthError, type OAuthFailure } from './auth/oauth.js';
export {
	detectCapabilities,
	parseServerVersion,
	type Capabilities,
} from './capabilities.js';
export type { AuthMethod, OAuthContext, ProtocolVersion } from './config.js';
export { LATEST_PROTOCOL_MINOR } from './protocol/frontend.js';
export type { SpanLike, TelemetryOptions, TracerLike } from './telemetry.js';
