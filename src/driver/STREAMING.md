# Cursors, streams, COPY and LISTEN/NOTIFY

Most queries return a result small enough to hold in memory at once. This guide covers the ways to move data that isn't: reading a large result in batches (**cursors** and **streams**), bulk loading and unloading (**COPY**), and receiving events pushed by the server (**LISTEN/NOTIFY**).

Code: `CursorOp`, `FetchOp`, `ClosePortalOp`, `CopyFromOp`, `CopyToOp` in [ops.ts](ops.ts); `CursorIterator` in [cursor.ts](cursor.ts); `RowStream` in [row-stream.ts](row-stream.ts); `cursor`, `stream`, `copyFrom`, `copyRows`, `copyTo`, `listen`, `notify` in [connection.ts](connection.ts); the pool's versions and its `Listener` in [pool.ts](pool.ts); COPY text helpers in [types.ts](types.ts).

## Contents

- [Cursors](#cursors)
- [Streams](#streams)
- [COPY](#copy)
- [LISTEN and NOTIFY](#listen-and-notify)
- [Decisions](#decisions)
- [Glossary](#glossary)

## Cursors

<a id="cursors"></a>

```ts
for await (const batch of conn.cursor(
	'select * from events where day = $1',
	[day],
	{ batchSize: 1000, signal },
)) {
	for (const row of batch) handle(row);
}
```

Code: `CursorOp`, `FetchOp`, `ClosePortalOp` in [ops.ts](ops.ts); `CursorIterator` in [cursor.ts](cursor.ts); `Connection.cursor` in [connection.ts](connection.ts). This was reworked in #34; what changed and why is in [DECISIONS.md](DECISIONS.md#streams-strict-pull).

### How it works on the wire

The extended protocol's **Execute** takes a maximum row count. With one, the server sends that many rows and then **PortalSuspended** instead of CommandComplete; the portal (the running query) stays open, and another Execute continues it. **Flush** (instead of Sync) asks the server to send what it has without ending the request.

A cursor has two modes, chosen when it opens, by the connection's transaction status.

**Outside a transaction** (status `I`): the unnamed portal lives in the **implicit transaction** of one Sync, so the cursor uses Execute + Flush per batch and a single Sync at the end:

```
C> [Parse] Describe(S) Flush                       ← only if the statement's columns aren't cached
S< [ParseComplete] ParameterDescription RowDescription
C> Bind(formats from the codecs) Execute(1000) Flush
S< BindComplete DataRow × 1000 PortalSuspended
                                                   ← nothing more until the consumer asks
C> Execute(1000) Flush
S< DataRow × 1000 PortalSuspended
C> Execute(1000) Flush
S< DataRow × 312 CommandComplete                   ← exhausted
C> Sync
S< ReadyForQuery
```

Until the final Sync, nothing else can be written on the connection: another Bind would replace the unnamed portal, and a Sync would end the implicit transaction and destroy it. So `CursorOp` is **exclusive** in this mode ([ARCHITECTURE.md](ARCHITECTURE.md#writing-the-flush)). Behind PgBouncer in transaction mode this needs no BEGIN: until the final Sync the server sends no ReadyForQuery, so PgBouncer keeps the server connection linked to the client (each open stream holds one server connection).

**Inside a transaction** (status `T`): a **named portal** (`quarry_1`, `quarry_2`, …, from `CursorHost.portal()`) survives Sync until the transaction ends, so each batch is a self-contained Execute + Sync:

```
C> Bind("quarry_1", …) Execute("quarry_1", 1000) Sync     ← CursorOp: the first batch
S< BindComplete DataRow × 1000 PortalSuspended ReadyForQuery(T)
C> (other queries of the transaction, if the loop runs any)
C> Execute("quarry_1", 1000) Sync                          ← FetchOp: each later batch
S< DataRow × 1000 PortalSuspended ReadyForQuery(T)
C> Close(P "quarry_1") Sync                                ← ClosePortalOp at the end
```

The cursor is exclusive only while it describes the statement; between batches the connection is free, so `for await (… tx.stream()) await tx.update(…)` works, and several cursors can be read in step. (Before #34 the cursor was always exclusive, and that loop **deadlocked**: the update waited for the cursor, which waited for the loop.)

### Strict pull

A batch is fetched **only when the consumer asks for it** (`#pump` sends the next Execute when a `next()` waits and no batch is unread). Before #34 the cursor sent the next Execute as soon as it handed a batch out, one batch ahead; strict pull means a slow loop holds exactly one batch in memory, and the server does no work the consumer won't take. The cost is that the consumer waits one round trip per batch.

### Binary from the first run

Unlike `query()`, whose columns are asked for in binary only once a cached statement has been described ([CODECS.md](CODECS.md#binary-after-describe)), a cursor **describes the statement first** when its columns aren't cached (Describe(S) + Flush, then Bind once the RowDescription arrives, in `#described`), so its Bind already asks for each column in its codec's format, binary where it can, even on the first run and even unprepared or unnamed (PgBouncer pipelining). That costs one extra round trip once per statement and connection, which a large streamed result amortises; a small query wouldn't (see [DECISIONS.md](DECISIONS.md#binary-only-after-describe)). An unnamed statement bound from cached columns adds a Describe of the portal, and if the columns changed (a schema change), the rows are decoded by what the server sent.

### The iterator: `CursorIterator`

[cursor.ts](cursor.ts) is what `conn.cursor()` returns per iteration:

- **Opens on the first `next()`**, synchronously inside the call, so queries issued after that call run after the cursor.
- **`next()` calls are serialised** (`#serial`), so concurrent `next()`s are answered in order (before #34, the first of two concurrent calls never settled).
- **`return()` is immediate**: an unsent cursor is dropped from the queue; a sent one is closed (Close + Sync, then waits for the connection to be free).
- **`statementTimeout`** opens the cursor as an unnamed portal in the implicit transaction of one Sync, whatever the transaction status: a statement setting `statement_timeout` goes before the portal and one restoring it before the Sync, so the timeout bounds the cursor from its first batch to its last, the consumer's time included, and can't outlive it ([CANCELLATION.md](CANCELLATION.md#a-cursors-statement-timeout)). A suspended portal keeps `statement_timeout` running across Executes (verified on PG 18). A `Transaction` refuses it, since its other queries run between batches.
- **`signal` and `timeout`** stop the whole cursor whenever they fire ([CANCELLATION.md](CANCELLATION.md#cursors)): between batches the portal is closed without a cancel request and the next pull rejects with `AbortError`; while a batch runs, the server is asked to cancel it (`QueryCanceled`).
- `batchSize` must be a whole number from 1 (`RangeError`); before #34, `0` meant Execute(0), which fetches every row.

### `CursorOp` details

- **Rows** are decoded into the current batch as DataRows arrive (`dataRow`).
- **PortalSuspended** ends a batch with more to come; **CommandComplete** ends the last one (then Sync, outside a transaction). A result whose row count is a multiple of `batchSize` ends with an empty batch, which isn't delivered.
- **Errors**: an ErrorResponse fails the iteration. A value that fails to decode fails it with a `DecodeError` and closes the portal, so no more rows come.
- **Stale statement**: if a cached named statement went stale (a schema change) before any batch was read, outside a transaction, the cursor reopens it unnamed in place, as `QueryOp` retries.
- Cursors don't take `keepRows` (they read every row they fetch).

## Streams

`stream(sql, params, options)` (on a connection, pool, client or transaction) returns a **`RowStream`** ([row-stream.ts](row-stream.ts)) over `cursor`: rows one at a time.

- `RowStream` is a hand-written `AsyncIterator`, `AsyncIterable` and `AsyncDisposable`, not an async generator: `next()` returns the next row of the current batch with a resolved promise, and only pulls the next batch when the current one is used up. It handles concurrent `next()` calls (later ones wait for the batch being read), and `return()` (or `await using`) closes the cursor. Measured in #34, it has about half an async generator's per-row overhead.
- It runs once: iterating it again yields nothing.
- **`pool.cursor` / `pool.stream`** take a connection with `#take` when the first batch is asked for, and release it in `finally`, including on `break`.
- Inside a **transaction**, the session waits for BEGIN (and any deferred savepoint release) before starting the cursor ([TRANSACTIONS.md](TRANSACTIONS.md#the-session)).
- `Readable.from(stream)` and `ReadableStream.from(stream)` read it with backpressure and close it when destroyed or canceled.
- A long stream holds a **snapshot**: an open cursor keeps its backend's `xmin`, which holds back vacuum, and outside a transaction it is never "idle in transaction", so `idle_in_transaction_session_timeout` doesn't end it. Bound it with `statementTimeout`.
- quarry's `select(…).stream()` is this, through `DriverExecutor.stream` ([../EXECUTION.md](../EXECUTION.md#streaming)).

Measured in #34 (5M rows of `int4, text, timestamptz`, batch 1000, Node 24, local PG 18): 2,494 → 1,480 ms (2.0M → 3.4M rows/s), peak heap growth 55 → 27 MB, peak RSS growth 107 → 50 MB. 5M rows stream under `--max-old-space-size=32`, where `execute()` of 1M rows runs out of heap. Batch size trades memory for round trips: 100 rows → 3.0 s and 13 MB of heap, 10,000 → 1.5 s and 102 MB.

## COPY

**COPY** is Postgres's bulk data command: instead of one `insert` per row (or one with thousands of parameters), the client streams rows as data in a simple line format, which the server loads far faster. It also works the other way, streaming a table or query's rows out.

```
id	name	note          ← one line per row, tab-separated (text format)
1	Ada	\N            ← \N is NULL
2	Grace	line\nbreak   ← backslash escapes for \, tab, newline, carriage return
```

COPY runs through the **simple query** protocol, then switches the connection into a copy sub-protocol:

```
C> Query("copy items (id, name) from stdin")
S< CopyInResponse
C> CopyData(chunk) CopyData(chunk) … CopyDone      (or CopyFail(message))
S< CommandComplete("COPY 1000") ReadyForQuery

C> Query("copy items to stdout")
S< CopyOutResponse CopyData × n CopyDone CommandComplete("COPY n") ReadyForQuery
```

Both COPY ops are **exclusive**.

### `copyFrom(sql, source)`

`CopyFromOp` writes the Query; when CopyInResponse arrives, `#pumpSource` iterates `source` (an iterable or async iterable of strings or byte arrays):

- each chunk becomes a CopyData message; every 64 KiB the buffer is sent, and if the socket is full, it **awaits `ctx.drain()`** before reading more from the source: a fast source can't fill memory ([ARCHITECTURE.md](ARCHITECTURE.md#backpressure));
- at the end, CopyDone;
- if the source throws, CopyFail with its message: the server aborts the COPY, and the call rejects with "The COPY source failed" (the original error as `cause`);
- if the server reports an error mid-stream, pumping stops.

It resolves with the row count from `COPY n`.

### `copyRows(sql, rows)`

The convenient form: `rows` is an iterable of value arrays, encoded like query parameters (`copyChunks` → `copyLine` in [types.ts](types.ts)): each value as its Postgres text (numbers, booleans `t`/`f`, `Date`s in UTC, byte arrays as `\x` hex, arrays as literals, objects as JSON), tab-separated, `\N` for NULL, with backslash, tab, newline and carriage return escaped; batched into chunks of about 64 KiB characters.

```ts
await conn.copyRows('copy users (id, name) from stdin', [
	[1, 'Ada'],
	[2, 'Grace'],
]);
```

### `copyTo(sql)`

`CopyToOp` queues each CopyData's bytes (copied out of the read buffer) for the iterator. **Read backpressure**: once more than `highWaterMark` bytes (default 1 MiB) are queued and unread, it calls `ctx.pause()` (the socket stops reading); when the consumer brings it under half, `resume()`. So a slow consumer slows the server down instead of growing memory.

Leaving the loop early is harder than for a cursor: the server is already sending. `return()` marks the op canceled, sends a **cancel request** ([CANCELLATION.md](CANCELLATION.md)), and drains the remaining output until the server stops.

### COPY through `query()`

If `query()` or `simpleQuery()` happens to run a `COPY … FROM STDIN`, the server waits for data, and **ignores Sync** while it does. The ops answer CopyInResponse with CopyFail ("use copyFrom()") (and, for the extended protocol, a Sync), so the query fails cleanly instead of hanging the connection.

## LISTEN and NOTIFY

<a id="listen-and-notify"></a>
Postgres has a built-in publish/subscribe channel. A session runs `listen orders` to subscribe to the channel `orders`; any session can run `notify orders, 'payload'` (or `select pg_notify('orders', 'payload')`). When the notifying transaction commits, every listening session receives a **NotificationResponse** (`A`): the sender's process id, the channel and the payload. Notifications are not stored: a session that isn't listening at that moment never sees them.

### On a connection

```ts
const unlisten = await conn.listen('orders', (n) =>
	console.log(n.channel, n.payload),
);
await conn.notify('orders', JSON.stringify({ id: 7 })); // select pg_notify($1, $2)
await unlisten();
```

- `listen(channel, handler)` keeps a set of handlers per channel (`#channels`). The first handler for a channel sends `listen "channel"` (quoted identifier, unprepared); later ones just join the set. The returned function removes the handler and, when none remain, sends `unlisten`.
- `notify` uses `pg_notify($1, $2)`, so channel and payload are **parameters**, never interpolated SQL.
- `onNotification(listener)` receives every notification on the connection.
- Notifications are decoded on a fast path straight from the read buffer, with recently seen channel names reused ([protocol/README.md](protocol/README.md#notifications)), and delivered to handlers synchronously; a handler that throws is reported in a microtask and doesn't affect the others.
- `channels` lists the channels this connection listens on.

### On a pool: the dedicated listener

A pooled connection is lent to different callers for each query, and `LISTEN` is session state: it would be lost, or delivered to the wrong borrower. So `pool.listen(channel, handler)` uses a separate `Listener` with **one dedicated connection**, outside `max`:

- The connection is opened on the first `listen`. Its notifications are dispatched to the handlers of their channel.
- If it **drops** (server restart, network), the `Listener` reconnects with exponential backoff (100 ms, doubling, up to 5 s) and **re-subscribes every channel**, the `listen` statements pipelined in one round trip. Notifications sent while it was down are lost: Postgres doesn't queue them. Design consumers to re-read state after a reconnect when that matters.
- The returned function removes the handler and `unlisten`s when the channel has none left.
- `pool.end()` closes it.

`LISTEN` needs a real session: through PgBouncer in transaction mode it doesn't work; connect the listener directly or through a session-mode pool.

## Decisions

Why cursors, streams, COPY and LISTEN/NOTIFY work this way. Each links to its full entry (what it is, why, the alternatives, the cost, measured impact) in [DECISIONS.md](DECISIONS.md):

- [Streams: strict pull](DECISIONS.md#streams-strict-pull): a batch is fetched only when the consumer asks: bounded memory, and no work the consumer may never take.
- [Cursors: describe first for binary from the first run](DECISIONS.md#cursors-describe-first-for-binary-from-the-first-run): an extra round trip that pays for itself on a large result.
- [Exclusive ops for anything that keeps talking](DECISIONS.md#exclusive-ops-for-anything-that-keeps-talking): one unnamed portal and one COPY state per connection.
- [Cursors inside a transaction use a named portal](DECISIONS.md#cursors-inside-a-transaction-use-a-named-portal): other queries can run between batches, so the common loop doesn't deadlock.
- [Aborting a suspended cursor closes it instead of cancelling](DECISIONS.md#aborting-a-suspended-cursor-closes-it-instead-of-cancelling): aborts work between batches.
- [`RowStream`: a hand-written iterator instead of an async generator](DECISIONS.md#rowstream-a-hand-written-iterator-instead-of-an-async-generator): about half the per-row overhead.
- [A statement timeout bounds the whole stream](DECISIONS.md#a-statement-timeout-bounds-the-whole-stream): from the first batch to the last, without leaking.
- [COPY with backpressure both ways](DECISIONS.md#copy-with-backpressure-both-ways): never more buffered than the socket and a high-water mark.
- [A NOTIFY fast path and a channel-name cache](DECISIONS.md#a-notify-fast-path-and-a-channel-name-cache): notifications decoded straight from the read buffer.
- [A dedicated, self-healing LISTEN connection, re-subscribing in one round trip](DECISIONS.md#a-dedicated-self-healing-listen-connection-re-subscribing-in-one-round-trip): subscriptions survive reconnects and never leak into pooled sessions.
- [`notify` with `pg_notify($1, $2)`](DECISIONS.md#notify-with-pg_notify1-2): payloads can't inject SQL.

## Glossary

**COPY**: Postgres's bulk load/unload command, with its own line-based data format.

**Cursor**: a server-side position in a result, read a batch at a time.

**Flush** (message): asks the server to send pending output without ending the request.

**High-water mark**: the buffered amount at which a producer is paused.

**LISTEN / NOTIFY**: Postgres's publish/subscribe mechanism.

**PortalSuspended**: the server's "this Execute reached its row limit; the portal is still open".
