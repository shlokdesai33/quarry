# quarry's PostgreSQL driver

A PostgreSQL driver with no runtime dependencies, written for quarry but usable on its own. It speaks the wire protocol directly (3.2 with fallback to 3.0), over Node's `net`/`tls` by default, behind a small socket interface for other runtimes.

It requires PostgreSQL 18 or later (connecting to an older server fails with a clear error; a pooler that hides the version is assumed to front 18+). Newer releases are expected to work: unknown messages, fields, parameters and types are tolerated. `connection.capabilities` reports what poolers and proxies may change, such as the negotiated protocol version.

## Runtimes

- **Node, Bun and Deno:** run on `node:net`/`node:tls`, with every feature available, including SCRAM channel binding and client certificates. `pnpm test:runtimes` runs the same smoke test on all three.
- **Cloudflare Workers:** the `cloudflare:sockets` adapter is picked automatically. Workers' TLS always verifies against public CAs and doesn't expose the server certificate, so there are no custom CAs, client certificates, direct TLS or channel binding there. `pnpm test:workers` (with `MINIFLARE_FROM` pointing at a Miniflare install) runs the smoke test inside workerd.
- **Anything else:** pass `socket` (a `SocketFactory`).

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
- **Not supported:** OAuth (PG 18 `OAUTHBEARER`), GSSAPI, SSPI and Kerberos. A server or pooler that offers only one of these fails with a `ConnectionError` (`code: 'EAUTHMETHOD'`) naming the method, and `requireAuth: 'oauth'` is rejected as unsupported.

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

Columns are received in binary where their codec reads them so, which is cheaper to decode and gives identical values: int2/int4/oid, int8 as a `bigint`, float8, bool, bytea, timestamptz as a `Date`, pgvector's `vector`, and arrays of those, of text-like types and of json/jsonb. A format is only asked for once the server has described the statement's columns, from a cached statement's second run; each column is then read with the codec the query expects for it (`resultCodecs`) when its type matches, and with the registry's codec for its type otherwise. Turn it off with `binaryResults: false`.

`codecs.vector` returns the float32 values stored, on every path: `[0.1]` reads as `[0.10000000149011612]`, the value pgvector holds and the value its binary format carries.

### Codecs and decoding

The driver owns the codecs: one object per type with `name`, `oid` (0 to look it up by name), `paramFormat`, `resultFormat`, `encode`, `decodeText` and an optional `decodeBinary`. `codecs` has the built-in ones, `arrayOf(codec)` the codec of a type's arrays, `defineCodec({ name, encode, decodeText })` one of your own. Each result column is read with the codec the query expects for it (checked against the column's type OID at RowDescription), or the registry's codec for its type:

- **`defaultCodecs`** (the default, lossless): int2/int4/float become numbers, int8 a `bigint`, bool, json/jsonb parsed, bytea a `Uint8Array`, and arrays of those and of the text types. numeric, dates and times stay as text.
- **`codecs: [...]`** on the pool, or per query: registered over the defaults, each for its type (and its arrays), e.g. `[codecs.int8AsString, codecs.timestamptz]`; or a registry built once with `createCodecRegistry(list, base?)` (`null` base: every other value as text).

Enums, domains and extension types have no fixed OIDs. A codec for one (`oid: 0`) is resolved through `pg_type` once per pool: behind the first query that needs it, or up front with `loadTypes()`; `reloadTypes()` looks them up again for types created since.

### Cancelling and timeouts

- `signal` cancels a running query (a cancel request over a new connection), or drops one not yet sent. A query pipelined behind others is canceled once the server gets to it, never one ahead of it.
- `timeout` is a client-side deadline that cancels.
- `statementTimeout` is enforced by the server, with `set_config(…, true)`, so it never leaks into other sessions behind a pooler.
- `conn.cancel()` cancels whatever is running.

Canceled queries throw `QueryCanceled`, whose `reason` is `'abort'`, `'timeout'`, `'statement_timeout'` or `'user'`.

### Streaming, COPY, notifications

```ts
for await (const batch of conn.cursor(sql, params, { batchSize: 1000 })) { … }
for await (const row of pool.stream(sql, params)) { … }
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

`createPool` takes these options:

- `max`, `min`
- `idleTimeout` (30 s), `maxLifetime` (1 h, with jitter)
- `acquireTimeout` (30 s), `maxWaiting`
- `pipeline`: once every connection is busy, `query`, `simpleQuery` and `describe` are pipelined onto shared connections. Further queries wait in line and take the next free slot.
  - By default the depth adapts per connection. It starts at 100 queries in flight. While queries are waiting and finish nearly as fast as the round trip allows, so the network rather than the server is the limit, it grows by half each round trip, up to 1000. Once queries queue on the server, more depth would only line them up behind each other, so it shrinks back towards 100. At 0 ms it stays at 100; at 5 ms with 1000 callers on one connection it reaches the server's throughput instead of 100 per round trip.
  - A number fixes the depth; `false` gives every query a connection to itself.
  - Reserved clients, transactions, cursors and COPY always get a connection of their own. While one waits, one shared connection per waiter takes no new queries, and it is handed over once the queries already in flight on it finish, so a steady stream of queries can't hold it back.
- `onConnect`

`pool.acquire()` reserves a client; release it with `release()` or `await using`. Connections that die, or are released mid-transaction, are discarded. `maxLifetime` also recycles idle connections, including those kept open by `min`.

`pool.end()` stops new work and closes the pool once the work already issued is done: queries and callers already waiting get a connection, and reserved clients and transactions keep theirs until released. `end({ timeout })` fails whatever is still waiting or running after that long.

## Poolers and proxies

- **Protocol version:** the driver asks for protocol 3.2 and accepts 3.0 from poolers that negotiate down. A pooler that rejects 3.2 outright gets one retry with 3.0; `minProtocolVersion` / `maxProtocolVersion` override this.
- **PgBouncer in transaction mode** (tested with 1.26): named prepared statements work from 1.21 with `max_prepared_statements` set, and pipelined queries are sent unnamed (see [Queries](#queries); `preparePipelined: false` for 1.21–1.25). With older versions, or other poolers without prepared-statement support, use `prepare: false`; PgBouncer 1.26+ without `max_prepared_statements` is detected, and no statement is named.
- **Session state** (`SET`, `LISTEN`, temporary tables, session advisory locks) doesn't survive between transactions in transaction mode. The driver's own settings never use it: `statementTimeout`, transaction `settings` and `timeout` all go through `set_config(…, true)` inside a transaction. `LISTEN` needs a direct or session-mode connection.
- **RDS Proxy, Supavisor, Neon and other transaction poolers:** the same rules apply. Avoid session-level `SET`, which can pin a session to a server connection. If a proxy pins or rejects named prepared statements, use `prepare: false`.
- **Version check:** a pooler that hides `server_version` skips the PostgreSQL 18 check.

## Errors

- Server errors are `PostgresError`s carrying every field the server sent, plus `query` (non-enumerable, so parameters don't leak into logs).
- Common SQLSTATEs have their own classes: `UniqueViolation`, `ForeignKeyViolation`, `NotNullViolation`, `CheckViolation`, `ExclusionViolation` (with `columns`), `SerializationFailure`, `DeadlockDetected` (`isRetryable`), `QueryCanceled`, `LockNotAvailable`, `ReadOnlyTransaction`, `UndefinedTable`, `UndefinedColumn`.
- Client-side failures are `ConnectionError`, `ProtocolError` or `AbortError`.
- A result value whose parser throws fails only that query, with a `DecodeError` naming the column and type (never the value); the connection stays usable.

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

- `pnpm test` starts a throwaway cluster (TLS, a role per auth method, PgBouncer) when PostgreSQL is installed; otherwise the integration tests skip. `PG_VERSION=17`, `PG_BIN` and `PGBOUNCER_BIN` pick other versions.
- `pnpm bench:driver` is a quick comparison with `pg` and postgres.js. `bench/driver/suite` is the full, reproducible comparison: every client on Node, Bun and Deno, PgBouncer, simulated network latency, resources and footprint (see its README).
- `pnpm test:compat` runs node-postgres's and postgres.js's own test suites against this driver, through test-only shims in `test/driver/compat`, on PostgreSQL 18 (add `--bouncer` for a second pass through PgBouncer in transaction mode). It clones the pinned upstream releases into `.compat/`; `test/driver/compat/expectations.ts` lists every test allowed to fail and why.
