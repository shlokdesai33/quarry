# quarry

**A PostgreSQL toolkit for TypeScript: a fast, dependency-free driver, and a type-safe query builder on top of it.**

quarry ships two things in one package:

- **`quarry/driver`**: a PostgreSQL driver written from scratch against the wire protocol (3.2, falling back to 3.0). It has no runtime dependencies and runs on Node, Bun, Deno and Cloudflare Workers. It pipelines concurrent queries, prepares and caches statements, and decodes results in binary, and it leads the established Node drivers in most scenarios of an independent benchmark. It can be used on its own, in place of `pg` or postgres.js.
- **`quarry`**: a query builder whose types follow PostgreSQL's own rules. A table defined once in TypeScript gives you typed rows, typed inserts and updates, comparisons that only accept values Postgres would accept, and a `verify` command that checks the definitions against the live database.

```ts
import { database, defineTable, integer, text, timestamptz } from 'quarry';

const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: text(),
		name: text().nullable(),
		createdAt: timestamptz().name('created_at').default(),
	},
});

const db = database(process.env.DATABASE_URL);

// user: { id: number; name: string | null }
const user = await db
	.selectFrom(users)
	.where('users.email', 'ada@example.com')
	.select(['users.id', 'users.name'])
	.expectOne()
	.execute();
```

> **Status.** The driver is complete, tested against PostgreSQL 18 directly and through PgBouncer, and benchmarked. The query builder is **in active development**: the API documented below is the intended 1.0 surface, and details may still change before release.

## Contents

- [Requirements](#requirements)
- [Entry points](#entry-points)
- **Part I: The driver**
  - [Overview](#overview)
  - [Benchmarks](#benchmarks)
  - [Connecting](#connecting)
  - [TLS](#tls)
  - [Authentication](#authentication)
  - [Runtimes](#runtimes)
  - [Queries](#queries)
  - [Parameters](#parameters)
  - [Decoding results](#decoding-results)
  - [Prepared statements](#prepared-statements)
  - [Pipelining](#pipelining)
  - [Cancellation and timeouts](#cancellation-and-timeouts)
  - [Cursors, streaming and COPY](#cursors-streaming-and-copy)
  - [LISTEN and NOTIFY](#listen-and-notify)
  - [Transactions](#transactions)
  - [The pool](#the-pool)
  - [Poolers and proxies](#poolers-and-proxies)
  - [Errors](#errors)
  - [Observability](#observability)
- **Part II: The query builder**
  - [Defining tables](#defining-tables)
  - [Opening a database](#opening-a-database)
  - [Selecting](#selecting)
  - [Expressions](#expressions)
  - [Result shapes](#result-shapes)
  - [Inserting](#inserting)
  - [Updating](#updating)
  - [Deleting](#deleting)
  - [Running queries](#running-queries)
  - [Batches](#batches)
  - [Transactions with the query builder](#transactions-with-the-query-builder)
  - [Slow queries and query budgets](#slow-queries-and-query-budgets)
  - [Handling errors](#handling-errors)
  - [Schema verification](#schema-verification)
- [Development](#development)
- [License](#license)

## Requirements

- **PostgreSQL 18 or later.** Connecting to an older server fails with a clear error. A pooler that hides the server version is assumed to front 18+.
- **Node 22.12 or later.** Bun and Deno are supported (tested on Bun 1.4 and Deno 2.9), as is Cloudflare Workers.
- **TypeScript with `strict` enabled**, for the query builder's types.

## Entry points

The package has two entry points:

| Import          | What it is                                                                           |
| --------------- | ------------------------------------------------------------------------------------ |
| `quarry`        | The query builder, `database()`, schema verification, and the driver's error classes |
| `quarry/driver` | The driver on its own: `connect`, `createPool`, codecs and everything else           |

The package also installs a `quarry` binary, used for [`quarry verify`](#schema-verification).

---

# Part I: The driver

## Overview

`quarry/driver` speaks PostgreSQL's frontend/backend protocol directly. It has no runtime dependencies, no native addon, and no shared global state.

What it does differently from the established drivers:

- **Pipelining by default.** Concurrent queries on one connection share socket writes instead of waiting their turn. Once every pool connection is busy, new queries pipeline onto shared connections, with a depth that adapts to the network.
- **Prepared statements by default.** Each connection caches up to 100 named statements, so a repeated query skips the server's parse and plan.
- **Binary results.** From a cached statement's second run, columns whose type has a binary decoder are received in binary, which is cheaper to decode and gives identical values.
- **Fewer round trips.** A transaction's `BEGIN` travels with its first statement, so `begin; insert; commit` costs two round trips instead of three. A failed query costs nothing beyond its own round trip.
- **libpq-compatible configuration.** Connection strings, `PG*` environment variables, `.pgpass`, `sslmode`, `target_session_attrs`, multi-host failover and `require_auth` behave as they do in `psql`.

```ts
import { connect, createPool } from 'quarry/driver';

const pool = createPool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query(
	'select id, email from users where id = $1',
	[42],
);
```

## Benchmarks

The driver is measured by an independent benchmark suite (`bench/driver/suite`) against the clients people actually use: `pg` (with unnamed and named statements), `pg-native` (libpq), postgres.js, Bun.sql, `@neondatabase/serverless` and deno-postgres, on Node, Bun and Deno.

The numbers below come from the latest full run, `2026-10-13-af58bb2` (the driver at commit `af58bb2`), with every result checked for equality across clients.

### How it was measured

| Setting   | Value                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine   | 8-core Intel Xeon VM, 47 GB RAM, Ubuntu 24.04, kernel 6.12                                                                                                                                            |
| Pinning   | Client on cores 0–2, proxies on core 3, PostgreSQL on cores 4–7                                                                                                                                       |
| Server    | PostgreSQL 18.6 on localhost, TLS on, `synchronous_commit = off`, `autovacuum = off`, `jit = off`, `shared_buffers = 2GB`                                                                             |
| Network   | Direct, through PgBouncer 1.26 (transaction mode), and at simulated round-trip times of 0, 1, 5 and 20 ms (Toxiproxy 2.12)                                                                            |
| Runtimes  | Node 24.21, Bun 1.4.3, Deno 2.9.7                                                                                                                                                                     |
| Clients   | pg 8.23.1, pg-native 3.9.1 (libpq 18), postgres.js 3.4.9, `@neondatabase/serverless` 1.2.0 (through Neon's `wsproxy` on localhost), Bun.sql (built into Bun 1.4.3), deno-postgres 0.19.5              |
| Procedure | Each cell runs in a fresh process, in a seeded random order, after a warm-up. Five runs per cell; tables show the **median**, with **±** giving the half-width of a bootstrap 95% confidence interval |
| Fairness  | quarry is configured to decode like `pg` does (int8 and numeric as strings, timestamptz as `Date`). Every client's results are compared in canonical form: **608 results checked, 0 differ**          |

Two things to keep in mind when reading the tables. First, this is a localhost benchmark with durability relaxed, so it isolates client cost: the gaps here are larger than you'll see when the server is doing real work or the network adds milliseconds. Second, µs figures are per operation and lower is better; ops/s figures are higher is better.

### Single queries (Node 24, one at a time)

Median latency per operation:

| Scenario                              |      quarry |      pg | pg (named) | pg-native | postgres.js |
| ------------------------------------- | ----------: | ------: | ---------: | --------: | ----------: |
| `select 1`                            | **23.0 µs** | 25.9 µs |    25.9 µs |   31.2 µs |     27.8 µs |
| Point lookup by primary key           | **28.1 µs** | 46.0 µs |    35.3 µs |   49.9 µs |     32.9 µs |
| Range scan, 100 rows                  | **93.2 µs** |  188 µs |     184 µs |    195 µs |      163 µs |
| Fetch 1,000 rows (6 columns)          |  **322 µs** | 1.34 ms |    1.27 ms |   1.62 ms |      965 µs |
| Insert one row                        | **28.3 µs** | 38.6 µs |    30.1 µs |   44.1 µs |     33.0 µs |
| Update one row                        | **32.0 µs** | 45.4 µs |    34.7 µs |   51.2 µs |     36.0 µs |
| `begin; insert; commit`               | **52.7 µs** | 81.2 µs |    72.0 µs |   97.1 µs |     86.0 µs |
| A query that fails, connection reused | **35.4 µs** | 2.30 ms |    2.35 ms |   4.81 ms |     54.0 µs |

**What the numbers mean.**

- **`select 1` is the floor.** It measures nothing but the client's own overhead per round trip. quarry's 23.0 µs against pg's 25.9 µs says the per-query bookkeeping is about 11% cheaper before any real work happens.
- **Point lookups show where the time goes.** `pg` by default sends an unnamed statement, so the server parses and plans the query every time: it spends **26.0 µs of server CPU** per lookup against quarry's **13.6 µs**. `pg (named)` avoids that, but still spends **25.5 µs of client CPU** per lookup against quarry's **17.7 µs**, mostly in decoding. quarry wins on both sides of the socket.
- **Row-heavy queries are where it pulls away.** Fetching 1,000 rows takes 322 µs, three to five times faster than the others, because quarry receives the integer, float, boolean and timestamp columns in binary from the statement's second run. Its client spends **328 µs of CPU** on that fetch; every other client spends about **1,200 µs**. In throughput terms, quarry decodes **2.83 million rows per second**, against 0.63–0.89 million for the others.
- **Transactions save a round trip.** quarry sends `BEGIN` together with the first statement under one Sync, so a transaction costs two round trips instead of three. On localhost that is 52.7 µs against 72–97 µs; on a real network it is worth a full RTT per transaction (see [Network latency](#network-latency) below).
- **Errors are cheap.** A failing query (division by zero) costs quarry one round trip, and the connection carries straight on: **26,347 failing queries per second**, against 423 for `pg`. If your workload hits unique violations routinely, for example in insert-or-skip logic, this matters.

Per-type decoding cost, in nanoseconds per value (100,000 rows × 1 column):

| Type          |  quarry |    pg | pg-native | postgres.js |
| ------------- | ------: | ----: | --------: | ----------: |
| `int4`        |  **77** |   194 |       200 |         266 |
| `int8`        | **112** |   226 |       215 |         260 |
| `float8`      |  **82** |   210 |       232 |         297 |
| `numeric`     | **137** |   176 |       238 |         259 |
| `text`        | **113** |   173 |       203 |         249 |
| `timestamptz` | **111** |   677 |       728 |         439 |
| `date`        | **112** |   500 |       451 |         363 |
| `uuid`        | **126** |   209 |       233 |         257 |
| `jsonb`       | **383** |   439 |       553 |         506 |
| `int4[5]`     | **276** | 1,291 |     1,223 |         635 |
| `bytea`       | **170** |   386 |       388 |         376 |

The biggest gaps are in timestamps and arrays. `timestamptz` arrives as an 8-byte integer in binary, so quarry builds a `Date` from one number instead of parsing a string; arrays arrive with their element types and lengths up front instead of as a literal to tokenize.

### Concurrency and pipelining

Point lookups per second, Node 24, as the number of concurrent callers grows:

| Callers | quarry, pool 10 | quarry, pool 10, `pipeline: false` | pg, pool 10 | postgres.js, pool 10 | quarry, **1 connection** | pg, 1 connection |
| ------: | --------------: | ---------------------------------: | ----------: | -------------------: | -----------------------: | ---------------: |
|       1 |          33,041 |                             32,853 |      19,922 |               27,803 |                   33,312 |           19,989 |
|      10 |          94,609 |                             94,438 |      65,842 |               65,087 |                  109,616 |           20,745 |
|     100 |     **293,716** |                             90,955 |      64,659 |               41,742 |                  117,012 |           20,854 |
|     500 |     **318,929** |                             86,819 |      62,346 |              113,087 |                  115,396 |           20,622 |
|   1,000 |     **300,677** |                             84,411 |      61,003 |              130,367 |                  115,076 |           20,323 |

**What the numbers mean.**

- **With `pipeline: false`, quarry behaves like `pg`**: each query checks a connection out, so throughput stops at roughly _connections ÷ round trip_. Both plateau as soon as all ten connections are busy; quarry's plateau is higher only because each query is cheaper.
- **With pipelining (the default)**, once the ten connections are busy, further queries share them instead of queueing in the client. Throughput keeps climbing to about **300,000 lookups per second, roughly 5× `pg`**, and stays there at 1,000 callers. The p99 latency at 1,000 callers is **7.6 ms** against `pg`'s 24.1 ms, because queries wait on the socket rather than in a JavaScript queue.
- **A single connection** does 115,000 lookups per second with quarry, against 20,000 for `pg`. One pipelined connection outperforms ten unpipelined ones.

### Network latency

On localhost, round trips are nearly free. The cells below add a simulated network round trip with Toxiproxy, which is where the design choices pay off.

| Scenario (Node 24)                                  | RTT   |       quarry |       pg | postgres.js |
| --------------------------------------------------- | ----- | -----------: | -------: | ----------: |
| `begin; insert; commit`, sequential (latency)       | 5 ms  | **11.75 ms** | 17.50 ms |    17.57 ms |
|                                                     | 20 ms | **41.73 ms** | 62.70 ms |    62.62 ms |
| Point lookup, 50 callers, pool 10 (ops/s)           | 5 ms  |    **8,200** |    1,652 |       6,834 |
|                                                     | 20 ms |    **2,354** |      473 |       1,967 |
| Point lookup, 500 callers, **1 connection** (ops/s) | 5 ms  |   **79,879** |      169 |       7,848 |
|                                                     | 20 ms |   **23,078** |     47.8 |       2,337 |

**What the numbers mean.**

- **Transactions:** at 20 ms, every client but quarry takes 62.7 ms, which is exactly three round trips (`BEGIN`, `INSERT`, `COMMIT`). quarry takes 41.7 ms: two. The saving is one full RTT per transaction, regardless of how fast the server is.
- **A client that waits for each reply** can do at most one query per round trip per connection. At 20 ms that is 1 ÷ 0.0209 s ≈ **48 queries per second per connection**, and `pg` measures 47.8. With ten connections, ten times that: `pg` measures 473.
- **A pipelining client** is limited by how many queries it keeps in flight. quarry's depth adapts per connection, from 100 up to 1,000 in flight while the network rather than the server is the bottleneck. With 500 callers on one connection at 20 ms, the ceiling is 500 ÷ 0.0209 s ≈ 23,900 per second; quarry measures **23,078, 97% of it**, and about **480× `pg`**. postgres.js also pipelines on each connection, and reaches about a tenth of that here.
- **Sequential latency is the same for everyone** at 1 ms and above (a `select 1` takes 20.84 ms with quarry and 20.89 ms with `pg` at 20 ms RTT): one query alone can't go faster than one round trip, whatever the client.

How the adaptive depth compares to fixed depths, on one connection with 100 concurrent lookups:

| `pipeline` depth   | 0 ms RTT (ops/s) | 5 ms RTT (ops/s) |
| ------------------ | ---------------: | ---------------: |
| 1                  |           20,745 |              171 |
| 8                  |          108,505 |            1,341 |
| 32                 |          111,610 |            5,126 |
| 100                |          107,268 |           16,185 |
| adaptive (default) |      **114,468** |       **16,139** |

On localhost, depth stops mattering past 8, because the server becomes the bottleneck; at 5 ms, throughput grows almost linearly with depth. The adaptive default matches the best fixed setting in both cases without tuning.

### Large results, bulk writes and memory

| Scenario (Node 24, median time)                |       quarry |       pg | pg-native | postgres.js |
| ---------------------------------------------- | -----------: | -------: | --------: | ----------: |
| Fetch 100,000 rows                             | **37.09 ms** |   131 ms |    144 ms |    97.26 ms |
| Fetch 1,000,000 rows (one result)              |   **487 ms** | 1,293 ms |  1,517 ms |    1,078 ms |
| Wide rows: 1,000 rows × 100 columns            |  **3.64 ms** | 14.53 ms |  21.14 ms |    14.83 ms |
| Arrays: 1,000 rows of `int4[100]` + `text[20]` |  **3.25 ms** | 22.38 ms |  25.88 ms |     8.32 ms |
| 10 × 1 MB `bytea` values                       |  **3.63 ms** | 17.39 ms |  33.23 ms |    15.70 ms |
| Stream 1M rows with a cursor                   |   **737 ms** | 1,283 ms |       n/a |    1,047 ms |
| Bulk insert 10k rows (`unnest`, JS arrays)     | **12.79 ms** | 15.97 ms |  15.56 ms |    15.97 ms |
| Bulk insert 10k rows (`COPY FROM STDIN`)       |     12.85 ms | 12.95 ms |       n/a |    55.88 ms |

| Peak RSS at equal work (MB)           |  quarry |    pg | pg-native | postgres.js |
| ------------------------------------- | ------: | ----: | --------: | ----------: |
| Fetch 1M rows, 3 times                | **999** | 1,369 |     1,665 |       1,119 |
| Arrays, 50 times                      | **156** |   325 |       258 |         266 |
| Stream 1M rows with a cursor, 3 times | **147** |   210 |       n/a |         245 |

**What the numbers mean.**

- **`bytea` and arrays** arrive in binary, so a 1 MB `bytea` arrives as raw bytes rather than as a hex string twice its size to parse. That is the 4.8× on large `bytea` values and the 6.9× on arrays.
- **Bulk inserts with JS arrays** are about 20% faster because quarry sends typed arrays (`int4[]`, `text[]`, `float8[]`, …) in binary, which the server reads without parsing a literal. COPY is at parity: the work is on the server.
- **Memory is compared at equal work**: every client runs the same number of operations after the same warm-up. (Comparing peak memory within a fixed time window favours slower clients, which simply do less in the window.) quarry uses the least memory in every row-heavy scenario except large `jsonb` values.
- **Backpressure works**: when a consumer pauses mid-stream for 3 seconds, RSS grows by **0.0 MB**. The driver stops reading the socket until the consumer catches up.

### Connections

| Scenario (Node 24, median)                            |      quarry |      pg | pg-native | postgres.js |
| ----------------------------------------------------- | ----------: | ------: | --------: | ----------: |
| connect + `select 1` + close (no TLS, trust)          | **2.38 ms** | 3.99 ms |   4.79 ms |     6.86 ms |
| connect + `select 1` + close (no TLS, SCRAM)          | **2.81 ms** | 5.41 ms |   7.37 ms |     7.83 ms |
| connect + `select 1` + close (TLS verify-full, SCRAM) | **5.27 ms** | 6.63 ms |   7.42 ms |    53.33 ms |
| New pool (max 10), 10 concurrent `select 1`           | **7.90 ms** | 8.62 ms |  13.63 ms |    15.04 ms |

SCRAM is computed with the platform's native crypto, TLS is loaded lazily and its contexts are cached, which matters for serverless functions that open a connection per invocation. After `pg_ctl restart -m fast`, a quarry pool serves its first successful query **3 ms** after the server is back (postgres.js: 55 ms).

### Other runtimes

Throughput in operations per second:

| Scenario                | quarry (Bun) | Bun.sql | pg (Bun) | quarry (Deno) | pg (Deno) | deno-postgres |
| ----------------------- | -----------: | ------: | -------: | ------------: | --------: | ------------: |
| Point lookup            |   **38,433** |  33,692 |   23,179 |    **29,272** |    18,637 |        12,874 |
| Fetch 1,000 rows        |    **3,468** |   2,505 |      996 |     **2,870** |       700 |           123 |
| Insert, 50 callers      |  **254,789** | 135,225 |  100,868 |   **183,080** |    69,959 |        21,855 |
| `begin; insert; commit` |   **20,036** |  11,184 |   13,431 |    **16,092** |    10,589 |         8,428 |

Bun.sql, which is implemented natively inside the runtime, is the closest competitor; quarry still leads it on every row above. The same JavaScript is fastest on Bun, followed by Node and then Deno.

### Through PgBouncer

| Scenario (Node 24, PgBouncer 1.26, transaction mode) |     quarry |         pg | pg (named) | postgres.js |
| ---------------------------------------------------- | ---------: | ---------: | ---------: | ----------: |
| Point lookup, 50 callers (ops/s)                     | **77,192** |     67,533 |     61,375 |      38,633 |
| Fetch 1,000 rows (ops/s)                             |  **2,543** |        721 |        736 |         791 |
| `begin; insert; commit` (ops/s)                      |  **9,154** |      6,523 |      6,574 |       6,025 |
| `select 1`, sequential (ops/s)                       |     17,356 | **20,290** |     19,115 |      18,914 |

### Where quarry doesn't lead

- **Sequential queries through PgBouncer.** quarry keeps 43–56% of its direct throughput through PgBouncer, the lowest share of any client, and `pg` is faster for a sequential `select 1` (20,290 vs 17,356 ops/s). Under concurrency, or with real rows to decode, quarry leads again.
- **The extreme tail on trivial queries.** postgres.js has the best p99.9 latency for `select 1` and point lookups (156 µs vs quarry's 354 µs). quarry leads at p50, p90 and p99.
- **Garbage collection on very large results.** Fetching 100,000 rows in one result, quarry spends 228 ms per second in GC against `pg`'s 143, with a longest pause of 34 ms on the 1M-row fetch. If you read huge results, use a [cursor](#cursors-streaming-and-copy): streaming 1M rows peaks at 147 MB with event-loop lag under 2 ms.
- **Large `jsonb` values.** With 200 KB `jsonb` documents, `pg (named)` is slightly faster (23.5 ms vs 24.8 ms) and uses less memory. JSON parsing dominates and is the same `JSON.parse` for everyone.

### Running the benchmarks yourself

```sh
cd bench/driver/suite
./setup.sh                                   # PostgreSQL 18, PgBouncer, Toxiproxy, wsproxy, runtimes
node orchestrate.ts --id run1                # every cell, resumable
node footprint.ts --id run1                  # install size, bundle size, cold start
node analyze.ts --id run1                    # the tables above
python3 charts.py results/run1/summary.json charts/
```

Set `QUARRY_DIST` to benchmark a different build of the driver, and `QUARRY_DIST_CANDIDATE` to run a before/after comparison of a change in the same session (`compare.ts` reports the differences with confidence intervals). Snapshots of earlier runs are kept in `bench/driver/suite/results-snapshots/`.

A quicker comparison against `pg` and postgres.js lives in the repository root: `pnpm bench:driver`.

## Connecting

A single connection:

```ts
import { connect } from 'quarry/driver';

await using conn = await connect('postgres://app@db.internal/app');
const { rows } = await conn.query('select now()');
```

A pool, which is what most applications want:

```ts
import { createPool } from 'quarry/driver';

const pool = createPool({
	connectionString: process.env.DATABASE_URL,
	max: 20,
});

await pool.query('select 1');
await pool.end();
```

Both `Connection` and `Pool` implement `AsyncDisposable`, so `await using` closes them when the scope ends.

### Where options come from

Options are resolved like libpq, in this order, the first one that sets a value winning:

1. the options object passed to `connect` or `createPool`;
2. the connection string (`postgres://user:pass@host:port/db?sslmode=verify-full` or `host=… dbname=…`);
3. `PG*` environment variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`, `PGAPPNAME`, `PGOPTIONS`, `PGTARGETSESSIONATTRS`, `PGSSLCERT`, `PGSSLKEY`, …);
4. the password file (`passfile`, `PGPASSFILE`, or `~/.pgpass`).

### Connection options

| Option               | Default                    | Description                                                                                                                        |
| -------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `connectionString`   |                            | A `postgres://` URL or a `key=value` string. Explicit options override it.                                                         |
| `host`               | `localhost`                | Host name, IP address, or Unix-socket directory (starting with `/`). Comma-separated for failover.                                 |
| `port`               | `5432`                     | Port, or comma-separated ports matching `host`.                                                                                    |
| `user`               | the OS user                |                                                                                                                                    |
| `password`           |                            | A string, or a function returning one (or a promise of one), called for every new connection. Use this for short-lived IAM tokens. |
| `database`           | the user name              |                                                                                                                                    |
| `applicationName`    |                            | Shown in `pg_stat_activity`.                                                                                                       |
| `ssl`                | see [TLS](#tls)            | An `sslmode` string, or an options object.                                                                                         |
| `channelBinding`     | `'prefer'`                 | SCRAM channel binding: `'disable'`, `'prefer'` or `'require'`.                                                                     |
| `requireAuth`        |                            | Authentication methods to accept, as libpq's `require_auth`. See [Authentication](#authentication).                                |
| `connectTimeout`     | `30000`                    | Milliseconds allowed to connect and authenticate. `0` for none.                                                                    |
| `keepAlive`          | `true`                     | TCP keep-alive, with `keepAliveInitialDelay` in milliseconds.                                                                      |
| `targetSessionAttrs` | `'any'`                    | With several hosts: `'any'`, `'read-write'`, `'read-only'`, `'primary'`, `'standby'` or `'prefer-standby'`.                        |
| `params`             |                            | Startup parameters, e.g. `{ search_path: 'app', timezone: 'UTC' }`.                                                                |
| `options`            |                            | Command-line options for the server, as `PGOPTIONS` (e.g. `'-c statement_timeout=5s'`).                                            |
| `passfile`           | `PGPASSFILE` / `~/.pgpass` | A password file in `.pgpass` format.                                                                                               |
| `codecs`             | `defaultCodecs`            | Codecs to read result columns with, by type, over the defaults, or a registry. See [Decoding results](#decoding-results).          |
| `prepare`            | `true`                     | Use named prepared statements, cached per connection.                                                                              |
| `statementCacheSize` | `100`                      | Prepared statements kept per connection (least recently used are deallocated).                                                     |
| `preparePipelined`   | detected                   | Use named statements for pipelined queries too. See [Poolers and proxies](#poolers-and-proxies).                                   |
| `binaryResults`      | `true`                     | Receive columns in binary where their codec reads them so.                                                                         |
| `protocol`           | `'auto'`                   | `'auto'` asks for 3.2 and accepts what the server negotiates; `'3.0'` or `'3.2'` insists on that version.                          |
| `minProtocolVersion` | `'3.0'`                    | The oldest protocol version to accept.                                                                                             |
| `maxProtocolVersion` | `'latest'`                 | The newest protocol version to ask for.                                                                                            |
| `telemetry`          |                            | An OpenTelemetry tracer. See [Observability](#observability).                                                                      |
| `captureStack`       | `false`                    | Append the calling code's stack to query errors (a few hundred nanoseconds per query).                                             |
| `onNotice`           |                            | Called with every `NOTICE`, `WARNING` and other non-error message the server sends.                                                |
| `onNotification`     |                            | Called with every `NOTIFY` delivered to the connection.                                                                            |
| `maxMessageSize`     |                            | Refuse server messages larger than this many bytes.                                                                                |
| `socket`             | picked by runtime          | A `SocketFactory`, for runtimes other than Node, Bun, Deno and Workers.                                                            |
| `env`                | `process.env`              | The environment to read `PG*` variables from.                                                                                      |

`createPool` accepts all of these, plus the [pool options](#pool-options).

### Multiple hosts and failover

```ts
const pool = createPool({
	host: 'db-1.internal,db-2.internal,db-3.internal',
	targetSessionAttrs: 'read-write',
});
```

Hosts are tried in order. With `targetSessionAttrs`, a host that is reachable but of the wrong kind (a standby when you asked for `read-write`) is skipped, exactly as with libpq. `prefer-standby` tries standbys first and falls back to a primary.

## TLS

`ssl` takes libpq's `sslmode` values:

| Mode          | Encrypts     | Verifies the certificate | Verifies the host name |
| ------------- | ------------ | ------------------------ | ---------------------- |
| `disable`     | no           | no                       | no                     |
| `allow`       | if required  | no                       | no                     |
| `prefer`      | if available | no                       | no                     |
| `require`     | yes          | no                       | no                     |
| `verify-ca`   | yes          | yes                      | no                     |
| `verify-full` | yes          | yes                      | yes                    |

**The default is `verify-full` for remote hosts**, and `prefer` for `localhost` and Unix sockets. Unlike libpq's historical `prefer` default, a remote connection is never silently unencrypted or unverified.

```ts
connect({ host: 'db.example.com', ssl: { mode: 'verify-full', ca: pem } });
connect({
	host: 'db.example.com',
	ssl: { mode: 'verify-full', rootCertFile: 'system' },
});
connect({
	host: 'db.example.com',
	ssl: { mode: 'require', negotiation: 'direct' },
});
```

- **Trust roots.** The verify modes use, in order: `ca` (PEM, or an array of PEMs), `rootCertFile` (a path, or `'system'` for the platform's store), `~/.postgresql/root.crt`, and finally the platform's CA store.
- **Direct TLS.** `negotiation: 'direct'` (PostgreSQL 17+) starts TLS immediately instead of sending an `SSLRequest` first, saving a round trip on every connect.
- **Client certificates.** See [Authentication](#authentication).

## Authentication

- **Passwords.** SCRAM-SHA-256, with `tls-server-end-point` channel binding (SCRAM-SHA-256-PLUS) whenever TLS allows; md5; and cleartext. `password` can be a function, called for each new connection:

  ```ts
  createPool({
  	host: 'mydb.cluster.us-east-1.rds.amazonaws.com',
  	user: 'app',
  	password: () => signer.getAuthToken(), // a fresh IAM token per connection
  });
  ```

- **Refusing weak methods.** `requireAuth` follows libpq's `require_auth`: a server that asks for anything else is refused, so it can't downgrade the client.

  ```ts
  connect({ requireAuth: 'scram-sha-256' });
  connect({ requireAuth: '!password,!md5,!none' });
  connect({ channelBinding: 'require' }); // insist on SCRAM-SHA-256-PLUS
  ```

- **Client certificates** (`cert` authentication): `ssl: { cert, key }` as PEM strings, or `certFile` / `keyFile`, with `passphrase` for an encrypted key. The libpq equivalents work too: `sslcert`, `sslkey` and `sslpassword` in the connection string, `PGSSLCERT` / `PGSSLKEY`, or `~/.postgresql/postgresql.crt` and `.key`.
- **Not supported:** OAuth (`OAUTHBEARER`, new in PostgreSQL 18), GSSAPI, SSPI and Kerberos. A server that offers only one of these fails with a `ConnectionError` whose `code` is `'EAUTHMETHOD'`, naming the method.

## Runtimes

| Runtime            | Socket                  | Notes                                                                                                                                                                                                |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node               | `node:net` / `node:tls` | Every feature.                                                                                                                                                                                       |
| Bun                | `node:net` / `node:tls` | Every feature.                                                                                                                                                                                       |
| Deno               | `node:net` / `node:tls` | Every feature.                                                                                                                                                                                       |
| Cloudflare Workers | `cloudflare:sockets`    | Picked automatically. Workers' TLS always verifies against public CAs and doesn't expose the server certificate, so custom CAs, client certificates, direct TLS and channel binding are unavailable. |
| Anything else      | your `SocketFactory`    | Pass `socket`. The interface is small: connect, write, read, upgrade to TLS, close.                                                                                                                  |

## Queries

```ts
const { rows, rowCount, command, fields } = await pool.query(
	'select id, email from users where created_at > $1',
	[since],
);
```

A `QueryResult` has:

| Field      | Description                                                                        |
| ---------- | ---------------------------------------------------------------------------------- |
| `rows`     | The decoded rows: objects keyed by column name, or arrays with `rowMode: 'array'`. |
| `rowCount` | Rows returned or affected, from the command tag; `null` for commands without one.  |
| `command`  | The command tag's verb: `SELECT`, `INSERT`, `UPDATE`, …                            |
| `fields`   | Each column's name, type OID, type modifier, and source table and column.          |

Per-query options:

```ts
await pool.query(sql, params, {
	rowMode: 'array', // positional rows
	signal, // an AbortSignal that cancels the query
	timeout: 5000, // client-side deadline, in ms
	statementTimeout: '2s', // server-side statement_timeout for this query only
	paramTypes: [arrayOids.int4],
	paramCodecs: [codecs.int4], // encode $1 with this codec, and declare its type
	resultCodecs: [codecs.int4, codecs.timestamptz], // the codec each column is expected in
	codecs: [codecs.int8AsString], // codecs by type for this query only
	prepare: false, // send this one unnamed
	keepRows: 1, // decode only the first row; rowCount still counts all
	tag: 'orders.recent', // a label for telemetry spans
	onTiming: (t) => log(t), // where the query spent its time once it settles
});
```

Other ways to run SQL:

```ts
// Several statements, no parameters (the simple query protocol):
const results = await pool.simpleQuery(
	'create table t (id int); insert into t values (1);',
);

// A statement's parameter and result types, without running it:
const { paramTypes, fields } = await pool.describe(
	'select * from users where id = $1',
);
```

## Parameters

Parameters are always sent separately from the SQL text, never interpolated.

| JavaScript value    | Sent as                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `string`            | Unchanged.                                                                                                                  |
| `number`, `bigint`  | Their decimal text.                                                                                                         |
| `boolean`           | `t` / `f`.                                                                                                                  |
| `Date`              | A UTC timestamp. A `timestamp without time zone` column receives the UTC wall-clock time, whatever the process's time zone. |
| `null`, `undefined` | SQL `NULL`.                                                                                                                 |
| `Uint8Array`        | Binary, as is.                                                                                                              |
| Arrays              | A Postgres array literal, or binary when the type is declared (below).                                                      |
| Other objects       | JSON.                                                                                                                       |

**Typed parameters.** `typed(value, codec)` gives a parameter a [codec](#codecs): the value is encoded by it, once, and its type is declared at Parse, so Postgres doesn't have to infer it. That is how a range is tested against a single instant, where an untyped point would be read as a range:

```ts
import { arrayOf, codecs, typed } from 'quarry/driver';

await pool.query('select $1 @> $2 as inside', [
	typed(range, codecs.tstzrange),
	typed(new Date(), codecs.timestamptz),
]);

await pool.query(
	'insert into items (id, name) select * from unnest($1::int4[], $2::text[])',
	[typed(ids, arrayOf(codecs.int4)), typed(names, arrayOf(codecs.text))],
);
```

Text-like codecs (`text`, `varchar`, `char`, `name`, and `codecs.raw`) leave the parameter's type to the server, so a string still goes into a `citext`, enum or `char(n)` column as before. Types looked up by name (enums, domains, extensions) declare their OID once the pool's catalog has it. The statement cache keys on the declared types, so the same SQL with differently typed parameters is prepared once per typing.

**Binary arrays.** Arrays of `bool`, `int2`, `int4`, `int8`, `float8`, `timestamptz` (from `Date`s), `uuid`, `jsonb` and `bytea` are sent in binary by their `arrayOf` codec (and, without a codec, when `paramTypes` declares the array's type), which the server reads far more cheaply than a literal. An element that doesn't fit falls back to a literal. Text arrays go as literals of a type the server infers.

The query builder gives every parameter its column's codec: multi-row inserts and `setEach` updates send each column as `arrayOf` its codec, and `column = any($1)` the same.

A query takes at most 65,535 parameters, the protocol's limit; more are refused before anything is sent. For more rows than that, use `unnest` with array parameters, or `COPY`.

## Decoding results

Values are decoded per column by a codec: the one the query expects for that column (`resultCodecs`, as the query builder always gives), or the registry's codec for the column's type OID. A type without one is the server's text.

| `codecs`        | Behaviour                                                                                                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultCodecs` | The default, and lossless: `int2`/`int4`/`float4`/`float8` become numbers, `int8` a `bigint`, `bool` a boolean, `json`/`jsonb` parsed, `bytea` a `Uint8Array`, arrays of those and of text-like types. `numeric`, dates and times stay as text, since no JavaScript type holds them exactly. |
| a list          | Codecs registered over the defaults, by type: each overrides the default for its type, and brings its array type's codec.                                                                                                                                                                    |

```ts
import { codecs, createPool, defineCodec } from 'quarry/driver';

const decimal = defineCodec({
	name: 'numeric',
	oid: 1700,
	arrayOid: 1231,
	encode: (value: Decimal) => value.toString(),
	decodeText: (text) => new Decimal(text),
});

const pool = createPool({
	codecs: [codecs.int8AsString, codecs.timestamptz, decimal],
});
```

### Codecs

A codec is one type's encoding, both ways:

| Field                         | Meaning                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `name`, `oid`, `arrayOid`     | The type. `oid: 0` means it is looked up by `name` in `pg_type` (enums, domains, extension types), once per pool. |
| `paramFormat`                 | `'text'` or `'binary'`: what `encode` returns.                                                                    |
| `resultFormat`                | The format its results are asked for in. `'binary'` needs `decodeBinary`.                                         |
| `inferParamType`              | Leave a parameter's type to the server instead of declaring `oid`.                                                |
| `encode(value)`               | A non-null value as a string, or bytes in the binary format.                                                      |
| `decodeText(text)`            | A non-null value from the server's text.                                                                          |
| `decodeBinary(b, start, end)` | Optional: a non-null value from its binary format.                                                                |

`codecs` holds the built-in ones, by type: `bool`, `int2`, `int4`, `oid`, `int8` (a `bigint`), `int8AsString`, `float4`, `float8`, `numeric` (a string), `text`, `varchar`, `bpchar`, `name`, `char`, `uuid`, `bytea`, `json`, `jsonb`, `timestamptz` (a `Date`), `timestamptzAsString`, `date`, `time`, `timetz`, `timestamp`, `interval`, `inet`, `cidr`, `macaddr`, `money`, `xml`, `bit`, `varbit`, `point`, `box`, `tsvector`, `tsquery`, `jsonpath`, `daterange` and `tstzrange` (as `RangeValue`), pgvector's `vector`, and `raw`, which keeps any type as the server's text both ways. `arrayOf(codec)` is the codec of its arrays, of any number of dimensions. `defineCodec({ name, encode, decodeText })` fills in the rest of a codec for a type of your own, looked up by name.

Which types are binary follows what is cheaper in JavaScript: binary where the value is a number, a `Date`, bytes, or an array of those (and pgvector's vectors), text where the value is a string anyway (`int8` as a string, `numeric`, `uuid`, dates, text types, enums) or the binary format carries the same text (`jsonb`).

**Types looked up by name.** A codec whose `oid` is 0 is resolved through `pg_type` once per pool: the first query that needs one loads the catalog behind it (that query still runs, its parameter's type inferred and its column read as text), or `pool.loadTypes()` loads it up front; `pool.reloadTypes()` looks them up again, for types created since. A domain's columns are reported as its base type, so its codec is the base type's.

The module also exports `oids` and `arrayOids` (type OIDs by name), helpers for your own codecs (`parseArray`, `parseRange`, `parseTimestamptz`, `parseBytea`, `formatTimestamp`), and `createCodecRegistry(list, base?)`, to build a registry once and pass it per pool or per query (`createCodecRegistry([], null)` reads every value as the server's text).

**Binary results.** Columns are received in binary where their codec reads them so; the values are identical, only the cost differs. A format is only asked for once the server has described the statement's columns: from a cached statement's second run, never on a first run or an unprepared query. Each column is read with the codec the query expects for it (`resultCodecs`) when the described type is that codec's, and with the registry's codec for the described type otherwise, so a column whose type changed (schema drift) still decodes. Turn binary off with `binaryResults: false`.

**pgvector.** `codecs.vector` returns the float32 values pgvector stores, on every path: `[0.1]` reads as `[0.10000000149011612]`, the value pgvector holds and the value its binary format carries.

**Decode errors** fail only the query they belong to, with a `DecodeError` naming the column and type (never the value). The connection stays usable.

## Prepared statements

Statements are prepared and cached per connection: up to `statementCacheSize` (100), least recently used first out. A repeated query then skips parsing and planning on the server, and its result columns are known in advance, which is what makes binary results possible.

- **Schema changes.** A cached statement that a schema change made stale (its result type or an inferred parameter type changed), or that the server no longer has (`DEALLOCATE`, `DISCARD ALL`), is retried once as an unnamed statement, outside a transaction.
- **Opting out.** `prepare: false` on the connection or pool, or per query.
- **Behind poolers**, see [Poolers and proxies](#poolers-and-proxies).

## Pipelining

Queries issued concurrently on one connection are pipelined: they go out in shared socket writes, and the replies come back in order. Each query still has its own Sync, so outside a transaction one failing query doesn't fail its neighbours.

Writes respect backpressure. A long queue goes out in 64 KiB chunks, and once the socket's buffer is full, the remaining queries wait unencoded until it drains, so a deep pipeline or large parameters can't pile up in memory.

On a pool, pipelining kicks in once every connection is busy; see [`pipeline`](#pool-options). The benchmarks show what it's worth: [about 5× the throughput of `pg` on ten connections, and 480× on one connection over a 20 ms network](#concurrency-and-pipelining).

## Cancellation and timeouts

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 1000);

await pool.query('select pg_sleep(10)', [], { signal: controller.signal });
```

| Mechanism          | Enforced by | Behaviour                                                                                                                                                                                         |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signal`           | client      | Cancels a running query (with a cancel request over a new connection), or drops one not yet sent. A query pipelined behind others is cancelled when the server reaches it, never one ahead of it. |
| `timeout`          | client      | A deadline that cancels the query, as `signal` would.                                                                                                                                             |
| `statementTimeout` | server      | Sets `statement_timeout` with `set_config(…, true)`, local to the query's transaction, so it never leaks into other sessions behind a pooler.                                                     |
| `conn.cancel()`    | client      | Cancels whatever is running on the connection.                                                                                                                                                    |

A cancelled query rejects with `QueryCanceled`, whose `reason` is `'abort'`, `'timeout'`, `'statement_timeout'` or `'user'`.

## Cursors, streaming and COPY

```ts
// Batches of rows, fetched as you consume them:
for await (const batch of conn.cursor('select * from events', [], {
	batchSize: 1000,
})) {
	await process(batch);
}

// One row at a time (on a dedicated pool connection):
for await (const row of pool.stream('select * from events where day = $1', [
	day,
])) {
	await process(row);
}

// Bulk insert from arrays of values, encoded like parameters:
await pool.copyRows('copy items (id, name) from stdin', [
	[1, 'first'],
	[2, 'second'],
]);

// Raw COPY in, from any async iterable of chunks:
await pool.copyFrom(
	'copy items from stdin with (format csv)',
	fs.createReadStream('items.csv'),
);

// Raw COPY out:
for await (const chunk of pool.copyTo(
	'copy items to stdout with (format csv)',
)) {
	out.write(chunk);
}
```

A cursor fetches a batch only when you ask for the next one, so a slow consumer holds one batch in memory however large the result; a paused COPY consumer pauses the socket the same way. Its columns come in the formats their codecs read, binary where they can, from the first run: a statement not yet cached is described first (one more round trip, once per statement and connection).

- **Outside a transaction**, the portal lives in the implicit transaction of one protocol sync, so the cursor holds its connection until it is read to the end or closed, and other queries on that connection wait. `pool.cursor` and `pool.stream` take a connection of their own; on a single connection or a reserved client, don't run queries on the same connection inside the loop.
- **Inside a transaction**, the cursor is a named portal read with one Execute and Sync per batch, so the transaction's other queries run between its batches, and several cursors can be read at once. The portal is closed when the iteration ends.
- **Leaving early** (`break`, `return`, a throw, `return()`, or `await using` on a stream) closes the portal and frees the connection.
- **`signal` and `timeout`** stop the whole cursor, whenever they fire. Between batches, the portal is closed without a cancel request and the next batch rejects with `AbortError`; while a batch runs, it is canceled (`QueryCanceled`, reason `'abort'` or `'timeout'`), which inside a transaction fails the transaction like any canceled statement.
- **`statementTimeout`** bounds the cursor from its first batch to its last, your loop's time included. It runs the cursor in a transaction of its own (`begin`, `set_config(…, true)`, the cursor, `commit`, pipelined), and is refused inside a transaction, where other queries run between batches: use `set_config` there.
- **A stream is an async iterable**, so `Readable.from(stream)` and `ReadableStream.from(stream)` read it with backpressure and close it when destroyed or canceled.
- **Long streams hold a snapshot.** An open cursor keeps its backend's `xmin`, which holds back vacuum, and outside a transaction it is never "idle in transaction", so `idle_in_transaction_session_timeout` doesn't end it; use `statementTimeout` to bound it.

## LISTEN and NOTIFY

```ts
const unlisten = await pool.listen('orders', (notification) => {
	console.log(notification.channel, notification.payload);
});

await pool.query("select pg_notify('orders', $1)", [JSON.stringify(order)]);
// or, on a connection: await conn.notify('orders', payload);

await unlisten();
```

`pool.listen` holds a dedicated connection and re-subscribes every channel automatically after a reconnect. On a single connection, `conn.listen(channel, handler)` does the same for that connection. `LISTEN` needs a direct or session-mode connection; it doesn't survive between transactions behind a transaction-mode pooler.

## Transactions

```ts
const order = await pool.transaction(
	async (tx) => {
		const { rows } = await tx.query(
			'insert into orders (total) values ($1) returning id',
			[total],
		);
		await tx.transaction(async (sp) => {
			await sp.query('insert into audit (order_id) values ($1)', [rows[0].id]);
		}); // a savepoint
		tx.afterCommit(() => queue.publish('order.created', rows[0].id));
		return rows[0];
	},
	{
		isolation: 'serializable',
		retries: 3,
		settings: { 'app.tenant_id': tenantId },
	},
);
```

| Option       | Description                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `isolation`  | `'read uncommitted'`, `'read committed'`, `'repeatable read'` or `'serializable'`.                                |
| `readOnly`   | Start a read-only transaction.                                                                                    |
| `deferrable` | With `serializable` and `readOnly`: wait for a snapshot that can't fail.                                          |
| `retries`    | Re-run the callback after a serialization failure or deadlock, up to this many times. Nothing else is retried.    |
| `retryDelay` | Milliseconds before retry `attempt` (1-based). Defaults to jittered exponential backoff.                          |
| `settings`   | Transaction-local settings, applied with `set_config(…, true)` and bound parameters, e.g. for row-level security. |
| `timeout`    | End the transaction if it runs longer than this: milliseconds, or an interval string like `'30s'`.                |
| `durable`    | Throw if a transaction is already open, instead of nesting as a savepoint.                                        |

- **Commit and rollback.** The transaction commits when the callback resolves and rolls back when it throws.
- **Two round trips.** `BEGIN`, with its settings, is sent together with the callback's first statement under one Sync. If `BEGIN` fails, the server skips that statement and the transaction rejects with `BEGIN`'s error. Savepoint `RELEASE`s aren't waited for: if one fails, the next statement or the `COMMIT` reports it.
- **Swallowed errors are caught.** If a statement fails inside the callback and you catch the error, the server turns the `COMMIT` into a `ROLLBACK`. The driver notices and throws `TransactionRolledBack` rather than reporting success.
- **Hooks.** `tx.afterCommit(fn)` runs once the outermost transaction commits, and is dropped if it rolls back or is retried, so it's the place for side effects. `tx.afterRollback(fn)` runs if this transaction or savepoint rolls back. `tx.setLocal(name, value)` sets a run-time parameter until the end of the transaction, with a bound value.

## The pool

```ts
const pool = createPool({
	connectionString: process.env.DATABASE_URL,
	max: 20,
	min: 2,
	idleTimeout: 30_000,
	onConnect: (conn) => conn.query("set application_name = 'worker'"),
});
```

### Pool options

| Option           | Default   | Description                                                                                                                             |
| ---------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `max`            | `10`      | The most connections open at once.                                                                                                      |
| `min`            | `0`       | Connections kept open even when idle.                                                                                                   |
| `idleTimeout`    | `30000`   | Close connections idle this long (ms). `0` never.                                                                                       |
| `maxLifetime`    | `3600000` | Replace connections older than this (ms), with up to 10% jitter so they don't all recycle at once. Applies to idle ones too. `0` never. |
| `acquireTimeout` | `30000`   | How long `acquire` waits for a free connection (ms). `0` forever.                                                                       |
| `maxWaiting`     | unlimited | The most callers waiting before `acquire` fails fast.                                                                                   |
| `pipeline`       | adaptive  | How queries share connections once all are busy (below).                                                                                |
| `onConnect`      |           | Runs on each new connection before it is used.                                                                                          |

**`pipeline`.** Once every connection is busy, `query`, `simpleQuery` and `describe` are pipelined onto shared connections; beyond the depth limit, they wait in line for the next free slot.

- **Adaptive (default).** The depth starts at 100 queries in flight per connection. While queries are waiting and finish nearly as fast as the round trip allows (the network, not the server, is the limit), it grows by half each round trip, up to 1,000. Once queries start queueing on the server, more depth would only line them up behind each other, so it shrinks back towards 100.
- **A number** fixes the depth. **`false`** gives every query a connection to itself, like `pg`.
- **Exclusive work never shares.** Reserved clients, transactions, cursors and COPY always get a connection of their own. While one waits, a shared connection stops taking new queries and is handed over as soon as the ones in flight finish, so a steady stream of queries can't starve it.

### Reserving a connection

```ts
await using client = await pool.acquire();
await client.query("select set_config('work_mem', $1, false)", ['256MB']);
await client.query('create temporary table scratch (id int)');
// released when the scope ends, or call client.release()
```

Connections that die, or are released mid-transaction, are discarded rather than returned to the pool. `client.release(error)` discards explicitly.

### Stats and shutdown

```ts
pool.stats; // { total, idle, busy, waiting }

await pool.end(); // finish issued work, then close
await pool.end({ timeout: 5000 }); // fail whatever is still running after 5 s
```

`pool.end()` stops new work and closes once the work already issued is done: queued queries and waiting callers still get a connection, and reserved clients and transactions keep theirs until released.

## Poolers and proxies

**Protocol version.** The driver asks for protocol 3.2 and accepts 3.0 from poolers that negotiate down. A pooler that rejects 3.2 outright gets one retry with 3.0. `minProtocolVersion` and `maxProtocolVersion` override this.

**PgBouncer in transaction mode** (tested with 1.26):

- **Prepared statements** work from PgBouncer 1.21 with `max_prepared_statements` set. PgBouncer 1.26+ without it is detected at login, and no statement is named. For older versions or other poolers without prepared-statement support, use `prepare: false`.
- **Pipelined queries are sent unnamed.** PgBouncer rewrites the statement name in every named Bind, flushing what it holds and writing the new name separately, so each named query reaches the server in two writes instead of sharing one. Under load the single-threaded pooler is the bottleneck, and that costs it more than re-parsing costs the server. So a query pipelined with others on its connection is sent unnamed (Parse, Bind, Describe), still with its cached columns and binary formats; a query alone on its connection stays named. PgBouncer 1.26+ reports itself at login (`connection.capabilities.pgbouncer`); for 1.21–1.25, set `preparePipelined: false`.
- **Stale statements.** Behind PgBouncer, which maps a new Parse of the same text back to the statement it already prepared, SQL that still comes back stale after a retry is no longer prepared on that connection.
- **Cursors and streams** work in transaction mode without an explicit transaction: until the cursor ends, the server sends no ReadyForQuery, so PgBouncer keeps the server connection linked to it. Each open stream holds one server connection for its lifetime, so `default_pool_size` streams at once fill the pool; keep long streams on a pool sized for them. Statement mode can't run cursors.

**Session state** (`SET`, `LISTEN`, temporary tables, session advisory locks) doesn't survive between transactions in transaction mode. The driver's own settings never rely on it: `statementTimeout`, transaction `settings` and `timeout` all go through `set_config(…, true)` inside a transaction.

**RDS Proxy, Supavisor, Neon and other transaction poolers** follow the same rules. Avoid session-level `SET`, which can pin a session to a server connection. If a proxy pins or rejects named prepared statements, use `prepare: false`.

`connection.capabilities` reports what poolers and proxies may change: the negotiated `protocol`, `serverVersion` (when reported), `pgbouncer` (its version and settings, when detected) and the `saslMechanisms` the server offered.

## Errors

Errors the server reports are `PostgresError`s; errors raised in the client are `DriverError`s.

| Class                     | When                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PostgresError`           | The server reported an error. `isRetryable` is true for serialization failures and deadlocks. Carries every field the server sent (`code`, `detail`, `hint`, `schema`, `table`, `column`, `constraint`, `position`, …) plus `query`, which is non-enumerable so parameters don't leak into logs. |
| `ConnectionError`         | Connecting, TLS or authentication failed, or the connection was lost. `code` says which.                                                                                                                                                                                                         |
| `ProtocolError`           | The server sent something the protocol doesn't allow.                                                                                                                                                                                                                                            |
| `AbortError`              | A query was dropped before it was sent.                                                                                                                                                                                                                                                          |
| `UndefinedParameterError` | The SQL refers to a `$n` parameter that wasn't supplied, caught before anything is sent.                                                                                                                                                                                                         |
| `DecodeError`             | A result value couldn't be decoded. Names the column and type, never the value.                                                                                                                                                                                                                  |
| `TransactionRolledBack`   | A `COMMIT` turned into a `ROLLBACK` because an error inside the transaction was swallowed.                                                                                                                                                                                                       |

Common SQLSTATEs have their own subclasses of `PostgresError`, so you can catch them with `instanceof`. The constraint violations share a base class, `IntegrityConstraintViolation`, whose `columns` getter lists the columns the error names (from its `column` field, or parsed from its detail):

| Class                      | SQLSTATE | Notes                               |
| -------------------------- | -------- | ----------------------------------- |
| `UniqueViolation`          | `23505`  | `columns`                           |
| `ForeignKeyViolation`      | `23503`  | `columns`                           |
| `NotNullViolation`         | `23502`  | `columns`                           |
| `CheckViolation`           | `23514`  | `columns`, when the error names any |
| `ExclusionViolation`       | `23P01`  | `columns`                           |
| `SerializationFailure`     | `40001`  | `isRetryable` is true               |
| `DeadlockDetected`         | `40P01`  | `isRetryable` is true               |
| `QueryCanceled`            | `57014`  | `reason` says why                   |
| `LockNotAvailable`         | `55P03`  |                                     |
| `ReadOnlyTransaction`      | `25006`  |                                     |
| `IdleInTransactionTimeout` | `25P03`  |                                     |
| `TransactionTimeout`       | `25P04`  |                                     |
| `UndefinedTable`           | `42P01`  |                                     |
| `UndefinedColumn`          | `42703`  |                                     |

```ts
import { UniqueViolation } from 'quarry/driver';

try {
	await pool.query('insert into users (email) values ($1)', [email]);
} catch (error) {
	if (error instanceof UniqueViolation)
		return { ok: false, reason: 'email taken' };
	throw error;
}
```

## Observability

**OpenTelemetry.** Pass a tracer and every query becomes a client span following OpenTelemetry's database conventions (`db.system.name`, `db.namespace`, `db.operation.name`, `db.query.text`, `server.address`, `server.port`). The driver doesn't depend on `@opentelemetry/api`; anything with the shape of a `Tracer` works.

```ts
import { trace } from '@opentelemetry/api';

createPool({
	telemetry: {
		tracer: trace.getTracer('app'),
		queryText: true, // record the SQL; parameters are never recorded
	},
});
```

**Notices.** `onNotice` receives `NOTICE`, `WARNING`, `INFO`, `LOG` and `DEBUG` messages, e.g. from `raise notice` in a function.

**Stack traces.** `captureStack: true` appends the stack of the code that issued a query to its error, so a failure points at your code rather than the driver's socket handler. The query builder does this by default.

**Connection state.** `conn.processId`, `conn.parameters` (server parameters such as `server_version` and `TimeZone`), `conn.transactionStatus`, `conn.protocol` and `conn.capabilities`.

---

# Part II: The query builder

> **In progress.** The query builder is under active development. The API below is the intended surface for 1.0; names and details may still change before the first release. The driver it runs on is stable.

The query builder turns table definitions into types, and types into checks. It is built on four ideas:

- **Types follow PostgreSQL.** A column's TypeScript type is what the driver actually returns for it (`bigint` and `numeric` are strings, `timestamptz` is a `Date`), and a comparison only accepts what Postgres would accept: a `uuid` column can't be compared with a `text` expression, even though both are strings in JavaScript.
- **Invalid queries don't compile.** An `update` or `delete` without a `where` can't run; neither can an insert without values. Modifiers that Postgres forbids together (`identity()` with `default()`) simply aren't offered by autocomplete.
- **Nothing runs by accident.** Builders are immutable descriptions. A query runs only when you call `execute()`, and awaiting a builder by mistake throws instead of silently doing nothing.
- **The code and the database agree.** `quarry verify` compares your table definitions with the live schema and points at the line that's wrong.

## Defining tables

```ts
import {
	array,
	bigint,
	boolean,
	decimal,
	defineEnum,
	defineTable,
	integer,
	jsonb,
	text,
	timestamptz,
	uuid,
	varchar,
} from 'quarry';

export const role = defineEnum('user_role', ['admin', 'member', 'guest']);

export const users = defineTable('users', {
	columns: {
		id: integer().identity(),
		email: varchar(320),
		name: text().nullable(),
		managerId: integer().name('manager_id').nullable(),
		role: role().default(),
		tags: array(text()).default(),
		settings: jsonb<{ theme: 'light' | 'dark' }>().default(),
		createdAt: timestamptz().name('created_at').default(),
	},
});

export const posts = defineTable('posts', {
	columns: {
		id: bigint().identity(),
		authorId: integer().name('author_id'),
		title: text(),
		body: text(),
		published: boolean().default(),
		price: decimal(10, 2).nullable(),
		publicId: uuid().name('public_id').default(),
	},
});
```

Each column is declared under the key you'll use in TypeScript. `.name('created_at')` maps it to a different name in the database; the key is what appears in rows and references (`users.createdAt`).

### Column types

| Factory             | SQL type            | TypeScript value | Notes                                                                                   |
| ------------------- | ------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `smallint()`        | `smallint`          | `number`         | Can be an identity.                                                                     |
| `integer()`         | `integer`           | `number`         | Can be an identity.                                                                     |
| `bigint()`          | `bigint`            | `string`         | A string, because the range exceeds what a JS number holds exactly. Can be an identity. |
| `real()`            | `real`              | `number`         | Inexact; use `decimal()` for money.                                                     |
| `doublePrecision()` | `double precision`  | `number`         | Inexact.                                                                                |
| `decimal(p?, s?)`   | `numeric(p, s)`     | `string`         | Exact; a string so no digits are lost.                                                  |
| `boolean()`         | `boolean`           | `boolean`        |                                                                                         |
| `text()`            | `text`              | `string`         |                                                                                         |
| `varchar(n?)`       | `varchar(n)`        | `string`         |                                                                                         |
| `uuid()`            | `uuid`              | `string`         | Hyphenated form.                                                                        |
| `bytea()`           | `bytea`             | `Uint8Array`     | Read as a plain `Uint8Array`, never a `Buffer`, so it isn't narrowed. Binary both ways. |
| `date()`            | `date`              | `string`         | `'2026-10-14'`; no time zone to get wrong.                                              |
| `time()`            | `time`              | `string`         |                                                                                         |
| `timestamp()`       | `timestamp`         | `string`         | Wall-clock time without a zone, kept as text.                                           |
| `timestamptz()`     | `timestamptz`       | `Date`           |                                                                                         |
| `interval()`        | `interval`          | `string`         |                                                                                         |
| `jsonb<T>()`        | `jsonb`             | `T`, `JsonValue` | `T` describes the document. Untyped, any JSON value, JSON `null` included.              |
| `inet()`            | `inet`              | `string`         |                                                                                         |
| `tsvector()`        | `tsvector`          | `string`         | Usually `generated()`.                                                                  |
| `daterange()`       | `daterange`         | `Range<string>`  |                                                                                         |
| `tstzrange()`       | `tstzrange`         | `Range<Date>`    |                                                                                         |
| `vector()`          | `vector` (pgvector) | `number[]`       | The extension must be installed.                                                        |
| `array(column)`     | `element[]`         | `element[]`      | `array(text().nullable())` is `(string \| null)[]`. One dimension.                      |
| `defineEnum(...)()` | your enum type      | union of labels  | See [Enums](#enums).                                                                    |

Each factory's TypeScript type is its codec's: what the driver decodes the column to (see [Codecs on columns](#codecs-on-columns)).

A `Range<T>` is either `{ empty: true }` or `{ empty: false, lower, upper, bounds }`, where `lower` and `upper` are `null` when unbounded and `bounds` is `'[)'`, `'(]'`, `'[]'` or `'()'`. Modelling the empty range as its own variant means you can't read a bound before ruling it out.

### Modifiers

| Modifier            | Meaning                                                             | Effect on types                                     |
| ------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| `.nullable()`       | The column allows `NULL`.                                           | Adds `null` to the select, insert and update types. |
| `.default()`        | The database has a default.                                         | Optional on insert.                                 |
| `.generated()`      | `generated always as (…) stored`.                                   | Never written: excluded from inserts and updates.   |
| `.identity()`       | `generated always as identity` (integer types only).                | Never written: excluded from inserts and updates.   |
| `.name(n)`          | The column's name in the database.                                  | None.                                               |
| `.typed<S, I, U>()` | Narrow the select, insert and update types.                         | Each may only narrow the current type.              |
| `.useCodec(codec)`  | Send and read the column with another codec.                        | The codec's output on select, its input on writes.  |
| `.sensitive()`      | Redact its values in logs and errors ([below](#sensitive-columns)). | None.                                               |

Modifiers form a state machine that mirrors what Postgres allows. `nullable` combines with `default` or `generated`; `default` and `generated` exclude each other; `identity` excludes everything. Each modifier returns a column that only has the modifiers still valid, so an invalid chain isn't a type error on some method: the method isn't there.

### Narrowing types

Every factory but `bytea()` takes a type parameter that narrows its value, for branded ids and literal unions:

```ts
type UserId = number & { readonly __brand: 'UserId' };

const users = defineTable('users', {
	columns: {
		id: integer<UserId>().identity(),
		plan: text<'free' | 'pro' | 'team'>(),
		level: smallint<1 | 2 | 3>().default(),
	},
});
```

`.typed()` narrows the three views independently, for asymmetric columns:

```ts
// selected as string | null, inserted as string | null, but updates may not clear it
note: text().nullable().typed<string | null, string | null, string>(),

// readable, never written by the application
legacyCode: text().typed<string, never, never>(),
```

### Enums

```ts
const status = defineEnum('order_status', [
	'pending',
	'paid',
	'shipped',
	'cancelled',
]);

const orders = defineTable('orders', {
	columns: { status: status().default() },
});

// a column that only ever holds some of the labels
const refunds = defineTable('refunds', {
	columns: { status: status<'cancelled'>() },
});
```

An enum is declared once and backs any number of columns. Its labels are ordered as declared, as in Postgres, so `<` and `>` compare by position. `quarry verify` checks the labels and their order.

### Codecs on columns

Every column type has a [driver codec](#codecs) that sends its values and reads them back, and its TypeScript type is that codec's: `integer()` is `codecs.int4`, `bigint()` `codecs.int8AsString`, `timestamptz()` `codecs.timestamptz`. The query builder only chooses codecs; the driver encodes each parameter once with its column's codec (declaring its type), and reads each selected column with its codec, in the codec's format once the statement's columns are described.

`.useCodec(codec)` swaps a column's codec, and its types with it:

```ts
import { codecs } from 'quarry';

const events = defineTable('events', {
	columns: {
		id: bigint().identity().useCodec(codecs.int8), // a bigint, not a string
		at: timestamptz().useCodec(codecs.raw), // the server's text, typed as string
	},
});
```

`codecs.raw` keeps any type as the server's text, both ways, for a column you parse yourself.

`defineType({ sql, codec })` declares a type quarry has no factory for (an extension's, a domain, your own), once, and returns its column factory. Its columns admit every operator, with values of the codec's type:

```ts
import { codecs, defineCodec, defineType } from 'quarry';

const citext = defineType({ sql: 'citext', codec: codecs.text });
const positive = defineType({ sql: 'positive_int', codec: codecs.int4 }); // a domain

const point = defineType({
	sql: 'point',
	codec: defineCodec({
		name: 'point',
		oid: 600,
		encode: ({ x, y }: { x: number; y: number }) => `(${x},${y})`,
		decodeText: (text) => {
			const [x, y] = text.slice(1, -1).split(',').map(Number);
			return { x: x ?? 0, y: y ?? 0 };
		},
	}),
});
```

`db.verify` checks a `defineType` column against its type's name, or the domain it is declared with.

### Sensitive columns

```ts
const accounts = defineTable('accounts', {
	columns: {
		id: integer().identity(),
		email: text().sensitive(),
		passwordHash: text().name('password_hash').sensitive(),
	},
});
```

A parameter bound against a `sensitive()` column is shown as `'[redacted]'`:

- in `onQuery` and `slowQuery` events;
- in the `query` of errors: `PostgresError` and its subclasses, `NoRowError`, `TooManyRowsError`, `RowCountError` and `QueryBudgetError`, also when they come from a [batch](#batches) (each of a `BatchError`'s errors, or an atomic batch's error);
- in `toSQL({ inline: true })`;
- in a `DecodeError` on a result column that reads a sensitive column, which loses its `cause` (the codec's error, which may quote the value).

"Bound against" covers comparisons with the column or with an expression that reads it (`where`, `eb.ref(…).in(…)`, `eb.fn.lower('accounts.email').eq(…)`, `eb.json.hasKey(…)`), inserted values (including the `unnest` arrays of multi-row inserts), `update().set()`, upserts and `setEach` rows (their `unnest` arrays; the flags of rows that leave a column out aren't redacted). It also covers values written beside such a column: the other side of arithmetic (`eb.ref('accounts.balance').plus(…)`), another argument of a function (`coalesce`), another result of a `case`, and the values of a [`sql`](#raw-sql) fragment that interpolates the column.

In statements written with `db.sql` / `tx.sql`, nothing types the values, so: a statement that interpolates a table with sensitive columns (`` db.sql`select * from ${accounts} where name = ${name}` ``) redacts all its values, names those columns for constraint details, and drops the cause of any decode error. Elsewhere, mark a value with `sql.sensitive(value)`: `` db.sql`update accounts set password_hash = ${sql.sensitive(hash)} where id = ${id}` ``.

Server errors are redacted too, where they repeat a value. A constraint error's `detail` that names a sensitive column, such as `Key (email)=(ada@example.com) already exists.`, becomes `Key (email)=([redacted]) already exists.`, and `violatedColumns` still works on it. A `Failing row contains (…)` detail loses its values when the table has a sensitive column. Any sensitive parameter's text of three characters or more, as its codec sent it, is also removed from the message and detail.

What is sent and the rows returned are unchanged. `toSQL()` without `inline` returns the real values, since its output is for running elsewhere. A value passed through `eb.val()` into a position not compared with a sensitive column (e.g. a function argument) isn't tracked.

### Inferring row types

```ts
import type { InferInsertType, InferSelectType, InferUpdateType } from 'quarry';

type User = InferSelectType<typeof users>;
// { id: number; email: string; name: string | null; role: 'admin' | 'member' | 'guest'; ... }

type NewUser = InferInsertType<typeof users>;
// { email: string; name: string | null; role?: ...; tags?: string[]; ... }  (no id)

type UserPatch = InferUpdateType<typeof users>;
// every writable column optional
```

In `InferInsertType`, columns with a default are optional, nullable columns without one are required (pass `null` explicitly), and identity and generated columns are absent.

### Aliases

`table.as('alias')` references the same table under another name, for self-joins:

```ts
const managers = users.as('managers');

db.selectFrom(users)
	.innerJoin(managers)
	.on('managers.id', 'users.managerId')
	.select(['users.name', 'managers.name']);
```

## Opening a database

```ts
import { database } from 'quarry';

const db = database(process.env.DATABASE_URL);
```

`database()` takes a connection string, [driver options](#connection-options) (it then opens and owns a pool, which `db.close()` ends), or an existing `Pool`, `PoolClient` or `Connection` that you manage yourself.

```ts
const db = database(
	{ connectionString: process.env.DATABASE_URL, max: 20 },
	{
		onQuery: (event) => logger.debug(event),
		callsites: true,
	},
);
```

| Option      | Default          | Description                                                                                                                                                     |
| ----------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onQuery`   |                  | Called once per query when it settles, with its SQL, parameters, tag, command, row count, error, and timings (`acquireMs`, `queuedMs`, `execMs`, `durationMs`). |
| `slowQuery` |                  | `{ thresholdMs, onSlow }`: `onSlow` gets the event of every query that took at least `thresholdMs` ([below](#slow-queries-and-query-budgets)).                  |
| `callsites` | `true`           | Append the stack of the code that ran a query to its error.                                                                                                     |
| `codecs`    | quarry's codecs  | Codecs for result columns no query types (raw SQL, expressions of unknown type). Columns always use their own codec, so their types hold.                       |
| `catalog`   | `true`           | Look up the types codecs name (enums, pgvector, custom types and their arrays) in `pg_type` once per pool, before the first query.                              |
| `prepare`   | the connection's | Use cached prepared statements.                                                                                                                                 |

`Database` implements `AsyncDisposable`: `await using db = database(url)` closes it at the end of the scope.

## Selecting

```ts
const rows = await db
	.selectFrom(posts)
	.innerJoin(users)
	.on('users.id', 'posts.authorId')
	.where('posts.published', true)
	.where((eb) => eb.ref('users.role').in(['admin', 'member']))
	.select(['posts.id', 'posts.title', 'users.name'])
	.orderBy('posts.id', 'desc')
	.limit(20)
	.execute();
// rows: { id: string; title: string; name: string | null }[]
```

References are always qualified, `table.column`, and only tables in scope can be referenced: referencing `comments.body` before joining `comments` is a type error.

### Choosing columns

```ts
.select(['users.id', 'users.email'])                              // keyed by column name
.select((eb) => [eb.fn.lower('users.email').as('email')])         // expressions need an alias
.select((eb) => ['users.id', eb.fn.count('posts.id').as('posts')]) // mix both
.selectAll()                                                      // every column of every table
.selectAll(users)                                                 // every column of one table
```

Each `select` adds to the list. The row type is built from what you selected, so a typo or a column from a table that isn't joined fails to compile.

### Filtering

`where` takes three forms. Several `where` calls are joined with `and`.

```ts
.where('users.role', 'admin')                                // equality with a value
.where((eb) => eb.ref('users.age').gte(18))                  // a condition built from expressions
.where((eb) => eb.or([eb.ref('users.age').lt(13), eb.ref('users.verified').isFalse()]))
.where(isActive)                                             // a predicate built elsewhere
```

To test for null, use `eb.ref('users.name').isNull()`: `= null` is never true in SQL, so the equality form doesn't accept `null`.

### Joins

```ts
.innerJoin(users).on('users.id', 'posts.authorId')
.leftJoin(comments).on('comments.postId', 'posts.id')
.rightJoin(teams).on('teams.id', 'users.teamId')
.fullJoin(archive).on('archive.postId', 'posts.id')
.crossJoin(regions)
```

`on` takes the same three forms as `where`, plus the common case of two columns being equal: the joined table's column first, then a column of a table already in scope. That form only accepts a column whose type Postgres can compare with the first.

```ts
.innerJoin(memberships).on((eb) =>
  eb.and([
    eb.ref('memberships.userId').eq(eb.ref('users.id')),
    eb.ref('memberships.active').isTrue(),
  ]),
)
```

Outer joins change the row type: after `leftJoin(comments)`, every `comments.*` column you select is nullable, because there may be no matching row. After `rightJoin`, the tables joined before it become nullable; after `fullJoin`, both sides.

### Ordering and pagination

```ts
.orderBy('posts.createdAt', 'desc')
.orderBy('posts.id')                                   // ascending by default; several calls add keys
.orderBy((eb) => eb.fn.lower('users.name'), 'asc', { nulls: 'last' })
.limit(20)
.offset(40)
```

For large tables, prefer keyset pagination to `offset`:

```ts
.where((eb) => eb.ref('posts.id').lt(cursor))
.orderBy('posts.id', 'desc')
.limit(20)
```

### Grouping and aggregates

```ts
const authors = await db
	.selectFrom(users)
	.leftJoin(posts)
	.on('posts.authorId', 'users.id')
	.select((eb) => [
		'users.id',
		'users.name',
		eb.fn.count('posts.id').as('postCount'),
	])
	.groupBy(['users.id'])
	.having((eb) => eb.fn.count('posts.id').gte(5))
	.orderBy((eb) => eb.fn.count('posts.id'), 'desc')
	.execute();
// { id: number; name: string | null; postCount: string }[]
```

Aggregates have the types Postgres gives them: `count` is a `bigint` (a string), `sum` of an `integer` is a `bigint` and of a `bigint` a `numeric` (both strings), `avg` is a `numeric`, and `min` / `max` keep their argument's type. Cast when you want a number: `eb.fn.cast(eb.fn.count(), 'integer')`.

### Distinct

```ts
.distinct()
.distinctOn(['posts.authorId']).orderBy('posts.authorId').orderBy('posts.createdAt', 'desc') // latest post per author
```

### Subqueries

A query can appear wherever an expression of its type can.

```ts
// exists / not exists
.where((eb) =>
  eb.exists(
    db.selectFrom(posts)
      .where((eb) => eb.ref('posts.authorId').eq(eb.ref('users.id')))
      .where('posts.published', true),
  ),
)

// in (select …): the subquery must select one column of a comparable type
.where((eb) => eb.ref('users.id').in(db.selectFrom(posts).select(['posts.authorId'])))

// a scalar subquery in the select list
.select((eb) => [
  'users.id',
  eb.scalar(
    db.selectFrom(posts)
      .where((eb) => eb.ref('posts.authorId').eq(eb.ref('users.id')))
      .select((eb) => [eb.fn.count()]),
  ).as('postCount'),
])
```

A subquery may reference the tables of the query around it (a correlated subquery); those references are type-checked against the outer scope.

### Common table expressions

`cte(name, query)` turns a query into a table you can select from and join like any other. The compiler emits the `with` clause.

```ts
import { cte } from 'quarry';

const prolific = cte(
	'prolific_authors',
	db
		.selectFrom(posts)
		.select((eb) => ['posts.authorId', eb.fn.count().as('total')])
		.groupBy(['posts.authorId'])
		.having((eb) => eb.fn.count().gt(100)),
);

await db
	.selectFrom(users)
	.innerJoin(prolific)
	.on('prolific_authors.authorId', 'users.id')
	.select(['users.name', 'prolific_authors.total'])
	.execute();
```

`cte(name, query, { materialized: true })` adds `materialized` (or `false` for `not materialized`), and `cteRecursive(name, (self) => base.unionAll(step(self)))` builds a recursive one.

### Set operations

```ts
const everyone = db
	.selectFrom(users)
	.select(['users.email'])
	.union(db.selectFrom(subscribers).select(['subscribers.email']));
```

`union`, `unionAll`, `intersect`, `intersectAll`, `except` and `exceptAll` take a query with the same columns and compatible types; anything else is a type error.

### Locking

```ts
await db.transaction(async (tx) => {
	const job = await tx
		.selectFrom(jobs)
		.where('jobs.status', 'queued')
		.select(['jobs.id', 'jobs.payload'])
		.orderBy('jobs.id')
		.limit(1)
		.forUpdate()
		.skipLocked()
		.takeFirst()
		.execute();
	// ...
});
```

`forUpdate`, `forNoKeyUpdate`, `forShare` and `forKeyShare` add a locking clause. Directly after one, `.of(...tables)` limits it to some of the query's tables, and `.skipLocked()` or `.noWait()` says what to do with rows already locked (by default, wait). The type system enforces that order: `skipLocked()` isn't available before a lock strength. Several clauses can lock different tables with different strengths.

Locks last until the transaction ends, so run locking queries inside `db.transaction`. The result shapes never add a `limit`, so every row the query returns is locked: use `.limit(1)` to lock one.

### Conditional and reusable pieces

`when` applies part of a query only when a condition holds. Columns it selects become optional in the row type, since they may not be there.

```ts
db.selectFrom(users)
	.select(['users.id'])
	.when(filters.role !== undefined, (qb) =>
		qb.where('users.role', filters.role!),
	)
	.when(includeEmail, (qb) => qb.select(['users.email']));
// { id: number; email?: string }[]
```

`fragment` defines a reusable piece over the tables it needs, and `pipe` applies it to any query those tables are in, in any position. Tables the fragment joins and columns it selects are added to the query.

```ts
import { fragment } from 'quarry';

const published = fragment(posts, (qb) => qb.where('posts.published', true));

const withAuthor = fragment(posts, (qb) =>
	qb.innerJoin(users).on('users.id', 'posts.authorId').select(['users.name']),
);

db.selectFrom(posts).pipe(published).pipe(withAuthor).select(['posts.title']);
```

`pipe` refuses, at compile time, a fragment whose tables aren't in the query, and names the missing ones.

## Expressions

The expression builder `eb`, passed to every callback, builds typed SQL expressions. Its members don't depend on `this`, so it can be destructured: `.where(({ ref, or }) => …)`.

| Member                                            | Description                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eb.ref(column)`                                  | A column reference, with the comparison methods of its SQL type.                                                                                                                                                    |
| `eb.val(value, codec?)`                           | A parameter, for positions that take a reference by default (`eb.fn.concat('users.first', eb.val(' '), …)`). In a comparison or `coalesce` it is encoded by the other side's codec; elsewhere by `codec`, if given. |
| `eb.and([...])`, `eb.or([...])`, `eb.not(p)`      | Combine predicates.                                                                                                                                                                                                 |
| `eb.fn`                                           | SQL functions and aggregates.                                                                                                                                                                                       |
| `eb.json`                                         | jsonb accessors and tests.                                                                                                                                                                                          |
| `eb.exists(q)`, `eb.notExists(q)`, `eb.scalar(q)` | Subqueries.                                                                                                                                                                                                         |
| `eb.case()`                                       | `case when … then … else … end`.                                                                                                                                                                                    |

`expressionBuilder(...tables)` creates one outside a query, for building predicates in advance.

### Comparisons by type

A comparison is a method of an expression, and each SQL type has exactly the comparisons Postgres defines for it. Every method accepts a plain value of the column's type or an expression of a compatible SQL type.

| Applies to                                                               | Methods                                                                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every type                                                               | `eq`, `ne`, `in`, `notIn`, `isNull`, `isNotNull`, `isDistinctFrom`, `isNotDistinctFrom`                                                                             |
| Ordered types (numbers, text, dates and times, intervals, `inet`, enums) | `gt`, `gte`, `lt`, `lte`, `between`, `notBetween`                                                                                                                   |
| `text`, `varchar`                                                        | `like`, `notLike`, `ilike`, `notIlike`, `regex`, `notRegex`, `iregex`, `notIregex`, `startsWith`                                                                    |
| `boolean`                                                                | `isTrue`, `isNotTrue`, `isFalse`, `isNotFalse`                                                                                                                      |
| Arrays                                                                   | `contains` (`@>`), `containedBy` (`<@`), `overlaps` (`&&`)                                                                                                          |
| `jsonb`                                                                  | `contains`, `containedBy`                                                                                                                                           |
| Ranges                                                                   | `contains` (a range or a single value), `containedBy`, `overlaps`, `strictlyLeftOf`, `strictlyRightOf`, `doesNotExtendRightOf`, `doesNotExtendLeftOf`, `adjacentTo` |
| `inet`                                                                   | `isSubnetOf`, `isSubnetOrEqual`, `isSupernetOf`, `isSupernetOrEqual`, `overlaps`                                                                                    |
| `tsvector`                                                               | `matches(query)` (`@@` against a tsquery string, e.g. `'fat & rat'`)                                                                                                |
| `vector`                                                                 | `l2Distance`, `cosineDistance`, `innerProduct`, which return `double precision` expressions                                                                         |
| Numeric types                                                            | `plus`, `minus`, `times`, `dividedBy`, `mod`, which return expressions of the wider operand's type                                                                  |
| Dates and times                                                          | `plus(interval)`, `minus(interval)`, and `minus` between two timestamps (an `interval`)                                                                             |

Numeric types compare with each other, `text` with `varchar`, and `date` with `timestamp` and `timestamptz`, because Postgres allows those without a cast. Anything else, such as `uuid` against `text`, is rejected at compile time.

```ts
eb.ref('users.email').like('%@example.com');
eb.ref('users.age').between([18, eb.ref('users.maxAge')]);
eb.ref('users.tags').contains(['beta']);
eb.ref('bookings.during').overlaps({
	empty: false,
	lower: start,
	upper: end,
	bounds: '[)',
});
eb.ref('posts.search').matches('postgres & !mysql');
eb.ref('users.firstName').eq(eb.ref('users.lastName'));
```

**`any` and `all`.** Compare against every element of an array, from a value or an array column:

```ts
eb.ref('users.email').like(eb.fn.any(['%@a.com', '%@b.com']));
eb.val('admin').eq(eb.fn.any('users.roles'));
eb.ref('users.score').gt(eb.fn.all('users.thresholds'));
```

`in` with a JavaScript array compiles to `= any($1)` with one array parameter, sent in binary, so a list of 10,000 ids is one parameter, not 10,000.

### Functions

| Function                                     | Returns                                                |
| -------------------------------------------- | ------------------------------------------------------ |
| `lower`, `upper`                             | `text`                                                 |
| `length`                                     | `integer`                                              |
| `concat(...parts)`                           | `text`, never null (nulls are skipped)                 |
| `coalesce(...values)`                        | the first argument's type, non-null if any argument is |
| `now()`                                      | `timestamptz`                                          |
| `cast(value, type)`                          | the named type                                         |
| `count(value?)`                              | `bigint`                                               |
| `sum`, `avg`                                 | see [aggregates](#grouping-and-aggregates)             |
| `min`, `max`                                 | the argument's type                                    |
| `arrayAgg(value)`                            | an array of the argument's type                        |
| `jsonbAgg(value)`, `jsonbBuildObject({...})` | `jsonb`                                                |
| `any(array)`, `all(array)`                   | a quantified operand for comparisons                   |

```ts
eb.fn.coalesce('users.name', eb.val('anonymous'));
eb.fn.cast(eb.fn.count(), 'integer');
eb.fn.jsonbBuildObject({ id: 'users.id', email: 'users.email' }).as('user');
```

### jsonb

```ts
eb.json.get('users.settings', 'theme'); // -> jsonb
eb.json.text('users.settings', 'theme').eq('dark'); // ->> text
eb.json.get('users.settings', 'prefs', 'beta'); // a path
eb.json.hasKey('users.settings', 'theme'); // ?
eb.json.hasAnyKey('users.settings', ['theme', 'lang']); // ?|
eb.json.hasAllKeys('users.settings', ['theme', 'lang']); // ?&
eb.json.pathExists('users.settings', '$.tags[*] ? (@ == "a")');
eb.json.pathMatches('users.settings', '$.price > 10');
eb.json.typeOf('users.settings');
eb.json.length('users.settings');
```

Paths are checked against the column's declared document type `T` where it's known.

### case

```ts
eb.case()
	.when(eb.ref('orders.total').gte(1000), 'large')
	.when(eb.ref('orders.total').gte(100), 'medium')
	.else('small')
	.end()
	.as('size');
```

The result type is the union of the branches, plus `null` without an `else`.

### Raw SQL

For anything the builder doesn't model, `sql` writes a fragment by hand. Interpolated values become parameters; interpolated expressions are inlined as SQL.

```ts
import { sql } from 'quarry';

.select((eb) => [sql<number>`extract(epoch from ${eb.ref('users.createdAt')})`.as('epoch')])
.where((eb) => sql<boolean>`${eb.ref('posts.title')} % ${search}`) // pg_trgm similarity
```

A whole statement runs with `db.sql`, and supports every [result shape](#result-shapes):

```ts
const { rowCount } = await db.sql`vacuum analyze posts`.execute();
const row = await db.sql<{ n: string }>`select count(*) as n from posts`
	.expectOne()
	.execute();
```

The type parameter is a promise you make; nothing checks it. Prefer the builder where it can express the query.

`db.sql` statements show their SQL like builders (`toSQL({ inline, pretty })`), count against [query budgets](#slow-queries-and-query-budgets), and redact the values of [sensitive columns](#sensitive-columns) they interpolate, or values marked with `sql.sensitive(value)`.

## Result shapes

How you want the result decides how you finish the query. A shape never changes the SQL: it only decides how the rows are read and what counts as an error.

| Shape               | Resolves to          | Throws                           | Use for                                        |
| ------------------- | -------------------- | -------------------------------- | ---------------------------------------------- |
| `execute()`         | `Row[]`              |                                  | Lists.                                         |
| `takeFirst()`       | `Row \| undefined`   |                                  | "The first, if any." Add `.limit(1)` yourself. |
| `takeValue()`       | `Value \| undefined` |                                  | One column of the first row.                   |
| `expectFirst()`     | `Row`                | `NoRowError`                     | "There must be at least one."                  |
| `expectOne()`       | `Row`                | `NoRowError`, `TooManyRowsError` | Lookups by a unique key.                       |
| `expectAtMostOne()` | `Row \| undefined`   | `TooManyRowsError`               | Optional lookups by a unique key.              |
| `expectNonEmpty()`  | `[Row, ...Row[]]`    | `NoRowError`                     | Lists that must not be empty.                  |
| `expectValue()`     | `Value`              | `NoRowError`                     | One column of a row that must exist.           |
| `expectRows(n)`     | the write's result   | `RowCountError`                  | Writes that must affect exactly `n` rows.      |

The shape comes before `execute()`:

```ts
const email = await db
	.selectFrom(users)
	.where('users.id', id)
	.select(['users.email'])
	.expectValue()
	.execute(); // string
```

`takeValue` and `expectValue` require exactly one selected column; with more, the call fails to compile. Each `expect…` takes an optional function that maps the error it would throw to your own:

```ts
.expectOne((error) => new NotFound(`user ${id}`, { cause: error }))
```

## Inserting

```ts
const user = await db
	.insertInto(users)
	.values({ email: 'ada@example.com', name: 'Ada' })
	.returning(['users.id', 'users.createdAt'])
	.expectOne()
	.execute();
// { id: number; createdAt: Date }
```

`values` takes a row typed by [`InferInsertType`](#inferring-row-types): columns with a default may be left out, identity and generated columns can't be written at all, and a missing required column is a compile error.

**Many rows.** Pass an array. The rows are sent as one array parameter per column through `unnest`, so the statement has a handful of parameters however many rows you insert, its text is the same for 10 rows or 10,000 (one prepared statement), and the arrays travel in binary.

```ts
await db.insertInto(users).values(rows).execute();
// insert into "users" ("email", "name") select * from unnest($1::text[], $2::text[])
```

**From a query.**

```ts
await db
	.insertInto(archivedPosts)
	.fromSelect(
		db
			.selectFrom(posts)
			.where((eb) => eb.ref('posts.createdAt').lt(cutoff))
			.selectAll(),
	)
	.execute();
```

### Upserts

```ts
.onConflict('email').doNothing()
.onConflict('email').merge(['name'])                              // set name = excluded.name
.onConflict(['tenantId', 'slug']).merge(['title', 'body'])
.onConflict('email').doUpdate((excluded) => ({ name: excluded.name }))
.onConflict('email').where('users.deleted', false).doNothing()   // a partial unique index
```

The conflict target must be columns of the table. `merge(columns)` is shorthand for setting each column to the proposed value; `doUpdate` takes a function of `excluded`, the proposed row, whose columns are typed expressions:

```ts
await db
	.insertInto(counters)
	.values({ key: 'visits', value: 1 })
	.onConflict('key')
	.doUpdate((excluded, eb) => ({
		value: eb.ref('counters.value').plus(excluded.value),
	}))
	.execute();
```

`.onConflict('email').doNothing().expectRows(1)` throws a `RowCountError` when the row already existed, which is a compact way to say "insert, and tell me if it was a duplicate".

## Updating

```ts
await db
	.update(users)
	.set({ name: 'Ada Lovelace' })
	.where('users.id', id)
	.execute();
// { rowCount: 1 }
```

`set` takes the writable columns typed by [`InferUpdateType`](#inferring-row-types), as values or expressions:

```ts
.set((eb) => ({
  email: eb.fn.lower('users.email'),
  loginCount: eb.ref('users.loginCount').plus(1),
  lastSeenAt: eb.fn.now(),
}))
```

**An update must say which rows it changes.** It can't run until it has a `where`, an explicit `.allRows()`, or a [`setEach`](#updating-many-rows-to-different-values) (whose key match is its `where`); `execute()` on an update without either is a compile error, not a production incident.

```ts
await db.update(users).set({ verified: false }).allRows().execute();
```

**Optimistic concurrency** with `expectRows`:

```ts
await db
	.update(docs)
	.set({ body, version: version + 1 })
	.where('docs.id', id)
	.where('docs.version', version)
	.expectRows(1) // RowCountError if someone else saved first
	.execute();
```

### Updating many rows to different values

`setEach` updates each row to its own values in one statement, matched by key:

```ts
await db
	.update(products)
	.setEach(
		[
			{ id: 1, price: '9.99', stock: 12 },
			{ id: 2, price: '19.99', stock: 0 },
		],
		{ key: 'id' },
	)
	.expectRows(2) // RowCountError unless both rows were there
	.execute();
// update "products" set "price" = "row"."price", "stock" = "row"."stock"
// from unnest($1::integer[], $2::numeric[], $3::integer[]) as "row"("id", "price", "stock")
// where "products"."id" = "row"."id"
```

`key` is a column or a composite key (`{ key: ['tenantId', 'sku'] }`); every row must include it, and no two rows can share one. The key match is the update's `where`, so it runs without another; `.where(...)` adds conditions to it. Like multi-row inserts, it sends one array per column, so the SQL is the same whatever the number of rows.

**Rows can set different columns.** A column a row leaves out (or sets to `undefined`) keeps its value in that row; `null` sets it to null. Each such column is sent with a flag:

```ts
await db
	.update(users)
	.setEach(
		[
			{ id: 1, name: 'Ada' },
			{ id: 2, email: 'alan@example.com' },
		],
		{ key: 'id' },
	)
	.execute();
// update "users" set
//   "name" = case when "row"."set:name" then "row"."name" else "users"."name" end,
//   "email" = case when "row"."set:email" then "row"."email" else "users"."email" end
// from unnest($1::integer[], $2::text[], $3::text[], $4::boolean[], $5::boolean[])
//   as "row"("id", "name", "email", "set:name", "set:email")
// where "users"."id" = "row"."id"
```

**The rows are in scope** as `row`, or the name given as `as`, in `set`, `where` and `returning`. A column a row may leave out is nullable there. A later `set` of a column replaces the rows' values with an expression:

```ts
// apply each edit only over an older version of its doc
await db
	.update(docs)
	.setEach(edits, { key: 'id', as: 'edit' }) // { id, body, version }[]
	.set((eb) => ({ editedAt: eb.fn.now() }))
	.where((eb) => eb.ref('docs.version').lt(eb.ref('edit.version')))
	.returning(['docs.id', 'edit.version'])
	.execute();
```

## Deleting

```ts
const deleted = await db
	.deleteFrom(sessions)
	.where((eb) => eb.ref('sessions.expiresAt').lt(new Date()))
	.returning(['sessions.id'])
	.execute();
```

As with updates, a delete needs a `where` or an explicit `.allRows()` before it can run.

### Returning

`insertInto`, `update` and `deleteFrom` all take `returning([...])`, with the same forms as `select`, and every [result shape](#result-shapes). Without `returning`, `execute()` resolves to `{ rowCount }`.

## Running queries

A builder runs when you call `execute()`, or a shape followed by `execute()`.

```ts
await query.execute({ signal: request.signal, timeout: '2s' });
```

| Option    | Description                                                        |
| --------- | ------------------------------------------------------------------ |
| `signal`  | An `AbortSignal` that cancels the query on the server.             |
| `timeout` | A deadline, in milliseconds or as an interval (`'2s'`, `'500ms'`). |

**Awaiting a builder is an error.** `await db.selectFrom(users)` throws a `TypeError` explaining that queries run with `execute()`. A forgotten `execute()` can't silently do nothing.

**Streaming.** `stream()` reads every row through a cursor, decoded as `execute()` decodes them, without holding the result in memory. It fetches `batchSize` rows (default 1000) at a time, each batch once the rows before it are taken, so a slow loop holds one batch. Nothing runs until the first row is asked for.

```ts
for await (const event of db
	.selectFrom(events)
	.select(['events.id', 'events.payload'])
	.stream({ batchSize: 1000, signal: request.signal })) {
	await handle(event);
	if (done) break; // closes the cursor and frees its connection
}
```

- **On the pool**, a stream takes a connection of its own, and frees it when the loop ends however it ends: read to the end, `break`, `return`, a throw, or the `signal`. `await using rows = query.stream()` frees it when the block ends.
- **Inside `db.transaction`**, other queries of the transaction run between the stream's batches, so the loop can read and write through `tx`:

```ts
await db.transaction(async (tx) => {
	for await (const job of tx
		.selectFrom(jobs)
		.select(['jobs.id'])
		.where('jobs.status', 'queued')
		.forUpdate()
		.stream()) {
		await tx
			.update(jobs)
			.set({ status: 'done' })
			.where('jobs.id', job.id)
			.execute();
	}
});
```

- **`signal`** stops the stream whenever it fires: between batches the next pull rejects with `AbortError`, and a batch being read is canceled (`QueryCanceled`). **`timeout`** bounds the whole stream, the loop's time included; it can't be set inside a transaction (use `tx.setLocal('statement_timeout', …)`).
- **Errors** in the middle of a stream (a division by zero at row 10,001, a value a codec rejects) reject the pull that reaches them, after the rows before them.
- **Node and web streams**: a stream is an async iterable, so `Readable.from(query.stream())` and `ReadableStream.from(query.stream())` pull from it with backpressure, and close it when destroyed or canceled.
- **Only every row streams.** The `take…` and `expect…` shapes read a whole result, so they have no `stream()`.

**Inspecting.** Every builder and every shaped query can show its SQL without running it, and the database can describe it:

```ts
const { sql, params } = query.toSQL();
const { params: paramTypes, columns } = await query.describe(); // types as the server sees them

console.log(query.expectOne().toSQL({ inline: true, pretty: true }).sql);
// select
//   "users"."id" as "id"
// from "users"
// where (
//   "users"."tags" @> '{a,"b,c"}'
//   and "users"."created_at" > '2026-01-02 03:04:05.678+00'::timestamptz
// )
```

- Without options, `toSQL()` is exactly what `execute()` sends, codecs and tag included. A result shape never changes it, since no shape adds a `limit`; each item of a [batch](#batches) renders the same way (`item.toQuery().toSQL()`), and so does a `db.sql` statement.
- **`inline`** writes each parameter into the SQL as a literal: the text its codec sends, quoted as `quote_literal` does and cast to the codec's type (`'12.50'::numeric`, `'9007199254740993'::int8`, `'{1,NULL}'::int4[]`, `'{"a":1}'::jsonb`, `'happy'::mood`, `E'\\x01ff'::bytea`; `true` and integers bare). Text-like values (`text`, `varchar`, `citext`, …) stay uncast, as their parameters stay inferred, and `unnest`'s arrays keep the cast the SQL already writes. `params` is then empty. The statement pastes into psql and behaves like the query.
- **`pretty`** puts each clause, list item and top-level `where` condition on its own line, changing only whitespace outside quotes.

Inlined SQL is for reading and logs. Never execute inlined SQL built from untrusted input: run the query, which sends values as parameters. Values of [sensitive columns](#sensitive-columns) show as `'[redacted]'`, so inlined SQL that contains one won't run.

**Tagging.** `.tag('posts.feed')` labels a query for `onQuery` events and OpenTelemetry spans (`db.query.summary`). The tag never appears in the SQL, so it doesn't fragment the statement cache.

**Building without a database.** `selectFrom`, `insertInto`, `update` and `deleteFrom` are also exported on their own. Queries built that way can be inspected, composed, and run by a database's `batch`; `execute()` works only on queries started from `database(...)`.

```ts
import { selectFrom } from 'quarry';

const byEmail = (email: string) =>
	selectFrom(users)
		.where('users.email', email)
		.select(['users.id'])
		.expectOne();

const [user] = await db.batch([byEmail('ada@example.com')]);
```

## Batches

`db.batch` runs several queries in **one round trip** on one connection, and resolves to their results by position, each typed by its shape.

```ts
const [user, posts, { rowCount }] = await db.batch([
	db
		.selectFrom(users)
		.where('users.id', id)
		.select(['users.email'])
		.expectOne(),
	db.selectFrom(posts).where('posts.authorId', id).select(['posts.title']),
	db.update(users).set({ seenAt: new Date() }).where('users.id', id),
]);
```

- **Outside a transaction**, each query runs on its own. If any fails (including an `expectOne` that finds no row), the others still run and stay committed, and the batch rejects with a `BatchError` holding every outcome in `results`.
- **With `{ transaction: true }`**, they run all or nothing: `BEGIN`, the statements and `COMMIT` go out in a single write. The batch rejects with the error that rolled it back. A shape that checks results (`expect…`) makes `COMMIT` wait for the check, which costs a second round trip; the `take…` shapes check nothing, so `COMMIT` stays in the first.
- **Inside a transaction**, they share one Sync: the first error skips the rest and fails the transaction, as any failed query would. `{ transaction: true }` makes them a savepoint.

```ts
await db.batch([debit, credit], { transaction: { isolation: 'serializable' } });
```

## Transactions with the query builder

```ts
const orderId = await db.transaction(
	async (tx) => {
		const order = await tx
			.insertInto(orders)
			.values({ userId, total })
			.returning(['orders.id'])
			.expectOne()
			.execute();
		await tx
			.insertInto(orderItems)
			.values(items.map((item) => ({ ...item, orderId: order.id })))
			.execute();
		tx.afterCommit(() => queue.publish('order.created', order.id));
		return order.id;
	},
	{ isolation: 'serializable', retries: 3 },
);
```

`tx` has the same query methods as `db`, plus:

| Member                     | Description                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `tx.transaction(fn, opts)` | A nested savepoint, or an error with `{ durable: true }`.                                                               |
| `tx.afterCommit(fn)`       | Runs once the outermost transaction commits; dropped on rollback or retry.                                              |
| `tx.afterRollback(fn)`     | Runs if this transaction or savepoint rolls back.                                                                       |
| `tx.setLocal(name, value)` | Sets a run-time parameter until the transaction ends, with a bound value (e.g. `app.tenant_id` for row-level security). |

The options are the driver's [transaction options](#transactions): `isolation`, `readOnly`, `deferrable`, `retries`, `settings`, `timeout` and `durable`. With `retries`, the callback may run more than once, so keep side effects in `afterCommit`.

## Slow queries and query budgets

Both build on the event `onQuery` receives (SQL, redacted params, tag, timings, row count, error).

```ts
const db = database(process.env.DATABASE_URL, {
	slowQuery: {
		thresholdMs: 200,
		onSlow: (e) => log.warn({ tag: e.tag, sql: e.sql, ms: e.durationMs }),
	},
});
```

`slowQuery.onSlow` gets the `QueryEvent` of every query that took at least `thresholdMs`, failed ones included; a throwing listener never affects the query. In a batch, each query gets its own event, timed from when the batch started.

`db.budget(limits, fn)` limits the queries one unit of work (a request, a job) runs on this database:

```ts
// strict: throws QueryBudgetError, e.g. in tests or dev, to catch N+1 loops
await db.budget({ maxQueries: 10 }, () => loadDashboard(db, userId));

// report: tells you once and lets the work finish, e.g. in production
const page = await db.budget(
	{
		maxQueries: 50,
		maxDurationMs: 1000,
		onExceeded: (usage) => log.warn(req.url, usage),
	},
	(usage) => renderPage(req, usage), // usage.queries and usage.durationMs are live
);
```

- Queries count wherever they are issued inside `fn` (anything it awaits, transactions, streams and `db.sql` / `tx.sql` statements included), through `AsyncLocalStorage`. Concurrent budgets don't see each other's queries, another database's queries don't count, and budgets nest.
- **`maxQueries`**: the query that would go over is refused before it is sent. Each query of a `db.batch` counts, and a batch that would go over is refused whole, before any of it is sent.
- **`maxDurationMs`** (the queries' total time): the query that takes the total over has run, so it throws instead of returning, like `expectRows`; inside a transaction, that rolls it back. A batch is one round trip, so its time counts once; a batch that takes the total over has run (with `{ transaction: true }`, committed) and rejects.
- After a strict budget is exceeded, every later query in it is refused. With **`onExceeded`**, nothing throws: it is called once, with the usage, by the query that went over.

A budget is tied to a database, so a library's own database doesn't eat an app's budget, and scoped to a callback rather than a middleware, so it works in any framework, job runner or test. `AsyncLocalStorage` is loaded through `process.getBuiltinModule('node:async_hooks')` only when a budget is first used: Node, Deno, Bun, and Cloudflare Workers with `nodejs_compat`. Elsewhere `db.budget` rejects, and nothing else changes.

## Handling errors

Database errors are the driver's [error classes](#errors), re-exported from `quarry`. The query builder adds:

- **The query and its tag** on every server error, so a log line says which query failed.
- **Your stack.** With `callsites` (on by default), the error's stack includes the code that called `execute()`, not just the driver's socket handler.
- **Shape errors**: `NoRowError` and `TooManyRowsError` (with `count`) from the `expect…` shapes, and `RowCountError` (with `expected` and `actual`) from `expectRows`. Each carries the `table` it read or wrote and, non-enumerably, the compiled `query`.

`violatedColumns(error, table)` maps a constraint violation back to your column keys, which is the usual first step in turning a database error into a form error:

```ts
import { UniqueViolation, violatedColumns } from 'quarry';

try {
	await db.insertInto(users).values(input).execute();
} catch (error) {
	if (
		error instanceof UniqueViolation &&
		violatedColumns(error, users)?.includes('email')
	) {
		return reply
			.status(409)
			.send({ field: 'email', message: 'Already registered' });
	}
	throw error;
}
```

It returns `undefined` when the error is about another table, names no columns, or names one the table doesn't declare (such as an expression in a unique index). Keys are the TypeScript keys: `createdAt`, not `created_at`.

## Schema verification

Your table definitions are a claim about the database. `verify` checks the claim, in one read-only catalog query, and reports each difference with the line of code it concerns and the SQL that would fix it.

```text
  × quarry(column-type-mismatch): users.email is varchar(320) in the database, but varchar(255) in
    the code
   ╭─[src/schema.ts:23:10]
22 │ id: integer().identity(),
23 │ email: varchar(255),
   · ─────────┬─────────
   ·          ╰── found varchar(320)
24 │ displayName: text().name('display_name').nullable(),
   ╰────
  help: alter table users alter column email type varchar(255) using email::varchar(255);
        or declare it as varchar(320)

  × quarry(enum-label-mismatch): enum user_status differs: the database lacks 'archived'; the code
    lacks 'banned'
   ╭─[src/schema.ts:14:23]
14 │ export const status = defineEnum('user_status', [
   ·                       ───────────┬────────────
   ·                                  ╰── the database lacks 'archived'; the code lacks 'banned'
   ╰────
  help: alter type user_status add value 'archived' after 'suspended';
        add 'banned' to defineEnum('user_status', ...); postgres can't drop enum labels
```

### From the command line

Create a `quarry.config.ts`:

```ts
import { database, defineConfig } from 'quarry';
import * as schema from './src/schema.ts';

export default defineConfig({
	db: database(process.env.DATABASE_URL),
	schema, // a module namespace or an array; values that aren't tables are ignored
});
```

Then run:

```sh
npx quarry verify
```

```text
Usage: quarry verify [options]

  --config <path>    the config file (default: quarry.config.{ts,mts,js,mjs})
  --format <format>  pretty (default), table, github or json
  --strict           treat columns only the database has as errors
  --schema <name>    look tables up in this schema instead of search_path
  --ascii            draw frames with ASCII characters
  --color, --no-color
  -h, --help
```

The exit code is `0` when the schema matches, `1` when there are errors, and `2` when the command itself couldn't run (a bad config, an unreachable database). With `--format github`, each diagnostic becomes an annotation on the line it concerns in a pull request:

```yaml
- run: npx quarry verify --format github --strict
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

TypeScript configs load natively on Node 22.18+ and 23.6+; on older versions the CLI restarts itself with `--experimental-strip-types`.

### From code

```ts
import { formatVerifyReport } from 'quarry';

const report = await db.verify([users, posts], { strict: true });
if (!report.ok) throw new Error(formatVerifyReport(report));
```

Useful as a boot check or a test. The report has `ok`, a `summary` (counts of errors, warnings and infos, tables, columns, duration), the `diagnostics`, and a per-table, per-column view in `tables`.

### What it checks

| Code                          | Severity | Difference                                                                                  |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `table-missing`               | error    | A table in the code is missing from the database.                                           |
| `column-missing`              | error    | A column in the code is missing from the database.                                          |
| `column-type-mismatch`        | error    | A column's SQL type, its modifiers (`varchar(n)`, `numeric(p, s)`) or its arrayness differ. |
| `column-nullable-mismatch`    | error    | The database allows null in a column the code says is never null.                           |
| `column-not-null-mismatch`    | warning  | The code allows null in a column the database declares `not null`.                          |
| `column-default-missing`      | error    | The code declares `default()` but the database has no default.                              |
| `column-default-undeclared`   | info     | The database fills in a column the code requires on insert.                                 |
| `column-identity-missing`     | error*   | The code declares `identity()` but the column isn't an identity.                            |
| `column-identity-undeclared`  | error    | The column is `generated always as identity`, but the code writes it.                       |
| `column-generated-missing`    | error*   | The code declares `generated()` but the column isn't generated.                             |
| `column-generated-undeclared` | error    | The column is generated, but the code writes it.                                            |
| `enum-label-mismatch`         | error    | An enum's labels differ.                                                                    |
| `enum-label-order`            | warning  | Same labels, different order, which changes how `<` compares them.                          |
| `column-extra`                | info*    | The database has a column the code doesn't declare.                                         |

\* Severity depends on the case. `column-identity-missing` is a warning when the column still has some other way of being filled in (a default), and `column-generated-missing` is a warning when the column is nullable, since inserts still succeed. `column-extra` is a warning when the extra column is `not null` without a default, because every insert from the code will fail, and an error with `--strict`.

Names are resolved through the session's `search_path`, as queries resolve them, unless `schema` is given.

---

## Development

```sh
pnpm install
pnpm test            # unit, type and integration tests
pnpm typecheck
pnpm lint
pnpm format
```

| Script               | What it does                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`          | Runs every test, with type tests (`*.test-d.ts`). When PostgreSQL is installed, starts a throwaway cluster with TLS, a role per auth method, and PgBouncer; otherwise the integration tests are skipped. `PG_VERSION`, `PG_BIN` and `PGBOUNCER_BIN` select other installations. |
| `pnpm test:types`    | Type tests only.                                                                                                                                                                                                                                                                |
| `pnpm test:compat`   | Runs node-postgres's and postgres.js's own test suites against this driver through test-only shims, on PostgreSQL 18 (`--bouncer` adds a pass through PgBouncer). `test/driver/compat/expectations.ts` lists every test allowed to fail, and why.                               |
| `pnpm test:runtimes` | The same smoke test on Node, Bun and Deno.                                                                                                                                                                                                                                      |
| `pnpm test:workers`  | The smoke test inside workerd (set `MINIFLARE_FROM` to a Miniflare install).                                                                                                                                                                                                    |
| `pnpm bench:driver`  | A quick comparison against `pg` and postgres.js. The full suite is in `bench/driver/suite`; see [Benchmarks](#benchmarks).                                                                                                                                                      |
| `pnpm bench:types`   | Measures type-checking cost on generated schemas.                                                                                                                                                                                                                               |
| `pnpm bench:lsp`     | Measures editor latency (completions, hovers) through the language server.                                                                                                                                                                                                      |
| `pnpm build`         | Builds `dist/` with tsdown and emits declarations.                                                                                                                                                                                                                              |

Type-checking speed is treated as a feature: the query builder's types are written to keep completions instant on schemas with hundreds of tables, and `bench:types` guards against regressions.

## License

[MIT](./LICENSE)
