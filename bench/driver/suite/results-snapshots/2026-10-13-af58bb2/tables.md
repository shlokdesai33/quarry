### Correctness

Every result compared in canonical form (see `canon.ts`) against the majority digest for its runtime and scenario.

608 (runtime, client, scenario) results checked; 0 differ from the majority.

### Failed runs

- reconnect deno deno-postgres (+nodelay) reconnect (max 10, c -, rtt -): 5 failed: BrokenPipe: Broken pipe (os error 32)

## Node 24

**Node 24: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |    pg-native |  postgres.js |    neon (WS) |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | -----------: | -----------: |
| select 1                                                      |  **23.0 µs ±1%** |  25.9 µs ±1% | 25.9 µs ±14% | 31.2 µs ±42% |  27.8 µs ±2% | 45.9 µs ±29% |
| point lookup by primary key                                   |  **28.1 µs ±2%** |  46.0 µs ±2% | 35.3 µs ±38% |  49.9 µs ±4% |  32.9 µs ±3% | 79.9 µs ±48% |
| range scan, 100 rows                                          |  **93.2 µs ±2%** |  188 µs ±14% |   184 µs ±2% |   195 µs ±2% |   163 µs ±9% |   229 µs ±3% |
| fetch 1k rows (6 columns)                                     |  **322 µs ±10%** |  1.34 ms ±3% |  1.27 ms ±7% |  1.62 ms ±4% |   965 µs ±2% |  1.52 ms ±3% |
| 100 parameters (id in (…)), 100 rows                          |   **232 µs ±1%** |   316 µs ±3% |  265 µs ±11% |  320 µs ±<1% |   275 µs ±5% |   342 µs ±2% |
| 1000 parameters (id in (…)), 1000 rows                        |  **2.00 ms ±3%** |  2.53 ms ±2% |  2.09 ms ±1% |  2.83 ms ±3% | 2.25 ms ±15% |  2.51 ms ±1% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |  **1.78 ms ±4%** |  2.14 ms ±2% |  1.96 ms ±1% |  2.34 ms ±3% |  1.97 ms ±4% |  2.20 ms ±2% |
| insert one row                                                | **28.3 µs ±46%** |  38.6 µs ±1% |  30.1 µs ±1% | 44.1 µs ±34% |  33.0 µs ±4% | 69.0 µs ±32% |
| multi-row insert: 100 rows, 300 parameters                    |   **197 µs ±2%** |   300 µs ±6% |   215 µs ±3% |   313 µs ±2% |   336 µs ±1% |   326 µs ±7% |
| update one row by primary key                                 |  **32.0 µs ±2%** |  45.4 µs ±2% |  34.7 µs ±1% |  51.2 µs ±1% |  36.0 µs ±2% | 78.4 µs ±47% |
| upsert (insert … on conflict do update)                       |  **32.7 µs ±1%** |  43.3 µs ±1% |  34.9 µs ±1% |  49.1 µs ±1% |  36.7 µs ±2% | 76.4 µs ±16% |
| delete one row by primary key                                 |  **27.2 µs ±2%** |  37.2 µs ±8% |  29.1 µs ±1% |  42.8 µs ±1% |  30.6 µs ±3% |  68.9 µs ±5% |
| transaction: begin; select 1; commit                          |  **47.5 µs ±6%** |  67.3 µs ±2% | 69.8 µs ±55% | 82.3 µs ±51% |  80.1 µs ±1% |  127 µs ±63% |
| transaction: begin; insert; commit                            |  **52.7 µs ±1%** |  81.2 µs ±1% |  72.0 µs ±2% |  97.1 µs ±1% | 86.0 µs ±<1% |  149 µs ±67% |
| transaction with 5 savepoints (select 1 in each)              |  **265 µs ±58%** |   377 µs ±2% |   386 µs ±2% |  461 µs ±50% |   325 µs ±2% |   711 µs ±8% |
| query that fails (division by zero), connection reused        | **35.4 µs ±12%** | 2.30 ms ±20% | 2.35 ms ±25% |  4.81 ms ±2% |  54.0 µs ±2% | 2.62 ms ±24% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **32.6 µs ±38%** |  41.4 µs ±3% |  37.1 µs ±2% |  46.9 µs ±3% |  35.3 µs ±3% | 75.2 µs ±55% |

**Node 24: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |         pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ------------------------------------------------------------- | --------------: | ---------: | ----------: | ----------: | ----------: | ----------: |
| select 1                                                      |  **40,607 ±2%** | 35,927 ±2% | 35,949 ±12% | 30,729 ±27% |  33,398 ±2% | 19,799 ±17% |
| point lookup by primary key                                   |  **33,202 ±3%** | 20,297 ±2% | 25,444 ±25% |  19,153 ±7% |  28,164 ±4% | 11,530 ±33% |
| range scan, 100 rows                                          |   **9,952 ±7%** | 4,959 ±13% |   5,064 ±2% |   4,855 ±3% |   5,395 ±8% |   4,013 ±5% |
| fetch 1k rows (6 columns)                                     |   **2,831 ±7%** |    752 ±2% |     775 ±6% |     632 ±5% |     892 ±4% |     641 ±5% |
| 100 parameters (id in (…)), 100 rows                          |   **4,172 ±2%** |  3,008 ±3% |   3,593 ±9% |   3,020 ±1% |   3,431 ±6% |   2,741 ±2% |
| 1000 parameters (id in (…)), 1000 rows                        |     **497 ±3%** |    390 ±2% |     471 ±1% |     347 ±2% |    423 ±10% |     391 ±1% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     **557 ±4%** |    461 ±2% |     501 ±1% |     419 ±4% |     490 ±6% |     441 ±3% |
| insert one row                                                | **32,146 ±27%** | 24,513 ±1% |  30,947 ±1% | 21,376 ±26% |  27,939 ±7% | 13,339 ±22% |
| multi-row insert: 100 rows, 300 parameters                    |   **4,837 ±3%** |  3,172 ±6% |   4,402 ±3% |   3,072 ±3% |   2,851 ±1% |   2,940 ±9% |
| update one row by primary key                                 | **29,799 ±12%** | 20,865 ±3% |  27,079 ±3% |  18,490 ±2% |  26,023 ±3% | 11,934 ±31% |
| upsert (insert … on conflict do update)                       |  **28,607 ±3%** | 21,998 ±1% |  26,927 ±2% |  19,425 ±2% |  25,570 ±4% |  11,973 ±9% |
| delete one row by primary key                                 |  **34,036 ±3%** | 25,144 ±8% |  32,096 ±6% |  22,151 ±1% |  30,140 ±4% |  13,512 ±9% |
| transaction: begin; select 1; commit                          |  **19,332 ±5%** | 14,057 ±2% | 13,494 ±32% | 11,801 ±26% |  11,566 ±3% |  7,202 ±35% |
| transaction: begin; insert; commit                            |  **17,608 ±4%** | 11,631 ±3% |  13,154 ±2% |   9,943 ±8% |  10,690 ±4% |  6,313 ±40% |
| transaction with 5 savepoints (select 1 in each)              |  **3,558 ±35%** |  2,538 ±3% |   2,451 ±3% |  2,112 ±28% |   2,856 ±4% |   1,338 ±8% |
| query that fails (division by zero), connection reused        | **26,347 ±11%** |   423 ±16% |    413 ±20% |     208 ±1% |  16,994 ±3% |    370 ±18% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **26,442 ±19%** | 21,758 ±4% |  24,689 ±2% |  19,887 ±6% |  26,131 ±9% | 11,833 ±34% |

**Node 24: tail latency p99, sequential**

| Scenario                                                      |      quarry |         pg |  pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ---------: | ----------: | --------: | ----------: | --------: |
| select 1                                                      | **39.3 µs** |    40.8 µs |     46.7 µs |   44.0 µs |     42.8 µs |   92.3 µs |
| point lookup by primary key                                   | **45.4 µs** |    71.1 µs |     64.6 µs |   68.8 µs |     51.3 µs |    197 µs |
| range scan, 100 rows                                          |      289 µs |     561 µs |      566 µs |    363 µs |  **276 µs** |    632 µs |
| fetch 1k rows (6 columns)                                     |  **870 µs** |    1.89 ms |     1.89 ms |   2.08 ms |     6.25 ms |   2.17 ms |
| 100 parameters (id in (…)), 100 rows                          |  **328 µs** |     603 µs |      507 µs |    549 µs |      377 µs |    807 µs |
| 1000 parameters (id in (…)), 1000 rows                        | **2.34 ms** |    3.14 ms |     2.59 ms |   3.26 ms |     3.99 ms |   3.23 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.07 ms** |    2.55 ms |     2.35 ms |   2.77 ms |     3.79 ms |   3.11 ms |
| insert one row                                                |     59.2 µs |    62.1 µs | **54.9 µs** |   73.7 µs |     61.1 µs |    156 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **306 µs** |     540 µs |      349 µs |    530 µs |      643 µs |    644 µs |
| update one row by primary key                                 | **47.0 µs** |    65.6 µs |     55.7 µs |   76.2 µs |     57.0 µs |    163 µs |
| upsert (insert … on conflict do update)                       | **49.5 µs** |    62.7 µs |     53.5 µs |   69.1 µs |     56.7 µs |    168 µs |
| delete one row by primary key                                 | **44.0 µs** |    57.2 µs |     46.6 µs |   63.9 µs |     49.0 µs |    148 µs |
| transaction: begin; select 1; commit                          | **83.3 µs** |    93.1 µs |      100 µs |    109 µs |      124 µs |    251 µs |
| transaction: begin; insert; commit                            |  **100 µs** |     122 µs |      109 µs |    150 µs |      133 µs |    270 µs |
| transaction with 5 savepoints (select 1 in each)              |      713 µs | **487 µs** |      496 µs |    584 µs |      527 µs |   1.98 ms |
| query that fails (division by zero), connection reused        | **59.0 µs** |    3.04 ms |     3.17 ms |   5.40 ms |     93.7 µs |   4.04 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler |     79.0 µs |    92.4 µs |     82.8 µs |   84.3 µs | **69.6 µs** |    300 µs |

**Node 24: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) |  pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | ---------: | ----------: | --------: |
| select 1                                                      |      354 µs |  373 µs |     393 µs |     242 µs |  **156 µs** |    535 µs |
| point lookup by primary key                                   |      462 µs |  492 µs |     512 µs |     428 µs |  **299 µs** |    757 µs |
| range scan, 100 rows                                          |  **636 µs** |  894 µs |     756 µs |     669 µs |     6.25 ms |   1.11 ms |
| fetch 1k rows (6 columns)                                     | **1.99 ms** | 2.15 ms |    2.17 ms |    3.43 ms |     9.45 ms |   3.45 ms |
| 100 parameters (id in (…)), 100 rows                          |      928 µs | 1.12 ms |    1.49 ms | **909 µs** |     3.01 ms |   1.50 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **2.92 ms** | 3.85 ms |    3.43 ms |    3.58 ms |     7.23 ms |   4.15 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **3.00 ms** | 3.08 ms |    3.66 ms |    3.54 ms |     5.99 ms |   4.57 ms |
| insert one row                                                |      459 µs |  446 µs |     423 µs |     450 µs |  **321 µs** |    625 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **684 µs** | 1.27 ms |    1.25 ms |     695 µs |     1.89 ms |   1.57 ms |
| update one row by primary key                                 |      452 µs |  473 µs |     445 µs |     449 µs |  **221 µs** |    697 µs |
| upsert (insert … on conflict do update)                       |      478 µs |  446 µs |     463 µs |     441 µs |  **282 µs** |    657 µs |
| delete one row by primary key                                 |      444 µs |  466 µs |     447 µs |     378 µs |  **281 µs** |    595 µs |
| transaction: begin; select 1; commit                          |      564 µs |  509 µs |     625 µs | **437 µs** |     1.19 ms |   2.14 ms |
| transaction: begin; insert; commit                            |  **545 µs** | 1.05 ms |     611 µs |     569 µs |     1.30 ms |   1.82 ms |
| transaction with 5 savepoints (select 1 in each)              | **1.37 ms** | 3.01 ms |    2.46 ms |    2.12 ms |     3.80 ms |   4.81 ms |
| query that fails (division by zero), connection reused        |      444 µs | 4.32 ms |    3.71 ms |    5.88 ms |  **380 µs** |   5.38 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler |      470 µs |  509 µs |     495 µs | **430 µs** |      584 µs |    776 µs |

**Node 24: latency distribution, select 1**

| Percentile |          quarry |           pg |   pg (named) |         pg-native |     postgres.js |    neon (WS) |
| ---------- | --------------: | -----------: | -----------: | ----------------: | --------------: | -----------: |
| p50        | **23.0 µs ±1%** |  25.9 µs ±1% | 25.9 µs ±14% |      31.2 µs ±42% |     27.8 µs ±2% | 45.9 µs ±29% |
| p90        | **25.1 µs ±4%** |  27.7 µs ±6% | 28.2 µs ±21% |      32.8 µs ±41% |     30.6 µs ±3% | 51.5 µs ±27% |
| p99        | **39.3 µs ±9%** |  40.8 µs ±5% | 46.7 µs ±25% |      44.0 µs ±32% |    42.8 µs ±11% | 92.3 µs ±12% |
| p99.9      |     354 µs ±17% |  373 µs ±28% |  393 µs ±10% |       242 µs ±39% | **156 µs ±67%** |  535 µs ±18% |
| max        |    1.40 ms ±69% | 2.45 ms ±75% | 2.07 ms ±55% | **1.15 ms ±178%** |    5.36 ms ±39% | 2.36 ms ±38% |

**Node 24: latency distribution, point lookup by primary key**

| Percentile |          quarry |           pg |       pg (named) |    pg-native |     postgres.js |    neon (WS) |
| ---------- | --------------: | -----------: | ---------------: | -----------: | --------------: | -----------: |
| p50        | **28.1 µs ±2%** |  46.0 µs ±2% |     35.3 µs ±38% |  49.9 µs ±4% |     32.9 µs ±3% | 79.9 µs ±48% |
| p90        | **30.5 µs ±6%** |  50.6 µs ±3% |     42.1 µs ±39% | 52.9 µs ±14% |     36.6 µs ±4% | 90.6 µs ±43% |
| p99        | **45.4 µs ±7%** |  71.1 µs ±6% |     64.6 µs ±75% | 68.8 µs ±20% |     51.3 µs ±8% |  197 µs ±57% |
| p99.9      |      462 µs ±7% |   492 µs ±7% |      512 µs ±12% |  428 µs ±11% | **299 µs ±21%** | 757 µs ±252% |
| max        |    3.05 ms ±91% | 3.01 ms ±45% | **2.48 ms ±64%** | 2.58 ms ±42% |    5.63 ms ±45% | 5.12 ms ±53% |

**Node 24: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |           pg |       pg (named) |    pg-native |   postgres.js |     neon (WS) |
| --------------------------------------------------------------------------- | ---------------: | -----------: | ---------------: | -----------: | ------------: | ------------: |
| fetch 100k rows                                                             | **37.09 ms ±7%** |   131 ms ±8% |       129 ms ±4% |   144 ms ±5% |  97.26 ms ±3% |    135 ms ±6% |
| fetch 1M rows (one result)                                                  |  **487 ms ±15%** | 1293 ms ±11% |     1274 ms ±17% |  1517 ms ±6% |   1078 ms ±4% |   1458 ms ±5% |
| wide rows: 1k rows × 100 columns                                            |  **3.64 ms ±7%** | 14.53 ms ±3% |    14.75 ms ±13% | 21.14 ms ±2% |  14.83 ms ±3% |  17.08 ms ±8% |
| large values: 10 × 1 MB text                                                | **4.78 ms ±17%** | 5.83 ms ±16% |      5.65 ms ±1% | 12.27 ms ±8% |  5.01 ms ±23% |   8.69 ms ±6% |
| large values: 10 × 1 MB bytea                                               | **3.63 ms ±54%** | 17.39 ms ±9% |     17.33 ms ±2% | 33.23 ms ±7% | 15.70 ms ±12% |  24.60 ms ±4% |
| large values: 20 × 200 KB jsonb                                             |     24.75 ms ±6% | 25.11 ms ±6% | **23.52 ms ±4%** | 38.55 ms ±4% | 25.50 ms ±13% |  28.17 ms ±8% |
| arrays: 1k rows of int4[100] + text[20]                                     | **3.25 ms ±11%** | 22.38 ms ±9% |    22.27 ms ±11% | 25.88 ms ±5% |   8.32 ms ±7% |  23.97 ms ±2% |
| bulk insert 10k rows (unnest arrays)                                        | **13.09 ms ±3%** | 13.34 ms ±3% |     13.21 ms ±4% | 13.31 ms ±4% |  13.36 ms ±4% |  13.94 ms ±3% |
| bulk insert 10k rows (unnest, JS array parameters)                          | **12.79 ms ±2%** | 15.97 ms ±4% |     15.62 ms ±7% | 15.56 ms ±1% |  15.97 ms ±4% | 16.79 ms ±11% |
| bulk insert 1k rows (unnest, JS array parameters)                           |  **1.53 ms ±4%** |  1.82 ms ±4% |      1.80 ms ±4% |  1.81 ms ±7% |   1.88 ms ±2% |   2.00 ms ±4% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     12.85 ms ±2% | 12.95 ms ±2% | **12.82 ms ±4%** |          n/a | 55.88 ms ±<1% |           n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **737 ms ±5%** |  1283 ms ±5% |      1277 ms ±2% |          n/a |  1047 ms ±12% |           n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **421 ms ±1%** |   714 ms ±2% |       729 ms ±1% |          n/a |    689 ms ±1% |           n/a |

**Node 24: rows per second (median)**

| Scenario                                           |        quarry |          pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | ------------: | ----------: | ---------: | --------: | ----------: | --------: |
| fetch 1k rows (6 columns)                          | **2,831,491** |     752,199 |    775,316 |   632,154 |     891,690 |   641,340 |
| fetch 100k rows                                    | **2,726,896** |     765,400 |    768,098 |   680,944 |   1,008,042 |   728,461 |
| fetch 1M rows (one result)                         | **2,091,400** |     775,024 |    788,653 |   658,829 |     934,233 |   688,212 |
| wide rows: 1k rows × 100 columns                   |   **259,419** |      65,258 |     64,531 |    45,733 |      56,951 |    57,552 |
| arrays: 1k rows of int4[100] + text[20]            |   **301,879** |      42,709 |     42,392 |    38,096 |     110,319 |    38,941 |
| stream 1M rows with a cursor (1000 per batch)      | **1,332,422** |     779,429 |    791,567 |       n/a |     954,432 |       n/a |
| bulk insert 10k rows (unnest arrays)               |   **762,060** |     747,984 |    756,835 |   747,906 |     746,465 |   714,659 |
| bulk insert 10k rows (unnest, JS array parameters) |   **776,688** |     623,476 |    628,560 |   635,838 |     625,831 |   583,694 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **663,973** |     545,977 |    548,915 |   544,244 |     521,217 |   490,981 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       769,153 | **771,958** |    752,694 |       n/a |     179,205 |       n/a |

**Node 24: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------- | ------: | ------: | ---------: | --------: | ----------: | --------: |
| fetch 100k rows × 5                               | **281** |     373 |        374 |       432 |         346 |       382 |
| fetch 1M rows (one result) × 3                    | **999** |   1,369 |      1,368 |     1,665 |       1,119 |     1,399 |
| wide rows: 1k rows × 100 columns × 50             | **154** |     195 |        196 |       192 |         366 |       246 |
| large values: 10 × 1 MB text × 20                 | **181** |     198 |        201 |       233 |         185 |       224 |
| large values: 10 × 1 MB bytea × 20                | **184** |     206 |        204 |       215 |         194 |       229 |
| large values: 20 × 200 KB jsonb × 10              |     235 | **194** |        195 |       195 |         254 |       209 |
| arrays: 1k rows of int4[100] + text[20] × 50      | **156** |     325 |        318 |       258 |         266 |       323 |
| stream 1M rows with a cursor (1000 per batch) × 3 | **147** |     210 |        210 |       n/a |         245 |       n/a |

**Node 24: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    |  quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------------------------------------- | ------: | ------: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key                                                 |     107 |     106 |        107 |       104 |         150 |   **103** |
| fetch 100k rows                                                             | **514** |     540 |        541 |       525 |         514 |       595 |
| fetch 1M rows (one result)                                                  |   2,091 |   1,369 |      1,368 |     1,665 |   **1,119** |     1,398 |
| stream 1M rows with a cursor (1000 per batch)                               | **147** |     211 |        211 |       n/a |         245 |       n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |     188 | **119** |        119 |       n/a |         229 |       n/a |
| large values: 10 × 1 MB text                                                | **190** |     206 |        210 |       281 |         196 |       233 |
| large values: 10 × 1 MB bytea                                               | **193** |     215 |        216 |       241 |         194 |       236 |
| large values: 20 × 200 KB jsonb                                             |     359 |     323 |        302 |   **261** |         389 |       346 |

**Node 24: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |  quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------------------- | ------: | ------: | ---------: | --------: | ----------: | --------: |
| RSS growth during pause | **0.0** | **0.0** |    **0.0** |       n/a |     **0.0** |       n/a |

**Node 24: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry | quarry (lossless) |         pg | pg (named) | pg-native | postgres.js |  neon (WS) |
| -------------------- | -----------: | ----------------: | ---------: | ---------: | --------: | ----------: | ---------: |
| int4                 |   **77 ±2%** |            78 ±9% |    194 ±3% |    196 ±5% |   200 ±2% |     266 ±7% |   276 ±17% |
| int8                 |  **112 ±2%** |           156 ±5% |    226 ±9% |   235 ±12% |   215 ±5% |    260 ±12% |   317 ±17% |
| float8               |   **82 ±2%** |            82 ±1% |    210 ±4% |   211 ±13% |   232 ±1% |    297 ±20% |   336 ±26% |
| numeric              |  **137 ±2%** |           137 ±7% |   176 ±17% |   173 ±23% |   238 ±1% |    259 ±15% |   264 ±45% |
| text                 |      113 ±9% |       **111 ±6%** |    173 ±6% |    174 ±3% |   203 ±5% |    249 ±25% |   266 ±10% |
| bool                 |       85 ±6% |        **83 ±1%** |    145 ±7% |   149 ±15% |   169 ±2% |     221 ±4% |   239 ±17% |
| timestamptz          | **111 ±16%** |           163 ±2% |    677 ±2% |    677 ±5% |  728 ±13% |     439 ±4% |    759 ±7% |
| date                 |  **112 ±3%** |           112 ±2% |    500 ±4% |   507 ±17% |   451 ±2% |     363 ±7% |   586 ±16% |
| uuid                 |  **126 ±3%** |           128 ±7% |    209 ±8% |   189 ±13% |   233 ±8% |    257 ±21% |   282 ±24% |
| jsonb (small object) |  **383 ±9%** |           384 ±8% |    439 ±8% |   476 ±21% |   553 ±1% |     506 ±2% |    558 ±7% |
| int4[5]              |  **276 ±7%** |          292 ±29% | 1,291 ±13% |  1,156 ±2% | 1,223 ±9% |     635 ±9% | 1,612 ±15% |
| bytea (16 B)         |  **170 ±5%** |          177 ±42% |    386 ±4% |   373 ±21% |  388 ±14% |    376 ±22% |   455 ±10% |

**Node 24: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |          quarry |           pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| -------------------------------------------------- | --------------: | -----------: | ----------: | ----------: | ----------: | ----------: |
| insert one row                                     | **32,146 ±27%** |   24,513 ±1% |  30,947 ±1% | 21,376 ±26% |  27,939 ±7% | 13,339 ±22% |
| insert one row, concurrency 50                     | **221,735 ±5%** |  87,576 ±22% | 81,843 ±12% |  70,843 ±3% |  40,950 ±1% |  32,803 ±9% |
| multi-row insert: 100 rows, 300 parameters         |   **4,837 ±3%** |    3,172 ±6% |   4,402 ±3% |   3,072 ±3% |   2,851 ±1% |   2,940 ±9% |
| bulk insert 10k rows (unnest arrays)               |    **76.2 ±5%** |     74.8 ±3% |    75.7 ±5% |    74.8 ±4% |    74.6 ±4% |    71.5 ±3% |
| bulk insert 10k rows (unnest, JS array parameters) |    **77.7 ±1%** |     62.3 ±5% |    62.9 ±5% |    63.6 ±1% |    62.6 ±3% |    58.4 ±7% |
| bulk insert 1k rows (unnest, JS array parameters)  |     **664 ±5%** |      546 ±6% |     549 ±4% |     544 ±8% |     521 ±6% |     491 ±7% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |        76.9 ±2% | **77.2 ±3%** |    75.3 ±5% |         n/a |    17.9 ±6% |         n/a |
| update one row by primary key                      | **29,799 ±12%** |   20,865 ±3% |  27,079 ±3% |  18,490 ±2% |  26,023 ±3% | 11,934 ±31% |
| upsert (insert … on conflict do update)            |  **28,607 ±3%** |   21,998 ±1% |  26,927 ±2% |  19,425 ±2% |  25,570 ±4% |  11,973 ±9% |
| delete one row by primary key                      |  **34,036 ±3%** |   25,144 ±8% |  32,096 ±6% |  22,151 ±1% |  30,140 ±4% |  13,512 ±9% |

**Node 24: transactions, operations/s**

| Scenario                                         |         quarry |         pg |  pg (named) |   pg-native | postgres.js |  neon (WS) |
| ------------------------------------------------ | -------------: | ---------: | ----------: | ----------: | ----------: | ---------: |
| transaction: begin; select 1; commit             | **19,332 ±5%** | 14,057 ±2% | 13,494 ±32% | 11,801 ±26% |  11,566 ±3% | 7,202 ±35% |
| transaction: begin; insert; commit               | **17,608 ±4%** | 11,631 ±3% |  13,154 ±2% |   9,943 ±8% |  10,690 ±4% | 6,313 ±40% |
| transaction with 5 savepoints (select 1 in each) | **3,558 ±35%** |  2,538 ±3% |   2,451 ±3% |  2,112 ±28% |   2,856 ±4% |  1,338 ±8% |

**Node 24: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------ | ---------: | -------: | ---------: | --------: | ----------: | --------: |
| select 1                                               |   **16.6** |     17.0 |       19.7 |      20.3 |        22.8 |      26.6 |
| point lookup by primary key                            |   **17.7** |     26.4 |       25.5 |      26.4 |        26.3 |      55.7 |
| fetch 1k rows (6 columns)                              |    **328** |    1,198 |      1,189 |     1,245 |       1,190 |     1,362 |
| fetch 100k rows                                        | **53,330** |  168,908 |    166,511 |   160,681 |     127,264 |   171,493 |
| insert one row                                         |       19.4 | **19.0** |       19.5 |      23.4 |        25.8 |      45.3 |
| insert one row, concurrency 50                         |    **4.9** |     12.2 |       13.1 |      14.7 |        28.7 |      31.7 |
| transaction: begin; insert; commit                     |   **36.4** |     50.9 |       50.7 |      58.6 |        77.9 |      90.8 |
| query that fails (division by zero), connection reused |   **29.5** |      541 |        591 |     1,266 |        54.4 |     1,083 |

**Node 24: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------ | -------: | ---: | ---------: | --------: | ----------: | --------: |
| select 1                             |  **9.3** | 11.5 |        9.6 |      14.6 |        11.7 |      12.0 |
| point lookup by primary key          | **13.6** | 26.0 |       15.7 |      30.3 |        14.3 |      38.2 |
| fetch 1k rows (6 columns)            |  **239** |  411 |        374 |       490 |         401 |       446 |
| 100 parameters (id in (…)), 100 rows |      187 |  243 |        189 |       244 |     **186** |       247 |
| insert one row                       |     14.6 | 23.7 |   **14.2** |      28.5 |        14.7 |      33.9 |
| insert one row, concurrency 50       | **12.0** | 34.3 |       18.0 |      41.1 |        17.5 |      40.5 |
| transaction: begin; insert; commit   | **24.7** | 41.3 |       30.6 |      51.3 |        30.9 |      50.7 |

**Node 24: GC time (ms per second of run) / longest GC pause**

| Scenario                                       | quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ---------------------------------------------- | -----: | ------: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: GC ms/s           |   18.0 |    17.4 |       22.7 |   **9.6** |        24.0 |      17.3 |
| point lookup by primary key: max pause ms      |    1.1 |     0.6 |        0.6 |       0.6 |         5.1 |   **0.5** |
| insert one row, concurrency 50: GC ms/s        |   40.8 |    26.7 |       28.2 |  **19.4** |        25.9 |      23.3 |
| insert one row, concurrency 50: max pause ms   |    2.3 | **1.2** |        1.3 |       1.4 |         6.3 |       1.6 |
| fetch 1k rows (6 columns): GC ms/s             |   23.6 |    15.1 |       16.5 |  **11.4** |        80.0 |      21.0 |
| fetch 1k rows (6 columns): max pause ms        |    1.6 | **0.6** |        0.6 |       1.5 |         7.5 |       0.7 |
| fetch 100k rows: GC ms/s                       |  228.2 |   142.6 |      133.6 |  **86.5** |       137.0 |     123.0 |
| fetch 100k rows: max pause ms                  |   16.8 |    16.0 |       15.2 |      15.8 |        15.2 |  **11.0** |
| fetch 1M rows (one result): GC ms/s            |  234.0 |   167.2 |      146.1 |  **79.2** |       170.4 |     160.6 |
| fetch 1M rows (one result): max pause ms       |   33.8 |    21.7 |       18.4 |      17.3 |        29.4 |  **15.0** |
| wide rows: 1k rows × 100 columns: GC ms/s      |   26.1 |    24.1 |       26.1 |  **14.3** |       134.6 |      37.8 |
| wide rows: 1k rows × 100 columns: max pause ms |    4.2 |     3.6 |        4.3 |       2.8 |         8.7 |   **2.5** |
| large values: 20 × 200 KB jsonb: GC ms/s       |   36.2 |    35.0 |       32.3 |  **13.2** |        27.8 |      44.5 |
| large values: 20 × 200 KB jsonb: max pause ms  |    6.7 |     6.6 |        5.6 |   **4.6** |         6.8 |       6.4 |

**Node 24: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |   quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | -------: | ------: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: p99                   |  **0.2** |     1.7 |        0.4 |       0.3 |         1.2 |       2.2 |
| point lookup by primary key: max                   |      0.5 |     1.7 |    **0.5** |       0.9 |         1.2 |       2.2 |
| insert one row, concurrency 50: p99                |      0.6 | **0.4** |        0.4 |       0.4 |         5.0 |       0.4 |
| insert one row, concurrency 50: max                |      0.8 |     0.7 |    **0.5** |       0.8 |         5.0 |       0.9 |
| fetch 1k rows (6 columns): p99                     |  **0.5** |     0.8 |        0.6 |       1.2 |         5.9 |       0.8 |
| fetch 1k rows (6 columns): max                     |      0.7 |     0.9 |    **0.7** |       1.2 |         5.9 |       0.9 |
| fetch 100k rows: p99                               | **20.3** |    41.4 |       38.2 |     119.7 |        22.6 |      40.3 |
| fetch 100k rows: max                               | **21.6** |    41.4 |       38.2 |     119.7 |        24.0 |      40.3 |
| fetch 1M rows (one result): p99                    |     35.8 |    30.2 |   **29.1** |   1,209.9 |        32.5 |      37.0 |
| fetch 1M rows (one result): max                    |     39.3 |    32.1 |   **30.2** |   1,209.9 |        50.7 |      58.1 |
| stream 1M rows with a cursor (1000 per batch): p99 |  **0.4** |     0.7 |        1.0 |       n/a |         5.5 |       n/a |
| stream 1M rows with a cursor (1000 per batch): max |      1.6 | **1.2** |        1.4 |       n/a |         7.3 |       n/a |

**Node 24: connections (median time per operation)**

| Scenario                                                    |           quarry |           pg |   pg (named) |     pg-native |  postgres.js |        neon (WS) |
| ----------------------------------------------------------- | ---------------: | -----------: | -----------: | ------------: | -----------: | ---------------: |
| connect + select 1 + close (no TLS, trust)                  | **2.38 ms ±14%** |  3.99 ms ±6% | 3.98 ms ±<1% |   4.79 ms ±8% |  6.86 ms ±1% |      4.37 ms ±4% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          |  **2.81 ms ±2%** |  5.41 ms ±6% |  5.45 ms ±8% |   7.37 ms ±8% |  7.83 ms ±3% |     66.61 ms ±2% |
| connect + select 1 + close (TLS verify-full, trust)         |      4.93 ms ±7% |  5.08 ms ±8% |  5.07 ms ±4% |  4.99 ms ±10% | 52.88 ms ±4% | **4.42 ms ±11%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |  **5.27 ms ±2%** |  6.63 ms ±3% |  6.64 ms ±3% |   7.42 ms ±5% | 53.33 ms ±4% |     67.98 ms ±5% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     |  **7.90 ms ±2%** | 8.62 ms ±23% |  8.77 ms ±3% | 13.63 ms ±16% | 15.04 ms ±3% |      8.37 ms ±2% |

**Node 24: cancellation, notifications, errors**

| Scenario                                      |        quarry |          pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------- | ------------: | ----------: | ---------: | --------: | ----------: | --------: |
| cancel: time from cancel() to rejection (p50) |       1.52 ms | **1.49 ms** |    1.53 ms |   2.32 ms |     1.53 ms |       n/a |
| cancel: share of queries actually cancelled   |      **100%** |    **100%** |   **100%** |  **100%** |    **100%** |       n/a |
| NOTIFY latency p50                            |   **32.6 µs** |     41.4 µs |    37.1 µs |   46.9 µs |     35.3 µs |   75.2 µs |
| NOTIFY latency p99                            |       79.0 µs |     92.4 µs |    82.8 µs |   84.3 µs | **69.6 µs** |    300 µs |
| NOTIFY throughput (notifications/s)           | **2,474,939** |   2,007,090 |  2,044,712 |   833,507 |   1,731,755 | 1,686,882 |
| error path: failing queries/s                 |    **26,347** |         423 |        413 |       208 |      16,994 |       370 |

**Node 24: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |              pg-native |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 40,607 / 25,809 / +57% |  35,949 / 35,927 / +0% |  30,738 / 30,729 / +0% |   33,398 / 33,820 / -1% |
| point lookup by primary key             | 33,202 / 17,792 / +87% | 25,444 / 20,297 / +25% | 23,805 / 19,153 / +24% | 28,164 / 13,646 / +106% |
| range scan, 100 rows                    |   9,952 / 6,026 / +65% |    5,064 / 4,959 / +2% |    5,071 / 4,855 / +4% |    5,395 / 4,609 / +17% |
| fetch 1k rows (6 columns)               |  2,831 / 1,270 / +123% |        775 / 752 / +3% |        631 / 632 / -0% |         892 / 885 / +1% |
| 100 parameters (id in (…)), 100 rows    |   4,172 / 3,075 / +36% |   3,593 / 3,008 / +19% |   3,628 / 3,020 / +20% |    3,431 / 2,496 / +37% |
| 1000 parameters (id in (…)), 1000 rows  |       497 / 399 / +25% |       471 / 390 / +21% |       428 / 347 / +24% |        423 / 350 / +21% |
| insert one row                          | 32,146 / 25,521 / +26% | 30,947 / 24,513 / +26% | 25,933 / 21,376 / +21% |  27,939 / 14,398 / +94% |
| upsert (insert … on conflict do update) | 28,607 / 22,084 / +30% | 26,927 / 21,998 / +22% | 23,782 / 19,425 / +22% |  25,570 / 13,725 / +86% |

**Node 24: quarry decoding modes (time per op)**

| Scenario                                |            quarry | quarry (lossless) |
| --------------------------------------- | ----------------: | ----------------: |
| point lookup by primary key             |   **28.1 µs ±2%** |       28.9 µs ±4% |
| fetch 1k rows (6 columns)               |   **322 µs ±10%** |       356 µs ±11% |
| fetch 100k rows                         |  **37.09 ms ±7%** |      38.09 ms ±8% |
| fetch 1M rows (one result)              |       487 ms ±15% |    **475 ms ±9%** |
| wide rows: 1k rows × 100 columns        |   **3.64 ms ±7%** |       3.65 ms ±5% |
| arrays: 1k rows of int4[100] + text[20] |      3.25 ms ±11% |   **3.24 ms ±3%** |
| decode 100k × int8                      |  **11.15 ms ±2%** |      15.56 ms ±5% |
| decode 100k × timestamptz               | **11.09 ms ±16%** |      16.30 ms ±2% |
| decode 100k × date                      |  **11.16 ms ±3%** |      11.24 ms ±2% |

**Node 24: shipped defaults vs tuned (median latency)**

| Scenario                                   |   neon (WS) | neon (WS, defaults) |
| ------------------------------------------ | ----------: | ------------------: |
| select 1                                   | **45.9 µs** |             1.56 ms |
| point lookup by primary key                | **79.9 µs** |             1.69 ms |
| fetch 1k rows (6 columns)                  | **1.52 ms** |             3.01 ms |
| insert one row                             | **69.0 µs** |             1.64 ms |
| transaction: begin; insert; commit         |  **149 µs** |             4.69 ms |
| connect + select 1 + close (no TLS, trust) |     4.37 ms |                   — |

## Bun 1.4

**Bun 1.4: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |  postgres.js |         Bun.sql |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | --------------: |
| select 1                                                      | **20.6 µs ±25%** |  22.3 µs ±1% | 21.4 µs ±59% |  23.7 µs ±2% |     24.3 µs ±1% |
| point lookup by primary key                                   | **25.1 µs ±59%** |  40.6 µs ±3% |  28.3 µs ±4% |  27.8 µs ±1% |    28.8 µs ±41% |
| range scan, 100 rows                                          |  **77.5 µs ±1%** |   141 µs ±2% |  138 µs ±10% |   134 µs ±2% |     89.3 µs ±9% |
| fetch 1k rows (6 columns)                                     |   **265 µs ±1%** |   913 µs ±3% |   910 µs ±3% |  873 µs ±10% |      384 µs ±1% |
| 100 parameters (id in (…)), 100 rows                          |   **211 µs ±3%** |   289 µs ±3% |   233 µs ±3% |   244 µs ±8% |      221 µs ±2% |
| 1000 parameters (id in (…)), 1000 rows                        |      1.94 ms ±4% |  2.46 ms ±2% |  2.00 ms ±1% |  2.01 ms ±3% | **1.86 ms ±3%** |
| id = any($1) with 1000 ids (JS array), 1000 rows              |  **1.76 ms ±3%** |  2.13 ms ±4% |  1.94 ms ±2% |  1.91 ms ±2% |     1.82 ms ±5% |
| insert one row                                                |  **25.3 µs ±2%** |  35.0 µs ±1% |  25.8 µs ±1% |  27.0 µs ±1% |     28.0 µs ±1% |
| multi-row insert: 100 rows, 300 parameters                    |   **187 µs ±4%** |   291 µs ±2% |   205 µs ±6% |   235 µs ±2% |      192 µs ±8% |
| update one row by primary key                                 | **29.9 µs ±10%** |  41.9 µs ±1% |  30.2 µs ±1% |  31.2 µs ±1% |     32.1 µs ±1% |
| upsert (insert … on conflict do update)                       |  **30.2 µs ±1%** | 40.0 µs ±30% |  31.0 µs ±1% |  31.7 µs ±2% |    32.9 µs ±41% |
| delete one row by primary key                                 |  **24.9 µs ±1%** |  33.8 µs ±3% | 25.6 µs ±49% | 26.3 µs ±<1% |     27.3 µs ±1% |
| transaction: begin; select 1; commit                          |  **42.2 µs ±1%** |  58.3 µs ±1% |  57.8 µs ±2% |  67.6 µs ±1% |    76.5 µs ±10% |
| transaction: begin; insert; commit                            |  **47.7 µs ±2%** |  71.8 µs ±2% |  62.1 µs ±1% |  71.2 µs ±2% |     80.9 µs ±5% |
| transaction with 5 savepoints (select 1 in each)              |  **242 µs ±58%** |  329 µs ±66% |   332 µs ±2% |   279 µs ±1% |     432 µs ±32% |
| query that fails (division by zero), connection reused        |      31.9 µs ±5% |  2.28 ms ±3% |  2.29 ms ±3% |  36.8 µs ±4% | **27.5 µs ±2%** |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **29.5 µs ±1%** | 35.3 µs ±36% |  30.4 µs ±2% | 31.4 µs ±46% |     33.3 µs ±3% |

**Bun 1.4: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) | postgres.js |        Bun.sql |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ----------: | -------------: |
| select 1                                                      | **45,598 ±22%** |  43,110 ±1% | 45,266 ±37% |  40,169 ±1% |     40,081 ±2% |
| point lookup by primary key                                   | **38,433 ±38%** |  23,179 ±6% |  33,646 ±3% | 34,417 ±11% |    33,692 ±27% |
| range scan, 100 rows                                          |  **12,171 ±2%** |   6,762 ±3% |   6,796 ±9% |   7,130 ±2% |    10,706 ±10% |
| fetch 1k rows (6 columns)                                     |   **3,468 ±3%** |     996 ±3% |   1,008 ±3% |  1,046 ±13% |      2,505 ±7% |
| 100 parameters (id in (…)), 100 rows                          |   **4,636 ±4%** |   3,336 ±3% |   4,170 ±3% |   3,916 ±6% |      4,456 ±2% |
| 1000 parameters (id in (…)), 1000 rows                        |         508 ±4% |     399 ±2% |     490 ±2% |     486 ±3% |    **530 ±3%** |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     **563 ±4%** |     462 ±6% |     504 ±2% |     513 ±2% |        543 ±5% |
| insert one row                                                |  **37,363 ±4%** |  27,218 ±1% | 37,013 ±11% |  34,961 ±2% |     34,220 ±4% |
| multi-row insert: 100 rows, 300 parameters                    |   **5,067 ±5%** |   3,287 ±2% |   4,661 ±4% |   4,045 ±2% |      4,727 ±7% |
| update one row by primary key                                 |  **31,987 ±9%** |  22,957 ±2% |  31,958 ±2% |  30,985 ±6% |     30,310 ±2% |
| upsert (insert … on conflict do update)                       |  **31,968 ±2%** | 23,947 ±21% |  30,954 ±2% |  30,021 ±3% |    29,384 ±26% |
| delete one row by primary key                                 |  **37,774 ±1%** |  28,315 ±5% | 37,216 ±32% |  36,173 ±1% |     35,433 ±2% |
| transaction: begin; select 1; commit                          |  **22,663 ±1%** |  16,665 ±2% |  16,556 ±9% |  14,105 ±1% |    11,173 ±18% |
| transaction: begin; insert; commit                            |  **20,036 ±4%** |  13,431 ±3% |  15,339 ±2% |  13,450 ±6% |     11,184 ±8% |
| transaction with 5 savepoints (select 1 in each)              |  **3,981 ±32%** |  2,960 ±32% |  2,918 ±17% |   3,456 ±1% |      2,019 ±9% |
| query that fails (division by zero), connection reused        |     29,321 ±12% |     431 ±3% |     430 ±3% | 24,931 ±14% | **33,941 ±2%** |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **32,346 ±2%** | 26,677 ±22% | 31,385 ±15% | 30,310 ±31% |     29,086 ±4% |

**Bun 1.4: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ----------: | ----------: |
| select 1                                                      |     28.4 µs | 28.6 µs | **27.6 µs** |     32.2 µs |     32.4 µs |
| point lookup by primary key                                   | **31.9 µs** | 58.9 µs |     38.6 µs |     39.7 µs |     41.7 µs |
| range scan, 100 rows                                          |  **114 µs** |  411 µs |      434 µs |      314 µs |      132 µs |
| fetch 1k rows (6 columns)                                     |      750 µs | 1.63 ms |     1.61 ms |     1.58 ms |  **693 µs** |
| 100 parameters (id in (…)), 100 rows                          |      277 µs |  501 µs |      342 µs |      510 µs |  **259 µs** |
| 1000 parameters (id in (…)), 1000 rows                        |     2.63 ms | 3.12 ms |     2.66 ms |     2.66 ms | **2.17 ms** |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.11 ms** | 2.74 ms |     2.55 ms |     2.54 ms |     2.18 ms |
| insert one row                                                | **38.9 µs** | 51.0 µs |     39.8 µs |     44.1 µs |     45.4 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **278 µs** |  526 µs |      373 µs |      489 µs |      356 µs |
| update one row by primary key                                 |     41.0 µs | 65.2 µs | **40.2 µs** |     41.3 µs |     42.9 µs |
| upsert (insert … on conflict do update)                       | **39.5 µs** | 59.5 µs |     42.5 µs |     43.2 µs |     46.4 µs |
| delete one row by primary key                                 |     35.2 µs | 44.7 µs | **34.8 µs** |     35.9 µs |     35.3 µs |
| transaction: begin; select 1; commit                          | **54.7 µs** | 72.5 µs |     75.4 µs |     95.1 µs |      359 µs |
| transaction: begin; insert; commit                            | **70.8 µs** |  101 µs |     89.9 µs |      104 µs |      338 µs |
| transaction with 5 savepoints (select 1 in each)              |  **352 µs** |  582 µs |      642 µs |      700 µs |      985 µs |
| query that fails (division by zero), connection reused        |     43.2 µs | 2.98 ms |     2.93 ms |     54.2 µs | **42.0 µs** |
| LISTEN/NOTIFY latency: notify on another connection → handler |     48.0 µs | 61.9 µs |     49.1 µs |     47.5 µs | **47.4 µs** |

**Bun 1.4: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |          pg | pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ----------: | ---------: | ----------: | ----------: |
| select 1                                                      | **80.0 µs** |      239 µs |     252 µs |      256 µs |      163 µs |
| point lookup by primary key                                   | **85.2 µs** |      457 µs |     391 µs |      291 µs |      172 µs |
| range scan, 100 rows                                          |      532 µs |      650 µs |     665 µs |      548 µs |  **362 µs** |
| fetch 1k rows (6 columns)                                     |     1.22 ms |     2.69 ms |    2.80 ms |     2.31 ms | **1.19 ms** |
| 100 parameters (id in (…)), 100 rows                          |      511 µs |      875 µs |     635 µs |      803 µs |  **471 µs** |
| 1000 parameters (id in (…)), 1000 rows                        |     3.17 ms |     3.32 ms |    3.65 ms |     3.55 ms | **2.91 ms** |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     3.11 ms |     3.45 ms |    2.98 ms | **2.91 ms** |     3.01 ms |
| insert one row                                                | **94.6 µs** |      341 µs |     188 µs |      305 µs |      194 µs |
| multi-row insert: 100 rows, 300 parameters                    |      597 µs |      675 µs |     649 µs |      658 µs |  **579 µs** |
| update one row by primary key                                 |  **129 µs** |      341 µs |     259 µs |      270 µs |      172 µs |
| upsert (insert … on conflict do update)                       | **93.7 µs** |      324 µs |     308 µs |      213 µs |      216 µs |
| delete one row by primary key                                 |      114 µs |      324 µs |     308 µs |  **105 µs** |      168 µs |
| transaction: begin; select 1; commit                          |      576 µs |  **353 µs** |     390 µs |      529 µs |      570 µs |
| transaction: begin; insert; commit                            |      628 µs |  **457 µs** |     459 µs |      521 µs |      511 µs |
| transaction with 5 savepoints (select 1 in each)              |     1.36 ms | **1.04 ms** |    1.26 ms |     1.16 ms |     1.80 ms |
| query that fails (division by zero), connection reused        |      297 µs |     3.59 ms |    3.19 ms |      412 µs |  **182 µs** |
| LISTEN/NOTIFY latency: notify on another connection → handler |      482 µs |      453 µs |     383 µs |      474 µs |  **239 µs** |

**Bun 1.4: latency distribution, select 1**

| Percentile |           quarry |            pg |       pg (named) |   postgres.js |          Bun.sql |
| ---------- | ---------------: | ------------: | ---------------: | ------------: | ---------------: |
| p50        | **20.6 µs ±25%** |   22.3 µs ±1% |     21.4 µs ±59% |   23.7 µs ±2% |      24.3 µs ±1% |
| p90        |     22.5 µs ±53% |   23.3 µs ±2% | **22.2 µs ±65%** |   25.2 µs ±3% |      25.1 µs ±2% |
| p99        |     28.4 µs ±51% |   28.6 µs ±5% | **27.6 µs ±71%** |   32.2 µs ±3% |     32.4 µs ±30% |
| p99.9      | **80.0 µs ±31%** |   239 µs ±61% |      252 µs ±63% |   256 µs ±61% |      163 µs ±46% |
| max        |     1.48 ms ±49% | 1.65 ms ±223% |    1.16 ms ±256% | 1.51 ms ±117% | **653 µs ±265%** |

**Bun 1.4: latency distribution, point lookup by primary key**

| Percentile |            quarry |           pg |    pg (named) |   postgres.js |          Bun.sql |
| ---------- | ----------------: | -----------: | ------------: | ------------: | ---------------: |
| p50        |  **25.1 µs ±59%** |  40.6 µs ±3% |   28.3 µs ±4% |   27.8 µs ±1% |     28.8 µs ±41% |
| p90        |  **26.1 µs ±69%** | 46.1 µs ±17% |   30.9 µs ±4% |  31.2 µs ±39% |     31.9 µs ±33% |
| p99        |  **31.9 µs ±76%** | 58.9 µs ±16% |   38.6 µs ±5% |  39.7 µs ±32% |     41.7 µs ±28% |
| p99.9      | **85.2 µs ±473%** |   457 µs ±8% |   391 µs ±10% |   291 µs ±43% |      172 µs ±20% |
| max        |     1.20 ms ±243% | 1.79 ms ±63% | 1.34 ms ±489% | 1.05 ms ±221% | **869 µs ±226%** |

**Bun 1.4: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |               pg |   pg (named) |      postgres.js |          Bun.sql |
| --------------------------------------------------------------------------- | ---------------: | ---------------: | -----------: | ---------------: | ---------------: |
| fetch 100k rows                                                             | **23.59 ms ±7%** |     88.74 ms ±9% | 97.98 ms ±9% |     82.58 ms ±4% |    32.87 ms ±11% |
| fetch 1M rows (one result)                                                  |   **252 ms ±4%** |       946 ms ±4% |   931 ms ±2% |       941 ms ±5% |      361 ms ±10% |
| wide rows: 1k rows × 100 columns                                            |  **2.68 ms ±1%** |     11.29 ms ±5% | 10.95 ms ±6% |     10.25 ms ±4% |      8.52 ms ±9% |
| large values: 10 × 1 MB text                                                |      5.26 ms ±9% |     5.10 ms ±10% | 5.35 ms ±31% |     5.26 ms ±32% |  **4.38 ms ±4%** |
| large values: 10 × 1 MB bytea                                               | **4.27 ms ±29%** |     11.89 ms ±8% | 11.85 ms ±3% |     11.74 ms ±2% |    11.35 ms ±18% |
| large values: 20 × 200 KB jsonb                                             |    17.55 ms ±15% |     17.14 ms ±1% | 16.94 ms ±6% |     17.65 ms ±6% | **16.82 ms ±3%** |
| arrays: 1k rows of int4[100] + text[20]                                     |  **3.25 ms ±3%** |     18.46 ms ±5% | 17.97 ms ±2% |     7.96 ms ±21% |      4.85 ms ±1% |
| bulk insert 10k rows (unnest arrays)                                        |     13.15 ms ±3% |     13.35 ms ±3% | 12.78 ms ±2% | **12.72 ms ±6%** |     12.72 ms ±4% |
| bulk insert 10k rows (unnest, JS array parameters)                          | **13.21 ms ±6%** |     15.88 ms ±5% | 15.39 ms ±6% |     14.91 ms ±3% |     14.64 ms ±4% |
| bulk insert 1k rows (unnest, JS array parameters)                           |  **1.45 ms ±8%** |      1.82 ms ±4% |  1.70 ms ±2% |      1.70 ms ±3% |      1.58 ms ±2% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     12.82 ms ±2% | **12.74 ms ±5%** | 12.91 ms ±3% |     12.88 ms ±1% |              n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **552 ms ±4%** |      1013 ms ±5% |  1000 ms ±2% |       822 ms ±5% |              n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |  **423 ms ±<1%** |      673 ms ±<1% |   677 ms ±2% |       653 ms ±2% |              n/a |

**Bun 1.4: rows per second (median)**

| Scenario                                           |        quarry |          pg | pg (named) | postgres.js |     Bun.sql |
| -------------------------------------------------- | ------------: | ----------: | ---------: | ----------: | ----------: |
| fetch 1k rows (6 columns)                          | **3,467,793** |     995,968 |  1,008,269 |   1,045,660 |   2,505,303 |
| fetch 100k rows                                    | **4,073,697** |   1,118,923 |  1,018,144 |   1,209,433 |   2,999,598 |
| fetch 1M rows (one result)                         | **3,840,566** |   1,051,526 |  1,063,759 |   1,016,427 |   2,541,914 |
| wide rows: 1k rows × 100 columns                   |   **336,457** |      88,817 |     90,176 |      97,545 |     113,780 |
| arrays: 1k rows of int4[100] + text[20]            |   **291,197** |      53,602 |     55,294 |     127,147 |     202,539 |
| stream 1M rows with a cursor (1000 per batch)      | **1,809,845** |     982,618 |  1,004,007 |   1,185,819 |         n/a |
| bulk insert 10k rows (unnest arrays)               |       739,935 |     742,223 |    775,631 |     747,167 | **779,027** |
| bulk insert 10k rows (unnest, JS array parameters) |   **748,190** |     621,831 |    643,166 |     662,086 |     675,299 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **699,784** |     527,967 |    572,811 |     584,685 |     637,553 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       776,275 | **778,611** |    773,482 |     776,236 |         n/a |

**Bun 1.4: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |    pg | pg (named) | postgres.js | Bun.sql |
| ------------------------------------------------- | ------: | ----: | ---------: | ----------: | ------: |
| fetch 100k rows × 5                               |     139 |   208 |        249 |         173 | **138** |
| fetch 1M rows (one result) × 3                    | **557** | 1,024 |      1,269 |       1,008 |     845 |
| wide rows: 1k rows × 100 columns × 50             |     100 |   112 |        113 |          85 |  **61** |
| large values: 10 × 1 MB text × 20                 |     124 |   181 |        169 |         134 | **100** |
| large values: 10 × 1 MB bytea × 20                | **121** |   212 |        223 |         160 |     131 |
| large values: 20 × 200 KB jsonb × 10              |     101 |   144 |        146 |         110 |  **73** |
| arrays: 1k rows of int4[100] + text[20] × 50      |      72 |    95 |         94 |          91 |  **58** |
| stream 1M rows with a cursor (1000 per batch) × 3 |      72 |    67 |         68 |      **66** |     n/a |

**Bun 1.4: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    |  quarry |    pg | pg (named) | postgres.js | Bun.sql |
| --------------------------------------------------------------------------- | ------: | ----: | ---------: | ----------: | ------: |
| point lookup by primary key                                                 |      61 |    64 |         65 |          56 |  **48** |
| fetch 100k rows                                                             |     212 |   332 |        292 |     **185** |     201 |
| fetch 1M rows (one result)                                                  |   1,268 | 1,262 |      1,166 |   **1,016** |   1,076 |
| stream 1M rows with a cursor (1000 per batch)                               |      73 |    68 |         67 |      **67** |     n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |      62 |    64 |         63 |      **59** |     n/a |
| large values: 10 × 1 MB text                                                | **148** |   242 |        243 |         166 |     154 |
| large values: 10 × 1 MB bytea                                               |     179 |   244 |        258 |         179 | **137** |
| large values: 20 × 200 KB jsonb                                             |     165 |   183 |        183 |         124 |  **83** |

**Bun 1.4: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |    quarry |    pg | pg (named) | postgres.js | Bun.sql |
| ----------------------- | --------: | ----: | ---------: | ----------: | ------: |
| RSS growth during pause | **-24.0** | -13.7 |      -13.8 |       -18.6 |     n/a |

**Bun 1.4: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry | quarry (lossless) |       pg | pg (named) | postgres.js |  Bun.sql |
| -------------------- | -----------: | ----------------: | -------: | ---------: | ----------: | -------: |
| int4                 |   **76 ±1%** |           77 ±10% | 167 ±11% |   169 ±13% |     157 ±1% |  102 ±5% |
| int8                 |  **93 ±10%** |           123 ±7% | 189 ±20% |   193 ±18% |    156 ±19% |  124 ±3% |
| float8               |      83 ±10% |        **82 ±2%** |  201 ±2% |   206 ±18% |    173 ±11% |  113 ±7% |
| numeric              |      138 ±9% |       **137 ±1%** | 174 ±23% |   172 ±17% |     166 ±7% | 139 ±11% |
| text                 |      100 ±2% |       **100 ±1%** | 169 ±14% |   190 ±27% |    160 ±13% |  122 ±5% |
| bool                 |       84 ±6% |        **83 ±7%** |  159 ±4% |   136 ±20% |     137 ±4% |   90 ±5% |
| timestamptz          |   **92 ±2%** |           162 ±1% |  441 ±4% |    441 ±7% |     356 ±4% |  164 ±7% |
| date                 |      113 ±1% |       **113 ±9%** | 333 ±13% |   336 ±14% |     253 ±8% |  207 ±2% |
| uuid                 |     128 ±10% |       **128 ±1%** | 177 ±11% |   186 ±23% |    162 ±21% |  131 ±9% |
| jsonb (small object) |      292 ±8% |       **288 ±5%** |  431 ±7% |    423 ±5% |     389 ±4% |  303 ±4% |
| int4[5]              | **258 ±10%** |           259 ±4% |  767 ±4% |    792 ±6% |     419 ±3% |  376 ±2% |
| bytea (16 B)         |      133 ±6% |       **128 ±3%** | 485 ±15% |   481 ±11% |     451 ±8% |  134 ±8% |

**Bun 1.4: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |          quarry |           pg |  pg (named) | postgres.js |      Bun.sql |
| -------------------------------------------------- | --------------: | -----------: | ----------: | ----------: | -----------: |
| insert one row                                     |  **37,363 ±4%** |   27,218 ±1% | 37,013 ±11% |  34,961 ±2% |   34,220 ±4% |
| insert one row, concurrency 50                     | **254,789 ±4%** |  100,868 ±4% | 97,989 ±16% |  63,829 ±1% | 135,225 ±10% |
| multi-row insert: 100 rows, 300 parameters         |   **5,067 ±5%** |    3,287 ±2% |   4,661 ±4% |   4,045 ±2% |    4,727 ±7% |
| bulk insert 10k rows (unnest arrays)               |        74.0 ±3% |     74.2 ±8% |    77.6 ±2% |    74.7 ±8% | **77.9 ±5%** |
| bulk insert 10k rows (unnest, JS array parameters) |    **74.8 ±6%** |     62.2 ±6% |    64.3 ±6% |    66.2 ±2% |     67.5 ±4% |
| bulk insert 1k rows (unnest, JS array parameters)  |    **700 ±10%** |      528 ±6% |     573 ±2% |     585 ±9% |      638 ±3% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |        77.6 ±3% | **77.9 ±6%** |    77.3 ±3% |    77.6 ±1% |          n/a |
| update one row by primary key                      |  **31,987 ±9%** |   22,957 ±2% |  31,958 ±2% |  30,985 ±6% |   30,310 ±2% |
| upsert (insert … on conflict do update)            |  **31,968 ±2%** |  23,947 ±21% |  30,954 ±2% |  30,021 ±3% |  29,384 ±26% |
| delete one row by primary key                      |  **37,774 ±1%** |   28,315 ±5% | 37,216 ±32% |  36,173 ±1% |   35,433 ±2% |

**Bun 1.4: transactions, operations/s**

| Scenario                                         |         quarry |         pg | pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------ | -------------: | ---------: | ---------: | ----------: | ----------: |
| transaction: begin; select 1; commit             | **22,663 ±1%** | 16,665 ±2% | 16,556 ±9% |  14,105 ±1% | 11,173 ±18% |
| transaction: begin; insert; commit               | **20,036 ±4%** | 13,431 ±3% | 15,339 ±2% |  13,450 ±6% |  11,184 ±8% |
| transaction with 5 savepoints (select 1 in each) | **3,981 ±32%** | 2,960 ±32% | 2,918 ±17% |   3,456 ±1% |   2,019 ±9% |

**Bun 1.4: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |       pg | pg (named) | postgres.js |  Bun.sql |
| ------------------------------------------------------ | ---------: | -------: | ---------: | ----------: | -------: |
| select 1                                               |       12.5 | **11.9** |       12.9 |        13.3 |     13.3 |
| point lookup by primary key                            |   **13.1** |     20.2 |       17.2 |        16.2 |     16.5 |
| fetch 1k rows (6 columns)                              |    **248** |      939 |        963 |         879 |      347 |
| fetch 100k rows                                        | **28,429** |  101,984 |    112,890 |      93,051 |   37,873 |
| insert one row                                         |   **13.5** |     15.3 |       13.8 |        15.0 |     16.1 |
| insert one row, concurrency 50                         |    **4.0** |     10.1 |       10.8 |        16.0 |      8.0 |
| transaction: begin; insert; commit                     |   **28.0** |     39.6 |       39.6 |        44.8 |     43.3 |
| query that fails (division by zero), connection reused |       25.1 |      441 |        435 |        30.4 | **17.7** |

**Bun 1.4: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | Bun.sql |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | ------: |
| select 1                             |      9.6 | 11.4 |    **9.5** |        11.5 |    11.6 |
| point lookup by primary key          | **13.3** | 27.6 |       14.1 |        13.9 |    16.6 |
| fetch 1k rows (6 columns)            |  **243** |  380 |        355 |         373 |     353 |
| 100 parameters (id in (…)), 100 rows |  **181** |  239 |        187 |         192 |     187 |
| insert one row                       | **13.9** | 23.6 |       14.3 |        14.6 |    16.4 |
| insert one row, concurrency 50       | **11.7** | 31.6 |       19.7 |        14.9 |    13.6 |
| transaction: begin; insert; commit   | **23.8** | 40.3 |       30.9 |        30.0 |    41.1 |

**Bun 1.4: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |    quarry |    pg | pg (named) | postgres.js | Bun.sql |
| -------------------------------------------------- | --------: | ----: | ---------: | ----------: | ------: |
| point lookup by primary key: p99                   |       0.2 |   0.2 |        0.4 |     **0.1** |     0.1 |
| point lookup by primary key: max                   |       0.2 |   0.2 |        0.4 |     **0.1** |     0.1 |
| insert one row, concurrency 50: p99                |       0.8 |   0.5 |    **0.5** |         1.2 |     1.2 |
| insert one row, concurrency 50: max                |       0.8 |   0.5 |    **0.5** |         1.2 |     1.2 |
| fetch 1k rows (6 columns): p99                     |       1.0 |   0.8 |        1.0 |         0.9 | **0.3** |
| fetch 1k rows (6 columns): max                     |       1.0 |   0.8 |        1.0 |         0.9 | **0.3** |
| fetch 100k rows: p99                               |   **8.1** |  88.5 |       97.2 |        78.6 |    12.1 |
| fetch 100k rows: max                               |  **11.3** |  88.5 |       97.2 |        78.6 |    12.6 |
| fetch 1M rows (one result): p99                    | **307.9** | 990.0 |      949.6 |     1,025.2 |   511.5 |
| fetch 1M rows (one result): max                    | **307.9** | 990.0 |      949.6 |     1,025.2 |   511.5 |
| stream 1M rows with a cursor (1000 per batch): p99 |   **0.6** |   0.9 |        1.0 |         0.7 |     n/a |
| stream 1M rows with a cursor (1000 per batch): max |   **1.4** |   1.4 |        1.4 |         2.2 |     n/a |

**Bun 1.4: connections (median time per operation)**

| Scenario                                                    |          quarry |          pg |   pg (named) |  postgres.js |          Bun.sql |
| ----------------------------------------------------------- | --------------: | ----------: | -----------: | -----------: | ---------------: |
| connect + select 1 + close (no TLS, trust)                  |     2.33 ms ±2% | 3.85 ms ±6% |  3.93 ms ±8% |  6.38 ms ±4% |  **2.24 ms ±1%** |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | **2.51 ms ±7%** | 4.96 ms ±2% | 5.01 ms ±10% |  7.29 ms ±9% |      2.95 ms ±2% |
| connect + select 1 + close (TLS verify-full, trust)         |     4.32 ms ±4% | 4.12 ms ±4% |  4.13 ms ±4% |  7.09 ms ±4% |  **3.71 ms ±9%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |     4.74 ms ±6% | 5.51 ms ±4% |  5.50 ms ±6% |  8.01 ms ±5% |  **4.08 ms ±2%** |
| pool warm-up: new pool (max 10), 10 concurrent select 1     |    7.97 ms ±28% | 8.55 ms ±4% |  8.63 ms ±1% | 14.68 ms ±4% | **7.80 ms ±23%** |

**Bun 1.4: cancellation, notifications, errors**

| Scenario                                      |      quarry |          pg | pg (named) | postgres.js |       Bun.sql |
| --------------------------------------------- | ----------: | ----------: | ---------: | ----------: | ------------: |
| cancel: time from cancel() to rejection (p50) |     1.52 ms | **1.42 ms** |    1.49 ms |     1.51 ms |       2973 ms |
| cancel: share of queries actually cancelled   |    **100%** |    **100%** |   **100%** |    **100%** |            0% |
| NOTIFY latency p50                            | **29.5 µs** |     35.3 µs |    30.4 µs |     31.4 µs |       33.3 µs |
| NOTIFY latency p99                            |     48.0 µs |     61.9 µs |    49.1 µs |     47.5 µs |   **47.4 µs** |
| NOTIFY throughput (notifications/s)           |   2,511,061 |   2,011,699 |  1,979,059 |   1,636,652 | **2,541,892** |
| error path: failing queries/s                 |      29,321 |         431 |        430 |      24,931 |    **33,941** |

**Bun 1.4: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |                Bun.sql |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: | ---------------------: |
| select 1                                | 45,598 / 35,989 / +27% |  45,266 / 43,110 / +5% |   40,169 / 41,083 / -2% |  40,081 / 39,833 / +1% |
| point lookup by primary key             | 38,433 / 21,658 / +77% | 33,646 / 23,179 / +45% | 34,417 / 15,946 / +116% | 33,692 / 22,778 / +48% |
| range scan, 100 rows                    |  12,171 / 7,884 / +54% |    6,796 / 6,762 / +1% |    7,130 / 5,691 / +25% |  10,706 / 9,373 / +14% |
| fetch 1k rows (6 columns)               |   3,468 / 1,740 / +99% |      1,008 / 996 / +1% |     1,046 / 1,046 / +0% |    2,505 / 2,507 / -0% |
| 100 parameters (id in (…)), 100 rows    |   4,636 / 3,394 / +37% |   4,170 / 3,336 / +25% |    3,916 / 2,976 / +32% |   4,456 / 3,451 / +29% |
| 1000 parameters (id in (…)), 1000 rows  |       508 / 408 / +24% |       490 / 399 / +23% |        486 / 386 / +26% |       530 / 458 / +16% |
| insert one row                          | 37,363 / 27,666 / +35% | 37,013 / 27,218 / +36% | 34,961 / 17,076 / +105% | 34,220 / 25,534 / +34% |
| upsert (insert … on conflict do update) | 31,968 / 23,786 / +34% | 30,954 / 23,947 / +29% |  30,021 / 16,076 / +87% | 29,384 / 22,980 / +28% |

**Bun 1.4: quarry decoding modes (time per op)**

| Scenario                                |           quarry | quarry (lossless) |
| --------------------------------------- | ---------------: | ----------------: |
| point lookup by primary key             | **25.1 µs ±59%** |       25.7 µs ±2% |
| fetch 1k rows (6 columns)               |   **265 µs ±1%** |       333 µs ±<1% |
| fetch 100k rows                         | **23.59 ms ±7%** |      29.86 ms ±1% |
| fetch 1M rows (one result)              |   **252 ms ±4%** |       290 ms ±21% |
| wide rows: 1k rows × 100 columns        |  **2.68 ms ±1%** |       3.33 ms ±2% |
| arrays: 1k rows of int4[100] + text[20] |      3.25 ms ±3% |   **3.25 ms ±1%** |
| decode 100k × int8                      | **9.29 ms ±10%** |      12.30 ms ±7% |
| decode 100k × timestamptz               |  **9.16 ms ±2%** |      16.21 ms ±1% |
| decode 100k × date                      |     11.31 ms ±1% |  **11.29 ms ±9%** |

## Deno 2.9

**Deno 2.9: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | -----------------------: |
| select 1                                                      |  **25.8 µs ±2%** |  29.1 µs ±4% |  29.4 µs ±1% |  30.7 µs ±2% |             36.1 µs ±18% |
| point lookup by primary key                                   | **31.3 µs ±12%** |  51.1 µs ±2% | 39.9 µs ±43% |  36.1 µs ±5% |              70.5 µs ±3% |
| range scan, 100 rows                                          | **96.6 µs ±18%** |   198 µs ±7% |   195 µs ±2% |   160 µs ±2% |               977 µs ±4% |
| fetch 1k rows (6 columns)                                     |   **328 µs ±1%** |  1.41 ms ±3% |  1.38 ms ±3% |   984 µs ±1% |              7.15 ms ±7% |
| 100 parameters (id in (…)), 100 rows                          |   **234 µs ±3%** |   341 µs ±4% |   282 µs ±1% | 290 µs ±123% |               783 µs ±4% |
| 1000 parameters (id in (…)), 1000 rows                        |  **1.98 ms ±6%** |  2.72 ms ±3% | 2.27 ms ±10% |  2.33 ms ±5% |              6.50 ms ±2% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |  **1.82 ms ±2%** |  2.13 ms ±2% |  1.98 ms ±2% |  1.94 ms ±3% |              5.45 ms ±3% |
| insert one row                                                | **30.8 µs ±37%** |  42.3 µs ±5% |  33.6 µs ±2% |  37.3 µs ±5% |              55.4 µs ±2% |
| multi-row insert: 100 rows, 300 parameters                    |   **208 µs ±9%** |  361 µs ±10% |   268 µs ±1% |  390 µs ±15% |               422 µs ±2% |
| update one row by primary key                                 |  **35.2 µs ±2%** | 50.1 µs ±23% |  38.1 µs ±2% |  40.6 µs ±2% |             62.4 µs ±31% |
| upsert (insert … on conflict do update)                       |  **35.9 µs ±2%** |  48.0 µs ±3% | 39.0 µs ±28% |  40.4 µs ±3% |              60.5 µs ±2% |
| delete one row by primary key                                 | **30.4 µs ±10%** |  40.9 µs ±1% |  32.9 µs ±6% | 34.0 µs ±45% |              54.7 µs ±4% |
| transaction: begin; select 1; commit                          |  **53.8 µs ±1%** |  74.9 µs ±6% |  76.7 µs ±3% | 88.2 µs ±38% |              92.7 µs ±5% |
| transaction: begin; insert; commit                            |  **58.4 µs ±1%** |  89.6 µs ±1% | 81.1 µs ±51% | 94.3 µs ±10% |               111 µs ±1% |
| transaction with 5 savepoints (select 1 in each)              |  **280 µs ±11%** |   414 µs ±3% |   431 µs ±3% |  361 µs ±40% |               514 µs ±2% |
| query that fails (division by zero), connection reused        | **37.0 µs ±19%** | 2.29 ms ±20% |  2.41 ms ±1% | 96.5 µs ±17% |              41.7 µs ±7% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **36.8 µs ±29%** | 44.8 µs ±30% | 40.6 µs ±34% | 39.8 µs ±21% |                      n/a |

**Deno 2.9: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ----------: | -----------------------: |
| select 1                                                      |  **35,868 ±3%** | 31,922 ±13% |  31,493 ±1% |  29,261 ±3% |              24,968 ±18% |
| point lookup by primary key                                   | **29,272 ±17%** |  18,637 ±7% | 22,975 ±28% |  25,311 ±5% |               12,874 ±8% |
| range scan, 100 rows                                          |  **9,832 ±14%** |   4,841 ±5% |   4,946 ±3% |  5,586 ±16% |                  963 ±3% |
| fetch 1k rows (6 columns)                                     |   **2,870 ±2%** |     700 ±1% |     719 ±7% |     853 ±1% |                  123 ±3% |
| 100 parameters (id in (…)), 100 rows                          |   **4,146 ±4%** |   2,816 ±4% |   3,439 ±5% |  3,220 ±52% |                1,100 ±8% |
| 1000 parameters (id in (…)), 1000 rows                        |     **500 ±6%** |     359 ±3% |     432 ±5% |     404 ±6% |                  152 ±3% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     **538 ±4%** |     462 ±3% |     487 ±5% |     497 ±4% |                  180 ±3% |
| insert one row                                                | **29,836 ±20%** |  21,989 ±5% |  27,582 ±2% |  24,251 ±5% |               16,491 ±3% |
| multi-row insert: 100 rows, 300 parameters                    |   **4,644 ±9%** |   2,671 ±9% |   3,593 ±3% |  2,384 ±10% |                1,864 ±2% |
| update one row by primary key                                 |  **26,593 ±3%** | 18,849 ±14% |  24,382 ±6% |  22,925 ±4% |              14,808 ±22% |
| upsert (insert … on conflict do update)                       |  **25,864 ±2%** |  19,663 ±9% | 23,610 ±16% |  22,930 ±7% |               15,340 ±5% |
| delete one row by primary key                                 | **30,334 ±12%** |  22,800 ±2% |  27,933 ±7% | 26,940 ±27% |              17,022 ±13% |
| transaction: begin; select 1; commit                          |  **17,726 ±2%** |  12,452 ±7% |  12,161 ±6% | 10,346 ±23% |                9,926 ±6% |
| transaction: begin; insert; commit                            |  **16,092 ±1%** |  10,589 ±4% | 11,554 ±33% |   9,448 ±8% |                8,428 ±2% |
| transaction with 5 savepoints (select 1 in each)              |  **3,404 ±13%** |   2,262 ±2% |   2,182 ±8% |  2,520 ±22% |                1,815 ±2% |
| query that fails (division by zero), connection reused        | **24,722 ±12%** |    426 ±16% |     404 ±1% |  9,544 ±15% |               21,260 ±7% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **25,166 ±24%** | 20,699 ±22% | 22,861 ±23% | 22,820 ±18% |                      n/a |

**Deno 2.9: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | ----------: | -----------------------: |
| select 1                                                      | **46.8 µs** | 55.5 µs |    59.4 µs |     51.5 µs |                   109 µs |
| point lookup by primary key                                   | **57.4 µs** | 88.8 µs |    83.1 µs |     60.4 µs |                   167 µs |
| range scan, 100 rows                                          |  **167 µs** |  302 µs |     279 µs |      372 µs |                  2.04 ms |
| fetch 1k rows (6 columns)                                     |  **554 µs** | 2.24 ms |    2.04 ms |     5.86 ms |                 13.51 ms |
| 100 parameters (id in (…)), 100 rows                          |  **322 µs** |  591 µs |     417 µs |      553 µs |                  1.90 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **2.28 ms** | 3.42 ms |    3.00 ms |     5.40 ms |                 11.49 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.18 ms** | 2.68 ms |    2.89 ms |     4.60 ms |                  9.99 ms |
| insert one row                                                | **63.7 µs** | 83.5 µs |    67.6 µs |     70.6 µs |                   147 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **297 µs** |  622 µs |     372 µs |      784 µs |                  2.15 ms |
| update one row by primary key                                 | **60.2 µs** | 88.1 µs |    70.4 µs |     65.8 µs |                   155 µs |
| upsert (insert … on conflict do update)                       | **62.7 µs** | 82.0 µs |    74.0 µs |     64.2 µs |                   160 µs |
| delete one row by primary key                                 | **54.0 µs** | 74.4 µs |    65.0 µs |     55.4 µs |                   143 µs |
| transaction: begin; select 1; commit                          | **99.9 µs** |  110 µs |     113 µs |      150 µs |                   208 µs |
| transaction: begin; insert; commit                            |  **113 µs** |  129 µs |     125 µs |      163 µs |                   233 µs |
| transaction with 5 savepoints (select 1 in each)              |  **456 µs** |  664 µs |     752 µs |      875 µs |                   896 µs |
| query that fails (division by zero), connection reused        | **65.3 µs** | 3.00 ms |    3.10 ms |      154 µs |                   113 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |     80.8 µs | 99.3 µs |    96.8 µs | **78.6 µs** |                      n/a |

**Deno 2.9: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |          pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ----------: | ---------: | ----------: | -----------------------: |
| select 1                                                      |      164 µs |      155 µs | **145 µs** |      295 µs |                   265 µs |
| point lookup by primary key                                   |  **245 µs** |      366 µs |     296 µs |      474 µs |                   533 µs |
| range scan, 100 rows                                          |  **433 µs** |      579 µs |     589 µs |     3.91 ms |                  5.14 ms |
| fetch 1k rows (6 columns)                                     | **1.47 ms** |     4.50 ms |    4.35 ms |     8.32 ms |                 15.74 ms |
| 100 parameters (id in (…)), 100 rows                          |  **570 µs** |      938 µs |     855 µs |     3.43 ms |                  4.46 ms |
| 1000 parameters (id in (…)), 1000 rows                        |     3.94 ms | **3.74 ms** |    3.84 ms |    10.11 ms |                 12.02 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.85 ms** |     4.39 ms |    4.50 ms |     7.27 ms |                 10.58 ms |
| insert one row                                                |      239 µs |      277 µs | **176 µs** |      389 µs |                   285 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **569 µs** |     1.06 ms |     678 µs |     1.58 ms |                  2.57 ms |
| update one row by primary key                                 |  **230 µs** |      379 µs |     250 µs |      480 µs |                   386 µs |
| upsert (insert … on conflict do update)                       |  **251 µs** |      336 µs |     282 µs |      449 µs |                   354 µs |
| delete one row by primary key                                 |      262 µs |      342 µs | **211 µs** |      377 µs |                   316 µs |
| transaction: begin; select 1; commit                          |  **217 µs** |      894 µs |     861 µs |     1.61 ms |                   571 µs |
| transaction: begin; insert; commit                            |  **285 µs** |      849 µs |     838 µs |     1.55 ms |                   541 µs |
| transaction with 5 savepoints (select 1 in each)              |  **792 µs** |     4.81 ms |    4.65 ms |     4.79 ms |                  4.29 ms |
| query that fails (division by zero), connection reused        |  **173 µs** |     3.64 ms |    3.66 ms |      779 µs |                   302 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **326 µs** |      421 µs |     333 µs |      614 µs |                      n/a |

**Deno 2.9: latency distribution, select 1**

| Percentile |           quarry |           pg |      pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | ---------------: | -----------: | --------------: | -----------: | -----------------------: |
| p50        |  **25.8 µs ±2%** |  29.1 µs ±4% |     29.4 µs ±1% |  30.7 µs ±2% |             36.1 µs ±18% |
| p90        |  **29.4 µs ±5%** | 33.8 µs ±31% |     33.9 µs ±1% | 34.8 µs ±24% |             42.0 µs ±32% |
| p99        |  **46.8 µs ±9%** | 55.5 µs ±23% |     59.4 µs ±4% | 51.5 µs ±10% |              109 µs ±17% |
| p99.9      |      164 µs ±37% |  155 µs ±69% | **145 µs ±74%** |  295 µs ±46% |              265 µs ±68% |
| max        | **2.64 ms ±73%** | 2.89 ms ±19% |    3.73 ms ±85% | 6.60 ms ±27% |             2.86 ms ±92% |

**Deno 2.9: latency distribution, point lookup by primary key**

| Percentile |           quarry |           pg |   pg (named) |   postgres.js | deno-postgres (+nodelay) |
| ---------- | ---------------: | -----------: | -----------: | ------------: | -----------------------: |
| p50        | **31.3 µs ±12%** |  51.1 µs ±2% | 39.9 µs ±43% |   36.1 µs ±5% |              70.5 µs ±3% |
| p90        | **36.8 µs ±38%** | 56.4 µs ±22% | 48.6 µs ±31% |   40.4 µs ±5% |             84.0 µs ±30% |
| p99        | **57.4 µs ±57%** | 88.8 µs ±49% | 83.1 µs ±31% |   60.4 µs ±4% |              167 µs ±23% |
| p99.9      |  **245 µs ±91%** |  366 µs ±57% |  296 µs ±85% |   474 µs ±21% |              533 µs ±32% |
| max        |     5.42 ms ±54% | 3.18 ms ±35% | 3.27 ms ±34% | 4.32 ms ±104% |         **2.91 ms ±20%** |

**Deno 2.9: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |               pg |   pg (named) |       postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ---------------: | ---------------: | -----------: | ----------------: | -----------------------: |
| fetch 100k rows                                                             | **39.32 ms ±6%** |       129 ms ±6% |  132 ms ±16% |      97.21 ms ±6% |               813 ms ±4% |
| fetch 1M rows (one result)                                                  |  **487 ms ±17%** |      1360 ms ±4% |  1398 ms ±7% |       1018 ms ±9% |              8883 ms ±6% |
| wide rows: 1k rows × 100 columns                                            |  **3.45 ms ±2%** |     15.85 ms ±7% | 16.14 ms ±3% |     17.59 ms ±10% |            83.08 ms ±14% |
| large values: 10 × 1 MB text                                                |      9.77 ms ±7% |      8.88 ms ±7% |  9.71 ms ±6% |     10.27 ms ±11% |         **6.41 ms ±10%** |
| large values: 10 × 1 MB bytea                                               |  **3.45 ms ±2%** |     18.71 ms ±6% | 18.77 ms ±3% |      18.63 ms ±5% |               390 ms ±3% |
| large values: 20 × 200 KB jsonb                                             |    22.21 ms ±10% |     20.97 ms ±5% | 21.91 ms ±6% |     21.79 ms ±13% |         **18.62 ms ±7%** |
| arrays: 1k rows of int4[100] + text[20]                                     |  **3.27 ms ±3%** |     25.21 ms ±8% | 25.83 ms ±3% |      9.22 ms ±13% |            31.33 ms ±14% |
| bulk insert 10k rows (unnest arrays)                                        |    13.12 ms ±12% |    13.56 ms ±12% | 13.14 ms ±6% | **13.01 ms ±14%** |             13.13 ms ±4% |
| bulk insert 10k rows (unnest, JS array parameters)                          | **13.88 ms ±1%** |     15.69 ms ±7% | 15.86 ms ±4% |      15.60 ms ±4% |             15.86 ms ±3% |
| bulk insert 1k rows (unnest, JS array parameters)                           |  **1.61 ms ±5%** |      1.84 ms ±7% |  1.76 ms ±4% |       1.81 ms ±6% |              1.77 ms ±6% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     12.88 ms ±2% | **12.78 ms ±7%** | 13.04 ms ±3% |     55.93 ms ±<1% |                      n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **744 ms ±2%** |      1323 ms ±2% |  1317 ms ±4% |      1085 ms ±11% |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **656 ms ±2%** |       892 ms ±2% |   889 ms ±2% |        841 ms ±2% |                      n/a |

**Deno 2.9: rows per second (median)**

| Scenario                                           |        quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | ------------: | ------: | ---------: | ----------: | -----------------------: |
| fetch 1k rows (6 columns)                          | **2,870,361** | 699,558 |    719,302 |     852,508 |                  122,767 |
| fetch 100k rows                                    | **2,536,011** | 751,811 |    742,948 |     995,059 |                  122,403 |
| fetch 1M rows (one result)                         | **2,168,494** | 698,004 |    691,811 |     965,704 |                  114,112 |
| wide rows: 1k rows × 100 columns                   |   **283,980** |  61,896 |     60,891 |      55,740 |                   12,205 |
| arrays: 1k rows of int4[100] + text[20]            |   **299,127** |  38,206 |     37,296 |     100,113 |                   30,948 |
| stream 1M rows with a cursor (1000 per batch)      | **1,347,160** | 754,147 |    755,962 |     907,429 |                      n/a |
| bulk insert 10k rows (unnest arrays)               |       759,473 | 726,178 |    750,183 | **766,465** |                  759,805 |
| bulk insert 10k rows (unnest, JS array parameters) |   **716,049** | 615,209 |    623,111 |     636,810 |                  619,906 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **623,913** | 533,180 |    558,348 |     547,018 |                  564,169 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |   **770,642** | 738,938 |    762,206 |     179,202 |                      n/a |

**Deno 2.9: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| fetch 100k rows × 5                               | **271** |     300 |        300 |         295 |                      357 |
| fetch 1M rows (one result) × 3                    | **963** |   1,348 |      1,390 |       1,065 |                    1,464 |
| wide rows: 1k rows × 100 columns × 50             |     164 |     162 |    **162** |         266 |                      228 |
| large values: 10 × 1 MB text × 20                 |     234 |     252 |        244 |     **233** |                      241 |
| large values: 10 × 1 MB bytea × 20                | **190** |     262 |        251 |         209 |                      230 |
| large values: 20 × 200 KB jsonb × 10              |     212 | **163** |        167 |         239 |                      199 |
| arrays: 1k rows of int4[100] + text[20] × 50      |     188 |     268 |        271 |         206 |                  **169** |
| stream 1M rows with a cursor (1000 per batch) × 3 | **102** |     151 |        150 |         163 |                      n/a |

**Deno 2.9: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| point lookup by primary key                                                 |      81 |      76 |     **76** |         137 |                       81 |
| fetch 100k rows                                                             |     416 |     456 |        498 |         441 |                  **357** |
| fetch 1M rows (one result)                                                  |   1,357 |   1,394 |      1,373 |   **1,065** |                    1,448 |
| stream 1M rows with a cursor (1000 per batch)                               | **108** |     151 |        151 |         163 |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |     151 | **100** |        100 |         151 |                      n/a |
| large values: 10 × 1 MB text                                                | **249** |     283 |        287 |         250 |                      264 |
| large values: 10 × 1 MB bytea                                               | **207** |     264 |        269 |         230 |                      228 |
| large values: 20 × 200 KB jsonb                                             |     218 | **205** |        206 |         272 |                      218 |

**Deno 2.9: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  | quarry |  pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ----------------------- | -----: | --: | ---------: | ----------: | -----------------------: |
| RSS growth during pause |    0.2 | 0.2 |    **0.1** |         0.2 |                      n/a |

**Deno 2.9: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry |        pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------- | -----------: | --------: | ---------: | ----------: | -----------------------: |
| int4                 |  **77 ±10%** |  261 ±13% |    255 ±2% |    243 ±20% |                3,740 ±4% |
| int8                 |  **102 ±9%** |  267 ±35% |    260 ±4% |     224 ±9% |                3,743 ±6% |
| float8               |   **83 ±8%** |   266 ±4% |    261 ±4% |     277 ±7% |               3,730 ±19% |
| numeric              |  **141 ±7%** |   219 ±4% |    216 ±3% |     222 ±7% |               3,587 ±39% |
| text                 | **104 ±55%** |  240 ±30% |    229 ±4% |     236 ±6% |                3,679 ±7% |
| bool                 |   **84 ±1%** |  196 ±24% |    197 ±5% |     193 ±5% |                3,798 ±3% |
| timestamptz          | **137 ±23%** |   736 ±4% |    708 ±6% |    457 ±18% |                4,708 ±3% |
| date                 | **115 ±16%** |  516 ±13% |    523 ±5% |     383 ±2% |                3,928 ±5% |
| uuid                 | **161 ±20%** |   238 ±4% |    235 ±4% |     240 ±7% |               3,676 ±26% |
| jsonb (small object) |  **360 ±9%** |   471 ±4% |   485 ±10% |    496 ±11% |                4,233 ±4% |
| int4[5]              |  **258 ±1%** | 1,159 ±6% | 1,179 ±28% |     610 ±3% |                4,988 ±2% |
| bytea (16 B)         | **377 ±38%** |   409 ±3% |    406 ±3% |    406 ±43% |               5,340 ±25% |

**Deno 2.9: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |          quarry |          pg |  pg (named) |   postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | --------------: | ----------: | ----------: | ------------: | -----------------------: |
| insert one row                                     | **29,836 ±20%** |  21,989 ±5% |  27,582 ±2% |    24,251 ±5% |               16,491 ±3% |
| insert one row, concurrency 50                     | **183,080 ±3%** | 69,959 ±13% |  66,205 ±5% |    56,352 ±9% |              21,855 ±22% |
| multi-row insert: 100 rows, 300 parameters         |   **4,644 ±9%** |   2,671 ±9% |   3,593 ±3% |    2,384 ±10% |                1,864 ±2% |
| bulk insert 10k rows (unnest arrays)               |       75.9 ±11% |   72.6 ±10% |    75.0 ±6% | **76.6 ±12%** |                 76.0 ±3% |
| bulk insert 10k rows (unnest, JS array parameters) |    **71.6 ±1%** |    61.5 ±6% |   62.3 ±10% |      63.7 ±3% |                 62.0 ±3% |
| bulk insert 1k rows (unnest, JS array parameters)  |     **624 ±4%** |     533 ±9% |     558 ±6% |      547 ±17% |                 564 ±16% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |    **77.1 ±2%** |   73.9 ±12% |    76.2 ±4% |      17.9 ±1% |                      n/a |
| update one row by primary key                      |  **26,593 ±3%** | 18,849 ±14% |  24,382 ±6% |    22,925 ±4% |              14,808 ±22% |
| upsert (insert … on conflict do update)            |  **25,864 ±2%** |  19,663 ±9% | 23,610 ±16% |    22,930 ±7% |               15,340 ±5% |
| delete one row by primary key                      | **30,334 ±12%** |  22,800 ±2% |  27,933 ±7% |   26,940 ±27% |              17,022 ±13% |

**Deno 2.9: transactions, operations/s**

| Scenario                                         |         quarry |         pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------ | -------------: | ---------: | ----------: | ----------: | -----------------------: |
| transaction: begin; select 1; commit             | **17,726 ±2%** | 12,452 ±7% |  12,161 ±6% | 10,346 ±23% |                9,926 ±6% |
| transaction: begin; insert; commit               | **16,092 ±1%** | 10,589 ±4% | 11,554 ±33% |   9,448 ±8% |                8,428 ±2% |
| transaction with 5 savepoints (select 1 in each) | **3,404 ±13%** |  2,262 ±2% |   2,182 ±8% |  2,520 ±22% |                1,815 ±2% |

**Deno 2.9: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | ----------: | -----------------------: |
| select 1                                               |   **21.1** |    21.9 |       25.0 |        27.6 |                     34.7 |
| point lookup by primary key                            |   **23.5** |    30.8 |       33.3 |        31.2 |                     70.7 |
| fetch 1k rows (6 columns)                              |    **329** |   1,322 |      1,315 |       1,229 |                    9,172 |
| fetch 100k rows                                        | **56,605** | 163,836 |    169,196 |     128,933 |                  975,095 |
| insert one row                                         |   **22.7** |    24.1 |       25.1 |        32.5 |                     54.8 |
| insert one row, concurrency 50                         |    **5.9** |    15.4 |       16.3 |        21.7 |                     51.3 |
| transaction: begin; insert; commit                     |   **44.6** |    62.0 |       66.0 |        91.8 |                      101 |
| query that fails (division by zero), connection reused |   **34.3** |     498 |        538 |         102 |                     41.0 |

**Deno 2.9: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | -----------------------: |
| select 1                             |  **9.3** | 11.7 |        9.9 |        11.6 |                     11.9 |
| point lookup by primary key          |     14.3 | 26.3 |       15.2 |    **13.8** |                     34.2 |
| fetch 1k rows (6 columns)            |  **238** |  417 |        389 |         398 |                      420 |
| 100 parameters (id in (…)), 100 rows |      188 |  248 |    **186** |         192 |                      300 |
| insert one row                       | **13.8** | 24.3 |       14.1 |        14.6 |                     30.9 |
| insert one row, concurrency 50       | **12.5** | 31.9 |       18.0 |        15.5 |                     54.5 |
| transaction: begin; insert; commit   | **24.0** | 40.5 |       31.0 |        32.4 |                     49.0 |

**Deno 2.9: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| point lookup by primary key: p99                   |     1.3 |     1.2 |    **0.6** |         1.8 |                      0.7 |
| point lookup by primary key: max                   |     1.3 |     1.2 |    **0.6** |         1.8 |                      0.7 |
| insert one row, concurrency 50: p99                |     1.1 |     0.5 |    **0.5** |         2.7 |                      1.5 |
| insert one row, concurrency 50: max                |     1.1 |     0.5 |    **0.5** |         2.7 |                      1.5 |
| fetch 1k rows (6 columns): p99                     | **0.7** |     1.8 |        1.9 |         4.3 |                      4.4 |
| fetch 1k rows (6 columns): max                     | **0.7** |     1.8 |        1.9 |         4.3 |                      4.4 |
| fetch 100k rows: p99                               |    13.2 |    53.8 |       55.4 |        23.3 |                  **4.2** |
| fetch 100k rows: max                               |    16.2 |    53.8 |       55.4 |        23.8 |                  **7.1** |
| fetch 1M rows (one result): p99                    |    27.3 |    36.6 |       61.8 |        28.4 |                  **4.1** |
| fetch 1M rows (one result): max                    |    36.1 |    71.0 |       66.4 |        31.7 |                  **9.0** |
| stream 1M rows with a cursor (1000 per batch): p99 |     1.4 | **1.4** |        1.4 |         4.8 |                      n/a |
| stream 1M rows with a cursor (1000 per batch): max |     1.8 | **1.6** |        1.6 |         5.6 |                      n/a |

**Deno 2.9: connections (median time per operation)**

| Scenario                                                    |           quarry |          pg |   pg (named) |  postgres.js | deno-postgres (stock) | deno-postgres (+nodelay) |
| ----------------------------------------------------------- | ---------------: | ----------: | -----------: | -----------: | --------------------: | -----------------------: |
| connect + select 1 + close (no TLS, trust)                  | **2.39 ms ±15%** | 3.98 ms ±6% | 4.00 ms ±<1% |  7.93 ms ±1% |           2.46 ms ±6% |              2.46 ms ±3% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | **2.60 ms ±19%** | 5.25 ms ±9% | 5.47 ms ±16% |  9.79 ms ±3% |                     — |              3.80 ms ±8% |
| connect + select 1 + close (TLS verify-full, trust)         |      4.72 ms ±5% | 4.52 ms ±4% |  4.57 ms ±6% | 52.24 ms ±2% |                     — |         **3.99 ms ±10%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |  **5.00 ms ±8%** | 6.00 ms ±4% |  6.08 ms ±5% | 55.85 ms ±5% |                     — |              5.43 ms ±2% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     |  **7.89 ms ±4%** | 8.52 ms ±1% | 8.82 ms ±22% | 15.99 ms ±1% |                     — |              8.48 ms ±2% |

**Deno 2.9: cancellation, notifications, errors**

| Scenario                                      |        quarry |        pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------- | ------------: | --------: | ---------: | ----------: | -----------------------: |
| cancel: time from cancel() to rejection (p50) |   **1.45 ms** |   1.51 ms |    1.54 ms |     1.53 ms |                      n/a |
| cancel: share of queries actually cancelled   |      **100%** |  **100%** |   **100%** |    **100%** |                      n/a |
| NOTIFY latency p50                            |   **36.8 µs** |   44.8 µs |    40.6 µs |     39.8 µs |                      n/a |
| NOTIFY latency p99                            |       80.8 µs |   99.3 µs |    96.8 µs | **78.6 µs** |                      n/a |
| NOTIFY throughput (notifications/s)           | **2,549,204** | 1,848,000 |  1,823,926 |   1,750,095 |                      n/a |
| error path: failing queries/s                 |    **24,722** |       426 |        404 |       9,544 |                   21,260 |

**Deno 2.9: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 35,868 / 28,990 / +24% |  31,493 / 31,922 / -1% |   29,261 / 30,352 / -4% |
| point lookup by primary key             | 29,272 / 17,767 / +65% | 22,975 / 18,637 / +23% | 25,311 / 12,379 / +104% |
| range scan, 100 rows                    |   9,832 / 6,137 / +60% |    4,946 / 4,841 / +2% |    5,586 / 4,554 / +23% |
| fetch 1k rows (6 columns)               |  2,870 / 1,233 / +133% |        719 / 700 / +3% |         853 / 856 / -0% |
| 100 parameters (id in (…)), 100 rows    |   4,146 / 3,125 / +33% |   3,439 / 2,816 / +22% |    3,220 / 2,480 / +30% |
| 1000 parameters (id in (…)), 1000 rows  |       500 / 403 / +24% |       432 / 359 / +20% |        404 / 334 / +21% |
| insert one row                          | 29,836 / 22,190 / +34% | 27,582 / 21,989 / +25% |  24,251 / 12,766 / +90% |
| upsert (insert … on conflict do update) | 25,864 / 20,299 / +27% | 23,610 / 19,663 / +20% |  22,930 / 12,452 / +84% |

**Deno 2.9: shipped defaults vs tuned (median latency)**

| Scenario                                   | deno-postgres (+nodelay) | deno-postgres (stock) |
| ------------------------------------------ | -----------------------: | --------------------: |
| select 1                                   |              **36.1 µs** |               36.2 µs |
| point lookup by primary key                |              **70.5 µs** |              44.01 ms |
| fetch 1k rows (6 columns)                  |              **7.15 ms** |               7.18 ms |
| insert one row                             |              **55.4 µs** |              44.01 ms |
| transaction: begin; insert; commit         |                   111 µs |                     — |
| connect + select 1 + close (no TLS, trust) |                  2.46 ms |           **2.46 ms** |

## Across runtimes

**Throughput (operations/s) by runtime**

| Scenario                           | quarry (node) | pg (node) | pg (named) (node) | pg-native (node) | postgres.js (node) | neon (WS) (node) | quarry (bun) | pg (bun) | pg (named) (bun) | postgres.js (bun) | Bun.sql (bun) | quarry (deno) | pg (deno) | pg (named) (deno) | postgres.js (deno) | deno-postgres (+nodelay) (deno) |
| ---------------------------------- | ------------: | --------: | ----------------: | ---------------: | -----------------: | ---------------: | -----------: | -------: | ---------------: | ----------------: | ------------: | ------------: | --------: | ----------------: | -----------------: | ------------------------------: |
| select 1                           |        40,607 |    35,927 |            35,949 |           30,729 |             33,398 |           19,799 |       45,598 |   43,110 |           45,266 |            40,169 |        40,081 |        35,868 |    31,922 |            31,493 |             29,261 |                          24,968 |
| point lookup by primary key        |        33,202 |    20,297 |            25,444 |           19,153 |             28,164 |           11,530 |       38,433 |   23,179 |           33,646 |            34,417 |        33,692 |        29,272 |    18,637 |            22,975 |             25,311 |                          12,874 |
| fetch 1k rows (6 columns)          |         2,831 |       752 |               775 |              632 |                892 |              641 |        3,468 |      996 |            1,008 |             1,046 |         2,505 |         2,870 |       700 |               719 |                853 |                             123 |
| fetch 100k rows                    |          27.3 |       7.7 |               7.7 |              6.8 |               10.1 |              7.3 |         40.7 |     11.2 |             10.2 |              12.1 |          30.0 |          25.4 |       7.5 |               7.4 |               10.0 |                             1.2 |
| insert one row                     |        32,146 |    24,513 |            30,947 |           21,376 |             27,939 |           13,339 |       37,363 |   27,218 |           37,013 |            34,961 |        34,220 |        29,836 |    21,989 |            27,582 |             24,251 |                          16,491 |
| insert one row, concurrency 50     |       221,735 |    87,576 |            81,843 |           70,843 |             40,950 |           32,803 |      254,789 |  100,868 |           97,989 |            63,829 |       135,225 |       183,080 |    69,959 |            66,205 |             56,352 |                          21,855 |
| transaction: begin; insert; commit |        17,608 |    11,631 |            13,154 |            9,943 |             10,690 |            6,313 |       20,036 |   13,431 |           15,339 |            13,450 |        11,184 |        16,092 |    10,589 |            11,554 |              9,448 |                           8,428 |

## Concurrency sweep (Node 24): point lookups/s

**Node 24: pool size 1, point lookups/s by concurrency**

| Concurrency |          quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |     postgres.js |   neon (WS) |
| ----------- | --------------: | -----------------------: | ----------: | ----------: | ----------: | --------------: | ----------: |
| 1           | **33,312 ±35%** |              32,620 ±14% |  19,989 ±2% |  26,237 ±1% | 18,722 ±21% |      27,836 ±9% | 11,721 ±30% |
| 10          | **109,616 ±8%** |               33,210 ±1% |  20,745 ±1% |  27,568 ±2% | 19,260 ±23% |     109,039 ±3% | 12,062 ±31% |
| 50          |    113,104 ±25% |               33,483 ±1% |  20,755 ±2% |  27,468 ±2% |  19,394 ±1% | **117,281 ±1%** | 12,044 ±26% |
| 100         |     117,012 ±2% |               33,150 ±2% |  20,854 ±2% |  27,046 ±1% |  19,118 ±2% | **119,416 ±5%** | 12,308 ±32% |
| 500         | **115,396 ±3%** |              33,021 ±<1% |  20,622 ±1% |  27,015 ±1% |  19,164 ±2% |     106,343 ±4% | 12,093 ±15% |
| 1000        | **115,076 ±1%** |              32,624 ±32% | 20,323 ±20% | 27,060 ±15% |  18,912 ±2% |     106,596 ±3% | 12,145 ±31% |

**Node 24: pool size 1, p99 latency by concurrency**

| Concurrency |       quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | -----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           |  **42.4 µs** |                  43.1 µs |  72.6 µs |    59.9 µs |   73.8 µs |     51.9 µs |    209 µs |
| 10          |       215 µs |                   798 µs |   987 µs |     823 µs |    946 µs |  **161 µs** |   1.59 ms |
| 50          |      1.27 ms |                  2.46 ms |  3.73 ms |    2.82 ms |   3.50 ms |  **840 µs** |   7.10 ms |
| 100         |  **1.95 ms** |                  4.29 ms |  6.55 ms |    5.35 ms |   7.40 ms |     5.31 ms |  11.33 ms |
| 500         |  **6.80 ms** |                 21.35 ms | 33.63 ms |   24.40 ms |  32.57 ms |    11.48 ms |  47.27 ms |
| 1000        | **13.35 ms** |                 39.36 ms | 62.55 ms |   49.41 ms |  60.18 ms |    19.29 ms |  94.88 ms |

**Node 24: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg | pg (named) |  pg-native | postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ---------: | ---------: | ----------: | ----------: |
| 1           |       32,757 ±7% |          **32,912 ±25%** | 19,893 ±14% | 26,057 ±2% | 18,795 ±1% | 27,758 ±18% | 11,893 ±32% |
| 10          | **134,487 ±10%** |               90,353 ±7% | 65,232 ±13% | 61,422 ±7% | 60,697 ±2% |  41,449 ±3% | 31,107 ±37% |
| 50          |  **312,579 ±8%** |               89,158 ±7% |  63,163 ±6% | 60,018 ±4% | 59,516 ±8% |  41,173 ±1% |  29,233 ±6% |
| 100         |  **346,294 ±5%** |               90,108 ±1% |  61,538 ±6% | 59,941 ±3% | 54,679 ±6% |  41,936 ±1% |  29,240 ±4% |
| 500         |  **317,293 ±4%** |               86,500 ±8% |  62,108 ±6% | 56,075 ±3% | 55,875 ±5% | 131,450 ±9% |  29,317 ±6% |
| 1000        | **273,446 ±16%** |               84,019 ±4% |  57,556 ±7% | 56,233 ±7% | 56,386 ±7% | 132,797 ±2% | 26,919 ±27% |

**Node 24: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **43.0 µs** |                  44.3 µs |  72.6 µs |    58.5 µs |   72.4 µs |     51.0 µs |    189 µs |
| 10          |  **184 µs** |                   511 µs |   494 µs |     525 µs |    466 µs |      438 µs |    926 µs |
| 50          |  **900 µs** |                  1.43 ms |  1.57 ms |    1.63 ms |   1.45 ms |     2.51 ms |   2.89 ms |
| 100         | **1.46 ms** |                  2.32 ms |  2.67 ms |    2.80 ms |   3.08 ms |     5.46 ms |   5.29 ms |
| 500         | **3.86 ms** |                 10.23 ms | 12.54 ms |   13.15 ms |  12.45 ms |    10.48 ms |  23.44 ms |
| 1000        | **7.31 ms** |                 18.95 ms | 25.53 ms |   25.74 ms |  21.49 ms |    15.28 ms |  52.75 ms |

**Node 24: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |         pg | pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ---------: | ---------: | ----------: | ----------: | ----------: |
| 1           |   **33,041 ±3%** |              32,853 ±28% | 19,922 ±1% | 26,062 ±3% |  18,937 ±1% |  27,803 ±2% | 11,525 ±30% |
| 10          |  **94,609 ±10%** |               94,438 ±3% | 65,842 ±8% | 60,761 ±7% |  60,231 ±5% |  65,087 ±8% |  30,099 ±7% |
| 50          |  **227,316 ±4%** |               92,484 ±3% | 64,870 ±6% | 57,969 ±6% |  61,055 ±8% |  40,666 ±2% | 31,539 ±36% |
| 100         | **293,716 ±11%** |               90,955 ±7% | 64,659 ±8% | 55,737 ±6% |  60,122 ±2% |  41,742 ±2% |  31,075 ±5% |
| 500         |  **318,929 ±8%** |              86,819 ±10% | 62,346 ±8% | 57,246 ±8% |  58,957 ±8% | 113,087 ±6% | 29,985 ±34% |
| 1000        |  **300,677 ±6%** |              84,411 ±12% | 61,003 ±7% | 56,649 ±6% | 57,789 ±16% | 130,367 ±3% | 28,706 ±28% |

**Node 24: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **42.7 µs** |                  43.9 µs |  72.5 µs |    59.5 µs |   68.8 µs |     49.9 µs |    202 µs |
| 10          |      339 µs |                   347 µs |   570 µs |     507 µs |    421 µs |  **268 µs** |   1.02 ms |
| 50          |  **992 µs** |                  1.39 ms |  1.57 ms |    1.72 ms |   1.43 ms |     2.60 ms |   2.82 ms |
| 100         | **1.55 ms** |                  2.25 ms |  2.49 ms |    2.96 ms |   2.56 ms |     5.46 ms |   5.35 ms |
| 500         | **3.85 ms** |                  9.60 ms | 12.08 ms |   13.10 ms |  11.41 ms |    13.37 ms |  24.09 ms |
| 1000        | **7.64 ms** |                 18.57 ms | 24.13 ms |   25.84 ms |  20.86 ms |    15.78 ms |  41.85 ms |

**Node 24: pool size 50, point lookups/s by concurrency**

| Concurrency |          quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----------- | --------------: | -----------------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| 1           |  **33,104 ±1%** |               32,628 ±7% |  20,150 ±2% | 26,314 ±28% |  18,842 ±3% |  28,148 ±1% |  11,936 ±2% |
| 10          | **94,455 ±10%** |               93,106 ±8% |  61,123 ±9% |  60,892 ±6% |  61,287 ±2% | 65,837 ±10% | 30,194 ±34% |
| 50          |     84,590 ±10% |           **91,084 ±9%** |  63,402 ±9% |  57,515 ±6% |  56,379 ±7% |  59,290 ±7% | 20,598 ±48% |
| 100         | **121,506 ±6%** |               87,504 ±9% |  59,117 ±7% |  57,485 ±3% | 52,742 ±10% |  40,440 ±2% | 29,158 ±33% |
| 500         | **211,739 ±5%** |               81,786 ±7% |  60,823 ±3% |  55,769 ±4% | 50,943 ±10% |  42,270 ±1% | 27,911 ±26% |
| 1000        | **245,396 ±3%** |              78,448 ±10% | 58,036 ±12% |  53,592 ±8% |  54,393 ±6% |  42,656 ±4% |  26,956 ±2% |

**Node 24: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **41.6 µs** |                  44.3 µs |  71.5 µs |    58.7 µs |   70.1 µs |     49.8 µs |    182 µs |
| 10          |      323 µs |                   357 µs |   578 µs |     515 µs |    412 µs |  **266 µs** |    971 µs |
| 50          |     1.48 ms |              **1.46 ms** |  1.82 ms |    1.78 ms |   1.61 ms |     1.96 ms |   4.68 ms |
| 100         | **2.03 ms** |                  2.49 ms |  3.02 ms |    3.00 ms |   2.86 ms |     7.78 ms |   6.16 ms |
| 500         | **5.25 ms** |                 10.26 ms | 12.27 ms |   12.75 ms |  12.64 ms |    25.62 ms |  24.91 ms |
| 1000        | **8.14 ms** |                 18.62 ms | 25.74 ms |   26.68 ms |  21.98 ms |    48.96 ms |  45.07 ms |

## Concurrency sweep (Bun 1.4): point lookups/s

**Bun 1.4: pool size 1, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |      postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | ---------------: | ----------: |
| 1           |  **36,655 ±29%** |  23,359 ±1% |       33,829 ±2% | 34,162 ±29% |
| 10          |      110,924 ±3% |  24,098 ±3% | **112,024 ±24%** |  82,824 ±2% |
| 50          | **115,215 ±27%** | 23,643 ±12% |      114,825 ±4% | 83,340 ±38% |
| 100         |      115,335 ±5% |  23,945 ±2% |  **117,374 ±1%** |  86,887 ±1% |
| 500         |  **117,088 ±1%** |  23,151 ±2% |     109,093 ±24% |  88,950 ±4% |
| 1000        |  **114,930 ±4%** |  22,837 ±3% |     108,751 ±11% | 89,265 ±31% |

**Bun 1.4: pool size 1, p99 latency by concurrency**

| Concurrency |       quarry |       pg | postgres.js |  Bun.sql |
| ----------- | -----------: | -------: | ----------: | -------: |
| 1           |  **34.2 µs** |  53.8 µs |     39.1 µs |  35.6 µs |
| 10          |   **107 µs** |   868 µs |      135 µs |   146 µs |
| 50          |      1.03 ms |  3.23 ms |  **978 µs** |  1.31 ms |
| 100         |  **1.55 ms** |  5.31 ms |     1.58 ms |  1.89 ms |
| 500         |  **5.92 ms** | 24.76 ms |     6.31 ms |  6.90 ms |
| 1000        | **10.59 ms** | 47.16 ms |    10.70 ms | 12.66 ms |

**Bun 1.4: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry |          pg | postgres.js |      Bun.sql |
| ----------- | ---------------: | ----------: | ----------: | -----------: |
| 1           |   **37,030 ±3%** |  23,494 ±1% |  34,043 ±9% |   33,660 ±3% |
| 10          |  **165,068 ±3%** | 84,996 ±15% |  64,133 ±4% | 124,413 ±13% |
| 50          | **367,361 ±10%** | 82,461 ±18% |  64,875 ±1% |  171,825 ±3% |
| 100         |  **444,306 ±7%** | 81,243 ±17% |  66,260 ±3% |  182,893 ±2% |
| 500         |  **484,664 ±2%** |  75,823 ±2% | 206,353 ±6% |  196,936 ±3% |
| 1000        |  **399,836 ±3%** | 73,342 ±12% | 206,753 ±4% |  209,235 ±5% |

**Bun 1.4: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js | Bun.sql |
| ----------- | ----------: | -------: | ----------: | ------: |
| 1           | **33.2 µs** |  53.5 µs |     37.8 µs | 35.4 µs |
| 10          |  **102 µs** |   557 µs |      305 µs |  150 µs |
| 50          |  **648 µs** |  1.42 ms |     1.77 ms | 1.11 ms |
| 100         |  **900 µs** |  2.23 ms |     3.18 ms | 1.71 ms |
| 500         |     5.00 ms |  8.85 ms | **4.68 ms** | 4.95 ms |
| 1000        | **4.88 ms** | 15.85 ms |     7.15 ms | 8.71 ms |

**Bun 1.4: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry |          pg | postgres.js |      Bun.sql |
| ----------- | ---------------: | ----------: | ----------: | -----------: |
| 1           |   **36,945 ±4%** | 23,207 ±24% |  34,136 ±2% |   33,703 ±1% |
| 10          | **116,518 ±14%** |  86,984 ±1% |  95,478 ±3% |   86,095 ±7% |
| 50          |  **286,335 ±3%** |  84,971 ±9% |  63,419 ±5% |  150,499 ±5% |
| 100         |  **368,668 ±7%** |  75,866 ±9% |  64,459 ±2% | 166,994 ±17% |
| 500         |  **452,200 ±2%** | 77,206 ±14% | 184,015 ±5% |  188,634 ±3% |
| 1000        |  **441,010 ±3%** |  74,749 ±8% | 208,604 ±6% | 195,855 ±<1% |

**Bun 1.4: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js | Bun.sql |
| ----------- | ----------: | -------: | ----------: | ------: |
| 1           | **33.4 µs** |  54.9 µs |     38.5 µs | 36.6 µs |
| 10          |  **162 µs** |   572 µs |      205 µs |  228 µs |
| 50          |  **744 µs** |  1.41 ms |     1.87 ms | 1.30 ms |
| 100         |  **945 µs** |  2.30 ms |     3.40 ms | 1.69 ms |
| 500         | **2.88 ms** |  8.81 ms |     7.04 ms | 5.42 ms |
| 1000        | **5.14 ms** | 17.05 ms |     8.52 ms | 9.92 ms |

**Bun 1.4: pool size 50, point lookups/s by concurrency**

| Concurrency |           quarry |          pg | postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | ----------: | ----------: |
| 1           |   **36,734 ±3%** |  23,408 ±1% |  34,031 ±2% | 32,585 ±30% |
| 10          |  **115,711 ±7%** |  85,543 ±8% |  95,017 ±8% | 76,424 ±11% |
| 50          |  **112,574 ±1%** | 83,798 ±12% |  82,111 ±5% |  83,257 ±9% |
| 100         |  **143,909 ±8%** |  80,597 ±8% |  60,806 ±3% | 107,882 ±9% |
| 500         |  **272,385 ±6%** | 76,248 ±23% |  64,303 ±1% | 145,253 ±4% |
| 1000        | **311,978 ±10%** |  67,639 ±9% |  65,376 ±1% | 156,485 ±2% |

**Bun 1.4: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |     Bun.sql |
| ----------- | ----------: | -------: | ----------: | ----------: |
| 1           | **33.4 µs** |  54.2 µs |     38.6 µs |     38.1 µs |
| 10          |  **156 µs** |   580 µs |      193 µs |      259 µs |
| 50          |     1.38 ms |  1.46 ms |     1.44 ms | **1.14 ms** |
| 100         | **1.57 ms** |  2.43 ms |     3.55 ms |     1.74 ms |
| 500         | **4.27 ms** |  9.41 ms |    16.18 ms |     6.70 ms |
| 1000        | **6.46 ms** | 17.86 ms |    32.18 ms |    12.28 ms |

## Pipelining depth

**quarry, one connection, 100 concurrent point lookups: throughput by `pipeline` depth (columns: RTT ms)**

| pipeline           |                0 |          5 |
| ------------------ | ---------------: | ---------: |
| 1                  |   **20,745 ±3%** |    171 ±1% |
| 2                  |   **41,169 ±4%** |   340 ±<1% |
| 4                  |   **71,812 ±2%** |   676 ±<1% |
| 8                  |  **108,505 ±2%** |  1,341 ±1% |
| 16                 |  **109,854 ±1%** |  2,649 ±2% |
| 32                 |  **111,610 ±1%** | 5,126 ±<1% |
| 64                 | **113,650 ±25%** |  9,784 ±4% |
| 100                | **107,268 ±19%** | 16,185 ±2% |
| adaptive (default) | **114,468 ±<1%** | 16,139 ±2% |

## Network latency (RTT through Toxiproxy)

**Node 24: select 1, sequential: median latency by RTT**

| RTT   |            quarry |            pg |   pg (named) |     pg-native |  postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | -----------: | ------------: | -----------: | ------------: |
| 0 ms  |  **42.1 µs ±65%** |   43.4 µs ±2% |  43.3 µs ±2% |  49.7 µs ±26% | 46.5 µs ±31% |   62.4 µs ±1% |
| 1 ms  |   **1.40 ms ±7%** |   1.43 ms ±3% |  1.40 ms ±3% |   1.43 ms ±6% |  1.44 ms ±5% |   1.49 ms ±5% |
| 5 ms  |   **5.82 ms ±1%** |  5.87 ms ±<1% | 5.87 ms ±<1% |  5.87 ms ±<1% |  5.86 ms ±2% |  5.97 ms ±<1% |
| 20 ms | **20.84 ms ±<1%** | 20.89 ms ±<1% | 20.87 ms ±1% | 20.86 ms ±<1% | 20.85 ms ±1% | 20.99 ms ±<1% |

**Node 24: point lookup, sequential: median latency by RTT**

| RTT   |            quarry |            pg |    pg (named) |     pg-native |   postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | ------------: | ------------: | ------------: | ------------: |
| 0 ms  |   **46.6 µs ±1%** |  65.7 µs ±28% |   55.7 µs ±6% |  69.3 µs ±43% |  54.7 µs ±23% |    108 µs ±2% |
| 1 ms  |   **1.42 ms ±2%** |   1.54 ms ±6% |   1.47 ms ±6% |   1.50 ms ±7% |   1.45 ms ±6% |   1.65 ms ±1% |
| 5 ms  |   **5.90 ms ±1%** |  5.99 ms ±<1% |   5.93 ms ±1% |   5.97 ms ±4% |   5.91 ms ±1% |   6.02 ms ±3% |
| 20 ms | **20.92 ms ±<1%** | 21.04 ms ±<1% | 20.96 ms ±<1% | 20.99 ms ±<1% | 20.96 ms ±<1% | 21.18 ms ±<1% |

**Node 24: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |          quarry |          pg | pg (named) |   pg-native | postgres.js |  neon (WS) |
| ----- | --------------: | ----------: | ---------: | ----------: | ----------: | ---------: |
| 0 ms  | **218,603 ±6%** | 67,120 ±31% | 60,879 ±3% | 60,484 ±20% |  39,863 ±3% | 22,567 ±3% |
| 1 ms  |  **28,279 ±2%** |   5,716 ±6% | 6,038 ±<1% |   5,735 ±3% |  18,321 ±2% |  5,074 ±2% |
| 5 ms  |   **8,200 ±1%** |   1,652 ±1% | 1,669 ±<1% |  1,654 ±<1% |  6,834 ±12% |  1,578 ±1% |
| 20 ms |   **2,354 ±1%** |     473 ±1% |   475 ±<1% |    474 ±<1% |  1,967 ±14% |    468 ±1% |

**Node 24: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |           quarry |         pg | pg (named) |  pg-native |  postgres.js | neon (WS) |
| ----- | ---------------: | ---------: | ---------: | ---------: | -----------: | --------: |
| 0 ms  | **112,218 ±10%** | 14,397 ±5% | 17,381 ±2% | 13,778 ±3% | 100,057 ±25% | 8,819 ±9% |
| 1 ms  |  **43,589 ±86%** |    652 ±1% |    677 ±1% |    646 ±3% | 31,698 ±120% |   619 ±2% |
| 5 ms  |   **15,805 ±1%** |   168 ±<1% |    170 ±1% |    169 ±1% |  12,496 ±13% |   167 ±1% |
| 20 ms |    **4,675 ±1%** |  47.7 ±<1% |   47.9 ±1% |  47.7 ±<1% |   3,538 ±14% | 47.5 ±<1% |

**Node 24: point lookup, 500 concurrent, pool 1 (deep pipelining): operations/s by RTT**

| RTT   |          quarry |         pg |  pg (named) |  pg-native | postgres.js | neon (WS) |
| ----- | --------------: | ---------: | ----------: | ---------: | ----------: | --------: |
| 0 ms  | **111,076 ±1%** | 13,926 ±7% | 17,036 ±21% | 13,977 ±2% | 93,387 ±24% | 8,702 ±5% |
| 1 ms  | **113,914 ±3%** |    666 ±3% |     675 ±2% |    659 ±2% |  23,355 ±3% |   632 ±4% |
| 5 ms  |  **79,879 ±2%** |    169 ±1% |     170 ±2% |    169 ±1% |   7,848 ±2% |  167 ±<1% |
| 20 ms |  **23,078 ±1%** |   47.8 ±1% |   47.9 ±<1% |  47.8 ±<1% |   2,337 ±2% | 47.5 ±<1% |

**Node 24: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |            pg |    pg (named) |     pg-native |  postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | ------------: | ------------: | -----------: | ------------: |
| 0 ms  |   **349 µs ±13%** |   1.40 ms ±3% |   1.34 ms ±3% |   1.65 ms ±4% |  1.05 ms ±5% |  1.52 ms ±18% |
| 1 ms  |   **2.04 ms ±5%** |   3.10 ms ±5% |   3.05 ms ±3% |   3.16 ms ±1% |  2.87 ms ±4% |   3.35 ms ±2% |
| 5 ms  |   **6.35 ms ±1%** |   7.35 ms ±1% |   7.32 ms ±1% |  7.38 ms ±<1% |  7.11 ms ±2% |  7.61 ms ±<1% |
| 20 ms | **21.45 ms ±<1%** | 22.43 ms ±<1% | 22.40 ms ±<1% | 22.44 ms ±<1% | 22.20 ms ±1% | 22.74 ms ±<1% |

**Node 24: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |            quarry |            pg |    pg (named) |     pg-native |   postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | ------------: | ------------: | ------------: | ------------: |
| 0 ms  |  **90.4 µs ±69%** |    138 µs ±1% |    128 µs ±2% |   155 µs ±57% |    139 µs ±1% |   214 µs ±51% |
| 1 ms  |   **2.93 ms ±3%** |   4.36 ms ±2% |   4.28 ms ±4% |   4.24 ms ±3% |   4.43 ms ±7% |   4.45 ms ±8% |
| 5 ms  | **11.75 ms ±<1%** |  17.50 ms ±1% | 17.59 ms ±<1% |  17.51 ms ±1% | 17.57 ms ±<1% |  17.86 ms ±1% |
| 20 ms | **41.73 ms ±<1%** | 62.70 ms ±<1% |  62.58 ms ±1% | 62.65 ms ±<1% | 62.62 ms ±<1% | 62.91 ms ±<1% |

**Node 24: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |          quarry |          pg | pg (named) |   pg-native | postgres.js |  neon (WS) |
| ----- | --------------: | ----------: | ---------: | ----------: | ----------: | ---------: |
| 0 ms  | **212,917 ±4%** | 78,872 ±10% | 80,651 ±2% | 66,565 ±26% |  39,992 ±4% | 22,300 ±8% |
| 1 ms  |  **27,444 ±3%** |  6,003 ±10% |  6,130 ±4% |   5,852 ±2% |  18,250 ±4% |  5,130 ±6% |
| 5 ms  |   **8,141 ±1%** |   1,657 ±1% |  1,666 ±3% |   1,655 ±1% |   6,811 ±2% |  1,589 ±1% |
| 20 ms |  **2,353 ±<1%** |    475 ±<1% |    476 ±1% |    475 ±<1% |   1,841 ±9% |   468 ±<1% |

**Node 24: connect + select 1 + close: median latency by RTT**

| RTT   |            quarry |              pg |       pg (named) |     pg-native |  postgres.js |    neon (WS) |
| ----- | ----------------: | --------------: | ---------------: | ------------: | -----------: | -----------: |
| 0 ms  |      2.77 ms ±14% |    2.75 ms ±12% | **2.70 ms ±16%** |   5.02 ms ±9% |  6.14 ms ±6% | 4.76 ms ±10% |
| 1 ms  |       5.42 ms ±6% | **5.13 ms ±6%** |      5.16 ms ±6% |   9.87 ms ±3% |  9.89 ms ±3% |  7.87 ms ±7% |
| 5 ms  |  **14.01 ms ±1%** |    14.15 ms ±2% |     14.16 ms ±1% |  27.17 ms ±2% | 22.56 ms ±1% | 16.16 ms ±2% |
| 20 ms | **44.17 ms ±<1%** |    44.34 ms ±1% |    44.32 ms ±<1% | 88.36 ms ±<1% | 68.62 ms ±1% | 47.42 ms ±1% |

**Bun 1.4: select 1, sequential: median latency by RTT**

| RTT   |           quarry |           Bun.sql |
| ----- | ---------------: | ----------------: |
| 0 ms  | **39.4 µs ±32%** |      42.3 µs ±62% |
| 1 ms  |      1.36 ms ±4% |   **1.35 ms ±3%** |
| 5 ms  |      5.81 ms ±3% |  **5.78 ms ±<1%** |
| 20 ms |    20.86 ms ±<1% | **20.80 ms ±<1%** |

**Bun 1.4: point lookup, sequential: median latency by RTT**

| RTT   |           quarry |           Bun.sql |
| ----- | ---------------: | ----------------: |
| 0 ms  | **44.7 µs ±63%** |       46.1 µs ±1% |
| 1 ms  |      1.40 ms ±4% |   **1.36 ms ±1%** |
| 5 ms  |      5.84 ms ±1% |   **5.81 ms ±5%** |
| 20 ms |    20.90 ms ±<1% | **20.85 ms ±<1%** |

**Bun 1.4: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |          quarry |       Bun.sql |
| ----- | --------------: | ------------: |
| 0 ms  | **260,130 ±6%** |  154,485 ±11% |
| 1 ms  |  **29,529 ±2%** |    27,422 ±2% |
| 5 ms  |   **8,312 ±1%** |     8,257 ±1% |
| 20 ms |      2,362 ±<1% | **2,363 ±1%** |

**Bun 1.4: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |           quarry |        Bun.sql |
| ----- | ---------------: | -------------: |
| 0 ms  | **118,581 ±26%** |     89,711 ±1% |
| 1 ms  |      41,370 ±99% | **82,314 ±3%** |
| 5 ms  |   **16,149 ±4%** |     16,030 ±4% |
| 20 ms |        4,676 ±1% |  **4,696 ±1%** |

**Bun 1.4: point lookup, 500 concurrent, pool 1 (deep pipelining): operations/s by RTT**

| RTT   |           quarry |        Bun.sql |
| ----- | ---------------: | -------------: |
| 0 ms  | **115,566 ±27%** |    90,205 ±35% |
| 1 ms  |  **117,164 ±2%** |    92,045 ±33% |
| 5 ms  |       81,937 ±2% | **87,167 ±2%** |
| 20 ms |       23,260 ±1% | **23,285 ±1%** |

**Bun 1.4: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |       Bun.sql |
| ----- | ----------------: | ------------: |
| 0 ms  |    **286 µs ±1%** |    416 µs ±1% |
| 1 ms  |   **1.94 ms ±1%** |  2.21 ms ±<1% |
| 5 ms  |   **6.23 ms ±1%** |  6.50 ms ±<1% |
| 20 ms | **21.33 ms ±<1%** | 21.58 ms ±<1% |

**Bun 1.4: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |            quarry |       Bun.sql |
| ----- | ----------------: | ------------: |
| 0 ms  |   **84.2 µs ±1%** |   146 µs ±28% |
| 1 ms  |   **2.88 ms ±3%** |   4.26 ms ±2% |
| 5 ms  |  **11.74 ms ±1%** | 17.36 ms ±<1% |
| 20 ms | **41.80 ms ±<1%** | 62.67 ms ±<1% |

**Bun 1.4: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |        Bun.sql |
| ----- | ---------------: | -------------: |
| 0 ms  | **230,670 ±20%** |   146,111 ±14% |
| 1 ms  |   **27,467 ±4%** |     26,654 ±1% |
| 5 ms  |        8,228 ±1% |  **8,259 ±1%** |
| 20 ms |       2,361 ±<1% | **2,362 ±<1%** |

**Bun 1.4: connect + select 1 + close: median latency by RTT**

| RTT   |       quarry |           Bun.sql |
| ----- | -----------: | ----------------: |
| 0 ms  | 2.75 ms ±14% |  **2.63 ms ±12%** |
| 1 ms  |  5.44 ms ±7% |   **5.26 ms ±6%** |
| 5 ms  | 13.96 ms ±3% |  **13.57 ms ±2%** |
| 20 ms | 44.15 ms ±1% | **43.96 ms ±<1%** |

## PgBouncer

**Node 24 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |          quarry | quarry (prepare: false) |          pg |  pg (named) |       pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | --------------: | ----------------------: | ----------: | ----------: | --------------: | ----------: | ---------------------------: |
| select 1                                               |     17,356 ±26% |             18,378 ±14% | 20,290 ±37% |  19,115 ±1% | **20,551 ±18%** |  18,914 ±9% |                   18,908 ±3% |
| point lookup by primary key                            | **17,883 ±24%** |              12,477 ±1% | 13,664 ±28% |  15,523 ±4% |     14,177 ±29% | 12,887 ±23% |                    8,390 ±1% |
| point lookup by primary key, concurrency 50            |  **77,192 ±8%** |              69,268 ±3% |  67,533 ±3% |  61,375 ±4% |      71,826 ±9% |  38,633 ±2% |                   38,270 ±5% |
| fetch 1k rows (6 columns)                              |  **2,543 ±15%** |              1,143 ±16% |     721 ±1% |     736 ±2% |         606 ±4% |    791 ±10% |                     794 ±10% |
| insert one row                                         |  **18,074 ±2%** |             15,874 ±27% |  15,693 ±1% | 17,640 ±11% |     15,864 ±17% |  16,123 ±3% |                    8,848 ±2% |
| transaction: begin; insert; commit                     |   **9,154 ±6%** |               8,713 ±8% |   6,523 ±2% |  6,574 ±33% |      6,673 ±22% |  6,025 ±22% |                   4,272 ±28% |
| insert one row, concurrency 50                         |     76,950 ±39% |        **115,179 ±12%** | 81,331 ±15% |  68,455 ±9% |     82,960 ±24% |  38,867 ±4% |                   40,893 ±4% |
| query that fails (division by zero), connection reused |  **14,879 ±2%** |             14,669 ±15% |  5,631 ±27% |   4,982 ±4% |       4,673 ±3% | 12,047 ±27% |                   12,068 ±6% |

**Node 24 through PgBouncer: median latency**

| Scenario                                               |      quarry | quarry (prepare: false) |      pg | pg (named) |   pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | ----------: | ----------------------: | ------: | ---------: | ----------: | ----------: | ---------------------------: |
| select 1                                               |     58.5 µs |                 50.5 µs | 46.7 µs |    49.5 µs | **46.1 µs** |     49.5 µs |                      49.2 µs |
| point lookup by primary key                            | **52.8 µs** |                 74.6 µs | 69.1 µs |    59.8 µs |     67.1 µs |     72.1 µs |                       112 µs |
| point lookup by primary key, concurrency 50            |      628 µs |              **593 µs** |  689 µs |     760 µs |      661 µs |     1.18 ms |                      1.15 ms |
| fetch 1k rows (6 columns)                              |  **369 µs** |                  827 µs | 1.39 ms |    1.38 ms |     1.65 ms |     1.06 ms |                      1.07 ms |
| insert one row                                         | **51.7 µs** |                 59.3 µs | 60.1 µs |    53.9 µs |     59.9 µs |     57.5 µs |                       106 µs |
| transaction: begin; insert; commit                     |  **103 µs** |                  108 µs |  144 µs |     142 µs |      144 µs |      154 µs |                       211 µs |
| insert one row, concurrency 50                         |      631 µs |              **420 µs** |  567 µs |     693 µs |      563 µs |     1.20 ms |                      1.09 ms |
| query that fails (division by zero), connection reused | **62.6 µs** |                 62.6 µs |  161 µs |     177 µs |      194 µs |     77.4 µs |                      77.0 µs |

**Node 24: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | quarry (prepare: false) |  pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ---------------------------------- | -----: | ----------------------: | --: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                           |    43% |                 **71%** | 56% |        53% |       67% |         57% |                          56% |
| point lookup by primary key        |    54% |                     70% | 67% |        61% |   **74%** |         46% |                          61% |
| fetch 1k rows (6 columns)          |    90% |                     90% | 96% |        95% |   **96%** |         89% |                          90% |
| insert one row                     |    56% |                     62% | 64% |        57% |   **74%** |         58% |                          61% |
| transaction: begin; insert; commit |    52% |                       — | 56% |        50% |   **67%** |         56% |                            — |

**Bun 1.4 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |          quarry |     Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | --------------: | ----------: | -----------------------: |
| select 1                                               |     21,640 ±40% | 21,784 ±11% |           **21,910 ±2%** |
| point lookup by primary key                            | **18,997 ±33%** | 17,752 ±18% |               14,851 ±3% |
| point lookup by primary key, concurrency 50            | **78,284 ±37%** | 48,272 ±30% |               55,755 ±5% |
| fetch 1k rows (6 columns)                              |  **2,906 ±11%** |   2,166 ±5% |               2,173 ±14% |
| insert one row                                         |  **19,589 ±2%** |  16,156 ±7% |               15,404 ±3% |
| transaction: begin; insert; commit                     |  **9,725 ±13%** |   6,999 ±3% |                6,556 ±8% |
| insert one row, concurrency 50                         |  **79,716 ±1%** | 48,795 ±30% |              57,536 ±41% |
| query that fails (division by zero), connection reused |      16,010 ±4% | 18,666 ±34% |           **19,074 ±6%** |

**Bun 1.4 through PgBouncer: median latency**

| Scenario                                               |      quarry | Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | ----------: | ------: | -----------------------: |
| select 1                                               |     44.3 µs | 44.7 µs |              **44.3 µs** |
| point lookup by primary key                            | **50.4 µs** | 55.5 µs |                  65.6 µs |
| point lookup by primary key, concurrency 50            |  **621 µs** |  972 µs |                   841 µs |
| fetch 1k rows (6 columns)                              |  **320 µs** |  441 µs |                   442 µs |
| insert one row                                         | **49.1 µs** | 59.0 µs |                  63.7 µs |
| transaction: begin; insert; commit                     | **98.9 µs** |  138 µs |                   147 µs |
| insert one row, concurrency 50                         |  **612 µs** | 1.04 ms |                   838 µs |
| query that fails (division by zero), connection reused |     59.1 µs | 50.5 µs |              **50.1 µs** |

**Bun 1.4: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | Bun.sql | Bun.sql (prepare: false) |
| ---------------------------------- | -----: | ------: | -----------------------: |
| select 1                           |    47% |     54% |                  **55%** |
| point lookup by primary key        |    49% |     53% |                  **65%** |
| fetch 1k rows (6 columns)          |    84% |     86% |                  **87%** |
| insert one row                     |    52% |     47% |                  **60%** |
| transaction: begin; insert; commit |    49% | **63%** |                        — |

## Server restart

`pg_ctl restart -m fast` while a pool runs `select 1` every 5 ms (2 s client timeout per query).

| Runtime  | Client                   | Recovered | Time from server up to first success (median) | Failed queries (median) |
| -------- | ------------------------ | --------: | --------------------------------------------: | ----------------------: |
| Node 24  | quarry                   |       5/5 |                                       3.00 ms |                      27 |
| Node 24  | pg                       |       5/5 |                                       3.00 ms |                      28 |
| Node 24  | pg (named)               |       5/5 |                                       4.00 ms |                      28 |
| Node 24  | pg-native                |       5/5 |                                       3.00 ms |                      26 |
| Node 24  | postgres.js              |       5/5 |                                      55.00 ms |                      16 |
| Bun 1.4  | quarry                   |       5/5 |                                       3.00 ms |                      28 |
| Bun 1.4  | postgres.js              |       5/5 |                                      60.00 ms |                      17 |
| Bun 1.4  | Bun.sql                  |       5/5 |                                       4.00 ms |                      17 |
| Deno 2.9 | quarry                   |       5/5 |                                       1.00 ms |                      25 |
| Deno 2.9 | deno-postgres (+nodelay) |       0/5 |                                             — |                       — |

## Footprint and cold start

| Package                                              | Installed size | Packages installed |
| ---------------------------------------------------- | -------------: | -----------------: |
| quarry (whole package: query builder + driver + src) |       2115 KiB |                  1 |
| pg                                                   |        464 KiB |                 14 |
| pg + pg-native (libpq addon, built)                  |       1377 KiB |                 19 |
| postgres.js                                          |        293 KiB |                  1 |
| @neondatabase/serverless (+ ws on Node)              |        582 KiB |                  2 |
| deno-postgres (jsr, source modules)                  |        531 KiB |                  7 |
| Bun.sql (built into Bun)                             |          0 KiB |                  0 |

| Bundle (esbuild, minified, platform node) |                                                  Size |     gzip |
| ----------------------------------------- | ----------------------------------------------------: | -------: |
| quarry/driver                             |                                              93.9 KiB | 31.8 KiB |
| pg                                        |                                              84.4 KiB | 26.3 KiB |
| postgres.js                               |                                              37.1 KiB | 14.3 KiB |
| @neondatabase/serverless                  |                                             142.9 KiB | 46.3 KiB |
| pg-native                                 | native addon (libpq .node + libpq.so): not bundleable |          |

| Runtime / client   |   Import | Connect + first query | Process start → first result | Wall time of the process |
| ------------------ | -------: | --------------------: | ---------------------------: | -----------------------: |
| node/none          |   2.2 µs |                8.6 µs |                     41.20 ms |                 49.07 ms |
| node/quarry        |  5.55 ms |              10.15 ms |                     58.67 ms |                 64.09 ms |
| node/pg            | 20.64 ms |               6.82 ms |                     68.37 ms |                 74.25 ms |
| node/pg-native     | 20.66 ms |               8.30 ms |                     72.40 ms |                 79.95 ms |
| node/postgres.js   | 16.15 ms |               9.33 ms |                     69.01 ms |                 77.67 ms |
| node/neon          | 23.83 ms |              11.46 ms |                     78.88 ms |                 84.69 ms |
| bun/none           |   0.8 µs |               12.5 µs |                      1.87 ms |                  4.81 ms |
| bun/quarry         |  7.05 ms |              13.70 ms |                     22.62 ms |                 26.79 ms |
| bun/pg             | 13.84 ms |               8.48 ms |                     24.24 ms |                 27.84 ms |
| bun/postgres.js    | 12.73 ms |               9.40 ms |                     24.25 ms |                 30.28 ms |
| bun/bun.sql        |  3.28 ms |               3.94 ms |                      9.09 ms |                 12.76 ms |
| deno/none          |   2.3 µs |               16.6 µs |                     12.09 ms |                 23.67 ms |
| deno/quarry        |  2.83 ms |              13.81 ms |                     26.73 ms |                 38.82 ms |
| deno/pg            | 13.64 ms |               8.23 ms |                     33.77 ms |                 44.42 ms |
| deno/postgres.js   | 12.11 ms |              11.35 ms |                     33.35 ms |                 47.60 ms |
| deno/deno-postgres | 16.49 ms |               5.57 ms |                     31.63 ms |                 42.40 ms |
