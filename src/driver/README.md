# quarry's PostgreSQL driver

A PostgreSQL driver with no runtime dependencies, written for quarry but usable on its own. It speaks the wire protocol directly (3.2 with fallback to 3.0), over Node's `net`/`tls` by default, behind a small socket interface for other runtimes.

PostgreSQL 18 is the tested version; others work on a best-effort basis through feature detection (`connection.capabilities`).

## Connecting

```ts
import { connect, createPool } from 'quarry/driver';

await using conn = await connect('postgres://app@db.internal/app');
const pool = createPool({
	connectionString: process.env.DATABASE_URL,
	max: 20,
});
```

Options come from the argument, then the connection string (URL or `key=value`), then `PG*` environment variables, then `.pgpass`. They follow libpq: `host` (comma-separated for failover, or a Unix-socket directory), `port`, `user`, `password`, `database`, `applicationName`, `targetSessionAttrs`, `connectTimeout` (30 s by default), `params` (startup settings such as `search_path`), `options`.

### TLS

`ssl` takes libpq's `sslmode` values. The default is **`verify-full` for remote hosts** and `prefer` for localhost and Unix sockets.

```ts
connect({ host: 'db.example.com', ssl: { mode: 'verify-full', ca: pem } });
connect({
	host: 'db.example.com',
	ssl: { mode: 'require', negotiation: 'direct' },
}); // PG 17+, no SSLRequest round trip
connect({
	host: 'db.example.com',
	ssl: { mode: 'verify-full', rootCertFile: 'system' },
});
```

Verify modes use `ca`, `rootCertFile`, `~/.postgresql/root.crt`, or the platform's CA store, in that order.

### Authentication

- **Passwords:** SCRAM-SHA-256 (with `tls-server-end-point` channel binding over TLS), md5 and cleartext. `password` can be a function, called for every new connection; use this for short-lived cloud IAM tokens.
- **`requireAuth`:** refuses methods the server shouldn't ask for, e.g. `'scram-sha-256'` or `'!password,!md5,!none'`. `channelBinding: 'require'` insists on SCRAM-SHA-256-PLUS.
- **Client certificates** (`cert` auth): `ssl: { cert, key }` (PEM) or `certFile`/`keyFile`, with `passphrase` for encrypted keys. Also `sslcert`/`sslkey`/`sslpassword`, `PGSSLCERT`/`PGSSLKEY`, or `~/.postgresql/postgresql.crt`/`.key`.
- **OAuth** (PG 18 `OAUTHBEARER`): `oauthToken: (ctx) => token` supplies a bearer token. A rejection throws `OAuthError` with the server's `status`, `scope` and `openidConfiguration`. The driver doesn't run login flows.
- **Not supported:** GSSAPI, SSPI and Kerberos.

## Queries

```ts
const { rows, rowCount, command, fields } = await conn.query(
	'select * from users where id = $1',
	[id],
);
await conn.query(sql, params, {
	rowMode: 'array',
	signal,
	timeout: 5000,
	statementTimeout: '2s',
});
const results = await conn.simpleQuery('select 1; select 2'); // multi-statement, no parameters
const { paramTypes, fields } = await conn.describe(sql); // without running it
```

Parameters:

- Strings pass through unchanged; quarry encodes values itself.
- Numbers, bigints, booleans and `Date`s become their Postgres text.
- Arrays become array literals and other objects JSON.
- `Uint8Array` is sent in binary.

Queries issued concurrently on one connection are pipelined into shared socket writes. Each still gets its own Sync, so one failing query doesn't fail its neighbours (outside a transaction).

Statements are prepared and cached per connection (100 by default; `statementCacheSize`, `prepare: false`). This is safe behind PgBouncer 1.21+ with `max_prepared_statements`.

### Decoding

Results arrive in text format and are decoded per type OID:

- **`defaultTypes`** (the default, lossless): int2/int4/float become numbers, int8 a `bigint`, bool, json/jsonb parsed, bytea a `Uint8Array`, and arrays of those. numeric, dates and times stay as text.
- **`rawTypes`**: every value is the server's text.
- **Your own**: any `Record<oid, (text) => value>`.

### Cancelling and timeouts

- `signal` cancels a running query (a cancel request over a new connection), or drops one not yet sent.
- `timeout` is a client-side deadline that cancels.
- `statementTimeout` is enforced by the server, with `set_config(…, true)`, so it never leaks into other sessions behind a pooler.
- `conn.cancel()` cancels whatever is running.

Canceled queries throw `QueryCanceled`, whose `reason` is `'abort'`, `'timeout'`, `'statement_timeout'` or `'user'`.

### Streaming, COPY, notifications

```ts
for await (const batch of conn.cursor(sql, params, { batchSize: 1000 })) { … }
for await (const row of pool.stream(sql, params)) { … }
await conn.copyFrom('copy items from stdin', asyncIterableOfChunks);
for await (const chunk of conn.copyTo('copy items to stdout')) { … }
const unlisten = await pool.listen('events', (n) => …); // dedicated connection, re-subscribes after reconnecting
```

## Transactions

```ts
await pool.transaction(async (tx) => {
	await tx.query('insert …');
	await tx.transaction(async (sp) => { … }); // savepoint
	tx.afterCommit(() => queue.publish(…));
}, { isolation: 'serializable', retries: 3, settings: { 'app.tenant_id': tenant } });
```

- Retries cover serialization failures and deadlocks only.
- `settings` are applied with bound parameters.
- A COMMIT that the server turned into a ROLLBACK (because an error was swallowed inside) throws `TransactionRolledBack`.

## Pool

`createPool` takes these options:

- `max`, `min`
- `idleTimeout` (30 s), `maxLifetime` (1 h, with jitter)
- `acquireTimeout` (30 s), `maxWaiting`
- `onConnect`

`pool.acquire()` reserves a client; release it with `release()` or `await using`. Connections that die, or are released mid-transaction, are discarded.

## Errors

- Server errors are `PostgresError`s carrying every field the server sent, plus `query` (non-enumerable, so parameters don't leak into logs).
- Common SQLSTATEs have their own classes: `UniqueViolation`, `ForeignKeyViolation`, `NotNullViolation`, `CheckViolation`, `ExclusionViolation` (with `columns`), `SerializationFailure`, `DeadlockDetected` (`isRetryable`), `QueryCanceled`, `LockNotAvailable`, `ReadOnlyTransaction`, `UndefinedTable`, `UndefinedColumn`.
- Client-side failures are `ConnectionError`, `ProtocolError`, `AbortError` or `OAuthError`.

## With quarry

```ts
import { database } from 'quarry';
import { createPool, pgExecutor } from 'quarry/driver';

const executor = pgExecutor(createPool(process.env.DATABASE_URL), {
	onQuery: (e) => log(e),
});
const db = database(executor);
await executor.transaction(async (tx) =>
	database(tx).selectFrom(users).where('users.id', id).one(),
);
database(executor.with({ signal: request.signal, timeout: '2s' }));
```

The executor:

- Decodes values to the TypeScript types quarry's columns declare (`quarryTypes`): int8/numeric as strings, timestamptz as `Date`, ranges as `Range`, pgvector as `number[]`. Enum and extension arrays are resolved once from `pg_type`.
- `raw: true` or `raw: ['timestamptz', …]` leaves values as text for codecs.
- `onQuery` reports SQL, tag, row count, error and timings (acquire, queue, exec).

## Development

- `pnpm test` starts a throwaway cluster (TLS, a role per auth method, an OAuth test validator, PgBouncer) when PostgreSQL is installed; otherwise the integration tests skip. `PG_VERSION=17`, `PG_BIN` and `PGBOUNCER_BIN` pick other versions.
- `pnpm bench:driver` compares against `pg` and postgres.js.
