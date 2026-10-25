# quarry internals: start here

This is the index of quarry's **internal documentation**: how the code works and why it is built the way it is. The documents live next to the code they describe, so a change to a directory can update its document in the same pull request.

They are written for a programmer who knows basic TypeScript and nothing about databases, PostgreSQL's wire protocol, connection pools, query builders or type-level programming. Every concept is introduced from first principles, and most documents end with a glossary ([index](#glossary-index)). To **use** quarry, read the public [README.md](README.md) instead.

## What quarry is

quarry is two things in one package:

- a **type-safe query builder** for PostgreSQL (`quarry`): you declare your tables in TypeScript, build queries with method chains, and the compiler checks every column, value and result row;
- a **PostgreSQL driver** with no dependencies (`quarry/driver`): it opens connections, speaks PostgreSQL's wire protocol, pools and pipelines connections, and encodes and decodes values.

It runs on Node (24.11 or later) and nowhere else, against PostgreSQL 18 or later ([Node only](src/driver/DECISIONS.md#node-only), [PostgreSQL 18 or later only](src/driver/DECISIONS.md#postgresql-18-or-later-only)).

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
        SK["Sockets<br/>node:net, node:tls"]
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
4. Then whichever area you're working on: [the source map](#the-source-directory-by-directory) says which document covers a directory, and [the document list](#every-internal-document) what each document covers.

To understand **why** something is built the way it is, start at [DECISIONS.md](DECISIONS.md): the index of every design decision and optimisation, each with what it is, why, the alternatives, the cost and the measured impact. Each area document also ends with a short **Decisions** section linking to the entries for its area.

## The source, directory by directory

Every directory of `src/`, with the document that maps its files one by one:

| Directory                                    | What's in it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | File-by-file map                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [src/](src/) (its own files)                 | the query builder: schema (`define-table.ts`, `table.ts`, `column-factories.ts`, `kind-codecs.ts`, `define-enum.ts`, `define-type.ts`, `range.ts`, `types.ts`, `call-site.ts`), expressions (`expression*.ts`, `operators.ts`, `comparison.ts`, `functions.ts`, `case.ts`, `sql.ts`, `json.ts`, `refs.ts`, `where-builder.ts`), queries (`*-query-builder.ts`, `pagination.ts`, `write-query.ts`, `row.ts`, `nest.ts`, `node.ts`, `compile.ts`, `query.ts`, `shape.ts`), running (`database.ts`, `executor.ts`, `driver-executor.ts`, `batch.ts`, `errors.ts`), and `index.ts`, the `quarry` entry point | [src/ARCHITECTURE.md, Part 3](src/ARCHITECTURE.md#part-3-every-file-in-src)                     |
| [src/column/](src/column/)                   | the column classes and their modifier state machine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [src/column/README.md](src/column/README.md)                                                    |
| [src/data-type/](src/data-type/)             | `DataType`, `ArrayType`, `EnumType`, `CustomType`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [src/data-type/README.md](src/data-type/README.md)                                              |
| [src/verify/](src/verify/)                   | `db.verify`: the spec from your tables, the catalog query, the comparison, the report; `render/` turns reports into terminal, table, GitHub and code-frame output                                                                                                                                                                                                                                                                                                                                                                                                                                        | [src/verify/README.md](src/verify/README.md)                                                    |
| [src/cli/](src/cli/)                         | the `quarry verify` command: config loading, running, exit codes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [src/cli/README.md](src/cli/README.md)                                                          |
| [src/driver/](src/driver/)                   | the driver: pool, connection, operations, queue, codecs and registry, cursors and `RowStream`, transactions, COPY and LISTEN, telemetry, errors, Node's socket adapter; `index.ts` is the `quarry/driver` entry point                                                                                                                                                                                                                                                                                                                                                                                    | [src/driver/ARCHITECTURE.md, Part 3](src/driver/ARCHITECTURE.md#part-3-every-file-in-srcdriver) |
| [src/driver/protocol/](src/driver/protocol/) | the wire protocol: message writer and reader, frontend messages, UTF-8 text decoding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [src/driver/protocol/README.md](src/driver/protocol/README.md)                                  |
| [src/driver/auth/](src/driver/auth/)         | SCRAM-SHA-256, MD5, and the byte encodings (base64, hex, UTF-8) they use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [src/driver/auth/README.md](src/driver/auth/README.md)                                          |

## Every internal document

### Query builder

| Document                                           | Covers                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/ARCHITECTURE.md](src/ARCHITECTURE.md)         | first principles, the pipeline, every file in `src/`, conventions (immutability, `_quarry`, phantom `$` members, rejecting `await`), the decisions that shape the builder                                                                                                                            |
| [src/DECISIONS.md](src/DECISIONS.md)               | every builder design decision and trick: what, why, alternatives, cost, measured impact                                                                                                                                                                                                              |
| [src/column/README.md](src/column/README.md)       | tables, columns, the modifier state machine, data types, every factory, arrays, enums, `defineType`, `useCodec`, `typed`, row types, aliases, call sites                                                                                                                                             |
| [src/data-type/README.md](src/data-type/README.md) | the `DataType` classes (pointer to the above)                                                                                                                                                                                                                                                        |
| [src/TYPES.md](src/TYPES.md)                       | TypeScript type-level programming as quarry uses it: phantom types, scope, `Expr` and methods by kind, null propagation, row types (outer joins, `setEach` rows, keyset keys, `RowStream`), builder state in type parameters (required `where`, locking), error tricks, type-checking speed          |
| [src/EXPRESSIONS.md](src/EXPRESSIONS.md)           | the expression builder: references, values vs expressions, comparison methods and how they exist at run time, lowering (`in`, `any`, `between`, `is`), codecs per value, arithmetic, `case`, functions, jsonb, `where`/`on`, raw `sql` fragments, refusing `undefined`                               |
| [src/QUERIES.md](src/QUERIES.md)                   | the select (joins, `selectAll`, `distinct`, `groupBy`/`having`, `orderBy`, `limit`/`offset`), insert, update (`setEach` for bulk updates) and delete builders; `db.sql`; row locking; result shapes (`execute`, `take…`, `expect…`, `expectRows`) and `keepRows`; errors; `toSQL`/`toNode`/`toQuery` |
| [src/PAGINATION.md](src/PAGINATION.md)             | keyset and offset pagination: `iterateChunks`, `paginateByCursor`, `paginateByOffset`, the key rules, exact keys, cursors, `countTotal`                                                                                                                                                              |
| [src/COMPILER.md](src/COMPILER.md)                 | `compile()`: parameter numbering, rendering, quoting and literals, precedence, select (joins, grouping, ordering), locks, insert (`values` vs `unnest`), upserts, update and `setEach`, delete, result codecs, compile errors                                                                        |
| [src/EXECUTION.md](src/EXECUTION.md)               | `database()`, the `Executor` interface, `DriverExecutor`, how the builder picks codecs, the type catalog, shared vs own connections, `db.batch` (three modes, `BatchError`), transactions, streaming, `describe()`, timeouts, `onQuery`, OpenTelemetry spans and tags, error decoration, closing     |
| [src/WALKTHROUGH.md](src/WALKTHROUGH.md)           | the end-to-end trace, with captured bytes                                                                                                                                                                                                                                                            |
| [src/verify/README.md](src/verify/README.md)       | `db.verify`: describing the code, the catalog query, type comparison, every rule, the report and its renderers                                                                                                                                                                                       |
| [src/cli/README.md](src/cli/README.md)             | the `quarry verify` command, its config file and exit codes                                                                                                                                                                                                                                          |

### Driver

| Document                                                       | Covers                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [src/driver/DECISIONS.md](src/driver/DECISIONS.md)             | every driver design decision and optimisation: what, why, alternatives, cost, measured impact, with how to read the benchmark numbers                                                                                                                        |
| [src/driver/ARCHITECTURE.md](src/driver/ARCHITECTURE.md)       | foundations; layers; every file; the connection (queue, flush, backpressure, dispatch, closing); operations; the prepared-statement cache and stale statements; pipelining; PgBouncer; memory and allocation; timing and telemetry; sockets; errors; testing |
| [src/driver/protocol/README.md](src/driver/protocol/README.md) | the wire protocol from scratch: framing, startup, simple and extended query protocols, Sync and errors, formats; the writer and the reader                                                                                                                   |
| [src/driver/auth/README.md](src/driver/auth/README.md)         | configuration resolution, hosts and failover, TLS and certificates, protocol negotiation, startup, SCRAM-SHA-256, channel binding, `requireAuth`, passwords and IAM tokens, client certificates, crypto, the PostgreSQL 18 check                             |
| [src/driver/CODECS.md](src/driver/CODECS.md)                   | the `Codec` interface, built-ins, `arrayOf`, `defineCodec`, parameter encoding and OIDs, result plans, binary after describe, generated row decoders, the registry, the type catalog                                                                         |
| [src/driver/POOL.md](src/driver/POOL.md)                       | the pool's bookkeeping, exclusive vs shared use, opening and releasing, pipelining onto busy connections, adaptive depth, draining for exclusive callers, idle and lifetime, ending                                                                          |
| [src/driver/TRANSACTIONS.md](src/driver/TRANSACTIONS.md)       | transactions from first principles, `Transaction.run`, BEGIN sharing the first statement's Sync, the `Session`, savepoints, retries, settings and timeouts, silent rollbacks, one-round-trip batches                                                         |
| [src/driver/STREAMING.md](src/driver/STREAMING.md)             | cursors (strict pull, binary from the first run, named portals inside transactions) and `RowStream`, COPY in and out with backpressure, LISTEN/NOTIFY and the pool's self-healing listener                                                                   |
| [src/driver/CANCELLATION.md](src/driver/CANCELLATION.md)       | every timeout, `AbortSignal`, cancel requests, why later writes are held back, statement timeouts, `QueryCanceled` reasons                                                                                                                                   |
| [src/driver/README.md](src/driver/README.md)                   | the driver's reference: every option and method, for using `quarry/driver` on its own                                                                                                                                                                        |

The public [README.md](README.md) documents the whole API.

### Benchmarks

| Document                                                                                         | Covers                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [bench/driver/suite/README.md](bench/driver/suite/README.md)                                     | the full driver benchmark suite: what it measures, setup, running and comparing runs, candidate builds                                                      |
| [bench/driver/suite/results-snapshots/README.md](bench/driver/suite/results-snapshots/README.md) | the kept results of full runs, which `main` commit each measured, and what changed between them; most measured figures in the decision logs come from these |

## The rest of the repository

| Path             | What's there                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/](src/)     | the source; `src/index.ts` and `src/driver/index.ts` are the two entry points (`quarry`, `quarry/driver`)                                                                                                                                                                                                                                                                                                                                         |
| [test/](test/)   | Vitest tests: `*.test.ts` run, `*.test-d.ts` type-check ([src/TYPES.md](src/TYPES.md#testing-the-types)); `test/helpers/` has the in-memory executor the builder tests run on; `test/driver/` has the driver's unit, fake-server, integration (a throwaway PostgreSQL cluster when one is installed) and compatibility tests ([src/driver/ARCHITECTURE.md](src/driver/ARCHITECTURE.md#part-14-testing)); `test/verify/` covers verify and the CLI |
| [bench/](bench/) | `bench/driver/run.ts` (`pnpm bench:driver`: a quick driver comparison against `pg` and postgres.js), `bench/driver/suite/` (the full suite, [its README](bench/driver/suite/README.md)), `bench/types` (type-checking time and editor latency on a generated schema: `pnpm bench:types`, `pnpm bench:lsp`)                                                                                                                                        |
| `package.json`   | scripts: `test` (everything, types included), `test:runtime`, `test:types`, `test:compat`, `typecheck`, `lint` (oxlint), `format`/`check:format` (oxfmt, which also formats these Markdown files), `build` (tsdown), the benchmarks                                                                                                                                                                                                               |

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
- data types: [src/data-type/README.md](src/data-type/README.md#glossary)
- TypeScript type-level terms: [src/TYPES.md](src/TYPES.md#glossary)
- expressions: [src/EXPRESSIONS.md](src/EXPRESSIONS.md#glossary)
- queries and shapes: [src/QUERIES.md](src/QUERIES.md#glossary)
- pagination: [src/PAGINATION.md](src/PAGINATION.md#glossary)
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

These documents describe `main` as of October 2026, through [#49](https://github.com/shlokdesai33/quarry/pull/49) (Node only). They quote code, compiled SQL, captured protocol traces, `onQuery` events and error stacks, so they go stale when the code changes. When a pull request changes behaviour:

1. **Update the document next to the code you changed**, in the same pull request. Use the tables above to find it; cross-cutting changes usually touch one builder document and one driver document.
2. **Re-check the traces** if the change alters what goes on the wire (message order, naming, formats, transaction framing): the captured sequences in [src/WALKTHROUGH.md](src/WALKTHROUGH.md), [src/EXECUTION.md](src/EXECUTION.md#batches), [src/driver/TRANSACTIONS.md](src/driver/TRANSACTIONS.md) and [src/driver/CANCELLATION.md](src/driver/CANCELLATION.md#statement-timeouts) came from running the code against an in-memory server through the `socket` option ([src/driver/ARCHITECTURE.md](src/driver/ARCHITECTURE.md#anything-else)); re-capture them rather than editing bytes by hand.
3. **Re-check compiled SQL examples** by calling `toSQL()` on the example: they were all produced that way. The captured `onQuery` events, spans, descriptions and error stacks in [src/EXECUTION.md](src/EXECUTION.md) came from running the builder against the integration tests' throwaway cluster ([test/driver/setup/cluster.ts](test/driver/setup/cluster.ts)).
4. **Update the decision log** when a change makes, reverses or measures a design decision: add or edit its entry in [src/DECISIONS.md](src/DECISIONS.md) or [src/driver/DECISIONS.md](src/driver/DECISIONS.md) (what, why, alternatives, cost, measured, code), link it from the area document's **Decisions** section, and regenerate the lists in [DECISIONS.md](DECISIONS.md) from the entries' headings.
5. **Link to files and functions, not line numbers**, so the links survive refactors.
6. **Run `pnpm format`** (oxfmt formats Markdown too).
7. **Keep the maps here current**: a new or removed source directory, file group or document changes [the source map](#the-source-directory-by-directory) and [the document list](#every-internal-document) above.
