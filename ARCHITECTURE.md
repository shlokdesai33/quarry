# quarry internals: start here

This is the index of quarry's **internal documentation**: how the code works and why it is built the way it is. The documents live next to the code they describe, so a change to a directory can update its document in the same pull request.

They are written for a programmer who knows basic TypeScript and nothing about databases, PostgreSQL's wire protocol, connection pools, query builders or type-level programming. Every concept is introduced from first principles, and each document ends with a glossary. To **use** quarry, read the public [README.md](README.md) instead.

## What quarry is

quarry is two things in one package:

- a **type-safe query builder** for PostgreSQL (`quarry`): you declare your tables in TypeScript, build queries with method chains, and the compiler checks every column, value and result row;
- a **PostgreSQL driver** with no dependencies (`quarry/driver`): it opens connections, speaks PostgreSQL's wire protocol, pools and pipelines connections, and encodes and decodes values.

```mermaid
flowchart TD
    subgraph builder["Query builder: src/"]
        S["Schema<br/>defineTable, columns, data types"]
        B["Builders + expressions<br/>selectFrom / insertInto / update / deleteFrom, eb"]
        C["Compiler<br/>node tree → SQL, params, codecs"]
        X["Executor<br/>database(), DriverExecutor, batch, transactions"]
        V["verify + CLI"]
    end
    subgraph driver["Driver: src/driver/"]
        P["Pool"]
        K["Connection + ops<br/>pipelining, statement cache"]
        D["Codecs + registry"]
        W["Protocol<br/>reader / writer"]
        A["Connect + auth<br/>TLS, SCRAM"]
        SK["Sockets<br/>Node, Bun, Deno, Workers"]
    end
    PG[(PostgreSQL 18+)]
    S --> B --> C --> X --> P --> K --> W --> SK --> PG
    K --> D
    K -.-> A
    V --> X
```

## Reading order

If you're new, read in this order. Each step builds on the previous one.

1. [src/ARCHITECTURE.md](src/ARCHITECTURE.md): databases, SQL and query builders from first principles; the builder's layers, files and conventions.
2. [src/WALKTHROUGH.md](src/WALKTHROUGH.md): one real query traced from `db.selectFrom(…)…execute()` through compiling, codecs, the pool, the bytes on the wire, the server's reply and decoding, back to a typed row.
3. [src/driver/ARCHITECTURE.md](src/driver/ARCHITECTURE.md): connections, round trips, pipelining, the event loop; the driver's layers and files.
4. Then whichever area you're working on, from the list below.

## Every internal document

### Query builder

| Document                                           | Covers                                                                                                                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/ARCHITECTURE.md](src/ARCHITECTURE.md)         | first principles, the pipeline, every file in `src/`, conventions (immutability, `_quarry`, phantom `$` members, rejecting `await`), design decisions                                                                                  |
| [src/column/README.md](src/column/README.md)       | tables, columns, the modifier state machine, data types, every factory, arrays, enums, `defineType`, `useCodec`, `typed`, row types, aliases, call sites                                                                               |
| [src/data-type/README.md](src/data-type/README.md) | the `DataType` classes (pointer to the above)                                                                                                                                                                                          |
| [src/TYPES.md](src/TYPES.md)                       | TypeScript type-level programming as quarry uses it: phantom types, scope, `Expr` and methods by kind, null propagation, row types, builder state in type parameters (required `where`, locking), error tricks, type-checking speed    |
| [src/EXPRESSIONS.md](src/EXPRESSIONS.md)           | the expression builder: references, values vs expressions, comparison methods and how they exist at run time, lowering (`in`, `any`, `between`, `is`), codecs per value, functions, jsonb, `where`/`on`, refusing `undefined`          |
| [src/QUERIES.md](src/QUERIES.md)                   | the select, insert, update and delete builders; row locking; result shapes (`execute`, `take…`, `expect…`, `expectRows`) and `keepRows`; errors; `toSQL`/`toNode`/`toQuery`                                                            |
| [src/COMPILER.md](src/COMPILER.md)                 | `compile()`: parameter numbering, rendering, quoting and literals, precedence, select, locks, insert (`values` vs `unnest`), upserts, update/`updateMany`, delete, result codecs, compile errors                                       |
| [src/EXECUTION.md](src/EXECUTION.md)               | `database()`, the `Executor` interface, `DriverExecutor`, how the builder picks codecs, the type catalog, what a query borrows from the pool, `db.batch` (three modes), transactions, streaming, timeouts, `onQuery`, error decoration |
| [src/WALKTHROUGH.md](src/WALKTHROUGH.md)           | the end-to-end trace, with captured bytes                                                                                                                                                                                              |
| [src/verify/README.md](src/verify/README.md)       | `db.verify`: describing the code, the catalog query, type comparison, every rule, the report and its renderers                                                                                                                         |
| [src/cli/README.md](src/cli/README.md)             | the `quarry verify` command, its config file and exit codes                                                                                                                                                                            |

### Driver

| Document                                                       | Covers                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/driver/ARCHITECTURE.md](src/driver/ARCHITECTURE.md)       | foundations; layers; every file; the connection (queue, flush, backpressure, dispatch, closing); operations; the prepared-statement cache and stale statements; pipelining; PgBouncer; memory and allocation; timing and telemetry; runtimes and sockets; errors; testing |
| [src/driver/protocol/README.md](src/driver/protocol/README.md) | the wire protocol from scratch: framing, startup, simple and extended query protocols, Sync and errors, formats; the writer and the reader                                                                                                                                |
| [src/driver/auth/README.md](src/driver/auth/README.md)         | configuration resolution, hosts and failover, TLS and certificates, protocol negotiation, startup, SCRAM-SHA-256, channel binding, `requireAuth`, passwords and IAM tokens, client certificates, crypto, the PostgreSQL 18 check                                          |
| [src/driver/CODECS.md](src/driver/CODECS.md)                   | the `Codec` interface, built-ins, `arrayOf`, `defineCodec`, parameter encoding and OIDs, result plans, binary after describe, generated row decoders, the registry, the type catalog                                                                                      |
| [src/driver/POOL.md](src/driver/POOL.md)                       | the pool's bookkeeping, exclusive vs shared use, opening and releasing, pipelining onto busy connections, adaptive depth, draining for exclusive callers, idle and lifetime, ending                                                                                       |
| [src/driver/TRANSACTIONS.md](src/driver/TRANSACTIONS.md)       | transactions from first principles, `Transaction.run`, BEGIN sharing the first statement's Sync, the `Session`, savepoints, retries, settings and timeouts, silent rollbacks, one-round-trip batches                                                                      |
| [src/driver/STREAMING.md](src/driver/STREAMING.md)             | cursors and streams, COPY in and out with backpressure, LISTEN/NOTIFY and the pool's self-healing listener                                                                                                                                                                |
| [src/driver/CANCELLATION.md](src/driver/CANCELLATION.md)       | every timeout, `AbortSignal`, cancel requests, why later writes are held back, statement timeouts, `QueryCanceled` reasons                                                                                                                                                |

The user-facing driver reference is [src/driver/README.md](src/driver/README.md) (options and methods); the public [README.md](README.md) documents the whole API.

## The rest of the repository

| Path             | What's there                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/](src/)     | the source; `src/index.ts` and `src/driver/index.ts` are the two entry points (`quarry`, `quarry/driver`)                                                                                                                                                                                                                                                                             |
| [test/](test/)   | Vitest tests: `*.test.ts` run, `*.test-d.ts` type-check ([src/TYPES.md](src/TYPES.md#testing-the-types)); `test/driver/` has the driver's unit, fake-server, integration (a throwaway PostgreSQL cluster when one is installed), compatibility and runtime tests ([src/driver/ARCHITECTURE.md](src/driver/ARCHITECTURE.md#part-14-testing)); `test/verify/` covers verify and the CLI |
| [bench/](bench/) | `bench/driver` (driver throughput and latency against `pg` and postgres.js), `bench/types` (type-checking time and editor latency on a generated schema)                                                                                                                                                                                                                              |
| `package.json`   | scripts: `test`, `typecheck`, `lint` (oxlint), `format`/`check:format` (oxfmt, which also formats these Markdown files), `build` (tsdown), benchmarks                                                                                                                                                                                                                                 |

## Conventions across the codebase

- **Immutable builders**: every builder method returns a new builder ([src/ARCHITECTURE.md](src/ARCHITECTURE.md#builders-are-immutable)).
- **`_quarry`** holds the internal data of public objects; **`#private`** fields hold state only the class itself reads; **`$name`** properties are phantom types, never set ([src/TYPES.md](src/TYPES.md#phantom-types)).
- **Names say whether a method throws**: `take…` never throws for the row count, `expect…` does.
- **Comments state constraints and reasons**, not what the next line does. Hot paths carry comments explaining why they avoid closures, spreads or `Map` churn; keep them when editing.
- **The driver never imports the builder** ([src/driver/ARCHITECTURE.md](src/driver/ARCHITECTURE.md#the-driver-knows-nothing-about-quarry)).

## Glossary index

Each document has a glossary for its own terms:

- databases, SQL, builders: [src/ARCHITECTURE.md](src/ARCHITECTURE.md#glossary)
- schema and columns: [src/column/README.md](src/column/README.md#glossary)
- TypeScript type-level terms: [src/TYPES.md](src/TYPES.md#glossary)
- expressions: [src/EXPRESSIONS.md](src/EXPRESSIONS.md#glossary)
- queries and shapes: [src/QUERIES.md](src/QUERIES.md#glossary)
- compiling: [src/COMPILER.md](src/COMPILER.md#glossary)
- running queries: [src/EXECUTION.md](src/EXECUTION.md#glossary)
- verify: [src/verify/README.md](src/verify/README.md#glossary)
- the driver and networking: [src/driver/ARCHITECTURE.md](src/driver/ARCHITECTURE.md#glossary)
- the wire protocol: [src/driver/protocol/README.md](src/driver/protocol/README.md#glossary)
- TLS and authentication: [src/driver/auth/README.md](src/driver/auth/README.md#glossary)
- codecs: [src/driver/CODECS.md](src/driver/CODECS.md#glossary)
- the pool: [src/driver/POOL.md](src/driver/POOL.md#glossary)
- transactions: [src/driver/TRANSACTIONS.md](src/driver/TRANSACTIONS.md#glossary)
- streaming, COPY, LISTEN: [src/driver/STREAMING.md](src/driver/STREAMING.md#glossary)
- cancellation: [src/driver/CANCELLATION.md](src/driver/CANCELLATION.md#glossary)

## Keeping these documents in sync

These documents describe `main` as of October 2026 (after the unified-codecs change and the dead-code sweep). They quote code and captured protocol traces, so they go stale when the code changes. When a pull request changes behaviour:

1. **Update the document next to the code you changed**, in the same pull request. Use the tables above to find it; cross-cutting changes usually touch one builder document and one driver document.
2. **Re-check the traces** if the change alters what goes on the wire (message order, naming, formats, transaction framing): the captured sequences in [src/WALKTHROUGH.md](src/WALKTHROUGH.md), [src/EXECUTION.md](src/EXECUTION.md#batches), [src/driver/TRANSACTIONS.md](src/driver/TRANSACTIONS.md) and [src/driver/CANCELLATION.md](src/driver/CANCELLATION.md#statement-timeouts) came from running the code against an in-memory server through the `socket` option ([src/driver/ARCHITECTURE.md](src/driver/ARCHITECTURE.md#anything-else)); re-capture them rather than editing bytes by hand.
3. **Re-check compiled SQL examples** by calling `toSQL()` on the example: they were all produced that way.
4. **Link to files and functions, not line numbers**, so the links survive refactors.
5. **Run `pnpm format`** (oxfmt formats Markdown too).

Changes in flight when these were written, and the documents they will need to touch:

| In-flight change                                                                                       | Documents to update                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everyday SQL completion for selects (ordering, offset, outer joins, grouping, distinct, subqueries, …) | [src/QUERIES.md](src/QUERIES.md) (the "what exists on main" note and the select section), [src/COMPILER.md](src/COMPILER.md#select), [src/TYPES.md](src/TYPES.md) (outer joins make columns nullable), [src/EXPRESSIONS.md](src/EXPRESSIONS.md) (new functions), [src/COMPILER.md](src/COMPILER.md#locking-clauses) (the aggregate list) |
| `updateMany` merged into `update`                                                                      | [src/QUERIES.md](src/QUERIES.md#update), [src/COMPILER.md](src/COMPILER.md#update-and-updatemany), [src/TYPES.md](src/TYPES.md#builder-state-in-type-parameters), [src/ARCHITECTURE.md](src/ARCHITECTURE.md#part-3-every-file-in-src)                                                                                                    |
| Keyset `chunk` / `paginate`                                                                            | [src/QUERIES.md](src/QUERIES.md), [src/EXECUTION.md](src/EXECUTION.md)                                                                                                                                                                                                                                                                   |
| Builder `stream()` changes                                                                             | [src/QUERIES.md](src/QUERIES.md#running-execute-stream-describe), [src/EXECUTION.md](src/EXECUTION.md#streaming), [src/driver/STREAMING.md](src/driver/STREAMING.md#streams)                                                                                                                                                             |
| `inc` / `dec` in updates                                                                               | [src/QUERIES.md](src/QUERIES.md#update), [src/EXPRESSIONS.md](src/EXPRESSIONS.md)                                                                                                                                                                                                                                                        |
| `toSQL` changes and query budgets                                                                      | [src/COMPILER.md](src/COMPILER.md#tosql-and-when-compiling-happens), [src/QUERIES.md](src/QUERIES.md#inspecting-a-query), [src/EXECUTION.md](src/EXECUTION.md)                                                                                                                                                                           |
