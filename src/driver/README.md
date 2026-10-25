# quarry's PostgreSQL driver

A PostgreSQL driver with no runtime dependencies, written for quarry but usable on its own. It speaks the wire protocol directly (3.2 with fallback to 3.0), over Node's `net`/`tls` by default, behind a small socket interface for custom transports.

It requires PostgreSQL 18 or later (connecting to an older server fails with a clear error; a pooler that hides the version is assumed to front 18+). Newer releases are expected to work: unknown messages, fields, parameters and types are tolerated. `connection.capabilities` reports what poolers and proxies may change, such as the negotiated protocol version.

This file documents the API; [ARCHITECTURE.md](ARCHITECTURE.md) explains how the driver works and links the other guides.

## Contents

- [Runtime](#runtime)
- [Connecting](#connecting)
- [Queries](#queries)
- [Transactions](#transactions)
- [Pool](#pool)
- [Poolers and proxies](#poolers-and-proxies)
- [Errors](#errors)
- [Observability](#observability)
- [With quarry](#with-quarry)
- [Development](#development)
- [Decisions](#decisions)
- [Glossary](#glossary)

## Runtime

The driver runs on Node 24.11 or later, over `node:net`/`node:tls` ([Node only](DECISIONS.md#node-only)). To use your own transport (a test double, a tunnel), pass `socket` (a `SocketFactory`); it opens the connections that carry cancel requests too ([ARCHITECTURE.md](ARCHITECTURE.md#part-11-sockets)).

## Connecting

```ts
import { connect, createPool } from 'quarry/driver';

await using conn = await connect('postgres://app@db.internal/app');
const pool = createPool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});
```

Options come from the argument, then the connection string (URL or `key=value`), then `PG*` environment variables, then `.pgpass`. They follow libpq ([auth/README.md](auth/README.md#configuration)):

| Option                                     | Default                                 | Meaning                                                                                                   |
| ------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `connectionString`                         |                                         | a `postgres://` URL or `key=value` string; explicit options override it                                   |
| `host`                                     | `localhost`                             | host name, IP address or Unix-socket directory (starting with `/`); comma-separated for failover          |
| `port`                                     | 5432                                    | one, or one per host                                                                                      |
| `user`                                     | `USER` (or `USERNAME`), else `postgres` |                                                                                                           |
| `password`                                 | from `.pgpass`                          | a string, or a function called for every new connection                                                   |
| `database`                                 | the user name                           |                                                                                                           |
| `applicationName`                          |                                         | shown in `pg_stat_activity`                                                                               |
| `ssl`                                      | `verify-full` remote, `prefer` local    | an `sslmode`, or `SslOptions` ([TLS](#tls))                                                               |
| `channelBinding`                           | `prefer`                                | SCRAM channel binding: `disable`, `prefer`, `require`                                                     |
| `requireAuth`                              | any method                              | the authentication methods to accept ([Authentication](#authentication))                                  |
| `connectTimeout`                           | 30 s                                    | to connect and authenticate, in milliseconds (0: none)                                                    |
| `keepAlive`, `keepAliveInitialDelay`       | on, 0                                   | TCP keepalive (`keepalives`, `keepalives_idle`)                                                           |
| `protocol`                                 | `auto`                                  | `auto` asks for 3.2 and accepts what is negotiated; `3.x` insists on that version                         |
| `minProtocolVersion`, `maxProtocolVersion` | `3.0`, `latest`                         | the range `auto` accepts                                                                                  |
| `targetSessionAttrs`                       | `any`                                   | which of several hosts to accept: `read-write`, `read-only`, `primary`, `standby`, `prefer-standby`       |
| `params`                                   |                                         | startup settings, e.g. `{ search_path: 'app' }`                                                           |
| `options`                                  |                                         | command-line options for the server, as `PGOPTIONS` (`-c statement_timeout=5s`)                           |
| `passfile`                                 | `PGPASSFILE`, else `~/.pgpass`          | a password file                                                                                           |
| `codecs`                                   | `defaultCodecs`                         | codecs for result columns, over the defaults, or a registry ([Codecs and decoding](#codecs-and-decoding)) |
| `prepare`                                  | true                                    | cache named prepared statements per connection                                                            |
| `statementCacheSize`                       | 100                                     | prepared statements kept per connection                                                                   |
| `preparePipelined`                         | detected at login                       | name statements pipelined with others too ([Queries](#queries))                                           |
| `binaryResults`                            | true                                    | receive columns in binary where their codec reads them so                                                 |
| `telemetry`                                |                                         | `{ tracer, queryText? }`: a span per statement ([Observability](#observability))                          |
| `captureStack`                             | false                                   | append the issuing code's stack to query errors                                                           |
| `onNotice`, `onNotification`               |                                         | listeners for server notices and `NOTIFY`s ([Observability](#observability))                              |
| `socket`                                   | `nodeSockets`                           | a `SocketFactory` for a custom transport                                                                  |
| `maxMessageSize`                           | 1 GiB                                   | the largest message accepted from the server                                                              |
| `env`                                      | `process.env`                           | where `PG*` variables are read from                                                                       |

### TLS

`ssl` takes libpq's `sslmode` values. The default is **`verify-full` for remote hosts** and `prefer` for localhost and Unix sockets.

```ts
connect({ host: 'db.example.com', ssl: { mode: 'verify-full', ca: pem } });
connect({
  host: 'db.example.com',
  ssl: { mode: 'require', negotiation: 'direct' },
}); // direct TLS: no SSLRequest round trip
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
- **Other methods:** the driver authenticates with the methods above and certificates. A server or pooler that asks for OAuth (`OAUTHBEARER`), GSSAPI, SSPI or Kerberos fails the connection with a `ConnectionError` (`code: 'EAUTHMETHOD'`) naming the method, and `requireAuth: 'oauth'` throws a `DriverError` when the options are resolved (`'!oauth'` is accepted: it excludes a method that is never used).

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

`query`'s options (`QueryOptions`):

| Option             | Default                          | Meaning                                                                                                        |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `rowMode`          | `'object'`                       | rows keyed by column name (the last wins on duplicates), or positional `'array'` rows                          |
| `codecs`           | the connection's                 | codecs for result columns by type: a list over the connection's registry, or a registry                        |
| `paramCodecs`      |                                  | a codec per parameter position                                                                                 |
| `resultCodecs`     |                                  | the codec each result column is expected in, by position, used while the column has that type                  |
| `paramTypes`       |                                  | parameter type OIDs; 0 or missing entries let the server infer                                                 |
| `prepare`          | the connection's                 | use a cached named prepared statement                                                                          |
| `binary`           | the connection's `binaryResults` | ask for binary results where the codec reads them so                                                           |
| `signal`           |                                  | an `AbortSignal` that cancels the query                                                                        |
| `timeout`          |                                  | a client-side deadline in milliseconds, which cancels                                                          |
| `statementTimeout` |                                  | a server-side `statement_timeout` for this query alone (milliseconds, or an interval such as `'2s'`)           |
| `keepRows`         | all                              | keep only the first n rows, without decoding the others; `rowCount` still counts every row                     |
| `nested`           |                                  | columns read into objects of the row, `null` where the marker is false ([CODECS.md](CODECS.md#nested-objects)) |
| `onTiming`         |                                  | receives `{ queuedMs, execMs }` once the query settles                                                         |
| `tag`              |                                  | a label for telemetry: the span name and `db.query.summary`                                                    |

`cursor` and `stream` take the same options except `keepRows`, plus `batchSize` (1000 rows per round trip). On a connection, `simpleQuery` takes `rowMode`, `codecs`, `signal`, `timeout` and `tag`, and `describe` takes `paramTypes`, `signal` and `timeout`.

Parameters:

- A parameter with a codec (`typed(value, codec)`, or the query's `paramCodecs`, as quarry's builder gives every value compared with or written to a column) is encoded by it once, and its type OID declared at Parse, except for text-like codecs, whose type the server infers. Types looked up by name declare their OID once the pool's catalog has it.

  ```ts
  await conn.query('select * from unnest($1::int4[], $2::text[])', [
    typed(ids, arrayOf(codecs.int4)),
    typed(names, arrayOf(codecs.text)),
  ]);
  ```

- Without one, a value is encoded by its JavaScript type: strings pass through unchanged; numbers (integers without an exponent), bigints, booleans and `Date`s become their Postgres text. A `Date` is sent as a UTC timestamp, so a `timestamp without time zone` column receives the UTC wall-clock time whatever the process's time zone. Arrays become array literals and other objects JSON. `Uint8Array` is sent in binary.
- Arrays of bool, int2/int4/int8, float8, timestamptz (`Date`s), uuid, jsonb and bytea are sent in binary by their `arrayOf` codec, or untyped when `paramTypes` declares their type, which is much cheaper for the server to read than a literal. An element that doesn't fit falls back to a literal.
- The statement cache keys on the declared types.

Queries issued concurrently on one connection are pipelined into shared socket writes. Each still gets its own Sync, so one failing query doesn't fail its neighbours (outside a transaction). Writes respect backpressure: a long queue goes out in 64 KiB chunks, and once the socket's buffer is full, the remaining queries wait unencoded until it drains, so a deep pipeline or large parameters can't pile up in memory.

A query takes at most 65535 parameters, the protocol's limit; more are refused before anything is sent.

Statements are prepared and cached per connection (100 by default; `statementCacheSize`, `prepare: false`). This is safe behind PgBouncer 1.21+ with `max_prepared_statements`. A cached statement that a schema change made stale (its result type or an inferred parameter type changed), or that the server no longer has (`DEALLOCATE`, `DISCARD ALL`), is retried once as an unnamed statement, outside a transaction. Behind PgBouncer, which maps a new Parse of the same text back to the statement it already prepared, SQL that still comes back stale is no longer prepared on that connection.

Behind PgBouncer in transaction mode, a query pipelined with others on its connection is sent unnamed instead (Parse, Bind, and Describe of the portal), still with its cached columns and binary formats. A query alone on its connection stays named.

- **Why:** PgBouncer rewrites the name in every named Bind. It flushes what it holds, then writes the new name apart from the rest, so each named query reaches the server in two writes instead of sharing one. Under load the single-threaded pooler is the bottleneck, and this costs it more than parsing again costs the server.
- **Detection:** PgBouncer 1.26+ reports itself at login (`connection.capabilities.pgbouncer`). For 1.21–1.25, set `preparePipelined: false`; `true` keeps pipelined queries named. With `max_prepared_statements = 0`, no statement is named.
- **Schema changes:** a pipelined query whose columns changed since they were cached is decoded by what the server sent, and the cache entry is dropped. If a column asked for in binary changed to a type without a binary decoder, that query fails with a `DecodeError` after running.

Columns are received in binary where their codec reads them so, which is cheaper to decode and gives identical values: int2/int4/oid, int8 as a `bigint`, float8, bool, bytea, timestamptz as a `Date` (`codecs.timestamptz`), pgvector's `vector` (`codecs.vector`), and arrays of those, of text-like types and of json/jsonb. A format is only asked for once the server has described the statement's columns, from a cached statement's second run; each column is then read with the codec the query expects for it (`resultCodecs`) when its type matches, and with the registry's codec for its type otherwise. Turn it off with `binaryResults: false`.

`codecs.vector` returns the float32 values stored, on every path: `[0.1]` reads as `[0.10000000149011612]`, the value pgvector holds and the value its binary format carries.

### Codecs and decoding

The driver owns the codecs: one object per type with `name`, `oid` (0 to look it up by name), `paramFormat`, `resultFormat`, `encode`, `decodeText` and an optional `decodeBinary`. `codecs` has the built-in ones, `arrayOf(codec)` the codec of a type's arrays, `defineCodec({ name, encode, decodeText })` one of your own. Each result column is read with the codec the query expects for it (checked against the column's type OID at RowDescription), or the registry's codec for its type:

- **`defaultCodecs`** (the default, lossless): int2/int4/oid/float4/float8 become numbers, int8 a `bigint`, bool a boolean, json/jsonb are parsed, bytea becomes a `Uint8Array`, and arrays of those become arrays. Arrays of the text types, uuid, numeric, dates, times, timestamps, intervals, inet/cidr, point, box and the date and timestamptz ranges become arrays of the server's text. Everything else (numeric, uuid, dates and times themselves) stays the server's text.
- **`codecs: [...]`** on the connection or pool: registered over the defaults, each for its type (and its arrays), e.g. `[codecs.int8AsString, codecs.timestamptz]`. Per query, a list is registered over the connection's codecs. Or pass a registry built once with `createCodecRegistry(list, base?)` (`null` base: every other value as text).
- **Per column**: `resultCodecs` gives the codec a column is expected in (quarry's builder sets it from the column's type); it is used while the column has that type.

Enums, domains and extension types have no fixed OIDs. A codec for one (`oid: 0`) is resolved through `pg_type` once per pool: behind the first query that needs it, or up front with `loadTypes()`; `reloadTypes()` looks them up again for types created since. A lookup that fails doesn't reject: named types are then inferred and read as text, and the next query that needs them tries again ([CODECS.md](CODECS.md#types-looked-up-by-name-the-catalog)).

### Cancelling and timeouts

- `signal` cancels a running query (a cancel request over a new connection), or drops one not yet sent. A query pipelined behind others is canceled once the server gets to it, never one ahead of it.
- `timeout` is a client-side deadline that cancels.
- `statementTimeout` is enforced by the server, with `set_config(…, true)`, so it never leaks into other sessions behind a pooler.
- `conn.cancel()` cancels whatever is running.

Canceled queries throw `QueryCanceled`, whose `reason` is `'abort'`, `'timeout'`, `'statement_timeout'` or `'user'`.

### Streaming, COPY, notifications

```ts
for await (const batch of conn.cursor(sql, params, { batchSize: 1000 })) { … } // a batch per pull, binary columns from the first run
for await (const row of pool.stream(sql, params)) { … } // a connection of its own until the loop ends
for await (const row of tx.stream(sql, params)) await tx.query(…); // inside a transaction, queries run between batches
await conn.copyRows('copy items (id, name) from stdin', rows); // bulk insert: rows as value arrays, encoded like parameters
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
- BEGIN (with the settings) is sent with the callback's first statement, under one Sync, so a transaction takes 2 round trips. If BEGIN fails, the server skips that statement, and the transaction rejects with BEGIN's error. The callback has already started by then.
- A savepoint's `release` isn't waited for; if it fails, the next statement in the transaction, or the COMMIT, reports its error.
- quarry's `db.batch(queries, { transaction: true })` runs a fixed list of statements in one round trip: BEGIN, the settings and the statements under one Sync, then COMMIT with its own, all in one write. A failed statement skips the rest, so COMMIT reports ROLLBACK; a failed BEGIN runs nothing, and the COMMIT after it does nothing.

## Pool

`createPool(options | connectionString)` takes the connection options and these ([POOL.md](POOL.md#options)):

- `max` (10; below 1 throws), `min` (0, at most `max`)
- `idleTimeout` (30 s), `maxLifetime` (1 h, with up to 10% jitter); 0 for never
- `acquireTimeout` (30 s; 0 waits forever; then a `ConnectionError` with `code: 'ETIMEDOUT'`), `maxWaiting` (unlimited; past it, waiting for a connection or a pipeline slot fails at once with a `DriverError`)
- `pipeline`: once every connection is busy, `query`, `simpleQuery` and `describe` are pipelined onto shared connections. Further queries wait in line and take the next free slot.
  - By default the depth adapts per connection. It starts at 100 queries in flight. While queries are waiting and finish nearly as fast as the round trip allows, so the network rather than the server is the limit, it grows by half each round of about that many queries, up to 1000. Once queries queue on the server, more depth would only line them up behind each other, so it shrinks back towards 100. At 0 ms it stays at 100; at 5 ms with 1000 callers on one connection it reaches the server's throughput instead of 100 per round trip.
  - By default the **width**, how many connections queries are spread over, adapts too ([POOL.md](POOL.md#adaptive-width)). It starts at `max`. When pipelined connections keep stalling (completing nothing while the rest of the pool completes everything in flight), which is what a server with fewer CPUs than busy backends does to them, it narrows towards the number the server runs at once, judges the change and undoes it if it didn't help; with no stalls and queries waiting, it widens again one connection at a time. Exclusive callers still get up to `max`.
  - A number fixes the depth and spreads queries over all `max` connections; `false`, `0` or `1` gives every query a connection to itself.
  - Reserved clients, transactions, cursors and COPY always get a connection of their own. While one waits, one shared connection per waiter takes no new queries, and it is handed over once the queries already in flight on it finish, so a steady stream of queries can't hold it back.
- `onConnect(connection)`: runs on each new connection before its first use (to `SET` session state); if it throws, the connection is destroyed and the waiter gets the error.

`pool.acquire()` reserves a client (`query`, `cursor`, `stream`, `describe`, `transaction`, `connection`, `pool`); release it with `release()` (`release(true)` or `release(error)` closes it instead) or `await using`. Connections that die, or are released mid-transaction, are discarded. `maxLifetime` also recycles idle connections, including those kept open by `min`.

`pool.stats` is `{ total, idle, busy, waiting }`, and `pool.ended` tells whether `end()` was called. `pool.loadTypes()` and `pool.reloadTypes()` look named types up once for every connection of the pool.

`pool.end()` stops new work and closes the pool once the work already issued is done: queries and callers already waiting get a connection, and reserved clients and transactions keep theirs until released. `end({ timeout })` fails whatever is still waiting or running after that long.

## Poolers and proxies

- **Protocol version:** the driver asks for protocol 3.2 and accepts 3.0 from poolers that negotiate down. A pooler that rejects 3.2 outright gets one retry with 3.0; `minProtocolVersion` / `maxProtocolVersion` override this.
- **PgBouncer in transaction mode** (tested with 1.26): named prepared statements work from 1.21 with `max_prepared_statements` set, and pipelined queries are sent unnamed (see [Queries](#queries); `preparePipelined: false` for 1.21–1.25). With older versions, or other poolers without prepared-statement support, use `prepare: false`; PgBouncer 1.26+ without `max_prepared_statements` is detected, and no statement is named.
- **Session state** (`SET`, `LISTEN`, temporary tables, session advisory locks) doesn't survive between transactions in transaction mode. The driver's own settings never use it: `statementTimeout`, transaction `settings` and `timeout` all go through `set_config(…, true)` inside a transaction. `LISTEN` needs a direct or session-mode connection.
- **RDS Proxy, Supavisor, Neon and other transaction poolers:** the same rules apply. Avoid session-level `SET`, which can pin a session to a server connection. If a proxy pins or rejects named prepared statements, use `prepare: false`.
- **Version check:** a pooler that hides `server_version` skips the PostgreSQL 18 check.

## Errors

- Server errors are `PostgresError`s carrying every field the server sent (`code` is the SQLSTATE), plus `fields` and `query` (`{ sql, params, tag? }`), both non-enumerable, so parameters don't leak into logs. `isRetryable` is true for serialization failures and deadlocks, `isFatal` for errors that end the session.
- Common SQLSTATEs have their own classes ([ARCHITECTURE.md](ARCHITECTURE.md#errors) has the table): `IntegrityConstraintViolation` (any class 23 code, with `columns`) and its subclasses `UniqueViolation`, `ForeignKeyViolation`, `NotNullViolation`, `CheckViolation`, `ExclusionViolation`; `SerializationFailure`, `DeadlockDetected`, `LockNotAvailable`, `ReadOnlyTransaction`, `TransactionTimeout`, `IdleInTransactionTimeout`, `UndefinedTable`, `UndefinedColumn`, and `QueryCanceled` (with a `reason`).
- Errors raised by the driver itself extend `DriverError`: `ConnectionError` (with a `code`: a system error, or `ETIMEDOUT`, `EAUTHMETHOD`, `EPROTOCOL`, `EVERSION`), `ProtocolError`, `AbortError`, `DecodeError`, `UndefinedParameterError` (`undefined` as a parameter or array element, with its `position`) and `TransactionRolledBack`. Misuse it detects (a pool that has ended, a released client used again, a value a codec can't send) throws a plain `DriverError`.
- A result value whose parser throws fails only that query, with a `DecodeError` naming the column and type (never the value); the connection stays usable.

## Observability

- **Spans:** `telemetry: { tracer }` reports each statement as an OpenTelemetry client span; pass `trace.getTracer('app')` from `@opentelemetry/api`, which the driver doesn't depend on. Spans carry the database, the operation (`SELECT`), the server address and port, the SQL text (unless `queryText: false`), the query's `tag` as span name and `db.query.summary`, the rows returned, and on error the SQLSTATE. Parameters are never recorded. The attributes and which calls make spans are in [ARCHITECTURE.md](ARCHITECTURE.md#spans).
- **Stacks:** `captureStack: true` appends the stack of the code that issued a query to its error, under `--- query issued at ---`.
- **Timing:** a query's `onTiming` receives `{ queuedMs, execMs }`: time waiting behind other queries on the connection, then from being sent to finishing.
- **Notices:** `onNotice` (an option, or `connection.onNotice(listener)`, which returns an unsubscribe function) receives the server's warnings and notices as `Notice`s (`severity`, `code`, `message`, `detail`, `hint`, `where`, `fields`). `onNotification` receives every `NOTIFY` this session listens for (`pid`, `channel`, `payload`). A listener that throws doesn't break the connection; its error is rethrown in a microtask.
- **What the connection learned:** `connection.capabilities` (protocol version, server version, SASL mechanisms offered, PgBouncer and its pool mode), `connection.parameters` (`server_version`, `TimeZone`, `in_hot_standby`, …), `processId`, `transactionStatus` ([ARCHITECTURE.md](ARCHITECTURE.md#capabilities-and-server-parameters)).

## With quarry

quarry uses this driver by default; you don't need to touch it directly:

```ts
import { database } from 'quarry';

const db = database(process.env.DATABASE_URL, { onQuery: (e) => log(e) });
const user = await db
  .selectFrom(users)
  .where('users.id', id)
  .select(['users.email'])
  .expectOne()
  .execute({ signal: request.signal, timeout: '2s' });
await db.transaction(async (tx) => {
  await tx.insertInto(orders).values(order).execute();
  tx.afterCommit(() => queue.publish('order.created'));
});
```

`database()` also takes a pool, client or connection from this module, or driver options. quarry decodes values to the TypeScript types its columns declare, reports `onQuery` events, and adds the query, tag and caller's stack to errors. All of that lives in quarry; this module knows nothing about quarry.

## Development

- `pnpm test` starts a throwaway cluster (TLS, a role per auth method, PgBouncer) when PostgreSQL is installed; otherwise the integration tests skip. `PG_VERSION` (an installed major version, 18 or later), `PG_BIN` and `PGBOUNCER_BIN` pick other binaries.
- `pnpm bench:driver` is a quick comparison with `pg` and postgres.js. `bench/driver/suite` is the full, reproducible comparison: every client on Node, PgBouncer, simulated network latency, resources and footprint (see its README).
- `pnpm test:compat` runs node-postgres's and postgres.js's own test suites against this driver, through test-only shims in `test/driver/compat`, on PostgreSQL 18 (add `--bouncer` for a second pass through PgBouncer in transaction mode). It clones the pinned upstream releases into `.compat/`; `test/driver/compat/expectations.ts` lists every test allowed to fail and why.

## Decisions

Why the API looks this way. Each links to its full entry in [DECISIONS.md](DECISIONS.md); the guides' own Decisions sections list the rest:

- [libpq-compatible configuration](DECISIONS.md#libpq-compatible-configuration): the same options, connection strings and `PG*` variables as every other PostgreSQL client.
- [`verify-full` by default, and strict TLS and SCRAM checks](DECISIONS.md#verify-full-by-default-and-strict-tls-and-scram-checks): a remote connection is verified unless you say otherwise.
- [Prepared statements by default, named per connection](DECISIONS.md#prepared-statements-by-default-named-per-connection) and [Detect poolers at login rather than configure them](DECISIONS.md#detect-poolers-at-login-rather-than-configure-them): fast by default, and right behind PgBouncer without configuration.
- [Pipelining, with one Sync per query](DECISIONS.md#pipelining-with-one-sync-per-query): concurrent queries share writes, never failures.
- [Pipelining onto busy connections, only once the pool is full](DECISIONS.md#pipelining-onto-busy-connections-only-once-the-pool-is-full) and [Adaptive width](DECISIONS.md#adaptive-width-no-more-pipelined-backends-than-the-server-runs-at-once): what `pipeline` controls.
- [`undefined` is refused, never sent as NULL](DECISIONS.md#undefined-is-refused-never-sent-as-null): `UndefinedParameterError`.
- [Errors carry everything and leak nothing](DECISIONS.md#errors-carry-everything-and-leak-nothing) and [Typed error classes per SQLSTATE](DECISIONS.md#typed-error-classes-per-sqlstate).
- [OpenTelemetry spans through a structural tracer, without parameters](DECISIONS.md#opentelemetry-spans-through-a-structural-tracer-without-parameters): `telemetry` without a dependency.
- [Node only](DECISIONS.md#node-only) and [PostgreSQL 18 or later only](DECISIONS.md#postgresql-18-or-later-only).

## Glossary

**Capabilities**: what a connection learned at startup about the other end (protocol version, server version, PgBouncer).

**Codec**: the object that encodes and decodes one PostgreSQL type ([CODECS.md](CODECS.md)).

**Notice**: a warning or informational message from the server, delivered to `onNotice`.

**Pipeline slot**: one query's place on a shared connection's pipeline; the pool hands free slots to queued queries in order.

**Registry**: which codec reads result columns of each type, where the query doesn't say.

**Shared connection**: a pool connection lent for single queries, several pipelined on it at once ([POOL.md](POOL.md#two-ways-to-use-a-connection)).

**Span**: one statement's entry in a trace, made when `telemetry` is set.

**Sync**: the protocol message that ends a query's group of messages; after an error, the server skips to it.

**Width**: how many connections the pool spreads pipelined queries over; adaptive by default.
