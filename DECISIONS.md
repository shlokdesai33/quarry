# Decisions index

quarry's design decisions and optimisations, in one list. Each link goes to a full entry that explains, for someone new to the subject, **what** the decision is, **why** it was made, the **alternatives** and why they lost, what it **costs**, the **measured** impact where there are numbers, and where the **code** is.

- [src/DECISIONS.md](src/DECISIONS.md): the query builder (API shape, result shapes, compiling, codecs and types, bulk writes, joins, pagination, execution, type-level tricks, `verify` and the CLI).
- [src/driver/DECISIONS.md](src/driver/DECISIONS.md): the PostgreSQL driver (pipelining, socket writes, prepared statements and PgBouncer, binary formats, decoding, memory, the pool, connecting, transactions, cursors and streams, COPY and LISTEN/NOTIFY, cancellation, runtimes, errors). It also explains [how to read the numbers](src/driver/DECISIONS.md#how-to-read-the-numbers).

Each area guide ends with a short **Decisions** section linking to the entries for that area. The guides themselves explain **how** things work; start with [ARCHITECTURE.md](ARCHITECTURE.md).

## Headline decisions

The ones that shape everything else, with their biggest measured effect:

| Decision                                                                                                                 | In one line                                                            | Measured                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Our own wire-protocol driver](src/driver/DECISIONS.md#our-own-wire-protocol-implementation-with-no-dependencies)        | the speed-ups below need control of every byte                         | point lookups on 10 connections: 301k/s against postgres.js 130k and pg 61k                 |
| [Pipelining, one Sync per query](src/driver/DECISIONS.md#pipelining-with-one-sync-per-query)                             | send without waiting; a failing query doesn't fail its neighbours      | N round trips become about one                                                              |
| [Coalesced writes](src/driver/DECISIONS.md#coalesced-writes-one-write-per-microtask)                                     | every query issued in one tick goes out in one `write`                 | 5.1 queries per write; 4.5 µs client CPU per query (pg 17.1)                                |
| [Adaptive pipeline depth](src/driver/DECISIONS.md#adaptive-pipeline-depth-from-100-to-1000)                              | how many queries to stack on a connection, tuned from observed latency | 1 connection at 5 ms RTT: 7,757 → 126,551/s; a fixed 1000 starved slow queries (381 → 45/s) |
| [Unnamed statements behind PgBouncer](src/driver/DECISIONS.md#unnamed-statements-for-pipelined-queries-behind-pgbouncer) | don't make PgBouncer rewrite every named Parse                         | PgBouncer was the bottleneck: inserts +23%, point lookups +11%                              |
| [Binary only after describe](src/driver/DECISIONS.md#binary-only-after-describe)                                         | never guess column types: safe against schema drift                    | first-run binary was 2× faster at 10k rows, and dropped for safety                          |
| [Generated row decoders](src/driver/DECISIONS.md#generated-monomorphic-row-decoders)                                     | one compiled function per statement's columns                          | 6 columns: 1,068 → 323–394 ns per row                                                       |
| [Allocation cuts](src/driver/DECISIONS.md#allocation-cuts-for-the-small-query-tail)                                      | ~4× less garbage per small query                                       | `select 1` p99.9 368 → 264 µs on Node, 258 → 62 µs on Bun                                   |
| [Streams: strict pull](src/driver/DECISIONS.md#streams-strict-pull)                                                      | fetch a batch only when the consumer asks                              | 5M rows 2,494 → 1,480 ms, peak heap 55 → 27 MB (with binary first run)                      |
| [Types follow PostgreSQL](src/DECISIONS.md#types-follow-postgresql-not-javascript)                                       | "it type-checks" means "Postgres accepts it"                           |                                                                                             |
| [No implicit LIMIT in result shapes](src/DECISIONS.md#no-implicit-limit-in-result-shapes)                                | the SQL you see is what runs, whatever the shape                       |                                                                                             |
| [Lazy shapes and `db.batch`](src/DECISIONS.md#lazy-result-shapes-and-execute-as-the-one-way-to-run)                      | queries are values, so many can go in one round trip                   | a transfer at 5 ms RTT: 22.8 → 5.86 ms                                                      |
| [Bulk writes through `unnest`](src/DECISIONS.md#many-rows-through-unnest-one-array-per-column)                           | one array per column: constant SQL, no parameter limit                 | 1k-row insert 514 → 674 queries/s with binary arrays                                        |
| [`setEach`](src/DECISIONS.md#seteach-one-method-for-the-source-the-assignments-and-the-key-match)                        | bulk update with the key match generated, so it can't be forgotten     | 1,000 rows × 8 columns 7.00 → 4.96 ms                                                       |
| [Keyset pagination with exact keys](src/DECISIONS.md#exact-text-keyset-keys)                                             | seek from the last key, sent back as the server's exact text           | a `Date` key lost microseconds and looped forever                                           |
| [Type-checking speed as a constraint](src/DECISIONS.md#speed-is-a-design-constraint-measured)                            | types written for the compiler's speed, measured                       | #32: per-query cost 131k → 133k instantiations                                              |

## Everything, by area

Entries marked "(measured)" have numbers.

## Query builder

Full entries: [src/DECISIONS.md](src/DECISIONS.md).

### The shape of the API

- [Table objects at run time, references as strings](src/DECISIONS.md#table-objects-at-run-time-references-as-strings)
- [Types follow PostgreSQL, not JavaScript](src/DECISIONS.md#types-follow-postgresql-not-javascript)
- [Comparisons are methods, typed per SQL kind](src/DECISIONS.md#comparisons-are-methods-typed-per-sql-kind)
- [Immutable builders](src/DECISIONS.md#immutable-builders)
- [What a builder still needs, in its type: `M` and `this` gating](src/DECISIONS.md#what-a-builder-still-needs-in-its-type-m-and-this-gating)
- [The locking clause as a state machine: `L`](src/DECISIONS.md#the-locking-clause-as-a-state-machine-l) (measured)
- [No `orWhere`: precedence is always explicit](src/DECISIONS.md#no-orwhere-precedence-is-always-explicit)
- [`set` merges, `values` replaces](src/DECISIONS.md#set-merges-values-replaces)

### Running queries

- [Lazy result shapes, and `execute()` as the one way to run](src/DECISIONS.md#lazy-result-shapes-and-execute-as-the-one-way-to-run) (measured)
- [Awaiting a builder rejects](src/DECISIONS.md#awaiting-a-builder-rejects)
- [Throwing is in the name: the `take…` and `expect…` split](src/DECISIONS.md#throwing-is-in-the-name-the-take-and-expect-split)
- [No implicit LIMIT in result shapes](src/DECISIONS.md#no-implicit-limit-in-result-shapes)
- [`keepRows` instead of `limit`](src/DECISIONS.md#keeprows-instead-of-limit)
- [A write's `execute()` with `returning` resolves to the rows](src/DECISIONS.md#a-writes-execute-with-returning-resolves-to-the-rows)
- [`db.batch`: two modes with names](src/DECISIONS.md#dbbatch-two-modes-with-names)
- [`stream()`: only for every-row reads, and it runs immediately](src/DECISIONS.md#stream-only-for-every-row-reads-and-it-runs-immediately)

### Compiling to SQL

- [A node tree, and one compiler](src/DECISIONS.md#a-node-tree-and-one-compiler)
- [References resolved before compiling](src/DECISIONS.md#references-resolved-before-compiling)
- [Every identifier quoted](src/DECISIONS.md#every-identifier-quoted)
- [Parameters everywhere, literals only where Postgres refuses a parameter](src/DECISIONS.md#parameters-everywhere-literals-only-where-postgres-refuses-a-parameter)
- [Parameters numbered in text order, and `in` as `= any($1)`](src/DECISIONS.md#parameters-numbered-in-text-order-and-in-as--any1)
- [Every operation operand bracketed](src/DECISIONS.md#every-operation-operand-bracketed)
- [Codecs as getters on the compiled query](src/DECISIONS.md#codecs-as-getters-on-the-compiled-query)

### Values, codecs and types

- [The driver owns the codecs; the builder only chooses them](src/DECISIONS.md#the-driver-owns-the-codecs-the-builder-only-chooses-them) (measured)
- [TypeScript types derived from codecs](src/DECISIONS.md#typescript-types-derived-from-codecs)
- [`undefined` is refused; optional filters use `when()`](src/DECISIONS.md#undefined-is-refused-optional-filters-use-when)
- [`eb.val` declares a type from its JavaScript type](src/DECISIONS.md#ebval-declares-a-type-from-its-javascript-type)
- [`= any($1)` gets a declared type only for integer and boolean columns](src/DECISIONS.md#-any1-gets-a-declared-type-only-for-integer-and-boolean-columns) (measured)
- [Arithmetic follows Postgres's result types](src/DECISIONS.md#arithmetic-follows-postgress-result-types)
- [`case`: the first result fixes the SQL type](src/DECISIONS.md#case-the-first-result-fixes-the-sql-type)
- [The type catalog loaded before the first query](src/DECISIONS.md#the-type-catalog-loaded-before-the-first-query)
- [Raw SQL only through the `sql` template tag](src/DECISIONS.md#raw-sql-only-through-the-sql-template-tag)

### Bulk writes

- [Many rows through `unnest`, one array per column](src/DECISIONS.md#many-rows-through-unnest-one-array-per-column) (measured)
- [`unnest` casts without type modifiers](src/DECISIONS.md#unnest-casts-without-type-modifiers)
- [`setEach`: one method for the source, the assignments and the key match](src/DECISIONS.md#seteach-one-method-for-the-source-the-assignments-and-the-key-match) (measured)
- [Rows that set different columns: flag columns and `case`](src/DECISIONS.md#rows-that-set-different-columns-flag-columns-and-case)
- [`setEach` rows are typed by the table, and duplicate keys are refused](src/DECISIONS.md#seteach-rows-are-typed-by-the-table-and-duplicate-keys-are-refused)

### Joins and selections

- [Outer joins make the joined side nullable: `NullableTable`](src/DECISIONS.md#outer-joins-make-the-joined-side-nullable-nullabletable)
- [A table joined twice, or a key selected twice, is refused](src/DECISIONS.md#a-table-joined-twice-or-a-key-selected-twice-is-refused)
- [`selectAll()` lists the columns, never `*`](src/DECISIONS.md#selectall-lists-the-columns-never-)
- [Ordering by a selected key uses the bare key](src/DECISIONS.md#ordering-by-a-selected-key-uses-the-bare-key)

### Pagination

- [Keyset seek with a row comparison](src/DECISIONS.md#keyset-seek-with-a-row-comparison)
- [Exact text keyset keys](src/DECISIONS.md#exact-text-keyset-keys)
- [`limit + 1` for `hasMore`, no count by default](src/DECISIONS.md#limit--1-for-hasmore-no-count-by-default)
- [Pagination owns order, limit and offset](src/DECISIONS.md#pagination-owns-order-limit-and-offset)
- [Key rules in the types: non-null and selected under its own name](src/DECISIONS.md#key-rules-in-the-types-non-null-and-selected-under-its-own-name)
- [Unsigned base64url JSON cursors](src/DECISIONS.md#unsigned-base64url-json-cursors)
- [`iterateChunks` alongside `stream()`](src/DECISIONS.md#iteratechunks-alongside-stream)

### Execution and errors

- [One small `Executor` interface between the builder and the driver](src/DECISIONS.md#one-small-executor-interface-between-the-builder-and-the-driver)
- [Plain queries share the pool's pipelined connections](src/DECISIONS.md#plain-queries-share-the-pools-pipelined-connections)
- [Errors carry the query (hidden) and your call site](src/DECISIONS.md#errors-carry-the-query-hidden-and-your-call-site)
- [Nested `durable` transactions throw](src/DECISIONS.md#nested-durable-transactions-throw)

### Type-level tricks

- [Phantom types: what a column reads and writes](src/DECISIONS.md#phantom-types-what-a-column-reads-and-writes)
- [A class per column modifier state](src/DECISIONS.md#a-class-per-column-modifier-state)
- [Errors as an impossible extra argument](src/DECISIONS.md#errors-as-an-impossible-extra-argument)
- [`takeValue` needs a one-column row](src/DECISIONS.md#takevalue-needs-a-one-column-row)

### Type-checking speed

- [Speed is a design constraint, measured](src/DECISIONS.md#speed-is-a-design-constraint-measured) (measured)

### Schema, verify and the CLI

- [Declarations, not migrations](src/DECISIONS.md#declarations-not-migrations)
- [`verify` instead of trusting that code and database agree](src/DECISIONS.md#verify-instead-of-trusting-that-code-and-database-agree) (measured)
- [Call sites captured eagerly, formatted lazily](src/DECISIONS.md#call-sites-captured-eagerly-formatted-lazily)
- [The CLI: config as code, re-launched for TypeScript, distinct exit codes](src/DECISIONS.md#the-cli-config-as-code-re-launched-for-typescript-distinct-exit-codes)

## Driver

Full entries: [src/driver/DECISIONS.md](src/driver/DECISIONS.md).

### Architecture

- [Our own wire-protocol implementation, with no dependencies](src/driver/DECISIONS.md#our-own-wire-protocol-implementation-with-no-dependencies) (measured)
- [Requests as operations in one FIFO queue](src/driver/DECISIONS.md#requests-as-operations-in-one-fifo-queue)
- [The driver knows nothing about the query builder](src/driver/DECISIONS.md#the-driver-knows-nothing-about-the-query-builder)
- [PostgreSQL 18 or later only](src/driver/DECISIONS.md#postgresql-18-or-later-only)

### Writing to the socket

- [Coalesced writes: one write per microtask](src/driver/DECISIONS.md#coalesced-writes-one-write-per-microtask) (measured)
- [`TCP_NODELAY`](src/driver/DECISIONS.md#tcp_nodelay)
- [Backpressure: 64 KiB chunks, and queued ops stay unencoded](src/driver/DECISIONS.md#backpressure-64-kib-chunks-and-queued-ops-stay-unencoded) (measured)
- [Back-filled message lengths](src/driver/DECISIONS.md#back-filled-message-lengths)
- [Pipelining, with one Sync per query](src/driver/DECISIONS.md#pipelining-with-one-sync-per-query) (measured)

### Prepared statements and PgBouncer

- [Prepared statements by default, named per connection](src/driver/DECISIONS.md#prepared-statements-by-default-named-per-connection) (measured)
- [A bounded LRU cache with use stamps](src/driver/DECISIONS.md#a-bounded-lru-cache-with-use-stamps) (measured)
- [Retry a stale statement once, unprepared](src/driver/DECISIONS.md#retry-a-stale-statement-once-unprepared)
- [Unnamed statements for pipelined queries behind PgBouncer](src/driver/DECISIONS.md#unnamed-statements-for-pipelined-queries-behind-pgbouncer) (measured)
- [Detect poolers at login rather than configure them](src/driver/DECISIONS.md#detect-poolers-at-login-rather-than-configure-them)

### Codecs, types and formats

- [Codecs owned by the driver, chosen by the caller](src/driver/DECISIONS.md#codecs-owned-by-the-driver-chosen-by-the-caller) (measured)
- [Exact parameter OIDs, except for text-like types](src/driver/DECISIONS.md#exact-parameter-oids-except-for-text-like-types)
- [Binary only after describe](src/driver/DECISIONS.md#binary-only-after-describe)
- [Which types are binary and which stay text](src/driver/DECISIONS.md#which-types-are-binary-and-which-stay-text)
- [Binary array parameters, with a per-array fallback](src/driver/DECISIONS.md#binary-array-parameters-with-a-per-array-fallback) (measured)
- [Arrays of text read as one latin1 string](src/driver/DECISIONS.md#arrays-of-text-read-as-one-latin1-string) (measured)
- [Named types resolved once per pool through the catalog](src/driver/DECISIONS.md#named-types-resolved-once-per-pool-through-the-catalog)
- [`undefined` is refused, never sent as NULL](src/driver/DECISIONS.md#undefined-is-refused-never-sent-as-null)

### Reading and decoding

- [Zero-copy reads: messages decoded in place](src/driver/DECISIONS.md#zero-copy-reads-messages-decoded-in-place) (measured)
- [Strict bounds checks on every read](src/driver/DECISIONS.md#strict-bounds-checks-on-every-read)
- [DataRow fast path: no message objects for rows](src/driver/DECISIONS.md#datarow-fast-path-no-message-objects-for-rows)
- [Generated, monomorphic row decoders](src/driver/DECISIONS.md#generated-monomorphic-row-decoders) (measured)
- [Decode only the rows a caller keeps (`keepRows`)](src/driver/DECISIONS.md#decode-only-the-rows-a-caller-keeps-keeprows)
- [Shared constant messages and repeated-string caches](src/driver/DECISIONS.md#shared-constant-messages-and-repeated-string-caches)

### Memory and garbage collection

- [Allocation cuts for the small-query tail](src/driver/DECISIONS.md#allocation-cuts-for-the-small-query-tail) (measured)
- [One sweep timer for every idle connection](src/driver/DECISIONS.md#one-sweep-timer-for-every-idle-connection)
- [The writer: reserve one byte per character, hand off big buffers](src/driver/DECISIONS.md#the-writer-reserve-one-byte-per-character-hand-off-big-buffers) (measured)

### The pool

- [Pipelining onto busy connections, only once the pool is full](src/driver/DECISIONS.md#pipelining-onto-busy-connections-only-once-the-pool-is-full) (measured)
- [A FIFO of pipeline slots, with slot hand-off](src/driver/DECISIONS.md#a-fifo-of-pipeline-slots-with-slot-hand-off) (measured)
- [Draining a shared connection for exclusive callers](src/driver/DECISIONS.md#draining-a-shared-connection-for-exclusive-callers) (measured)
- [Adaptive pipeline depth, from 100 to 1000](src/driver/DECISIONS.md#adaptive-pipeline-depth-from-100-to-1000) (measured)
- [Adaptive width: no more pipelined backends than the server runs at once](src/driver/DECISIONS.md#adaptive-width-no-more-pipelined-backends-than-the-server-runs-at-once) (measured)
- [Pool policies: LIFO idle, jittered lifetime, safe release, fail fast](src/driver/DECISIONS.md#pool-policies-lifo-idle-jittered-lifetime-safe-release-fail-fast)

### Connecting

- [libpq-compatible configuration](src/driver/DECISIONS.md#libpq-compatible-configuration)
- [Password functions, called for every new connection](src/driver/DECISIONS.md#password-functions-called-for-every-new-connection)
- [Lazy `node:tls`, `getBuiltinModule`, and preloading](src/driver/DECISIONS.md#lazy-nodetls-getbuiltinmodule-and-preloading) (measured)
- [SCRAM with `node:crypto`, and a derived-key cache](src/driver/DECISIONS.md#scram-with-nodecrypto-and-a-derived-key-cache) (measured)
- [A TLS secure-context cache](src/driver/DECISIONS.md#a-tls-secure-context-cache)
- [`close()` with libpq semantics](src/driver/DECISIONS.md#close-with-libpq-semantics) (measured)
- [`verify-full` by default, and strict TLS and SCRAM checks](src/driver/DECISIONS.md#verify-full-by-default-and-strict-tls-and-scram-checks)
- [Ask for protocol 3.2, accept 3.0, retry once](src/driver/DECISIONS.md#ask-for-protocol-32-accept-30-retry-once)

### Transactions and batches

- [BEGIN shares the first statement's Sync](src/driver/DECISIONS.md#begin-shares-the-first-statements-sync) (measured)
- [Deferred savepoint RELEASE](src/driver/DECISIONS.md#deferred-savepoint-release) (measured)
- [Detect a COMMIT that rolled back](src/driver/DECISIONS.md#detect-a-commit-that-rolled-back)
- [`afterCommit` callbacks that can't change the outcome](src/driver/DECISIONS.md#aftercommit-callbacks-that-cant-change-the-outcome)
- [`db.batch` framing: one write, with COMMIT pipelined unless results are checked](src/driver/DECISIONS.md#dbbatch-framing-one-write-with-commit-pipelined-unless-results-are-checked)
- [Retries opt-in, re-running the whole callback](src/driver/DECISIONS.md#retries-opt-in-re-running-the-whole-callback)
- [Settings with `set_config(…, true)`](src/driver/DECISIONS.md#settings-with-set_config-true)

### Cursors and streams

- [Exclusive ops for anything that keeps talking](src/driver/DECISIONS.md#exclusive-ops-for-anything-that-keeps-talking)
- [Streams: strict pull](src/driver/DECISIONS.md#streams-strict-pull) (measured)
- [Cursors: describe first for binary from the first run](src/driver/DECISIONS.md#cursors-describe-first-for-binary-from-the-first-run)
- [Cursors inside a transaction use a named portal](src/driver/DECISIONS.md#cursors-inside-a-transaction-use-a-named-portal)
- [Aborting a suspended cursor closes it instead of cancelling](src/driver/DECISIONS.md#aborting-a-suspended-cursor-closes-it-instead-of-cancelling)
- [`RowStream`: a hand-written iterator instead of an async generator](src/driver/DECISIONS.md#rowstream-a-hand-written-iterator-instead-of-an-async-generator) (measured)
- [A statement timeout bounds the whole stream](src/driver/DECISIONS.md#a-statement-timeout-bounds-the-whole-stream)

### COPY and LISTEN/NOTIFY

- [COPY with backpressure both ways](src/driver/DECISIONS.md#copy-with-backpressure-both-ways)
- [A NOTIFY fast path and a channel-name cache](src/driver/DECISIONS.md#a-notify-fast-path-and-a-channel-name-cache) (measured)
- [`notify` with `pg_notify($1, $2)`](src/driver/DECISIONS.md#notify-with-pg_notify1-2)
- [A dedicated, self-healing LISTEN connection, re-subscribing in one round trip](src/driver/DECISIONS.md#a-dedicated-self-healing-listen-connection-re-subscribing-in-one-round-trip)

### Cancellation and timeouts

- [Cancel only the query at the head, and hold back later writes](src/driver/DECISIONS.md#cancel-only-the-query-at-the-head-and-hold-back-later-writes)
- [Drop unsent queries without contacting the server](src/driver/DECISIONS.md#drop-unsent-queries-without-contacting-the-server)
- [Server-side statement timeouts, transaction-local and pipelined](src/driver/DECISIONS.md#server-side-statement-timeouts-transaction-local-and-pipelined)
- [Every wait has a timeout](src/driver/DECISIONS.md#every-wait-has-a-timeout)

### Runtimes

- [One small socket interface](src/driver/DECISIONS.md#one-small-socket-interface)
- [Counting bytes for backpressure on Workers](src/driver/DECISIONS.md#counting-bytes-for-backpressure-on-workers)

### Errors and safety

- [Errors carry everything and leak nothing](src/driver/DECISIONS.md#errors-carry-everything-and-leak-nothing)
- [Typed error classes per SQLSTATE](src/driver/DECISIONS.md#typed-error-classes-per-sqlstate)
- [A decode failure fails one query, not the connection](src/driver/DECISIONS.md#a-decode-failure-fails-one-query-not-the-connection)
