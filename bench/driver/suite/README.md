# Driver benchmark suite

An independent, reproducible comparison of `quarry/driver` against the other PostgreSQL clients for JavaScript, on Node, Bun and Deno. It covers:

- direct connections, PgBouncer in transaction mode, and simulated network round-trip times;
- latency distributions and throughput;
- concurrency and pool size, pipelining depth;
- writes, transactions, and prepared vs unprepared statements;
- large results, per-type decoding, streaming and backpressure;
- connections, TLS, SCRAM and server restarts;
- CPU, memory, GC and event-loop lag;
- errors, cancellation, LISTEN/NOTIFY;
- cold start, install size and bundle size.

`pnpm bench:driver` (`../run.ts`) remains the quick check. This suite is the thorough one: a full run takes several hours.

## Setup

On Ubuntu 24.04 (x86-64), from this directory:

```sh
./setup.sh
```

`setup.sh` installs:

- PostgreSQL 18 and PgBouncer from PGDG;
- Bun 1.4.3 and Deno 2.9.7;
- Toxiproxy 2.12, plus Neon's Go `wsproxy` (built with Go);
- matplotlib;
- quarry's build (`pnpm build`: the benchmark imports `dist/driver`, as users do);
- this directory's pinned npm dependencies, including the pg-native libpq addon.

Binaries go to `~/benchbin` (`BENCH_BIN`).

## Running

```sh
node orchestrate.ts --id run1                 # everything: verify, main, conc, pipeline, rtt, bouncer, reconnect
node footprint.ts --id run1                   # install/bundle size and cold start
node analyze.ts --id run1                     # results/run1/tables.md + summary.json
python3 charts.py results/run1/summary.json results/run1/charts
```

Useful options for `orchestrate.ts`:

- `--phases main,conc` picks phases.
- `--runtimes node,bun` picks runtimes.
- `--runs 5` sets the runs per cell (default 5).
- `--seed 1` sets the order shuffle.
- `--only-drivers quarry,pg` and `--only-scenarios pk,fetch1k` narrow the matrix.
- `--quick` uses 150 ms measurements, as a smoke test.
- `--parallel 3` runs cells concurrently. Use it only with `--quick`, since the timings are then meaningless.

Results append to `results/<id>/raw.jsonl` as each cell finishes, so re-running with the same `--id` resumes where it stopped.

To compare a change to the driver, build it somewhere else and point `QUARRY_DIST` at its `driver/index.js`; every quarry configuration then uses that build:

```sh
QUARRY_DIST=/path/to/other/dist/driver/index.js node orchestrate.ts --id candidate --only-drivers quarry
```

To run one cell by hand:

```sh
node --expose-gc worker.ts '{"driver":"quarry","scenario":"pk","target":{"host":"127.0.0.1","port":55432,"user":"bench_trust","database":"bench"},"caFile":"","max":10}'
```

## Environment

`env.ts` starts the following, each pinned with `taskset`:

| Component                          | CPUs (default)            | Notes                                                     |
| ---------------------------------- | ------------------------- | --------------------------------------------------------- |
| Benchmarked client process         | 0–2 (`BENCH_CLIENT_CPUS`) | One fresh process per cell and run                        |
| PostgreSQL 18                      | 4–7 (`BENCH_SERVER_CPUS`) | Own cluster in `~/.cache/quarry-driver-bench`, port 55432 |
| PgBouncer 1.26, Toxiproxy, wsproxy | 3 (`BENCH_PROXY_CPUS`)    | Ports 56432, 57432 (API 58474), 59432                     |

Move other processes off the client and server CPUs before a run, for example `for p in $(ps -eo pid=); do sudo taskset -pc 3 $p; done` (skipping PostgreSQL's processes).

Server settings, appended to `postgresql.conf` (see `SERVER_CONFIG` in `env.ts`):

- `shared_buffers = 2GB`
- `synchronous_commit = off`, so commits don't wait for the disk
- `jit = off`, so every client sees the same server work
- `autovacuum = off`, with `vacuum (analyze, freeze)` after loading
- no checkpoints during a run
- `ssl = on` with a test CA, and SCRAM-SHA-256 for the `bench_scram` role

The data set is generated once:

| Table          | Contents                                                                |
| -------------- | ----------------------------------------------------------------------- |
| `bench_users`  | 1M rows × 6 columns                                                     |
| `bench_wide`   | 1k rows × 100 columns                                                   |
| `bench_large`  | 10 × 1 MB text, 10 × 1 MB bytea, 20 × 200 KB jsonb, stored uncompressed |
| `bench_arrays` | 1k rows of `int4[100]` and `text[20]`                                   |
| `bench_types`  | 100k rows, one column per type                                          |
| Write tables   | Preloaded where needed                                                  |

PgBouncer runs in transaction mode with `max_prepared_statements = 500` and `default_pool_size = 20`.

Network latency comes from Toxiproxy's `latency` toxic. It is applied to the server → client direction, at the whole RTT, because Toxiproxy takes whole milliseconds. Each request still waits one RTT, and pipelined requests overlap. The kernel on the reference VM has no `tc` qdiscs, so netem wasn't an option. Toxiproxy adds its own cost at 0 ms, so compare RTT rows with each other, not with direct connections.

## Clients and configurations

Each client uses its public API, configured as its documentation recommends; `drivers.ts` has the exact code. The main configuration of each client runs every scenario. Variants run the scenarios where their knob matters.

| Name                    | Runtimes        | Configuration                                                                                                                                                                                                                                                                                              |
| ----------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quarry`                | Node, Bun, Deno | `createPool` from `dist/driver`, defaults (prepared statements with a 100-entry LRU, binary results for hot types, pipelining onto shared connections when the pool is busy). Decoding matches pg's (int8 and numeric as strings, timestamptz as `Date`); these are the parsers quarry's own adapter uses. |
| `quarry-lossless`       | all             | Standalone driver defaults: int8 as `bigint`, timestamptz and date as text.                                                                                                                                                                                                                                |
| `quarry-noprep`         | all             | `prepare: false`                                                                                                                                                                                                                                                                                           |
| `quarry-nopipe`         | Node            | `pipeline: false` (exclusive checkout, like pg)                                                                                                                                                                                                                                                            |
| `pg`                    | all             | node-postgres 8.23 `Pool`, `pool.query(text, values)`: unnamed statements                                                                                                                                                                                                                                  |
| `pg-named`              | all             | node-postgres with `{ name, text, values }`, one name per SQL text: its fastest mode for repeated queries                                                                                                                                                                                                  |
| `pg-native`             | Node            | `pg.native` Pool over libpq. The addon doesn't load in Bun (it needs Node's C++ `node::Buffer` symbols).                                                                                                                                                                                                   |
| `pg-native-named`       | Node            | pg-native with named statements                                                                                                                                                                                                                                                                            |
| `postgres.js`           | all             | postgres.js 3.4.9 defaults (`prepare: true`), `sql.unsafe(text, params)`                                                                                                                                                                                                                                   |
| `postgres.js-noprep`    | all             | `prepare: false`                                                                                                                                                                                                                                                                                           |
| `bun.sql`               | Bun             | `new Bun.SQL({ … })` defaults (`prepare: true`), `sql.unsafe`                                                                                                                                                                                                                                              |
| `bun.sql-noprep`        | Bun             | `prepare: false`                                                                                                                                                                                                                                                                                           |
| `neon`                  | Node            | `@neondatabase/serverless` 1.2 Pool over WebSocket through Neon's Go `wsproxy` on localhost, with `coalesceWrites: false`                                                                                                                                                                                  |
| `neon-default`          | Node            | The same with the default `coalesceWrites: true`, which batches writes with `setTimeout(0)`: at least 1 ms per round trip on Node                                                                                                                                                                          |
| `deno-postgres`         | Deno            | `jsr:@db/postgres@0.19.5` Pool, as shipped. It sends each message in its own write without `TCP_NODELAY`, so each query waits for a delayed ACK (~40 ms on Linux).                                                                                                                                         |
| `deno-postgres-nodelay` | Deno            | The same with `Deno.connect` patched to call `setNoDelay(true)`: its best case, not reachable through its API                                                                                                                                                                                              |

The pool size is 10 everywhere unless a scenario says otherwise. Every client gets the same SQL with `$n` parameters. Array parameters are pre-encoded literals, and COPY data is pre-encoded text, so the comparison covers the client's protocol and decoding work rather than parameter-encoding choices.

Features some clients lack are reported as n/a, not as zero:

- **COPY:** pg-native, Neon, Bun.sql (which hangs on `COPY … FROM STDIN`) and deno-postgres.
- **Cursors:** pg-native, Neon, Bun.sql and deno-postgres.
- **LISTEN:** deno-postgres.
- **Cancel:** Neon and deno-postgres. Bun.sql's `cancel()` doesn't stop a running query.

## Methodology

- **One process per cell and run.** Each cell (runtime × client × scenario × parameters) runs in a fresh process, which starts the pool and then warms up for at least 500 ms and at least 3 operations (JIT, prepared statements, every connection opened). It then forces a GC where the runtime allows (`--expose-gc`, `Bun.gc`) and measures for 1 s by default (2–3 s for big results, 2 s at RTT ≥ 5 ms).
- **Closed loop.** `concurrency` callers each wait for their previous operation. Latency is measured per operation, including any queueing inside the client.
- **Five runs, interleaved.** Every cell runs 5 times (`--runs`). The runs of all cells in a phase are shuffled together with a seeded PRNG, so drift on the machine spreads across clients.
- **Statistics.** `analyze.ts` reports the median over runs of each per-run metric (p50, p90, p99, p99.9, max, throughput, CPU, …) with a bootstrap 95% confidence interval of the median. With 5 runs the interval is coarse; treat differences inside it as ties.
- **Correctness.** Before measuring, the `verify` phase runs every scenario once per client and compares a digest of the canonical result (`canon.ts`) with the majority for that runtime. The canonical form normalizes representation, so int8 as bigint or string, bytea as Buffer or Uint8Array, and timestamps as text or `Date` all compare equal. Write scenarios compare the table contents afterwards. During measurement every result is checked cheaply (row count, the looked-up id, the expected SQLSTATE).

Resource metrics:

- **Client CPU:** `process.cpuUsage()` over the measured window, all threads, per operation.
- **Server CPU:** the sum of utime and stime of every `postgres` process, from `/proc`.
- **Memory:** peak RSS and heap, sampled every 10 ms.
- **GC pauses:** from `PerformanceObserver('gc')`, on Node only.
- **Event-loop lag:** the lateness of a 10 ms timer.

## Files

| File                      | Role                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `env.ts`                  | Cluster, data set, PgBouncer, Toxiproxy, wsproxy, CPU pinning |
| `drivers.ts`              | One adapter per client configuration                          |
| `scenarios.ts`            | Every scenario: operation, check, verification                |
| `worker.ts`               | Runs one cell; measurement and resource sampling              |
| `orchestrate.ts`          | The matrix, order, runs, resume                               |
| `canon.ts`                | Canonical results for the correctness check                   |
| `footprint.ts`, `cold.ts` | Install and bundle size, cold start                           |
| `analyze.ts`, `charts.py` | Tables and charts                                             |
