# Cursors, streams, COPY and LISTEN/NOTIFY

Most queries return a result small enough to hold in memory at once. This guide covers the ways to move data that isn't: reading a large result in batches (**cursors** and **streams**), bulk loading and unloading (**COPY**), and receiving events pushed by the server (**LISTEN/NOTIFY**).

Code: `CursorOp`, `CopyFromOp`, `CopyToOp` in [ops.ts](ops.ts); `cursor`, `stream`, `copyFrom`, `copyRows`, `copyTo`, `listen`, `notify` in [connection.ts](connection.ts); the pool's versions and its `Listener` in [pool.ts](pool.ts); COPY text helpers in [types.ts](types.ts).

## Contents

- [Cursors](#cursors)
- [Streams](#streams)
- [COPY](#copy)
- [LISTEN and NOTIFY](#listen-and-notify)
- [Why it is built this way](#why-it-is-built-this-way)
- [Glossary](#glossary)

## Cursors

<a id="cursors"></a>

```ts
for await (const batch of conn.cursor(
	'select * from events where day = $1',
	[day],
	{ batchSize: 1000 },
)) {
	for (const row of batch) handle(row);
}
```

### How it works on the wire

The extended protocol's **Execute** takes a maximum row count. With one, the server sends that many rows and then **PortalSuspended** instead of CommandComplete; the portal (the running query) stays open, and another Execute continues it. **Flush** (instead of Sync) asks the server to send what it has without ending the request:

```
C> [Parse Describe] Bind Execute(1000) Flush
S< … RowDescription BindComplete DataRow × 1000 PortalSuspended
C> Execute(1000) Flush
S< DataRow × 1000 PortalSuspended
C> Execute(1000) Flush
S< DataRow × 312 CommandComplete       ← exhausted
C> Sync
S< ReadyForQuery
```

Until the final Sync, the portal and its query stay open on the server (outside an explicit transaction, inside an implicit one that lasts until the Sync), so nothing else can be written on the connection: another Bind would replace the unnamed portal. `CursorOp` is therefore **exclusive** ([ARCHITECTURE.md](ARCHITECTURE.md#writing-the-flush)): the connection writes nothing after it until it completes.

### `CursorOp`

- **`write`**: like a query, with a named cached statement when allowed (`ctx.named()`), else unprepared with a Describe of the portal; then `Execute(batchSize)` and `Flush`. Binary formats come from the cached plan as for queries ([CODECS.md](CODECS.md#binary-after-describe)).
- **Rows**: decoded into the current batch as DataRows arrive (`dataRow`).
- **PortalSuspended** → `#deliver(false)`: the batch is ready. **CommandComplete** → `#deliver(true)` and Sync. A result whose row count is a multiple of `batchSize` ends with an empty batch, which isn't delivered.
- **`next()`**: the iterator's `next` waits for a ready batch (`#pump`). When it hands one out, it immediately sends the next `Execute + Flush` (`#fetch`): the next batch is fetched **while your code processes this one**, one batch ahead, never more. That bounds memory to about two batches, and overlaps network time with your work.
- **Early exit**: `break` (or `return`, or an exception in the loop) calls the iterator's `return()` → `op.close()`: Close the portal, Sync, and wait for ReadyForQuery so the connection is free again.
- **Errors**: an ErrorResponse fails the iteration and Syncs. A value that fails to decode fails the iteration with a `DecodeError` and closes the portal, so no more rows come. A connection failure fails it too.
- Cursors don't take `keepRows` (they read every row they fetch).

`Connection.cursor` creates the op lazily: nothing is queued until the first `next()`, so creating an iterator and never iterating it costs nothing.

## Streams

`stream(sql, params, options)` is `cursor` flattened: an async generator yielding rows one at a time (`yield* batch`). Breaking out of it closes the cursor the same way.

- **`pool.cursor` / `pool.stream`** take a connection with `#take` for the whole iteration and release it in `finally`, including on `break`.
- Inside a **transaction**, the session waits for BEGIN (and any deferred savepoint release) before starting the cursor ([TRANSACTIONS.md](TRANSACTIONS.md#the-session)).
- quarry's `select(…).stream()` uses `cursor` on a reserved connection, wrapping it in a transaction when a timeout is given ([../EXECUTION.md](../EXECUTION.md#streaming)).

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

## Why it is built this way

- **Cursors with one batch of prefetch**: bounded memory, overlapping network and processing.
- **Exclusive ops for anything that keeps talking**: the protocol has one unnamed portal and one COPY state per connection; letting other queries interleave would corrupt them.
- **Pull-based iterators** (`for await`): the consumer sets the pace; backpressure is the default, not an option.
- **COPY backpressure both ways**: the driver never buffers more than the socket and a high-water mark.
- **A dedicated, self-healing LISTEN connection**: subscriptions survive reconnects, and never leak into pooled sessions.
- **`pg_notify` with parameters**: payloads can't inject SQL.

## Glossary

**COPY**: Postgres's bulk load/unload command, with its own line-based data format.

**Cursor**: a server-side position in a result, read a batch at a time.

**Flush** (message): asks the server to send pending output without ending the request.

**High-water mark**: the buffered amount at which a producer is paused.

**LISTEN / NOTIFY**: Postgres's publish/subscribe mechanism.

**PortalSuspended**: the server's "this Execute reached its row limit; the portal is still open".
