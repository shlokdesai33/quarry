# Driver benchmark suite

An independent, reproducible comparison of `quarry/driver` against the other PostgreSQL clients for Node. It covers:

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
- Toxiproxy 2.12, plus Neon's Go `wsproxy` (built with Go);
- matplotlib;
- quarry's build (`pnpm build`: the benchmark imports `dist/driver`, as users do);
- this directory's pinned npm dependencies, including the pg-native libpq addon.

Binaries go to `~/benchbin` (`BENCH_BIN`).

## Running

```sh
node orchestrate.ts --id run1                 # everything: verify, main, conc, pipeline, rtt, batch, builder, bouncer, reconnect
node footprint.ts --id run1                   # install/bundle size and cold start
node analyze.ts --id run1                     # results/run1/tables.md + summary.json
python3 charts.py results/run1/summary.json results/run1/charts
python3 report-tables.py results/run1/summary.json   # the headline tables the published report quotes
python3 compare-snapshots.py results-snapshots/<old>/tables.md results/run1/tables.md --column quarry   # before/after
```

Useful options for `orchestrate.ts`:

- `--phases main,conc` picks phases.
- `--runs 5` sets the runs per cell (default 5).
- `--seed 1` sets the order shuffle.
- `--only-drivers quarry,pg` and `--only-scenarios pk,fetch1k` narrow the matrix.
- `--quick` uses 150 ms measurements, as a smoke test.
- `--parallel 3` runs cells concurrently. Use it only with `--quick`, since the timings are then meaningless.

Results append to `results/<id>/raw.jsonl` as each cell finishes, so re-running with the same `--id` resumes where it stopped. `results/` is gitignored; `results-snapshots/` keeps the tables, footprint figures and metadata of the published runs; runs before Node only also cover Bun and Deno, which the scripts here now skip.

To compare a change to the driver, build it somewhere else and set `QUARRY_DIST_CANDIDATE` to its `driver/index.js`. Every `quarry` cell (and its equal-work memory twin) then gets a `quarry-candidate` twin, measured in the same session and shuffled with everything else:

```sh
QUARRY_DIST_CANDIDATE=/path/to/candidate/dist/driver/index.js node orchestrate.ts --id ab --only-drivers quarry,quarry-candidate,pg,postgres.js
```

`QUARRY_DIST` replaces the build for every quarry configuration instead (`worker.ts`, `cold.ts`). With `BENCH_NO_PROXIES=1`, `env.ts` starts no Toxiproxy or wsproxy, for quick local A/B runs without the `rtt`, `pipeline` and Neon cells.

To run one cell by hand:

```sh
node --expose-gc worker.ts '{"driver":"quarry","scenario":"pk","target":{"host":"127.0.0.1","port":55432,"user":"bench_trust","database":"bench"},"caFile":"","max":10}'
```

## Environment

`env.ts` starts the following, each pinned with `taskset`:

| Component | CPUs (default) | Notes |
| ---------------------------------- | --------------------------------------------------------- |
| Benchmarked client process | 0–2 (`BENCH_CLIENT_CPUS`) | One fresh process per cell and run |
| PostgreSQL 18 | 4–7 (`BENCH_SERVER_CPUS`) | Own cluster in `~/.cache/quarry-driver-bench`, port 55432 |
| PgBouncer 1.26, Toxiproxy, wsproxy | 3 (`BENCH_PROXY_CPUS`) | Ports 56432, 57432 (API 58474), 59432 |

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

| Name                 | Configuration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `quarry`             | `createPool` from `dist/driver`, defaults (prepared statements with a 100-entry LRU; binary results once a statement is described; pipelining onto shared connections when the pool is busy, with adaptive depth from 100 to 1000). Decoding matches pg's (int8 and numeric as strings, timestamptz as `Date`) through `codecs: [codecs.int8AsString, codecs.timestamptz]`.                                                                                                                                                                                              |
| `quarry-db`          | quarry's query builder (`database()` from the built `dist/index.js`), for the builder phases only. `batch`: three statements (a lookup, an insert, an update) one after another, with `Promise.all`, and with `db.batch`, outside and inside a transaction, at 0 and 5 ms RTT. `builder`: the `pk`, `insert1` and `update` statements built with the builder (`db-pk`, `db-insert`, `db-update`, plus `db-pk-timed` with `execute({ timeout: '2s' })`) at 1/100/500/1000 callers on pool 10, at 0 and 5 ms RTT, next to quarry, pg and postgres.js running the same SQL. |
| `quarry-lossless`    | Standalone driver defaults: int8 as `bigint`, timestamptz and date as text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `quarry-noprep`      | `prepare: false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `quarry-nopipe`      | `pipeline: false` (exclusive checkout, like pg)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pg`                 | node-postgres 8.23 `Pool`, `pool.query(text, values)`: unnamed statements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pg-named`           | node-postgres with `{ name, text, values }`, one name per SQL text: its fastest mode for repeated queries                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pg-native`          | `pg.native` Pool over libpq.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `pg-native-named`    | pg-native with named statements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `postgres.js`        | postgres.js 3.4.9 defaults (`prepare: true`), `sql.unsafe(text, params)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `postgres.js-noprep` | `prepare: false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `neon`               | `@neondatabase/serverless` 1.2 Pool over WebSocket through Neon's Go `wsproxy` on localhost, with `coalesceWrites: false`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `neon-default`       | The same with the default `coalesceWrites: true`, which batches writes with `setTimeout(0)`: at least 1 ms per round trip on Node                                                                                                                                                                                                                                                                                                                                                                                                                                        |

The pool size is 10 everywhere unless a scenario says otherwise. Every client gets the same SQL with `$n` parameters. COPY data is pre-encoded text. Array parameters come two ways: as pre-encoded literals (`bulk-unnest`), so the comparison covers protocol work rather than encoders, and as real JS arrays (`bulk-unnest-js`, `bulk-unnest-js1k`, `any1000-js`), as quarry's query builder passes them. In the JS-array scenarios quarry declares the parameter types (`text[]`, `float8[]`, `int4[]`) like its builder does. The other clients encode the arrays themselves.

Features some clients lack are reported as n/a, not as zero:

- **COPY:** pg-native and Neon.
- **Cursors:** pg-native and Neon.
- **Cancel:** Neon.

## Methodology

- **One process per cell and run.** Each cell (client × scenario × parameters) runs in a fresh process, which starts the pool and then warms up for at least 500 ms and at least 3 operations (JIT, prepared statements, every connection opened). It then forces a GC (`--expose-gc`), runs the warm-up operations once more without timing them (the forced GC also resets the heap's sizing, and a client that happened to keep its last warm-up result alive through it would start the window with a larger heap than the others), and measures for 1 s by default (2–3 s for big results, 2 s at RTT ≥ 5 ms). Equal-work memory cells skip the second warm-up, so every client does exactly the same operations.
- **Results are released.** The measuring loop drops each operation's result before starting the next one. A suspended `async` function keeps its registers, so without that every client would hold one result through the next operation, and large fetches would be measured with two results alive.
- **Closed loop.** `concurrency` callers each wait for their previous operation. Latency is measured per operation, including any queueing inside the client.
- **Five runs, interleaved.** Every cell runs 5 times (`--runs`). The runs of all cells in a phase are shuffled together with a seeded PRNG, so drift on the machine spreads across clients.
- **Statistics.** `analyze.ts` reports the median over runs of each per-run metric (p50, p90, p99, p99.9, max, mean, throughput, CPU, …) with a bootstrap 95% confidence interval of the median. With 5 runs the interval is coarse; treat differences inside it as ties. Large results are reported by mean as well as p50: a 100k- or 1M-row fetch takes a scavenge in some operations and none in others, so its p50 moves with where GC pauses fall, while the mean doesn't.
- **Correctness.** Before measuring, the `verify` phase runs every scenario once per client and compares a digest of the canonical result (`canon.ts`) with the majority. The canonical form normalizes representation, so int8 as bigint or string, bytea as Buffer or Uint8Array, and timestamps as text or `Date` all compare equal. Write scenarios compare the table contents afterwards. During measurement every result is checked cheaply (row count, the looked-up id, the expected SQLSTATE).

Resource metrics:

- **Client CPU:** `process.cpuUsage()` over the measured window, all threads, per operation.
- **Server CPU:** the sum of utime and stime of every `postgres` process, from `/proc`.
- **Memory:** peak RSS and heap, sampled every 10 ms. The primary figure is **at equal work**. Scenarios with `memOps` (fetch 100k × 5, fetch 1M × 3, wide × 50, large values, arrays × 50, stream 1M × 3) also run in a separate process for exactly that many operations, after the same fixed warm-up. The time-window peak is kept as a secondary figure. A window favours slower clients: V8 grows the heap about 4× after each mark-compact, so the peak tracks how many results were allocated in the window, not what one result holds.
- **GC pauses:** from `PerformanceObserver('gc')`.
- **Event-loop lag:** the lateness of a 10 ms timer.

## Files

| File                                       | Role                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `env.ts`                                   | Cluster, data set, PgBouncer, Toxiproxy, wsproxy, CPU pinning                           |
| `drivers.ts`                               | One adapter per client configuration                                                    |
| `scenarios.ts`                             | Every scenario: operation, check, verification                                          |
| `worker.ts`                                | Runs one cell; measurement and resource sampling                                        |
| `orchestrate.ts`                           | The matrix, order, runs, resume                                                         |
| `canon.ts`                                 | Canonical results for the correctness check                                             |
| `footprint.ts`, `cold.ts`                  | Install and bundle size, cold start                                                     |
| `analyze.ts`, `charts.py`                  | Tables and charts                                                                       |
| `report-tables.py`, `compare-snapshots.py` | Headline tables for the report; one client's before/after between two `tables.md` files |
