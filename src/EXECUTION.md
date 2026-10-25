# Running queries: `database()`, executors and the driver

This guide covers what happens after a query is built: how `database()` connects the builder to the driver, how a compiled query is handed over, which codecs the driver is told to use, which connection it runs on, and how batches, transactions, streams, `describe()`, timeouts, `onQuery` events, OpenTelemetry spans, errors and closing work from the builder's side.

Files: [database.ts](database.ts), [executor.ts](executor.ts), [driver-executor.ts](driver-executor.ts), [batch.ts](batch.ts), [query.ts](query.ts), [shape.ts](shape.ts), [kind-codecs.ts](kind-codecs.ts). The driver's side of each topic is linked as it comes up.

## Contents

- [`database()`](#database)
- [The `Executor` interface](#the-executor-interface)
- [`DriverExecutor`](#driverexecutor)
- [How the builder picks codecs](#how-the-builder-picks-codecs)
- [`execute`, step by step](#execute-step-by-step)
- [Connections: shared or exclusive](#connections-shared-or-exclusive)
- [Batches](#batches)
- [Transactions](#transactions)
- [Streaming](#streaming)
- [`describe()`](#describe)
- [Timeouts and cancellation](#timeouts-and-cancellation)
- [`onQuery` events](#onquery-events)
- [OpenTelemetry spans and tags](#opentelemetry-spans-and-tags)
- [Errors](#errors)
- [Closing](#closing)
- [Decisions](#decisions)
- [Glossary](#glossary)

## `database()`

```ts
const db = database(process.env.DATABASE_URL); // owns a pool
const db = database({ connectionString: url, max: 20 }, { onQuery: log }); // owns a pool
const db = database(pool); // a Pool, PoolClient or Connection you manage
```

[database.ts](database.ts):

```ts
export function database(
  source: DatabaseSource,
  options: DatabaseOptions = {},
): Database {
  const executor = isDriverSource(source)
    ? new DriverExecutor(source, options)
    : new DriverExecutor(createPool(source), options, true);
  return databaseWith(executor);
}
```

- A **string** or **pool options** make a new `Pool` that the database **owns** (`owned = true`): `db.close()` ends it. Creating a pool opens no connection yet; the first query does ([driver/POOL.md](driver/POOL.md)). The pool options are the driver's (`PoolOptions`, which include every connection option), so driver-level settings such as `max`, `statementCacheSize` or `telemetry` ([below](#opentelemetry-spans-and-tags)) go there, and quarry's own settings go in the second argument.
- A driver `Pool`, `PoolClient` or `Connection` is used as is, and `db.close()` leaves it alone. (`isDriverSource` also accepts a driver `Transaction`, which is how a transaction's executor is made; `database()` is never given one in practice.)
- `databaseWith(executor)` (internal) builds the `Database` object over **any** executor; tests use it with a fake ([test/helpers/executor.ts](../test/helpers/executor.ts)).

The `Database` object is a plain object of functions (`queries(executor)`), each starting a builder or an operation with that executor: `selectFrom`, `insertInto`, `update`, `deleteFrom`, `sql` (a hand-written statement, [QUERIES.md](QUERIES.md#whole-statements-dbsql)), `batch`, `transaction`, `verify`, plus `close` and `[Symbol.asyncDispose]` (so `await using db = database(url)` closes it at the end of the scope). Inside a transaction, `transactionWith(tx)` makes the same object over the transaction's executor, plus `afterCommit`, `afterRollback` and `setLocal`, and without `close`.

`DatabaseOptions` ([driver-executor.ts](driver-executor.ts)):

| Option      | Default          | Meaning                                                                                  |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `codecs`    | quarry's         | codecs for result columns no query types ([below](#how-the-builder-picks-codecs))        |
| `catalog`   | `true`           | look up named types (enums, `vector`, custom types) before the first query               |
| `onQuery`   |                  | called once per query with its SQL, timings, row count, error ([below](#onquery-events)) |
| `callsites` | `true`           | append the stack of the code awaiting a failed query to its error ([below](#errors))     |
| `prepare`   | the connection's | use cached prepared statements                                                           |

The options object is kept as given and read per query; a transaction's executor shares it (and the registry) with the database's.

## The `Executor` interface

[executor.ts](executor.ts) is the whole contract between the builder and whatever runs its queries:

```ts
interface Executor {
  execute(
    query: CompiledQuery,
    options?: ExecuteOptions,
  ): Promise<ExecuteResult>;
  stream(
    query: CompiledQuery,
    options?: StreamOptions,
  ): AsyncIterable<readonly unknown[]>;
  describe(query: CompiledQuery): Promise<QueryDescription>;
  batch(
    queries: readonly BatchQuery[],
    options?: ExecuteBatchOptions,
  ): Promise<readonly PromiseSettledResult<ExecuteResult>[]>;
  transaction<T>(
    fn: (executor: TransactionExecutor) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  close(): Promise<void>;
}
interface ExecuteResult {
  rows: readonly unknown[];
  rowCount: number | null;
  command: string;
}
```

`ExecuteOptions` combines what the caller passed (`RunOptions`: `signal`, `timeout`) with what the result shape needs (`ReadOptions`: `rowMode`, `keepRows`). A `BatchQuery` is a compiled query with its `ReadOptions`; `ExecuteBatchOptions` adds `transaction` (always an options object here: `batchWith` turns `true` into `{}`) and `verify`, the check that must pass before an atomic batch commits ([Batches](#batches)). `describe` resolves to a `QueryDescription` ([below](#describe)). An executor returns rows already decoded; the builder never sees bytes or text.

Not part of the public API: it exists so the builder can be tested without a database and could run on another backend (an HTTP proxy, PGlite) without changing a builder.

## `DriverExecutor`

[driver-executor.ts](driver-executor.ts) implements `Executor` (and `TransactionExecutor`) over a **driver source**: a `Pool`, a `PoolClient`, a `Connection`, or a driver `Transaction`. It:

1. chooses the **codec registry** for untyped columns, once, at construction;
2. loads the **type catalog** before the first query (unless `catalog: false`);
3. turns quarry's options into the driver's `QueryOptions`;
4. over a pool, runs plain queries on its shared, pipelined connections and gives what holds state a connection of its own; otherwise uses the source directly;
5. times queries and reports `onQuery` events;
6. **decorates errors** with the query and the caller's stack.

Everything quarry-specific about running queries lives here. The driver itself knows nothing about quarry ([driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#the-driver-knows-nothing-about-quarry)).

## How the builder picks codecs

A **codec** encodes a parameter for the server and decodes a result value for you ([driver/CODECS.md](driver/CODECS.md)). The builder decides which codec applies where; the driver applies it. Three sources, from most to least specific:

```mermaid
flowchart LR
    subgraph params["Parameters"]
        P1["value compared with / written to a column<br/>→ that column's DataType.codec"]
        P2["eb.val(x, codec)<br/>→ its own codec"]
        P3["eb.val(x) alone, limit<br/>→ none: encoded by JS type, type inferred"]
    end
    subgraph results["Result columns"]
        R1["selected column / typed expression<br/>→ its DataType.codec (resultCodecs)"]
        R2["expression of unknown type<br/>→ the registry, by the column's type OID"]
    end
```

1. **Per parameter: `paramCodecs`.** Every value node records the codec of what it is compared with or written to ([EXPRESSIONS.md](EXPRESSIONS.md#codecs-per-value-codecfor)). `compile` collects them by position. The driver encodes each value with its codec, once, and **declares** the parameter's type (its OID) in the Parse message, except for text-like codecs, which leave the type for the server to infer (`inferParamType`, so a text value against a `citext` or enum column isn't forced to `text`).
2. **Per result column: `resultCodecs`.** Every selection records its codec. The driver reads column _i_ with `resultCodecs[i]` while the column really has that codec's type (checked against the OID in RowDescription), and in that codec's preferred format (binary or text) once the statement's columns are known ([driver/CODECS.md](driver/CODECS.md#binary-after-describe)).
3. **The registry, for everything else.** A column with no expected codec (an expression of unknown type) or of a different type than expected (the schema changed) is read by the codec the **registry** has for its type OID. The registry is chosen once in the constructor:

```ts
this.#registry =
  registry ??
  (options.codecs === undefined || options.codecs.length === 0
    ? quarryRegistry
    : createCodecRegistry(options.codecs, quarryRegistry));
```

`quarryRegistry` ([kind-codecs.ts](kind-codecs.ts)) is the driver's lossless defaults with quarry's choices on top: int8 as a string, timestamptz as a `Date`, ranges as `Range`, pgvector as `number[]`. `options.codecs` override it per type.

Because a column's TypeScript type is derived from its codec ([column/README.md](column/README.md#kindcodecs-the-codec-of-each-factory)), and that same codec decodes it, the types hold at run time without quarry decoding anything itself.

### The type catalog

Some codecs don't know their type's OID in advance: enums (`EnumType`), `codecs.vector`, `defineType` codecs without an `oid`. The driver looks them up in `pg_type` once per pool (the **catalog**, [driver/CODECS.md](driver/CODECS.md#types-looked-up-by-name-the-catalog)). `DriverExecutor.#prepare` calls `loadTypes()` on the pool (shared operations) or the connection (the others) before its first operation, so even the first query declares enum parameters exactly and reads `vector` columns in binary:

```ts
async #prepare(runner: Runner | Pool): Promise<void> {
  if (this.#ready || runner.loadTypes === undefined) return;
  await runner.loadTypes();
  this.#ready = true;
}
```

With `catalog: false` it doesn't wait for it; the driver then loads the catalog in the background behind the first query that needs it (quarry's registry includes `vector`, so in practice that is the first query), and until it arrives such parameters are inferred and such columns read as text.

## `execute`, step by step

Simplified from [driver-executor.ts](driver-executor.ts) (the `onTiming` callbacks and the `#report` arguments are abbreviated):

```ts
async execute(query, options = {}) {
  const observe = this.#options.onQuery !== undefined;
  const start = observe ? performance.now() : 0;
  try {
    const pool = this.#shared(query);                  // the pool, if the query can share its connections
    let result;
    if (pool !== undefined) {
      if (!this.#ready) await this.#prepare(pool);
      result = await pool.query(query.sql, query.params, this.#queryOptions(options, onTiming, query));
    } else {
      result = await this.#run(options.signal, (runner) => {        // a connection of its own
        if (observe) acquired = performance.now();
        return runner.query(query.sql, query.params, this.#queryOptions(options, onTiming, query));
      });
    }
    if (observe) this.#report('execute', query, start, acquired, timing, result.command, result.rowCount ?? result.rows.length);
    return { rows: result.rows, rowCount: result.rowCount, command: result.command };
  } catch (error) {
    decorate(error, query, issuedAt(this.#options)); // the call site, captured now: see Errors
    if (observe) this.#report('execute', …, error);
    throw error;
  }
}
```

`#queryOptions` builds the driver's `QueryOptions` in one object (this runs per query, so it avoids spreads):

| quarry                                     | driver `QueryOptions`            |
| ------------------------------------------ | -------------------------------- |
| registry                                   | `codecs`                         |
| shape's `rowMode` (default `'object'`)     | `rowMode`                        |
| shape's `keepRows`                         | `keepRows`                       |
| `query.paramCodecs` / `query.resultCodecs` | `paramCodecs` / `resultCodecs`   |
| `query.nested` (`nest`)                    | `nested`                         |
| `DatabaseOptions.prepare`                  | `prepare`                        |
| `RunOptions.signal`                        | `signal`                         |
| `RunOptions.timeout`                       | `statementTimeout` (server-side) |
| `onQuery` timing callback                  | `onTiming`                       |
| `query.tag`                                | `tag`                            |

`Query.execute` hands the shape's read options (`keepRows`, `rowMode`) to the executor as they are when `execute()` is given no options, and merges them into a copy otherwise; the shapes without an `err` (`expectOne()`, `takeFirst()`, …) are made once, not per query.

## Connections: shared or exclusive

Over a pool, an operation runs either on the pool's **shared** connections, pipelined with other callers' queries, or on a connection **of its own**, depending on whether it leaves anything on the connection that another caller's query could see:

| Operation                                                                                                                                                    | Over a pool                                              | Why                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `execute()`: a builder query or a `db.sql` statement, with or without a `timeout`                                                                            | shared: `pool.query`                                     | one statement with its own Sync (a `timeout` shares it: [below](#timeouts-and-cancellation)); nothing stays on the connection |
| `describe()`                                                                                                                                                 | shared: `pool.describe`                                  | the same                                                                                                                      |
| `db.batch` (default, `timeout` or not)                                                                                                                       | shared: `pool.withShared`, one connection, one write     | independent statements, each with its own Sync                                                                                |
| `db.sql` whose first keyword changes session or transaction state: `begin`, `commit`, `set`, `reset`, `discard`, `listen`, `declare`, `create temp table`, … | its own: `pool.acquire()`                                | queries pipelined behind it would run in that state (inside the transaction a `begin` opens)                                  |
| `db.batch(…, { transaction })`                                                                                                                               | its own: `pool.acquire()`                                | BEGIN … COMMIT                                                                                                                |
| `db.transaction`                                                                                                                                             | its own: `pool.transaction`                              | the whole callback                                                                                                            |
| `stream()`                                                                                                                                                   | its own: `pool.acquire()`, held until the iteration ends | the cursor's portal, which holds the connection between batches                                                               |

COPY and LISTEN aren't builder operations: the driver's `pool.copyFrom`, `copyRows` and `copyTo` take a connection of their own, and `pool.listen` a dedicated one outside `max` ([driver/POOL.md](driver/POOL.md#two-ways-to-use-a-connection)).

```ts
#shared(queries: CompiledQuery | readonly CompiledQuery[] | undefined): Pool | undefined {
  const source = this.#source;
  if (!(source instanceof Pool)) return undefined;
  if (queries === undefined) return source; // describe(): no statement runs
  if ('sql' in queries) return changesSession(queries) ? undefined : source;
  for (const query of queries) if (changesSession(query)) return undefined;
  return source;
}

const changesSession = (query: CompiledQuery): boolean =>
  !isDataStatement(query) && SESSION_STATEMENT.test(query.sql);
```

`SESSION_STATEMENT` is one anchored, case-insensitive regular expression over the first keyword: `begin`, `start`, `commit`, `end`, `rollback`, `abort`, `savepoint`, `release`, `prepare`, `set`, `reset`, `discard`, `listen`, `unlisten`, `declare`, `fetch`, `move`, `close`, and `create temp` / `temporary` / `local temp` / `local temporary`. A batch takes a connection of its own if any one of its statements matches.

Only SQL written by hand is read: `isDataStatement` ([compile.ts](compile.ts)) is true for a query `compile` made from a select, insert, update or delete node, which leaves no session state behind, so the builders' queries skip the regular expression (#43; it had been 4–5% of a builder point lookup's client CPU). It reads a private field of the compiled query's class, so a `db.sql` statement, or a query object made anywhere else (a copy of a compiled one included), is tested.

**Shared.** Until the pool is full, a query takes an idle connection or waits for one being opened; once it is full, it pipelines onto the least loaded busy connection, waits in the pool's FIFO of pipeline slots beyond each connection's (adaptive) depth, and a connection is drained for a caller who needs one of its own, so transactions and streams aren't starved ([driver/POOL.md](driver/POOL.md#pipelining-onto-busy-connections)). Each query keeps its own behaviour, because all of it is per query in the connection: codecs and binary results once its statement is described (the statement cache is per connection), `keepRows`, the tag, the signal (a cancel is only sent once the query is at the head of the connection's queue, so it can't hit another caller's query: [driver/CANCELLATION.md](driver/CANCELLATION.md)), the unnamed statements behind PgBouncer, and the retry of a stale cached statement. A failing query fails alone: each has its own Sync. A batch runs as one pipeline slot: `withShared` hands it one connection, its statements go out together, and the slot ends when the last one settles.

**What sharing doesn't see.** The keyword check only reads a statement's first word. Session state a `select` sets (`set_config(…, false)`, `pg_advisory_lock`) or a `do` block, run with `db.sql` on a pool, lands on whichever connection runs it and stays there, as it always did. For session state, reserve a connection (`database(await pool.acquire())`) or use a transaction (`tx.setLocal`, `pg_advisory_xact_lock`).

**Its own.** `#run` reserves a connection with `pool.acquire()` (or `pool.transaction` holds one for the callback), runs the operation, and releases it; the driver still pipelines what quarry sends together on it: a transaction's BEGIN with its first statement, an atomic batch.

```ts
async #run(signal, fn) {
  const source = this.#source;
  if (!(source instanceof Pool)) {
    const runner = source instanceof PoolClient ? source.connection : source;
    await this.#prepare(runner);
    return await fn(runner); // awaited, so a failure's call site traces back through it
  }
  const client = await source.acquire(signal === undefined ? {} : { signal });
  try {
    await this.#prepare(client.connection);
    return await fn(client.connection);
  } finally {
    client.release();
  }
}
```

Until #37, every operation took this path, so concurrent builder queries never pipelined: beyond `max`, each waited for a whole connection ([DECISIONS.md](DECISIONS.md#plain-queries-share-the-pools-pipelined-connections) has the measurements).

Over a `PoolClient` or `Connection`, every operation uses that one connection, and concurrent queries on it are pipelined by the connection ([driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#pipelining)).

## Batches

`db.batch(queries, options?)` ([batch.ts](batch.ts) `batchWith`, `DriverExecutor.batch`) runs a fixed list of queries **in one round trip on one connection**, and resolves to their results by position, each read as its own `execute()` would (shapes included):

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

Each item is an `Executable`: a `Query` (a shaped query, already compiled) or a builder, whose `toQuery()` compiles it with its default shape (every row, or a write's `{ rowCount }` / `returning` rows). `batchWith` ([batch.ts](batch.ts)):

1. calls `toQuery()` on each item; an empty list resolves to `[]` without contacting the executor;
2. turns `transaction: true` into `{}` (and drops `false`), and, if any query's shape is **checked** (it can throw once the statement has run: the `expect…` shapes), adds a `verify` callback that reads every result;
3. sends `{ query, rowMode, keepRows }` for each query to `executor.batch`, with the caller's `signal` and `timeout`;
4. reads each result with its shape, by position: in `verify` (before an atomic batch commits), or afterwards from the settled outcomes, turning failures into a [`BatchError`](#batcherror).

It runs them on **this** database's executor wherever they were started, so queries built with the standalone `selectFrom` work too. The result type is a tuple, `BatchResults<Q>`, each position typed by its query's result.

There are three modes. The message sequences below were captured from the driver; "Sync" ends a protocol segment and is where the server reports success or failure ([driver/protocol/README.md](driver/protocol/README.md#the-extended-query-protocol)).

### Outside a transaction (default)

Each query is sent with its own Sync, all in one write. They run independently: one failing doesn't stop the others, and what the others wrote stays committed. Over a pool, the batch runs on a shared connection (`pool.withShared`), after whatever other callers' queries are in flight on it ([above](#connections-shared-or-exclusive)).

```
C> Bind q1 Execute Sync  Bind q1 Execute Sync          (one write)
S< BindComplete DataRow CommandComplete ReadyForQuery
S< BindComplete DataRow CommandComplete ReadyForQuery
```

If any fails (or its shape throws, e.g. `expectOne` finds no row), the batch rejects with a [`BatchError`](#batcherror) holding every outcome. Over a `PoolClient` or `Connection` the same statements go out on that connection (`#run`). `signal` and `timeout` are passed to each query, so each gets its own server-side timeout under its own Sync.

### `transaction: true` (or transaction options)

All or nothing. `Transaction.batch` ([driver/TRANSACTIONS.md](driver/TRANSACTIONS.md#batches-in-one-round-trip)) sends BEGIN (and any settings) and the queries under **one** Sync, then COMMIT with its own Sync:

```
C> Parse/Bind/Execute "begin"  Bind q1 Execute  Bind q1 Execute  Sync  Bind "commit" Execute Sync   (one write)
S< … BEGIN … SELECT 1 … SELECT 1 … ReadyForQuery(T)
S< … COMMIT … ReadyForQuery(I)
```

Under one Sync, the first failing statement makes the server skip the rest; COMMIT then reports ROLLBACK, and the batch rejects with the error that failed it.

If any query has a **checked** shape (`expect…`), its result must be checked **before** committing, so a failed check can roll the transaction back. `batchWith` passes a `verify` callback that reads every result; COMMIT then waits for the results: a second round trip.

```
C> begin + queries + Sync                              (first write)
S< … ReadyForQuery(T)
   (verify reads the results; throwing here rolls back)
C> commit + Sync                                       (second write)
```

Take shapes (`takeFirst`, `takeValue`) and builders check nothing, so they keep the batch at one round trip. A `timeout` becomes a `statement_timeout` setting of that transaction (added to its `settings`, sent with BEGIN). The transaction options are those of `db.transaction` without `retries` (`BatchTransactionOptions`): the batch runs once.

The batch rejects with the error that failed it, never a `BatchError`: a server error, the shape's own error when a check failed (captured: `NoRowError: The query on "users" returned no row, where exactly one was expected`, after which the transaction was rolled back), or `TransactionRolledBack` when COMMIT reports ROLLBACK. Over a pool, an atomic batch takes a connection of its own (`#run`), since BEGIN leaves a transaction open on it until COMMIT.

### Inside a transaction

On a transaction's `tx.batch(...)`, the queries share **one** Sync (and BEGIN's, if it hasn't been sent yet), through the driver's `queryGroup`: the first error skips the rest and rejects the batch, and the transaction is failed, as after any failed query. The results are then read with `verify` as for an atomic batch, so a failed shape check rejects the batch with the shape's error (not a `BatchError`); thrown inside the `db.transaction` callback, it rolls the transaction back like any other error. `transaction: true` (or options) there makes the batch a savepoint: `DriverExecutor.batch` calls `this.transaction(tx => tx.batch(…))`, which nests. A `timeout` is refused inside a transaction (`A batch inside a transaction takes no timeout: set statement_timeout with setLocal`): its statements share one Sync, and the driver's group statements take no `statementTimeout`, since a timed query is framed under a Sync of its own ([below](#timeouts-and-cancellation)).

### `BatchError`

`BatchError` ([batch.ts](batch.ts)) is what a batch outside a transaction rejects with when any query failed or its shape threw. It extends `AggregateError`, so it has:

- `results`: every query's outcome, by position, as `PromiseSettledResult`s: `{ status: 'fulfilled', value }` with the value its shape read, or `{ status: 'rejected', reason }`;
- `errors`: the failures alone, in order (`AggregateError`'s own field);
- a message counting them, e.g. `1 of the 2 queries in the batch failed; the others ran` (captured).

The successful positions' values are there because the others really ran and what they wrote stays committed: the caller may need them (an inserted row's id) to compensate or report. Inside a transaction there is nothing to report position by position (the first error skipped the rest), so the plain error is thrown instead.

### Batches in `onQuery` and telemetry

Each query of a batch reports its own `onQuery` event of kind `'execute'`, with its tag, when the batch settles. They share the batch's timings: `acquireMs` is the time until the batch had its connection, `queuedMs` is 0, and `execMs` runs from then until the outcomes were settled, so every query of a batch shows about the batch's duration (the driver's per-query timing isn't asked for in a batch). BEGIN and COMMIT aren't `onQuery` events; the driver's [spans](#opentelemetry-spans-and-tags) do include them, since the driver sees every statement. Captured for a `transaction: true` batch with an `expectOne()` query tagged `users.byEmail` and a `takeFirst()`: spans `BEGIN quarry_test`, `users.byEmail`, `SELECT quarry_test`, `COMMIT quarry_test`.

## Transactions

A **transaction** groups statements so they take effect together or not at all: between `begin` and `commit`, nobody else sees your changes; `rollback` (or an error) undoes them all. Postgres also uses transactions for **isolation** (what concurrent transactions see of each other) and locks ([QUERIES.md](QUERIES.md#row-locking)).

```ts
await db.transaction(
  async (tx) => {
    const order = await tx.insertInto(orders).values(row).returning(['orders.id']).expectOne().execute();
    await tx.update(stock).set(…).where(…).execute();
    tx.afterCommit(() => queue.publish('order.created', order.id));
  },
  { isolation: 'serializable', retries: 3 },
);
```

`DriverExecutor.transaction` calls the source's `transaction(fn, options)` (the pool reserves a connection for the whole callback) and gives `fn` a new `DriverExecutor` over the driver `Transaction`, sharing the registry. `database.ts` wraps that executor as a `DatabaseTransaction`, so `tx` has every query method.

- **Nesting**: `tx.transaction(fn)` inside a transaction runs `fn` in a **savepoint**, a named point inside the transaction that can be rolled back to without aborting the whole transaction. Isolation, read-only, deferrable, retries and timeout can only be set on the outermost transaction; `DriverExecutor.transaction` rejects them on a nested one. `durable: true` refuses to nest at all (for code that must really commit when it returns).
- **`retries`**: on a serialization failure or deadlock, the whole callback runs again (after a backoff), so it must be safe to re-run. Side effects belong in `afterCommit`.
- **`afterCommit(fn)`** runs `fn` once the outermost transaction commits; dropped on rollback or retry. **`afterRollback(fn)`** runs if this transaction or savepoint rolls back.
- **`setLocal(name, value)`** sets a run-time parameter for the rest of the transaction with `set_config(name, $value, true)`: bound, never interpolated.
- **`settings`** (an option) does the same for several settings at the start, sent with BEGIN.

The driver's framing (BEGIN sharing the first statement's Sync, deferred savepoint releases, detecting a COMMIT that rolled back) is in [driver/TRANSACTIONS.md](driver/TRANSACTIONS.md).

## Streaming

```ts
for await (const user of db.selectFrom(users).select(['users.id']).stream({ batchSize: 500, signal })) { … }

await db.transaction(async (tx) => {
  for await (const job of tx.selectFrom(jobs).select(['jobs.id']).forUpdate().stream())
    await tx.update(jobs).set({ status: 'done' }).where('jobs.id', job.id).execute(); // runs between batches
});
```

`SelectQueryBuilder.stream` (reworked in #34) checks `batchSize` (a whole number from 1, else a `RangeError`, thrown by `stream()` itself), compiles the query, and returns a `RowStream` over `executor.stream(compiled, options)`, without starting anything: the executor's generator only runs when the first row is pulled. `stream` exists only on the select builder, for every row: the `take…` and `expect…` shapes read a whole result, so they have none. `DriverExecutor.stream`:

1. Refuses a `timeout` inside a transaction (`A stream inside a transaction takes no timeout: set statement_timeout with setLocal`): a timed cursor runs as one operation under one Sync, holding the connection from its first batch to its last, so the transaction's other queries couldn't run between its batches ([driver/DECISIONS.md](driver/DECISIONS.md#a-statement-timeout-bounds-the-whole-stream)).
2. Over a pool, **acquires a connection** (`pool.acquire()`) when the first batch is asked for, and releases it in `finally`, however the iteration ends: read to the end, `break`, `return`, a throw, an abort. Inside a transaction, it uses the transaction's connection; over a `PoolClient` or `Connection`, that connection.
3. Iterates `runner.cursor(sql, params, { batchSize, …codecs, signal, statementTimeout, tag })` ([driver/STREAMING.md](driver/STREAMING.md#cursors)): each batch is fetched only once the rows before it are taken, columns come in their codecs' formats (binary where they can) **from the first run**, and outside a transaction a `timeout` becomes the cursor's `statementTimeout`: the driver sets it before the portal and restores it before the portal's Sync, so it bounds the whole stream (the loop's time included) and can't leak.
4. Decorates an error with the query and the call site, as `execute` does (the call site is captured when the generator starts, at the first pull); an error in the middle (a division by zero at row 10,001) rejects the pull that reaches it, after the rows before it.
5. Reports one `onQuery` event of kind `'stream'` when the iteration ends, with the total row count and `command: 'SELECT'` (or the error). Its clock starts at the first pull: `acquireMs` is the wait for the connection, `queuedMs` is 0, and `execMs` runs from then to the end of the iteration, the loop's own time included. A stream is not a span: the driver's telemetry wraps queries, not cursors ([below](#opentelemetry-spans-and-tags)).

A `RowStream` ([driver/row-stream.ts](driver/row-stream.ts)) runs once: iterating it again yields nothing. It is an async iterable, so `Readable.from(query.stream())` (Node streams) and `ReadableStream.from(query.stream())` (the web streams API, also in Node) read it with backpressure, and close it when destroyed or canceled; `await using rows = query.stream()` closes it at the end of the block. The driver's side (strict pull, named portals inside transactions, why `RowStream` is a hand-written iterator) is in [driver/STREAMING.md](driver/STREAMING.md).

The keyset helpers (`iterateChunks`, `paginateByCursor`, `paginateByOffset`) are the other way to read big results in pieces: each batch is its own `executor.execute`, on the pool's shared connections, holding no connection or cursor between batches ([PAGINATION.md](PAGINATION.md)). `paginateByOffset({ countTotal: true })` runs its page and its `count(*)` through `executor.batch`, in one round trip.

## `describe()`

`describe()` on a select builder asks the server for the query's parameter types and result columns **without running it**:

```ts
const d = await db
  .selectFrom(users)
  .where('users.email', email)
  .select(['users.id', 'users.createdAt'])
  .describe();
// captured:
// { params: [25],
//   columns: [
//     { name: 'id', typeOid: 23, typeModifier: -1, tableOid: 16392, columnNumber: 1 },
//     { name: 'createdAt', typeOid: 1184, typeModifier: -1, tableOid: 16392, columnNumber: 3 } ] }
```

`SelectQueryBuilder.describe` compiles the query and calls `executor.describe(compiled)`. `DriverExecutor.describe` sends only the SQL (`pool.describe(sql)` over a pool, on its shared connections, since nothing runs; otherwise the connection's `describe`), and the driver sends `Parse` (unnamed) / `Describe` (statement) / `Sync`, reading back ParameterDescription and RowDescription ([driver/protocol/README.md](driver/protocol/README.md#the-extended-query-protocol)). The parameters' types are the server's inference, since no parameter codecs are sent (`25` is `text` above). The description is mapped to quarry's `QueryDescription` ([executor.ts](executor.ts)): `params` (type OIDs, in order) and `columns` (`name`, `typeOid`, `typeModifier`, and `tableOid` / `columnNumber`, the source table's OID and attribute number, or 0 for a computed column). The column names are the select list's aliases, i.e. the row's keys.

Errors (a misspelled table in raw SQL, a type error) are decorated like `execute`'s, with a call site captured when `describe` starts. `describe` reports no `onQuery` event and no span.

## Timeouts and cancellation

- **`signal`** (`RunOptions`): aborting it cancels the query: if it was already sent, the driver sends a **cancel request** to the server over a separate connection; if it was still waiting, it is dropped without contacting the server. Over a pool, the signal also aborts waiting for a connection.
- **`timeout`** (`RunOptions`): a **server-side** `statement_timeout` for this query only. The driver applies it with `set_config('statement_timeout', $1, true)`, transaction-local, so it never leaks into later queries or other clients behind a pooler. The setting, the query and a statement restoring the previous value share the query's Sync, so the timeout bounds this query alone, in a transaction or not, whatever else is pipelined on the connection:

```
C> <set statement_timeout = $1>  <the query>  <restore it>  Sync   (one write)
```

Since that leaves nothing on the connection, a query or a default `db.batch` with a `timeout` runs on the pool's shared, pipelined connections like any other ([above](#connections-shared-or-exclusive)): each of the batch's queries gets its own. On a `stream()`, the setting goes before the cursor's portal and the restore before its Sync.

A canceled query fails with `QueryCanceled` (`reason`: `'abort'`, `'timeout'`, `'statement_timeout'` or `'user'`). The mechanics are in [driver/CANCELLATION.md](driver/CANCELLATION.md).

## `onQuery` events

```ts
database(url, { onQuery: (event) => logger.debug(event) });
```

Each `execute` (builder queries, `db.sql` statements, and each page or batch of the pagination helpers), each query of a `db.batch`, and each `stream` reports one `QueryEvent` ([driver-executor.ts](driver-executor.ts)) when it settles. `describe()` reports none, though `'describe'` is one of the type's kinds. The transaction's own statements (BEGIN, COMMIT, savepoints) and the catalog lookup aren't events: only the queries you built are.

```ts
interface QueryEvent {
  kind: 'execute' | 'stream' | 'describe';
  sql: string;
  params: readonly unknown[];
  tag: string | undefined;
  command: string | undefined; // 'SELECT', 'INSERT', … on success
  rowCount: number | undefined;
  durationMs: number;
  phases: {
    acquireMs: number; // waiting for a pool connection or pipeline slot
    queuedMs: number; // waiting on the connection behind other pipelined queries
    execMs: number; // sent → finished (server work, transfer, decoding)
  };
  error: Error | undefined;
}
```

A real event, captured from a builder insert on a pool (`tag` and `error` are `undefined`, so `JSON.stringify` left them out):

```json
{
  "kind": "execute",
  "sql": "insert into \"users\" (\"email\") values ($1) returning \"users\".\"id\" as \"id\"",
  "params": ["a@x"],
  "command": "INSERT",
  "rowCount": 1,
  "durationMs": 1.577,
  "phases": { "acquireMs": 0.161, "queuedMs": 0.02, "execMs": 1.309 }
}
```

`rowCount` is the command tag's count, or the number of rows for a command without one; with `keepRows` it still counts every row. `error` is the error the caller gets (already decorated), or a `DriverError` wrapping a thrown non-`Error` value. Unlike an error's `query`, the event's `params` is an ordinary property: a listener that logs whole events logs parameter values.

The timestamps come from `performance.now()`; `queuedMs` and `execMs` come from the driver's `onTiming` callback ([driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#timing)) where it is asked for. What each phase measures depends on the operation:

| Operation                                 | `acquireMs`                                                                                 | `queuedMs`                                                    | `execMs`                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------- |
| `execute`, shared (`pool.query`)          | before the query reached a connection: one being opened, or a pipeline slot (derived below) | the driver's: behind earlier queries, other callers' included | the driver's: written → finished      |
| `execute`, a connection of its own        | `pool.acquire()`, plus the catalog lookup on the first query                                | the driver's                                                  | the driver's                          |
| each query of a `db.batch`                | until the batch had its connection                                                          | 0                                                             | from then until the batch settled     |
| `stream` (the clock starts at first pull) | until the stream had its connection                                                         | 0                                                             | from then to the end of the iteration |

On a shared connection the pool picks the connection inside `pool.query`, so there is no moment quarry could read; `acquireMs` is worked out from the driver's timing instead: the time the query settled, less `queuedMs` and `execMs`. Nothing is timed when there is no `onQuery`: `observe` is false, no `performance.now()` is read and no `onTiming` callback is made. A listener that throws doesn't break the query: `#emit` rethrows its error in a microtask, where it surfaces as an uncaught exception instead of rejecting your query.

## OpenTelemetry spans and tags

**OpenTelemetry** is the common standard for **traces**: a trace is a tree of timed **spans**, one per unit of work (an HTTP request, a database query), which a collector gathers across services. quarry doesn't emit spans itself; the **driver** does, when its connections are given a tracer ([driver/telemetry.ts](driver/telemetry.ts), [driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#timing)). From the builder's side that means passing `telemetry` in the pool options:

```ts
import { trace } from '@opentelemetry/api';

const db = database({
  connectionString: process.env.DATABASE_URL,
  telemetry: { tracer: trace.getTracer('app') }, // queryText: false leaves the SQL out
});
// or: database(createPool({ connectionString, telemetry: { tracer } }))
```

The driver only calls `startSpan`, `setAttribute`, `setStatus`, `recordException` and `end` (its `TracerLike` and `SpanLike` interfaces), so it doesn't depend on `@opentelemetry/api`. A database made from a connection string alone has no tracer.

**What becomes a span.** Every statement the driver runs through `query`, `queryGroup`, `simpleQuery` or `copyFrom` is one client span, started when the statement is handed to a connection and ended when it settles. For quarry that is each `execute()` (with a `timeout`, the setting and restoring statements are inside the query's one span), each query of a `db.batch`, and the BEGIN and COMMIT of transactions and atomic batches. A `stream()` (a cursor) and a `describe()` are not spans.

**What a span records.** Captured from a builder insert that hit a unique violation:

```json
{
  "name": "INSERT quarry_test",
  "kind": 2,
  "attributes": {
    "db.system.name": "postgresql",
    "db.namespace": "quarry_test",
    "db.operation.name": "INSERT",
    "server.address": "/tmp/quarry-pg-nfcob9",
    "db.query.text": "insert into \"users\" (\"email\") values ($1) returning \"users\".\"id\" as \"id\"",
    "db.response.status_code": "23505",
    "error.type": "23505"
  },
  "status": {
    "code": 2,
    "message": "duplicate key value violates unique constraint \"users_email_key\""
  }
}
```

- The name is the query's tag, or the operation and the database (`INSERT quarry_test`). Kind 2 is "client".
- `db.operation.name` is the SQL's first keyword, upper-cased (comments skipped; `QUERY` if there is none). `server.port` is added for TCP connections (this capture used a Unix socket, whose directory is the `server.address`).
- `db.query.text` is the SQL, with `$1` placeholders; parameters are never recorded.
- On success, `db.response.returned_rows` is the command tag's row count, when it has one. On failure, the SQLSTATE (`db.response.status_code` and `error.type`; the error's name for errors that aren't the server's), the exception, and an error status.

**How a tag travels.** `.tag('users.byEmail')` on any of the four builders stores the label in the builder's state and its node; `compile` copies it to `CompiledQuery.tag`, an own property set only when there is a tag, and never part of `sql`, so tagging doesn't change the statement the driver caches. From there `#queryOptions` passes it to the driver as `QueryOptions.tag`, where it names the span and becomes `db.query.summary`; `#report` puts it in the `QueryEvent`; and `decorate` adds it to a server error's `query`. In a batch, each statement carries its own tag. `db.sql` statements have no `tag()`.

**`onQuery` or spans?** They overlap but answer different questions:

|               | `onQuery`                               | driver spans                                      |
| ------------- | --------------------------------------- | ------------------------------------------------- |
| Configured on | `database(…, { onQuery })` (quarry)     | `telemetry` in the pool or connection options     |
| Reports       | the queries you built, streams included | every statement the driver runs, BEGIN/COMMIT too |
| Parameters    | included                                | never                                             |
| Timing        | phases: acquire, queued, exec           | the span's start and end                          |
| Errors        | the decorated error object              | SQLSTATE, exception, status                       |

The driver also has a `captureStack` option that appends the issuing code's stack to errors; it is off by default because quarry's executor does its own ([Errors](#errors)), and leaving it off avoids two `--- query issued at ---` sections on one error.

## Errors

Every executor method catches what fails and passes it to `decorate(error, query, callsite)` ([driver-executor.ts](driver-executor.ts)) before rethrowing it unchanged (same object, same class):

1. A `PostgresError` (an error the **server** reported) gets a non-enumerable `query` property: `{ sql, params, tag }`. The driver already sets `query` to `{ sql, params }` when it builds the error; `decorate` replaces it to add the tag. Non-enumerable, so a logger that prints the error's own properties, and `JSON.stringify`, won't print parameter values.
2. **Any** error gets the caller's stack appended, once (a symbol marks it), under `--- query issued at ---`.

Captured from a builder insert hitting a unique constraint, called from `signUp` → `createUser` (paths shortened):

```
PostgresError: duplicate key value violates unique constraint "users_email_key"
    at postgresError (…/src/driver/errors.ts:270:9)
    at QueryOp.handle (…/src/driver/ops.ts:585:6)
    at #dispatch (…/src/driver/connection.ts:734:11)
    at #onData (…/src/driver/connection.ts:661:19)
    … (Node's socket and stream frames)
    --- query issued at ---
    at DriverExecutor.execute (…/src/driver-executor.ts:377:27)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async Query.execute (…/src/query.ts:91:4)
    at async createUser (/app/users.ts:51:9)
    at async signUp (/app/users.ts:54:9)
```

The error is a `UniqueViolation` (`instanceof` works), but the driver's subclasses don't set their own `name`, so the stack's first line says `PostgresError`. Without the appended part, a server error's stack shows only the driver's code: the error is created when the server's reply is read, long after your call returned to the event loop.

Errors that aren't the server's (a connection failure, an abort, a `DecodeError`, the `DriverError` refusing a timeout in a transaction) get the call site but no `query`. quarry's own result-shape errors (`NoRowError`, `TooManyRowsError`, `RowCountError`) are thrown by the shape after `execute` returned, so they aren't decorated: they carry their own non-enumerable `query` and name the table in their message ([QUERIES.md](QUERIES.md#errors)). In an atomic batch, a failing check is decorated with the call site (`decorate(error, undefined, …)`).

**When the call site is captured.** Only when a query fails. `issuedAt()` creates the `Error` in `execute`'s `catch`, after the `await`, where the engine's **async stack trace** lists the async functions awaiting the query: `Query.execute`, then your function, then whatever awaits it, up to `Error.stackTraceLimit` frames (10 by default). A query that succeeds captures nothing. Before, `execute` and `batch` ran `new Error()` for every query: about 2 µs on V8 however few frames it keeps, a quarter of a pipelined point lookup's client CPU ([DECISIONS.md](DECISIONS.md#errors-carry-the-query-hidden-and-the-code-awaiting-it)).

What it lists, compared with a stack taken when the query was issued:

- `await q.execute()` in an async function: that function and its awaiting callers, those that resumed after an `await` of their own included (a stack taken at issue time ends at the first of them).
- `Promise.all([q.execute(), …])`: `at async Promise.all (index 0)`, then the function awaiting it.
- A plain function returning `q.execute()` to an async caller: the caller, not the plain function, which isn't awaiting anything.
- A query started now and awaited later, or never: the code awaiting it **when it fails**, which may be no code of yours (the stack then ends at `Query.execute`).

`batch` captures once, at its first failure, in its own continuation: `settle` runs after `await pool.withShared(…)` or inside `#run`'s callback, and `#run` awaits that callback, so the chain reaches `batchWith` and your code. Each link has to be an `await`; a returned promise breaks the chain. `stream` and `describe` still capture when they start: once per stream or description, not per query. `callsites: false` turns it all off.

Error classes, all exported from `quarry` ([index.ts](index.ts)):

- the driver's ([driver/ARCHITECTURE.md](driver/ARCHITECTURE.md#errors)): `PostgresError` and its SQLSTATE subclasses (`IntegrityConstraintViolation` with `UniqueViolation`, `ForeignKeyViolation`, `NotNullViolation`, `CheckViolation`, `ExclusionViolation`; `SerializationFailure`, `DeadlockDetected`, `LockNotAvailable`, `ReadOnlyTransaction`, `TransactionTimeout`, `IdleInTransactionTimeout`, `UndefinedTable`, `UndefinedColumn`, `QueryCanceled`), and `DriverError`, `ConnectionError`, `ProtocolError`, `DecodeError`, `AbortError`, `UndefinedParameterError`, `TransactionRolledBack`;
- quarry's ([QUERIES.md](QUERIES.md#errors)): `NoRowError`, `TooManyRowsError`, `RowCountError` ([executor.ts](executor.ts)), [`BatchError`](#batcherror) ([batch.ts](batch.ts)) and `InvalidCursorError` ([pagination.ts](pagination.ts), [PAGINATION.md](PAGINATION.md#cursors)).

`violatedColumns(error, table)` ([errors.ts](errors.ts)) maps an `IntegrityConstraintViolation`'s database column names back to the table's TypeScript keys, for answering "which field was taken" ([QUERIES.md](QUERIES.md#errors)).

## Closing

`db.close()` and `[Symbol.asyncDispose]` (so `await using db = database(url)`) both call `executor.close()`:

```ts
async close(): Promise<void> {
  if (this.#owned && this.#source instanceof Pool) await this.#source.end();
}
```

- A database made from a connection string or pool options **owns** its pool, and `close()` ends it with `pool.end()`: idle connections close at once; queries already issued, callers already waiting for a connection, and reserved connections (a running transaction, a stream being read, an atomic batch) finish first, and `close()` resolves once every connection is closed ([driver/POOL.md](driver/POOL.md#ending-the-pool)). A query issued afterwards rejects with `DriverError: The pool has ended`. Calling `close()` again waits for the same ending.
- A database over a `Pool`, `PoolClient` or `Connection` you passed in doesn't own it: `close()` resolves and leaves it open (captured: `pool.ended` is still `false`), so you end it yourself (`pool.end()`, `client.release()`, `connection.close()`).
- `tx` inside a transaction has no `close` (`DatabaseTransaction` omits it): the transaction ends when its callback settles.

## Decisions

Why execution works this way. Each links to its full entry (what it is, why, the alternatives, the cost, measured impact) in [DECISIONS.md](DECISIONS.md):

- [One small `Executor` interface between the builder and the driver](DECISIONS.md#one-small-executor-interface-between-the-builder-and-the-driver): the builder can be tested in memory, and the driver integration is one file.
- [The driver owns the codecs; the builder only chooses them](DECISIONS.md#the-driver-owns-the-codecs-the-builder-only-chooses-them): quarry adds no per-row work of its own.
- [The type catalog loaded before the first query](DECISIONS.md#the-type-catalog-loaded-before-the-first-query): the first query behaves like every later one.
- [Plain queries share the pool's pipelined connections](DECISIONS.md#plain-queries-share-the-pools-pipelined-connections): concurrent builder queries pipeline beyond `max`; what holds state keeps a connection of its own.
- [Server-side statement timeouts, transaction-local and pipelined](driver/DECISIONS.md#server-side-statement-timeouts-transaction-local-and-pipelined): a client-side timer can't stop the server; a transaction-local setting can't leak.
- [A statement timeout is framed under the query's Sync, whatever the transaction status](driver/DECISIONS.md#a-statement-timeout-is-framed-under-the-querys-sync-whatever-the-transaction-status): why a query with a `timeout` can share the pool's connections (#38).
- [`db.batch`: two modes with names](DECISIONS.md#dbbatch-two-modes-with-names): "together" and "atomically" fail differently.
- [`db.batch` framing: one write, with COMMIT pipelined unless results are checked](driver/DECISIONS.md#dbbatch-framing-one-write-with-commit-pipelined-unless-results-are-checked): how a batch goes on the wire.
- [`stream()`: only for every-row reads, run by iterating it](DECISIONS.md#stream-only-for-every-row-reads-run-by-iterating-it): and why its `timeout` is refused in a transaction.
- [A statement timeout bounds the whole stream](driver/DECISIONS.md#a-statement-timeout-bounds-the-whole-stream): the cursor's framing behind `stream({ timeout })`.
- [Errors carry the query (hidden) and the code awaiting it](DECISIONS.md#errors-carry-the-query-hidden-and-the-code-awaiting-it): debuggable without leaking parameters into logs, and without a stack captured per query.
- [Errors carry everything and leak nothing](driver/DECISIONS.md#errors-carry-everything-and-leak-nothing): the driver's side of the same rule.
- [Nested `durable` transactions throw](DECISIONS.md#nested-durable-transactions-throw): a durable request never silently becomes a savepoint.
- [`onQuery`: one event per settled query, with its phases; `tag()` stays out of the SQL](DECISIONS.md#onquery-one-event-per-settled-query-with-its-phases-tag-stays-out-of-the-sql): why one callback tells the three waits apart, costs nothing without a listener, and why a tag travels next to the SQL instead of in it.
- [OpenTelemetry spans through a structural tracer, without parameters](driver/DECISIONS.md#opentelemetry-spans-through-a-structural-tracer-without-parameters): why the driver emits spans without depending on `@opentelemetry/api`.

## Glossary

**Catalog** (`pg_type`): Postgres's table of types; the driver reads it to find the OIDs of named types.

**Checked shape**: a result shape whose read can throw once the statement has run (the `expect…` shapes); an atomic batch waits for its check before committing.

**Executor**: the object that runs compiled queries ([executor.ts](executor.ts)).

**OID**: a Postgres type's numeric id.

**Pipeline slot**: one place in a shared connection's pipeline: a query, or a whole default batch, waiting for or holding one.

**Registry**: the driver's map from type OID to codec, for columns no query typed.

**Round trip**: one message to the server and its answer: the unit of network latency.

**Savepoint**: a point inside a transaction that can be rolled back to without aborting the transaction.

**Serialization failure**: the error a `serializable` transaction gets when it conflicts with a concurrent one; retrying succeeds.

**Shared connection**: a pool connection lent to several callers' queries at once, pipelined; the opposite of a connection reserved with `pool.acquire()` ([driver/POOL.md](driver/POOL.md)).

**Span**: one timed unit of work in an OpenTelemetry trace; the driver makes one per statement when given a tracer.

**`statement_timeout`**: Postgres's setting that cancels statements running longer than it.

**Sync**: the protocol message that ends a segment of pipelined statements ([driver/protocol/README.md](driver/protocol/README.md)).

**Tag**: a query's label from `tag()`: the span's name, `QueryEvent.tag`, and a server error's `query.tag`; never part of the SQL.
