# Driver decisions and optimisations

Every design decision and optimisation trick in quarry's PostgreSQL driver, explained for someone new to drivers. Each entry answers the same questions:

- **What it is**: the idea, in plain words.
- **Why**: the problem it solves.
- **Alternatives**: what else was possible, usually what other drivers do, and why that lost.
- **Cost**: what it costs in complexity, memory, edge cases or behaviour.
- **Measured**: numbers, where we have them, with the pull request (PR) they came from.
- **Code**: where it lives.

The query builder's decisions are in [../DECISIONS.md](../DECISIONS.md); the index of both is [../../DECISIONS.md](../../DECISIONS.md). The mechanisms themselves are explained step by step in the other driver guides ([ARCHITECTURE.md](ARCHITECTURE.md) and its neighbours); this file is about **why**.

## How to read the numbers

Most measurements come from benchmark runs described in the linked PRs, usually on a 4-vCPU cloud VM with the client pinned to 2 CPUs and PostgreSQL 18 to the other 2, Node 24 (and Bun 1.4 where stated), with each cell run several times in fresh processes and interleaved; the figure given is the median. "RTT" is the simulated network round-trip time (added with Toxiproxy); "0 ms" means loopback. "p99" and "p99.9" are the latencies 99% and 99.9% of queries beat: the slow tail. "ops/s" is operations per second. "pg" is node-postgres, the most common Node driver; "postgres.js" is the other popular one; "Bun.sql" is Bun's built-in native client. Absolute numbers depend on the machine; compare within a table. Differences under about 5% are usually noise.

## Contents

- [Architecture](#architecture)
- [Writing to the socket](#writing-to-the-socket)
- [Prepared statements and PgBouncer](#prepared-statements-and-pgbouncer)
- [Codecs, types and formats](#codecs-types-and-formats)
- [Reading and decoding](#reading-and-decoding)
- [Memory and garbage collection](#memory-and-garbage-collection)
- [The pool](#the-pool)
- [Connecting](#connecting)
- [Transactions and batches](#transactions-and-batches)
- [Cursors and streams](#cursors-and-streams)
- [COPY and LISTEN/NOTIFY](#copy-and-listennotify)
- [Cancellation and timeouts](#cancellation-and-timeouts)
- [Runtimes](#runtimes)
- [Errors and safety](#errors-and-safety)

## Architecture

### Our own wire-protocol implementation, with no dependencies

**What it is.** The driver speaks PostgreSQL's wire protocol itself ([protocol/](protocol/README.md)) instead of wrapping an existing driver, and has no runtime dependencies.

**Why.** The features that make quarry fast need control over every byte: pipelining with a Sync per query, binary formats chosen per column, decoding rows straight from the read buffer, backpressure, prepared-statement naming behind PgBouncer. An existing driver's abstractions (a message object per row, text parsers keyed by type, one query in flight per pooled client) are exactly what those optimisations remove.

**Alternatives.** Wrap pg (the most used Node driver) or postgres.js. pg never pipelines through its pool (exactly one query in flight per connection), sends unnamed statements by default (re-parsed and re-planned every time), and parses every value from text. postgres.js pipelines, but at the time had a queue bug that made it slow on several connections, text-only results, and an unbounded statement cache ([implementation comparison, summarised in #12/#15](https://github.com/shlokdesai33/quarry/pull/15)).

**Cost.** About 8k lines to maintain; every protocol edge case is ours to get right. Mitigation: `pnpm test:compat` runs pg's and postgres.js's own test suites against this driver, and found 10 bugs early ([#11](https://github.com/shlokdesai33/quarry/pull/11)).

**Measured.** On the full benchmark run after the driver batch (#12–#25): point lookups on 10 connections with 1000 callers 301k/s against postgres.js 130k and pg 61k; 1M-row fetch 487 ms against 1,078 ms (postgres.js) and 1,293 ms (pg); lowest median latency in all 17 sequential scenarios on Node.

**Code.** [index.ts](index.ts), [protocol/](protocol/README.md).

### Requests as operations in one FIFO queue

**What it is.** Every request on a connection is an `Op` object pushed onto one first-in-first-out queue ([ARCHITECTURE.md](ARCHITECTURE.md#part-5-operations)). Ops are written in order, and each reply message goes to the op at the head of the queue.

**Why.** PostgreSQL answers requests on a connection strictly in the order it received them. So "the oldest unfinished request owns the next message" is always true, and a FIFO of self-describing ops is the entire concurrency model: no locks, no request ids, no per-request state machines elsewhere.

**Alternatives.** A request/response loop that waits for each answer (pg's `Client`): simpler, but one query in flight. A map of ids: the protocol has no ids.

**Cost.** One slow query delays the answers to the queries behind it on that connection (head-of-line blocking). The pool's least-loaded placement and adaptive depth limit how much work lines up behind one connection.

**Code.** [connection.ts](connection.ts) `#queue`, `#dispatch`; [queue.ts](queue.ts).

### The driver knows nothing about the query builder

**What it is.** `src/driver/` imports nothing from the builder; everything quarry-specific is in [../driver-executor.ts](../driver-executor.ts).

**Why.** The driver can be tested against other drivers' suites, benchmarked alone, used without the builder (`quarry/driver`), and could be published separately. The builder stays free of protocol details.

**Alternatives.** Let the builder reach into connections (cheaper integration, but couples the two forever).

**Cost.** Concepts both sides need (codecs, the registry) live in the driver, and the builder only chooses them ([codec ownership](#codecs-owned-by-the-driver-chosen-by-the-caller)).

**Code.** [index.ts](index.ts); [../driver-executor.ts](../driver-executor.ts).

### PostgreSQL 18 or later only

**What it is.** Connecting to a server older than 18 fails with `EVERSION` ([capabilities.ts](capabilities.ts) `checkServerVersion`). A pooler that hides the version is assumed to front 18+.

**Why.** The driver can rely on protocol 3.2 (longer cancel keys), current SCRAM behaviour and current catalog columns, with no compatibility branches for old servers, which are where subtle bugs hide.

**Alternatives.** Support 12+ like most drivers: more code paths, and features (`transaction_timeout`, 3.2) that silently don't work.

**Cost.** Users on older servers can't use quarry.

**Code.** [capabilities.ts](capabilities.ts).

## Writing to the socket

### Coalesced writes: one write per microtask

**What it is.** Issuing a query doesn't write to the socket. It queues the op and schedules a flush in a **microtask** (`queueMicrotask`); every op queued during the same synchronous run of code is encoded into one buffer and sent with one `socket.write` ([ARCHITECTURE.md](ARCHITECTURE.md#writing-the-flush)).

**Why.** Each `write` is a system call and usually a network packet. `Promise.all([q1, q2, q3])` should cost one write, not three. A microtask runs right after the current code, so it adds no delay.

**Alternatives.**

- One write per message, grouped with `cork()`/`uncork()` per query (pg): 4–5 writes per query.
- `Buffer.concat` the pending chunk per query and flush on `setImmediate` (postgres.js): extra copies, and a deferred flush.
- A deferred flush in quarry (`setImmediate`, or several chained microtasks) was measured: 228–242k against 228k ops/s, within noise. With quarry's least-loaded placement, the burst of new queries triggered by a connection's answers goes back to that same connection, so a microtask flush already batches it. (Conversely, a microtask flush made postgres.js **worse**, 140k → 112k at 10 connections × 100 callers, because its round-robin placement spreads a burst over every connection: placement and flush timing have to match.)

**Cost.** A burst that spans several ticks goes out in several writes. Adaptive write coalescing under load is a possible follow-up (#25 found that a faster client sends smaller batches, which raised p99 slightly in one server-saturated scenario).

**Measured.** At 10 connections × 100 callers, quarry averages 5.1 queries per write (postgres.js 5.3, pg 1), at 4.5 µs of client CPU per query against 8.4 µs (postgres.js with its queue bug fixed) and 17.1 µs (pg).

**Code.** [connection.ts](connection.ts) `#schedule`, `#flush`.

### `TCP_NODELAY`

**What it is.** TCP sockets are opened with `setNoDelay(true)`, switching off **Nagle's algorithm**, which holds back small writes (up to ~40 ms) hoping to merge them with later ones.

**Why.** The driver already merges writes itself; Nagle would only add latency to every small query, notably during TLS handshakes.

**Alternatives.** Leave it on (postgres.js does). Measured on loopback for postgres.js: no throughput difference (there's always a response to carry the acknowledgement), but it matters on real networks and in handshakes.

**Code.** [node-socket.ts](node-socket.ts) `nodeSockets.connect`.

### Backpressure: 64 KiB chunks, and queued ops stay unencoded

**What it is.** A long queue is encoded and handed to the socket 64 KiB at a time. When `socket.write` returns `false` (the runtime's send buffer is full), the connection stops encoding: the rest of the queue stays as **op objects, not yet encoded**, until the socket's `drain` event ([ARCHITECTURE.md](ARCHITECTURE.md#backpressure)).

**Why.** Without it, a burst of queries (or a few with huge parameters) is encoded all at once into memory, far faster than the network can take it. An unencoded op is much smaller than its encoded bytes, and only what the network can absorb is ever materialised.

**Alternatives.** Encode everything and let the runtime buffer it (what the driver did before #15, and what pg does: neither uses `write`'s return value). Or block callers: impossible in JavaScript.

**Why 64 KiB.** It is Node's default stream high-water mark, the size at which the runtime itself starts reporting a full buffer, so chunks of that size let the driver notice backpressure at the right granularity without a write per query.

**Cost.** One more state flag (`#backpressure`) and a drain wait in the flush path.

**Measured.** 256 concurrent queries with 1 MiB parameters on one connection: peak RSS 840 → 140 MB (array buffers 1,024 → 75 MB), and the batch finishes in 330 ms instead of ~820 ms ([#15](https://github.com/shlokdesai33/quarry/pull/15)).

**Code.** [connection.ts](connection.ts) `FLUSH_BYTES`, `#send`, `onDrain`.

### Back-filled message lengths

**What it is.** Every protocol message starts with its length. The writer reserves 4 bytes for it (`begin`), writes the body, then fills the length in (`end`), in one pass over one growable buffer ([protocol/README.md](protocol/README.md#the-writer)).

**Why.** A message is written once, front to back, with no pass to compute its size first and no temporary buffer per message, and many messages (a whole pipeline) share one buffer and one `write`.

**Alternatives.** Compute each part's size, then write (two passes over every string: one to measure its UTF-8 length, one to encode). Build each message in its own buffer and concatenate them (pg's serializer: a copy per message).

**Cost.** None worth noting; a value's length (in Bind) is back-filled the same way.

**Code.** [protocol/writer.ts](protocol/writer.ts) `begin`, `end`.

### Pipelining, with one Sync per query

**What it is.** Queries are sent without waiting for earlier answers ([ARCHITECTURE.md](ARCHITECTURE.md#pipelining)), and each ends with its own **Sync** message. After an error, PostgreSQL skips every message until the next Sync, so with one Sync per query, a failing query doesn't fail the queries pipelined behind it.

**Why.** Pipelining turns N round trips into about one. The per-query Sync keeps each query's success independent, as it would be if they were sent one at a time.

**Alternatives.**

- No pipelining (pg's pool): one query per round trip per connection.
- One Sync for a whole pipeline (the "batch" mode some drivers offer): one failure aborts everything after it, which is wrong for unrelated queries from different callers.
- Several statements under one Sync is the right tool when they **should** fail together (a BEGIN with its first statement, an atomic batch), so the driver offers it explicitly (`queryGroup`, `SyncGroupOp`) and uses it only there.

**Cost.** A Sync message (5 bytes) and a ReadyForQuery reply per query, and the server ends its implicit transaction per query.

**Measured.** One connection, 100 callers, at 5 ms RTT: 189 ops/s without effective pipelining against 7,681 with it after #12, and 16,435 with the adaptive depth of #15.

**Code.** [ops.ts](ops.ts) `QueryOp.write`, `SyncGroupOp`.

## Prepared statements and PgBouncer

### Prepared statements by default, named per connection

**What it is.** Each distinct SQL text is prepared once per connection as a named statement (`q1`, `q2`, …); later runs send only Bind and Execute ([ARCHITECTURE.md](ARCHITECTURE.md#the-prepared-statement-cache)).

**Why.** Parsing and planning cost the server more than executing a point lookup. A named statement does them once, and its described columns let the driver choose binary formats and reuse a compiled row decoder.

**Alternatives.** Unnamed statements every time (pg's default): the server re-parses and re-plans every query. Describe first, then execute (postgres.js): two round trips on a statement's first use, always with `prepare: false`.

**Cost.** Server memory per statement per connection (bounded by the cache), and stale-statement handling after schema changes.

**Measured.** Point lookup on Node: 28 µs against 46 µs for unnamed pg and 35 µs for named pg; it halves the server's CPU per query (8.0 µs against 30.1 µs for unnamed pg in the pipelining experiment).

**Code.** [connection.ts](connection.ts) `#statement`; [ops.ts](ops.ts) `QueryOp.write`.

### A bounded LRU cache with use stamps

**What it is.** The cache holds at most `statementCacheSize` (100) statements per connection. When full, the **least recently used** one is evicted and a Close message for it is written just before the new Parse. "Recently used" is tracked with a **use stamp**: a counter value written on the entry at each lookup; eviction scans for the lowest stamp.

**Why.** An unbounded cache (postgres.js) grows server memory without limit for apps that generate many distinct statements. The classic JavaScript LRU, deleting and re-inserting the key so it moves to the end of the `Map`, makes the `Map` rehash, which is garbage on every single query ([GC](#allocation-cuts-for-the-small-query-tail)).

**Alternatives.** Map re-ordering (the textbook LRU): O(1) eviction, but a rehash allocation per hit. A linked list: more code and objects per entry. Never evict (pg's named statements): unbounded.

**Cost.** Eviction is an O(n) scan over 100 entries, but it only happens on a miss with a full cache, which is rare.

**Measured.** Part of [#25](https://github.com/shlokdesai33/quarry/pull/25)'s per-query garbage cut (the "LRU touch" was one of the allocation sources it removed).

**Code.** [connection.ts](connection.ts) `#statement`.

### Retry a stale statement once, unprepared

**What it is.** When a cached statement fails because the schema changed under it ("cached plan must not change result type", a parameter type that no longer fits, or the server no longer has it after `DEALLOCATE`/`DISCARD ALL`), the driver drops it and retries the query once as an unnamed statement, outside a transaction ([ops.ts](ops.ts) `staleStatement`).

**Why.** A deploy that alters a column shouldn't make every long-lived connection fail its cached queries until it's restarted.

**Alternatives.** Report the error (what pg does): every connection fails once per statement after a migration. Retry inside a transaction: impossible, the error already aborted it.

**Cost.** The retry is unnamed (to pass through poolers that would map a new Parse back to the stale statement); if even a fresh Parse is stale, the SQL is marked never to be prepared on that connection (`unprepare`).

**Code.** [ops.ts](ops.ts) `staleStatement`, `QueryOp.#finish`.

### Unnamed statements for pipelined queries behind PgBouncer

**What it is.** Behind PgBouncer in transaction mode (detected at login), a query that is **pipelined with others** on its connection is sent as an unnamed statement (Parse, Bind with the cached binary formats, Describe of the portal), reusing the cached columns and decoder. A query **alone** on its connection stays named ([ARCHITECTURE.md](ARCHITECTURE.md#part-8-behind-pgbouncer)).

**Why: the PgBouncer CPU finding.** With 50 callers, PgBouncer (single-threaded) was CPU-bound at ~95% of a core, so its CPU per query set the throughput: about 13.5 µs with named statements against 10.6 µs unnamed. Reading its source showed why: before each **named** Bind it flushes what it has buffered, writes a rewritten Bind header (with its own `PGBOUNCER_<n>` name) as a separate buffer, then forwards the rest. So every named query reaches the server in two writes, while unnamed messages pass through and a client's batch goes out in one. `strace` confirmed it: 20,000 pipelined inserts took 40,001 `write` calls named against 9,852 unnamed (10,074 with the fix).

**Alternatives.**

- `prepare: false` behind PgBouncer: matches on inserts at 50 callers, but loses at low concurrency, where parse/plan and text decoding cost more than the extra write: point lookups at 1 caller 16.3k against 11.2k/s, at 10 callers 59.1k against 44.1k.
- Always named: the PgBouncer bottleneck under load.
- Unnamed only when pipelined combines both.

**Cost.** Detection relies on PgBouncer 1.26+ reporting itself; 1.21–1.25 need `preparePipelined: false`. An unnamed query's columns are checked against the cache on every run (a schema change drops the entry; a column asked for in binary that changed to a type with no binary decoder fails that query with `DecodeError`).

**Measured.** Through PgBouncer with 50 callers: point lookups 68,915 → 76,781/s (+11%), inserts 64,474 → 79,461/s (+23%, against 83,130 for `prepare: false`); direct connections unchanged ([#24](https://github.com/shlokdesai33/quarry/pull/24)). After the fix, 0 of 100,000 Binds were named at 50 callers.

**Code.** [capabilities.ts](capabilities.ts) `statementNames`; [connection.ts](connection.ts) `naming`, `ctx.named`; [ops.ts](ops.ts) `#describedUnnamed`.

### Detect poolers at login rather than configure them

**What it is.** PgBouncer 1.26+ reports `pgbouncer.version`, `pool_mode` and `max_prepared_statements` as ParameterStatus at login; the driver reads them into `connection.capabilities` and picks its naming mode (`kept`, `rewritten`, `unsupported`). With `max_prepared_statements = 0` in transaction mode, no statement is named (it would land on the wrong server connection).

**Why.** The right behaviour depends on what's in between, which the app often doesn't know (an infrastructure team changes the pooler). Detection makes the default correct.

**Alternatives.** A required `pgbouncer: true` option (easy to forget, wrong after infra changes).

**Cost.** Older PgBouncers aren't detected (documented override).

**Code.** [capabilities.ts](capabilities.ts).

## Codecs, types and formats

### Codecs owned by the driver, chosen by the caller

**What it is.** One `Codec` object per Postgres type does all encoding and decoding, both directions ([CODECS.md](CODECS.md)). The driver owns them; a caller (the query builder, or `typed(value, codec)`) only says which codec applies to each parameter and column.

**Why.** Before #28, a value went through the builder's `DataType.serialize`, then the driver's JavaScript-type encoder; results through per-OID parser tables. The same type's encoding lived in several places that could disagree, and the builder's declared types could lie about what came back. With one codec per type, the column's TypeScript type is the codec's output type by construction, and the driver can pick formats per column.

**Alternatives.** Keep separate serializers and parsers (two places to change per type). Let the builder encode to bytes itself (duplicating the driver's binary encoders).

**Cost.** A breaking change at the time (#28), and the driver's codec interface is now public API.

**Measured.** Performance-neutral against main through the builder (−2% to +2% across 12 cells) and on the raw driver (within ±3% over 9 runs) ([#28](https://github.com/shlokdesai33/quarry/pull/28)). The "double conversion" it replaced had been measured at about 10 ns per value, under 1% of a query, so the change was about correctness, not speed.

**Code.** [codec.ts](codec.ts), [codecs.ts](codecs.ts), [registry.ts](registry.ts).

### Exact parameter OIDs, except for text-like types

**What it is.** A parameter with a codec declares its type's OID in Parse ([CODECS.md](CODECS.md#declaring-parameter-types)), except codecs marked `inferParamType` (`text`, `varchar`, `bpchar`, `name`, `char`, `raw`), whose type is left for the server to infer (OID 0). Named types get their OIDs from the catalog; until it's loaded, they're inferred too.

**Why declare.** An exactly typed parameter can't be inferred wrongly (`select $1` has no context; `timestamptz - $1` is ambiguous), and the server skips inference.

**Why not for text-like types.** Declaring `text` changes meaning against other string-like columns: a `text` value compared with a `citext` column compares case-sensitively; against an enum or `char(n)` column Postgres may refuse ("column is of type X but expression is of type text") or coerce differently. Inference from the column is what users expect.

**Alternatives.** Never declare (what the driver did before #28): wrong inference in edge cases, and no binary arrays. Always declare: breaks citext and enums.

**Cost.** The statement cache key includes the declared OIDs (+0.3 µs per small query in #28's profile), and the OID array is built per query (+0.3 µs).

**Code.** [params.ts](params.ts) `paramOids`; [codec.ts](codec.ts) `declareParamType`.

### Binary only after describe

**What it is.** Result columns are asked for in binary only once the server has **described** the statement's columns, which for ordinary queries means a cached statement's second run ([CODECS.md](CODECS.md#binary-after-describe)). The first run, and unprepared queries, read text. (Cursors are the exception: [below](#cursors-describe-first-for-binary-from-the-first-run).)

**Why.** The formats are sent in Bind, **before** the server says what the columns' types are. Asking for binary means guessing the type. A guess is wrong whenever an expression's type isn't what the caller thought, a column was altered since the code was written (**schema drift**: a column declared `integer()` that is really `bigint`), or raw SQL is used. Binary bytes of an unexpected type can't be decoded, nor even turned back into text on the client: the only recovery would be to discard the rows and run the query again in text.

**Alternatives.**

- **First-run binary from the builder's types** was prototyped and measured: first runs at 10k rows 2× faster (7.0 → 3.1 ms), unprepared queries at 10k rows +108%, statement churn +71% ([binary vs text benchmark; unified-codecs A/B in #28](https://github.com/shlokdesai33/quarry/pull/28)). It was **dropped**: it needs a mismatch check, a discard-and-retry path and fallback decoders, all to protect against drift that would otherwise silently fail queries; and for the common case (small results) the first run's cost is Parse and Describe, not decoding (forcing binary changed a 1-row first run from 60 to 65 µs, within noise). The maintainer chose schema-drift safety.
- **Describe first, then bind binary**: one extra round trip on every first run: +34 µs for a 1-row query on loopback, a full RTT on a network. Rejected for queries; accepted for cursors, where it's amortised over a large result.

**Cost.** First runs and `prepare: false` queries with large results stay about 2× slower to decode than they could be. It matters for short-lived connections (serverless), statement churn beyond 100 statements, and poolers without prepared statements.

**Code.** [ops.ts](ops.ts) `QueryOp.write` (`#requested = 0` before columns are known); [results.ts](results.ts) `resultPlan`.

### Which types are binary and which stay text

**What it is.** Results are read in binary for `bool`, `int2`, `int4`, `oid`, `int8` (as `bigint`), `float8`, `bytea`, `timestamptz`, pgvector's `vector`, and arrays of those, of text-like types and of json/jsonb. Everything else (numeric, uuid, date, time, text, enums, jsonb scalars, int8 as a string, float4) stays text ([CODECS.md](CODECS.md#the-built-in-codecs)).

**Why.** Binary wins when the JavaScript value **isn't a string**: it skips building a string and then parsing it. It ties or loses when the value is returned as a string anyway, because JavaScript then has to build that string itself, which is slower than Node's one native UTF-8 slice.

**Measured** (decode ns per value, Node, text → binary; [binary vs text benchmark](https://github.com/shlokdesai33/quarry/pull/19)):

| Type → JS value          | Text → binary               | Rows/s at 10k rows | Verdict                                                    |
| ------------------------ | --------------------------- | ------------------ | ---------------------------------------------------------- |
| timestamptz → `Date`     | 257 → 80                    | +140%              | binary (biggest hot-type win; server CPU 2,946 → 1,464 µs) |
| float8 → number          | 140 → 50                    | +73%               | binary                                                     |
| bytea → `Uint8Array`     | 269 → 82                    | +143%              | binary (hex text doubles the bytes)                        |
| int4 → number            | 134 → 42                    | +26%               | binary                                                     |
| bool → boolean           | 82 → 44                     | +4%                | binary (free)                                              |
| uuid → string            | 92 → 99                     |                    | text                                                       |
| numeric → string         | 98 → 79 (Bun: 61 → **123**) |                    | text                                                       |
| int8 > 2^53 → string     | 93 → 73 (Bun: 80 → **240**) |                    | text (BigInt is slow on Bun)                               |
| jsonb → parsed           | 615 → 572                   | noisy              | text (binary is a version byte plus the same text)         |
| `int4[10]` → number[]    | 709 → 124                   | +89%               | binary                                                     |
| `vector(128)` → number[] | 5,129 → 1,451               | +208%              | binary (server CPU 50,645 → 9,691 µs)                      |

1-row queries show no difference at all (median −0.4 µs on a 46 µs query); binary matters from tens of rows up.

**Alternatives.** All binary: breaks every type without a binary decoder (extensions, domains, custom codecs), and loses on string types. All text: leaves the large-result wins.

**Cost.** `float4` stays text because binary would change visible values (`0.1` reads as `0.10000000149011612`); `vector` accepted that change (its values are float32 by nature, and the gain is 3×), applied on both paths so text and binary agree. Binary formats also don't depend on session settings (DateStyle, `bytea_output`), a robustness bonus.

**Code.** [codecs.ts](codecs.ts) (`resultFormat` per codec, `readArraysInBinary`).

### Binary array parameters, with a per-array fallback

**What it is.** An array parameter of a type the driver has an encoder for (`bool`, `int2/4/8`, `float8`, `timestamptz`, `uuid`, text-like, `jsonb`, `bytea`) is sent in Postgres's binary array format, when its type is declared and every element fits; otherwise as a `{…}` literal ([array-params.ts](array-params.ts)).

**Why.** Array literals were the single biggest inefficiency in the encode path: building them cost 14–41 µs per 100 elements in JavaScript (quoting and escaping each element), and parsing them cost the server 40–60% more CPU than reading binary. Bulk inserts (`unnest`) and `id = any($1)` send big arrays.

**Alternatives.** Binary **scalar** parameters: measured as noise end to end (the best case saves 0.4 µs on a 25–35 µs query), and they need exact OIDs, so not done. A faster text literal builder: 2–5× faster, but binary is faster still (0.46 µs against 2.8 µs for `int4[100]`).

**Cost.** One encoder per element type; strict checks (an int8 above 2^53 needs BigInt arithmetic; timestamps past the year 2285 overflow 2^53 microseconds, so they're split into 32-bit halves, a precision trap the benchmark's correctness check caught). The fallback keeps odd inputs (nested arrays, non-canonical uuids) correct.

**Measured.** 1k rows of `int4[100]` + `text[20]`: 118 → 266 queries/s; bulk insert of 1k rows through `unnest`: 514 → 674/s; through the builder, a 1,000-row × 8-column insert 5.83 → 3.94 ms ([#19](https://github.com/shlokdesai33/quarry/pull/19)).

**Code.** [array-params.ts](array-params.ts) `binaryArray`; [codec.ts](codec.ts) `arrayOf`.

### Arrays of text read as one latin1 string

**What it is.** A binary `text[]` is decoded by converting the whole array value to one latin1 string once, then slicing each ASCII element out of it with `slice`; non-ASCII elements fall back to a UTF-8 decode ([binary.ts](binary.ts) `arrayDecoder`).

**Why.** Decoding each element separately with a native UTF-8 call was **slower than the text path** on Node; one native call plus cheap substrings beats many native calls.

**Measured.** `text[5]` mean decode including GC 644 → 441 ns; +12% to +67% rows/s.

**Code.** [binary.ts](binary.ts).

### Named types resolved once per pool through the catalog

**What it is.** Codecs for types without fixed OIDs (enums, domains, extension types) are resolved by name with one `pg_type` query per pool, behind the first query that needs it, or up front with `loadTypes()` ([CODECS.md](CODECS.md#types-looked-up-by-name-the-catalog)).

**Why.** Once resolved, such parameters declare their exact type and such columns can be read in binary, like built-ins, at no per-connection cost.

**Alternatives.** Query the catalog at every connect (postgres.js: ~3.4 round trips per startup instead of ~2.2); never resolve (named types stay text and inferred).

**Cost.** The query that triggers the load goes out with the named type inferred and read as text (so ordering is never changed); a type created later needs `reloadTypes()`.

**Code.** [registry.ts](registry.ts) `TypeCatalog`; [connection.ts](connection.ts) `#loadTypesAfter`.

### `undefined` is refused, never sent as NULL

**What it is.** A parameter that is `undefined`, or contains `undefined` anywhere in an array, throws `UndefinedParameterError` with its position (`$2[3]`) before anything is sent.

**Why.** `undefined` almost always means a missing value (a typo, an optional field). Sent as NULL, `where email = $1` would match no row and look like "not found". `null` is the explicit way to send NULL.

**Alternatives.** Send NULL (pg). Send an empty string. Both hide bugs.

**Code.** [params.ts](params.ts), [types.ts](types.ts) `undefinedAt`.

## Reading and decoding

### Zero-copy reads: messages decoded in place

**What it is.** The reader finds message boundaries inside the socket's chunks and gives the caller **offsets into the chunk**; only a message split across two chunks is copied, into a buffer of exactly its size. Consumed chunks are released ([protocol/README.md](protocol/README.md#the-reader)).

**Why.** Copying every message (or re-joining a chunk's tail with the next chunk) costs time and memory proportional to everything received, and made large rows quadratic. Before #20, the unread tail of nearly every 64 KB chunk was re-copied, and the last joined buffer stayed referenced while the connection was idle.

**Alternatives.** A growable read buffer that new data is appended to (common, simple, but copies everything at least once and keeps a large buffer alive).

**Cost.** Values must be copied out when a row keeps them (`bytea`), so rows never alias, or keep alive, the read buffer.

**Measured.** Streaming 1M rows: peak RSS 217 → 151 MB; 100k-row fetch 482 → 466 MB; throughput unchanged or slightly better ([#20](https://github.com/shlokdesai33/quarry/pull/20)).

**Code.** [protocol/reader.ts](protocol/reader.ts).

### Strict bounds checks on every read

**What it is.** A message length below 4 or above `maxMessageSize` (1 GiB by default) is a `ProtocolError`; inside a message, every read is checked to stay within it, and C strings must end inside it ([protocol/README.md](protocol/README.md#bounds-and-limits)). A `ProtocolError` closes the connection.

**Why.** A corrupt or hostile length could otherwise make the driver allocate without bound, or read into the next message and return wrong values for later queries. Nothing after a framing error can be trusted, so closing is the only safe answer.

**Cost.** A comparison per read; the row decoder checks value lengths in its generated code.

**Code.** [protocol/reader.ts](protocol/reader.ts) `Cursor`, `#need`.

### DataRow fast path: no message objects for rows

**What it is.** When the connection sees a DataRow (type byte `D`), it hands the buffer and offsets straight to the operation's row decoder, without creating a message object ([ARCHITECTURE.md](ARCHITECTURE.md#reading-replies)).

**Why.** Rows are by far the most frequent message; an object per row is pure garbage.

**Alternatives.** A message object per row, then parse (pg-protocol).

**Code.** [connection.ts](connection.ts) `#onData`; [ops.ts](ops.ts) `dataRow`.

### Generated, monomorphic row decoders

**What it is.** For each result shape (column list, codecs, formats, row mode), the driver generates a JavaScript function with `new Function` that decodes a DataRow straight into an object literal created with all its keys (`{"id": null, "name": null}`), each column's decoder a constant in the code ([CODECS.md](CODECS.md#row-decoders)).

**Why.** A generic loop allocates a temporary values array per row, branches per value on text vs binary, and builds objects key by key, giving them different hidden classes. Generated straight-line code does none of that, and every row object has the same shape (**monomorphic**), which keeps V8's property access fast in your code too.

**Alternatives.** A generic decoder loop (the fallback, still used where `new Function` is forbidden). Holding values in local variables and building the object at the end: compile cost grew with columns², so values are written into the row as they're decoded.

**The 8-column split.** One generated function for 99 columns cost +67 MB of native memory: V8's optimising compiler (Maglev) needs memory superlinear in function size, and the process never returns it. Splitting into functions of at most 8 columns cost +6–8 MB.

**Cost.** Generated code is harder to read and debug; a source cache (dropped past 4 M characters) so decoders of one shape share compiled code across connections; a fallback path to keep correct. Faster decoding also raised the benchmark's **fixed-time-window** memory peak (more fetches fit in the window before a GC), though at equal work the peak is lower.

**Measured.** Decoder microbenchmark: 6 columns 323–394 ns per row (before: 1,068), 100 columns 3.8–4.0 µs (before: 8.3); 1M-row fetch 500 → 458 ms; 100k rows 42.5 → 37.3 ms ([#21](https://github.com/shlokdesai33/quarry/pull/21)).

**Code.** [rows.ts](rows.ts).

### Decode only the rows a caller keeps (`keepRows`)

**What it is.** A query can say "keep only the first N rows" (`keepRows`); the op skips decoding every row after that, while the query still runs to completion and the row count still counts every row ([ARCHITECTURE.md](ARCHITECTURE.md#keeprows)).

**Why.** The builder's `takeFirst()` reads one row and `expectOne()` two, without adding `limit` to the SQL ([../DECISIONS.md](../DECISIONS.md#no-implicit-limit-in-result-shapes)). Decoding is most of the client's per-row work, so skipping it makes those shapes cheap on the client even when the query returns many rows.

**Alternatives.** Add `limit` (changes the SQL: different statement, fewer rows locked, a wrong "too many rows" count). Decode everything and drop rows (wasted CPU).

**Cost.** A value that fails to decode in a skipped row goes unnoticed (documented).

**Code.** [ops.ts](ops.ts) `QueryOp.dataRow`.

### Shared constant messages and repeated-string caches

**What it is.** Messages with no fields (ParseComplete, BindComplete, NoData, …) and the three ReadyForQuery variants are shared, never-modified objects; the last command tag (`SELECT 1`) is kept and reused when the next tag has the same bytes ([protocol/README.md](protocol/README.md#decoding)).

**Why.** Every query receives several of these; allocating them is pure garbage.

**Cost.** None visible; the tag bytes are copied, so the cache never keeps a read buffer alive.

**Code.** [protocol/reader.ts](protocol/reader.ts), [ops.ts](ops.ts) `parseTag`.

## Memory and garbage collection

### Allocation cuts for the small-query tail

**What it is.** A set of changes ([#25](https://github.com/shlokdesai33/quarry/pull/25)) that cut the garbage a small query allocates from ~5.0 KB to ~2.2 KB (the driver's own share from ~3.7 KB to ~0.8 KB).

**Why: the GC finding.** On small sequential queries, quarry's p99.9 latency was set by garbage collection, not by the protocol. Each V8 young-generation collection (**scavenge**) pauses ~0.3 ms almost regardless of how much it collects, and in a sequential loop each pause lands on one query. At ~40k queries/s, 0.1% of queries is 40 per second, so the **rate** of scavenges sets p99.9. quarry scavenged ~60 times/s on `select 1`, postgres.js ~10, and 70–80% of quarry's queries over 150 µs overlapped a GC. The rate is allocation divided by young-generation size, so the fix was to allocate less.

**What was cut** (each measured with V8's sampling heap profiler):

| Source                                                                   | Per query | Fix                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a 30 s idle `setTimeout` armed on release, cleared on take               | ~370 B    | [one sweep timer](#one-sweep-timer-for-every-idle-connection)                                                                                                                                                                                                                                       |
| `Map`/`Set` churn: the LRU touch, the pool's busy `Set` and shared `Map` | ~420 B    | [use stamps](#a-bounded-lru-cache-with-use-stamps); per-connection `Slot` fields                                                                                                                                                                                                                    |
| an async frame, `await` and closure per `pool.query`                     | ~600 B    | a fast path with no async frame: the connection calls the op's `onDone` synchronously                                                                                                                                                                                                               |
| `push` after `shift` on a length-1 array                                 | 152 B     | [`Queue`](queue.ts) keeps its capacity                                                                                                                                                                                                                                                              |
| `Writer.take`'s `slice` copy, then Node wrapping it in a `Buffer`        | ~350 B    | copy into a pooled `Buffer`                                                                                                                                                                                                                                                                         |
| closure contexts, result wrappers, default options, message objects      |           | a shared promise executor, default options built once, watchers in their own methods (V8 allocates a closure context on entry to any function where an inner closure captures a local, even on paths that never create it), [shared messages](#shared-constant-messages-and-repeated-string-caches) |

**Alternatives.** Grow the young generation (`--max-semi-space-size`): a deployment flag, not a library fix. Accept the tail (it's what pg does).

**Cost.** Code that looks unusual (no closures in hot paths, a shared executor, comments explaining why). One side effect: with 50 concurrent inserts on a pool of 10, p50 fell (199 → 52 µs) but p99 rose (2.8 → 4.8 ms) at the same throughput, because a faster client sends smaller write batches.

**Measured.** Node, sequential: `select 1` p99.9 368 → 264 µs (postgres.js 363), GCs/s 60 → 33, throughput 39.0k → 43.4k/s; point lookup p99.9 446 → 364 µs. Bun: `select 1` p99.9 258 → 62 µs (Bun.sql 191). Throughput sweep: median +4.9%.

**Code.** [pool.ts](pool.ts), [connection.ts](connection.ts), [queue.ts](queue.ts), [protocol/writer.ts](protocol/writer.ts), [protocol/reader.ts](protocol/reader.ts).

### One sweep timer for every idle connection

**What it is.** Instead of a `setTimeout` per idle connection (armed when it's released, cleared when it's taken), the pool keeps **one** timer set for the earliest idle or lifetime deadline; parking a connection only re-arms it if its deadline is sooner ([POOL.md](POOL.md#idle-timeout-lifetime-and-min)).

**Why.** Under load, connections are released and taken thousands of times per second; each arm/clear allocated a Timeout, an idle-list record and a closure (~370 B per query).

**Alternatives.** Per-connection timers (simple, common). A periodic interval (wakes the process for nothing when idle).

**Cost.** A sweep closes everything due at once, slightly later than an individual timer might have. Timers are `unref`'d.

**Code.** [pool.ts](pool.ts) `#armSweep`, `#sweepIdle`.

### The writer: reserve one byte per character, hand off big buffers

**What it is.** When a string doesn't fit in the writer's free space, it reserves 1 byte per character, and 3 only for a non-ASCII remainder; a buffer that grew past 1 MiB for one message is handed to the socket instead of copied, and replaced with a small one. Short ASCII strings are copied byte by byte instead of through `TextEncoder.encodeInto` ([protocol/README.md](protocol/README.md#the-writer)).

**Why.** Reserving 3 bytes per character (UTF-8's worst case for JavaScript strings) tripled the buffer for large values; keeping a grown buffer pinned it for the connection's life. `encodeInto` needs a view object per call, which costs more than copying a short string.

**Measured.** A 64 MB text parameter: 256 MB of write buffer kept afterwards → 0 ([#20](https://github.com/shlokdesai33/quarry/pull/20)). A Bind with 300 short parameters: 28 → 17 µs on Node, 20 → 11 µs on Bun ([#19](https://github.com/shlokdesai33/quarry/pull/19)).

**Code.** [protocol/writer.ts](protocol/writer.ts).

## The pool

### Pipelining onto busy connections, only once the pool is full

**What it is.** `pool.query()` takes an idle connection if there is one; once every connection is busy and the pool is at `max` (or at its [adaptive width](#adaptive-width-no-more-pipelined-backends-than-the-server-runs-at-once)), it pipelines the query onto the **least-loaded** connection already running queries; beyond that, it waits for a **pipeline slot** ([POOL.md](POOL.md#pipelining-onto-busy-connections)).

**Why.** A pool without pipelining caps throughput at `max` queries per round trip; opening more connections costs server processes. Sharing busy connections gets far more throughput from the same connections. Before the pool is full, a fresh connection is better than sharing.

**Alternatives.** One query per connection (pg-pool). Round-robin over busy connections with "fill to the cap, then drain to zero" (postgres.js): stop-and-go pipelines, and round-robin needs a deferred flush to batch well.

**Cost.** Head-of-line blocking within a connection; the pool needs the bookkeeping below.

**Measured.** See the next two entries.

**Code.** [pool.ts](pool.ts) `#claimShared`, `#pickShared`.

### A FIFO of pipeline slots, with slot hand-off

**What it is.** Queries that find no free slot wait in their own FIFO (`#sharedWaiters`), separate from callers that need a whole connection (`#waiters`). When a pipelined query finishes, `#done` hands its slot **straight to the next queued query**; the pipeline is a sliding window that never drains just to be refilled ([#12](https://github.com/shlokdesai33/quarry/pull/12)).

**Why: the throughput cliff.** Before #12, the pool refused to pipeline while any caller was queued, and a freed connection went to one waiter at a time. Once one caller had to queue, every later caller queued too, and under sustained load the queue never drained: the pool fell back to one query per connection for good.

**Alternatives.** Hand freed connections to waiters one at a time (the old behaviour). Let new arrivals jump the queue onto free slots (unfair; arrivals don't jump: `#pickShared` only picks when nothing is queued).

**Cost.** One regression on loopback: pool 10 at 400–500 callers, 0 ms RTT, 11–16% slower (the old pool's intermittently shallower pipelines happened to overlap client and server work better there); at any network latency, the steady deep pipelines win.

**Measured.** At the cliff: pool 1 × 100 callers 31,670 → 118,058/s (+273%); pool 10 × 1000 callers 84,195 → 281,957/s. One connection, 100 callers, 5 ms RTT: 189 → 7,681/s (p99 597 → 13.6 ms) ([#12](https://github.com/shlokdesai33/quarry/pull/12)).

**Code.** [pool.ts](pool.ts) `#fillShared`, `#done`, `#waitShared`.

### Draining a shared connection for exclusive callers

**What it is.** A caller that needs a connection to itself (a transaction, a cursor, COPY, `acquire()`) can't share one. While such callers wait and the pool is full, `#rebalance` marks one shared connection per waiter (the least loaded) as **draining**: it takes no new queries, and is handed to the waiter as soon as its in-flight queries finish ([POOL.md](POOL.md#draining-for-exclusive-callers)).

**Why.** Under a steady stream of queries, a shared connection never becomes free on its own, so a transaction could wait forever (**starvation**). Draining bounds the wait to one pipeline's worth of queries, however fast new queries arrive, while the other connections keep pipelining.

**Alternatives.** Priority queues (still starve if slots are handed straight to queued queries). Reserve connections for exclusive use (wastes capacity when there are none). Stop all pipelining while anyone waits (the old cliff).

**Cost.** One connection's pipeline capacity per waiter, briefly.

**Measured.** #12's tests: under a sustained 60-caller load, a transaction, a held `acquire()` and a cursor each get a connection within a bound, while the other connection keeps pipelining (over 30 queries per 100 ms). With draining disabled, the held `acquire()` starved until its 5 s timeout.

**Code.** [pool.ts](pool.ts) `#rebalance`.

### Adaptive pipeline depth, from 100 to 1000

**What it is.** How many queries a shared connection may carry adapts per connection ([POOL.md](POOL.md#adaptive-pipeline-depth)). It starts at 100. One shared query in 8 is timed; each round (about `limit` queries), the average timed latency is compared with the fastest latency seen, an estimate of one round trip. Under 1.5× the fastest, with callers waiting, the network is the bottleneck: grow ×1.5, up to 1000. Over 3×, queries are queueing on the server: shrink ×0.75, never below 100.

**Why.** On a network, one connection's throughput is at most depth ÷ RTT: a fixed 50 caps it at 2,500/s at 20 ms. Deeper pipelines fix that. But when the server is the bottleneck, more depth only lines queries up behind each other, which is unfair to slow queries.

**Why not a fixed 1000.** On uniform point lookups, fixed 1000 matches adaptive. On a mixed workload (10 connections, 5,000 callers doing lookups, plus 20 callers running 20 ms queries), fixed 1000 starved the slow queries: each lined up behind ~500 pipelined lookups.

| Variant           | Fast ops/s | Fast p99.9 | Slow ops/s |
| ----------------- | ---------- | ---------- | ---------- |
| fixed 50 (before) | 150k       | 76 ms      | 376        |
| **adaptive**      | 152k       | 81 ms      | 381        |
| fixed 100         | 151k       | 83 ms      | 381        |
| fixed 1000        | 254k       | **446 ms** | **45**     |

The adaptive depth sees the queueing in its latency ratio and stays at 100.

**Why the fastest latency only decreases.** A growing round trip then makes the depth err towards shallow, the safe side.

**Alternatives.** A fixed 50 (before #15), a fixed 100 (postgres.js's `max_pipeline`), a fixed 1000, or making users tune it (`pipeline: n` still fixes it).

**Cost.** Sampling (`performance.now()` on 1 in 8 queries); `#pickShared` skips the depth lookup below the floor, so the 0 ms hot path stays flat.

**Measured.** One connection, 100 callers: 1 ms RTT 24,507 → 42,425/s (postgres.js 32,063), 20 ms 2,317 → 4,701/s. One connection, 1000 callers: 5 ms 7,757 → 126,551/s (postgres.js 7,939). No measurable change at 0 ms (median +0.8% over 24 cells; an A/A control differed by up to 4%) ([#15](https://github.com/shlokdesai33/quarry/pull/15)).

**Code.** [pool.ts](pool.ts) `Depth`, `#timing`, `#sample`.

### Adaptive width: no more pipelined backends than the server runs at once

**What it is.** The pool spreads `query()` (and so, since #37, builder queries and default `db.batch` calls) over at most `limit` connections (its **width**), from `max` down to 1, and adapts it: it narrows when connections **stall** (a connection with queries in flight completes nothing while the rest of the pool completes everything in flight) and grows back when they don't. Queries beyond the width's pipelines wait in the shared FIFO for whichever connection frees a slot first ([POOL.md](POOL.md#adaptive-width)).

**Why: the CPU-saturated server.** After #25 made the client cheaper, the concurrency sweep put the server's CPUs at 100%, and p99 roughly doubled at 500–1000 callers (pool 10, 500 callers: 3.9 → 7.0 ms on Node; Bun 2.9 → 9.2 ms) while throughput rose. Tracing it on a 4-vCPU VM (PostgreSQL on 2 CPUs), pool 10 × 500 callers:

- p50 0.5 ms, p99 20 ms; almost all of it between writing a query and its result (pool queue wait p99 5 µs);
- each connection had queries in flight but received nothing for 83% of the time, in gaps of 1–40 ms; the ten backends spent ~9.5 s per second waiting for a CPU (`/proc/<pid>/schedstat`), a pool of 2 ~8 ms;
- the client read 1.0 result per read and wrote 1.0 query per write: under load there was no batching left to tune.

A pipelined connection always has input waiting, so its backend never sleeps. With more such backends than CPUs, the kernel time-slices them, and every query pipelined on a descheduled backend waits for whole slices while the running ones serve their callers in microseconds; least-loaded assignment even sends each caller's next query back to the backend that just answered. The tail grows with the number of backends: pool 50 × 500 had p50 0.09 ms and p99 56 ms. Fewer connections did better on both counts: a pool of 2 gave 227k/s at p99 4.4 ms, against pool 10's 206k/s at 20 ms. pg has no such tail (its backends sleep after every query) but runs at 50k/s. The adaptive depth (above) and the FIFO (#12) weren't the cause: depth stayed at its floor of 100, nobody queued, and fixed depths of 16 or 50 had the same tail.

**How it decides.**

- **Stalls without a clock.** A completion counter, and each connection's count at its own last completion: a gap longer than one turnover of the pool (everything in flight) is a stall. A network round trip takes about one turnover (Little's law), and a GC pause stops every connection at once, so neither counts. Each epoch of 4096 completions sums stalled and total connection time, including stalls still open at its end.
- **Narrowing.** With W pipelined backends on C CPUs, each is off its CPU about 1 − C/W of the time, so W × (1 − stalled) estimates C. Above 25% stalled two epochs in a row, the width drops to that (not below 2 in one step). The connections to drop (stalled ones first) take no new queries and go idle once theirs finish; the others keep pipelining.
- **Picking.** Among connections with room, the least loaded one that isn't stalled: a query sent to a stalled connection waits with it.
- **Judged, because slow queries stall too.** A connection behind a 20 ms query also stalls, and there fewer connections would only queue more lookups behind it. A narrowing is kept only if stalls then fell by a quarter (or below 25%) and the mean latency (in flight plus queued, over the completion rate) didn't double; otherwise the next try waits four times as long (4 to 1024 epochs). It is undone at once if, once it settled, completions come at under three fifths of the rate before: under CPU contention the CPUs stay busy whatever the width, so that only happens behind slow queries, and the next try waits the full 1024 epochs.
- **Growing.** Below 5% stalled, with queries pipelined or queued at the width, +1; a growth that brings stalls back doubles the wait before the next; one that holds halves it.
- **Not judged:** the epoch after a change, one in which the pool ran out of queries, and one in which a connection took queries for the first time. While a pool of 50 fills up, not every connection is busy, stalls read low (50–60% instead of 96%), and the first narrowing would aim at 20 connections instead of 2.

**Alternatives.**

- **A latency target for the depth** (cap each connection's depth so queries finish within k × the fastest): moves queries into the FIFO but keeps every backend busy. Depth 4 on pool 10 × 500 gave p99 7.5 ms but 147k/s, against the default's 197k; depth 8, 8.6 ms at 171k/s.
- **Batch refills** (a shared connection takes queued queries only once it has drained, so its backend sleeps between batches): pool 10 × 500 216k/s at p99 6.9 ms, but about a quarter slower at pool 10 × 100 and pool 50 × 500, and stop-and-wait on a single connection at any RTT.
- **Adaptive write coalescing**: nothing to coalesce; under load each read carried one result.
- **A fixed smaller `max`**: the right width depends on the server's free CPUs, which the client can't know and which change with other clients.
- **Narrowing on stalls alone**: 20 callers of `pg_sleep(0.02)` beside 5,000 lookups stall every connection; the first version shrank the pool to one connection and fell from 155k to 14k lookups/s. Hence the judging.

**Cost.**

- A few integer operations per completion and, per epoch, one `performance.now()` and a scan of the slots.
- Under a CPU-saturated server the median rises (queries wait their turn in the FIFO instead of a lucky few cycling on a running backend), while p99 and p99.9 fall.
- At 1000 callers, a wider stalling pool can squeeze a few percent more throughput out of the server (main on the VM above: 235k/s at pool 2, 255k at pool 5, at p99 7.8 against 11.7 ms); the width takes the tail.
- A workload whose stalls come from slow queries pays for a try now and then: usually two at start-up, then one per 1024 epochs. Fast and slow queries on shared connections can be bistable (slow queries starved, or fast ones stuck behind them), and a try can tip such a workload from one mode to the other for a while.
- With `pipeline: n` the width stays at `max`.

**Measured.** 4-vCPU VM, client on 2 CPUs and PostgreSQL on the other 2, the benchmark suite's point lookups, median of 3 interleaved runs per cell, main → this change:

| Runtime | Pool × callers | ops/s       | p99                | p99.9          |
| ------- | -------------- | ----------- | ------------------ | -------------- |
| Node    | 5 × 100        | 240k → 243k | 8.2 → **1.6 ms**   | 12.2 → 5.5 ms  |
| Node    | 10 × 100       | 232k → 240k | 10.6 → **1.6 ms**  | 20.4 → 6.0 ms  |
| Node    | 10 × 500       | 246k → 250k | 20.4 → **5.8 ms**  | 28.4 → 11.0 ms |
| Node    | 10 × 1000      | 248k → 250k | 20.9 → **9.2 ms**  | 28.9 → 14.2 ms |
| Node    | 50 × 500       | 234k → 237k | 56.3 → **7.9 ms**  | 112 → 25 ms    |
| Node    | 50 × 1000      | 226k → 237k | 89.1 → **11.3 ms** | 118 → 62 ms    |
| Bun     | 10 × 100       | 237k → 239k | 12.1 → **1.2 ms**  | 17.5 → 5.4 ms  |
| Bun     | 10 × 500       | 248k → 251k | 22.7 → **4.3 ms**  | 32.4 → 7.8 ms  |
| Bun     | 50 × 500       | 228k → 249k | 80.7 → **4.5 ms**  | 118 → 7.5 ms   |

- Over all 96 cells (pools 1/5/10/50 × 1–1000 callers, 0 and 5 ms RTT, Node and Bun), the median throughput change was +0.2%. At 5 ms RTT, every cell was within ±2% except one pool-1 cell, and pools of 1 never narrow.
- The worst cell was Bun pool 5 × 1000 at −5% (p99 14.9 → 7.6 ms). Cells at 1–10 callers moved ±7% between sweeps in both directions; a 9-run recheck put them within ±1%.
- 50 concurrent inserts on pool 10: Node 166k → 179k/s, p99 4.7 → 2.4 ms; Bun 174k → 187k/s, p99 5.0 → 1.2 ms.
- Mixed workload (10 connections; 100 lookup callers and 5 callers of 20 ms queries): 226–231k → 218–237k lookups/s, and the slow callers got 143–239 instead of 46–141 queries/s. With 5,000 lookup callers and 20 slow ones: 148–149k → 148–150k, the same p99.
- Builder queries (through `pool.query` since #37) are client-bound on this VM (Node ~62k/s, Bun ~103k/s); they stay level, and the width doesn't engage while the server has room.
- In about 1 run in 7 at pool 50 × 1000, the first narrowing is undone, and the pool stays wide for the rest of a 1-second run.

**Code.** [pool.ts](pool.ts) `Width`, `#claimShared`, `#pickShared`, `#fillShared`, `#serveShared`, `#done`.

### Pool policies: LIFO idle, jittered lifetime, safe release, fail fast

**What it is.**

- Idle connections are reused **most recently used first**, so surplus connections reach their idle timeout when load drops and the pool shrinks.
- `maxLifetime` (1 h) has up to 10% random **jitter**, so connections opened together don't all expire together.
- A connection released mid-transaction is **destroyed**, never handed to the next borrower.
- A failed connection attempt rejects **one** waiter, then tries again for the others.
- `maxWaiting` and `acquireTimeout` make an overloaded pool fail fast instead of queueing forever.

**Why.** Each prevents a classic pool failure: a pool that never shrinks; a thundering herd of reconnects every hour; a forgotten `commit` leaking into another request; one network blip failing every waiter; an unbounded queue under overload.

**Alternatives.** pg-pool destroys the connection on **any** SQL error (wasteful); postgres.js has no acquire timeout and an unbounded queue.

**Code.** [pool.ts](pool.ts).

## Connecting

### libpq-compatible configuration

**What it is.** Connection strings, `PG*` environment variables, `.pgpass` and their precedence follow libpq, PostgreSQL's own C client ([auth/README.md](auth/README.md)). Unknown connection-string keywords become startup parameters (`search_path=app`).

**Why.** Connection settings that work with `psql` and every other Postgres tool work here, unchanged; deployment platforms already set these variables.

**Alternatives.** A driver-specific options format only (most JavaScript drivers accept a subset of libpq's keywords, and interpret some differently).

**Cost.** libpq's rules have to be matched exactly (the `ENV_KEYWORDS` table, `.pgpass` matching and escaping), including where quarry deliberately differs (`verify-full` by default, [below](#verify-full-by-default-and-strict-tls-and-scram-checks)).

**Code.** [config.ts](config.ts) `resolveConfig`, `findPgpassPassword`.

### Password functions, called for every new connection

**What it is.** `password` can be a function (sync or async), called each time the server asks a new connection for a password ([auth/README.md](auth/README.md#passwords-strings-functions-pgpass-iam-tokens)).

**Why.** Cloud databases (AWS RDS IAM, Google Cloud SQL, Azure Entra ID) accept short-lived tokens as passwords; a pool that read the password once would fail after the token expired. Calling it per connection means rotating credentials work without restarting the pool.

**Cost.** The function's latency is added to each connect; caching a still-valid token is the caller's job.

**Code.** [connection.ts](connection.ts) `#password`.

### Lazy `node:tls`, `getBuiltinModule`, and preloading

**What it is.** Plain connections never load `node:tls` (which pulls in the whole crypto stack, ~3 ms); `node:net` and `node:tls` load through `process.getBuiltinModule` (synchronous, much cheaper than `import()`); `createPool` preloads the modules it will need from an unref'd background timer; and during SSLRequest negotiation, `node:tls` loads while the TCP handshake is in flight ([#17](https://github.com/shlokdesai33/quarry/pull/17)).

**Why.** Connect time and cold start matter for serverless functions and for pools warming up.

**Alternatives.** Import everything at module load (pg: 17 ms import, so a faster first query after import, but a slower process start overall).

**Measured.** Node: connect + `select 1` + close, trust auth, 3.35 → 1.81 ms (pg 3.29); process start → first result 58.92 → 56.16 ms (pg 65.59).

**Code.** [node-socket.ts](node-socket.ts) `builtin`, `preloadNodeSockets`; [connect.ts](connect.ts).

### SCRAM with `node:crypto`, and a derived-key cache

**What it is.** SCRAM's HMACs and hashes use `node:crypto` synchronously where the runtime has it (PBKDF2 still runs off the main thread), with WebCrypto as the fallback; the derived keys are cached per (password, salt, iterations) in a 16-entry LRU; and the crypto module loads right after the startup message is sent, while the server starts its backend ([auth/README.md](auth/README.md#scram-sha-256)).

**Why.** SCRAM makes about 10 hash calls per connect; each WebCrypto call is a round trip through Node's thread pool. PBKDF2 (thousands of iterations, slow on purpose) would otherwise run on every connect, though the salt only changes with the password.

**Alternatives.** WebCrypto only (before #17); `pbkdf2Sync` (postgres.js: blocks the event loop).

**Cost.** The cache holds derived keys in memory; they grant nothing beyond the password already in the configuration.

**Measured.** Connect with SCRAM 4.41 → 2.06 ms (pg 4.31); client CPU per SCRAM connect 1.83 → 0.98 ms; TLS + SCRAM 6.37 → 4.76 ms (pg 6.05).

**Code.** [auth/scram.ts](auth/scram.ts) `scramCrypto`, `cachedKeys`.

### A TLS secure-context cache

**What it is.** The `tls.SecureContext` (parsed CA, certificate, key) is built once per distinct configuration and reused (16 entries); certificate files are read during the TCP connect.

**Why.** `tls.connect({ ca })` builds a context per connection, re-parsing the CA: ~0.15 ms per build, ~0.3 ms per connect on Node.

**Cost.** None visible; neutral on Bun.

**Code.** [node-socket.ts](node-socket.ts) `secureContext`; [connect.ts](connect.ts) `tlsOptions`.

### `close()` with libpq semantics

**What it is.** `close()` resolves once the Terminate message is flushed, like libpq's `PQfinish`, instead of waiting for the server to close the socket ([ARCHITECTURE.md](ARCHITECTURE.md#closing)).

**Why.** Waiting for the server's FIN means waiting for the backend process to exit: ~1.3 ms per connection, ~7 ms for `pool.end()` with 10 connections; pg doesn't wait.

**Cost.** A behaviour change: after `await close()`, the backend may still be exiting for a millisecond. Custom sockets whose `end()` returns nothing keep the old wait; `onClose` listeners still fire on the real close.

**Measured.** Pool warm-up tied pg in the benchmark loop only because backend teardown now overlaps the next iteration; quarry's own warm-up (pool to 10 results) is 8 ms against pg's 14 ms.

**Code.** [connection.ts](connection.ts) `#terminate`; [socket.ts](socket.ts) `end()`.

### `verify-full` by default, and strict TLS and SCRAM checks

**What it is.** Remote hosts default to `sslmode=verify-full` (encrypt, verify the certificate chain and host name); an SSLRequest answer followed by extra bytes is refused; SCRAM requires the server's final signature and checks the nonce; channel binding is used when TLS allows; `requireAuth` can refuse weak methods ([auth/README.md](auth/README.md)).

**Why.** libpq's default `prefer` silently falls back to plain text and verifies nothing. Extra bytes after the one-byte SSLRequest answer can only come from someone in the middle hoping they'll be read as if they came over TLS. A server that skips SCRAM's final step proves nothing about itself.

**Alternatives.** postgres.js defaults to no TLS and treats `prefer`/`require` as "TLS, no verification", and skips nonce and final-proof checks; pg treats every TLS mode as verify-full and sends cancel requests in plain text.

**Cost.** Local development against a remote server with a self-signed certificate needs `ssl: 'require'` or a CA.

**Code.** [config.ts](config.ts) `resolveConfig`; [connect.ts](connect.ts) `requestSsl`; [auth/scram.ts](auth/scram.ts).

### Ask for protocol 3.2, accept 3.0, retry once

**What it is.** The startup message asks for protocol 3.2 (PostgreSQL 18's, with cancel keys up to 256 bytes); a server or pooler that negotiates down to 3.0 is accepted; one that rejects 3.2 with an error gets one reconnect asking for 3.0 ([auth/README.md](auth/README.md#protocol-version-negotiation)).

**Why.** Long cancel keys make guessing a key to cancel someone else's query infeasible, and asking costs nothing; but some poolers don't negotiate correctly.

**Cost.** One extra connection attempt against those poolers.

**Code.** [connect.ts](connect.ts) `rejectsProtocol32`; [connection.ts](connection.ts) `#negotiated`.

## Transactions and batches

### BEGIN shares the first statement's Sync

**What it is.** `begin` (and the `set_config` for transaction settings) isn't sent on its own: it waits for the callback's first statement and goes out **with** it, under one Sync, in one write ([TRANSACTIONS.md](TRANSACTIONS.md#begin-shares-the-first-statements-sync)).

**Why.** A naive transaction costs one round trip more than its statements. Under one Sync, a failed BEGIN makes the server skip the first statement, so it can never run outside the transaction, which is what could happen with separate Syncs.

**Alternatives.** BEGIN as its own round trip (every other driver). Pipeline BEGIN with its own Sync (saves the round trip, but a failed BEGIN lets the next statement run in autocommit).

**Cost.** The callback starts before BEGIN is acknowledged (it has to, to produce the statement that shares the Sync); side effects before its first statement still happen if BEGIN fails. A first statement that needs its own Sync (with a `signal` or `timeout`, or a cursor) gets BEGIN separately. BEGIN and `set_config` are sent unprepared (they run once per transaction and can't go stale).

**Measured.** Round trips: begin; statement; commit 3 → 2; an empty transaction 2 → 1. `begin; select 1; commit` on a direct connection 13,447 → 17,407/s (+29%); at 5 ms RTT 56.5 → 84.6/s (+50%); at 20 ms a short transaction takes 41.7 ms against 62.6–62.9 ms for every other client ([#18](https://github.com/shlokdesai33/quarry/pull/18)).

**Code.** [transaction.ts](transaction.ts) `Session.#begin`; [ops.ts](ops.ts) `SyncGroupOp`.

### Deferred savepoint RELEASE

**What it is.** When a savepoint's callback succeeds, `release savepoint` is sent without waiting for its answer; the next statement of the transaction (or COMMIT) reports its error if it failed. On error, `rollback to` and `release` are sent together.

**Why.** Each savepoint cost a round trip just to be released.

**Cost.** A failing release surfaces at the next statement, as its own error (`3B001`), rather than where the savepoint ended. If the callback swallowed a database error, the release is awaited as before.

**Measured.** 5 savepoints with `select 1` each: 17 → 11 round trips (12 from this alone; BEGIN sharing takes one more); direct 2,441 → 3,316/s; at 5 ms RTT 10.0 → 15.6/s (postgres.js 14.1) ([#18](https://github.com/shlokdesai33/quarry/pull/18)).

**Code.** [transaction.ts](transaction.ts) `Session.sendDeferred`, `Transaction.transaction`.

### Detect a COMMIT that rolled back

**What it is.** If a statement failed inside the transaction and the code carried on, Postgres answers `commit` with the tag `ROLLBACK`, not an error. `Transaction.run` checks the tag and throws `TransactionRolledBack`.

**Why.** Most drivers report that as success, so code believes it committed.

**Code.** [transaction.ts](transaction.ts).

### `afterCommit` callbacks that can't change the outcome

**What it is.** `tx.afterCommit(fn)` runs `fn` once the outermost transaction has committed, and drops it if the transaction (or the savepoint it was registered in) rolls back or is retried; `afterRollback(fn)` runs on rollback. A callback that throws is reported by rethrowing it in a microtask, not by rejecting the transaction call ([TRANSACTIONS.md](TRANSACTIONS.md#aftercommit-and-afterrollback)).

**Why.** Side effects such as publishing an event should happen only for the attempt that committed: inside the callback, a retried attempt would publish twice, and a rolled-back one would publish something that never happened. Once COMMIT succeeded, the outcome is decided, so a failing callback must not make the caller think the transaction failed.

**Alternatives.** Run side effects after `await db.transaction(…)` returns (works, but can't be registered from deep inside the code that does the writes).

**Cost.** Callback errors surface as uncaught exceptions rather than through the transaction's promise.

**Code.** [transaction.ts](transaction.ts) `runCallbacks`.

### `db.batch` framing: one write, with COMMIT pipelined unless results are checked

**What it is.** A batch sends all its queries in one write on one connection. Outside a transaction, each has its own Sync (independent). With `transaction: true`, BEGIN, settings and queries share one Sync and COMMIT follows with its own, all in one write; if any result is checked on the client (an `expect…` shape), COMMIT waits for the check, a second round trip ([TRANSACTIONS.md](TRANSACTIONS.md#batches-in-one-round-trip), [../EXECUTION.md](../EXECUTION.md#batches)).

**Why.** "Run these together" and "run these atomically" are different requests; both can be one round trip when nothing has to be checked between the statements and COMMIT. A failed statement under the shared Sync skips the rest, so COMMIT reports ROLLBACK, still in one round trip.

**Alternatives.** `Promise.all` over a pool (spreads over several connections; several round trips for a transaction). Sequential awaits.

**Cost.** Without a check, COMMIT is sent before any result is read, so a value that fails to **decode** fails the batch after its transaction committed (decoding happens on the client, after the server's decision).

**Measured** ([#23](https://github.com/shlokdesai33/quarry/pull/23)):

| RTT  | Workload                                         | Sequential awaits | `Promise.all`   | `db.batch`     |
| ---- | ------------------------------------------------ | ----------------- | --------------- | -------------- |
| 0 ms | 5 point reads                                    | 0.209 ms          | 0.105 ms        | 0.081 ms       |
| 5 ms | 5 point reads                                    | 28.6 ms           | 5.96 ms         | 5.72 ms        |
| 5 ms | a transfer in a transaction (2 updates + insert) | 22.8 ms (4 RTs)   | 17.2 ms (3 RTs) | 5.86 ms (1 RT) |

**Code.** [transaction.ts](transaction.ts) `Transaction.batch`; [../driver-executor.ts](../driver-executor.ts) `batch`.

### Retries opt-in, re-running the whole callback

**What it is.** `retries: n` re-runs the whole transaction callback on serialization failures and deadlocks, with jittered exponential backoff; the default is no retry.

**Why.** Retrying is only correct when the callback can be repeated; replaying part of a transaction is never right. Jitter keeps two conflicting transactions from colliding again.

**Code.** [transaction.ts](transaction.ts) `Transaction.run`, `defaultDelay`.

### Settings with `set_config(…, true)`

**What it is.** Transaction settings, `setLocal`, per-query statement timeouts and the transaction timeout all use `select set_config(name, $value, true)`: bound parameters, transaction-local.

**Why.** Values are never interpolated into SQL, and a transaction-local setting can't leak into another client's session behind a pooler, where `SET` would persist on a server connection someone else gets next.

**Code.** [transaction.ts](transaction.ts) `settingsQuery`; [connection.ts](connection.ts) `#queryWithTimeout`.

## Cursors and streams

### Exclusive ops for anything that keeps talking

**What it is.** A cursor outside a transaction and both COPY directions are **exclusive** ops: nothing else is written on their connection until they finish ([STREAMING.md](STREAMING.md#how-it-works-on-the-wire)).

**Why.** Outside a transaction a cursor uses the **unnamed portal** inside the implicit transaction of one Sync: another query's Bind would replace the portal, and its Sync would end the implicit transaction and destroy it. A connection has one COPY state, and the server reads COPY data until CopyDone. Interleaving would corrupt either.

**Alternatives.** Let queries pipeline behind COPY (postgres.js does; they then fail or wait). Inside a transaction, cursors use a named portal and aren't exclusive between batches ([below](#cursors-inside-a-transaction-use-a-named-portal)).

**Cost.** Over a pool, each open stream or COPY holds a connection; behind PgBouncer in transaction mode, each holds a server connection until its final Sync.

**Code.** [ops.ts](ops.ts) `CursorOp`, `CopyFromOp`, `CopyToOp` (`exclusive`).

### Streams: strict pull

**What it is.** A cursor fetches a batch only when the consumer asks for the next one; nothing is read ahead ([STREAMING.md](STREAMING.md#strict-pull)).

**Why.** "Bounded memory however large the result" is the point of streaming; with read-ahead, a slow consumer holds two batches and the server does work the consumer may never take (a `break` after the first batch).

**Alternatives.** Read one batch ahead (what the cursor did before #34; pg-query-stream reads ahead too). An opt-in `prefetch` for high-latency links is an open question.

**Cost.** The consumer waits one round trip per batch; over a WAN with tiny batches, that dominates. A larger `batchSize` trades memory for round trips.

**Measured.** 5M rows (`int4, text, timestamptz`), batch 1000: 2,494 → 1,480 ms (2.0M → 3.4M rows/s), peak heap growth 55 → 27 MB, RSS growth 107 → 50 MB (this includes the next two entries; [#34](https://github.com/shlokdesai33/quarry/pull/34)). Batch 100: 3.0 s and 13 MB; 10,000: 1.5 s and 102 MB.

**Code.** [ops.ts](ops.ts) `CursorOp.#pump`.

### Cursors: describe first for binary from the first run

**What it is.** A cursor whose statement's columns aren't cached sends Describe + Flush **before** Bind, then binds every column in its codec's format ([STREAMING.md](STREAMING.md#binary-from-the-first-run)).

**Why.** For ordinary queries, describing first is rejected because the extra round trip costs more than text decoding on small results ([binary only after describe](#binary-only-after-describe)). A stream is a large result by nature, and the extra round trip is paid once per statement and connection, so binary from the first run pays for itself. Before #34, a stream's first run, and every unnamed or unprepared stream, decoded in text.

**Alternatives.** Text on the first run (the old behaviour); guessing formats from the builder's types (rejected for schema-drift safety).

**Cost.** One extra round trip the first time a statement is streamed on a connection.

**Code.** [ops.ts](ops.ts) `CursorOp.#describe`, `#described`.

### Cursors inside a transaction use a named portal

**What it is.** Inside a transaction, a cursor opens a **named** portal (`quarry_N`), reads each batch with Execute + Sync (`FetchOp`), and closes it at the end (`ClosePortalOp`); it isn't exclusive between batches ([STREAMING.md](STREAMING.md#how-it-works-on-the-wire)).

**Why.** Outside a transaction, the unnamed portal lives in the implicit transaction of one Sync, so the connection is the cursor's until it ends. Inside a transaction that exclusivity **deadlocked** a common loop: `for await (const job of tx.stream()) await tx.update(…)`, where the update waited for the cursor and the cursor waited for the loop. A named portal survives Sync inside a transaction, so other queries can run between batches, and several cursors can be read in step.

**Alternatives.** `DECLARE … CURSOR` in SQL (an extra statement per cursor); refuse queries inside the loop (surprising).

**Cost.** An extra Sync per batch inside a transaction.

**Code.** [cursor.ts](cursor.ts) `#openHeld`; [ops.ts](ops.ts) `FetchOp`, `ClosePortalOp`.

### Aborting a suspended cursor closes it instead of cancelling

**What it is.** A `signal` or timeout that fires between batches closes the portal (Close + Sync) and rejects the next pull with `AbortError`; one that fires while a batch runs sends a cancel request ([CANCELLATION.md](CANCELLATION.md#cursors)).

**Why.** Between batches the server is idle, waiting for the next Execute, so a cancel request does nothing: before #34 aborting a stream between batches had no effect.

**Code.** [ops.ts](ops.ts) `CursorOp.interrupt`; [cursor.ts](cursor.ts) `#interrupt`.

### `RowStream`: a hand-written iterator instead of an async generator

**What it is.** `stream()` returns a `RowStream` that hands out rows of the current batch with already-resolved promises and only awaits when it needs the next batch ([row-stream.ts](row-stream.ts)).

**Why.** An async generator with `yield*` per row adds several promise hops per row; per-row overhead dominates when rows are small.

**Measured.** About half the per-row overhead of the async generator ([#34](https://github.com/shlokdesai33/quarry/pull/34)).

**Cost.** Hand-written iterator protocol code (concurrent `next()`, `return()`, disposal) that a generator would give for free.

**Code.** [row-stream.ts](row-stream.ts).

### A statement timeout bounds the whole stream

**What it is.** `statementTimeout` on a cursor (or quarry's `stream({ timeout })`) runs the cursor in a transaction of its own: `begin`, `set_config('statement_timeout', $1, true)`, the cursor, `commit`, pipelined. It is refused inside a transaction.

**Why.** A suspended portal keeps `statement_timeout` running across Executes (verified on PG 18), so the timeout bounds the stream from its first batch to its last, the consumer's time included; transaction-local, so it can't leak. Before #34 the setup took two extra round trips, and inside a transaction it leaked into the rest of the transaction.

**Code.** [cursor.ts](cursor.ts) `#start`.

## COPY and LISTEN/NOTIFY

### COPY with backpressure both ways

**What it is.** `copyFrom` waits for the socket to drain every 64 KiB before reading more from its source; `copyTo` pauses the socket once more than 1 MiB is queued unread and resumes below half ([STREAMING.md](STREAMING.md#copy)).

**Why.** A fast source or a fast server can't fill memory faster than the other side takes it.

**Alternatives.** pg needs the separate `pg-copy-streams` package; postgres.js lets a query pipeline behind COPY FROM.

**Code.** [ops.ts](ops.ts) `CopyFromOp`, `CopyToOp`.

### A NOTIFY fast path and a channel-name cache

**What it is.** A NotificationResponse is decoded straight from the read buffer into the one object listeners receive, skipping the message object and the dispatch switch; the NUL scans run in JavaScript; the channel name comes from a per-connection cache of the last 8 channels' bytes (a byte compare instead of a decode, and the reused string keeps its hash for `Map` lookups); payloads of up to 6 ASCII bytes are built in JavaScript ([protocol/README.md](protocol/README.md#notifications)).

**Why.** Profiling showed string decoding (native `indexOf` and `Buffer.toString`) took about half the CPU of notification handling. For short strings, a native call costs more than a JavaScript loop: 11 ns against 20 ns for the NUL scan.

**Cost.** The cache copies the bytes it compares (a view would keep the read buffer alive); listener semantics are unchanged.

**Measured.** 20k notifications in one transaction: 1,659,948 → 2,351,961/s (+42%; pg 1,976,392, postgres.js 1,651,757); client CPU per notification 387 → 219 ns; decode alone 178 → 53 ns (pg-protocol 119) ([#14](https://github.com/shlokdesai33/quarry/pull/14)).

**Code.** [protocol/reader.ts](protocol/reader.ts) `decodeNotification`, `ChannelNames`; [connection.ts](connection.ts) `#onData`.

### `notify` with `pg_notify($1, $2)`

**What it is.** `notify(channel, payload)` runs `select pg_notify($1, $2)`, not `notify <channel>, '<payload>'` ([STREAMING.md](STREAMING.md#listen-and-notify)).

**Why.** The `NOTIFY` statement takes no parameters, so the channel and payload would have to be interpolated into SQL; with `pg_notify` both are bound parameters and can't inject SQL.

**Code.** [connection.ts](connection.ts) `notify`.

### A dedicated, self-healing LISTEN connection, re-subscribing in one round trip

**What it is.** `pool.listen` uses one dedicated connection outside `max`; if it drops, it reconnects with backoff (100 ms doubling to 5 s) and re-subscribes every channel with the `listen` statements pipelined in one round trip.

**Why.** `LISTEN` is session state; on a pooled connection it would be lost or delivered to the wrong borrower. Re-subscribing one channel per round trip made reconnects slow with many channels.

**Cost.** Notifications sent while the connection is down are lost (Postgres doesn't queue them).

**Code.** [pool.ts](pool.ts) `Listener`.

## Cancellation and timeouts

### Cancel only the query at the head, and hold back later writes

**What it is.** An aborted query that was already sent is canceled only once it's at the head of the queue (the one the server is running), and nothing more is written until it completes; the cancel request is repeated with backoff (50 ms doubling, up to 6 attempts) while the query still runs ([CANCELLATION.md](CANCELLATION.md#why-later-writes-are-held-back)).

**Why.** A cancel request interrupts whatever the backend is running **when it arrives**. With pipelining, sending it early cancels an earlier query; writing more after it lets it cancel a later one. And Postgres drops a cancel that arrives while it's still reading the query's messages, hence the repeats.

**Alternatives.** postgres.js and pg send the cancel immediately, so under pipelining the wrong query can be canceled (postgres.js was found to attribute a canceled query's error to the next query).

**Cost.** Pipelined queries behind a canceled one wait for it to finish.

**Code.** [connection.ts](connection.ts) `#abort`, `#cancelAtHead`.

### Drop unsent queries without contacting the server

**What it is.** A query aborted (or timed out) before it was written is removed from the queue and fails with `AbortError`; no cancel request is sent.

**Why.** It can't have done anything; this is the cheapest correct action and leaves the connection untouched.

**Code.** [connection.ts](connection.ts) `#abort`.

### Server-side statement timeouts, transaction-local and pipelined

**What it is.** A per-query `statementTimeout` is enforced by the server with `set_config('statement_timeout', $1, true)`: outside a transaction, `begin`, `set_config`, the query and `commit` are pipelined in one write ([CANCELLATION.md](CANCELLATION.md#statement-timeouts)).

**Why.** A client-side timer can only ask the server to stop; a server-side timeout stops the work even if the client is stuck or the network is down. Transaction-local, so it can't leak through poolers.

**Alternatives.** pg's `query_timeout` doesn't cancel on the server.

**Code.** [connection.ts](connection.ts) `#queryWithTimeout`.

### Every wait has a timeout

**What it is.** Connecting (`connectTimeout`, 30 s), waiting for a pool connection (`acquireTimeout`, 30 s), each query (`timeout`, `statementTimeout`), a transaction (`transaction_timeout`) and closing (`close({ timeout })`) all have bounds ([CANCELLATION.md](CANCELLATION.md#every-timeout-in-the-driver)). Only an explicit `acquireTimeout: 0` waits forever.

**Why.** A driver that can wait forever turns a database outage into a hung process with no error; with bounds, an outage becomes errors that callers can handle and alert on.

**Alternatives.** pg-pool's default `connectionTimeoutMillis` is 0 (wait forever); postgres.js has no acquire timeout.

**Code.** [connect.ts](connect.ts), [pool.ts](pool.ts), [connection.ts](connection.ts).

## Runtimes

### One small socket interface

**What it is.** The driver core only talks to `DriverSocket` (write, startTls, pause/resume, end/destroy, four events), with adapters for Node's `net`/`tls` (Node, Bun, Deno) and `cloudflare:sockets` (Workers) ([ARCHITECTURE.md](ARCHITECTURE.md#part-11-runtimes-and-sockets)).

**Why.** One code base runs everywhere, and a new runtime needs one small adapter. Tests and the walkthrough's byte captures use a fake socket through the same interface.

**Alternatives.** Text-transpiled per-runtime copies (postgres.js's `cf/` and `deno/`); Node compatibility layers only.

**Cost.** Bun runs on its JavaScript `node:net` (~5 ms to load cold); a native `Bun.connect` adapter is a possible follow-up.

**Code.** [socket.ts](socket.ts), [node-socket.ts](node-socket.ts), [cloudflare-socket.ts](cloudflare-socket.ts).

### Counting bytes for backpressure on Workers

**What it is.** The Workers adapter counts the bytes whose writes haven't completed and reports a full buffer at 64 KiB.

**Why.** workerd's socket `WritableStream` always reports `desiredSize === 1`, however much is queued (a probe queued 4 MiB without the value changing), so `write` never returned false and backpressure never engaged on Workers.

**Code.** [cloudflare-socket.ts](cloudflare-socket.ts) `HIGH_WATER_MARK`.

## Errors and safety

### Errors carry everything and leak nothing

**What it is.** A `PostgresError` keeps every field the server sent, plus the failing query as a **non-enumerable** property; a `DecodeError` names the column and type, never the value; `UndefinedParameterError` shows the SQL but no parameter values; connection-string errors never echo values.

**Why.** Errors end up in logs and error trackers. Parameters and decoded values are often personal data or secrets; non-enumerable properties are skipped by `JSON.stringify` and most loggers, while staying available to code that reads them.

**Code.** [errors.ts](errors.ts).

### Typed error classes per SQLSTATE

**What it is.** Common SQLSTATEs have their own subclasses (`UniqueViolation`, `SerializationFailure`, `QueryCanceled` with a `reason`, …), `isRetryable` and `isFatal`, and `IntegrityConstraintViolation.columns` parsed from the error.

**Why.** `catch (e) { if (e instanceof UniqueViolation) … }` is clearer and safer than comparing code strings everywhere.

**Code.** [errors.ts](errors.ts) `postgresError`.

### A decode failure fails one query, not the connection

**What it is.** A codec that throws while decoding fails only that query with `DecodeError`; the rest of its rows are skipped and the connection stays usable. A malformed message, by contrast, is a `ProtocolError` that closes the connection.

**Why.** A decode failure means the bytes were valid but the value surprised a codec; the protocol is intact. A framing error means nothing after it can be trusted.

**Code.** [ops.ts](ops.ts), [rows.ts](rows.ts).
