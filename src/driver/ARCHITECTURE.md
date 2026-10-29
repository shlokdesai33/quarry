# The PostgreSQL driver, from the inside

This is the internal guide to quarry's PostgreSQL driver: the code in `src/driver/` that opens network connections to a PostgreSQL server, speaks its wire protocol, and turns bytes into JavaScript values. [README.md](README.md) next to this file documents the driver's **API** (options, methods); this guide explains **how it works and why**.

It assumes basic TypeScript and nothing about databases or networking. [Part 1](#part-1-foundations) builds up the ideas; every term is collected in the [glossary](#glossary).

The driver documentation:

| Document                                 | Covers                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| this file                                | foundations, layers, files, the connection and its operations, notices, capabilities, the statement cache, pipelining and backpressure, PgBouncer, memory, timing and telemetry, sockets, errors |
| [protocol/README.md](protocol/README.md) | the wire protocol: message formats, the extended query protocol, the reader and the writer                                                                                                       |
| [auth/README.md](auth/README.md)         | connecting: configuration, hosts and failover, TLS and certificates, startup, protocol negotiation, SCRAM, channel binding, md5, IAM passwords                                                   |
| [CODECS.md](CODECS.md)                   | codecs, built-ins, `arrayOf`, the registry, parameter OIDs, binary after describe, row decoders and nested objects, the type catalog                                                             |
| [POOL.md](POOL.md)                       | the pool: slots, waiters, pipelining onto busy connections, adaptive depth and width, draining for exclusive callers, lifetimes, ending                                                          |
| [TRANSACTIONS.md](TRANSACTIONS.md)       | transactions, savepoints, retries, and how BEGIN, COMMIT and batches are framed on the wire                                                                                                      |
| [STREAMING.md](STREAMING.md)             | cursors and streams, COPY in and out, LISTEN/NOTIFY                                                                                                                                              |
| [CANCELLATION.md](CANCELLATION.md)       | `AbortSignal`, client timeouts, cancel requests, statement and transaction timeouts                                                                                                              |
| [DECISIONS.md](DECISIONS.md)             | every design decision and optimisation in the driver: what it is, why, the alternatives, the cost, the measured impact                                                                           |

## Contents

- [Part 1: Foundations](#part-1-foundations)
- [Part 2: Layers](#part-2-layers)
- [Part 3: Every file in `src/driver/`](#part-3-every-file-in-srcdriver)
- [Part 4: The connection](#part-4-the-connection)
  - [The op queue](#the-op-queue)
  - [Notices and notifications](#notices-and-notifications)
  - [Capabilities and server parameters](#capabilities-and-server-parameters)
- [Part 5: Operations](#part-5-operations)
- [Part 6: The prepared-statement cache](#the-prepared-statement-cache)
- [Part 7: Pipelining](#pipelining)
- [Part 8: Behind PgBouncer](#part-8-behind-pgbouncer)
- [Part 9: Memory and allocation](#part-9-memory-and-allocation)
- [Part 10: Timing and telemetry](#timing)
  - [Spans](#spans)
- [Part 11: Sockets](#part-11-sockets)
- [Part 12: Errors](#errors)
- [Part 13: The driver knows nothing about quarry](#the-driver-knows-nothing-about-quarry)
- [Part 14: Testing](#part-14-testing)
- [Decisions](#decisions)
- [Glossary](#glossary)

## Part 1: Foundations

### Client, server, connection

PostgreSQL runs as a **server** process listening on a network port (5432 by default) or a Unix-domain socket (a file-like address for programs on the same machine). Your program is a **client**. To talk, the client opens a **connection**: a TCP socket, which is a two-way stream of bytes between the two machines. For each connection, the server starts a dedicated **backend** process that serves only that connection, for its whole life.

A connection carries a **session**: state that lasts until it closes, such as settings (`SET search_path = …`), temporary tables, prepared statements, and whether a transaction is open.

### Why connections are expensive, and why pools exist

Opening a connection costs several **round trips** (a message sent and its answer received): TCP's handshake, TLS's handshake (for encryption), Postgres's startup and authentication; and on the server, a new process. That is milliseconds, often more than the query itself. So programs keep connections open and reuse them. A **pool** holds a set of open connections and lends one to each piece of work ([POOL.md](POOL.md)).

### Round trips, latency and throughput

**Latency** is how long one request takes. Over a network, every request pays at least one round trip: 0.1 ms on the same machine, 1–5 ms in a data centre, 50+ ms across continents. **Throughput** is how many requests complete per second. If each request waits for the previous answer, throughput is at most 1 / latency per connection. The main way to do better without more connections is to not wait: **pipelining** ([Part 7](#pipelining)).

### The event loop

Node runs JavaScript on **one thread**. I/O doesn't block it: a socket read registers a callback and the thread moves on; when bytes arrive, the **event loop** runs the callback. Promises' `.then` callbacks run as **microtasks**: right after the current piece of code finishes, before the next I/O callback. The driver uses this to batch: anything queued during the current tick is written together in one microtask ([Part 4](#writing-the-flush)).

### What a wire protocol is

The bytes on a connection follow a format both sides agree on: the **wire protocol**. PostgreSQL's (version 3, from 2003; minor version 3.2 since PostgreSQL 18) is a sequence of **messages**, each a type byte, a length, and a body. The client sends messages like "parse this SQL" and "run it with these values"; the server answers with "here are the columns", "here is a row", "done". [protocol/README.md](protocol/README.md) covers it in detail.

### Text and binary formats

A value can travel as **text** (the integer 1 as the character `1`) or in its type's **binary** format (as four bytes `00 00 00 01`). Binary is often cheaper to decode, and is chosen per column ([CODECS.md](CODECS.md#binary-after-describe)).

### Prepared statements

Before running SQL, the server **parses** it (checks the syntax), **analyses** it (resolves names and types) and **plans** it (decides how to execute). A **prepared statement** does that once and keeps the result under a name, so later runs only send the name and the values. The driver prepares and caches statements automatically ([Part 6](#the-prepared-statement-cache)).

### Backpressure

If the client produces bytes faster than the network takes them, they pile up in memory. **Backpressure** is the signal to stop producing until the buffer drains. The driver respects it when writing ([Part 4](#backpressure)) and when reading COPY output ([STREAMING.md](STREAMING.md)).

## Part 2: Layers

```mermaid
flowchart TD
    subgraph API["Public API (index.ts)"]
        connect["connect()"]
        createPool["createPool() → Pool"]
    end
    Pool["Pool (pool.ts)<br/>slots, waiters, pipelining onto busy connections"]
    Tx["Transaction / Session (transaction.ts)"]
    Conn["Connection (connection.ts)<br/>startup, queue of Ops, flush, dispatch, statement cache"]
    Ops["Ops (ops.ts)<br/>QueryOp, SyncGroupOp, SimpleQueryOp, DescribeOp, CursorOp, FetchOp, CopyFromOp, CopyToOp"]
    Codecs["Codecs (codec.ts, codecs.ts, registry.ts, params.ts, results.ts, rows.ts, binary.ts, …)"]
    Proto["Protocol (protocol/)<br/>Writer + frontend.ts → bytes, bytes → Reader → messages"]
    Sock["DriverSocket (socket.ts)<br/>node-socket.ts · yours"]
    PG[(PostgreSQL)]
    createPool --> Pool
    connect --> Conn
    Pool --> Conn
    Pool --> Tx
    Tx --> Conn
    Conn --> Ops
    Ops --> Codecs
    Ops --> Proto
    Conn --> Proto
    Proto --> Sock
    Sock <--> PG
```

- **Socket**: moves bytes. The rest of the driver only uses the small `DriverSocket` interface: Node's `net`/`tls` by default, or a custom transport or test double passed as the `socket` option ([Part 11](#part-11-sockets)).
- **Protocol**: turns messages into bytes (`Writer`, `frontend.ts`) and bytes into messages (`Reader`).
- **Codecs**: turn JavaScript values into parameter bytes and result bytes into JavaScript values.
- **Ops**: one queued request each (a query, a cursor, a COPY): what it writes, and how it reacts to each reply message.
- **Connection**: owns the socket and a queue of ops, writes them, routes replies to them in order.
- **Transaction**, **Pool**: built on connections.

## Part 3: Every file in `src/driver/`

| File                               | What it does                                                                                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [index.ts](index.ts)               | The public API of `quarry/driver`.                                                                                                                                                                                                                    |
| [connect.ts](connect.ts)           | `connect()`, `openConnection()`: hosts in turn, TLS plans, protocol-version retry, connect timeout, cancel requests. [auth/README.md](auth/README.md)                                                                                                 |
| [config.ts](config.ts)             | `ConnectionOptions`, connection-string parsing, `PG*` environment variables, `resolveConfig`, `.pgpass`. [auth/README.md](auth/README.md#configuration)                                                                                               |
| [connection.ts](connection.ts)     | `Connection`: startup and authentication, the op queue, flushing, dispatching replies, the statement cache, `query`/`queryGroup`/`simpleQuery`/`describe`/`cursor`/`copy*`/`listen`, notices, `capabilities`, telemetry spans, cancellation, closing. |
| [ops.ts](ops.ts)                   | The operations: `Op`, `QueryOp`, `SyncGroupOp`, `SimpleQueryOp`, `DescribeOp`, `CursorOp`, `FetchOp`, `ClosePortalOp`, `CopyFromOp`, `CopyToOp`; `QueryResult`, `OpTiming`, `Statement`, `Description`, `parseTag`, `STATEMENT_TIMEOUT`.              |
| [cursor.ts](cursor.ts)             | `CursorIterator`: one run of a cursor (opening, serialised `next()`, `return()`, `statementTimeout`, aborts). [STREAMING.md](STREAMING.md#cursors)                                                                                                    |
| [row-stream.ts](row-stream.ts)     | `RowStream`: rows one at a time over a cursor's batches; async iterable and disposable.                                                                                                                                                               |
| [queue.ts](queue.ts)               | `Queue<T>`: a FIFO that keeps its array's capacity ([the op queue](#the-op-queue)).                                                                                                                                                                   |
| [pool.ts](pool.ts)                 | `Pool`, `PoolClient`, `createPool`, the adaptive `Depth` and `Width`, the pool's LISTEN connection. [POOL.md](POOL.md)                                                                                                                                |
| [transaction.ts](transaction.ts)   | `Transaction`, `Session`, `TransactionRolledBack`, `Transaction.run`/`batch`. [TRANSACTIONS.md](TRANSACTIONS.md)                                                                                                                                      |
| [protocol/](protocol/README.md)    | `frontend.ts` (client messages), `writer.ts`, `reader.ts`, `messages.ts` (server message types), `text.ts` (UTF-8 helpers).                                                                                                                           |
| [auth/](auth/README.md)            | `scram.ts` (SCRAM-SHA-256, channel binding, SASLprep), `md5.ts`, `encoding.ts` (base64, UTF-8, hex).                                                                                                                                                  |
| [codec.ts](codec.ts)               | The `Codec` interface, `defineCodec`, `arrayOf`, `declareParamType`, `typed`/`TypedValue`. [CODECS.md](CODECS.md)                                                                                                                                     |
| [codecs.ts](codecs.ts)             | The built-in codecs (`codecs`) and `defaultCodecs`.                                                                                                                                                                                                   |
| [registry.ts](registry.ts)         | `CodecRegistry` (codec by type OID), `TypeCatalog` (types looked up by name), `catalogQuery`.                                                                                                                                                         |
| [params.ts](params.ts)             | `encodeParams`, `paramOids`: encoding a query's parameters and choosing the OIDs to declare.                                                                                                                                                          |
| [results.ts](results.ts)           | Result plans: which codec and format each column is read with, cached per statement.                                                                                                                                                                  |
| [rows.ts](rows.ts)                 | Row decoders: generated JavaScript per result shape, and a fallback.                                                                                                                                                                                  |
| [binary.ts](binary.ts)             | Binary-format decoders (`int4`, `float8`, `timestamptz`, `numeric`, `uuid`, `jsonb`, `vector`, arrays).                                                                                                                                               |
| [array-params.ts](array-params.ts) | `binaryArray`: encoding arrays of common types in binary.                                                                                                                                                                                             |
| [types.ts](types.ts)               | Text helpers: OID tables, `parseArray`, `parseBytea`, `formatTimestamp`, `encodeParam`, COPY text format.                                                                                                                                             |
| [parsers.ts](parsers.ts)           | Text parsers: `parseTimestamptz`, `parseRange`, `vectorValues`.                                                                                                                                                                                       |
| [capabilities.ts](capabilities.ts) | `Capabilities`, PgBouncer detection, `statementNames`, the PostgreSQL 18 check.                                                                                                                                                                       |
| [errors.ts](errors.ts)             | Every error class and `postgresError()`.                                                                                                                                                                                                              |
| [notice.ts](notice.ts)             | `Notice` and `Notification` shapes, `toNotice`. [Notices and notifications](#notices-and-notifications)                                                                                                                                               |
| [telemetry.ts](telemetry.ts)       | OpenTelemetry-compatible spans (`startQuerySpan`, `TracerLike`, `SpanLike`, `TelemetryOptions`), without depending on OpenTelemetry. [Part 10](#timing)                                                                                               |
| [socket.ts](socket.ts)             | The `DriverSocket` and `SocketFactory` interfaces, `SocketConnectOptions`, `TlsConnectOptions`.                                                                                                                                                       |
| [node-socket.ts](node-socket.ts)   | `nodeSockets`, the default `SocketFactory` on `node:net`/`node:tls`, and `preloadNodeSockets`.                                                                                                                                                        |

## Part 4: The connection

[connection.ts](connection.ts). A `Connection` is one session with the server. Its main state:

```ts
readonly #socket: DriverSocket;
readonly #reader: Reader;           // bytes → messages
readonly #writer = new Writer();    // messages → bytes
readonly #queue = new Queue<Op>();  // operations, in the order they were issued
#written = 0;                       // how many at the front of the queue have been written
#flushScheduled = false;
#backpressure = false;              // the socket's buffer is full
#blocking: Op | undefined;          // an exclusive op written: nothing more is written until it completes
#canceling: Op | undefined;         // an op we asked the server to cancel: hold later writes
readonly #statements = new Map<string, Statement>(); // the prepared-statement cache
#naming: 'always' | 'alone' | 'never';
#status: 'I' | 'T' | 'E';          // idle / in transaction / failed transaction
#pid; #secretKey;                   // for cancel requests
readonly #parameters = new Map<string, string>(); // server_version, TimeZone, …
```

### Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Starting: Connection.open(socket)
    Starting --> Ready: ReadyForQuery during startup
    Starting --> Closed: error (auth, version, protocol)
    Ready --> Ending: close()
    Ending --> Closed: queue empty → Terminate, socket ends
    Ready --> Closed: destroy() / socket error / FATAL from server
```

`Connection.open` (called by [connect.ts](connect.ts) once a socket is connected, and TLS started if needed) runs `#startup()`: send the StartupMessage, answer authentication requests, record BackendKeyData and ParameterStatus, until ReadyForQuery. During startup, messages go to an **inbox** that `#startup` reads one at a time (`#nextStartupMessage`); afterwards, they go to the ops. [auth/README.md](auth/README.md#startup-step-by-step).

`#fail(error)` is the single exit for every failure: it marks the connection closed, destroys the socket, fails every queued op with the error, wakes anyone waiting, and notifies `onClose` listeners. A connection is never reopened: the pool replaces it ([POOL.md](POOL.md)).

### The life of a query on a connection

<a id="the-life-of-a-query-on-a-connection"></a>

```mermaid
sequenceDiagram
    participant App as caller
    participant C as Connection
    participant Q as queue
    participant S as socket
    participant PG as server
    App->>C: query(sql, params, options)
    C->>C: encodeParams, paramOids
    C->>Q: push(QueryOp), schedule flush (microtask)
    Note over C: other queries issued this tick join the queue
    C->>Q: flush: op.write(ctx) for each unwritten op
    C->>S: one write (or 64 KiB chunks)
    S->>PG: Parse/Bind/Execute/Sync …
    PG-->>S: ParseComplete … DataRow … ReadyForQuery
    S-->>C: onData(chunk)
    C->>C: Reader splits messages
    C->>Q: queue.at(0).handle(msg) / .dataRow(bytes)
    Note over C: ReadyForQuery → op settles → shift queue
    C-->>App: Promise resolves with { rows, rowCount, command, fields }
```

`query()` → `#query()`:

1. A server-side `statementTimeout` takes a separate path, `#queryWithTimeout`: three statements under one Sync, as one `SyncGroupOp` (set the timeout with `STATEMENT_TIMEOUT`, the query, restore it with the same statement), so the setting bounds this query alone, in a transaction or not ([CANCELLATION.md](CANCELLATION.md#statement-timeouts)).
2. `invalidSql(sql)`: the SQL must be a string without NUL bytes (Postgres text can't contain them).
3. `encodeParams` and `paramOids` ([CODECS.md](CODECS.md#encoding-a-querys-parameters)).
4. A `QueryOp` is built and `#enqueue`d. `#enqueue` fails it at once if the connection is closed or the signal is already aborted; otherwise it pushes it, schedules a flush, and wires the signal and the client timeout ([CANCELLATION.md](CANCELLATION.md)).
5. If the type catalog isn't loaded yet and this query needs it, `#loadTypesAfter` starts loading it, queued **behind** this query ([CODECS.md](CODECS.md#types-looked-up-by-name-the-catalog)).

A performance detail: `#query` creates its promise with a **shared executor function** (`capture`) that stores `resolve`/`reject` in module variables, rather than an arrow function closing over the op. A closure per query would allocate a function and its context every time; this allocates neither. `#query` reads the two variables right after and **resets them to a no-op** (#36): left set, they kept the latest query's promise, and with it its result rows, reachable until the next query, which on a connection that then sits idle holds the last big result in memory for nothing.

```ts
const promise = new Promise<QueryResult<unknown>>(capture);
const resolve = capturedResolve;
const reject = capturedReject;
capturedResolve = noop;
capturedReject = noop;
```

The same care (no closures, no spreads, index loops) shows in other per-query code; comments mark it.

### The op queue

<a id="the-op-queue"></a>
The connection's ops wait in a `Queue<Op>` ([queue.ts](queue.ts)), not a plain array: `push` and then `shift` on a short array makes V8 reallocate its storage each time, so a connection running one query at a time would make garbage on every query. `Queue` keeps one array with a head and a tail index: `shift` clears the slot and moves the head; when the queue empties, both go back to 0, and in a pipeline that never empties, the items are moved down once the head passes 1024 and half the array. `at(i)` is how the connection reads the op at the head and the next one to write (`#written`); `indexOf` and `removeAt` drop an op aborted before it was written (or one that couldn't be encoded), `find` picks the next aborted op to hold writes for, and `drain()` empties the queue when the connection fails.

### Writing: the flush

<a id="writing-the-flush"></a>

```ts
#schedule(): void {
  if (this.#flushScheduled) return;
  this.#flushScheduled = true;
  queueMicrotask(this.#flushTask);
}

#flush(): void {
  this.#flushScheduled = false;
  if (this.#closed || this.#backpressure) return;
  while (this.#written < this.#queue.length && this.#blocking === undefined && this.#canceling === undefined) {
    const op = this.#queue.at(this.#written);
    this.#written++;
    const before = this.#writer.length;
    try {
      op.write(this.#ctx);
    } catch (error) {
      // a request that can't be encoded fails alone; nothing of it is sent
      this.#writer.truncate(before);
      …
      continue;
    }
    op.written = true;
    if (op.exclusive) this.#blocking = op;
    if (this.#writer.length >= FLUSH_BYTES && !this.#send(this.#writer.take())) return;
  }
  if (this.#writer.length > 0) this.#send(this.#writer.take());
}
```

- **One write per tick.** Every op issued in the same synchronous run of code lands in the queue before the microtask runs, and they are all encoded into one buffer and handed to the socket in one `write`. Fewer writes mean fewer system calls and fewer network packets.
- **64 KiB chunks.** For a long queue, the buffer is handed over every `FLUSH_BYTES` (65,536) bytes. If the socket reports its buffer full, encoding stops right there.
- **An op that can't be encoded** (a codec threw, a string contains NUL) is cut out of the buffer (`truncate`) and failed alone; the others still go.
- **Exclusive ops** (cursors, COPY) keep talking after they're written (a cursor sends Execute again for each batch), and anything written after them would interleave with that conversation. So once one is written, `#blocking` stops further writes until it completes.
- **A pending cancel** (`#canceling`) also holds back writes: [CANCELLATION.md](CANCELLATION.md#why-later-writes-are-held-back).

### Backpressure

<a id="backpressure"></a>
`#send(bytes)` calls `socket.write`, which returns `false` when the socket's send buffer is over its high-water mark. The connection then sets `#backpressure`, and `#flush` encodes nothing more: queued ops stay as objects, **not yet encoded**, so a burst of ten thousand queries (or a few with huge parameters) doesn't become ten thousand encoded buffers in memory. When the socket emits `drain`, `onDrain` clears the flag, wakes ops waiting on `ctx.drain()` (COPY), and reschedules the flush.

### Reading replies

<a id="reading-replies"></a>

```ts
#onData(chunk: Uint8Array): void {
  const reader = this.#reader;
  try {
    reader.push(chunk);
    for (let type = reader.nextType(); type >= 0; type = reader.nextType()) {
      if (type === 0x44 && !this.#starting) {                   // 'D': DataRow
        const op = this.#queue.at(0);
        if (op?.written && op.dataRow(reader.bytes, reader.start, reader.end)) continue;
      } else if (type === 0x41) {                                // 'A': NotificationResponse
        this.#notify(decodeNotification(reader.bytes, reader.start, reader.end, this.#channelNames));
        if (this.#closed) return;
        continue;
      }
      this.#dispatch(reader.parse());
      if (this.#closed) return;
    }
  } catch (error) {
    this.#fail(error instanceof Error ? error : new ProtocolError(String(error)));
  }
}
```

- **DataRow fast path**: rows are by far the most frequent message. Instead of building a message object, the connection passes the read buffer and the row's offsets straight to the op, whose generated decoder reads the values in place ([CODECS.md](CODECS.md#row-decoders)).
- **NotificationResponse fast path**: decoded straight from the buffer, with recently seen channel names reused ([STREAMING.md](STREAMING.md#listen-and-notify)).
- **`#dispatch(msg)`**: NoticeResponse goes to `onNotice` listeners and ParameterStatus updates `parameters` whatever is running; during startup, everything else goes to the inbox; a FATAL or PANIC error is remembered (`#fatal`), so later failures report it; then the message goes to the op at the **head** of the queue.

Replies come back in the order requests were sent, so the op at the head is always the one the message belongs to. When `op.handle(msg)` returns `true` (it saw its final ReadyForQuery), the connection shifts it off the queue, unblocks writing if it was exclusive or canceled, may send a pending cancel for the new head, reschedules the flush, and runs the op's `onDone`.

A message with no op in flight is either an error the server sends on its own (an idle session timeout, an administrator terminating the backend: the connection fails with it) or a protocol violation (`ProtocolError`).

`onDone` is how the pool learns a query finished without a promise of its own per query: the connection calls it **before** callbacks on the query's promise run, so a pool can lend the connection to the next query before the caller's continuation issues its own.

### Notices and notifications

<a id="notices-and-notifications"></a>
The server sends two kinds of message that answer no request:

- **NoticeResponse**: a warning or an informational message (`RAISE NOTICE` in a function, "there is no transaction in progress" for a stray `commit`). It has the same fields as an error. [notice.ts](notice.ts) `toNotice` turns them into a `Notice`: `severity` (the non-localized `V` field, else `S`, else `NOTICE`), `code` (the SQLSTATE, `00000` when absent), `message`, `detail`, `hint`, `where`, and every field as sent in `fields`.
- **NotificationResponse**: a `NOTIFY` on a channel this session listens to, as a `Notification`: `pid` (the notifying backend), `channel`, `payload`.

Either can arrive in the middle of any op's replies, so `#dispatch` and the fast path in `#onData` hand them to listeners **before** looking at the head of the queue, and the op never sees them. Listeners subscribe two ways: the `onNotice` and `onNotification` connection options (on a pool: every connection it opens), or `connection.onNotice(listener)` and `connection.onNotification(listener)`, which return a function that unsubscribes. `listen(channel, listener)` adds a listener for one channel ([STREAMING.md](STREAMING.md#listen-and-notify)). A listener that throws doesn't break the connection: the error is rethrown in a microtask (`queueMicrotask`), where it surfaces as an uncaught exception rather than inside the reader's loop. Without listeners, notices are dropped.

### Capabilities and server parameters

<a id="capabilities-and-server-parameters"></a>
What a connection learned at startup stays readable on it:

| Getter                        | What                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `capabilities`                | `Capabilities` ([capabilities.ts](capabilities.ts)): `protocol` (`3.2`), `protocolMinor`, `serverVersion`, `saslMechanisms` offered, `pgbouncer` |
| `parameters`                  | every ParameterStatus the server reported (`server_version`, `TimeZone`, `in_hot_standby`, …), kept up to date after startup                     |
| `protocol`                    | the negotiated protocol version                                                                                                                  |
| `unrecognizedProtocolOptions` | `_pq_.*` options the server didn't recognize (from NegotiateProtocolVersion)                                                                     |
| `processId`                   | the backend's process ID (from BackendKeyData)                                                                                                   |
| `host`                        | the host this connection reached                                                                                                                 |
| `transactionStatus`           | `idle`, `transaction` or `failed`, from the last ReadyForQuery                                                                                   |
| `pending`, `closed`           | ops queued or in flight; whether it is closed or closing                                                                                         |

`capabilities` is computed once, at the startup ReadyForQuery, right after the PostgreSQL 18 check (`checkServerVersion`, `EVERSION` below 18; a version a pooler hides passes), and is a snapshot: later ParameterStatus messages update `parameters` but not it. `pgbouncer` (`PgBouncerInfo`: `version`, `poolMode`, `maxPreparedStatements`) is read from the parameters PgBouncer 1.26+ reports, and decides how statements are named ([Part 8](#part-8-behind-pgbouncer)). The sequence is in [auth/README.md](auth/README.md#after-startup-version-check-and-capabilities).

### Closing

`close()` sets `#ending` (no new work), waits until the queue is empty (`idle()`), writes **Terminate**, and ends the socket. Like libpq, it doesn't wait for the server to close its side (that would wait for the backend process to exit, about a millisecond). `close({ timeout })` fails what's still running after the timeout. `destroy()` fails everything immediately.

## Part 5: Operations

[ops.ts](ops.ts). Each request is an `Op`, an object the connection queues, writes, and feeds messages to:

```ts
abstract class Op {
  written = false;
  done = false;
  exclusive = false; // later ops wait until it completes; read once it is written
  canceledBy: 'abort' | 'timeout' | undefined;
  onTiming;
  onDone;
  queuedAt;
  writtenAt;
  dataRow(bytes, start, end): boolean; // the DataRow fast path; false if not accepted
  interrupt(reason, cause): boolean; // stop a written op the server isn't running, without a cancel request
  get prepares(): number; // statements it may write named
  abstract write(ctx: OpContext): void; // append its messages to ctx.writer
  abstract handle(msg, ctx): boolean; // true when complete (its ReadyForQuery)
  abstract fail(error: Error): void; // the connection failed first
}
```

`OpContext` is what an op may use on its connection: the writer, the registry and catalog, `specs` (how results are read where a query names no codecs, with and without binary), the statement cache (`statement`, `forget`, `unprepare`, `preparable`), the naming decision (`named`), `send` and `drain` for ops that talk after being written, `pause`/`resume` for COPY backpressure, and `retry` to requeue a replacement op.

| Op                         | Messages written                                                                                                                                                             | Used by                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `QueryOp`                  | [Parse, Describe] Bind Execute [Sync]                                                                                                                                        | `query`, and each statement of a group                              |
| `SyncGroupOp`              | several `QueryOp`s, one Sync                                                                                                                                                 | `queryGroup`: BEGIN with the first statement, transactional batches |
| `SimpleQueryOp`            | Query                                                                                                                                                                        | `simpleQuery`: several statements, no parameters                    |
| `DescribeOp`               | Parse Describe(S) Sync                                                                                                                                                       | `describe`                                                          |
| `CursorOp`                 | outside a transaction (exclusive): [Parse] [Describe Flush] Bind Execute(n) Flush, then Execute(n) Flush per pull, Sync; inside one: Bind on a named portal, Execute(n) Sync | `cursor`, `stream` ([STREAMING.md](STREAMING.md))                   |
| `FetchOp`, `ClosePortalOp` | Execute(n) Sync / Close Sync on a transaction's named portal                                                                                                                 | the later batches and the end of a cursor inside a transaction      |
| `CopyFromOp` (exclusive)   | Query, then CopyData … CopyDone                                                                                                                                              | `copyFrom`, `copyRows`                                              |
| `CopyToOp` (exclusive)     | Query                                                                                                                                                                        | `copyTo`                                                            |

### `QueryOp.write`: four ways to send one statement

```mermaid
flowchart TD
    W["QueryOp.write"] --> P{"prepare (default true)<br/>and SQL preparable here?"}
    P -->|no| U["Parse '' · Bind '' (text) · Describe portal · Execute · Sync<br/>(unprepared)"]
    P -->|yes| N{"ctx.named()?"}
    N -->|"no (pipelined, behind PgBouncer)"| UN["Parse '' · Bind '' (cached formats) · Describe portal · Execute · Sync<br/>(unnamed, with cached columns)"]
    N -->|yes| C{"statement new<br/>(unwritten)?"}
    C -->|yes| NEW["Parse 'qN' · Describe 'qN' · Bind (text) · Execute · Sync"]
    C -->|no| OLD["Bind 'qN' (formats from cached plan) · Execute · Sync"]
```

- **New named statement**: Parse it under a name (`q1`, `q2`, … per connection) and Describe it, so its parameter types and columns are learned; Bind asks for **text** results, because no column's type is known yet.
- **Cached named statement**: only Bind and Execute; the formats come from the cached plan, so columns whose codec reads binary are asked for in binary ([CODECS.md](CODECS.md#binary-after-describe)).
- **Unnamed with cached columns**: behind PgBouncer when pipelined ([Part 8](#part-8-behind-pgbouncer)).
- **Unprepared** (`prepare: false`, or SQL marked unpreparable): the unnamed statement, text results, Describe of the portal for the columns.

### `QueryOp.handle`

| Message              | What happens                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ParseComplete        | the statement is marked `parsed`                                                                                                     |
| ParameterDescription | ignored (the server's inferred parameter types)                                                                                      |
| RowDescription       | columns known: stored on a new statement, and a plan is chosen (`#described`)                                                        |
| NoData               | the statement returns no rows                                                                                                        |
| BindComplete         | for a cached statement, use its cached plan (no RowDescription will come)                                                            |
| DataRow              | decoded and kept (up to `keepRows`)                                                                                                  |
| CommandComplete      | the tag (`SELECT 1`, `UPDATE 3`)                                                                                                     |
| ErrorResponse        | becomes a `PostgresError` (`#onError`); the server then skips to Sync                                                                |
| CopyInResponse       | COPY FROM STDIN through `query()`: answered with CopyFail and Sync (the server ignores Sync during COPY), so the query fails cleanly |
| ReadyForQuery        | `#finish`: resolve, reject, or retry a stale statement                                                                               |

### keepRows

<a id="keeprows"></a>
`dataRow` returns early once `rows.length >= keepRows`, so the rows after it are **not decoded**: the bytes are skipped. The query still runs to completion and the command tag still counts every row. quarry's `takeFirst()` (`keepRows: 1`) and `expectOne()` (`keepRows: 2`) use it. A row not kept is never decoded, so a decode error in it goes unnoticed (documented on the option).

### Nested objects

<a id="nested-objects"></a>
With a query's `nested` option (quarry's `nest`, #44), the generated decoder writes some columns into an object of the row instead of the row itself. The object takes the place of its marker column. The row literal starts it as `null`; a `true` marker stores a fresh literal of nulls (`{ "id": null, "name": null }`), and each of the object's non-NULL columns is stored into it (`row["bookings"]["id"] = …`). A missing row (marker false, every column NULL) allocates nothing. The marker must come before its columns (`checkNested`, when the query is issued). The decoder is cached on the plan per row mode and nesting, and without generated code the same layout is built from the values array. [CODECS.md](CODECS.md#nested-objects) shows the generated code.

### Decode errors

If a codec throws while decoding a value, the generated decoder wraps it in a `DecodeError` naming the column and type OID (never the value, which could be sensitive). The op records it, drops its rows, ignores the rest of the rows, and rejects with it at ReadyForQuery. The connection stays usable: the protocol is intact, only that query's values were unreadable.

## Part 6: The prepared-statement cache

<a id="the-prepared-statement-cache"></a>

### Entries

```ts
interface Statement {
  readonly name: string; // 'q7', or '' for SQL only ever sent unnamed (its columns are still cached)
  readonly key: string; // its key in the cache: the SQL, or types and SQL (below)
  readonly sql: string;
  readonly types: readonly number[]; // the declared parameter types
  used: number; // last lookup, on the connection's counter
  seen: number; // unnamed runs the server parsed, towards prepareThreshold
  unwritten: boolean; // created, its Parse not yet written
  parsed: boolean; // ParseComplete arrived
  fields: readonly Field[] | undefined; // its columns, once described
  error: PostgresError | undefined; // its Parse failed
  readonly plans: CachedPlan[]; // how its results are read, per registry/codecs
}
```

The same SQL with different declared parameter types is a different server-side statement. The **key** is the SQL itself for the first statement of a SQL text, whose `types` are compared on each lookup; the same SQL with other types is keyed `types.join(',') + '\0' + sql`, which no SQL text can equal (SQL has no NUL). A SQL string used again keeps its hash, so a hit costs a `Map` lookup and a short array comparison; a key built per query would be hashed in full every time (about 450 ns for a builder point lookup's 200 characters).

### Lookup and eviction

`Connection.#statement(sql, types, named)`:

- Look up the SQL; if it isn't there, or its statement declares other types, look up the types-and-SQL key.
- Found: stamp `used` with `++#statementUses` and return it. (A use stamp rather than moving the entry to the end of the `Map`: deleting and re-adding a key on every hit makes the `Map` rehash, garbage that adds up to GC pauses on small queries.) An unnamed entry whose SQL the server has now parsed `prepareThreshold − 1` times unnamed (`seen`, counted by the op at its ParseComplete) is replaced by a named one, which the op parses and describes like new SQL.
- Not found: create it, **unnamed** until its SQL has run `prepareThreshold` times (default 2; with 1, named at once). If the cache is full (`statementCacheSize`, default 100), evict the least recently used unnamed entry, or else the entry with the lowest `used`, writing a **Close** for a named one's server-side statement **before** the new Parse, in the same buffer (the op ignores the CloseComplete).
- An unnamed entry's query runs as Parse(""), Bind, Describe(portal), Execute, with the columns it described cached on the entry: SQL run once costs no server-side statement and pushes no prepared one out of the cache.

`prepare: false` (per query or per connection) or `statementCacheSize: 0` disables named statements.

### Errors and stale statements

- **Parse failed** (a syntax error): the statement records its error and is dropped from the cache. If other queries with the same SQL were pipelined behind it, their Binds reference a statement that doesn't exist and get "prepared statement does not exist" (`26000`); `#onError` reports the original Parse error to them instead, which is the error you'd want to see.
- **Stale statement** (`staleStatement` in [ops.ts](ops.ts)): a schema change made the cached plan invalid, reported as `0A000` from `RevalidateCachedQuery` ("cached plan must not change result type"), a `42804` from `transformAssignedExpr` (a parameter type inferred from a column that changed type), or `26000` from `FetchPreparedStatement` (the server no longer has it: `DEALLOCATE`, `DISCARD ALL`). Outside a transaction (`status === 'I'`, since inside one the error has already failed the transaction), the op drops the statement and **retries once unprepared**, transferring its `onDone` to the retry so the caller sees one query. Inside a transaction the error is reported. So is it for a statement of a group (`queryGroup`: a BEGIN with its first statement, a batch, a statement timeout's three statements), whose later statements the server skipped after the error, and for one already sent unnamed.
- **Unprepare**: if even a **fresh** Parse of the SQL got a stale plan, a pooler is mapping it back to a server-side statement prepared before the schema change (PgBouncer does this). The SQL is added to `#unprepared` and is never named again on this connection.

## Part 7: Pipelining

<a id="pipelining"></a>
**Pipelining** means sending a request before the answer to the previous one has arrived. Postgres processes requests on a connection in order and answers in order, so the client can match answers to requests by position. Ten queries pipelined cost about one round trip instead of ten.

The connection pipelines automatically: everything issued in the same tick goes out in one write ([the flush](#writing-the-flush)), and anything issued while earlier queries are in flight is written in the next flush without waiting for them. Captured from the driver, three concurrent `pool.query()` calls on a one-connection pool:

```
C> Parse("q2", "select $1::int") Describe(S) Bind(q2) Execute Sync  Bind(q2) Execute Sync  Bind(q2) Execute Sync   (one write)
S< ParseComplete ParameterDescription RowDescription BindComplete DataRow CommandComplete ReadyForQuery
S< BindComplete DataRow CommandComplete ReadyForQuery
S< BindComplete DataRow CommandComplete ReadyForQuery
```

The second and third queries reuse `q2` although its Parse hasn't been answered yet: the server processes messages in order, so by the time it reads their Binds, `q2` exists.

### Error isolation: one Sync per query

When a statement fails, the server **skips every message until the next Sync**, then answers ReadyForQuery. So each `QueryOp` ends with its own Sync: a failing query doesn't fail the ones pipelined behind it. Statements that **should** fail together (a BEGIN and the first statement of its transaction, a transactional batch) share one Sync on purpose, through `SyncGroupOp` ([TRANSACTIONS.md](TRANSACTIONS.md)).

Inside a transaction, a failed statement fails the whole transaction (Postgres's rule, not the driver's): later statements get "current transaction is aborted" until the rollback.

### Depth

A connection itself puts no limit on how many queries are in flight; the pool does ([POOL.md](POOL.md#adaptive-pipeline-depth)). Backpressure bounds the memory ([Part 4](#backpressure)).

## Part 8: Behind PgBouncer

**PgBouncer** is a popular **connection pooler**: a proxy between many clients and a few server connections. In **transaction mode** it lends a server connection to a client only for the duration of a transaction (or a single statement outside one), so consecutive queries of one client may run on different server connections. Session state (prepared statements, `SET`, `LISTEN`) doesn't survive that.

PgBouncer 1.21+ can keep track of **named prepared statements** (`max_prepared_statements`): it prepares them on whichever server connection runs them, **rewriting** the statement name in every Parse and Bind. That rewriting has a cost: PgBouncer flushes what it holds and writes the rewritten message apart from the rest, so each named query reaches the server in two writes. Under load, the single-threaded pooler becomes the bottleneck, and that costs more than having the server parse again.

What the driver does ([capabilities.ts](capabilities.ts), `naming()` in [connection.ts](connection.ts)):

| What the other end reports at login                                          | `statementNames` | Naming                                                        |
| ---------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| no PgBouncer, or PgBouncer in session mode                                   | `kept`           | `always`: every cached statement is named                     |
| PgBouncer 1.26+ in transaction/statement mode, `max_prepared_statements` > 0 | `rewritten`      | `alone`: named only when the query is alone on the connection |
| the same with `max_prepared_statements = 0`                                  | `unsupported`    | `never`                                                       |

PgBouncer 1.26+ reports itself through ParameterStatus (`pgbouncer.version`, `pgbouncer.pool_mode`, `pgbouncer.max_prepared_statements`). For 1.21–1.25, which don't, set `preparePipelined: false` to get `alone`; `true` forces `always`.

`ctx.named()` with `alone` returns true only when the op is the only thing on the connection (`queue.length === 1`) and doesn't itself contain more than one statement that may be named.

A query sent **unnamed** this way still benefits from the cache: if the statement's columns are known, it asks for their binary formats and reuses the cached plan and decoder; Describe of the portal reports the columns, and `#describedUnnamed` checks they still match (same names, types and formats). If a schema change altered them, the cache entry is dropped and the rows are decoded by what the server sent; if a column requested in binary changed to a type no codec can read in binary, the query fails with a `DecodeError` after running ([ops.ts](ops.ts)).

Other poolers and proxies (RDS Proxy, Supavisor, Neon) follow the same rules; [README.md](README.md#poolers-and-proxies) has the user-facing advice. The driver's own settings never use session state: statement timeouts, transaction settings and transaction timeouts all use `set_config(…, true)` inside a transaction.

## Part 9: Memory and allocation

A driver runs the same code millions of times; small allocations per query or per row become **garbage collection** (GC) pauses, which show up as tail latency (p99). The driver is written to allocate little:

| Where                                           | What                                                                                                                                                                                                                                                    | Why                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [protocol/reader.ts](protocol/reader.ts)        | Messages are read **in place** from the received chunk; only a message split across two chunks is copied, into a buffer of exactly its size (a large DataRow into one reused buffer, dropped when the connection is idle); consumed chunks are released | no re-copying when joining chunks, so large rows and COPY data stay linear, and an idle connection holds no old buffer                                     |
| [protocol/writer.ts](protocol/writer.ts)        | One growable buffer per connection; a buffer that grew past 1 MiB for one message is handed to the socket and replaced, not copied or kept                                                                                                              | big parameters don't pin a large buffer for the connection's lifetime                                                                                      |
| [protocol/writer.ts](protocol/writer.ts) `take` | Small writes are copied into a Node `Buffer` from its shared pool                                                                                                                                                                                       | Node's socket takes a `Buffer` without wrapping it                                                                                                         |
| [protocol/reader.ts](protocol/reader.ts)        | Messages without fields (ParseComplete, BindComplete, …) and ReadyForQuery are shared constant objects; the last 8 command tag strings are reused                                                                                                       | several messages per query, none allocated                                                                                                                 |
| [rows.ts](rows.ts)                              | Rows decoded straight into an object literal by generated code; no intermediate values array                                                                                                                                                            | one allocation per row, and every row has the same hidden class                                                                                            |
| [protocol/text.ts](protocol/text.ts) `utf8`     | Text values decoded with `Buffer#utf8Slice` straight from the read buffer (#45); a plain `Uint8Array` builds short ASCII runs (up to 24 bytes) in JavaScript and uses `TextDecoder` for the rest                                                        | `toString('utf8', start, end)` checks its arguments and looks up the encoding before making the same native call, on every value                           |
| [rows.ts](rows.ts)                              | Generated functions of at most 8 columns each; the cache of generated sources dropped past 4 M characters                                                                                                                                               | V8's optimizing compiler needs memory superlinear in function size: one function for 100 columns cost ~70 MB of native memory, 8-column pieces under 10 MB |
| [queue.ts](queue.ts)                            | A FIFO that keeps its array (head/tail indexes)                                                                                                                                                                                                         | `push` then `shift` on a short array reallocates its storage every time                                                                                    |
| [connection.ts](connection.ts)                  | Shared promise executor, whose captured resolvers are reset after each query (#36); default query options computed once; no closures per query                                                                                                          | no function contexts per query, and no finished result kept alive by the executor                                                                          |
| [pool.ts](pool.ts)                              | Slot state in fields, not sets of busy connections; per-connection callbacks made once                                                                                                                                                                  | adding/removing from a set on every query rehashes it                                                                                                      |
| [connection.ts](connection.ts)                  | Statement cache uses use stamps, not reordering                                                                                                                                                                                                         | no `Map` rehash per hit                                                                                                                                    |
| [binary.ts](binary.ts), [rows.ts](rows.ts)      | `bytea` values and undecoded binary columns are **copied** out of the read buffer                                                                                                                                                                       | a row must never keep the whole read buffer alive or alias it                                                                                              |
| [connection.ts](connection.ts) flush            | Queued ops stay unencoded while the socket is full                                                                                                                                                                                                      | memory bounded by the socket, not by the queue length                                                                                                      |
| [ops.ts](ops.ts) `CopyToOp`                     | Pauses the socket past a high-water mark                                                                                                                                                                                                                | COPY output can't outrun the consumer                                                                                                                      |
| [ops.ts](ops.ts) `CursorOp`                     | Fetches `batchSize` rows at a time, only when the consumer asks                                                                                                                                                                                         | a large result never sits in memory at once                                                                                                                |
| [protocol/reader.ts](protocol/reader.ts)        | `maxMessageSize` (default 1 GiB, Postgres's own field limit)                                                                                                                                                                                            | a corrupt length can't make the driver allocate without bound                                                                                              |

The benchmarks behind these choices live in `bench/driver` (`pnpm bench:driver`).

## Part 10: Timing and telemetry

<a id="timing"></a>

- **`onTiming`** (a query option): when set, the op records `queuedAt` when queued and `writtenAt` when written, and on settling reports `{ queuedMs, execMs }`: time waiting behind other ops on the connection, and time from being written to finishing (server work, transfer and decoding). quarry's `onQuery` uses it ([../EXECUTION.md](../EXECUTION.md#onquery-events)). Unset, nothing is timed.
- **`telemetry: { tracer, queryText? }`** ([telemetry.ts](telemetry.ts)): each statement becomes an OpenTelemetry client span, described below.
- **`captureStack`**: appends the issuing code's stack to errors ("--- query issued at ---"). Off by default because quarry's executor does its own.

With neither `telemetry` nor `captureStack` set, `query`, `queryThen`, `queryGroup`, `simpleQuery` and `copyFrom` go straight to their implementation; with either, they go through `#observe`, which takes the stack (an `Error` made before the query is issued), starts the span, and finishes both when the result settles.

### Spans

<a id="spans"></a>
The connection option `telemetry` takes a `tracer` (`TracerLike`: `startSpan(name, { kind, attributes })` returning a `SpanLike` with `setAttribute`, `setStatus`, `recordException` and `end`). These are the parts of OpenTelemetry's `Tracer` and `Span` the driver calls, so `trace.getTracer('…')` from `@opentelemetry/api` fits without the driver depending on it. `startQuerySpan` follows OpenTelemetry's database conventions:

| Attribute                   | Value                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| span name                   | the query's `tag` option (quarry's `tag()`), else `` `${operation} ${database}` `` (`SELECT app`)                       |
| span kind                   | client (2)                                                                                                              |
| `db.system.name`            | `postgresql`                                                                                                            |
| `db.namespace`              | the database name                                                                                                       |
| `db.operation.name`         | the SQL's first keyword, upper-cased, after any leading comments (`SELECT`, `INSERT`, `WITH`); `QUERY` if there is none |
| `server.address`            | the host reached (a socket directory for a Unix socket)                                                                 |
| `server.port`               | the port; omitted for a Unix socket                                                                                     |
| `db.query.text`             | the SQL, with its placeholders; omitted with `queryText: false`                                                         |
| `db.query.summary`          | the `tag` option, when there is one                                                                                     |
| `db.response.returned_rows` | on success, the command tag's row count (for `simpleQuery`, the last statement's; for COPY FROM, the rows copied)       |
| `db.response.status_code`   | on a server error, its SQLSTATE                                                                                         |
| `error.type`                | on error, the SQLSTATE of a `PostgresError`, else the error's `name` (`ConnectionError`, `AbortError`, …)               |

On error the span also records the exception and sets an error status with its message. **Parameters are never recorded**: they are where personal data and secrets go, and the SQL with placeholders already says what ran; `queryText: false` drops the SQL too, for applications whose SQL embeds literal values.

What gets a span: `query` (also through `pool.query`; a query with a `statementTimeout` is one span, for its own SQL, not three), each statement of a `queryGroup` (a transaction sends its BEGIN, COMMIT and savepoint statements and its batches through `query` and `queryGroup`, so each statement gets one), `simpleQuery` (one span for the whole script), and `copyFrom`/`copyRows`. Cursors and streams, `copyTo`, `describe` and the catalog lookup aren't spanned.

## Part 11: Sockets

The connection only talks to a `DriverSocket` ([socket.ts](socket.ts)):

```ts
interface DriverSocket {
  readonly encrypted: boolean;
  write(data: Uint8Array): boolean; // false when the buffer is full
  startTls(options: TlsConnectOptions): Promise<void>; // upgrade in place
  peerCertificate(): Uint8Array | undefined; // DER, for channel binding
  pause(): void;
  resume(): void; // read backpressure
  end(): void | Promise<void>;
  destroy(): void;
  onData(h);
  onClose(h);
  onError(h);
  onDrain(h);
}
interface SocketFactory {
  connect(options: SocketConnectOptions): Promise<DriverSocket>;
}
```

### Node: [node-socket.ts](node-socket.ts)

- `node:net` and `node:tls` are loaded **on first use**, through `process.getBuiltinModule` (much cheaper than `import()` at cold start). `node:tls` loads the whole crypto stack (~3 ms), so a plain connection never loads it, and a pool preloads what it will need in the background (`preloadSockets`), as `connect.ts` does while the TCP handshake is in flight.
- `TCP_NODELAY` (`setNoDelay(true)`) on TCP sockets: without it, the operating system may hold small writes back up to ~40 ms hoping to merge them (Nagle's algorithm), which the driver's own batching makes unnecessary.
- TCP keepalive when configured.
- **TLS contexts are cached** (`secureContext`, up to 16, keyed by CA, certificate, key and passphrase): building one parses the certificates, which would otherwise happen per connection.
- `startTls` upgrades the existing socket (after an SSLRequest is accepted) by wrapping it with `tls.connect({ socket })`, moving the event handlers to the TLS socket.
- `peerCertificate()` uses `getPeerX509Certificate().raw` (parsed lazily) rather than `getPeerCertificate()`, which decodes every field.

### Anything else

Pass `socket: { connect(options) { … } }` (a `SocketFactory`) to use your own transport (a test double, an SSH tunnel). `connect` receives `SocketConnectOptions`: the `target` (`{ kind: 'tcp', host, port }` or `{ kind: 'unix', path }`), `tls` for direct TLS (else `undefined`; `startTls` upgrades later), and the keepalive settings. The same factory opens the short connections that carry **cancel requests** ([CANCELLATION.md](CANCELLATION.md#the-cancel-request)), so cancellation goes through your transport too; and with a custom factory, `preloadSockets` loads nothing. `nodeSockets` (the default) is exported, so a factory can wrap it. The walkthrough's captures were made exactly this way ([../WALKTHROUGH.md](../WALKTHROUGH.md)).

## Part 12: Errors

<a id="errors"></a>

```mermaid
classDiagram
    Error <|-- DriverError
    Error <|-- PostgresError
    DriverError <|-- ProtocolError
    DriverError <|-- ConnectionError
    DriverError <|-- DecodeError
    DriverError <|-- AbortError
    DriverError <|-- UndefinedParameterError
    DriverError <|-- TransactionRolledBack
    PostgresError <|-- IntegrityConstraintViolation
    IntegrityConstraintViolation <|-- UniqueViolation
    IntegrityConstraintViolation <|-- ForeignKeyViolation
    IntegrityConstraintViolation <|-- NotNullViolation
    IntegrityConstraintViolation <|-- CheckViolation
    IntegrityConstraintViolation <|-- ExclusionViolation
    PostgresError <|-- SerializationFailure
    PostgresError <|-- DeadlockDetected
    PostgresError <|-- LockNotAvailable
    PostgresError <|-- ReadOnlyTransaction
    PostgresError <|-- TransactionTimeout
    PostgresError <|-- IdleInTransactionTimeout
    PostgresError <|-- UndefinedTable
    PostgresError <|-- UndefinedColumn
    PostgresError <|-- QueryCanceled
```

[errors.ts](errors.ts):

- **`PostgresError`**: an error the **server** reported (ErrorResponse). It carries every field the server sent (`severity`, `code` (the five-character **SQLSTATE**, e.g. `23505`), `detail`, `hint`, `position`, `internalPosition`, `internalQuery`, `where`, `schema`, `table`, `column`, `dataType`, `constraint`, `file`, `line`, `routine`), all of them in `fields` keyed by protocol code, and the failing `query` (`ErrorQuery`: `{ sql, params, tag? }`, the `tag` being the query's label), both **non-enumerable** so logs don't print parameter values. `isRetryable` is true for `40001` and `40P01`; `isFatal` for FATAL/PANIC (the server ends the session).
- `postgresError(fields, query)` picks the subclass by SQLSTATE (the `classes` table), falling back to `IntegrityConstraintViolation` for any class-23 code, then to `PostgresError`. `IntegrityConstraintViolation.columns` reads the column from the `column` field, or parses the columns from a `Key (a, b)=(…)` detail (unquoting quoted names).

| Class                          | SQLSTATE          | When                                                                                          |
| ------------------------------ | ----------------- | --------------------------------------------------------------------------------------------- |
| `IntegrityConstraintViolation` | any other `23xxx` | a constraint check failed; base of the five below                                             |
| `UniqueViolation`              | `23505`           | a unique or primary-key constraint                                                            |
| `ForeignKeyViolation`          | `23503`           | a foreign-key constraint                                                                      |
| `NotNullViolation`             | `23502`           | a NOT NULL constraint                                                                         |
| `CheckViolation`               | `23514`           | a CHECK constraint                                                                            |
| `ExclusionViolation`           | `23P01`           | an exclusion constraint                                                                       |
| `SerializationFailure`         | `40001`           | a serializable transaction conflicted with another; retry it                                  |
| `DeadlockDetected`             | `40P01`           | this transaction was chosen to abort a deadlock; retry it                                     |
| `LockNotAvailable`             | `55P03`           | a lock could not be taken (`nowait`, `lock_timeout`)                                          |
| `ReadOnlyTransaction`          | `25006`           | a write in a read-only transaction                                                            |
| `TransactionTimeout`           | `25P04`           | the transaction ran past `transaction_timeout`; the server ends the session                   |
| `IdleInTransactionTimeout`     | `25P03`           | idle in a transaction past `idle_in_transaction_session_timeout`; the server ends the session |
| `UndefinedTable`               | `42P01`           | the table does not exist                                                                      |
| `UndefinedColumn`              | `42703`           | the column does not exist                                                                     |
| `QueryCanceled`                | `57014`           | the statement was canceled, with a `reason` (below)                                           |

- **`QueryCanceled`** (`57014`) has a `reason` (`CancelReason`): `'abort'` or `'timeout'` when this client asked for the cancel (the op recorded `canceledBy`), otherwise `'statement_timeout'` (the message says so) or `'user'` ([CANCELLATION.md](CANCELLATION.md#querycanceled-and-its-reason)).
- **`DriverError`**: the base of every error the driver raises itself, and thrown as such for misuse it detects: a pool that has ended, a released client used again, `max` below 1, an invalid `nested` list, a value a codec can't send (`Cannot send a … as …`), too many callers waiting (`maxWaiting`).
- **`ConnectionError`**: the connection couldn't be opened, TLS or authentication failed on the client's side, or the socket closed. `code` carries the system error (`ECONNREFUSED`, `ENOTFOUND`, …) or the driver's own: `ETIMEDOUT` (the connect timeout, or a pool's `acquireTimeout`), `EAUTHMETHOD` (an authentication method `requireAuth` doesn't allow, or one the driver doesn't implement), `EPROTOCOL` (protocol negotiation failed), `EVERSION` (a server older than PostgreSQL 18).
- **`ProtocolError`**: the server sent bytes that aren't valid protocol. The connection is closed: once framing is lost, nothing after it can be trusted.
- **`DecodeError`**: a value couldn't be decoded (`column` and `typeOid`, never the value; the codec's error is the `cause`). Only that query fails ([Decode errors](#decode-errors)).
- **`AbortError`**: aborted by a signal or a client-side timeout before reaching the server (or while acquiring a connection).
- **`UndefinedParameterError`**: `undefined` as a parameter or inside an array parameter, with its `position` (1-based), the `element` indexes inside an array (the message shows `$2[3]`), and the `sql` (truncated to 500 characters in the message).
- **`TransactionRolledBack`** ([transaction.ts](transaction.ts)): COMMIT answered ROLLBACK ([TRANSACTIONS.md](TRANSACTIONS.md#commit-that-rolled-back)).

## Part 13: The driver knows nothing about quarry

<a id="the-driver-knows-nothing-about-quarry"></a>
Nothing in `src/driver/` imports from the rest of `src/`. It is exported as its own entry point (`quarry/driver`), with its own options and types, and could be published alone. quarry's integration (decoding to its column types, `onQuery`, call-site stacks, mapping options) is entirely in [../driver-executor.ts](../driver-executor.ts). The only concepts the builder borrowed from the driver are codecs and the registry, which the driver owns.

This keeps the driver testable against other drivers' test suites (`pnpm test:compat` runs node-postgres's and postgres.js's suites through shims) and benchmarkable on its own, and keeps the builder free of protocol details.

## Part 14: Testing

- `pnpm test` starts a throwaway PostgreSQL cluster when PostgreSQL is installed ([test/driver/setup/](../../test/driver/setup/)): TLS, a role per authentication method, and PgBouncer. Integration tests are in [test/driver/integration/](../../test/driver/integration/); without PostgreSQL they skip.
- [test/driver/fake-server.test.ts](../../test/driver/fake-server.test.ts) scripts a fake server over a real TCP socket, for behaviour a real server won't produce on demand (protocol negotiation, odd replies). [test/driver/helpers/backend.ts](../../test/driver/helpers/backend.ts) encodes server messages.
- Unit tests: protocol framing, the reader, codecs, rows, config, the queue.
- `pnpm test:compat` runs node-postgres's and postgres.js's own suites against this driver ([test/driver/compat/](../../test/driver/compat/)); `expectations.ts` lists every test allowed to fail and why.

## Decisions

Why the driver is built this way. Each links to its full entry (what it is, why, the alternatives, the cost, measured impact) in [DECISIONS.md](DECISIONS.md):

- [Our own wire-protocol implementation, with no dependencies](DECISIONS.md#our-own-wire-protocol-implementation-with-no-dependencies): full control over allocation, pipelining and binary formats.
- [Requests as operations in one FIFO queue](DECISIONS.md#requests-as-operations-in-one-fifo-queue): the protocol answers in order, so a FIFO of ops is the whole concurrency model.
- [The driver knows nothing about the query builder](DECISIONS.md#the-driver-knows-nothing-about-the-query-builder): testable, benchmarkable and publishable alone.
- [Pipelining, with one Sync per query](DECISIONS.md#pipelining-with-one-sync-per-query): the throughput of pipelining without its usual failure coupling.
- [Coalesced writes: one write per microtask](DECISIONS.md#coalesced-writes-one-write-per-microtask): everything issued in one tick goes out in one `write`.
- [Backpressure: 64 KiB chunks, and queued ops stay unencoded](DECISIONS.md#backpressure-64-kib-chunks-and-queued-ops-stay-unencoded): memory is bounded by the socket, not by queued work.
- [Prepared statements by default, named per connection](DECISIONS.md#prepared-statements-by-default-named-per-connection): each distinct statement is parsed and planned once per connection.
- [Binary only after describe](DECISIONS.md#binary-only-after-describe): no column is requested in a format before its type is known.
- [Zero-copy reads: messages decoded in place](DECISIONS.md#zero-copy-reads-messages-decoded-in-place): and [generated row decoders](DECISIONS.md#generated-monomorphic-row-decoders): the most frequent work is the cheapest.
- [Text decoded with `Buffer#utf8Slice`](DECISIONS.md#text-decoded-with-bufferutf8slice): the native call without `toString`'s checks, on every text value.
- [Nested objects built by the generated row decoder](DECISIONS.md#nested-objects-built-by-the-generated-row-decoder): a joined table's columns as one object, built while the row is decoded.
- [Retry a stale statement once, unprepared](DECISIONS.md#retry-a-stale-statement-once-unprepared): a schema change under a cached statement costs one retry, not an error.
- [Allocation cuts for the small-query tail](DECISIONS.md#allocation-cuts-for-the-small-query-tail): less garbage, fewer GC pauses in the tail.
- [The shared promise executor lets go of each query's resolvers](DECISIONS.md#the-shared-promise-executor-lets-go-of-each-querys-resolvers): the allocation cut without keeping the latest result alive.
- [Node only](DECISIONS.md#node-only): the driver runs on Node only, so it has one socket adapter and no per-runtime code paths.
- [One small socket interface](DECISIONS.md#one-small-socket-interface) (superseded in part by Node only): the interface stays, for custom transports and test doubles.
- [PostgreSQL 18 or later only](DECISIONS.md#postgresql-18-or-later-only): no compatibility code for old servers.
- [Detect poolers at login rather than configure them](DECISIONS.md#detect-poolers-at-login-rather-than-configure-them): what `capabilities.pgbouncer` is for.
- [OpenTelemetry spans through a structural tracer, without parameters](DECISIONS.md#opentelemetry-spans-through-a-structural-tracer-without-parameters): spans without a dependency, at no cost when unset, never with parameters.
- [Server notices go to listeners, and a listener can't break the connection](DECISIONS.md#server-notices-go-to-listeners-and-a-listener-cant-break-the-connection): messages that answer no request never reach an op.
- [Errors carry everything and leak nothing](DECISIONS.md#errors-carry-everything-and-leak-nothing): every server field kept; parameters stay out of logs.
- [Typed error classes per SQLSTATE](DECISIONS.md#typed-error-classes-per-sqlstate): `instanceof UniqueViolation` rather than comparing codes.
- [A decode failure fails one query, not the connection](DECISIONS.md#a-decode-failure-fails-one-query-not-the-connection): the protocol is intact, so only that query's values were unreadable.

## Glossary

**Backend**: the server process serving one connection.

**Backpressure**: the signal to stop producing data until the consumer catches up.

**Command tag**: the server's summary of a finished statement (`SELECT 3`, `UPDATE 1`).

**Connection**: one socket and session with the server.

**Event loop / microtask**: how JavaScript schedules callbacks; a microtask runs right after the current code, before I/O callbacks.

**Exclusive op**: an operation that keeps talking after it is written (cursor, COPY), so nothing else may be written until it completes.

**GC (garbage collection)**: the runtime reclaiming unused memory; frequent small allocations cause pauses.

**Latency / throughput**: time per request / requests per second.

**Message**: one unit of the wire protocol: a type byte, a length, a body.

**Notice**: a warning or informational message from the server (NoticeResponse), delivered to `onNotice` listeners ([Notices and notifications](#notices-and-notifications)).

**Notification**: a `NOTIFY` delivered on a channel the session listens to (NotificationResponse).

**Op**: the driver's object for one queued request ([ops.ts](ops.ts)).

**PgBouncer**: a connection pooler (proxy) commonly placed in front of Postgres.

**Pipelining**: sending requests without waiting for earlier answers.

**Portal**: a statement bound to its parameter values, ready to execute.

**Prepared statement**: SQL parsed and planned once, kept under a name for repeated execution.

**Round trip**: a request and its answer; the unit of network latency.

**Session**: the state a connection carries (settings, prepared statements, an open transaction).

**Span**: one timed operation in a trace (OpenTelemetry); the driver makes one per statement when `telemetry` is set ([Spans](#spans)).

**SQLSTATE**: Postgres's five-character error code (`23505` unique violation, `40001` serialization failure).

**Sync**: the message that ends a pipeline segment; the server answers it with ReadyForQuery, and after an error skips to it.

**TLS**: the encryption layer under HTTPS, also used by Postgres connections.

**Unix-domain socket**: a socket addressed by a file path, for processes on the same machine.
