# Query builder decisions

Every design decision and trick in quarry's query builder (everything in `src/` outside `src/driver/`), explained for someone new to query builders. Each entry answers the same questions:

- **What it is**: the idea, in plain words.
- **Why**: the problem it solves.
- **Alternatives**: what else was possible, often what Kysely, Drizzle, Prisma or Laravel do, and why that lost.
- **Cost**: what it costs in complexity, flexibility or speed.
- **Measured**: numbers, where we have them, with the pull request (PR) they came from.
- **Code**: where it lives.

The driver's decisions are in [driver/DECISIONS.md](driver/DECISIONS.md), which also explains [how to read the numbers](driver/DECISIONS.md#how-to-read-the-numbers); the index of both is [../DECISIONS.md](../DECISIONS.md). The mechanisms themselves are explained in the area guides ([ARCHITECTURE.md](ARCHITECTURE.md) and its neighbours); this file is about **why**.

## Contents

- [The shape of the API](#the-shape-of-the-api)
- [Running queries](#running-queries)
- [Compiling to SQL](#compiling-to-sql)
- [Values, codecs and types](#values-codecs-and-types)
- [Bulk writes](#bulk-writes)
- [Joins and selections](#joins-and-selections)
- [Pagination](#pagination)
- [Execution and errors](#execution-and-errors)
- [Type-level tricks](#type-level-tricks)
- [Type-checking speed](#type-checking-speed)
- [Schema, verify and the CLI](#schema-verify-and-the-cli)

## The shape of the API

### Table objects at run time, references as strings

**What it is.** Tables are real objects made by `defineTable` ([define-table.ts](define-table.ts)), whose columns know their SQL type and codec at run time. Queries refer to columns with short strings, `'users.email'`, that the types autocomplete and check.

**Why.** Run-time tables let quarry encode every value by its column's SQL type (a `jsonb` object, a range, a vector, array elements) and decode every result with the right codec. String references keep queries short and readable, and TypeScript checks them against the tables in scope.

**Alternatives.**

- Kysely: types only (a `DB` interface). Nothing at run time knows a column's SQL type, so values go to the driver as plain JavaScript, and results come back however the driver decodes them.
- Drizzle: run-time tables referenced as objects (`users.email`). Equivalent power, but longer queries, and a self-join or alias needs a second table object.

**Cost.** A schema has to be declared in code (and can drift from the database: that's what [`verify`](#verify-instead-of-trusting-that-code-and-database-agree) is for). String references need the type machinery in [refs.ts](refs.ts), which has to be kept fast ([type-checking speed](#type-checking-speed)).

**Code.** [define-table.ts](define-table.ts), [table.ts](table.ts), [refs.ts](refs.ts).

### Types follow PostgreSQL, not JavaScript

**What it is.** Whether two things can be compared, and with which operators, is decided by their **SQL types**, not their TypeScript types. A `uuid` column and a `text` column both hold strings, but Postgres won't compare them without a cast, so neither does quarry. `integer` compares with `bigint` and `numeric`, as Postgres allows ([EXPRESSIONS.md](EXPRESSIONS.md#which-types-compare-with-which)).

**Why.** "It type-checks" should mean "Postgres accepts it". Typing by TypeScript type accepts comparisons the server then rejects at run time.

**Alternatives.** Kysely and Drizzle type operators by TypeScript type: `uuid = text` compiles and fails in the database.

**Cost.** Each SQL kind needs its own entry in `MethodsByKind` ([operators.ts](operators.ts)), and types outside the built-in kinds go through `defineType` with an explicit operator set.

**Code.** [operators.ts](operators.ts), [data-type/](data-type/).

### Comparisons are methods, typed per SQL kind

**What it is.** `eb.ref('users.age').gte(18)`, not `eb('users.age', '>=', 18)` ([EXPRESSIONS.md](EXPRESSIONS.md#why-methods-and-not-operator-strings)).

**Why.** Autocomplete lists only the methods the type has (a uuid shows `eq`, `ne`, `in`; a range shows `overlaps`); each method carries its own JSDoc, shown on hover; each method has its own operand type (`between` a pair, `in` a list, `like` a pattern), and its own null propagation.

**Alternatives.** Operator strings (quarry's own first version, and Kysely's `eb(a, '>=', b)`): every operator is offered for every type, and one signature has to compute the operand type from the operator string with a large conditional type, which is slow to check and gives poor errors.

**Cost.** None at run time: one generic `compare` and a table of operator names ([expression-methods.ts](expression-methods.ts)).

**Code.** [operators.ts](operators.ts), [expression-methods.ts](expression-methods.ts).

### Immutable builders

**What it is.** Every builder method returns a **new** builder with one change; the old one is untouched ([QUERIES.md](QUERIES.md#how-every-builder-is-built)).

**Why.** A base query can be reused (`const active = db.selectFrom(users).where(…)`, then `active.select(…)` twice) without one use changing the other, and composition helpers (`when`, `fragment`, `pipe`) can't corrupt their input.

**Alternatives.** Mutable builders (Knex): `q.where(…)` changes `q` itself, so sharing a base query is a classic source of bugs.

**Cost.** One small object allocation per method call while building a query, negligible next to running it.

**Code.** each `*-query-builder.ts`.

### What a builder still needs, in its type: `M` and `this` gating

**What it is.** Write builders carry a type parameter `M` listing what they still need: `'values'` for an insert, `'set' | 'where'` for an update, `'where'` for a delete. Each method removes what it provides (`set` returns `Exclude<M, 'set'>`), and `execute()` declares `this: WriteQueryBuilder<O, never>`, so it only exists once `M` is empty ([TYPES.md](TYPES.md#what-a-write-query-still-needs-m)).

**Why.** `db.deleteFrom(users).execute()` deletes every row. Making it a **type error** (naming the missing `'where'`) catches the mistake before it runs; an update or delete of every row has to be written as `allRows()`, which says so.

**Alternatives.** A run-time check only (fails in production rather than in the editor). A required `where` argument to `deleteFrom` (awkward with optional filters built in steps).

**Cost.** The error comes from a `this` mismatch, so its message is verbose (`Type '"where"' is not assignable to type 'never'`). `when(cond, …)` can't satisfy a requirement, since its callback may not run: a `where` inside `when` doesn't count.

**Code.** [write-query.ts](write-query.ts), [update-query-builder.ts](update-query-builder.ts), [delete-query-builder.ts](delete-query-builder.ts), [insert-query-builder.ts](insert-query-builder.ts); `Missing<M>` in [query.ts](query.ts).

### The locking clause as a state machine: `L`

**What it is.** A select's third type parameter records what its latest locking clause still accepts: `'none'`, `'strength'` (after `forUpdate()`), `'of'`, `'done'`. `of()` and `skipLocked()`/`noWait()` are gated with `this` parameters, so `.forUpdate().skipLocked().of(jobs)` is a type error ([TYPES.md](TYPES.md#the-locking-clause-l), [QUERIES.md](QUERIES.md#row-locking)).

**Why.** The order of the modifiers is fixed by SQL (`for update of t skip locked`), and getting it wrong is a syntax error at run time.

**Alternatives.** One options object, `forUpdate({ of, skipLocked })` (considered in #22's open questions); run-time checks only.

**Cost.** A type parameter on every select. `when` and `pipe` can only say "a piece may have added a clause", so after one the state becomes `'done'`. The run-time methods check the same rules again for code that casts around the types.

**Measured.** At 100 tables on the type benchmark, instantiations went up about 0.2% (1.102M → 1.105M), check time unchanged ([#22](https://github.com/shlokdesai33/quarry/pull/22)).

**Code.** [select-query-builder.ts](select-query-builder.ts) `LockState`, `LockAfter`.

### No `orWhere`: precedence is always explicit

**What it is.** `where` calls are always joined with `and`. An `or` is written as `eb.or([…])` inside one `where`.

**Why.** `.where(a).orWhere(b).where(c)` means `a or (b and c)` in SQL precedence, which surprises readers of long chains. Writing the `or` as a function makes its grouping visible.

**Alternatives.** Knex-style `orWhere` (what quarry's early `WhereBuilder` had). Kysely removed `orWhere` for the same reason.

**Code.** [where-builder.ts](where-builder.ts).

### `set` merges, `values` replaces

**What it is.** Calling `set` twice merges the assignments (the later value of a column wins); calling `values` again replaces the rows.

**Why.** An update naturally accumulates assignments (a `set` from shared code, then one more column); "insert these rows, and also these" is ambiguous, so the second call states the full list.

**Code.** [update-query-builder.ts](update-query-builder.ts), [insert-query-builder.ts](insert-query-builder.ts).

## Running queries

### Lazy result shapes, and `execute()` as the one way to run

**What it is.** A result shape (`expectOne()`, `takeFirst()`, …) doesn't run anything: it returns a `Query` that knows how to read the result. `execute()` runs it ([QUERIES.md](QUERIES.md#result-shapes)).

**Why.** A query value has to exist **without running** to be passed to `db.batch([…])`, which runs many in one round trip and needs each one's shape to type its result. With one way to run, there is one place for run options (`{ signal, timeout }`).

**Alternatives.** Shapes that run immediately (quarry before #23, and Kysely's `executeTakeFirst()`): such a query can't be batched.

**Cost.** A breaking change at the time, and one more call (`.execute()`) at every call site.

**Measured.** What batching buys ([#23](https://github.com/shlokdesai33/quarry/pull/23), medians): at 5 ms of network round-trip time, 5 point reads take 28.6 ms awaited one by one, 5.96 ms with `Promise.all`, 5.72 ms with `db.batch`; a transfer in a transaction (two updates and an insert) 22.8 ms (4 round trips), 17.2 ms (3), 5.86 ms (1).

**Code.** [shape.ts](shape.ts), [query.ts](query.ts).

### Awaiting a builder rejects

**What it is.** Builders and queries have a `then` that **rejects** with a hint, `A query runs with execute(), not when awaited…`, and whose type is `NotExecuted`, so `(await q.expectOne()).id` is a type error ([TYPES.md](TYPES.md#notexecuted-awaiting-a-builder)).

**Why.** Once shapes stopped running queries (#23), `await db.insertInto(t).values(v)` would otherwise silently do nothing: `await` on a non-promise just returns it.

**Alternatives.** Make builders real thenables that run when awaited (Drizzle does this): the query then runs whenever anything awaits it, including code that only meant to pass it along. A dev-only warning. Detecting never-executed builders with a `FinalizationRegistry` (not implemented).

**Cost.** Code that treats any thenable as a promise (returning a builder from an `async` function, for example) gets a rejection; that's intended, but surprising. Lint's `no-floating-promises` doesn't see the guard.

**Code.** `rejectAwait` in [query.ts](query.ts).

### Throwing is in the name: the `take…` and `expect…` split

**What it is.** `take…` shapes never throw for the number of rows (`takeFirst()` gives `T | undefined`); `expect…` shapes do (`expectOne()` throws `NoRowError` or `TooManyRowsError`), and each takes an optional `err` function to map the error ([QUERIES.md](QUERIES.md#names-that-tell-you-whether-they-throw)).

**Why.** You can tell from the call alone whether a line can fail on an empty result, without looking anything up. A shape returns a `Query`, which has no shape methods, so shapes can't be chained (`expectRows(1).takeFirst()` would make a `take` shape throw).

**Alternatives.** The earlier names `one`, `first`, `maybeOne`, `all` (#23): `first` and `one` both sound safe. Kysely's `executeTakeFirst` / `executeTakeFirstOrThrow`: the same idea with a suffix, which is how quarry arrived at the prefix rule.

**Cost.** Ten shape names to learn. `expectRows(n)` became a final shape (it had been a builder modifier), so it must come after `returning`.

**Code.** [shape.ts](shape.ts); errors in [executor.ts](executor.ts).

### No implicit LIMIT in result shapes

**What it is.** `takeFirst()` does not add `limit 1`, and `expectOne()` does not add `limit 2`. A shape only says how the rows are read; the SQL is the same whatever the shape. To fetch or lock fewer rows, use `limit()` ([QUERIES.md](QUERIES.md#shapes-never-change-the-sql)).

**Why.**

- The SQL you see in `toSQL()` and `onQuery` is what runs.
- The statement cache sees one statement per query, not one per shape.
- `forUpdate()` locks exactly the rows the query returns. With `limit 2` added by `expectOne()`, a lock query locked up to two rows; with `limit 1` added by `first()`, "the job I claimed" was an accident of the shape.
- `TooManyRowsError.count` is the real number of rows (5, not "at least 2"), because the count comes from the command tag over the whole result.

**Alternatives.** Add the limit, as quarry did before #27 and as most ORMs do (Prisma's `findFirst` adds `LIMIT 1`). Fewer rows travel, but the SQL depends on how you read it.

**Cost.** A `takeFirst()` over a large result makes the server produce and send every row (the client doesn't decode them: [next entry](#keeprows-instead-of-limit)). The fix is to write `.limit(1)`, which #27 exposed on selects for that reason.

**Code.** [shape.ts](shape.ts); `limit` in [select-query-builder.ts](select-query-builder.ts).

### `keepRows` instead of `limit`

**What it is.** Each shape asks the driver to decode and keep only the rows it reads: 1 for `takeFirst`/`expectFirst`/`takeValue`/`expectValue`, 2 for `expectOne`/`expectAtMostOne`, all for `execute`/`expectNonEmpty`. The driver still counts every row ([driver/DECISIONS.md](driver/DECISIONS.md#decode-only-the-rows-a-caller-keeps-keeprows)).

**Why.** It gets most of a limit's client-side saving (no decoding, no objects for unused rows) without changing the SQL ([previous entry](#no-implicit-limit-in-result-shapes)). `takeValue` also asks for array rows, so the first column is read by position.

**Cost.** A value that fails to decode in a skipped row goes unnoticed. The rows still cross the network.

**Code.** [shape.ts](shape.ts); `keepRows` in [driver-executor.ts](driver-executor.ts).

### A write's `execute()` with `returning` resolves to the rows

**What it is.** Without `returning`, a write resolves to `{ rowCount }`; with it, to the returned rows ([TYPES.md](TYPES.md#writes-returning-and-writeoutput)).

**Why.** It mirrors select, where no shape means "every row". The alternative, always `{ rowCount }`, makes the common `insert … returning id` need a shape.

**Code.** `WriteOutput` in [write-query.ts](write-query.ts).

### `db.batch`: two modes with names

**What it is.** `db.batch([…])` runs queries together in one round trip, each independent; `db.batch([…], { transaction: true })` runs them atomically, still in one round trip unless a result has to be checked first ([EXECUTION.md](EXECUTION.md#batches)). The wire framing is a driver decision ([driver/DECISIONS.md](driver/DECISIONS.md#dbbatch-framing-one-write-with-commit-pipelined-unless-results-are-checked)).

**Why.** "Run these together" and "run these atomically" fail differently: in the first, the others still commit and you get a `BatchError` with each position's outcome; in the second, nothing commits. The API names which one you meant.

**Alternatives.** `Promise.all` over the pool (several connections; several round trips for a transaction). An opt-in `{ settle: true }` that resolves to settled results instead of rejecting (an open question from #23).

**Cost.** In the one-round-trip atomic form, COMMIT is sent before results are decoded, so a decode failure surfaces after the commit. Any `expect…` shape makes COMMIT wait for its check, costing a second round trip.

**Code.** [batch.ts](batch.ts), [database.ts](database.ts), [driver-executor.ts](driver-executor.ts) `batch`.

### `stream()`: only for every-row reads, and it runs immediately

**What it is.** `stream()` exists on select builders, not on shaped queries (`q.expectOne().stream()` is a type error), returns a `RowStream`, and starts when iterated rather than through `execute()` ([EXECUTION.md](EXECUTION.md#streaming)). Its `timeout` is refused inside a transaction.

**Why.** A shape reads a handful of rows; streaming is for results too large to hold. A stream is consumed by iteration, so there is nothing for `execute()` to resolve to. The timeout is set before the cursor and restored before its Sync, so it holds the connection between batches, which a transaction, whose other queries run between them, can't allow ([driver/DECISIONS.md](driver/DECISIONS.md#a-statement-timeout-bounds-the-whole-stream)).

**Alternatives.** An async generator (slower per row: [driver/DECISIONS.md](driver/DECISIONS.md#rowstream-a-hand-written-iterator-instead-of-an-async-generator)); a timeout inside a transaction by saving and restoring `statement_timeout` (an open question).

**Cost.** Over a pool, a stream holds one connection from its first batch until it ends (released on `break`, `return`, a throw or an abort).

**Code.** `stream` in [select-query-builder.ts](select-query-builder.ts); [driver-executor.ts](driver-executor.ts) `stream`; the driver's [row-stream.ts](driver/row-stream.ts).

## Compiling to SQL

### A node tree, and one compiler

**What it is.** Builders and expressions produce plain data, a tree of nodes ([node.ts](node.ts)); one function, `compile` ([compile.ts](compile.ts)), turns any tree into SQL text and parameters ([COMPILER.md](COMPILER.md)).

**Why.** Quoting, parenthesising and parameter numbering are written once. The tree can be inspected (`toNode()`) and tested without a database. New features (#30's `setEach`, #32's `case`) reuse existing node kinds instead of adding renderers.

**Alternatives.** Builders that concatenate SQL strings as they go (Knex): each method has to get quoting and precedence right. Kysely uses the same node-tree idea (`OperationNode`).

**Cost.** One more layer: a feature needs a node shape and a renderer case, not just a method.

**Code.** [node.ts](node.ts), [compile.ts](compile.ts).

### References resolved before compiling

**What it is.** `'users.firstName'` is turned into the database names (`"users"."first_name"`, or the alias's name) when the builder method is called, not in `compile`.

**Why.** `compile` needs no schema and can't get a name wrong; the tree holds exactly what will be written.

**Code.** `resolve` in [expression-builder.ts](expression-builder.ts).

### Columns resolved and quoted once per table

**What it is.** Each table's column is resolved once into a shared, immutable reference node, typed expression and selection node, and the compiler renders their SQL (`"users"."email"`, `"users"."email" as "email"`) once, when the column is first resolved. A single table's expression builder is made once. Quoted identifiers are memoised in a bounded map. There is no cache of whole compiled queries ([COMPILER.md](COMPILER.md#what-is-rendered-once)).

**Why.** Once #37 let builder queries pipeline, the builder became client-CPU bound: about 19 µs per point lookup against 4.4 µs for the driver's own `pool.query`. Its profile had a quarter of the time in capturing the call site ([above](#errors-carry-the-query-hidden-and-the-code-awaiting-it)), 15% in quoting names, and more in making an expression builder per query (with its `fn` and `json` closures), a `WeakMap` entry per column reference per query (for the `undefined`-comparison error), a `Set` per `select`, and the garbage collection all of that caused. A query's names are the same every time it runs; only its values change.

**Alternatives.**

- A cache of SQL and parameter plans keyed by the query's shape: the key has to be computed from the query's nodes, which the builder makes anew on every call, so building it walks the same tree that rendering from cached fragments walks. It saves nothing measurable, and adds invalidation rules. What it would have saved in the driver came later, without a separate key: [SQL rendered through a trie of its pieces](#sql-rendered-through-a-trie-of-its-pieces).
- Cache rendered SQL for every node: nodes made per query (values, comparisons, `.as()` selections) would each add a `WeakMap` entry per query, which costs more than rendering them. Only the shared column nodes are kept.
- Reuse builder state between chained calls (mutable builders): builders are immutable by design ([Immutable builders](#immutable-builders)); the copy per chained call measured about 70 ns of a point lookup's 800 ns build.

**Cost.** A `WeakMap` per table of its resolved columns (as many entries as columns used), the compiler's `WeakMap` of their SQL, and a map of up to 4,096 quoted names. A shared single-table expression builder is frozen, so a callback can't change it for other queries. Nodes must stay immutable: code that changed a shared node would change every query using it (nothing does; node types are `readonly`).

**Measured.** In-process, a mock executor (build and compile only, Node 24): point lookup (`selectFrom(users).where(id).select([6 columns]).execute()`) 5.7 → 0.8 µs, single-row insert 1.6 → 1.3 µs, update by key 2.0 → 0.8 µs. Through a pool of 10 at 100 concurrent callers and 0 ms round trip, with call sites captured on failure and the driver's statement cache keyed by SQL ([driver/DECISIONS.md](driver/DECISIONS.md#statements-keyed-by-their-sql-with-the-declared-types-compared)), client CPU per point lookup went from 21.3 to 4.8 µs (`pool.query`: 4.4 µs) and throughput from 49k to 211k ops/s (one process, the sources run directly). The driver benchmark suite (#6), with the built package, a fresh process per cell, before and after interleaved in one session, median of 5 runs:

| Query                 | Round trip | Callers | Before: ops/s (p50 ms) | After: ops/s (p50 ms) | Client CPU µs/op | `pool.query`: ops/s, CPU µs/op |
| --------------------- | ---------- | ------- | ---------------------- | --------------------- | ---------------- | ------------------------------ |
| point lookup          | 0 ms       | 1       | 20,227 (0.04)          | 29,466 (0.03)         | 37.8 → 20.1      | 33,654, 15.4                   |
| point lookup          | 0 ms       | 100     | 51,077 (1.57)          | 186,582 (0.44)        | 21.3 → 6.0       | 233,004, 4.6                   |
| point lookup          | 0 ms       | 1000    | 50,146 (17.82)         | 180,483 (4.54)        | 23.7 → 6.4       | 249,924, 4.3                   |
| point lookup          | 5 ms       | 1       | 166 (6.00)             | 168 (5.96)            | 392.1 → 335.4    | 169, 281.8                     |
| point lookup          | 5 ms       | 100     | 15,506 (6.47)          | 15,793 (6.35)         | 30.4 → 15.2      | 15,930, 9.0                    |
| point lookup          | 5 ms       | 1000    | 46,268 (20.18)         | 133,222 (7.06)        | 24.9 → 6.9       | 148,808, 3.2                   |
| insert one row        | 0 ms       | 1       | 23,979 (0.04)          | 29,441 (0.03)         | 28.6 → 20.9      | 34,505, 15.1                   |
| insert one row        | 0 ms       | 100     | 81,066 (1.06)          | 159,774 (0.52)        | 13.3 → 6.8       | 175,881, 5.8                   |
| insert one row        | 0 ms       | 1000    | 80,500 (11.04)         | 175,453 (4.95)        | 13.7 → 6.3       | 184,836, 5.6                   |
| insert one row        | 5 ms       | 1       | 168 (5.94)             | 168 (5.94)            | 344.7 → 320.0    | 169, 266.3                     |
| insert one row        | 5 ms       | 100     | 16,236 (6.08)          | 15,977 (6.27)         | 21.9 → 15.9      | 15,812, 8.1                    |
| insert one row        | 5 ms       | 1000    | 80,346 (11.28)         | 132,493 (7.09)        | 13.8 → 6.4       | 143,059, 3.3                   |
| update one row by key | 0 ms       | 1       | 22,367 (0.04)          | 28,945 (0.03)         | 29.4 → 18.6      | 31,745, 14.7                   |
| update one row by key | 0 ms       | 100     | 78,128 (1.06)          | 152,170 (0.13)        | 13.9 → 7.2       | 156,053, 6.7                   |
| update one row by key | 0 ms       | 1000    | 75,789 (11.04)         | 164,800 (4.05)        | 15.3 → 6.7       | 161,480, 6.4                   |
| update one row by key | 5 ms       | 1       | 167 (5.97)             | 168 (5.94)            | 353.4 → 320.5    | 169, 257.4                     |
| update one row by key | 5 ms       | 100     | 16,053 (6.15)          | 15,992 (6.22)         | 22.8 → 12.7      | 16,050, 8.2                    |
| update one row by key | 5 ms       | 1000    | 79,059 (10.98)         | 126,976 (7.49)        | 14.5 → 5.2       | 133,682, 3.0                   |

The driver suite on a 4-vCPU VM (client on 2 CPUs, PostgreSQL 18 on the other 2), Node 24, a pool of 10; `pool.query` runs the same statement written by hand (`pk`, `insert1`, `update`). At 0 ms with 100 or 1000 callers, the builder now reaches 72–100% of the driver's own throughput (point lookups 72–80%, writes 91–102%), against 20–50% before. At 5 ms with 100 callers, every configuration is bound by the round trip (100 callers per 6 ms), so throughput doesn't move, but CPU per query falls by a third to a half. With 1000 callers at 5 ms, the builder's CPU, not the round trip, was the limit before. With one caller, each query waits for its own round trip, so the CPU saved per query (38 → 20 µs for a point lookup) shows up as latency: 20k → 29k lookups/s at 0 ms.

**Code.** `resolveColumn`, `expressionBuilder` in [expression-builder.ts](expression-builder.ts); `shareColumn`, `identifier` in [compile.ts](compile.ts); [test/builder-caches.test.ts](../test/builder-caches.test.ts).

### SQL rendered through a trie of its pieces

**What it is.** The compiler doesn't concatenate a query's SQL: it walks a trie keyed by the pieces it writes (keywords, quoted names, a shared column's SQL, placeholders), and the node a query ends on holds its SQL, made once. A query of a shape rendered before gets the same string object. With it:

- `selectAll` and `returningAll` add one frozen list per table (`allSelections`), whose text and result codecs the compiler renders once.
- The executor reads its session-statement regular expression only for SQL written by hand.
- The result shapes without an `err` are made once.

([COMPILER.md](COMPILER.md#what-is-rendered-once), [EXECUTION.md](EXECUTION.md#connections-shared-or-exclusive))

**Why.** After #39, a builder point lookup (`selectFrom(users).where(id).selectAll().expectOne()`) still cost about 6.3 µs of client CPU, against 2.1 µs for the same SQL through `pool.query`, which capped it at 150–179k/s against the driver's 368–464k at 0 ms. Its profile had three items the driver doesn't pay:

- **The driver hashing a new string per query.** The statement cache is keyed by the SQL. A string used again keeps its hash, but the builder concatenated a new one for every query, so the driver flattened it, hashed it and compared its ~230 characters (6.5% of samples).
- **`selectAll` resolving its columns again** per query: it built each `table.column` string and looked it up in the scope's `Map`, which hashed every new string (21%).
- **`#shared`'s regular expression** over every query's SQL, which can't match a compiled select or write (4%).

**Alternatives.**

- A cache of whole compiled queries keyed by shape ([above](#columns-resolved-and-quoted-once-per-table)): its key costs a walk of the query's new nodes, as much as rendering. In the trie, rendering is the lookup: each step compares the piece with the child taken last (the same object when the shape repeats), so finding the shape costs what concatenating cost, and nothing needs invalidating.
- Interning the rendered string in a `Map`: the lookup hashes the string, which is the cost being removed.
- Caching the SQL on a builder instance: builders are made anew for each query, so it would only help code that keeps one.
- A precomputed statement key passed to the driver: it needs the same identity, and a second key next to the SQL in the driver's cache.

**Cost.**

- One more structure in the compiler, with bounds: a query's path stops at 1,024 pieces or at a piece over 4,096 characters, and the rest is concatenated as before. The trie starts over at 16,384 prefixes or about a million characters.
- Shapes made at run time (literals, `in` lists of new lengths) add prefixes until it starts over.
- The shared column lists must stay immutable: they are frozen, and their nodes were already shared.
- `isDataStatement` relies on `compile` marking only select, insert, update and delete nodes. A copy of a compiled query (`{ ...query }`) is tested by the regular expression, as raw SQL is.
- A rewrite of `rowsNode` with `Object.keys` measured 0.3 µs less per insert in-process, but put inserts at 1000 callers and 5 ms into a slower JIT mode in about half the runs (−5% throughput). It was reverted to `Object.entries`, resolving each column once.

**Measured.** The driver benchmark suite (#6), with the built package, `main` (`337fc4f`) against this change interleaved in one session, a fresh process per cell, median of 5 runs, a pool of 10. The driver suite on an 8-vCPU VM: client on CPUs 0–2, PostgreSQL 18 on 4–7, Node 24.22. `pool.query` runs the same statement written by hand (`pk`, `insert1`, `update`).

| Query                 | Round trip | Callers | Before: ops/s (p50 ms) | After: ops/s (p50 ms) | Client CPU µs/op | `pool.query`: ops/s, CPU µs/op |
| --------------------- | ---------- | ------- | ---------------------- | --------------------- | ---------------- | ------------------------------ |
| point lookup          | 0 ms       | 1       | 25,824 (0.04)          | 28,857 (0.03)         | 25.4 → 20.2      | 30,049, 17.2                   |
| point lookup          | 0 ms       | 100     | 162,622 (0.49)         | 266,292 (0.29)        | 6.9 → 4.2        | 418,372, 2.6                   |
| point lookup          | 0 ms       | 1000    | 172,753 (4.93)         | 287,665 (2.91)        | 6.9 → 4.1        | 443,607, 2.5                   |
| point lookup          | 5 ms       | 1       | 164 (6.13)             | 165 (6.08)            | 396.7 → 347.4    | 164, 320.1                     |
| point lookup          | 5 ms       | 100     | 15,638 (6.44)          | 15,813 (6.35)         | 16.0 → 12.9      | 15,736, 9.1                    |
| point lookup          | 5 ms       | 1000    | 154,776 (6.02)         | 155,297 (6.30)        | 7.3 → 4.7        | 158,987, 3.1                   |
| insert one row        | 0 ms       | 1       | 27,560 (0.03)          | 27,786 (0.03)         | 22.4 → 21.9      | 31,081, 16.8                   |
| insert one row        | 0 ms       | 100     | 176,631 (0.45)         | 195,921 (0.40)        | 6.2 → 5.6        | 211,676, 4.8                   |
| insert one row        | 0 ms       | 1000    | 214,793 (3.94)         | 235,935 (3.59)        | 5.3 → 4.9        | 193,247, 5.3                   |
| insert one row        | 5 ms       | 1       | 164 (6.12)             | 164 (6.12)            | 404.5 → 379.9    | 166, 333.5                     |
| insert one row        | 5 ms       | 100     | 15,654 (6.40)          | 15,767 (6.38)         | 15.5 → 15.0      | 16,035, 9.5                    |
| insert one row        | 5 ms       | 1000    | 158,585 (6.04)         | 158,865 (6.05)        | 6.2 → 5.5        | 165,787, 3.9                   |
| update one row by key | 0 ms       | 1       | 25,452 (0.04)          | 24,806 (0.04)         | 20.9 → 20.8      | 27,177, 16.6                   |
| update one row by key | 0 ms       | 100     | 202,546 (0.39)         | 206,647 (0.29)        | 5.4 → 5.3        | 218,819, 4.7                   |
| update one row by key | 0 ms       | 1000    | 223,487 (4.01)         | 219,893 (4.13)        | 5.2 → 5.2        | 227,179, 4.7                   |
| update one row by key | 5 ms       | 1       | 163 (6.17)             | 163 (6.14)            | 393.1 → 372.2    | 166, 303.6                     |
| update one row by key | 5 ms       | 100     | 15,384 (6.56)          | 15,503 (6.46)         | 13.5 → 12.5      | 15,583, 8.3                    |
| update one row by key | 5 ms       | 1000    | 166,578 (5.68)         | 168,300 (5.59)        | 5.5 → 5.4        | 170,688, 4.3                   |

At 0 ms with 100 or 1000 callers, point lookups go from 39% to 64–65% of the driver's own throughput (163–173k → 266–288k/s). Their client CPU falls from 6.9 to 4.1–4.2 µs, against `pool.query`'s 2.5–2.6. Single-row inserts gain 10–11% (93% of `pool.query` at 100 callers, ahead of it at 1000), measured in a second session with the final `rowsNode`. Updates are bound by the server's update work, and don't move. At 5 ms with 100 or 1000 callers, every builder statement is within 5% of `pool.query` before and after, with less CPU per query.

In one process (the sources run directly, 100 callers, 0 ms, one core), a lookup went from 6.3 to 3.2–3.4 µs (`pool.query`: 2.3). Build and compile with a mock executor went 1.69 → 0.5 µs, and compile alone 270 → 130 ns. The executor and the driver add nothing over `pool.query` for the same SQL and options. What is left is the builder chain itself (about 0.5 µs: four immutable builders, the where node, the shape and `Query`), its async `execute` layers, and their garbage.

**Code.** `Prefix`, `write`, `sharedList`, `isDataStatement` in [compile.ts](compile.ts); `allSelections` in [expression-builder.ts](expression-builder.ts); `changesSession` in [driver-executor.ts](driver-executor.ts); the shapes in [shape.ts](shape.ts); [test/builder-caches.test.ts](../test/builder-caches.test.ts).

### Every identifier quoted

**What it is.** Table and column names are always written in double quotes (`"users"."createdAt"`).

**Why.** No reserved-word list to keep in sync (`user`, `order` and `group` are reserved), and mixed case is preserved. An unquoted `createdAt` is folded to `createdat` by Postgres.

**Alternatives.** Quote only when needed (pg-format): needs Postgres's keyword list, per version.

**Cost.** The SQL in logs is noisier to read.

**Code.** `identifier` in [compile.ts](compile.ts).

### Parameters everywhere, literals only where Postgres refuses a parameter

**What it is.** Every value becomes a parameter (`$1`), except in the few places Postgres takes no parameter or where a parameter would change the plan: `is true`/`is null` keywords, an empty `in` (rendered as `false`), jsonb path keys, `date_trunc`/`extract` units, cast targets, and `sql.lit` ([COMPILER.md](COMPILER.md#literals)).

**Why.** Parameters make SQL injection impossible and keep the SQL text constant, so the driver's statement cache gets hits. The exceptions: `x is $1` is a syntax error; `x in ()` is too; and an expression index on `settings->>'theme'` only matches a query whose key is written the same way, as a literal.

**Cost.** Each literal place needs a check that the value is what it should be (`is` takes only `true`, `false` or `null`; units come from a fixed list; cast targets from an allowlist), and strings are escaped like Postgres's own `quote_literal`, refusing NUL.

**Code.** [comparison.ts](comparison.ts), [json.ts](json.ts), [functions.ts](functions.ts), `stringLiteral` in [compile.ts](compile.ts), [sql.ts](sql.ts).

### Parameters numbered in text order, and `in` as `= any($1)`

**What it is.** `$1, $2, …` follow their position in the SQL text. `in` over a JavaScript array compiles to `= any($1)` with one array parameter, not `in ($1, $2, …)`.

**Why.** Identical queries give identical SQL, whatever order the builder methods were called in and however long the list is, so the statement cache sees one statement. One array parameter also avoids Postgres's limit of 65,535 parameters.

**Alternatives.** `in ($1, …, $n)` (most builders): a different statement per list length.

**Code.** [compile.ts](compile.ts); [comparison.ts](comparison.ts).

### Every operation operand bracketed

**What it is.** An operand that is itself an operation is always wrapped in parentheses: `(not (…)) is null` ([COMPILER.md](COMPILER.md#rendering-expressions-render)).

**Why.** Without it, `not (x) is null` is read by Postgres as `not (x is null)`, a different condition (bug 1 of #32's audit). A precedence table would bracket less, but every new operator would have to be placed in it correctly.

**Cost.** Some redundant parentheses in the SQL.

**Code.** `rendersAsOperation` in [compile.ts](compile.ts).

### Codecs as getters on the compiled query

**What it is.** `CompiledQuery.paramCodecs` and `resultCodecs` are getters, not own properties.

**Why.** A compiled query prints, logs and compares as `{ sql, params }` (in `toSQL()`, test snapshots and `toEqual`), while the executor can still read the codecs.

**Code.** [compile.ts](compile.ts).

## Values, codecs and types

### The driver owns the codecs; the builder only chooses them

**What it is.** Each column's `DataType` names one driver codec. The builder records which codec applies to each parameter and result column; the driver encodes and decodes ([EXECUTION.md](EXECUTION.md#how-the-builder-picks-codecs)). The full reasoning is a driver entry: [codecs owned by the driver, chosen by the caller](driver/DECISIONS.md#codecs-owned-by-the-driver-chosen-by-the-caller).

**Why (builder side).** quarry adds no per-row work of its own, and the driver can pick binary formats per column.

**Measured.** Performance-neutral through the builder: −2% to +2% across 12 cells ([#28](https://github.com/shlokdesai33/quarry/pull/28)).

**Code.** [kind-codecs.ts](kind-codecs.ts), [data-type/](data-type/).

### TypeScript types derived from codecs

**What it is.** A column's select type is computed from its codec's output type (`Out<K>`), and `useCodec(codec)` changes both together ([column/README.md](column/README.md#kindcodecs-the-codec-of-each-factory)).

**Why.** The declared type can't drift from what the driver returns: before #28, the column types claimed `date` was a `string` while node-postgres's defaults returned a `Date`.

**Code.** [kind-codecs.ts](kind-codecs.ts), [column/](column/README.md).

### `DataType` separate from the column

**What it is.** A column (`Column`) holds nullability, write rules and its TypeScript types; its SQL type is a separate `DataType` object (`kind`, codec, modifiers such as `varchar(320)`) ([data-type/README.md](data-type/README.md)).

**Why.** Comparisons, operators and encoding depend only on the SQL type, so an expression (`lower(email)`) and a column share the same rules and methods. Nullability and "never written" belong to a column, not to a type.

**Alternatives.** One class per column type with its rules built in (an expression would then need its own parallel classes).

**Code.** [data-type/](data-type/README.md).

### Enums and custom types keyed by name in their type

**What it is.** An enum's `DataType` carries its Postgres name as a type parameter (`EnumType<'order_status'>`); `defineType` codecs carry theirs.

**Why.** Two enums never compare in Postgres, even with the same labels, so they mustn't in quarry: different names make different types.

**Cost.** Their OIDs aren't known in advance, hence [the catalog](#the-type-catalog-loaded-before-the-first-query).

**Code.** [data-type/enum.ts](data-type/enum.ts), [define-enum.ts](define-enum.ts), [define-type.ts](define-type.ts).

### `undefined` is refused; optional filters use `when()`

**What it is.** Comparing with `undefined` throws at build time, with a message that shows the `when()` form; the driver refuses `undefined` parameters too. `null` is SQL NULL. In `values` and `set`, `undefined` still means "leave this column out" ([EXPRESSIONS.md](EXPRESSIONS.md#undefined-is-refused)).

**Why.** `where('users.email', maybeEmail)` with `maybeEmail` undefined compiled to `= NULL`, which matches nothing: an optional filter that silently returns no rows. The fix the error suggests, `.when(value !== undefined, …)`, says what was meant.

**Alternatives.** Send `undefined` as NULL (node-postgres), or drop the condition (Prisma ignores `undefined` filters, which turns a typo into "match everything").

**Cost.** Code that relied on `undefined` as NULL has to pass `null`.

**Code.** [comparison.ts](comparison.ts); [#8](https://github.com/shlokdesai33/quarry/pull/8).

### `eb.val` declares a type from its JavaScript type

**What it is.** A bare `eb.val(x)` (not compared with a column) is sent with a declared type chosen from its JavaScript type: a string as `text`, an integer as `integer`, other numbers as `double precision`, a boolean, a `bigint`, a `Date` as `timestamptz` ([EXPRESSIONS.md](EXPRESSIONS.md#parameters-ebval)). Compared with a column, it uses the column's codec instead.

**Why.** `fn.concat('…', eb.val(' / '))` failed with "could not determine data type of parameter": in a function call there is no column to infer from (bug 6 of #32). And `eb.val(1).as('one')` arrived as the string `'1'`, contradicting its type `number` (bug 7).

**Alternatives.** Leave it untyped (the server can't always infer it); require a codec (`eb.val(x, codec)`, still available).

**Code.** `codecOfValue` in [expression.ts](expression.ts).

### `= any($1)` gets a declared type only for integer and boolean columns

**What it is.** For `column = any($1)`, the parameter's array type is declared (so it can be sent in binary) only for `smallint`, `integer`, `bigint` and `boolean` columns, and only when the left side is a plain column ([#19](https://github.com/shlokdesai33/quarry/pull/19)).

**Why.** Declaring text, uuid, float8 or timestamptz could change the comparison, or fail, if the real column differs from the schema (a `citext` column declared as `text`, `real` declared as `double precision`, `timestamp` declared as `timestamptz`). Integers and booleans can't be misread that way.

**Measured.** `id = any($1)` with 1,000 ids: 479 → 514 queries/s on Node ([#19](https://github.com/shlokdesai33/quarry/pull/19)).

**Code.** [comparison.ts](comparison.ts); [driver/DECISIONS.md](driver/DECISIONS.md#binary-array-parameters-with-a-per-array-fallback).

### Arithmetic follows Postgres's result types

**What it is.** `plus`, `minus`, `times`, `dividedBy` and `mod` exist only for the kinds Postgres has them for, and their result has Postgres's type: `timestamptz - timestamptz` is an `interval`, `date - date` an `integer`, `date + number` a `date`, `integer + bigint` a `bigint`, and integer division truncates ([EXPRESSIONS.md](EXPRESSIONS.md#arithmetic)). A value operand is sent with the other side's declared type.

**Why.** The result's SQL type decides its methods and its codec, so it has to be the type Postgres will really return. Declaring the operand's type avoids `operator is not unique` errors (`timestamptz - $1` could be a timestamp or an interval).

**Cost.** A result-type table per operator. `mod` only for exact kinds.

**Code.** [expression-methods.ts](expression-methods.ts), [operators.ts](operators.ts).

### `case`: the first result fixes the SQL type

**What it is.** In `eb.case().when(c, a).when(d, b).else(x).end()`, the first result's SQL type is the expression's type; later values are sent with that type declared. The TypeScript type is the union of the branches, plus `null` without `else` ([EXPRESSIONS.md](EXPRESSIONS.md#case)).

**Why.** Postgres resolves a `case`'s type from all its branches, and a parameter branch has no type of its own: declaring every value with the first result's type makes the resolution certain.

**Code.** [case.ts](case.ts).

### The type catalog loaded before the first query

**What it is.** The executor waits for the driver to look up named types (enums, `vector`, `defineType` codecs) in `pg_type` before its first operation ([EXECUTION.md](EXECUTION.md#the-type-catalog)).

**Why.** Without it, the first queries would send enum parameters untyped and read `vector` columns as text, behaving slightly differently from the same queries a moment later.

**Alternatives.** `catalog: false`: don't wait; the driver loads it in the background behind the first query that needs it.

**Cost.** One catalog query (one round trip) before the first query of each pool.

**Code.** `#prepare` in [driver-executor.ts](driver-executor.ts); [driver/DECISIONS.md](driver/DECISIONS.md#named-types-resolved-once-per-pool-through-the-catalog).

### Raw SQL only through the `sql` template tag

**What it is.** `` sql`…` `` fragments and `` db.sql`…` `` statements must be called as **template literals**; interpolated values become parameters, and only `sql.id`, `sql.lit`, `sql.join`, expressions and tables are written into the text. Passing an ordinary string (`sql(userInput)`) is refused at run time ([EXPRESSIONS.md](EXPRESSIONS.md#raw-sql-fragments)).

**Why.** An escape hatch is needed (no builder covers all of SQL), but it must stay injection-safe. A template literal's fixed parts are always code you wrote; checking for the `raw` property that only template calls have rules out a concatenated string.

**Alternatives.** Kysely's `sql.raw(string)` and Drizzle's `sql.raw`: convenient, and the usual way injection gets back in. quarry offers `sql.id`/`sql.lit` for the cases those cover.

**Cost.** A fragment has no SQL type, so it has no comparison methods, and its result is decoded by the server's type (`sql<T>` only sets the TypeScript type).

**Code.** [sql.ts](sql.ts).

## Bulk writes

### Many rows through `unnest`, one array per column

**What it is.** A multi-row insert sends one **array parameter per column** and expands them with `unnest`: `insert into t (a, b) select * from unnest($1::integer[], $2::text[])` ([COMPILER.md](COMPILER.md#insert)).

**Why.**

- The SQL text is the same for 2 rows or 100,000, so one prepared statement serves every batch size.
- The parameter count is the column count, far from Postgres's limit of 65,535 parameters (a 10-column `values` list hits it at 6,553 rows).
- Each array is encoded once by its column's codec, in binary where the driver can ([driver/DECISIONS.md](driver/DECISIONS.md#binary-array-parameters-with-a-per-array-fallback)).

**Alternatives.** `values ($1, $2), ($3, $4), …` (Kysely, Drizzle, Prisma): a statement per row count, and the parameter limit.

**Cost.** Array columns can't go through `unnest` (it flattens them), nor can expressions or `default` holes, so such inserts fall back to a `values` list (`unnestable` in [compile.ts](compile.ts)). The SQL is less familiar to read.

**Measured.** With binary arrays ([#19](https://github.com/shlokdesai33/quarry/pull/19)): bulk insert of 1k rows 514 → 674 queries/s, 10k rows 58 → 75 (Bun.sql: 611 and 63); through the builder, 1,000 rows × 8 columns 5.83 → 3.94 ms.

**Code.** `renderInsert` in [compile.ts](compile.ts); [insert-query-builder.ts](insert-query-builder.ts).

### `unnest` casts without type modifiers

**What it is.** The casts are `$2::varchar[]`, not `$2::varchar(3)[]`.

**Why.** Casting to `varchar(3)` **truncates** silently, so a too-long value was cut instead of rejected. Without the modifier, the value reaches the column, which fails with 22001 as a single-row insert does (a bug fixed in #19).

**Code.** [compile.ts](compile.ts).

### `setEach`: one method for the source, the assignments and the key match

**What it is.** `db.update(t).setEach(rows, { key: 'id' })` updates each row to its own values in one statement: `update t set … from unnest(…) as "row"(…) where t.id = row.id` ([QUERIES.md](QUERIES.md#bulk-update-seteach), [COMPILER.md](COMPILER.md#update-and-seteach)). It replaced the separate `updateMany` (#30).

**Why.** In Kysely's recipe you write the `from (values …)`, the assignments and the `whereRef` by hand, and forgetting the `whereRef` updates every row from an arbitrary source row. Generating the key match removes that mistake, and lets it count as the update's required `where` at the type level. Being part of the ordinary update builder, `setEach` combines with `set` (a common value for every row, or an expression over `row.*`), extra `where`s, `returning` and every shape.

**Alternatives.** Kysely's `from(values(rows))` + `set` + `whereRef` (one parameter per cell; different SQL per row count; types inferred from the first row). A separate `updateMany` builder (quarry before #30): a second builder to keep in step with `update`.

**Cost.** Array columns and expression values are rejected at compile time (the `unnest` limitation, with no `values` fallback for updates yet). Zero rows throw at build time rather than doing nothing, as inserts do, which forces an `if (rows.length)` guard in sync jobs (an open question).

**Measured.** 1,000 rows × 8 columns through the builder, with binary arrays: 7.00 → 4.96 ms ([#19](https://github.com/shlokdesai33/quarry/pull/19), as `updateMany`).

**Code.** `setEach` in [update-query-builder.ts](update-query-builder.ts).

### Rows that set different columns: flag columns and `case`

**What it is.** A column that some rows leave out gets a boolean flag column, `"set:stock"`, sent as one more `bool[]`, and the assignment becomes `case when "row"."set:stock" then "row"."stock" else "products"."stock" end`. Columns every row sets are assigned directly.

**Why.** `undefined` in a row means "keep the current value" and `null` means "set it to NULL", the same as in `set()`. An array can only carry NULL, not "absent", so absence needs its own column. Without this, rows would have to share the same keys (which Kysely's recipe assumes).

**Alternatives.** Group rows by which columns they set and run a statement per group (more round trips and statements); `coalesce(row.col, t.col)` (can't set a column to NULL).

**Cost.** One extra array parameter and a `case` per varying column. The flag names (`set:<column>`) and the default alias `row` are reserved by convention (an open question in #30), and `as` can't equal the table's name.

**Code.** [update-query-builder.ts](update-query-builder.ts); the `case` node from [case.ts](case.ts).

### `setEach` rows are typed by the table, and duplicate keys are refused

**What it is.** The rows' type comes from the target table (`SetEachRow<T, K>`): key columns required and non-null, only writable columns allowed. At run time, a row without its key, or two rows with the same key, throw before anything is sent ([TYPES.md](TYPES.md#seteach-rows-in-scope)).

**Why.** Inferring the type from the first row (Kysely's recipe) accepts misspelled or read-only columns. Two rows with the same key make Postgres update the row from either one, unpredictably; the error reports row indexes, not values, so it can't leak data into logs.

**Code.** `checkEachRows` in [update-query-builder.ts](update-query-builder.ts).

## Joins and selections

### Outer joins make the joined side nullable: `NullableTable`

**What it is.** After `leftJoin(posts)`, the scope holds `NullableTable<typeof posts>`, whose columns' select types gain `| null`; `rightJoin` does the same to the tables already joined and to the row already selected; `fullJoin` does both ([TYPES.md](TYPES.md#outer-joins-nullabletable)).

**Why.** A left join's unmatched rows have NULL in every joined column, even `not null` ones; without this, `row.title` would be typed `string` and arrive as `null`.

**Alternatives.** Rebuild the scope as plain `{ $select, dataType }` entries (Kysely's model, recommended in an early review): a larger refactor. The chosen form changes only `$select`, so comparisons, codecs and methods stay the column's.

**Cost.** One mapped type per outer join; `rightJoin`/`fullJoin` also map the row so far.

**Code.** [table.ts](table.ts) `NullableTable`; joins in [select-query-builder.ts](select-query-builder.ts).

### A table joined twice, or a key selected twice, is refused

**What it is.** Joining a table already in the query without an alias, or selecting a key the row already has, is a type error (through an impossible extra argument, [below](#errors-as-an-impossible-extra-argument)) and a build-time error ([TYPES.md](TYPES.md#newname-and-uniquekeys-the-same-trick-for-joins-and-selections)).

**Why.** Both silently corrupted results: an ambiguous reference resolved to the first table, and a duplicate key lost a column in object rows (bugs 2 and 3 of #32's audit).

**Code.** `NewName`, `UniqueKeys` in [select-query-builder.ts](select-query-builder.ts) and [row.ts](row.ts); `#joined`, `checkUniqueKeys`.

### `selectAll` lists the columns, never `*`

**What it is.** `selectAll('users')` writes every column out (`"users"."id" as "id", "users"."first_name" as "firstName", …`).

**Why.** Each column needs its TypeScript key (an alias when it differs from the database name) and its codec. `*` would return database names, in the database's order, including columns the code doesn't declare.

**Cost.** Longer SQL text. Not per query: the list is one frozen array of the table's shared selections, made once per table, and the compiler renders its text once ([SQL rendered through a trie of its pieces](#sql-rendered-through-a-trie-of-its-pieces)). Building each column's `table.column` reference string and resolving it per query had been a fifth of a builder lookup's client CPU.

**Code.** `selectAll` in [select-query-builder.ts](select-query-builder.ts); `allSelections` in [expression-builder.ts](expression-builder.ts).

### `selectAll` takes the name a table goes by

**What it is.** `selectAll` requires one string: the name the table goes by in the query, its alias (`selectAll('u')` after `selectFrom(users.as('u'))`) or its name when not aliased (`selectAll('users')`). There is no table-object form (`selectAll(users)`) and no argument-less form selecting every table.

**Why.** One form, and the same name every other reference in the query uses (`'u.id'`). A table object names the table, not what it goes by once aliased, and "every table" changes meaning when a join is added (and is a duplicate-key error as soon as two tables share a column name such as `id`).

**Cost.** Selecting every column of two tables takes two calls.

**Code.** `selectAll` in [select-query-builder.ts](select-query-builder.ts).

### Ordering by a selected key uses the bare key

**What it is.** `orderBy('postCount')` orders by a key of the row (rendered as the quoted alias); `orderBy('posts.createdAt')` by a column. A string with a dot is always a column reference.

**Why.** Ordering and grouping by a computed, aliased value is common, and repeating the expression is noisy. The dot rule makes the two readings unambiguous.

**Code.** `renderKey`, `AliasNode` in [compile.ts](compile.ts).

## Pagination

The mechanisms are in [PAGINATION.md](PAGINATION.md).

### Keyset seek with a row comparison

**What it is.** After the first batch or page, the next one starts with `where (a, b) > ($1, $2)`: a **row comparison** against the previous page's last key, with one direction for every key column ([PAGINATION.md](PAGINATION.md#row-comparison-and-the-index)).

**Why.** Offset paging (`offset 100000`) makes the server produce and throw away every skipped row, so pages get slower the deeper they go, and rows shift between pages under concurrent writes. A seek starts where the last page ended; a row comparison on `(a, b)` uses a btree index on `(a, b)` directly (the integration test checks the plan uses `items_pkey`).

**Alternatives.** The expanded form `a > x or (a = x and b > y)` (kysely-paginate, Drizzle's guide): supports mixed directions, but is harder for the planner. Offset paging, kept as `paginateByOffset` for "page 7 of 20" interfaces.

**Cost.** No mixed per-column directions (`a desc, b asc`), and no backwards pagination yet.

**Code.** [pagination.ts](pagination.ts).

### Exact text keyset keys

**What it is.** Key columns are read as the server's exact text (`codecs.raw`, so the SQL doesn't change), decoded with their own codec before the rows are returned, and that exact text is what the next seek, or the cursor, sends back ([PAGINATION.md](PAGINATION.md#exact-keys-why-the-key-columns-are-read-as-text)).

**Why.** A `timestamptz` key decoded to a JavaScript `Date` loses its microseconds. The next seek then compares against a rounded value: rows were skipped, and when the first key column tied, `iterateChunks` looped forever. The integration tests caught it. `created_at default now()`, the most common key, has microseconds.

**Alternatives.** Use the decoded value (Prisma has this bug with `DateTime` cursors). Laravel avoids it only because PDO returns strings.

**Cost.** Key columns are decoded on the client from text, never binary.

**Code.** `readKeys` in [pagination.ts](pagination.ts).

### `limit + 1` for `hasMore`, no count by default

**What it is.** `paginateByCursor` and `paginateByOffset` fetch one row more than the page; if it arrives, `hasMore` is true and the row is dropped. `countTotal: true` adds a `count(*)` query, batched in the same round trip ([PAGINATION.md](PAGINATION.md#hasmore-with-limit--1)).

**Why.** "Is there a next page?" costs one row instead of a count, and a count over a large table is a full scan. Laravel's `simplePaginate`/`cursorPaginate` do the same; Prisma never counts automatically.

**Alternatives.** Always count (Laravel's `paginate`): a second scan on every page. `iterateChunks` uses a plain `limit n`, so when the row count is an exact multiple of the size, it costs one final empty query.

**Cost.** One extra row per page.

**Code.** [pagination.ts](pagination.ts).

### Pagination owns order, limit and offset

**What it is.** The three helpers add `order by`, `limit` (and `offset`) themselves, and throw before running if the query already has `orderBy()`, `limit()` or `offset()`, naming the clauses to remove ([PAGINATION.md](PAGINATION.md#they-own-order-limit-and-offset)).

**Why.** The seek is only correct when the order is exactly the key's; a user's `orderBy` would either conflict or silently break paging.

**Alternatives.** Merge the user's order (wrong results when it differs from the key); check at the type level (would add a type parameter to every select method).

**Cost.** A run-time check, not a type error.

**Code.** [pagination.ts](pagination.ts).

### Key rules in the types: non-null and selected under its own name

**What it is.** `by` only accepts columns that are non-null and in the select list under their own name (`KeyColumn<T, O>`), checked again at run time ([PAGINATION.md](PAGINATION.md#the-key-rules), [TYPES.md](TYPES.md#keyset-keys-keycolumn)).

**Why.** A seek can't continue past a NULL, and each page's last row gives the next page's start, so the key has to be in the rows.

**Alternatives.** Select the key behind the user's back: a hidden change to the SQL, which quarry avoids ([no implicit LIMIT](#no-implicit-limit-in-result-shapes) follows the same rule).

**Code.** `KeyColumn` in [pagination.ts](pagination.ts).

### Unsigned base64url JSON cursors

**What it is.** A cursor is base64url-encoded JSON `{ by, direction, after: [text…] }`. A cursor made for another key or direction is rejected with `InvalidCursorError` ([PAGINATION.md](PAGINATION.md#cursors)).

**Why.** Opaque enough to put in a URL, and decodable without a secret (Laravel works the same way).

**Alternatives.** HMAC-signed cursors with a database-level secret (an open question): a client could otherwise edit the key text, which passes the structural check and then fails in Postgres with `invalid_text_representation`.

**Cost.** Cursors aren't tamper-proof; they are not an authorization mechanism. `InvalidCursorError` is a data-dependent throw from methods named without `expect` (another open question).

**Code.** [pagination.ts](pagination.ts).

### `iterateChunks` alongside `stream()`

**What it is.** Two ways to read a large result batch by batch: `stream()` (one query, a server-side cursor, one connection held throughout) and `iterateChunks()` (one short keyset query per batch).

**Why.** They fail differently. A stream sees one snapshot and is fastest, but holds a connection and, inside a transaction, the transaction. Chunks hold no connection between batches, and each batch is a short query that sees the latest committed rows, and a crashed job can restart from the last key it processed, at the cost of one query per batch (a built-in `after` option to resume from a saved key is an open question) ([PAGINATION.md](PAGINATION.md#pagination-vs-stream)).

**Code.** [pagination.ts](pagination.ts); `stream` in [select-query-builder.ts](select-query-builder.ts).

## Execution and errors

### One small `Executor` interface between the builder and the driver

**What it is.** The builder talks to [executor.ts](executor.ts)'s interface (`execute`, `stream`, `describe`, `batch`, `transaction`, `close`). The real one is `DriverExecutor`; tests use in-memory ones ([EXECUTION.md](EXECUTION.md#the-executor-interface)).

**Why.** The builder is testable without a database, and the driver integration is one file. Future backends (HTTP, PGlite) would only implement the interface.

**Alternatives.** A public adapter for other drivers (quarry had `pgExecutor` before #3): the builder's features (codecs, binary, `keepRows`, batches) depend on this driver.

**Code.** [executor.ts](executor.ts), [driver-executor.ts](driver-executor.ts).

### Plain queries share the pool's pipelined connections

**What it is.** Over a pool, a builder query (`execute()`, and `db.sql` statements), `describe()` and a default `db.batch` run on the pool's shared connections: `pool.query`, `pool.describe`, and `pool.withShared` for a batch, which runs its statements together on one connection as one pipeline slot. A `timeout` doesn't change that: the driver sends it with its query under one Sync ([driver/DECISIONS.md](driver/DECISIONS.md#a-statement-timeout-is-framed-under-the-querys-sync-whatever-the-transaction-status)). What leaves state on a connection takes one of its own: transactions, `stream()`, atomic batches, and `db.sql` statements whose first keyword changes session or transaction state (`begin`, `set`, `listen`, `create temp table`, …) ([EXECUTION.md](EXECUTION.md#connections-shared-or-exclusive)).

**Why.** From the driver's integration (#3) until #37, every operation reserved a connection with `pool.acquire()`: beyond `max` concurrent queries, callers queued for a whole connection, so the builder got one query per connection per round trip, and none of the pool's pipelining. On the shared path, once the pool is full, queries pipeline onto busy connections, in a FIFO of pipeline slots, with each connection's depth adapting to the round trip, and connections are drained for callers who need one alone, so transactions and streams don't starve ([driver/DECISIONS.md](driver/DECISIONS.md#pipelining-onto-busy-connections-only-once-the-pool-is-full)). Nothing per query is lost: codecs, binary results once described, `keepRows`, tags, signals (a cancel only targets the query at the head of the connection), PgBouncer's unnamed statements and the stale-statement retry all live per query in the connection, and each query has its own Sync, so it fails alone.

**Alternatives.**

- Keep a connection per operation (the previous design): a query's `queuedMs` was its own, at the cost of every builder query beyond `max` waiting a whole round trip per connection.
- Send a batch's statements through `pool.query` one by one: on an idle pool they would spread over several connections, and the batch would no longer go out in one write on one connection.
- Give queries with a `timeout` a connection of their own (#37, until #38): the driver chose a timeout's framing from the connection's last reported transaction status, which other callers' pipelined queries change, so the setting could silently not apply. Since #38 the framing is the query's own Sync group, and a timed builder query at a 5 ms round trip went from 1,738 to 14,640 ops/s with 100 callers (1,729 to 48,548 with 500; at 0 ms, 33,233 to 57,208), 10 connections, the setup of the table below on one 4-core VM.
- Refuse session statements in `db.sql` on a pool (postgres.js refuses `begin` outside `sql.begin`): it breaks code that worked, where giving them a connection of their own keeps their old behaviour and keeps other callers out of their state.

**Cost.** A slow query delays the queries pipelined behind it on its connection (head-of-line blocking, bounded by the pipeline depth), and `queuedMs` includes them. The session check is a heuristic on the first keyword: state a `select` sets (`set_config(…, false)`, `pg_advisory_lock`) isn't seen, and lands on an arbitrary connection, as before. One anchored regular expression test per hand-written statement on a pool. The builders' selects and writes skip it: `compile` marks the queries it makes from a select, insert, update or delete node (`isDataStatement`), which can't start with a session keyword. The test had been 4–5% of a builder point lookup's client CPU.

**Measured.** 10 connections, point lookups by primary key through the builder (`selectFrom(users).where(id).select([6 columns]).execute()`), closed loop, median of 5 interleaved runs (the driver benchmark suite of #6, Node 24, a 4-core VM; the 5 ms round trip through Toxiproxy):

| Round trip | Concurrent callers | Before: ops/s (p50) | After: ops/s (p50) |
| ---------- | ------------------ | ------------------- | ------------------ |
| 0 ms       | 100                | 37,300 (2.4 ms)     | 57,800 (1.4 ms)    |
| 0 ms       | 500                | 37,800 (11.8 ms)    | 61,100 (6.8 ms)    |
| 0 ms       | 1000               | 33,900 (28.8 ms)    | 55,300 (15.2 ms)   |
| 5 ms       | 100                | 1,640 (60.7 ms)     | 15,900 (6.3 ms)    |
| 5 ms       | 500                | 1,640 (303 ms)      | 58,200 (7.2 ms)    |
| 5 ms       | 1000               | 1,620 (613 ms)      | 55,700 (17.2 ms)   |

Before, throughput was capped at `max` lookups per round trip (10 per 6 ms at 5 ms). After, 100 callers at 5 ms match the driver's own `pool.query` (15,600 ops/s); beyond that, the builder's client CPU is the limit (about 19 µs per lookup, against about 4 µs for `pool.query`: building and rendering the query and capturing the call site), not the connections. That overhead was cut afterwards ([Columns resolved and quoted once per table](#columns-resolved-and-quoted-once-per-table)). Client CPU per lookup also drops at 0 ms (29 → 19 µs): no connection reserved and released per query.

**Code.** `#shared`, `changesSession`, `SESSION_STATEMENT` and `#run` in [driver-executor.ts](driver-executor.ts); `isDataStatement` in [compile.ts](compile.ts); `withShared` in [driver/pool.ts](driver/pool.ts); [test/driver/integration/builder-pool.test.ts](../test/driver/integration/builder-pool.test.ts).

### Errors carry the query (hidden) and the code awaiting it

**What it is.** A failing query's error gets `query` (SQL and parameters) as a **non-enumerable** property and your code's stack appended (`--- query issued at ---`). The stack is captured **when the query fails**, in the executor's `catch`, where the engine's async stack trace lists the async functions awaiting the query, yours included. Row-count errors name the table (`The query on "users" returned no row…`) ([EXECUTION.md](EXECUTION.md#errors)).

**Why.** The driver's own stack ends in socket code, which says nothing about which line of yours ran the query. The parameters are there for debugging but don't print with `console.log(err)` or `JSON.stringify(err)`, so they can't leak into logs by accident (before #8, row-count errors exposed them). Capturing on failure costs a query that succeeds nothing: from #3 until this change, `execute` and `batch` ran `new Error()` for every query, which on V8 costs about 2 µs however few frames it keeps (`Error.stackTraceLimit = 1` is no cheaper; only 0 frames is), a quarter of a pipelined point lookup's client CPU in #37's profile.

**Alternatives.**

- A stack captured when the query is issued (the previous design): it also names a synchronous wrapper between the awaiting code and `execute()`, and the line that issued a query awaited later. About 2 µs per query on V8 (0.3 µs on Bun).
- A shallower stack captured up front (`Error.captureStackTrace` with a small `stackTraceLimit`): measured, the fixed cost of walking the stack dominates, so it saves almost nothing.
- Capturing only for slow queries, or when `onQuery` asks: errors are what call sites are for, and a failing query is rarely slow.
- The driver error's own async stack: it is created in the socket's data handler, so it has no frames of yours. The stack has to be captured in the executor's continuation.

**Cost.** What the stack lists depends on who awaits the query when it fails. Awaited right away (`await q.execute()`, `Promise.all`), it lists your function and its awaiting callers, more than before, since those that resumed after their own `await` were missing from a stack taken at issue time. A synchronous function that returns `q.execute()` to an async caller isn't listed (its caller is). A query started now and awaited later lists the code awaiting it when it failed, which may be none of yours. Every link from the executor up has to be an `await` for the chain to reach the caller, so `batch` settles its outcomes in its own continuation and `#run` awaits its callback. `stream` and `describe` still capture up front, once per stream or description. `callsites: false` turns it off.

**Measured.** See [below](#columns-resolved-and-quoted-once-per-table): with the builder's caches, a point lookup's client CPU through a pool went from 21 to under 5 µs.

**Code.** `issuedAt`, `decorate`, `#callsite` in [driver-executor.ts](driver-executor.ts); [test/driver/integration/call-sites.test.ts](../test/driver/integration/call-sites.test.ts).

### Nested `durable` transactions throw

**What it is.** `tx.transaction(fn, { durable: true })` throws `A durable transaction cannot run inside another transaction`.

**Why.** A nested transaction is a savepoint, which only commits when the outer transaction does. A caller who asked for durability (committed when the callback returns) would otherwise silently get a savepoint (the bug fixed in #8).

**Cost.** It can't detect an outer transaction held on another pooled connection (`db` used inside `db.transaction`); that would need `AsyncLocalStorage`.

**Code.** [driver-executor.ts](driver-executor.ts) `transaction`.

## Type-level tricks

### Phantom types: what a column reads and writes

**What it is.** Each column carries three TypeScript types, `$select`, `$insert` and `$update`, as properties declared for the type checker only and never set (**phantom** properties) ([column/README.md](column/README.md)).

**Why.** Postgres reads and writes columns differently: an identity column is read but never written; a column with a default is optional on insert; a generated column is never written. One type per column can't express that.

**Alternatives.** One type per column plus `Insertable<T>`/`Updateable<T>` helpers (Kysely's `ColumnType` is the same triple; Drizzle infers insert types from flags).

**Code.** [column/](column/README.md).

### A class per column modifier state

**What it is.** `Column`, `DefaultColumn`, `GeneratedColumn`, `IdentityColumn` and their nullable variants are separate classes; each has only the modifiers valid in its state ([column/README.md](column/README.md)).

**Why.** Invalid combinations (`identity().nullable()`, `default().generated()`) can't be written, and autocomplete shows what's valid. Columns are not null by default.

**Alternatives.** One builder class with a type-level config (Drizzle): less repetition, but invalid chains are only caught by conditional types, with worse errors.

**Cost.** Every new modifier is written across the classes.

**Code.** [column/](column/README.md).

### Errors as an impossible extra argument

**What it is.** When a call is invalid, the method's rest parameter becomes a one-element tuple whose name and type **are the error message**: `pipe(piece)` with a missing table asks for `missingTables: "contacts"`; a duplicate join asks for `alreadyJoined: '"users" is already in the query: join it under another name…'`; `takeValue()` on a two-column row asks for `'select exactly one column to read a value'` ([TYPES.md](TYPES.md#inscope-an-impossible-extra-argument)).

**Why.** The usual alternative, a conditional return type of `never`, gives an error far from the cause, or none at all. Here the error is at the call and reads "Expected 2 arguments, but got 1", with the parameter's name and type saying exactly what is wrong.

**Cost.** The signatures look odd (`..._inScope: InScope<T, P>`), and the same rules are checked at run time for JavaScript callers.

**Code.** `InScope` in [select-query-builder.ts](select-query-builder.ts), `ValueArgs` in [shape.ts](shape.ts), `NewName`, `UniqueKeys`.

### `takeValue` needs a one-column row

**What it is.** `takeValue()` and `expectValue()` only type-check on a row with exactly one column.

**Why.** An object type doesn't record its keys' order, so "the first column" of a wider row has no knowable type. One column makes the value's type exact.

**Code.** `ValueArgs`, `ColumnValue` in [shape.ts](shape.ts).

## Type-checking speed

### Speed is a design constraint, measured

**What it is.** Several types are written in roundabout ways because the direct version made `tsc` or the editor slow on large schemas ([TYPES.md](TYPES.md#type-checking-speed)):

- `$refs` keys as a union, not a mapped type with `as` (computed once per table, not per lookup);
- `RefsOfTuple` merging from the end (each join reuses the previous scope: linear, not quadratic);
- `Expr` deferring its kind lookup with `extends infer` (no methods instantiated for a still-generic kind);
- `in out` variance annotations on the expression builder (skips TypeScript's structural variance measurement of a large interface);
- `Unconstrained<T>` on literal arguments (makes the "keep literal types" check trivial while the column is still generic);
- `JoinColumn` scanning per table; `AddRow` skipping the flatten when one side is empty; `DrainOuterGeneric`; `Operand` skipping `RefsWith` for "any reference".

**Why.** A query builder that makes editors lag on a 50-table schema doesn't get used, however correct its types.

**Cost.** The types are harder to read; each trick has a comment in the source explaining it, and changing them needs a before/after measurement with `pnpm bench:types` and `pnpm bench:lsp`.

**Measured.**

- Before the query layer existed, the benchmark (about 100 comparisons and one `selectFrom` per table, 2-table scopes) checked 20 tables in about 0.67 s, 50 in 1.5 s, 100 in 3.1 s (9.1M instantiations, 210 MB): linear (early design review).
- Row locking (#22): +0.2% instantiations at 100 tables, check time unchanged.
- Everyday SQL (#32): on the shared type tests, instantiations went from 241k to 348k, almost all a **one-time** cost of checking `src` (109k → 215k); the **per-query** cost was unchanged (131k vs 133k).

**Code.** [refs.ts](refs.ts), [operators.ts](operators.ts), [types.ts](types.ts), [row.ts](row.ts), [where-builder.ts](where-builder.ts); [bench/types](../bench/types/run.ts).

## Schema, verify and the CLI

### Declarations, not migrations

**What it is.** Table definitions describe the database; they don't create or change it. quarry has no migration tool ([column/README.md](column/README.md)).

**Why.** The database is the source of truth for its schema, and teams already have migration tools. Owning DDL would make quarry responsible for every schema feature Postgres has.

**Alternatives.** Generate migrations from definitions (Drizzle Kit, Prisma Migrate); generate definitions from the database (Kysely codegen).

**Cost.** Two descriptions of the schema that can drift apart, hence the next entry.

### `verify` instead of trusting that code and database agree

**What it is.** `db.verify()` compares the declared tables with the live catalog in **one read-only query** and reports each difference with the line of code that declared it ([verify/README.md](verify/README.md)).

**Why.**

- One catalog query for any number of tables is fast enough to run at every boot or in every CI job, and read-only, so safe against production.
- Names are resolved as queries resolve them (`to_regclass`, `search_path`), so it checks the tables your queries will actually hit.
- The query returns only text, booleans and integers, so the report doesn't depend on any codec (a text-only driver produces the same report).
- Severity follows consequence: an error means some query will fail or return values your types don't describe; a warning, a likely mistake; info, a place the code could be more precise. Each diagnostic has a stable rule code and suggests a fix in both directions (SQL for the database, or the declaration for the code).

The report is plain data (`report.diagnostics`, `report.summary`), and renderers are separate functions, so one comparison serves people (the pretty renderer), CI (GitHub annotations) and tools (JSON).

**Measured.** The example report in [#4](https://github.com/shlokdesai33/quarry/pull/4): 3 tables and 14 columns checked in 12 ms.

**Code.** [verify/](verify/README.md).

### Call sites captured eagerly, formatted lazily

**What it is.** `defineTable` and the column factories record where they were called (`Error.captureStackTrace` into an object), and the stack is only turned into a file and line when a diagnostic needs it.

**Why.** Diagnostics can point at the exact declaration, while a program that never runs `verify` pays only for an unformatted capture.

**Cost.** Unavailable on engines without `Error.captureStackTrace`; then diagnostics show no location.

**Code.** [call-site.ts](call-site.ts).

### The CLI: config as code, re-launched for TypeScript, distinct exit codes

**What it is.** `quarry verify` loads a `quarry.config.ts` that exports a real `Database`; to load TypeScript on older Node versions it re-launches itself with Node's type stripping; it exits with different codes for "schema differs" and "couldn't check" ([cli/README.md](cli/README.md)).

**Why.** The CLI connects exactly as your application does, with no second way to configure a connection; re-launching avoids bundling a TypeScript loader (and on current Node versions does nothing); CI can tell a drifted schema from a broken pipeline.

The command itself is a function, `runCli(argv, io)`, taking its output streams, working directory, environment and config loader through an `Io` object, so it is tested without spawning processes.

**Code.** [cli/](cli/README.md).
