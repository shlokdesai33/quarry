# One query, end to end

This document follows a single query from the line of TypeScript that builds it to the bytes that cross the network, the server's reply, the decoding of each value, and back to the typed row your code receives. Every SQL string, every byte and the generated decoder source shown here were captured by running the program below against PostgreSQL 18.6, through a small TCP proxy that logged each chunk in both directions, so nothing was edited by hand except where a section says so (the host name, and lines elided with `…`).

It links to the detailed guide for each stage. If a word is new, the [Glossary](#glossary) at the end and the glossaries in [ARCHITECTURE.md](ARCHITECTURE.md#glossary) and [driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#glossary) define it.

## Contents

- [The program](#the-program)
- [Stage 1: building the query (no I/O)](#stage-1-building-the-query-no-io)
- [Stage 2: the result shape and compiling](#stage-2-the-result-shape-and-compiling)
- [Stage 3: `execute()` hands over to the executor](#stage-3-execute-hands-over-to-the-executor)
- [Stage 4: the pool opens a connection](#stage-4-the-pool-opens-a-connection)
- [Stage 5: startup on the wire](#stage-5-startup-on-the-wire)
- [Stage 6: the type catalog](#stage-6-the-type-catalog)
- [Stage 7: encoding and queueing the query](#stage-7-encoding-and-queueing-the-query)
- [Stage 8: the request bytes](#stage-8-the-request-bytes)
- [Stage 9: the server's reply](#stage-9-the-servers-reply)
- [Stage 10: reading and decoding](#stage-10-reading-and-decoding)
- [Stage 11: finishing, and back to your code](#stage-11-finishing-and-back-to-your-code)
- [The second run: cached statement, binary results](#the-second-run-cached-statement-binary-results)
- [Closing](#closing)
- [Variations](#variations)
- [Decisions](#decisions)
- [Glossary](#glossary)

## The program

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

const db = database({
  host: 'db.internal',
  user: 'app',
  database: 'app',
  max: 1,
});

const user = await db
  .selectFrom(users)
  .where('users.email', 'ada@example.com')
  .select(['users.id', 'users.name', 'users.createdAt'])
  .expectOne()
  .execute();
// user: { id: number; name: string | null; createdAt: Date }
// → { id: 1, name: 'Ada Lovelace', createdAt: 2026-10-17T03:51:00.000Z }
```

(For the capture, the connection went to the proxy on `127.0.0.1` with `ssl: 'disable'`, so the bytes are readable, and the server trusted the role without a password; [Variations](#variations) describes what TLS and a password add. The table held one row, inserted beforehand.)

## Stage 1: building the query (no I/O)

Each call returns a new immutable builder ([QUERIES.md](QUERIES.md)):

1. **`defineTable`** makes a `Table<'users', …>`. Each column object knows its `DataType` (`integer`, `text`, `timestamptz`) and through it the driver codec it uses (`codecs.int4`, `codecs.text`, `codecs.timestamptz`, from [kind-codecs.ts](kind-codecs.ts)). `createdAt` records `columnName: 'created_at'`. ([column/README.md](column/README.md))
2. **`database({...})`** creates a driver `Pool` (no connection yet) and a `DriverExecutor` over it, owning the pool ([EXECUTION.md](EXECUTION.md#database)).
3. **`db.selectFrom(users)`** → `SelectQueryBuilder<[typeof users], Record<never, never>>`. Its state: `tables: [users]`, `from: { name: 'users', alias: undefined }`, an empty `WhereBuilder`, the executor.
4. **`.where('users.email', 'ada@example.com')`**: the `(column, value)` form. `WhereBuilder.add` calls `compare(eb.ref('users.email'), '=', 'ada@example.com')` ([EXPRESSIONS.md](EXPRESSIONS.md#lowering-a-comparison-comparison)). `eb.ref` resolves the reference to `{ kind: 'reference', table: 'users', column: 'email' }` with the column's `DataType<'text'>`, a node made once per table and column and shared by every query (`resolveColumn` in [expression-builder.ts](expression-builder.ts)); the value becomes `{ kind: 'value', value: 'ada@example.com', codec: codecs.text }`. At the type level, the value had to be a `string` (the column's type) and not `null`.
5. **`.select([...])`**: `selectionNodes` ([row.ts](row.ts)) takes each reference's shared selection, `{ expression: <reference node>, alias: 'id' | 'name' | 'createdAt', codec }`, made with the reference node. At the type level, the row type `O` becomes `{ id: number; name: string | null; createdAt: Date }`, read from each column's phantom `$select` ([TYPES.md](TYPES.md#part-6-result-row-types)).

Nothing has touched the network.

## Stage 2: the result shape and compiling

**`.expectOne()`** applies a result shape ([QUERIES.md](QUERIES.md#result-shapes)). It compiles the builder's node tree right away (`compile(this.toNode())`, [COMPILER.md](COMPILER.md)) and wraps it in a `Query<O>` with the `expectOne` shape: keep at most 2 rows; no row → `NoRowError`, several → `TooManyRowsError`.

The compiled query (`q.toSQL()`):

```
sql:          select "users"."id" as "id", "users"."name" as "name", "users"."created_at" as "createdAt" from "users" where "users"."email" = $1
params:       ['ada@example.com']
paramCodecs:  [text]
resultCodecs: [int4, text, timestamptz]
```

Notice:

- Every identifier is quoted; `createdAt` is selected from `"created_at"` and aliased back to `"createdAt"`, so rows come back keyed by your TypeScript names.
- The value is not in the SQL: it is parameter `$1`.
- The codecs travel next to the SQL as non-enumerable getters ([COMPILER.md](COMPILER.md#input-and-output)).

## Stage 3: `execute()` hands over to the executor

`Query.execute()` ([query.ts](query.ts)) calls `executor.execute(compiled, { keepRows: 2 })` (the shape's read options merged with yours) and, when it resolves, the shape's `read`.

`DriverExecutor.execute` ([driver-executor.ts](driver-executor.ts), [EXECUTION.md](EXECUTION.md#execute-step-by-step)):

1. `#shared(query)`: over a pool, the query can share the pool's connections with other callers' queries, pipelined, so it gets the pool back. Only a hand-written statement that changes the session or transaction state (`begin`, `set`, `listen`, …) would take a connection of its own; a compiled select like this one is never checked against that list (`isDataStatement`, [COMPILER.md](COMPILER.md#data-statements-isdatastatement)). A `timeout` would share too: the driver sends it with its query under one Sync.
2. `#prepare(pool)`: the first time, `pool.loadTypes()` loads the type catalog (Stage 6), and that needs a connection (Stage 4).
3. `pool.query(sql, params, { codecs: quarryRegistry, rowMode: 'object', keepRows: 2, paramCodecs: [text], resultCodecs: [int4, text, timestamptz] })` (`#queryOptions` fills in only the options that are set): the pool picks a connection and queues the query on it (Stage 7).

Nothing is captured up front for the error's call-site stack: if the query fails, the `catch` in `execute` captures it there (`issuedAt`), where the engine's async stack trace still lists the caller ([EXECUTION.md](EXECUTION.md#execute-step-by-step)).

## Stage 4: the pool opens a connection

The first thing that needs a connection is the catalog lookup. `pool.loadTypes()` ([driver/pool.ts](driver/pool.ts), [driver/POOL.md](driver/POOL.md)) runs it on a shared connection (`#withShared`): the pool has no connection to claim yet, so the lookup waits in line for a pipeline slot (`#waitShared`), and `#serveWaiters`, seeing room under `max`, opens one with `openConnection(config)` ([driver/connect.ts](driver/connect.ts), [driver/auth/README.md](driver/auth/README.md)):

- The configuration was resolved once when the pool was created (`resolveConfig`): host `db.internal`, port 5432, user `app`, database `app`, `sslmode` (here `disable`; by default `verify-full` for a remote host and `prefer` for a local one).
- `connectHost` tries the host; its `attempt` opens a TCP socket through the socket factory (Node's `net` by default, [driver/node-socket.ts](driver/node-socket.ts)), with `TCP_NODELAY` (`setNoDelay(true)`) so small writes aren't delayed.
- `Connection.open(socket, config, { host, version, cancel })` runs the startup handshake.

Once it is open, the pool hands the new connection to the waiting lookup.

## Stage 5: startup on the wire

The client speaks first. The **StartupMessage** has no type byte, just a length and a protocol version ([driver/protocol/README.md](driver/protocol/README.md)):

```
C> 00 00 00 47 00 03 00 02 75 73 65 72 00 61 70 70  ...G....user.app
C> 00 64 61 74 61 62 61 73 65 00 61 70 70 00 63 6c  .database.app.cl
C> 69 65 6e 74 5f 65 6e 63 6f 64 69 6e 67 00 55 54  ient_encoding.UT
C> 46 38 00 44 61 74 65 53 74 79 6c 65 00 49 53 4f  F8.DateStyle.ISO
C> 2c 20 4d 44 59 00 00                             , MDY..
```

| Bytes                     | Meaning                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `00 00 00 47`             | length: 71 bytes, counting these four                                  |
| `00 03 00 02`             | protocol version 3.2 (major 3 in the high 16 bits, minor 2 in the low) |
| `user\0app\0`             | parameter `user` = `app` (strings end with a zero byte)                |
| `database\0app\0`         | `database` = `app`                                                     |
| `client_encoding\0UTF8\0` | text is UTF-8 both ways                                                |
| `DateStyle\0ISO, MDY\0`   | dates printed as `2026-10-17`, so text parsing is predictable          |
| `00`                      | end of parameters                                                      |

The server's answer, one read of 491 bytes (a role with a password would get an authentication request first; this server trusts it). Most of it is ParameterStatus messages, elided in the middle here:

```
S< 52 00 00 00 08 00 00 00 00 53 00 00 00 17 69 6e  R........S....in
S< 5f 68 6f 74 5f 73 74 61 6e 64 62 79 00 6f 66 66  _hot_standby.off
S< 00 53 00 00 00 19 69 6e 74 65 67 65 72 5f 64 61  .S....integer_da
   … (TimeZone, IntervalStyle, search_path, …, client_encoding) …
S< 00 34 73 65 72 76 65 72 5f 76 65 72 73 69 6f 6e  .4server_version
S< 00 31 38 2e 36 20 28 55 62 75 6e 74 75 20 31 38  .18.6 (Ubuntu 18
S< 2e 36 2d 31 2e 70 67 64 67 32 34 2e 30 34 2b 32  .6-1.pgdg24.04+2
S< 29 00 53 00 00 00 19 73 65 72 76 65 72 5f 65 6e  ).S....server_en
S< 63 6f 64 69 6e 67 00 55 54 46 38 00 4b 00 00 00  coding.UTF8.K...
S< 28 00 00 25 94 2e ae 8a 0c 99 92 40 0d f4 85 09  (..%.......@....
S< 4c 1b bf 03 a1 b9 27 ae 5f 22 c6 9b 32 55 4f 3c  L.....'._"..2UO<
S< d7 0a a9 0a 81 5a 00 00 00 05 49                 .....Z....I
```

| Message                      | Bytes                                                                   | Meaning                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AuthenticationOk             | `52` `00000008` `00000000`                                              | type `R`, length 8, code 0: authenticated                                                                                                                                         |
| ParameterStatus (15 of them) | `53` `00000017` `in_hot_standby\0` `off\0`                              | type `S`: a run-time setting the server reports, one message each: `in_hot_standby`, `integer_datetimes`, `TimeZone` (`UTC`), `DateStyle`, `client_encoding`, `server_version`, … |
|                              | `53` `00000034` `server_version\0` `18.6 (Ubuntu 18.6-1.pgdg24.04+2)\0` | the version string, as the packager built it                                                                                                                                      |
| BackendKeyData               | `4b` `00000028` `00002594` 32 bytes                                     | type `K`, length 40: backend process id 9620 and its secret key, used to cancel queries later. Protocol 3.2 lets the key be longer than 4 bytes; PostgreSQL 18 sends 32           |
| ReadyForQuery                | `5a` `00000005` `49`                                                    | type `Z`, status `I` (idle, not in a transaction): ready                                                                                                                          |

After every message except StartupMessage, the format is the same: **one type byte, a four-byte big-endian length (counting itself but not the type byte), then the body**.

`Connection.#dispatch` stores each ParameterStatus in the connection's `parameters` map (`openConnection` reads `in_hot_standby` and `default_transaction_read_only` from it when `targetSessionAttrs` asks for a primary, a standby or a read-only server). On ReadyForQuery, `Connection.#startup` ([driver/connection.ts](driver/connection.ts)) checks the server is PostgreSQL 18 or later (`checkServerVersion`), records its capabilities (`detectCapabilities`: protocol 3.2, no PgBouncer), decides how to name prepared statements (`naming`: `always` here, since nothing rewrites the names), and returns.

## Stage 6: the type catalog

Before its first query, `DriverExecutor` asks the driver to load the **type catalog** once for the pool (`loadTypes()`, [EXECUTION.md](EXECUTION.md#the-type-catalog)): the OIDs of enums, domains and extension types such as pgvector's `vector`, which have no fixed numbers. On the new connection, `Connection.loadTypes` hands the pool's catalog a function that runs the lookup (`#catalogRows`), so a second caller waits for the same lookup instead of sending another. It is a normal query, sent unprepared (`prepare: false`) and read with the driver's default registry; 422 bytes in one write:

```
C> 50 00 00 01 82 00 73 65 6c 65 63 74 20 74 2e 6f  P.....select t.o
   … (the catalog SQL) …
C> 00 00 00 42 00 00 00 0c 00 00 00 00 00 00 00 00  ...B............
C> 44 00 00 00 06 50 00 45 00 00 00 09 00 00 00 00  D....P.E........
C> 00 53 00 00 00 04                                .S....
```

Parse into the **unnamed** statement (`50 … 00` — the name is the empty string), Bind, Describe the portal (`44 … 50 00`: `P` for portal), Execute, Sync. The reply, 227 bytes (here, a database with no custom types), is ParseComplete, BindComplete, RowDescription (8 columns), CommandComplete `SELECT 0`, ReadyForQuery. The catalog is now loaded for every connection of the pool, and the lookup's turn on the connection ends, leaving it idle.

## Stage 7: encoding and queueing the query

Back in `DriverExecutor.execute`, `pool.query` claims the idle connection for the query (`#claimShared`, which takes an idle one before pipelining onto a busy one) and calls `connection.queryThen(sql, params, options, slot.settled)`: `#query` with a callback that ends the query's turn on the connection (Stage 11). In `#query` ([driver/connection.ts](driver/connection.ts), [driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#the-life-of-a-query-on-a-connection)):

1. `encodeParams` ([driver/params.ts](driver/params.ts)): parameter 0 has codec `text`, so `codecs.text.encode('ada@example.com')` → the string `'ada@example.com'`. (`undefined` would throw `UndefinedParameterError` here.)
2. `paramOids`: `codecs.text` has `inferParamType: true`, so its OID is **not** declared: the types array is empty and the server infers `text` from the column. (An `int4` or enum codec would declare its OID.)
3. A `QueryOp` ([driver/ops.ts](driver/ops.ts)) is created with the SQL, the encoded values, the types, and options from `#options` (`prepare: true`, `binary: true`, `keepRows: 2`, the registry, the result codecs). The pool's `slot.settled` becomes the op's `onDone`.
4. `#enqueue` pushes it onto the connection's queue and schedules a **flush** in a microtask: anything else queued in the same tick would go out in the same socket write. The catalog is loaded, so nothing is queued behind it to load one (`#loadTypesAfter`).
5. `#flush` calls `op.write(ctx)`. The statement cache has no entry for this SQL, so `ctx.statement(sql, [], named)` creates one named `q1` (`q` and a per-connection count), marked `unwritten`; the cache is keyed by the SQL string, and the types are compared. Because it's new, `write` emits Parse **and** Describe(statement), then Bind with **text** results (no column's type is known yet, so no binary format is asked for), Execute and Sync, all into one buffer.

## Stage 8: the request bytes

One socket write of 199 bytes:

```
C> 50 00 00 00 8c 71 31 00 73 65 6c 65 63 74 20 22  P....q1.select "
C> 75 73 65 72 73 22 2e 22 69 64 22 20 61 73 20 22  users"."id" as "
C> 69 64 22 2c 20 22 75 73 65 72 73 22 2e 22 6e 61  id", "users"."na
C> 6d 65 22 20 61 73 20 22 6e 61 6d 65 22 2c 20 22  me" as "name", "
C> 75 73 65 72 73 22 2e 22 63 72 65 61 74 65 64 5f  users"."created_
C> 61 74 22 20 61 73 20 22 63 72 65 61 74 65 64 41  at" as "createdA
C> 74 22 20 66 72 6f 6d 20 22 75 73 65 72 73 22 20  t" from "users"
C> 77 68 65 72 65 20 22 75 73 65 72 73 22 2e 22 65  where "users"."e
C> 6d 61 69 6c 22 20 3d 20 24 31 00 00 00 44 00 00  mail" = $1...D..
C> 00 08 53 71 31 00 42 00 00 00 21 00 71 31 00 00  ..Sq1.B...!.q1..
C> 00 00 01 00 00 00 0f 61 64 61 40 65 78 61 6d 70  .......ada@examp
C> 6c 65 2e 63 6f 6d 00 00 45 00 00 00 09 00 00 00  le.com..E.......
C> 00 00 53 00 00 00 04                             ..S....
```

| Message      | Bytes                                                                         | Meaning                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Parse**    | `50` `0000008c` `q1\0` `select … $1\0` `0000`                                 | type `P`, length 140: prepare the SQL as statement `q1`; 0 parameter types declared (the server infers them)                                                                  |
| **Describe** | `44` `00000008` `53` `q1\0`                                                   | type `D`: describe statement (`S`) `q1`: its parameter types and result columns                                                                                               |
| **Bind**     | `42` `00000021` `00` `q1\0` `0000` `0001` `0000000f` `ada@example.com` `0000` | type `B`, length 33: portal `""` from statement `q1`; 0 parameter format codes (all text); 1 parameter, 15 bytes long, its value; 0 result format codes (all columns in text) |
| **Execute**  | `45` `00000009` `00` `00000000`                                               | type `E`: run portal `""`, return all rows (0 = no limit)                                                                                                                     |
| **Sync**     | `53` `00000004`                                                               | type `S`: end of this request; reply with ReadyForQuery                                                                                                                       |

The value travels as plain bytes in its own length-prefixed slot: there is no way for it to be read as SQL. The **portal** is the server's name for a bound statement ready to run; quarry always uses the unnamed one (`""`).

## Stage 9: the server's reply

One read of 174 bytes:

```
S< 31 00 00 00 04 74 00 00 00 0a 00 01 00 00 00 19  1....t..........
S< 54 00 00 00 4e 00 03 69 64 00 00 00 40 02 00 01  T...N..id...@...
S< 00 00 00 17 00 04 ff ff ff ff 00 00 6e 61 6d 65  ............name
S< 00 00 00 40 02 00 03 00 00 00 19 ff ff ff ff ff  ...@............
S< ff 00 00 63 72 65 61 74 65 64 41 74 00 00 00 40  ...createdAt...@
S< 02 00 04 00 00 04 a0 00 08 ff ff ff ff 00 00 32  ...............2
S< 00 00 00 04 44 00 00 00 35 00 03 00 00 00 01 31  ....D...5......1
S< 00 00 00 0c 41 64 61 20 4c 6f 76 65 6c 61 63 65  ....Ada Lovelace
S< 00 00 00 16 32 30 32 36 2d 31 30 2d 31 37 20 30  ....2026-10-17 0
S< 33 3a 35 31 3a 30 30 2b 30 30 43 00 00 00 0d 53  3:51:00+00C....S
S< 45 4c 45 43 54 20 31 00 5a 00 00 00 05 49        ELECT 1.Z....I
```

| Message              | Bytes                                                                                          | Meaning                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ParseComplete        | `31` `00000004`                                                                                | `q1` is prepared                                                                                                                                                   |
| ParameterDescription | `74` `0000000a` `0001` `00000019`                                                              | 1 parameter, type OID 25 (`text`): what the server inferred                                                                                                        |
| RowDescription       | `54` `0000004e` `0003` …                                                                       | 3 columns (below)                                                                                                                                                  |
| BindComplete         | `32` `00000004`                                                                                | the portal is bound                                                                                                                                                |
| DataRow              | `44` `00000035` `0003` `00000001 31` `0000000c Ada Lovelace` `00000016 2026-10-17 03:51:00+00` | one row: 3 values, each a 4-byte length then its bytes (text: `1`, `Ada Lovelace`, `2026-10-17 03:51:00+00`). A NULL would be length `ffffffff` (−1) with no bytes |
| CommandComplete      | `43` `0000000d` `SELECT 1\0`                                                                   | the **command tag**: verb and row count                                                                                                                            |
| ReadyForQuery        | `5a` `00000005` `49`                                                                           | done; idle                                                                                                                                                         |

Each column in RowDescription is: a name (`id\0`), the source table's OID (`00004002` = 16386 in this database) and column number (`0001`), the type OID (`00000017` = 23, `int4`), the type's size (`0004`; `ffff` = −1 for variable length), the type modifier (`ffffffff` = none), and the format (`0000` = text):

| Column | Name        | Type OID             | Size | Format |
| ------ | ----------- | -------------------- | ---- | ------ |
| 1      | `id`        | 23 (`int4`)          | 4    | text   |
| 2      | `name`      | 25 (`text`)          | −1   | text   |
| 3      | `createdAt` | 1184 (`timestamptz`) | 8    | text   |

## Stage 10: reading and decoding

The socket's `data` event delivers the 174 bytes to `Connection.#onData` ([driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#reading-replies)):

1. `reader.push(chunk)` keeps the chunk; `reader.nextType()` finds each complete message **without copying it** (it records where the message starts and ends in the chunk) ([driver/protocol/README.md](driver/protocol/README.md#the-reader)).
2. For most messages, `reader.parse()` builds a small message object and `#dispatch` hands it to the operation at the head of the queue, our `QueryOp`, via `op.handle(msg)`:
   - **ParseComplete** marks the cached statement `parsed`.
   - **RowDescription**: the op stores the columns on the cached statement (`statement.fields`), then works out a **result plan** ([driver/results.ts](driver/results.ts) `resultPlan`): for each column, the codec to read it with and the format to ask for. Column 0 expects `int4` and has OID 23: use `codecs.int4`. Column 1 expects `text`, OID 25: `codecs.text`. Column 2 expects `timestamptz`, OID 1184: `codecs.timestamptz`. (An expected codec is used when its OID is the column's, or when it has no OID the server would report, as for a custom type; otherwise the registry's codec for the column's OID reads it.) The plan cached on the statement (`cachedPlan`) asks for binary `int4` and `timestamptz`, for the next run; this result was bound with all columns in text, so `planOf` reads it with a text plan made for it alone. The plan's **row decoder** is built now (`planDecoder`).
3. **DataRow** takes a fast path: `#onData` sees type `0x44` and calls `op.dataRow(bytes, start, end)` directly on the read buffer, with no message object at all. The op calls the decoder.

The row decoder is JavaScript **generated** for this exact column list, formats and row mode, and compiled once per distinct source, shared by every connection ([driver/rows.ts](driver/rows.ts)). For this first run (all text), the generated source, formatted, is:

```js
const c0 = c[0];
const c2 = c[2];
function columns0(b, pos, end, row) {
  let length = 0,
    column = -1;
  try {
    if (pos + 4 > end) throw short();
    length =
      (b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
    pos += 4;
    if (length !== -1) {
      if (length < 0 || pos + length > end) throw invalid();
      column = 0;
      row['id'] = c0.decodeText(utf8(b, pos, pos + length));
      column = -1;
      pos += length;
    }
    if (pos + 4 > end) throw short();
    length =
      (b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
    pos += 4;
    if (length !== -1) {
      if (length < 0 || pos + length > end) throw invalid();
      column = 1;
      row['name'] = utf8(b, pos, pos + length);
      column = -1;
      pos += length;
    }
    // … the same for "createdAt", with c2.decodeText(utf8(b, pos, pos + length)) …
  } catch (error) {
    throw column < 0 ? error : failed(column, error);
  }
  return pos;
}
return function decodeRow(b, start, end) {
  if (end - start < 2 || ((b[start] << 8) | b[start + 1]) !== count)
    throw mismatch();
  const row = { id: null, name: null, createdAt: null };
  let pos = start + 2;
  pos = columns0(b, pos, end, row);
  return row;
};
```

It reads each value's length, decodes its bytes, and stores the result straight into a row object literal of nulls (so every row has the same shape, which keeps V8's property access fast). Columns go in functions of at most 8 (`COLUMNS_PER_FUNCTION`), since compiling one function for many columns costs memory that grows faster than its size. A `text` column has no codec call at all: `utf8` ([driver/protocol/text.ts](driver/protocol/text.ts)) turns the bytes into a string. The `id` value `31` (`"1"`) goes through `codecs.int4.decodeText` (`toInteger`, a base-10 `Number.parseInt`) → `1`; `name` → `'Ada Lovelace'`; `createdAt` (`"2026-10-17 03:51:00+00"`) goes through `codecs.timestamptz.decodeText` (`parseTimestamptz`) → a `Date`. If a decoder threw, the op would fail only this query with a `DecodeError` naming the column, never the value.

The op keeps the row (`keepRows` is 2, and this is the first).

## Stage 11: finishing, and back to your code

- **CommandComplete** `SELECT 1` is stored as the tag.
- **ReadyForQuery** ends the operation: the connection records the transaction status (`I`), and `QueryOp.#finish` parses the tag (`command: 'SELECT'`, `rowCount: 1`) and resolves `{ command, rowCount, rows: [row], fields }`. The connection removes the op from its queue and runs its `onDone` (`#finished`): the pool's `slot.settled` ends the query's turn on the connection (`#done`), and since no other query is on it or waiting, `#releaseSlot` puts it back with the idle ones. That runs before any code awaiting the result does, so the next query issued in the continuation finds the connection idle.
- Back in `DriverExecutor.execute`, if `onQuery` was set, an event is reported with the timings, and the rows, row count and command are returned.
- `Query.execute` calls the shape's `read({ query, table, rows, count: 1 })` (`count` is the larger of the row count and the rows kept, [shape.ts](shape.ts)): one row, `count` not above 1, so it returns the row.

```ts
{ id: 1, name: 'Ada Lovelace', createdAt: 2026-10-17T03:51:00.000Z }
```

Its type, `{ id: number; name: string | null; createdAt: Date }`, was decided in Stage 1 from the columns' codecs; the values match it because the same codecs decoded them.

## The second run: cached statement, binary results

Running the same query again (same `q`, or a new builder producing the same SQL) skips Parse and Describe: the connection's statement cache has `q1`, with its columns already described. So `QueryOp.write` binds with the cached plan's formats: binary for `int4` and `timestamptz` (whose codecs read binary faster), text for `text` ([driver/CODECS.md](driver/CODECS.md#binary-after-describe)). On BindComplete the op reads with that plan, whose decoder is the first one with `c0.decodeBinary(b, pos, pos + length)` and `c2.decodeBinary(b, pos, pos + length)` in place of the `decodeText` calls:

```
C> 42 00 00 00 27 00 71 31 00 00 00 00 01 00 00 00  B...'.q1........
C> 0f 61 64 61 40 65 78 61 6d 70 6c 65 2e 63 6f 6d  .ada@example.com
C> 00 03 00 01 00 00 00 01 45 00 00 00 09 00 00 00  ........E.......
C> 00 00 53 00 00 00 04                             ..S....
```

The Bind now ends with `0003 0001 0000 0001`: 3 result format codes, binary/text/binary. Only 55 bytes this time, and the server doesn't parse or plan the SQL again.

```
S< 32 00 00 00 04 44 00 00 00 2a 00 03 00 00 00 04  2....D...*......
S< 00 00 00 01 00 00 00 0c 41 64 61 20 4c 6f 76 65  ........Ada Love
S< 6c 61 63 65 00 00 00 08 00 03 00 ff f5 2a 91 00  lace.........*..
S< 43 00 00 00 0d 53 45 4c 45 43 54 20 31 00 5a 00  C....SELECT 1.Z.
S< 00 00 05 49                                      ...I
```

The DataRow's values are now:

- `id`: length 4, `00 00 00 01`: a big-endian 32-bit integer, decoded by `binary.int4` without any string parsing → `1`.
- `name`: length 12, the UTF-8 bytes of `Ada Lovelace` (text format, as before).
- `createdAt`: length 8, `00 03 00 ff f5 2a 91 00`: a signed 64-bit count of **microseconds since 2000-01-01 UTC**. `binary.timestamptz` reads it as two 32-bit halves (hi = 196863, lo = 4113207552), computes the milliseconds without going through a number above 2^53 (which would lose precision), and adds the offset between 2000 and 1970: 845,524,260,000,000 µs → 845,524,260,000 ms after 2000 → `Date.UTC(2026, 9, 17, 3, 51)`.

Same row, same types; less work on both sides.

## Closing

`db.close()` ends the owned pool, which closes each connection: the driver sends **Terminate** (`58 00 00 00 04`, type `X`) and ends the socket without waiting for the server to close it.

## Variations

The same journey, with other inputs. The TLS paragraph is described, not captured; the others were captured through the same proxy and server, with each message's type and statement name read from the bytes (see the linked guides for the full byte layouts):

**TLS and a password.** With the default `sslmode` for a remote host (`verify-full`), Stage 5 starts with an **SSLRequest** (8 bytes, code 80877103); the server answers one byte, `S`; the driver upgrades the socket to TLS and verifies the certificate and host name; then the StartupMessage goes over TLS. A password-protected role then gets an AuthenticationSASL request and a SCRAM-SHA-256 exchange (two round trips), usually bound to the TLS channel. [driver/auth/README.md](driver/auth/README.md).

**A transaction.** `db.transaction(async (tx) => { await tx.selectFrom(…)…execute(); … })` sends `begin` **together with the first statement**, under one Sync, in one write:

```
C> Parse("", "begin") Bind Describe(P) Execute  Parse("q2", "select …") Describe(S) Bind Execute  Sync
S< ParseComplete BindComplete NoData CommandComplete(BEGIN)  ParseComplete … DataRow CommandComplete(SELECT 1)  ReadyForQuery(T)
```

`ReadyForQuery(T)` reports "in a transaction". COMMIT goes out when the callback resolves, as a statement of its own (`Parse("q3", "commit") Describe(S) Bind Execute Sync`, prepared like any other, so the next transaction on the connection only binds it). [driver/TRANSACTIONS.md](driver/TRANSACTIONS.md).

**A batch.** `db.batch([q, q2])` writes both queries in one go, each with its own Sync, and gets two ReadyForQuery back. With `{ transaction: true }`, BEGIN and both queries share one Sync, and COMMIT follows with its own in the **same** write, unless a query has a checked shape (`expectOne()`, like `q`): its result is read before committing, so COMMIT goes in a second write once the replies are in. [EXECUTION.md](EXECUTION.md#batches).

```
C> Parse("", "begin") Bind Describe(P) Execute  Bind("q4") Execute  Parse("q5", "select …") Describe(S) Bind Execute  Sync  Bind("q3") Execute Sync
S< ParseComplete BindComplete NoData CommandComplete(BEGIN)  BindComplete DataRow CommandComplete(SELECT 1)  … CommandComplete(SELECT 1) ReadyForQuery(T)  BindComplete CommandComplete(COMMIT) ReadyForQuery(I)
```

**A statement timeout.** `.execute({ timeout: '2s' })` sends three statements under one Sync, in one write: one setting `statement_timeout` with `set_config(…, true)`, the query, and the first one again, restoring the previous value (it is one prepared statement, bound twice). [driver/CANCELLATION.md](driver/CANCELLATION.md#statement-timeouts).

**Concurrent driver queries.** Three `pool.query(…)` calls issued together on a pool of one connection go out in **one** write: Parse, Describe and the first Bind/Execute/Sync, then two more Bind/Execute/Sync groups back to back; their replies come back in order. [driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#pipelining). Builder queries take the same path, and once the pool is full, pipeline onto busy connections: [EXECUTION.md](EXECUTION.md#connections-shared-or-exclusive).

**A schema change.** If someone runs `alter table users alter column id type bigint` between the two runs, the server answers the second run's `Bind("q1") Execute Sync` with `ErrorResponse(0A000 cached plan must not change result type)` and ReadyForQuery; outside a transaction, the driver drops `q1` and retries once unprepared (`Parse("", …) Bind Describe(P) Execute Sync`), and the `id` column (now OID 20) is read with the registry's codec for its new type: with quarry's registry, an `int8` comes back as the string `'1'`. [driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#the-prepared-statement-cache).

## Decisions

The choices this journey runs into, each with its reasons and costs:

- [Plain queries share the pool's pipelined connections](DECISIONS.md#plain-queries-share-the-pools-pipelined-connections): why Stage 3 hands the query to `pool.query`, and what takes a connection of its own.
- [Errors carry the query (hidden) and the code awaiting it](DECISIONS.md#errors-carry-the-query-hidden-and-the-code-awaiting-it): why nothing is captured for a query that succeeds.
- [The type catalog loaded before the first query](DECISIONS.md#the-type-catalog-loaded-before-the-first-query): Stage 6.
- [Columns resolved and quoted once per table](DECISIONS.md#columns-resolved-and-quoted-once-per-table) and [SQL rendered through a trie of its pieces](DECISIONS.md#sql-rendered-through-a-trie-of-its-pieces): why building and compiling the query cost so little.
- [PostgreSQL 18 or later only](driver/DECISIONS.md#postgresql-18-or-later-only), [Ask for protocol 3.2, accept 3.0, retry once, remember who refused](driver/DECISIONS.md#ask-for-protocol-32-accept-30-retry-once-remember-who-refused) and [`TCP_NODELAY`](driver/DECISIONS.md#tcp_nodelay): Stages 4 and 5.
- [Coalesced writes: one write per microtask](driver/DECISIONS.md#coalesced-writes-one-write-per-microtask) and [Pipelining, with one Sync per query](driver/DECISIONS.md#pipelining-with-one-sync-per-query): Stage 7.
- [Prepared statements by default, named per connection](driver/DECISIONS.md#prepared-statements-by-default-named-per-connection), [Exact parameter OIDs, except for text-like types](driver/DECISIONS.md#exact-parameter-oids-except-for-text-like-types) and [Binary only after describe](driver/DECISIONS.md#binary-only-after-describe): Stage 8 and the second run.
- [DataRow fast path: no message objects for rows](driver/DECISIONS.md#datarow-fast-path-no-message-objects-for-rows), [Generated, monomorphic row decoders](driver/DECISIONS.md#generated-monomorphic-row-decoders) and [Text decoded with `Buffer#utf8Slice`](driver/DECISIONS.md#text-decoded-with-bufferutf8slice): Stage 10.
- [Retry a stale statement once, unprepared](driver/DECISIONS.md#retry-a-stale-statement-once-unprepared) and [`db.batch` framing: one write, with COMMIT pipelined unless results are checked](driver/DECISIONS.md#dbbatch-framing-one-write-with-commit-pipelined-unless-results-are-checked): Variations.

## Glossary

- **Portal**: the server's name for a bound statement ready to run. quarry always binds the unnamed one (`""`).
- **Prepared statement**: SQL the server has parsed and planned under a name (`q1`), so later runs only send Bind and Execute. Each connection caches its own.
- **Result plan**: for each column of a result, the codec that reads it and the format (text or binary) it is asked for in.
- **Row decoder**: the function generated for a result plan that turns one DataRow into one row.
- **Sync**: the message that ends a request; the server answers it with ReadyForQuery, and an error skips the rest of the request up to it.
- **Round trip**: a request written and its reply read back.
- **Shared connections**: the pool's connections that several callers' queries use at once, pipelined, as against one reserved by `acquire()`.
- **Pipeline slot**: one query's turn on a shared connection, from when it is claimed until its `onDone` runs.
- **Catalog**: the OIDs of the types that have no fixed number (enums, domains, extension types), looked up once per pool.
- **Command tag**: the verb and row count in CommandComplete (`SELECT 1`).
