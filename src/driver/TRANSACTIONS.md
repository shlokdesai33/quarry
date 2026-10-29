# Transactions, savepoints and batches

[transaction.ts](transaction.ts). This guide explains what transactions are, how the driver runs one (`Transaction.run`), how it saves round trips without changing what runs (the `Session`), savepoints, retries, settings and timeouts, the one-round-trip batch (`Transaction.batch`), and the cases where things go wrong.

The query builder's side is in [../EXECUTION.md](../EXECUTION.md#transactions).

## Contents

- [What a transaction is](#what-a-transaction-is)
- [The API](#the-api)
- [`Transaction.run`, step by step](#transactionrun-step-by-step)
- [BEGIN shares the first statement's Sync](#begin-shares-the-first-statements-sync)
- [The `Session`](#the-session)
- [Savepoints](#savepoints)
- [COMMIT behind the last statement](#commit-behind-the-last-statement)
- [Retries](#retries)
- [Settings, `setLocal` and the transaction timeout](#settings-setlocal-and-the-transaction-timeout)
- [A COMMIT that rolled back](#commit-that-rolled-back)
- [`afterCommit` and `afterRollback`](#aftercommit-and-afterrollback)
- [Batches in one round trip](#batches-in-one-round-trip)
- [What goes wrong, and what you see](#what-goes-wrong-and-what-you-see)
- [Decisions](#decisions)
- [Glossary](#glossary)

## What a transaction is

A **transaction** is a group of statements that the database treats as one unit:

- **All or nothing**: `commit` makes every change visible at once; `rollback` (or an error) discards them all. A money transfer never leaves the debit without the credit.
- **Isolation**: while it runs, other sessions don't see its uncommitted changes, and (depending on the **isolation level**) it sees a consistent view of the data.

Statements outside an explicit transaction each run in their own (**autocommit**).

Isolation levels, weakest to strongest (Postgres treats `read uncommitted` as `read committed`):

| Level                      | Each statement sees                                         | Can fail with                                  |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `read committed` (default) | data committed before **the statement** began               | (no serialization errors)                      |
| `repeatable read`          | data committed before **the transaction's first statement** | serialization failure on conflicting writes    |
| `serializable`             | as if transactions ran one after another                    | serialization failure on any dangerous overlap |

A **serialization failure** (SQLSTATE `40001`) or a **deadlock** (`40P01`, two transactions each waiting for the other's lock) means "this transaction lost a race; running it again will likely succeed". Hence [retries](#retries).

`read only` forbids writes; `deferrable` (with `serializable read only`) waits for a safe snapshot so the transaction can't fail with a serialization error.

## The API

```ts
await pool.transaction(async (tx) => {
  await tx.query('insert into orders …', [...]);
  await tx.transaction(async (sp) => { … });          // a savepoint
  tx.afterCommit(() => queue.publish('order.created'));
}, { isolation: 'serializable', retries: 3, settings: { 'app.tenant_id': tenant }, timeout: '10s' });
```

`Pool.transaction` reserves a connection for the callback (`#with`; its options also take a `signal`, which bounds the wait for that connection), `Connection.transaction` and `PoolClient.transaction` use theirs; all call `Transaction.run(connection, fn, options)`.

`TransactionOptions`: `isolation`, `readOnly`, `deferrable`, `retries`, `retryDelay(attempt)`, `settings`, `timeout`, `durable`.

## `Transaction.run`, step by step

```ts
static async run(conn, fn, options = {}) {
  const opening = openingStatements(conn, options); // BEGIN …, select set_config(…)
  running.add(conn);
  try {
    for (let attempt = 0; ; attempt++) {
      const session = new Session(conn, opening);
      const tx = new Transaction(session, 0);
      let result;
      try {
        result = await fn(tx);
        tx.#finished = true;
        const commit = await session.query('commit');
        if (commit.command === 'ROLLBACK') throw new TransactionRolledBack();
      } catch (caught) {
        tx.#finished = true;
        const failure = await session.end(); // did BEGIN itself fail?
        const error = failure === undefined ? caught : failure.error;
        if (conn.transactionStatus !== 'idle') await conn.query('rollback').catch(() => {});
        runCallbacks(tx.#afterRollback);
        if (error instanceof PostgresError && error.isRetryable && attempt < retries) {
          await sleep(retryDelay(attempt + 1));
          continue;
        }
        throw error;
      }
      runCallbacks(tx.#afterCommit);
      return result;
    }
  } finally {
    running.delete(conn);
  }
}
```

1. **`openingStatements`** validates the options (a known isolation level) and that the connection isn't already in a transaction (`transactionStatus`, or the `running` set for one whose BEGIN hasn't been sent yet), then builds: `begin [isolation level …] [read only|read write] [deferrable|not deferrable]`, and, if there are settings or a timeout, `select set_config($1, $2, true), …`. Both are sent **unprepared**: they run once per transaction and can't go stale.
2. Each **attempt** gets a fresh `Session` and `Transaction`, and calls `fn(tx)`.
3. `fn` resolved: send `commit`. If the server answers `ROLLBACK`, throw `TransactionRolledBack` ([below](#commit-that-rolled-back)).
4. `fn` threw (or commit failed): find the real error (BEGIN's, if BEGIN failed and `fn`'s statements were therefore skipped), roll back if still in a transaction, run `afterRollback` callbacks, retry if retryable and attempts remain, else rethrow.
5. Success: run `afterCommit` callbacks, return `fn`'s result.

A `Transaction` must not be used after its callback settles (`#finished`): its methods reject with "This transaction has already finished".

## BEGIN shares the first statement's Sync

A naive transaction costs one round trip more than its statements: `begin` → wait → first statement → wait → … → `commit` → wait. The driver sends `begin` **together with the first statement, under one Sync**. Captured on a fresh connection, a transaction running `select 1 as a` twice:

```
C> Parse("", "begin") Bind("", "") Describe(P "") Execute("")   Parse("q1", "select 1 as a") Describe(S "q1") Bind("", "q1") Execute("")   Sync
S< ParseComplete BindComplete NoData CommandComplete(BEGIN)   ParseComplete ParameterDescription RowDescription BindComplete DataRow CommandComplete(SELECT 1)   ReadyForQuery(T)
C> Bind("", "q1", results 1) Execute("") Sync          (the second statement: described, so binary)
S< BindComplete DataRow CommandComplete(SELECT 1) ReadyForQuery(T)
C> Parse("q2", "commit") Describe(S "q2") Bind("", "q2") Execute("") Sync
S< ParseComplete ParameterDescription NoData BindComplete CommandComplete(COMMIT) ReadyForQuery(I)
```

With settings (`isolation: 'serializable', settings: { 'app.tenant': '7' }`), BEGIN, the `set_config` and the first statement share the Sync:

```
C> Parse("", "begin isolation level serializable") Bind Describe(P) Execute   Parse("", "select set_config($1, $2, true)") Bind("", "", "app.tenant", "7") Describe(P) Execute   Parse("q1", "select 1 as a") Describe(S "q1") Bind("", "q1") Execute   Sync
```

Why **one Sync**? If BEGIN fails (an invalid option, a connection-level problem), the server skips everything until Sync: the first statement does **not** run, and certainly not outside the transaction, which is what could happen with separate Syncs. The statement then rejects with BEGIN's error. (The callback has already started by then, since the first statement is what triggers sending BEGIN.)

## The `Session`

`Session` wraps the connection for one transaction attempt and implements the round-trip savings without changing what runs.

```ts
class Session {
  #opening: GroupStatement[] | undefined; // BEGIN + settings, until sent
  #beginning = false; // BEGIN in flight
  #waiting: Waiter[] | undefined; // sends waiting for BEGIN's outcome
  #opened: Promise<void> | undefined; // settles when BEGIN's outcome is known
  #failure: { error } | undefined; // why the transaction never began
  #deferred: Promise<unknown> | undefined; // statements sent without waiting; the next statement reports their error
  #prefix: Pending[] | undefined; // savepoint, release, settings: waiting for the next statement's Sync
  #commit: Promise<QueryResult> | undefined; // COMMIT, once sent behind the last statement
}
```

- **`query(sql, …)`** while BEGIN is unsent: if the query's options don't need a Sync of its own (`signal`, `timeout`, `statementTimeout`, `onTiming` do), send it with BEGIN through `#begin([statement])`, which calls `connection.queryGroup([...opening, statement])` ([ARCHITECTURE.md](ARCHITECTURE.md#part-5-operations), `SyncGroupOp`). Otherwise send BEGIN alone first.
- **`#send(fn)`** for everything else: if BEGIN is still unsent, send it; if it failed, reject with its error; if it's in flight, queue `fn` until its outcome (`#waiting`, run by `#began`). So statements issued before BEGIN's answer arrive in order after it, and fail with BEGIN's error if it failed.
- **`transactionStatus`** reports `transaction` from the start, even before BEGIN was sent or answered, so code inside the callback sees what it expects.
- **`queryGroup(statements)`**: several statements under one Sync, sharing BEGIN's if unsent.
- **`describe`, `copyFrom`** go through `#send` like a query with its own Sync.
- **`cursor`, `stream`, `copyTo`** (`#iterate`) wait for BEGIN (and any deferred statement) before starting: they send their messages through the connection's own iterators, which can't share BEGIN's Sync or wait in `#waiting`. `stream` is a [`RowStream`](row-stream.ts) over `cursor`. Inside a transaction a cursor uses a named portal, so other statements can run between its batches ([STREAMING.md](STREAMING.md#how-it-works-on-the-wire)); for the same reason it refuses a `statementTimeout` ("A cursor inside a transaction takes no statementTimeout, since other queries run between its batches: set statement_timeout with set_config(…, true)").
- **`queue(statements)`**: holds statements (`savepoint`, `release savepoint`, a savepoint's settings) until the next statement, which goes out with them under one Sync (`#group`); `drop` takes them back if nothing followed. A statement that needs a Sync of its own sends them first without waiting (`#sendPrefix`): the **next** statement's result waits for their answer first, and reports their error instead if they failed (`#send` chains on `#deferred`).
- **`commitWith(sql, …)`**: the statement, then COMMIT right behind it, unanswered ([below](#commit-behind-the-last-statement)).
- **`end()`**: drops BEGIN and anything queued if never sent (a callback that ran no statement costs no round trip at all, and COMMIT then does nothing), waits for BEGIN's outcome, and returns its failure.

## Savepoints

A **savepoint** is a named point inside a transaction that you can roll back to without abandoning the whole transaction. `tx.transaction(fn)` runs `fn` in one:

```ts
async transaction(fn, options = {}) {
  // durable, isolation, readOnly, deferrable, retries: refused here
  const name = `quarry_sp_${this.#depth + 1}_${++this.#savepoints}`;
  const savepoint = conn.queue([`savepoint ${name}`, ...settings]); // sent with fn's first statement
  const inner = new Transaction(conn, this.#depth + 1);
  try {
    const result = await fn(inner);
    if (conn.transactionStatus === 'failed') throw conn.transactionError; // fn caught an error and went on
    inner.#finished = true;
    if (!conn.drop(savepoint)) conn.queue([`release savepoint ${name}`]); // sent with the next statement
    this.#afterCommit.push(...inner.#afterCommit);
    this.#afterRollback.push(...inner.#afterRollback);
    return result;
  } catch (error) {
    inner.#finished = true;
    if (!conn.drop(savepoint) && conn.transactionStatus !== 'idle') {
      error = firstError(error, conn.transactionError); // 25P02 → the error that failed it
      await Promise.all(conn.queryGroup([`rollback to savepoint ${name}`, `release savepoint ${name}`]));
    }
    runCallbacks(inner.#afterRollback);
    throw error;
  }
}
```

- Names are unique per depth and sequence (`quarry_sp_1_1`, `quarry_sp_1_2`, `quarry_sp_2_1`), generated by the driver, so they're safe to interpolate. They are sent unprepared.
- **No round trip of its own**: `savepoint` waits for `fn`'s first statement and goes out with it under its Sync, and `release savepoint` waits for the statement after the savepoint (or COMMIT). If either fails, the server skips the statement, which rejects with that error. A savepoint in which `fn` runs no statement sends nothing. Five savepoints with a `select 1` each, inside one transaction, take 6 round trips: BEGIN, the first savepoint and its select; four times a release, the next savepoint and its select; the last release and COMMIT.
- **`fn` caught a database error and went on** (the transaction is `failed`): the savepoint fails with **that** error, as if `fn` had thrown it. The connection records the error that failed the transaction (`transactionError`, the first ReadyForQuery reporting `E`), so the savepoint (and the outermost transaction) report it instead of the "current transaction is aborted" (25P02) of the statements after it; a COMMIT answered ROLLBACK throws `TransactionRolledBack` with it as its `cause`.
- **Error**: roll back to the savepoint and release it (under one Sync), run the savepoint's `afterRollback` callbacks, rethrow. The outer transaction can continue.
- The inner transaction's `afterCommit` callbacks move up to the outer one: they run when the **outermost** transaction commits. If the outer one later rolls back, they're dropped.
- As the first statement of a transaction, `savepoint` shares BEGIN's Sync like any statement (captured: `Parse("", "begin") … Parse("", "savepoint quarry_sp_1_1") … Parse("", "select 1") … Sync`).

## COMMIT behind the last statement

<a id="commit-behind-the-last-statement"></a>
`tx.queryAndCommit(sql, params)` runs the transaction's last statement: COMMIT goes out right behind it, under a Sync of its own, without waiting (`Session.commitWith`). With BEGIN sharing the statement's Sync, a transaction whose only statement commits so is **one round trip**:

```
C> Parse("", "begin") … Execute   Parse("", "insert …") … Execute   Sync   Parse("", "commit") … Execute Sync   (one write)
S< … BEGIN … INSERT 0 1 … ReadyForQuery(T)   … COMMIT … ReadyForQuery(I)
```

- The transaction takes no more statements afterwards ("This transaction has already finished"). `Transaction.run` awaits that COMMIT instead of sending one.
- If the statement fails, COMMIT answers ROLLBACK and the statement's error is reported, as without the option. If BEGIN failed, the statement was skipped and COMMIT, outside a transaction, does nothing.
- Once the statement succeeded, nothing the callback does afterwards can roll the transaction back: an error thrown after it is reported, but the transaction committed, and its `afterCommit` callbacks run.
- Only in the outermost transaction; a savepoint refuses it. quarry's `executeAndCommit()` calls it, and throws for an `expect…` shape, whose check would run after COMMIT was sent.
- If the statement had to wait for BEGIN's answer (it needs a Sync of its own, or BEGIN went out alone), COMMIT waits behind it, to keep the order.

## Retries

`retries: n` re-runs the whole callback up to n times when the transaction fails with `isRetryable` errors (`SerializationFailure` 40001, `DeadlockDetected` 40P01), after `retryDelay(attempt)` milliseconds; the default is jittered exponential backoff: `min(1000, 10 × 2^attempt) × (0.5 … 1.5)`. Jitter spreads retries of conflicting transactions apart, so they don't collide again.

Because the callback runs again, it must be safe to re-run: no side effects outside the database. Put those in `afterCommit`, which only runs for the attempt that committed.

Retries are opt-in (default 0): a retry is only correct when you know the callback can be repeated.

## Settings, `setLocal` and the transaction timeout

- **`settings: { name: value }`** applies run-time parameters for this transaction only: `select set_config($1, $2, true), set_config($3, $4, true)`, sent with BEGIN. Names and values are **bound parameters**, never interpolated (names are also checked against `^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$`). The third argument `true` makes them **transaction-local**: they end with the transaction, so behind a pooler they can't leak into another client's session. Typical use: row-level security (`'app.tenant_id': id`).
- **`tx.setLocal(name, value)`**: the same, later in the transaction.
- **`timeout`**: becomes the `transaction_timeout` setting (PostgreSQL 17+): if the transaction runs longer, the **server** ends the session, and the call fails with `TransactionTimeout` (25P04). The connection is closed by the server; the pool replaces it.
- Savepoints accept `settings` too (applied after the savepoint, so rolling back to it undoes them).
- **A query's `statementTimeout`** bounds that query alone, in a transaction as outside one: the query goes out with its own Sync (not BEGIN's), between a statement setting `statement_timeout` and the same statement restoring it, all three under that Sync ([CANCELLATION.md](CANCELLATION.md#statement-timeouts)). Captured, as the second statement of a transaction:

```
C> Parse("q2", "select case when $1::text is null the…") Describe(S "q2") Bind("", "q2", "2000ms") Execute   Parse("q3", "select 2 as b") Describe(S "q3") Bind("", "q3") Execute   Bind("", "q2", null) Execute   Sync
```

## A COMMIT that rolled back

<a id="commit-that-rolled-back"></a>
If a statement inside the transaction failed and your code caught the error and carried on, the transaction is in the **failed** state: Postgres refuses further statements, and a `commit` is answered with the command tag `ROLLBACK`, not an error. Many drivers report that as success. `Transaction.run` checks `commit.command === 'ROLLBACK'` and throws `TransactionRolledBack`: nothing was committed, and your code must not think otherwise.

## `afterCommit` and `afterRollback`

- `afterCommit(fn)`: runs once the outermost transaction commits; dropped if it (or the savepoint it was registered in) rolls back, or the attempt is retried.
- `afterRollback(fn)`: runs if this transaction or savepoint rolls back.

`runCallbacks` calls each one and reports errors (and rejected promises) by rethrowing them in a microtask, never by throwing: by then the transaction's outcome is decided, and a failing callback must not turn a successful commit into a rejected call.

## Batches in one round trip

<a id="batches-in-one-round-trip"></a>
`Transaction.batch(conn, statements, options)` (used by quarry's `db.batch(…, { transaction: true })`) runs a **fixed list** of statements as one transaction in one round trip. Its options (`TransactionBatchOptions`) are the transaction's without `retries`, `retryDelay` and `durable`, plus `signal` and `verify`:

```ts
const opening = openingStatements(conn, options);
const all = conn.queryGroup([...opening, ...statements], { signal }); // BEGIN + settings + statements, one Sync
const results = all.slice(opening.length);
const pipelined =
  verify === undefined && !signal?.aborted ? conn.query('commit') : undefined; // COMMIT, own Sync
const done = (async () => {
  try {
    let failure,
      rows = [];
    try {
      rows = (await Promise.all(all)).slice(opening.length);
      verify?.(rows); // throwing → no COMMIT, rollback
    } catch (error) {
      failure = { error };
    }
    if (failure !== undefined) {
      await pipelined?.catch(noop); // a pipelined COMMIT is answered ROLLBACK
      throw failure.error;
    }
    const commit = await (pipelined ?? conn.query('commit'));
    if (commit.command === 'ROLLBACK') throw new TransactionRolledBack();
    return rows;
  } finally {
    if (conn.transactionStatus !== 'idle')
      await conn.query('rollback').catch(noop);
    running.delete(conn);
  }
})();
return { results, done };
```

Captured (the same prepared statement twice):

```
C> Parse("", "begin") Bind Describe(P) Execute   Bind("", "q1", results 1) Execute   Bind("", "q1", results 1) Execute   Sync   Parse("q2", "commit") Describe(S "q2") Bind("", "q2") Execute Sync   (one write)
S< ParseComplete BindComplete NoData CommandComplete(BEGIN)   BindComplete DataRow CommandComplete(SELECT 1)   BindComplete DataRow CommandComplete(SELECT 1)   ReadyForQuery(T)
S< ParseComplete ParameterDescription NoData BindComplete CommandComplete(COMMIT) ReadyForQuery(I)
```

- Under one Sync, the first failure makes the server skip the rest, so the remaining statements reject with that error, and COMMIT (outside the failed segment) is answered `ROLLBACK` → `TransactionRolledBack`.
- If BEGIN failed, nothing ran, and COMMIT, outside any transaction, does nothing (Postgres answers with a warning).
- **`verify`**: when results must be checked before committing (quarry's `expect…` shapes), COMMIT isn't pipelined: `done` waits for the results, calls `verify`, and only then sends COMMIT, a second round trip. Throwing in `verify` rolls back.
- Without `verify`, COMMIT is sent before any result is read: a result the client can't **decode** fails the batch, but its transaction has committed. (Decoding happens after the server's work; it can't be part of the server's decision.)
- When a statement failed, `done` waits for the pipelined COMMIT's answer (`ROLLBACK`) before rejecting with the statement's error, so the connection is idle again when the caller hears of it. With `verify` there is no pipelined COMMIT, and `finally` rolls back.
- `finally`: if the connection is still in a transaction, roll back.
- quarry's `db.batch(…, { transaction: true, timeout })` adds the timeout to the batch's settings as `statement_timeout`, so it bounds each statement of the batch ([../EXECUTION.md](../EXECUTION.md#batches)).

## What goes wrong, and what you see

| Situation                                            | What happens                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A statement fails                                    | its promise rejects; the transaction is failed; `fn` usually throws; rollback; the error is rethrown         |
| `fn` catches a statement's error and returns         | COMMIT answers ROLLBACK → `TransactionRolledBack`, with that error as its `cause`                            |
| BEGIN fails                                          | the first statement is skipped and rejects with BEGIN's error; `run` reports BEGIN's error                   |
| `fn` throws a non-database error                     | rollback; rethrown                                                                                           |
| Serialization failure / deadlock with `retries`      | rollback, backoff, `fn` runs again                                                                           |
| Transaction exceeds `timeout`                        | the server ends the session: `TransactionTimeout`; the connection is gone                                    |
| Connection lost mid-transaction                      | statements reject with `ConnectionError`; nothing committed (the server rolls back an abandoned transaction) |
| `transaction()` while already in one                 | "The connection is already in a transaction; use tx.transaction() to nest" (or the durable message)          |
| A `PoolClient` released while still in a transaction | the pool destroys the connection ([POOL.md](POOL.md#releasing-and-giving-back))                              |
| Using `tx` after the callback settled                | "This transaction has already finished"                                                                      |

## Decisions

Why transactions work this way. Each links to its full entry (what it is, why, the alternatives, the cost, measured impact) in [DECISIONS.md](DECISIONS.md):

- [BEGIN shares the first statement's Sync](DECISIONS.md#begin-shares-the-first-statements-sync): one round trip saved per transaction, and a failed BEGIN can never let a statement run outside it.
- [Savepoints and RELEASE share the next statement's Sync](DECISIONS.md#savepoints-and-release-share-the-next-statements-sync): a savepoint adds no round trip; errors still surface where the work is.
- [A swallowed error resurfaces as itself](DECISIONS.md#a-swallowed-error-resurfaces-as-itself): not as the 25P02 after it.
- [COMMIT pipelined behind a transaction's last statement](DECISIONS.md#commit-pipelined-behind-a-transactions-last-statement): a one-statement callback transaction in one round trip.
- [Detect a COMMIT that rolled back](DECISIONS.md#detect-a-commit-that-rolled-back): a swallowed error can't pass for a commit.
- [Retries opt-in, re-running the whole callback](DECISIONS.md#retries-opt-in-re-running-the-whole-callback): partial replays are never right.
- [Settings with `set_config(…, true)`](DECISIONS.md#settings-with-set_config-true): bound values, transaction-local, pooler-safe.
- [`afterCommit` callbacks that can't change the outcome](DECISIONS.md#aftercommit-callbacks-that-cant-change-the-outcome): side effects only for the committed attempt.
- [`db.batch` framing: one write, with COMMIT pipelined unless results are checked](DECISIONS.md#dbbatch-framing-one-write-with-commit-pipelined-unless-results-are-checked): many statements, atomically, in one round trip.

## Glossary

**Autocommit**: a statement outside an explicit transaction runs and commits on its own.

**Deadlock**: two transactions each waiting for a lock the other holds; Postgres aborts one.

**Isolation level**: how much a transaction sees of concurrent ones.

**Savepoint**: a named point inside a transaction to roll back to.

**Serialization failure**: a `repeatable read` or `serializable` transaction losing a conflict; retrying usually succeeds.

**`set_config(name, value, is_local)`**: sets a run-time parameter; `is_local = true` limits it to the current transaction.

**`transaction_timeout`**: a PostgreSQL 17+ setting that ends sessions whose transaction runs too long.
