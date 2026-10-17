### Correctness

Every result compared in canonical form (see `canon.ts`) against the majority digest for its runtime and scenario.

608 (runtime, client, scenario) results checked; 0 differ from the majority.

### Failed runs

- reconnect deno deno-postgres (+nodelay) reconnect (max 10, c -, rtt -): 4 failed: BrokenPipe: Broken pipe (os error 32)

## Node 24

**Node 24: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |    pg-native |  postgres.js |     neon (WS) |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | -----------: | ------------: |
| select 1                                                      | **21.4 µs ±13%** |  26.2 µs ±2% |  26.5 µs ±2% | 31.3 µs ±15% | 28.9 µs ±13% |  46.3 µs ±20% |
| point lookup by primary key                                   | **26.4 µs ±13%** |  46.4 µs ±3% |  34.6 µs ±5% | 50.0 µs ±16% | 32.9 µs ±15% |  77.8 µs ±15% |
| range scan, 100 rows                                          |  **87.9 µs ±3%** |   186 µs ±1% |   183 µs ±2% |  196 µs ±17% |   156 µs ±3% |   223 µs ±17% |
| fetch 1k rows (6 columns)                                     |   **313 µs ±1%** | 1.34 ms ±16% |  1.27 ms ±9% |  1.64 ms ±2% |  924 µs ±19% |  1.48 ms ±26% |
| 100 parameters (id in (…)), 100 rows                          |  **223 µs ±19%** |   313 µs ±1% |  259 µs ±16% |  315 µs ±10% |   271 µs ±6% |    336 µs ±2% |
| 1000 parameters (id in (…)), 1000 rows                        |  **1.95 ms ±1%** |  2.50 ms ±1% |  2.06 ms ±2% |  2.70 ms ±3% |  2.21 ms ±8% |   2.42 ms ±5% |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **1.75 ms ±11%** |  2.13 ms ±3% |  1.93 ms ±3% |  2.26 ms ±3% |  1.92 ms ±3% |   2.14 ms ±1% |
| insert one row                                                |  **26.3 µs ±9%** |  38.9 µs ±6% |  30.4 µs ±1% |  44.3 µs ±1% |  33.2 µs ±9% |   70.8 µs ±2% |
| multi-row insert: 100 rows, 300 parameters                    |   **190 µs ±8%** |  298 µs ±24% |   211 µs ±2% |  304 µs ±18% |   330 µs ±1% |    292 µs ±1% |
| update one row by primary key                                 | **30.6 µs ±13%** | 45.8 µs ±19% |  35.0 µs ±5% | 51.7 µs ±16% |  36.0 µs ±1% |   79.5 µs ±5% |
| upsert (insert … on conflict do update)                       | **30.6 µs ±14%** | 44.5 µs ±14% | 35.1 µs ±14% |  49.0 µs ±2% |  36.8 µs ±3% |  78.4 µs ±11% |
| delete one row by primary key                                 |  **25.3 µs ±2%** |  38.0 µs ±2% | 30.1 µs ±13% |  43.4 µs ±1% |  30.7 µs ±1% |   73.0 µs ±6% |
| transaction: begin; select 1; commit                          |  **46.0 µs ±1%** |  67.5 µs ±1% |  70.0 µs ±7% |  86.2 µs ±4% |  83.1 µs ±4% |    128 µs ±1% |
| transaction: begin; insert; commit                            |  **50.5 µs ±6%** | 81.1 µs ±10% |  72.5 µs ±2% |  99.8 µs ±8% | 87.5 µs ±14% |   151 µs ±14% |
| transaction with 5 savepoints (select 1 in each)              |   **257 µs ±2%** |   376 µs ±1% |  389 µs ±14% |  476 µs ±14% |  339 µs ±14% |    714 µs ±1% |
| query that fails (division by zero), connection reused        |  **33.9 µs ±3%** |  2.24 ms ±2% | 2.40 ms ±12% | 4.83 ms ±11% |  53.2 µs ±2% |   2.57 ms ±4% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **30.9 µs ±12%** |  41.6 µs ±2% | 37.8 µs ±14% |  46.7 µs ±3% | 36.1 µs ±17% | 84.9 µs ±335% |

**Node 24: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| select 1                                                      | **44,909 ±11%** |  35,795 ±2% |  35,337 ±2% | 30,863 ±14% |  31,565 ±9% | 19,800 ±17% |
| point lookup by primary key                                   | **36,430 ±12%** |  20,229 ±6% | 27,261 ±11% | 19,366 ±15% | 28,155 ±12% | 12,077 ±14% |
| range scan, 100 rows                                          |  **10,631 ±3%** |  5,014 ±10% |   5,066 ±3% |  4,933 ±14% |   5,665 ±3% |  4,081 ±13% |
| fetch 1k rows (6 columns)                                     |   **2,984 ±2%** |    768 ±16% |    798 ±12% |     621 ±2% |    926 ±15% |    666 ±23% |
| 100 parameters (id in (…)), 100 rows                          |  **4,354 ±17%** |   3,048 ±2% |  3,753 ±16% |   3,083 ±9% |  3,505 ±11% |   2,809 ±3% |
| 1000 parameters (id in (…)), 1000 rows                        |     **506 ±1%** |     393 ±2% |     479 ±2% |     366 ±3% |     422 ±7% |     405 ±6% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |    **565 ±10%** |     464 ±4% |     513 ±3% |     432 ±4% |     510 ±3% |     455 ±1% |
| insert one row                                                |  **35,369 ±7%** |  24,636 ±9% |  30,755 ±3% |  21,420 ±5% | 28,121 ±10% |  13,087 ±2% |
| multi-row insert: 100 rows, 300 parameters                    |   **4,818 ±7%** |  3,171 ±21% |   4,422 ±1% |  3,151 ±14% |   2,938 ±2% |   3,252 ±2% |
| update one row by primary key                                 | **31,496 ±11%** | 20,523 ±16% |  26,427 ±3% | 18,556 ±13% |  25,943 ±3% |  11,812 ±4% |
| upsert (insert … on conflict do update)                       | **31,519 ±13%** | 20,302 ±10% | 27,093 ±14% |  19,389 ±2% |  25,522 ±6% | 12,110 ±10% |
| delete one row by primary key                                 |  **37,560 ±2%** |  24,649 ±3% | 30,745 ±11% |  21,877 ±5% |  30,569 ±2% |  12,838 ±7% |
| transaction: begin; select 1; commit                          |  **20,372 ±2%** |  14,198 ±4% |  13,638 ±6% |  11,159 ±5% |  11,137 ±4% |   7,296 ±1% |
| transaction: begin; insert; commit                            |  **18,604 ±7%** | 11,720 ±11% |  13,237 ±4% |   9,414 ±7% | 10,570 ±11% |  6,250 ±13% |
| transaction with 5 savepoints (select 1 in each)              |   **3,732 ±5%** |   2,565 ±2% |  2,455 ±13% |  2,038 ±13% |  2,785 ±13% |   1,335 ±2% |
| query that fails (division by zero), connection reused        |  **27,720 ±5%** |     439 ±3% |    407 ±10% |    208 ±10% |  17,321 ±2% |     380 ±5% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **30,552 ±11%** |  21,792 ±3% | 23,784 ±12% |  20,254 ±3% | 24,931 ±12% | 10,652 ±90% |

**Node 24: tail latency p99, sequential**

| Scenario                                                      |      quarry |         pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ---------: | ---------: | --------: | ----------: | --------: |
| select 1                                                      | **27.4 µs** |    39.1 µs |    43.7 µs |   42.6 µs |     49.2 µs |   87.0 µs |
| point lookup by primary key                                   | **34.4 µs** |    70.6 µs |    57.4 µs |   64.3 µs |     47.8 µs |    151 µs |
| range scan, 100 rows                                          |  **185 µs** |     561 µs |     551 µs |    349 µs |      264 µs |    652 µs |
| fetch 1k rows (6 columns)                                     |  **721 µs** |    1.82 ms |    1.78 ms |   1.96 ms |     5.30 ms |   2.15 ms |
| 100 parameters (id in (…)), 100 rows                          |  **310 µs** |     609 µs |     495 µs |    564 µs |      420 µs |    740 µs |
| 1000 parameters (id in (…)), 1000 rows                        | **2.28 ms** |    3.05 ms |    2.58 ms |   3.14 ms |     4.23 ms |   2.95 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.04 ms** |    2.54 ms |    2.33 ms |   2.81 ms |     2.77 ms |   2.81 ms |
| insert one row                                                | **42.3 µs** |    61.5 µs |    55.3 µs |   66.0 µs |     54.1 µs |    138 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **321 µs** |     591 µs |     329 µs |    550 µs |      568 µs |    543 µs |
| update one row by primary key                                 | **40.1 µs** |    68.8 µs |    57.4 µs |   70.3 µs |     53.5 µs |    143 µs |
| upsert (insert … on conflict do update)                       | **39.3 µs** |    76.8 µs |    50.9 µs |   68.5 µs |     55.1 µs |    156 µs |
| delete one row by primary key                                 | **34.8 µs** |    59.6 µs |    47.5 µs |   59.9 µs |     45.3 µs |    122 µs |
| transaction: begin; select 1; commit                          | **77.6 µs** |    89.9 µs |    97.7 µs |    114 µs |      122 µs |    201 µs |
| transaction: begin; insert; commit                            | **86.3 µs** |     113 µs |     102 µs |    139 µs |      137 µs |    265 µs |
| transaction with 5 savepoints (select 1 in each)              |      614 µs | **494 µs** |     500 µs |    594 µs |      505 µs |   1.94 ms |
| query that fails (division by zero), connection reused        | **48.0 µs** |    2.97 ms |    3.25 ms |   5.38 ms |     85.6 µs |   3.43 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler | **56.9 µs** |    85.6 µs |    87.0 µs |   76.9 µs |     72.6 µs |    294 µs |

**Node 24: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) |  pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ---------: | ----------: | --------: |
| select 1                                                      |      203 µs |  361 µs |      376 µs |     203 µs |  **150 µs** |    532 µs |
| point lookup by primary key                                   |      280 µs |  512 µs |      447 µs |     410 µs |  **220 µs** |    628 µs |
| range scan, 100 rows                                          |      612 µs |  771 µs |      735 µs | **591 µs** |     5.28 ms |    965 µs |
| fetch 1k rows (6 columns)                                     | **1.56 ms** | 2.01 ms |     1.99 ms |    3.45 ms |     9.34 ms |   2.65 ms |
| 100 parameters (id in (…)), 100 rows                          |  **748 µs** | 1.05 ms |     1.18 ms |     831 µs |     3.45 ms |   1.47 ms |
| 1000 parameters (id in (…)), 1000 rows                        |     3.27 ms | 3.37 ms | **3.02 ms** |    3.36 ms |     7.46 ms |   3.17 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.14 ms** | 3.64 ms |     2.95 ms |    3.21 ms |     5.05 ms |   4.02 ms |
| insert one row                                                |      290 µs |  416 µs |      423 µs |     384 µs |  **277 µs** |    568 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **642 µs** | 1.21 ms |     1.12 ms |     773 µs |     1.75 ms |   1.20 ms |
| update one row by primary key                                 |  **146 µs** |  482 µs |      416 µs |     375 µs |      252 µs |    566 µs |
| upsert (insert … on conflict do update)                       |      235 µs |  469 µs |      451 µs |     422 µs |  **221 µs** |    576 µs |
| delete one row by primary key                                 |  **226 µs** |  435 µs |      432 µs |     393 µs |      250 µs |    581 µs |
| transaction: begin; select 1; commit                          |      541 µs |  480 µs |      689 µs | **429 µs** |     1.14 ms |   2.01 ms |
| transaction: begin; insert; commit                            |      555 µs |  740 µs |      538 µs | **508 µs** |     1.10 ms |   1.73 ms |
| transaction with 5 savepoints (select 1 in each)              | **1.02 ms** | 2.52 ms |     2.72 ms |    2.42 ms |     4.82 ms |   4.32 ms |
| query that fails (division by zero), connection reused        |      368 µs | 3.25 ms |     3.85 ms |    5.46 ms |  **354 µs** |   4.15 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler |      435 µs |  508 µs |      524 µs | **404 µs** |      623 µs |    821 µs |

**Node 24: latency distribution, select 1**

| Percentile |           quarry |           pg |    pg (named) |       pg-native |      postgres.js |    neon (WS) |
| ---------- | ---------------: | -----------: | ------------: | --------------: | ---------------: | -----------: |
| p50        | **21.4 µs ±13%** |  26.2 µs ±2% |   26.5 µs ±2% |    31.3 µs ±15% |     28.9 µs ±13% | 46.3 µs ±20% |
| p90        | **22.4 µs ±12%** |  27.7 µs ±4% |   28.6 µs ±4% |    32.8 µs ±17% |      33.4 µs ±9% | 51.7 µs ±24% |
| p99        | **27.4 µs ±11%** |  39.1 µs ±3% |   43.7 µs ±8% |    42.6 µs ±23% |     49.2 µs ±18% | 87.0 µs ±69% |
| p99.9      |      203 µs ±19% |  361 µs ±41% |   376 µs ±14% |     203 µs ±13% | **150 µs ±112%** |  532 µs ±29% |
| max        |      785 µs ±26% | 1.77 ms ±54% | 1.19 ms ±125% | **648 µs ±26%** |      4.86 ms ±9% | 3.19 ms ±27% |

**Node 24: latency distribution, point lookup by primary key**

| Percentile |           quarry |           pg |       pg (named) |    pg-native |     postgres.js |    neon (WS) |
| ---------- | ---------------: | -----------: | ---------------: | -----------: | --------------: | -----------: |
| p50        | **26.4 µs ±13%** |  46.4 µs ±3% |      34.6 µs ±5% | 50.0 µs ±16% |    32.9 µs ±15% | 77.8 µs ±15% |
| p90        | **27.4 µs ±15%** | 50.0 µs ±11% |     36.5 µs ±34% | 52.0 µs ±19% |    35.9 µs ±14% | 85.0 µs ±18% |
| p99        | **34.4 µs ±12%** | 70.6 µs ±15% |     57.4 µs ±75% | 64.3 µs ±63% |    47.8 µs ±18% |  151 µs ±15% |
| p99.9      |      280 µs ±64% |  512 µs ±11% |      447 µs ±18% |  410 µs ±25% | **220 µs ±74%** |  628 µs ±12% |
| max        |     1.37 ms ±35% | 2.95 ms ±45% | **877 µs ±391%** | 3.52 ms ±39% |    5.83 ms ±14% | 4.89 ms ±36% |

**Node 24: large results and bulk work, time per operation (median)**

| Scenario                                                                    |            quarry |               pg |       pg (named) |     pg-native |       postgres.js |     neon (WS) |
| --------------------------------------------------------------------------- | ----------------: | ---------------: | ---------------: | ------------: | ----------------: | ------------: |
| fetch 100k rows                                                             | **27.80 ms ±26%** |       120 ms ±3% |       119 ms ±2% |   146 ms ±20% |     91.93 ms ±17% |   130 ms ±14% |
| fetch 1M rows (one result)                                                  |   **389 ms ±14%** |     1242 ms ±16% |      1257 ms ±8% |  1482 ms ±11% |       1044 ms ±8% |  1377 ms ±11% |
| wide rows: 1k rows × 100 columns                                            |   **3.48 ms ±6%** |     14.37 ms ±7% |     14.15 ms ±8% |  21.27 ms ±1% |      14.11 ms ±7% | 16.90 ms ±17% |
| large values: 10 × 1 MB text                                                |       4.90 ms ±4% |      5.70 ms ±3% |      5.63 ms ±8% |  11.82 ms ±9% |   **4.79 ms ±3%** |   8.49 ms ±9% |
| large values: 10 × 1 MB bytea                                               |   **3.45 ms ±6%** |     16.96 ms ±7% |     17.30 ms ±3% |  31.64 ms ±2% |      16.50 ms ±6% |  23.65 ms ±2% |
| large values: 20 × 200 KB jsonb                                             |     23.35 ms ±14% |     23.50 ms ±4% | **23.04 ms ±3%** | 37.89 ms ±14% |      23.57 ms ±9% |  27.19 ms ±3% |
| arrays: 1k rows of int4[100] + text[20]                                     |  **3.23 ms ±<1%** |     22.10 ms ±5% |    23.35 ms ±10% |  26.07 ms ±1% |      8.39 ms ±20% | 24.63 ms ±20% |
| bulk insert 10k rows (unnest arrays)                                        |     12.56 ms ±13% |    12.83 ms ±11% |    12.65 ms ±16% |  12.69 ms ±6% | **12.47 ms ±10%** | 13.44 ms ±17% |
| bulk insert 10k rows (unnest, JS array parameters)                          |  **13.38 ms ±8%** |     15.45 ms ±1% |    15.53 ms ±12% |  15.55 ms ±3% |      15.31 ms ±2% | 16.26 ms ±22% |
| bulk insert 1k rows (unnest, JS array parameters)                           |   **1.44 ms ±5%** |     2.02 ms ±17% |     1.73 ms ±16% |   1.96 ms ±9% |       1.78 ms ±5% |   1.89 ms ±2% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     12.47 ms ±16% | **12.44 ms ±1%** |    12.61 ms ±11% |           n/a |     55.95 ms ±<1% |           n/a |
| stream 1M rows with a cursor (1000 per batch)                               |    **304 ms ±4%** |     1267 ms ±16% |     1244 ms ±18% |           n/a |      1053 ms ±15% |           n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |    **429 ms ±2%** |       716 ms ±6% |       713 ms ±5% |           n/a |        676 ms ±2% |           n/a |

**Node 24: rows per second (median)**

| Scenario                                           |        quarry |          pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | ------------: | ----------: | ---------: | --------: | ----------: | --------: |
| fetch 1k rows (6 columns)                          | **2,983,706** |     767,666 |    798,122 |   621,277 |     926,331 |   665,546 |
| fetch 100k rows                                    | **2,898,859** |     823,852 |    833,518 |   662,485 |   1,058,160 |   762,345 |
| fetch 1M rows (one result)                         | **2,568,684** |     806,950 |    795,566 |   672,225 |     969,817 |   728,961 |
| wide rows: 1k rows × 100 columns                   |   **275,141** |      66,615 |     66,502 |    45,843 |      61,339 |    57,549 |
| arrays: 1k rows of int4[100] + text[20]            |   **304,705** |      43,548 |     41,489 |    37,702 |     109,568 |    38,748 |
| stream 1M rows with a cursor (1000 per batch)      | **3,276,098** |     788,905 |    806,242 |       n/a |     951,483 |       n/a |
| bulk insert 10k rows (unnest arrays)               |       781,340 |     751,736 |    789,822 |   786,580 | **799,567** |   738,335 |
| bulk insert 10k rows (unnest, JS array parameters) |   **748,773** |     643,492 |    645,149 |   642,080 |     649,344 |   610,556 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **704,956** |     496,655 |    571,592 |   501,502 |     557,884 |   525,180 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       800,760 | **804,886** |    791,682 |       n/a |     179,109 |       n/a |

**Node 24: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------- | ------: | ----: | ---------: | --------: | ----------: | --------: |
| fetch 100k rows × 5                               |     350 |   375 |        375 |       432 |     **347** |       383 |
| fetch 1M rows (one result) × 3                    |   1,250 | 1,370 |      1,369 |     1,665 |   **1,121** |     1,397 |
| wide rows: 1k rows × 100 columns × 50             | **167** |   197 |        197 |       194 |         367 |       247 |
| large values: 10 × 1 MB text × 20                 | **184** |   202 |        198 |       245 |         187 |       225 |
| large values: 10 × 1 MB bytea × 20                | **187** |   205 |        209 |       218 |         199 |       233 |
| large values: 20 × 200 KB jsonb × 10              | **188** |   200 |        200 |       196 |         254 |       209 |
| arrays: 1k rows of int4[100] + text[20] × 50      | **149** |   332 |        326 |       258 |         258 |       317 |
| stream 1M rows with a cursor (1000 per batch) × 3 | **131** |   212 |        212 |       n/a |         245 |       n/a |

**Node 24: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    |  quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------------------------------------- | ------: | ----: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key                                                 |  **99** |   107 |        107 |       106 |         152 |       104 |
| fetch 100k rows                                                             |     543 |   542 |        542 |       527 |     **516** |       631 |
| fetch 1M rows (one result)                                                  |   1,706 | 1,369 |      1,369 |     1,665 |   **1,119** |     1,399 |
| stream 1M rows with a cursor (1000 per batch)                               | **155** |   211 |        211 |       n/a |         246 |       n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) | **117** |   121 |        121 |       n/a |         231 |       n/a |
| large values: 10 × 1 MB text                                                | **194** |   209 |        209 |       282 |         195 |       237 |
| large values: 10 × 1 MB bytea                                               |     197 |   209 |        210 |       243 |     **196** |       236 |
| large values: 20 × 200 KB jsonb                                             |     342 |   302 |        322 |   **291** |         392 |       351 |

**Node 24: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |  quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------------------- | ------: | ------: | ---------: | --------: | ----------: | --------: |
| RSS growth during pause | **0.0** | **0.0** |    **0.0** |       n/a |     **0.0** |       n/a |

**Node 24: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry | quarry (lossless) |        pg | pg (named) |  pg-native | postgres.js |  neon (WS) |
| -------------------- | -----------: | ----------------: | --------: | ---------: | ---------: | ----------: | ---------: |
| int4                 |   **75 ±8%** |           75 ±19% |   189 ±2% |   193 ±19% |   198 ±17% |    248 ±17% |    274 ±3% |
| int8                 |       95 ±2% |       **81 ±15%** |  226 ±13% |   224 ±19% |    216 ±2% |    233 ±15% |    322 ±9% |
| float8               |      81 ±16% |       **81 ±13%** |  213 ±35% |   208 ±19% |   236 ±16% |    302 ±12% |    304 ±4% |
| numeric              |     134 ±16% |       **134 ±5%** |   165 ±2% |   160 ±10% |    235 ±1% |     240 ±9% |   265 ±17% |
| text                 |  **98 ±23%** |            98 ±2% |  181 ±13% |    166 ±4% |   198 ±18% |    233 ±11% |   259 ±11% |
| bool                 |   **82 ±3%** |           82 ±16% |  143 ±24% |   144 ±14% |    166 ±1% |    211 ±16% |   200 ±16% |
| timestamptz          | **109 ±15%** |          161 ±17% |  681 ±14% |   643 ±21% |   736 ±24% |     441 ±4% |   760 ±14% |
| date                 | **109 ±27%** |           110 ±3% |  486 ±19% |    489 ±7% |   460 ±10% |     367 ±2% |   589 ±15% |
| uuid                 |  **125 ±4%** |           127 ±5% |   203 ±8% |   183 ±16% |   230 ±17% |    231 ±19% |   253 ±15% |
| jsonb (small object) | **333 ±16%** |          346 ±18% |   404 ±6% |   411 ±11% |   543 ±16% |    489 ±15% |   502 ±12% |
| int4[5]              |  **256 ±4%** |          259 ±12% | 1,114 ±6% | 1,069 ±19% | 1,226 ±12% |    601 ±19% | 1,645 ±14% |
| bytea (16 B)         |  **155 ±7%** |           158 ±9% |  359 ±17% |    392 ±9% |    390 ±7% |     350 ±6% |    446 ±7% |

**Node 24: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |          quarry |           pg |  pg (named) |   pg-native |   postgres.js |   neon (WS) |
| -------------------------------------------------- | --------------: | -----------: | ----------: | ----------: | ------------: | ----------: |
| insert one row                                     |  **35,369 ±7%** |   24,636 ±9% |  30,755 ±3% |  21,420 ±5% |   28,121 ±10% |  13,087 ±2% |
| insert one row, concurrency 50                     | **260,415 ±2%** |   85,598 ±4% |  84,264 ±3% | 73,499 ±14% |    41,084 ±8% | 30,018 ±14% |
| multi-row insert: 100 rows, 300 parameters         |   **4,818 ±7%** |   3,171 ±21% |   4,422 ±1% |  3,151 ±14% |     2,938 ±2% |   3,252 ±2% |
| bulk insert 10k rows (unnest arrays)               |       78.1 ±10% |     75.2 ±7% |   79.0 ±14% |    78.7 ±5% | **80.0 ±17%** |   73.8 ±14% |
| bulk insert 10k rows (unnest, JS array parameters) |    **74.9 ±9%** |     64.3 ±1% |   64.5 ±14% |    64.2 ±3% |      64.9 ±2% |   61.1 ±17% |
| bulk insert 1k rows (unnest, JS array parameters)  |     **705 ±7%** |     497 ±18% |    572 ±13% |    502 ±11% |       558 ±5% |     525 ±2% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       80.1 ±14% | **80.5 ±1%** |   79.2 ±10% |         n/a |     17.9 ±<1% |         n/a |
| update one row by primary key                      | **31,496 ±11%** |  20,523 ±16% |  26,427 ±3% | 18,556 ±13% |    25,943 ±3% |  11,812 ±4% |
| upsert (insert … on conflict do update)            | **31,519 ±13%** |  20,302 ±10% | 27,093 ±14% |  19,389 ±2% |    25,522 ±6% | 12,110 ±10% |
| delete one row by primary key                      |  **37,560 ±2%** |   24,649 ±3% | 30,745 ±11% |  21,877 ±5% |    30,569 ±2% |  12,838 ±7% |

**Node 24: transactions, operations/s**

| Scenario                                         |         quarry |          pg | pg (named) |  pg-native | postgres.js |  neon (WS) |
| ------------------------------------------------ | -------------: | ----------: | ---------: | ---------: | ----------: | ---------: |
| transaction: begin; select 1; commit             | **20,372 ±2%** |  14,198 ±4% | 13,638 ±6% | 11,159 ±5% |  11,137 ±4% |  7,296 ±1% |
| transaction: begin; insert; commit               | **18,604 ±7%** | 11,720 ±11% | 13,237 ±4% |  9,414 ±7% | 10,570 ±11% | 6,250 ±13% |
| transaction with 5 savepoints (select 1 in each) |  **3,732 ±5%** |   2,565 ±2% | 2,455 ±13% | 2,038 ±13% |  2,785 ±13% |  1,335 ±2% |

**Node 24: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | --------: | ----------: | --------: |
| select 1                                               |   **13.2** |    17.1 |       20.1 |      20.2 |        23.4 |      25.6 |
| point lookup by primary key                            |   **15.1** |    26.2 |       24.9 |      26.9 |        25.9 |      49.1 |
| fetch 1k rows (6 columns)                              |    **313** |   1,165 |      1,171 |     1,258 |       1,125 |     1,313 |
| fetch 100k rows                                        | **48,838** | 151,995 |    146,828 |   155,026 |     119,536 |   163,826 |
| insert one row                                         |   **14.9** |    18.8 |       19.8 |      23.8 |        25.3 |      44.3 |
| insert one row, concurrency 50                         |    **4.0** |    12.5 |       12.8 |      14.2 |        28.5 |      32.7 |
| transaction: begin; insert; commit                     |   **33.0** |    49.6 |       48.8 |      59.6 |        79.5 |      84.9 |
| query that fails (division by zero), connection reused |   **26.0** |     490 |        604 |     1,285 |        52.0 |     1,008 |

**Node 24: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------ | -------: | ---: | ---------: | --------: | ----------: | --------: |
| select 1                             |  **9.5** | 11.8 |        9.7 |      14.9 |        12.7 |      12.1 |
| point lookup by primary key          | **13.5** | 26.7 |       14.3 |      29.9 |        14.6 |      35.6 |
| fetch 1k rows (6 columns)            |  **238** |  414 |        370 |       493 |         388 |       471 |
| 100 parameters (id in (…)), 100 rows |      181 |  234 |    **181** |       240 |         185 |       246 |
| insert one row                       |     14.8 | 24.3 |   **14.4** |      27.9 |        14.4 |      34.9 |
| insert one row, concurrency 50       | **11.9** | 34.3 |       17.9 |      40.3 |        17.4 |      44.0 |
| transaction: begin; insert; commit   | **24.2** | 41.1 |       30.6 |      55.2 |        31.7 |      50.2 |

**Node 24: GC time (ms per second of run) / longest GC pause**

| Scenario                                       |  quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ---------------------------------------------- | ------: | ------: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: GC ms/s           |    10.5 |    16.6 |       18.8 |   **9.1** |        22.8 |      17.4 |
| point lookup by primary key: max pause ms      |     0.6 |     0.6 |        0.5 |   **0.5** |         5.3 |       0.6 |
| insert one row, concurrency 50: GC ms/s        |    29.6 |    24.9 |       26.9 |  **17.2** |        18.0 |      20.5 |
| insert one row, concurrency 50: max pause ms   |     1.3 |     1.3 |        1.2 |   **1.0** |         4.8 |       1.5 |
| fetch 1k rows (6 columns): GC ms/s             |    22.7 |    16.2 |       16.4 |  **11.0** |        72.2 |      20.2 |
| fetch 1k rows (6 columns): max pause ms        |     1.3 | **0.6** |        0.6 |       1.3 |         7.6 |       0.7 |
| fetch 100k rows: GC ms/s                       |   177.2 |   115.2 |      106.7 |  **78.0** |       127.5 |     116.6 |
| fetch 100k rows: max pause ms                  |    14.6 |    12.0 |   **10.5** |      12.9 |        13.1 |      11.0 |
| fetch 1M rows (one result): GC ms/s            |   215.5 |   135.3 |      132.9 |  **70.5** |       159.2 |     132.3 |
| fetch 1M rows (one result): max pause ms       |    24.0 |    15.1 |       15.4 |      16.0 |        32.5 |  **12.3** |
| wide rows: 1k rows × 100 columns: GC ms/s      |    21.5 |    23.6 |       22.4 |  **14.3** |       121.1 |      42.2 |
| wide rows: 1k rows × 100 columns: max pause ms | **2.3** |     3.6 |        3.5 |       2.4 |         8.6 |       2.9 |
| large values: 20 × 200 KB jsonb: GC ms/s       |    29.1 |    35.0 |       31.9 |  **13.0** |        30.0 |      42.5 |
| large values: 20 × 200 KB jsonb: max pause ms  |     6.5 |     6.1 |        5.5 |   **3.8** |         6.9 |       6.3 |

**Node 24: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |   quarry |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | -------: | -------: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: p99                   |  **0.0** |      0.4 |        0.1 |       0.2 |         2.2 |       0.3 |
| point lookup by primary key: max                   |      0.3 |      1.5 |    **0.2** |       0.2 |         2.2 |       1.3 |
| insert one row, concurrency 50: p99                |      0.8 |      0.5 |    **0.3** |       0.4 |         3.5 |       0.3 |
| insert one row, concurrency 50: max                |      1.0 |      0.5 |    **0.4** |       0.6 |         3.5 |       0.8 |
| fetch 1k rows (6 columns): p99                     |  **0.2** |      0.8 |        1.0 |       1.1 |         3.9 |       1.5 |
| fetch 1k rows (6 columns): max                     |  **0.4** |      0.8 |        1.0 |       1.1 |         3.9 |       1.5 |
| fetch 100k rows: p99                               | **15.6** |     36.5 |       37.2 |     116.8 |        22.2 |      38.5 |
| fetch 100k rows: max                               | **18.4** |     36.5 |       37.2 |     116.8 |        24.6 |      38.5 |
| fetch 1M rows (one result): p99                    |     26.3 |     25.6 |   **25.4** |   1,201.5 |        28.5 |      34.1 |
| fetch 1M rows (one result): max                    |     29.6 | **29.5** |       30.0 |   1,201.5 |        43.0 |      75.5 |
| stream 1M rows with a cursor (1000 per batch): p99 |  **0.2** |      0.7 |        0.9 |       n/a |         5.2 |       n/a |
| stream 1M rows with a cursor (1000 per batch): max |  **0.6** |      1.3 |        1.6 |       n/a |         7.1 |       n/a |

**Node 24: connections (median time per operation)**

| Scenario                                                    |           quarry |           pg |   pg (named) |     pg-native |  postgres.js |       neon (WS) |
| ----------------------------------------------------------- | ---------------: | -----------: | -----------: | ------------: | -----------: | --------------: |
| connect + select 1 + close (no TLS, trust)                  |  **2.29 ms ±1%** | 3.94 ms ±11% |  3.95 ms ±5% |   4.69 ms ±4% |  6.70 ms ±3% |    4.37 ms ±11% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | **2.55 ms ±15%** |  5.29 ms ±8% | 5.16 ms ±12% |   7.77 ms ±9% |  7.77 ms ±2% |   68.50 ms ±14% |
| connect + select 1 + close (TLS verify-full, trust)         |     4.93 ms ±12% |  4.93 ms ±4% |  4.93 ms ±3% |   4.83 ms ±7% | 52.25 ms ±1% | **4.26 ms ±8%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |  **5.19 ms ±7%** |  6.49 ms ±4% |  6.73 ms ±5% |   7.52 ms ±4% | 53.28 ms ±4% |    68.70 ms ±2% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     |  **7.64 ms ±2%** |  8.20 ms ±2% |  8.40 ms ±3% | 13.20 ms ±14% | 14.67 ms ±4% |     8.11 ms ±1% |

**Node 24: cancellation, notifications, errors**

| Scenario                                      |        quarry |        pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------- | ------------: | --------: | ---------: | --------: | ----------: | --------: |
| cancel: time from cancel() to rejection (p50) |   **1.40 ms** |   1.43 ms |    1.42 ms |   2.18 ms |     1.40 ms |       n/a |
| cancel: share of queries actually cancelled   |      **100%** |  **100%** |   **100%** |  **100%** |    **100%** |       n/a |
| NOTIFY latency p50                            |   **30.9 µs** |   41.6 µs |    37.8 µs |   46.7 µs |     36.1 µs |   84.9 µs |
| NOTIFY latency p99                            |   **56.9 µs** |   85.6 µs |    87.0 µs |   76.9 µs |     72.6 µs |    294 µs |
| NOTIFY throughput (notifications/s)           | **2,564,635** | 2,095,215 |  2,055,378 |   825,020 |   1,794,984 | 1,765,115 |
| error path: failing queries/s                 |    **27,720** |       439 |        407 |       208 |      17,321 |       380 |

**Node 24: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |              pg-native |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 44,909 / 32,971 / +36% |  35,337 / 35,795 / -1% |  30,599 / 30,863 / -1% |   31,565 / 33,046 / -4% |
| point lookup by primary key             | 36,430 / 18,343 / +99% | 27,261 / 20,229 / +35% | 24,576 / 19,366 / +27% | 28,155 / 13,708 / +105% |
| range scan, 100 rows                    |  10,631 / 6,235 / +71% |    5,066 / 5,014 / +1% |    5,034 / 4,933 / +2% |    5,665 / 4,707 / +20% |
| fetch 1k rows (6 columns)               |  2,984 / 1,249 / +139% |        798 / 768 / +4% |        631 / 621 / +2% |         926 / 932 / -1% |
| 100 parameters (id in (…)), 100 rows    |   4,354 / 3,091 / +41% |   3,753 / 3,048 / +23% |   3,738 / 3,083 / +21% |    3,505 / 2,659 / +32% |
| 1000 parameters (id in (…)), 1000 rows  |       506 / 406 / +24% |       479 / 393 / +22% |       436 / 366 / +19% |        422 / 358 / +18% |
| insert one row                          | 35,369 / 26,716 / +32% | 30,755 / 24,636 / +25% | 26,831 / 21,420 / +25% |  28,121 / 14,602 / +93% |
| upsert (insert … on conflict do update) | 31,519 / 23,347 / +35% | 27,093 / 20,302 / +33% | 23,347 / 19,389 / +20% |  25,522 / 14,072 / +81% |

**Node 24: quarry decoding modes (time per op)**

| Scenario                                |            quarry | quarry (lossless) |
| --------------------------------------- | ----------------: | ----------------: |
| point lookup by primary key             |  **26.4 µs ±13%** |      26.8 µs ±15% |
| fetch 1k rows (6 columns)               |    **313 µs ±1%** |        346 µs ±2% |
| fetch 100k rows                         | **27.80 ms ±26%** |      30.16 ms ±8% |
| fetch 1M rows (one result)              |       389 ms ±14% |    **362 ms ±6%** |
| wide rows: 1k rows × 100 columns        |       3.48 ms ±6% |  **3.41 ms ±14%** |
| arrays: 1k rows of int4[100] + text[20] |      3.23 ms ±<1% |  **3.22 ms ±<1%** |
| decode 100k × int8                      |       9.53 ms ±2% |  **8.05 ms ±15%** |
| decode 100k × timestamptz               | **10.93 ms ±15%** |     16.10 ms ±17% |
| decode 100k × date                      | **10.90 ms ±27%** |      10.96 ms ±3% |

**Node 24: shipped defaults vs tuned (median latency)**

| Scenario                                   |   neon (WS) | neon (WS, defaults) |
| ------------------------------------------ | ----------: | ------------------: |
| select 1                                   | **46.3 µs** |             1.53 ms |
| point lookup by primary key                | **77.8 µs** |             1.60 ms |
| fetch 1k rows (6 columns)                  | **1.48 ms** |             2.97 ms |
| insert one row                             | **70.8 µs** |             1.61 ms |
| transaction: begin; insert; commit         |  **151 µs** |             4.66 ms |
| connect + select 1 + close (no TLS, trust) |     4.37 ms |                   — |

## Bun 1.4

**Bun 1.4: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |  postgres.js |          Bun.sql |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | ---------------: |
| select 1                                                      |  **19.3 µs ±1%** |  23.1 µs ±4% |  21.9 µs ±1% | 24.5 µs ±14% |     25.3 µs ±11% |
| point lookup by primary key                                   | **24.2 µs ±13%** |  40.5 µs ±1% |  28.9 µs ±1% |  28.7 µs ±3% |     28.3 µs ±11% |
| range scan, 100 rows                                          |  **75.9 µs ±1%** |   143 µs ±7% |   135 µs ±2% |   133 µs ±1% |     90.3 µs ±16% |
| fetch 1k rows (6 columns)                                     |  **263 µs ±13%** |  875 µs ±25% |   892 µs ±2% |  781 µs ±11% |      386 µs ±<1% |
| 100 parameters (id in (…)), 100 rows                          |   **210 µs ±3%** |   285 µs ±2% |   228 µs ±2% |   235 µs ±1% |       216 µs ±1% |
| 1000 parameters (id in (…)), 1000 rows                        |      1.86 ms ±5% |  2.43 ms ±1% |  2.01 ms ±5% |  1.97 ms ±4% |  **1.84 ms ±2%** |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **1.73 ms ±10%** | 2.12 ms ±10% | 1.95 ms ±10% |  1.90 ms ±2% |      1.76 ms ±9% |
| insert one row                                                | **24.2 µs ±14%** |  35.7 µs ±1% |  26.4 µs ±1% |  28.0 µs ±3% |      28.8 µs ±3% |
| multi-row insert: 100 rows, 300 parameters                    |   **178 µs ±3%** |   278 µs ±1% |   194 µs ±2% |   226 µs ±5% |      186 µs ±18% |
| update one row by primary key                                 |  **28.3 µs ±1%** | 42.6 µs ±15% | 30.3 µs ±15% | 31.8 µs ±13% |      33.0 µs ±2% |
| upsert (insert … on conflict do update)                       |  **28.9 µs ±6%** |  40.4 µs ±1% | 31.4 µs ±14% |  32.0 µs ±1% |      33.2 µs ±3% |
| delete one row by primary key                                 |  **23.4 µs ±1%** | 34.9 µs ±14% |  25.6 µs ±2% | 26.5 µs ±13% |      29.0 µs ±8% |
| transaction: begin; select 1; commit                          |  **41.3 µs ±3%** | 60.1 µs ±13% | 59.4 µs ±11% |  68.8 µs ±1% |      73.7 µs ±9% |
| transaction: begin; insert; commit                            |  **46.9 µs ±1%** |  73.8 µs ±2% |  63.4 µs ±1% | 73.3 µs ±12% |      83.2 µs ±7% |
| transaction with 5 savepoints (select 1 in each)              |   **236 µs ±5%** |   343 µs ±2% |   341 µs ±5% |   284 µs ±1% |      453 µs ±24% |
| query that fails (division by zero), connection reused        |      30.2 µs ±4% | 2.27 ms ±11% |  2.26 ms ±4% | 37.3 µs ±13% | **28.6 µs ±15%** |
| LISTEN/NOTIFY latency: notify on another connection → handler | **27.8 µs ±13%** |  35.4 µs ±1% |  30.9 µs ±9% | 31.6 µs ±13% |      33.1 µs ±2% |

**Bun 1.4: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) | postgres.js |         Bun.sql |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ----------: | --------------: |
| select 1                                                      |  **50,769 ±1%** |  41,504 ±4% |  43,828 ±2% | 39,027 ±12% |      37,361 ±7% |
| point lookup by primary key                                   | **40,675 ±12%** |  23,588 ±2% |  33,260 ±2% |  33,525 ±4% |     34,525 ±13% |
| range scan, 100 rows                                          |  **12,506 ±3%** |   6,503 ±5% |   6,992 ±1% |   7,185 ±4% |     10,590 ±13% |
| fetch 1k rows (6 columns)                                     |  **3,597 ±11%** |  1,060 ±21% |   1,024 ±2% |   1,159 ±9% |       2,516 ±1% |
| 100 parameters (id in (…)), 100 rows                          |   **4,703 ±4%** |   3,403 ±2% |   4,313 ±3% |   4,155 ±1% |       4,593 ±6% |
| 1000 parameters (id in (…)), 1000 rows                        |         534 ±5% |     408 ±2% |     489 ±4% |     498 ±4% |     **542 ±3%** |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     **573 ±8%** |     453 ±7% |     497 ±9% |     517 ±3% |         552 ±7% |
| insert one row                                                | **39,118 ±10%** |  26,883 ±2% |  36,433 ±2% |  34,045 ±7% |      33,700 ±4% |
| multi-row insert: 100 rows, 300 parameters                    |   **5,367 ±5%** |   3,452 ±1% |   4,872 ±5% |   4,219 ±4% |      5,124 ±14% |
| update one row by primary key                                 |  **34,510 ±2%** | 22,728 ±13% | 31,624 ±13% | 30,351 ±12% |      29,609 ±4% |
| upsert (insert … on conflict do update)                       | **33,747 ±11%** |  24,066 ±3% | 30,688 ±13% |  30,203 ±2% |      29,517 ±2% |
| delete one row by primary key                                 |  **41,431 ±1%** | 27,646 ±12% |  37,360 ±4% | 35,469 ±11% |      33,532 ±8% |
| transaction: begin; select 1; commit                          |  **23,598 ±4%** | 16,075 ±12% | 16,282 ±12% |  13,976 ±3% |     12,467 ±14% |
| transaction: begin; insert; commit                            |  **20,616 ±1%** |  12,952 ±3% |  15,240 ±1% | 13,150 ±12% |     10,909 ±13% |
| transaction with 5 savepoints (select 1 in each)              |   **4,165 ±7%** |   2,838 ±4% |   2,817 ±4% |   3,409 ±2% |       1,962 ±3% |
| query that fails (division by zero), connection reused        |      31,441 ±6% |    435 ±10% |     433 ±3% | 24,795 ±10% | **33,300 ±14%** |
| LISTEN/NOTIFY latency: notify on another connection → handler | **34,900 ±11%** |  26,855 ±2% | 31,427 ±12% | 30,191 ±13% |      29,262 ±2% |

**Bun 1.4: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | ----------: | ----------: |
| select 1                                                      | **23.5 µs** | 30.0 µs |    28.3 µs |     33.1 µs |     35.2 µs |
| point lookup by primary key                                   | **30.1 µs** | 54.4 µs |    38.8 µs |     42.4 µs |     36.2 µs |
| range scan, 100 rows                                          |  **111 µs** |  425 µs |     420 µs |      379 µs |      136 µs |
| fetch 1k rows (6 columns)                                     |  **664 µs** | 1.45 ms |    1.56 ms |     1.59 ms |      677 µs |
| 100 parameters (id in (…)), 100 rows                          |      251 µs |  507 µs |     330 µs |      414 µs |  **248 µs** |
| 1000 parameters (id in (…)), 1000 rows                        |     2.15 ms | 2.97 ms |    2.55 ms |     2.53 ms | **2.06 ms** |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.10 ms** | 2.83 ms |    2.68 ms |     2.46 ms |     2.24 ms |
| insert one row                                                | **36.0 µs** | 53.0 µs |    38.3 µs |     42.6 µs |     42.1 µs |
| multi-row insert: 100 rows, 300 parameters                    |      255 µs |  443 µs |     310 µs |      479 µs |  **245 µs** |
| update one row by primary key                                 | **36.1 µs** | 56.8 µs |    41.1 µs |     44.0 µs |     45.6 µs |
| upsert (insert … on conflict do update)                       | **37.3 µs** | 51.3 µs |    41.3 µs |     44.4 µs |     42.0 µs |
| delete one row by primary key                                 | **29.1 µs** | 44.6 µs |    33.9 µs |     41.6 µs |     36.9 µs |
| transaction: begin; select 1; commit                          | **51.0 µs** | 79.5 µs |    74.8 µs |     85.8 µs |      277 µs |
| transaction: begin; insert; commit                            | **63.9 µs** |  106 µs |    86.1 µs |     98.5 µs |      345 µs |
| transaction with 5 savepoints (select 1 in each)              |  **293 µs** |  626 µs |     661 µs |      694 µs |      944 µs |
| query that fails (division by zero), connection reused        | **40.0 µs** | 2.93 ms |    2.86 ms |     52.3 µs |     40.6 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler | **43.6 µs** | 56.5 µs |    47.8 µs |     48.5 µs |     44.4 µs |

**Bun 1.4: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | ----------: | ----------: |
| select 1                                                      | **41.1 µs** |  112 µs |     249 µs |     92.6 µs |     73.8 µs |
| point lookup by primary key                                   | **54.0 µs** |  414 µs |     361 µs |      289 µs |      170 µs |
| range scan, 100 rows                                          |      427 µs |  664 µs |     583 µs |      527 µs |  **346 µs** |
| fetch 1k rows (6 columns)                                     |      840 µs | 2.37 ms |    2.42 ms |     2.23 ms |  **812 µs** |
| 100 parameters (id in (…)), 100 rows                          |      442 µs |  709 µs |     631 µs |      681 µs |  **378 µs** |
| 1000 parameters (id in (…)), 1000 rows                        |     2.59 ms | 3.15 ms |    2.76 ms |     2.94 ms | **2.18 ms** |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.25 ms** | 3.27 ms |    3.00 ms |     2.72 ms |     2.43 ms |
| insert one row                                                | **81.4 µs** |  333 µs |     308 µs |      268 µs |      186 µs |
| multi-row insert: 100 rows, 300 parameters                    |      396 µs |  601 µs |     549 µs |      611 µs |  **386 µs** |
| update one row by primary key                                 | **77.3 µs** |  329 µs |     250 µs |      293 µs |      165 µs |
| upsert (insert … on conflict do update)                       | **98.1 µs** |  302 µs |     282 µs |      310 µs |      183 µs |
| delete one row by primary key                                 | **58.7 µs** |  295 µs |     272 µs |      238 µs |     91.0 µs |
| transaction: begin; select 1; commit                          |  **299 µs** |  359 µs |     420 µs |      505 µs |      436 µs |
| transaction: begin; insert; commit                            |  **331 µs** |  464 µs |     434 µs |      498 µs |      575 µs |
| transaction with 5 savepoints (select 1 in each)              |  **792 µs** |  985 µs |    1.11 ms |      917 µs |     1.45 ms |
| query that fails (division by zero), connection reused        | **94.8 µs** | 3.15 ms |    3.15 ms |      496 µs |      165 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |      251 µs |  439 µs |     386 µs |      439 µs |  **222 µs** |

**Bun 1.4: latency distribution, select 1**

| Percentile |           quarry |           pg |  pg (named) |   postgres.js |       Bun.sql |
| ---------- | ---------------: | -----------: | ----------: | ------------: | ------------: |
| p50        |  **19.3 µs ±1%** |  23.1 µs ±4% | 21.9 µs ±1% |  24.5 µs ±14% |  25.3 µs ±11% |
| p90        |  **20.2 µs ±1%** | 24.6 µs ±11% | 23.0 µs ±6% |  25.8 µs ±19% |  29.2 µs ±12% |
| p99        |  **23.5 µs ±6%** | 30.0 µs ±10% | 28.3 µs ±8% |  33.1 µs ±16% |   35.2 µs ±8% |
| p99.9      | **41.1 µs ±62%** |  112 µs ±99% | 249 µs ±58% | 92.6 µs ±171% | 73.8 µs ±125% |
| max        |   **418 µs ±7%** |  767 µs ±37% | 986 µs ±31% |   925 µs ±26% |   494 µs ±50% |

**Bun 1.4: latency distribution, point lookup by primary key**

| Percentile |           quarry |           pg |  pg (named) |  postgres.js |      Bun.sql |
| ---------- | ---------------: | -----------: | ----------: | -----------: | -----------: |
| p50        | **24.2 µs ±13%** |  40.5 µs ±1% | 28.9 µs ±1% |  28.7 µs ±3% | 28.3 µs ±11% |
| p90        | **25.0 µs ±14%** |  43.6 µs ±9% | 30.3 µs ±6% |  31.7 µs ±7% | 29.1 µs ±43% |
| p99        | **30.1 µs ±13%** | 54.4 µs ±17% | 38.8 µs ±8% | 42.4 µs ±10% | 36.2 µs ±48% |
| p99.9      | **54.0 µs ±56%** |  414 µs ±10% | 361 µs ±14% |  289 µs ±41% |  170 µs ±67% |
| max        |  **450 µs ±78%** |  966 µs ±32% | 1.03 ms ±6% |  909 µs ±25% |  500 µs ±98% |

**Bun 1.4: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |               pg |    pg (named) |   postgres.js |           Bun.sql |
| --------------------------------------------------------------------------- | ---------------: | ---------------: | ------------: | ------------: | ----------------: |
| fetch 100k rows                                                             | **23.57 ms ±2%** |    89.74 ms ±11% |  86.46 ms ±7% |  79.22 ms ±8% |      32.63 ms ±9% |
| fetch 1M rows (one result)                                                  |  **240 ms ±16%** |       887 ms ±5% |   893 ms ±11% |   893 ms ±21% |        344 ms ±7% |
| wide rows: 1k rows × 100 columns                                            |  **2.69 ms ±9%** |     10.98 ms ±1% | 10.94 ms ±14% | 11.79 ms ±13% |      8.60 ms ±10% |
| large values: 10 × 1 MB text                                                |      5.03 ms ±4% |      5.32 ms ±7% |  4.98 ms ±13% |   5.29 ms ±4% |   **4.64 ms ±4%** |
| large values: 10 × 1 MB bytea                                               |  **4.20 ms ±9%** |    11.95 ms ±14% | 11.79 ms ±14% | 11.71 ms ±12% |      11.26 ms ±2% |
| large values: 20 × 200 KB jsonb                                             |     17.25 ms ±3% |     16.87 ms ±1% |  16.96 ms ±8% | 17.51 ms ±15% |  **16.76 ms ±1%** |
| arrays: 1k rows of int4[100] + text[20]                                     |  **3.31 ms ±7%** |    18.36 ms ±10% |  18.51 ms ±6% |   7.77 ms ±7% |      4.87 ms ±19% |
| bulk insert 10k rows (unnest arrays)                                        |    12.46 ms ±13% |     12.81 ms ±2% |  12.35 ms ±1% |  12.40 ms ±8% | **12.32 ms ±13%** |
| bulk insert 10k rows (unnest, JS array parameters)                          | **12.06 ms ±3%** |     14.90 ms ±6% |  15.06 ms ±3% |  14.50 ms ±4% |      13.96 ms ±5% |
| bulk insert 1k rows (unnest, JS array parameters)                           |  **1.39 ms ±4%** |      1.70 ms ±4% |   1.65 ms ±2% |   1.63 ms ±2% |       1.54 ms ±3% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     12.47 ms ±2% | **12.37 ms ±2%** | 12.38 ms ±17% |  12.55 ms ±2% |               n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **244 ms ±5%** |      1029 ms ±3% |  1015 ms ±11% |   846 ms ±15% |               n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **425 ms ±1%** |       670 ms ±1% |    676 ms ±1% |    650 ms ±5% |               n/a |

**Bun 1.4: rows per second (median)**

| Scenario                                           |        quarry |          pg | pg (named) | postgres.js |     Bun.sql |
| -------------------------------------------------- | ------------: | ----------: | ---------: | ----------: | ----------: |
| fetch 1k rows (6 columns)                          | **3,597,316** |   1,059,568 |  1,024,378 |   1,158,797 |   2,515,677 |
| fetch 100k rows                                    | **4,191,859** |   1,070,341 |  1,140,433 |   1,269,401 |   3,014,354 |
| fetch 1M rows (one result)                         | **4,022,020** |   1,069,418 |  1,104,558 |   1,097,191 |   2,689,693 |
| wide rows: 1k rows × 100 columns                   |   **337,277** |      91,577 |     92,124 |      84,807 |     112,960 |
| arrays: 1k rows of int4[100] + text[20]            |   **291,051** |      53,759 |     53,845 |     131,035 |     200,527 |
| stream 1M rows with a cursor (1000 per batch)      | **4,070,132** |     972,970 |    989,498 |   1,156,380 |         n/a |
| bulk insert 10k rows (unnest arrays)               |       792,453 |     774,849 |    807,364 |     802,655 | **809,061** |
| bulk insert 10k rows (unnest, JS array parameters) |   **825,713** |     664,132 |    651,556 |     680,986 |     710,207 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **727,963** |     563,967 |    589,771 |     615,342 |     648,960 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       798,759 | **806,076** |    804,096 |     788,750 |         n/a |

**Bun 1.4: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |    pg | pg (named) | postgres.js | Bun.sql |
| ------------------------------------------------- | ------: | ----: | ---------: | ----------: | ------: |
| fetch 100k rows × 5                               |     156 |   209 |        248 |         169 | **138** |
| fetch 1M rows (one result) × 3                    | **823** | 1,270 |      1,265 |       1,009 |     871 |
| wide rows: 1k rows × 100 columns × 50             |     111 |   115 |        110 |          85 |  **61** |
| large values: 10 × 1 MB text × 20                 | **120** |   173 |        175 |         139 |     121 |
| large values: 10 × 1 MB bytea × 20                | **123** |   210 |        215 |         147 |     134 |
| large values: 20 × 200 KB jsonb × 10              |     113 |   146 |        152 |         112 |  **74** |
| arrays: 1k rows of int4[100] + text[20] × 50      |      74 |    94 |         95 |          93 |  **58** |
| stream 1M rows with a cursor (1000 per batch) × 3 |      71 |    67 |         67 |      **67** |     n/a |

**Bun 1.4: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    | quarry |    pg | pg (named) | postgres.js | Bun.sql |
| --------------------------------------------------------------------------- | -----: | ----: | ---------: | ----------: | ------: |
| point lookup by primary key                                                 |     59 |    63 |         63 |          55 |  **47** |
| fetch 100k rows                                                             |    212 |   287 |        325 |     **180** |     202 |
| fetch 1M rows (one result)                                                  |  1,312 | 1,268 |      1,266 |   **1,009** |   1,080 |
| stream 1M rows with a cursor (1000 per batch)                               |     73 |    68 |         67 |      **67** |     n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) | **59** |    64 |         63 |          59 |     n/a |
| large values: 10 × 1 MB text                                                |    168 |   231 |        236 |         168 | **155** |
| large values: 10 × 1 MB bytea                                               |    186 |   247 |        244 |         177 | **121** |
| large values: 20 × 200 KB jsonb                                             |    123 |   186 |        189 |         123 |  **88** |

**Bun 1.4: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |    quarry |    pg | pg (named) | postgres.js | Bun.sql |
| ----------------------- | --------: | ----: | ---------: | ----------: | ------: |
| RSS growth during pause | **-21.7** | -13.7 |      -14.3 |       -18.7 |     n/a |

**Bun 1.4: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |      quarry | quarry (lossless) |       pg | pg (named) | postgres.js |     Bun.sql |
| -------------------- | ----------: | ----------------: | -------: | ---------: | ----------: | ----------: |
| int4                 |      76 ±2% |        **76 ±1%** | 175 ±20% |    165 ±5% |     155 ±3% |    104 ±15% |
| int8                 |      91 ±1% |       **81 ±14%** |  188 ±8% |   204 ±11% |    155 ±18% |     121 ±4% |
| float8               |      81 ±4% |        **80 ±7%** | 201 ±39% |   196 ±12% |     171 ±6% |    116 ±16% |
| numeric              | **135 ±4%** |           135 ±3% |  177 ±6% |   179 ±15% |    164 ±15% |    139 ±17% |
| text                 |  **98 ±1%** |            98 ±1% | 168 ±12% |   176 ±40% |    164 ±16% |    123 ±15% |
| bool                 |     83 ±13% |        **82 ±1%** |  149 ±3% |   134 ±16% |     132 ±3% |     87 ±18% |
| timestamptz          | **89 ±15%** |          164 ±15% | 437 ±16% |    429 ±4% |     353 ±1% |    166 ±15% |
| date                 | **109 ±3%** |           111 ±4% |  322 ±1% |   325 ±13% |     247 ±2% |     201 ±4% |
| uuid                 |     127 ±3% |          132 ±11% |  182 ±5% |   180 ±14% |    165 ±14% | **127 ±6%** |
| jsonb (small object) | **277 ±3%** |          281 ±11% | 398 ±11% |   407 ±11% |     379 ±2% |    299 ±14% |
| int4[5]              | **255 ±5%** |          258 ±19% |  776 ±8% |    774 ±3% |    425 ±17% |     375 ±2% |
| bytea (16 B)         | **128 ±1%** |           129 ±2% |  437 ±5% |    475 ±9% |    445 ±21% |    134 ±15% |

**Bun 1.4: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |           quarry |           pg |  pg (named) | postgres.js |       Bun.sql |
| -------------------------------------------------- | ---------------: | -----------: | ----------: | ----------: | ------------: |
| insert one row                                     |  **39,118 ±10%** |   26,883 ±2% |  36,433 ±2% |  34,045 ±7% |    33,700 ±4% |
| insert one row, concurrency 50                     | **261,286 ±16%** |   97,044 ±5% | 98,692 ±12% |  64,057 ±5% |   148,955 ±3% |
| multi-row insert: 100 rows, 300 parameters         |    **5,367 ±5%** |    3,452 ±1% |   4,872 ±5% |   4,219 ±4% |    5,124 ±14% |
| bulk insert 10k rows (unnest arrays)               |        79.2 ±10% |     77.5 ±2% |    80.7 ±1% |    80.3 ±9% | **80.9 ±12%** |
| bulk insert 10k rows (unnest, JS array parameters) |     **82.6 ±3%** |     66.4 ±6% |    65.2 ±2% |   68.1 ±10% |      71.0 ±4% |
| bulk insert 1k rows (unnest, JS array parameters)  |      **728 ±3%** |      564 ±8% |     590 ±4% |     615 ±2% |       649 ±3% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |         79.9 ±5% | **80.6 ±2%** |   80.4 ±14% |    78.9 ±1% |           n/a |
| update one row by primary key                      |   **34,510 ±2%** |  22,728 ±13% | 31,624 ±13% | 30,351 ±12% |    29,609 ±4% |
| upsert (insert … on conflict do update)            |  **33,747 ±11%** |   24,066 ±3% | 30,688 ±13% |  30,203 ±2% |    29,517 ±2% |
| delete one row by primary key                      |   **41,431 ±1%** |  27,646 ±12% |  37,360 ±4% | 35,469 ±11% |    33,532 ±8% |

**Bun 1.4: transactions, operations/s**

| Scenario                                         |         quarry |          pg |  pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------ | -------------: | ----------: | ----------: | ----------: | ----------: |
| transaction: begin; select 1; commit             | **23,598 ±4%** | 16,075 ±12% | 16,282 ±12% |  13,976 ±3% | 12,467 ±14% |
| transaction: begin; insert; commit               | **20,616 ±1%** |  12,952 ±3% |  15,240 ±1% | 13,150 ±12% | 10,909 ±13% |
| transaction with 5 savepoints (select 1 in each) |  **4,165 ±7%** |   2,838 ±4% |   2,817 ±4% |   3,409 ±2% |   1,962 ±3% |

**Bun 1.4: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | postgres.js |  Bun.sql |
| ------------------------------------------------------ | ---------: | ------: | ---------: | ----------: | -------: |
| select 1                                               |   **10.4** |    12.5 |       13.4 |        13.7 |     13.6 |
| point lookup by primary key                            |   **11.3** |    19.7 |       17.7 |        16.7 |     16.4 |
| fetch 1k rows (6 columns)                              |    **241** |     925 |        935 |         812 |      345 |
| fetch 100k rows                                        | **27,108** | 107,176 |     97,923 |      88,771 |   37,055 |
| insert one row                                         |   **11.8** |    16.5 |       14.1 |        15.9 |     16.7 |
| insert one row, concurrency 50                         |    **3.8** |    10.6 |       10.6 |        15.9 |      7.2 |
| transaction: begin; insert; commit                     |   **26.7** |    42.3 |       39.5 |        47.4 |     44.8 |
| query that fails (division by zero), connection reused |       22.6 |     439 |        423 |        30.4 | **18.3** |

**Bun 1.4: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | Bun.sql |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | ------: |
| select 1                             |  **9.6** | 11.9 |        9.8 |        11.8 |    12.8 |
| point lookup by primary key          | **13.4** | 26.7 |       14.4 |        14.4 |    16.2 |
| fetch 1k rows (6 columns)            |  **243** |  361 |        351 |         369 |     350 |
| 100 parameters (id in (…)), 100 rows |  **181** |  234 |        182 |         182 |     183 |
| insert one row                       |     14.7 | 23.6 |   **14.3** |        14.4 |    16.9 |
| insert one row, concurrency 50       | **11.9** | 31.9 |       17.7 |        14.3 |    13.2 |
| transaction: begin; insert; commit   | **24.7** | 41.7 |       31.2 |        31.9 |    43.1 |

**Bun 1.4: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |    quarry |      pg | pg (named) | postgres.js | Bun.sql |
| -------------------------------------------------- | --------: | ------: | ---------: | ----------: | ------: |
| point lookup by primary key: p99                   |   **0.1** |     0.1 |        0.4 |         0.2 |     0.1 |
| point lookup by primary key: max                   |   **0.1** |     0.1 |        0.4 |         0.2 |     0.1 |
| insert one row, concurrency 50: p99                |       0.5 | **0.4** |        0.5 |         0.9 |     0.9 |
| insert one row, concurrency 50: max                |       0.5 | **0.4** |        0.5 |         0.9 |     0.9 |
| fetch 1k rows (6 columns): p99                     |       0.4 |     0.9 |        1.0 |         1.0 | **0.3** |
| fetch 1k rows (6 columns): max                     |       0.4 |     0.9 |        1.0 |         1.0 | **0.3** |
| fetch 100k rows: p99                               |      10.4 |    99.6 |       86.2 |        73.0 | **8.2** |
| fetch 100k rows: max                               |  **11.5** |    99.6 |       86.2 |        73.0 |    13.9 |
| fetch 1M rows (one result): p99                    | **370.7** |   909.9 |      934.8 |       958.1 |   379.3 |
| fetch 1M rows (one result): max                    | **370.7** |   909.9 |      934.8 |       958.1 |   379.3 |
| stream 1M rows with a cursor (1000 per batch): p99 |   **0.4** |     1.0 |        1.0 |         0.8 |     n/a |
| stream 1M rows with a cursor (1000 per batch): max |   **0.8** |     1.4 |        1.7 |         1.2 |     n/a |

**Bun 1.4: connections (median time per operation)**

| Scenario                                                    |           quarry |           pg |   pg (named) |  postgres.js |         Bun.sql |
| ----------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | --------------: |
| connect + select 1 + close (no TLS, trust)                  |  **2.29 ms ±3%** |  3.80 ms ±5% |  3.75 ms ±7% |  6.47 ms ±9% |    2.33 ms ±10% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | **2.47 ms ±15%** |  4.72 ms ±3% |  4.73 ms ±9% |  7.27 ms ±8% |    2.90 ms ±12% |
| connect + select 1 + close (TLS verify-full, trust)         |     4.50 ms ±10% | 4.11 ms ±17% | 4.13 ms ±17% |  7.04 ms ±3% | **3.54 ms ±2%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |      4.55 ms ±5% |  5.46 ms ±3% |  5.46 ms ±3% |  7.85 ms ±5% | **4.01 ms ±3%** |
| pool warm-up: new pool (max 10), 10 concurrent select 1     |      7.76 ms ±4% |  8.75 ms ±7% |  8.47 ms ±4% | 14.34 ms ±3% | **7.70 ms ±9%** |

**Bun 1.4: cancellation, notifications, errors**

| Scenario                                      |      quarry |          pg | pg (named) | postgres.js |       Bun.sql |
| --------------------------------------------- | ----------: | ----------: | ---------: | ----------: | ------------: |
| cancel: time from cancel() to rejection (p50) |     1.43 ms | **1.40 ms** |    1.41 ms |     1.43 ms |       2974 ms |
| cancel: share of queries actually cancelled   |    **100%** |    **100%** |   **100%** |    **100%** |            0% |
| NOTIFY latency p50                            | **27.8 µs** |     35.4 µs |    30.9 µs |     31.6 µs |       33.1 µs |
| NOTIFY latency p99                            | **43.6 µs** |     56.5 µs |    47.8 µs |     48.5 µs |       44.4 µs |
| NOTIFY throughput (notifications/s)           |   2,414,452 |   1,962,205 |  2,049,952 |   1,664,766 | **2,577,619** |
| error path: failing queries/s                 |      31,441 |         435 |        433 |      24,795 |    **33,300** |

**Bun 1.4: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |                Bun.sql |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: | ---------------------: |
| select 1                                | 50,769 / 37,924 / +34% |  43,828 / 41,504 / +6% |   39,027 / 39,425 / -1% |  37,361 / 38,923 / -4% |
| point lookup by primary key             | 40,675 / 21,995 / +85% | 33,260 / 23,588 / +41% | 33,525 / 15,780 / +112% | 34,525 / 22,890 / +51% |
| range scan, 100 rows                    |  12,506 / 8,131 / +54% |    6,992 / 6,503 / +8% |    7,185 / 5,783 / +24% |  10,590 / 9,395 / +13% |
| fetch 1k rows (6 columns)               |  3,597 / 1,772 / +103% |    1,024 / 1,060 / -3% |     1,159 / 1,205 / -4% |    2,516 / 2,449 / +3% |
| 100 parameters (id in (…)), 100 rows    |   4,703 / 3,561 / +32% |   4,313 / 3,403 / +27% |    4,155 / 3,038 / +37% |   4,593 / 3,521 / +30% |
| 1000 parameters (id in (…)), 1000 rows  |       534 / 423 / +26% |       489 / 408 / +20% |        498 / 391 / +27% |       542 / 460 / +18% |
| insert one row                          | 39,118 / 27,776 / +41% | 36,433 / 26,883 / +36% | 34,045 / 16,892 / +102% | 33,700 / 25,103 / +34% |
| upsert (insert … on conflict do update) | 33,747 / 25,034 / +35% | 30,688 / 24,066 / +28% |  30,203 / 15,904 / +90% | 29,517 / 22,127 / +33% |

**Bun 1.4: quarry decoding modes (time per op)**

| Scenario                                |           quarry | quarry (lossless) |
| --------------------------------------- | ---------------: | ----------------: |
| point lookup by primary key             |     24.2 µs ±13% |   **24.2 µs ±3%** |
| fetch 1k rows (6 columns)               |  **263 µs ±13%** |        335 µs ±2% |
| fetch 100k rows                         | **23.57 ms ±2%** |     30.43 ms ±13% |
| fetch 1M rows (one result)              |  **240 ms ±16%** |        272 ms ±8% |
| wide rows: 1k rows × 100 columns        |  **2.69 ms ±9%** |      3.32 ms ±14% |
| arrays: 1k rows of int4[100] + text[20] |      3.31 ms ±7% |  **3.27 ms ±16%** |
| decode 100k × int8                      |      9.12 ms ±1% |  **8.13 ms ±14%** |
| decode 100k × timestamptz               | **8.95 ms ±15%** |     16.38 ms ±15% |
| decode 100k × date                      | **10.93 ms ±3%** |      11.10 ms ±4% |

## Deno 2.9

**Deno 2.9: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | -----------------------: |
| select 1                                                      | **22.8 µs ±14%** |  29.8 µs ±3% |  29.6 µs ±1% | 31.4 µs ±15% |              36.3 µs ±1% |
| point lookup by primary key                                   |  **27.9 µs ±5%** |  49.8 µs ±7% |  39.2 µs ±4% | 36.1 µs ±13% |              70.0 µs ±7% |
| range scan, 100 rows                                          |  **89.8 µs ±9%** |   199 µs ±3% |  195 µs ±18% |   161 µs ±2% |               940 µs ±4% |
| fetch 1k rows (6 columns)                                     |   **318 µs ±2%** | 1.45 ms ±12% |  1.38 ms ±5% |   981 µs ±3% |             6.99 ms ±22% |
| 100 parameters (id in (…)), 100 rows                          |   **221 µs ±4%** |   332 µs ±1% |  279 µs ±16% |   276 µs ±1% |               735 µs ±4% |
| 1000 parameters (id in (…)), 1000 rows                        |  **1.95 ms ±4%** | 2.69 ms ±11% | 2.21 ms ±14% |  2.32 ms ±9% |             6.48 ms ±15% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |  **1.73 ms ±2%** | 2.12 ms ±13% |  1.93 ms ±2% |  1.93 ms ±9% |             5.30 ms ±21% |
| insert one row                                                | **27.3 µs ±14%** | 42.7 µs ±17% | 34.2 µs ±13% | 37.5 µs ±18% |             55.2 µs ±19% |
| multi-row insert: 100 rows, 300 parameters                    |  **194 µs ±15%** |  413 µs ±14% |  263 µs ±10% |   375 µs ±2% |               416 µs ±2% |
| update one row by primary key                                 | **33.1 µs ±17%** |  49.7 µs ±3% |  38.9 µs ±3% |  40.5 µs ±1% |             63.0 µs ±15% |
| upsert (insert … on conflict do update)                       |  **32.1 µs ±7%** | 52.8 µs ±10% |  38.7 µs ±2% |  40.9 µs ±3% |              60.3 µs ±1% |
| delete one row by primary key                                 | **26.6 µs ±14%** | 42.7 µs ±16% |  32.9 µs ±1% |  34.2 µs ±4% |              54.1 µs ±9% |
| transaction: begin; select 1; commit                          | **50.1 µs ±15%** |  75.1 µs ±2% | 77.9 µs ±26% |  88.9 µs ±1% |              94.0 µs ±8% |
| transaction: begin; insert; commit                            |  **55.4 µs ±6%** | 90.8 µs ±15% |  80.6 µs ±2% |  97.5 µs ±9% |               112 µs ±3% |
| transaction with 5 savepoints (select 1 in each)              |   **281 µs ±3%** |   415 µs ±9% |   428 µs ±4% |   366 µs ±3% |              539 µs ±18% |
| query that fails (division by zero), connection reused        |  **33.3 µs ±4%** |  2.27 ms ±1% |  2.37 ms ±4% |  98.2 µs ±1% |              42.0 µs ±5% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **32.8 µs ±1%** |  45.5 µs ±3% |  41.6 µs ±4% |  43.5 µs ±8% |                      n/a |

**Deno 2.9: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ----------: | -----------------------: |
| select 1                                                      | **41,573 ±12%** |  31,229 ±4% |  31,616 ±3% | 29,063 ±14% |               25,128 ±2% |
| point lookup by primary key                                   |  **34,045 ±7%** |  18,886 ±7% |  23,419 ±5% | 25,182 ±13% |               13,107 ±9% |
| range scan, 100 rows                                          |  **10,551 ±9%** |   4,885 ±4% |  4,958 ±19% |   5,531 ±3% |                1,012 ±4% |
| fetch 1k rows (6 columns)                                     |   **3,021 ±5%** |    691 ±10% |     727 ±6% |     867 ±2% |                 124 ±14% |
| 100 parameters (id in (…)), 100 rows                          |   **4,462 ±6%** |   2,909 ±2% |  3,449 ±14% |   3,423 ±7% |                1,182 ±4% |
| 1000 parameters (id in (…)), 1000 rows                        |     **509 ±4%** |    366 ±10% |    445 ±14% |     409 ±8% |                 156 ±13% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     **575 ±6%** |    465 ±12% |     511 ±2% |     494 ±7% |                 186 ±15% |
| insert one row                                                | **34,662 ±12%** | 21,874 ±17% | 26,888 ±12% | 24,544 ±16% |              16,758 ±15% |
| multi-row insert: 100 rows, 300 parameters                    |  **4,888 ±12%** |  2,358 ±16% |  3,636 ±11% |   2,570 ±3% |                1,889 ±1% |
| update one row by primary key                                 | **28,462 ±13%** |  19,130 ±3% |  24,032 ±3% |  23,095 ±8% |              14,881 ±12% |
| upsert (insert … on conflict do update)                       |  **29,807 ±7%** | 18,063 ±10% |  24,052 ±2% |  22,972 ±3% |               15,402 ±3% |
| delete one row by primary key                                 | **35,240 ±12%** | 21,689 ±11% |  28,231 ±4% |  26,972 ±2% |               17,248 ±9% |
| transaction: begin; select 1; commit                          | **18,669 ±12%** |  12,502 ±4% | 12,022 ±22% |  10,418 ±5% |                9,911 ±7% |
| transaction: begin; insert; commit                            |  **17,078 ±9%** | 10,398 ±13% |  11,631 ±6% |   8,961 ±9% |                8,309 ±3% |
| transaction with 5 savepoints (select 1 in each)              |   **3,396 ±3%** |   2,250 ±7% |   2,209 ±3% |   2,531 ±6% |               1,745 ±13% |
| query that fails (division by zero), connection reused        |  **28,199 ±5%** |     432 ±1% |     412 ±5% |   9,356 ±1% |               21,364 ±5% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **29,118 ±2%** |  20,555 ±3% |  22,606 ±4% |  21,255 ±7% |                      n/a |

**Deno 2.9: tail latency p99, sequential**

| Scenario                                                      |      quarry |         pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ---------: | ---------: | ----------: | -----------------------: |
| select 1                                                      | **34.8 µs** |    60.0 µs |    57.8 µs |     55.8 µs |                   105 µs |
| point lookup by primary key                                   | **40.9 µs** |    87.9 µs |    75.3 µs |     58.6 µs |                   164 µs |
| range scan, 100 rows                                          |  **148 µs** |     268 µs |     270 µs |      347 µs |                  1.93 ms |
| fetch 1k rows (6 columns)                                     |  **522 µs** |    2.07 ms |    1.92 ms |     5.02 ms |                 14.01 ms |
| 100 parameters (id in (…)), 100 rows                          |  **285 µs** |     548 µs |     419 µs |      396 µs |                  1.83 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **2.22 ms** |    3.14 ms |    2.71 ms |     4.97 ms |                 10.55 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **1.99 ms** |    2.50 ms |    2.21 ms |     4.23 ms |                  8.78 ms |
| insert one row                                                | **43.5 µs** |    79.7 µs |    70.4 µs |     66.6 µs |                   143 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **306 µs** |     659 µs |     390 µs |      688 µs |                  2.16 ms |
| update one row by primary key                                 | **54.9 µs** |    81.1 µs |    69.8 µs |     62.6 µs |                   152 µs |
| upsert (insert … on conflict do update)                       | **43.8 µs** |    91.1 µs |    70.6 µs |     60.9 µs |                   155 µs |
| delete one row by primary key                                 | **42.6 µs** |    85.2 µs |    62.6 µs |     53.5 µs |                   135 µs |
| transaction: begin; select 1; commit                          |      107 µs | **106 µs** |     112 µs |      137 µs |                   205 µs |
| transaction: begin; insert; commit                            |  **115 µs** |     131 µs |     120 µs |      171 µs |                   232 µs |
| transaction with 5 savepoints (select 1 in each)              |  **419 µs** |     651 µs |     609 µs |      882 µs |                   928 µs |
| query that fails (division by zero), connection reused        | **49.1 µs** |    2.93 ms |    3.06 ms |      157 µs |                   108 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler | **61.9 µs** |     105 µs |    97.8 µs |     83.9 µs |                      n/a |

**Deno 2.9: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | ----------: | -----------------------: |
| select 1                                                      |  **105 µs** |  152 µs |     133 µs |      340 µs |                   220 µs |
| point lookup by primary key                                   |      212 µs |  289 µs | **212 µs** |      499 µs |                   365 µs |
| range scan, 100 rows                                          |  **340 µs** |  510 µs |     553 µs |     3.84 ms |                  5.05 ms |
| fetch 1k rows (6 columns)                                     |  **869 µs** | 4.44 ms |    4.20 ms |     7.38 ms |                 15.13 ms |
| 100 parameters (id in (…)), 100 rows                          |  **460 µs** |  947 µs |     784 µs |     2.82 ms |                  3.88 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **2.31 ms** | 3.72 ms |    4.02 ms |     7.95 ms |                 11.54 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.37 ms** | 4.07 ms |    3.94 ms |     7.09 ms |                 10.23 ms |
| insert one row                                                |  **199 µs** |  312 µs |     281 µs |      429 µs |                   315 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **474 µs** |  869 µs |     665 µs |     1.68 ms |                  2.71 ms |
| update one row by primary key                                 |      196 µs |  198 µs | **191 µs** |      404 µs |                   356 µs |
| upsert (insert … on conflict do update)                       |  **216 µs** |  347 µs |     227 µs |      411 µs |                   305 µs |
| delete one row by primary key                                 |  **159 µs** |  347 µs |     170 µs |      351 µs |                   229 µs |
| transaction: begin; select 1; commit                          |  **260 µs** |  682 µs |     822 µs |     1.88 ms |                   428 µs |
| transaction: begin; insert; commit                            |  **231 µs** |  949 µs |     772 µs |     1.97 ms |                   572 µs |
| transaction with 5 savepoints (select 1 in each)              |  **698 µs** | 4.17 ms |    3.78 ms |     4.45 ms |                  4.01 ms |
| query that fails (division by zero), connection reused        |  **114 µs** | 3.12 ms |    3.15 ms |      654 µs |                   304 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **278 µs** |  413 µs |     293 µs |      619 µs |                      n/a |

**Deno 2.9: latency distribution, select 1**

| Percentile |           quarry |           pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | ---------------: | -----------: | -----------: | -----------: | -----------------------: |
| p50        | **22.8 µs ±14%** |  29.8 µs ±3% |  29.6 µs ±1% | 31.4 µs ±15% |              36.3 µs ±1% |
| p90        | **25.5 µs ±12%** |  34.3 µs ±6% |  33.9 µs ±4% | 34.7 µs ±20% |              41.5 µs ±7% |
| p99        | **34.8 µs ±14%** | 60.0 µs ±10% |  57.8 µs ±8% | 55.8 µs ±20% |               105 µs ±3% |
| p99.9      |   **105 µs ±9%** |  152 µs ±94% | 133 µs ±132% |  340 µs ±39% |              220 µs ±18% |
| max        | **630 µs ±251%** | 2.63 ms ±81% | 3.06 ms ±96% | 6.39 ms ±34% |             2.63 ms ±15% |

**Deno 2.9: latency distribution, point lookup by primary key**

| Percentile |            quarry |           pg |      pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | ----------------: | -----------: | --------------: | -----------: | -----------------------: |
| p50        |   **27.9 µs ±5%** |  49.8 µs ±7% |     39.2 µs ±4% | 36.1 µs ±13% |              70.0 µs ±7% |
| p90        |  **30.1 µs ±10%** | 55.3 µs ±17% |     44.9 µs ±4% | 41.4 µs ±25% |             81.1 µs ±23% |
| p99        | **40.9 µs ±163%** | 87.9 µs ±11% |     75.3 µs ±2% | 58.6 µs ±26% |              164 µs ±11% |
| p99.9      |       212 µs ±63% |  289 µs ±45% | **212 µs ±53%** |  499 µs ±28% |              365 µs ±31% |
| max        |  **2.20 ms ±33%** | 3.09 ms ±21% |    3.01 ms ±37% | 4.60 ms ±29% |             2.86 ms ±50% |

**Deno 2.9: large results and bulk work, time per operation (median)**

| Scenario                                                                    |            quarry |               pg |    pg (named) |   postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ----------------: | ---------------: | ------------: | ------------: | -----------------------: |
| fetch 100k rows                                                             |  **37.65 ms ±7%** |       125 ms ±2% |    132 ms ±6% |  95.77 ms ±9% |               795 ms ±3% |
| fetch 1M rows (one result)                                                  |   **391 ms ±18%** |      1324 ms ±7% |   1306 ms ±3% |   1029 ms ±6% |              8652 ms ±5% |
| wide rows: 1k rows × 100 columns                                            |   **3.39 ms ±1%** |    15.85 ms ±17% |  15.76 ms ±6% | 16.03 ms ±14% |            82.00 ms ±13% |
| large values: 10 × 1 MB text                                                |       9.09 ms ±6% |     9.73 ms ±13% |  9.23 ms ±17% |  10.51 ms ±9% |         **6.24 ms ±17%** |
| large values: 10 × 1 MB bytea                                               |   **3.40 ms ±4%** |    19.34 ms ±13% | 19.59 ms ±26% |  17.94 ms ±5% |               383 ms ±4% |
| large values: 20 × 200 KB jsonb                                             |      20.28 ms ±4% |    19.92 ms ±10% | 21.78 ms ±13% | 21.12 ms ±27% |        **17.88 ms ±<1%** |
| arrays: 1k rows of int4[100] + text[20]                                     |   **3.25 ms ±2%** |     25.07 ms ±1% | 24.98 ms ±11% |  9.06 ms ±13% |             31.21 ms ±7% |
| bulk insert 10k rows (unnest arrays)                                        |  **12.60 ms ±1%** |     12.67 ms ±4% |  12.61 ms ±3% |  12.66 ms ±3% |             12.62 ms ±2% |
| bulk insert 10k rows (unnest, JS array parameters)                          | **13.43 ms ±14%** |     15.09 ms ±8% |  14.99 ms ±8% |  14.99 ms ±4% |             15.31 ms ±6% |
| bulk insert 1k rows (unnest, JS array parameters)                           |   **1.52 ms ±3%** |     1.79 ms ±13% |   1.68 ms ±8% |   1.76 ms ±2% |             1.73 ms ±14% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     12.51 ms ±15% | **12.43 ms ±1%** |  12.50 ms ±1% |  55.92 ms ±1% |                      n/a |
| stream 1M rows with a cursor (1000 per batch)                               |    **294 ms ±2%** |      1311 ms ±6% |  1371 ms ±10% |   1162 ms ±9% |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |    **634 ms ±2%** |       885 ms ±6% |    909 ms ±3% |    840 ms ±4% |                      n/a |

**Deno 2.9: rows per second (median)**

| Scenario                                           |        quarry |          pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | ------------: | ----------: | ----------: | ----------: | -----------------------: |
| fetch 1k rows (6 columns)                          | **3,020,641** |     690,505 |     726,709 |     867,364 |                  123,507 |
| fetch 100k rows                                    | **2,688,022** |     778,114 |     741,111 |   1,029,685 |                  125,725 |
| fetch 1M rows (one result)                         | **2,461,168** |     726,158 |     740,173 |     982,826 |                  116,948 |
| wide rows: 1k rows × 100 columns                   |   **289,046** |      62,107 |      62,222 |      61,092 |                   12,215 |
| arrays: 1k rows of int4[100] + text[20]            |   **304,039** |      38,714 |      37,898 |     100,516 |                   31,485 |
| stream 1M rows with a cursor (1000 per batch)      | **3,366,882** |     762,146 |     730,993 |     860,607 |                      n/a |
| bulk insert 10k rows (unnest arrays)               |       791,909 |     783,196 | **792,836** |     787,121 |                  787,694 |
| bulk insert 10k rows (unnest, JS array parameters) |   **742,573** |     653,227 |     660,488 |     661,257 |                  642,553 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **663,825** |     552,767 |     591,770 |     561,852 |                  579,324 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       795,046 | **806,643** |     800,769 |     178,446 |                      n/a |

**Deno 2.9: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| fetch 100k rows × 5                               |     299 |     300 |        300 |     **294** |                      359 |
| fetch 1M rows (one result) × 3                    |   1,212 |   1,405 |      1,411 |   **1,065** |                    1,466 |
| wide rows: 1k rows × 100 columns × 50             |     163 | **161** |        162 |         265 |                      232 |
| large values: 10 × 1 MB text × 20                 |     247 |     254 |    **225** |         229 |                      240 |
| large values: 10 × 1 MB bytea × 20                | **198** |     253 |        262 |         206 |                      230 |
| large values: 20 × 200 KB jsonb × 10              |     183 | **167** |        168 |         239 |                      216 |
| arrays: 1k rows of int4[100] + text[20] × 50      |     188 |     273 |        273 |         206 |                  **169** |
| stream 1M rows with a cursor (1000 per batch) × 3 |  **99** |     150 |        150 |         163 |                      n/a |

**Deno 2.9: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    |  quarry |     pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ------: | -----: | ---------: | ----------: | -----------------------: |
| point lookup by primary key                                                 |  **75** |     76 |         76 |         136 |                       79 |
| fetch 100k rows                                                             |     416 |    452 |        557 |         395 |                  **357** |
| fetch 1M rows (one result)                                                  |   1,784 |  1,410 |      1,411 |   **1,066** |                    1,463 |
| stream 1M rows with a cursor (1000 per batch)                               |  **99** |    150 |        150 |         163 |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |      99 | **97** |        100 |         152 |                      n/a |
| large values: 10 × 1 MB text                                                |     258 |    286 |        287 |     **252** |                      262 |
| large values: 10 × 1 MB bytea                                               | **209** |    262 |        253 |         231 |                      227 |
| large values: 20 × 200 KB jsonb                                             |     211 |    206 |    **197** |         272 |                      217 |

**Deno 2.9: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  | quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ----------------------- | -----: | ------: | ---------: | ----------: | -----------------------: |
| RSS growth during pause |    0.2 | **0.1** |        0.1 |         0.2 |                      n/a |

**Deno 2.9: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry |         pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------- | -----------: | ---------: | ---------: | ----------: | -----------------------: |
| int4                 |  **77 ±17%** |    252 ±3% |    248 ±4% |    237 ±17% |                3,713 ±5% |
| int8                 |   **94 ±7%** |    262 ±1% |    256 ±3% |    208 ±16% |               4,272 ±15% |
| float8               |   **81 ±6%** |    255 ±1% |   257 ±11% |     274 ±4% |               3,570 ±16% |
| numeric              |  **136 ±8%** |   206 ±12% |    218 ±3% |    217 ±10% |               3,687 ±11% |
| text                 |   **98 ±2%** |    228 ±5% |   226 ±11% |     228 ±5% |                3,614 ±5% |
| bool                 |   **82 ±1%** |   190 ±15% |   191 ±18% |     187 ±2% |               3,595 ±12% |
| timestamptz          |  **132 ±2%** |    697 ±5% |    703 ±3% |     450 ±2% |                4,669 ±3% |
| date                 |  **111 ±1%** |    509 ±3% |    530 ±5% |     371 ±7% |                3,833 ±6% |
| uuid                 | **127 ±12%** |   231 ±16% |    222 ±9% |    230 ±18% |               3,593 ±21% |
| jsonb (small object) | **325 ±16%** |    461 ±1% |    474 ±5% |     482 ±6% |               4,258 ±15% |
| int4[5]              |  **259 ±2%** | 1,127 ±25% |  1,150 ±8% |     586 ±2% |                4,885 ±1% |
| bytea (16 B)         |  **356 ±4%** |   398 ±11% |   401 ±13% |     399 ±7% |               5,285 ±18% |

**Deno 2.9: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |          quarry |           pg |   pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | --------------: | -----------: | -----------: | ----------: | -----------------------: |
| insert one row                                     | **34,662 ±12%** |  21,874 ±17% |  26,888 ±12% | 24,544 ±16% |              16,758 ±15% |
| insert one row, concurrency 50                     | **225,728 ±5%** |  72,279 ±12% |   64,996 ±4% | 56,644 ±16% |               22,010 ±5% |
| multi-row insert: 100 rows, 300 parameters         |  **4,888 ±12%** |   2,358 ±16% |   3,636 ±11% |   2,570 ±3% |                1,889 ±1% |
| bulk insert 10k rows (unnest arrays)               |        79.2 ±3% |     78.3 ±4% | **79.3 ±5%** |    78.7 ±3% |                 78.8 ±3% |
| bulk insert 10k rows (unnest, JS array parameters) |   **74.3 ±13%** |     65.3 ±8% |     66.0 ±7% |    66.1 ±5% |                 64.3 ±7% |
| bulk insert 1k rows (unnest, JS array parameters)  |     **664 ±4%** |     553 ±11% |     592 ±12% |     562 ±1% |                 579 ±12% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       79.5 ±13% | **80.7 ±2%** |     80.1 ±2% |    17.8 ±2% |                      n/a |
| update one row by primary key                      | **28,462 ±13%** |   19,130 ±3% |   24,032 ±3% |  23,095 ±8% |              14,881 ±12% |
| upsert (insert … on conflict do update)            |  **29,807 ±7%** |  18,063 ±10% |   24,052 ±2% |  22,972 ±3% |               15,402 ±3% |
| delete one row by primary key                      | **35,240 ±12%** |  21,689 ±11% |   28,231 ±4% |  26,972 ±2% |               17,248 ±9% |

**Deno 2.9: transactions, operations/s**

| Scenario                                         |          quarry |          pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------ | --------------: | ----------: | ----------: | ----------: | -----------------------: |
| transaction: begin; select 1; commit             | **18,669 ±12%** |  12,502 ±4% | 12,022 ±22% |  10,418 ±5% |                9,911 ±7% |
| transaction: begin; insert; commit               |  **17,078 ±9%** | 10,398 ±13% |  11,631 ±6% |   8,961 ±9% |                8,309 ±3% |
| transaction with 5 savepoints (select 1 in each) |   **3,396 ±3%** |   2,250 ±7% |   2,209 ±3% |   2,531 ±6% |               1,745 ±13% |

**Deno 2.9: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | ----------: | -----------------------: |
| select 1                                               |   **15.8** |    22.3 |       24.6 |        27.9 |                     33.8 |
| point lookup by primary key                            |   **17.5** |    30.6 |       31.7 |        30.9 |                     70.4 |
| fetch 1k rows (6 columns)                              |    **310** |   1,321 |      1,296 |       1,221 |                    8,954 |
| fetch 100k rows                                        | **53,674** | 158,206 |    169,106 |     121,090 |                  944,257 |
| insert one row                                         |   **15.9** |    24.4 |       25.1 |        32.4 |                     53.7 |
| insert one row, concurrency 50                         |    **4.5** |    14.9 |       16.5 |        21.3 |                     50.7 |
| transaction: begin; insert; commit                     |   **39.1** |    62.6 |       63.4 |        98.2 |                      101 |
| query that fails (division by zero), connection reused |   **26.8** |     492 |        523 |         104 |                     41.3 |

**Deno 2.9: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | -----------------------: |
| select 1                             |     10.0 | 12.3 |    **9.8** |        12.0 |                     12.2 |
| point lookup by primary key          | **13.8** | 26.2 |       14.6 |        14.1 |                     33.5 |
| fetch 1k rows (6 columns)            |  **238** |  434 |        385 |         394 |                      476 |
| 100 parameters (id in (…)), 100 rows |  **178** |  234 |        184 |         184 |                      279 |
| insert one row                       |     14.4 | 25.1 |       14.5 |    **14.3** |                     31.5 |
| insert one row, concurrency 50       | **12.7** | 31.5 |       17.7 |        14.9 |                     53.7 |
| transaction: begin; insert; commit   | **24.7** | 41.1 |       31.8 |        32.4 |                     50.5 |

**Deno 2.9: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |  quarry |   pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | ------: | ---: | ---------: | ----------: | -----------------------: |
| point lookup by primary key: p99                   | **0.2** |  1.1 |        1.0 |         1.3 |                      0.7 |
| point lookup by primary key: max                   | **0.2** |  1.1 |        1.0 |         1.3 |                      0.7 |
| insert one row, concurrency 50: p99                |     1.1 |  0.7 |    **0.5** |         2.2 |                      1.8 |
| insert one row, concurrency 50: max                |     1.1 |  0.7 |    **0.5** |         2.2 |                      1.8 |
| fetch 1k rows (6 columns): p99                     | **0.7** |  2.0 |        1.9 |         3.3 |                      3.6 |
| fetch 1k rows (6 columns): max                     | **0.7** |  2.0 |        1.9 |         3.3 |                      3.6 |
| fetch 100k rows: p99                               |    13.6 | 43.6 |       49.3 |        20.9 |                  **4.6** |
| fetch 100k rows: max                               |    13.6 | 43.6 |       49.3 |        23.8 |                  **7.3** |
| fetch 1M rows (one result): p99                    |    17.1 | 41.1 |       35.1 |        24.2 |                  **4.3** |
| fetch 1M rows (one result): max                    |    24.6 | 65.7 |       64.1 |        34.1 |                  **9.9** |
| stream 1M rows with a cursor (1000 per batch): p99 | **0.6** |  1.5 |        1.5 |         4.6 |                      n/a |
| stream 1M rows with a cursor (1000 per batch): max | **1.0** |  1.6 |        1.5 |         5.5 |                      n/a |

**Deno 2.9: connections (median time per operation)**

| Scenario                                                    |           quarry |          pg |   pg (named) |  postgres.js | deno-postgres (stock) | deno-postgres (+nodelay) |
| ----------------------------------------------------------- | ---------------: | ----------: | -----------: | -----------: | --------------------: | -----------------------: |
| connect + select 1 + close (no TLS, trust)                  | **2.25 ms ±13%** | 3.97 ms ±4% |  3.96 ms ±7% |  7.86 ms ±2% |           2.34 ms ±1% |              2.39 ms ±3% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          |  **2.53 ms ±7%** | 5.09 ms ±5% |  5.23 ms ±3% |  9.54 ms ±4% |                     — |             3.84 ms ±10% |
| connect + select 1 + close (TLS verify-full, trust)         |     4.51 ms ±17% | 4.40 ms ±1% |  4.46 ms ±3% | 52.85 ms ±1% |                     — |          **3.94 ms ±3%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) | **4.78 ms ±21%** | 5.88 ms ±4% | 5.82 ms ±11% | 55.24 ms ±5% |                     — |             5.30 ms ±15% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     |  **7.78 ms ±9%** | 8.39 ms ±3% | 8.46 ms ±11% | 15.87 ms ±1% |                     — |              8.29 ms ±4% |

**Deno 2.9: cancellation, notifications, errors**

| Scenario                                      |        quarry |        pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------- | ------------: | --------: | ----------: | ----------: | -----------------------: |
| cancel: time from cancel() to rejection (p50) |       1.44 ms |   1.46 ms | **1.41 ms** |     1.46 ms |                      n/a |
| cancel: share of queries actually cancelled   |      **100%** |  **100%** |    **100%** |    **100%** |                      n/a |
| NOTIFY latency p50                            |   **32.8 µs** |   45.5 µs |     41.6 µs |     43.5 µs |                      n/a |
| NOTIFY latency p99                            |   **61.9 µs** |    105 µs |     97.8 µs |     83.9 µs |                      n/a |
| NOTIFY throughput (notifications/s)           | **2,590,317** | 1,874,533 |   1,842,618 |   1,795,141 |                      n/a |
| error path: failing queries/s                 |    **28,199** |       432 |         412 |       9,356 |                   21,364 |

**Deno 2.9: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 41,573 / 31,974 / +30% |  31,616 / 31,229 / +1% |   29,063 / 29,877 / -3% |
| point lookup by primary key             | 34,045 / 19,329 / +76% | 23,419 / 18,886 / +24% | 25,182 / 12,209 / +106% |
| range scan, 100 rows                    |  10,551 / 6,459 / +63% |    4,958 / 4,885 / +1% |    5,531 / 4,680 / +18% |
| fetch 1k rows (6 columns)               |  3,021 / 1,260 / +140% |        727 / 691 / +5% |         867 / 871 / -0% |
| 100 parameters (id in (…)), 100 rows    |   4,462 / 3,183 / +40% |   3,449 / 2,909 / +19% |    3,423 / 2,509 / +36% |
| 1000 parameters (id in (…)), 1000 rows  |       509 / 413 / +23% |       445 / 366 / +22% |        409 / 338 / +21% |
| insert one row                          | 34,662 / 25,104 / +38% | 26,888 / 21,874 / +23% |  24,544 / 12,744 / +93% |
| upsert (insert … on conflict do update) | 29,807 / 22,594 / +32% | 24,052 / 18,063 / +33% |  22,972 / 12,419 / +85% |

**Deno 2.9: shipped defaults vs tuned (median latency)**

| Scenario                                   | deno-postgres (+nodelay) | deno-postgres (stock) |
| ------------------------------------------ | -----------------------: | --------------------: |
| select 1                                   |              **36.3 µs** |               36.9 µs |
| point lookup by primary key                |              **70.0 µs** |              43.99 ms |
| fetch 1k rows (6 columns)                  |                  6.99 ms |           **6.99 ms** |
| insert one row                             |              **55.2 µs** |              43.99 ms |
| transaction: begin; insert; commit         |                   112 µs |                     — |
| connect + select 1 + close (no TLS, trust) |                  2.39 ms |           **2.34 ms** |

## Across runtimes

**Throughput (operations/s) by runtime**

| Scenario                           | quarry (node) | pg (node) | pg (named) (node) | pg-native (node) | postgres.js (node) | neon (WS) (node) | quarry (bun) | pg (bun) | pg (named) (bun) | postgres.js (bun) | Bun.sql (bun) | quarry (deno) | pg (deno) | pg (named) (deno) | postgres.js (deno) | deno-postgres (+nodelay) (deno) |
| ---------------------------------- | ------------: | --------: | ----------------: | ---------------: | -----------------: | ---------------: | -----------: | -------: | ---------------: | ----------------: | ------------: | ------------: | --------: | ----------------: | -----------------: | ------------------------------: |
| select 1                           |        44,909 |    35,795 |            35,337 |           30,863 |             31,565 |           19,800 |       50,769 |   41,504 |           43,828 |            39,027 |        37,361 |        41,573 |    31,229 |            31,616 |             29,063 |                          25,128 |
| point lookup by primary key        |        36,430 |    20,229 |            27,261 |           19,366 |             28,155 |           12,077 |       40,675 |   23,588 |           33,260 |            33,525 |        34,525 |        34,045 |    18,886 |            23,419 |             25,182 |                          13,107 |
| fetch 1k rows (6 columns)          |         2,984 |       768 |               798 |              621 |                926 |              666 |        3,597 |    1,060 |            1,024 |             1,159 |         2,516 |         3,021 |       691 |               727 |                867 |                             124 |
| fetch 100k rows                    |          29.0 |       8.2 |               8.3 |              6.6 |               10.6 |              7.6 |         41.9 |     10.7 |             11.4 |              12.7 |          30.1 |          26.9 |       7.8 |               7.4 |               10.3 |                             1.3 |
| insert one row                     |        35,369 |    24,636 |            30,755 |           21,420 |             28,121 |           13,087 |       39,118 |   26,883 |           36,433 |            34,045 |        33,700 |        34,662 |    21,874 |            26,888 |             24,544 |                          16,758 |
| insert one row, concurrency 50     |       260,415 |    85,598 |            84,264 |           73,499 |             41,084 |           30,018 |      261,286 |   97,044 |           98,692 |            64,057 |       148,955 |       225,728 |    72,279 |            64,996 |             56,644 |                          22,010 |
| transaction: begin; insert; commit |        18,604 |    11,720 |            13,237 |            9,414 |             10,570 |            6,250 |       20,616 |   12,952 |           15,240 |            13,150 |        10,909 |        17,078 |    10,398 |            11,631 |              8,961 |                           8,309 |

## Concurrency sweep (Node 24): point lookups/s

**Node 24: pool size 1, point lookups/s by concurrency**

| Concurrency |          quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |      postgres.js |   neon (WS) |
| ----------- | --------------: | -----------------------: | ----------: | ----------: | ----------: | ---------------: | ----------: |
| 1           |      36,003 ±3% |           **36,258 ±3%** |  20,225 ±5% |  26,964 ±4% | 18,788 ±10% |       28,675 ±3% | 11,625 ±12% |
| 10          |    108,871 ±11% |              34,934 ±11% | 20,897 ±10% |  27,166 ±2% |  18,976 ±7% | **110,091 ±21%** |  11,763 ±8% |
| 50          |    110,167 ±19% |               35,537 ±3% | 20,861 ±12% | 27,590 ±15% |  19,424 ±7% | **120,381 ±19%** |  11,577 ±9% |
| 100         |     118,649 ±5% |               34,366 ±8% | 20,936 ±12% | 26,905 ±14% |  18,932 ±4% | **124,142 ±11%** |  12,552 ±5% |
| 500         | **122,392 ±6%** |               33,962 ±7% | 20,884 ±12% | 27,969 ±12% | 19,576 ±12% |     110,065 ±11% |  11,789 ±5% |
| 1000        | **116,338 ±9%** |              35,663 ±20% | 21,154 ±16% |  26,944 ±6% |  19,061 ±5% |     115,807 ±22% |  11,622 ±9% |

**Node 24: pool size 1, p99 latency by concurrency**

| Concurrency |       quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | -----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           |  **36.0 µs** |                  36.5 µs |  71.3 µs |    57.0 µs |   75.0 µs |     47.5 µs |    157 µs |
| 10          |   **144 µs** |                   714 µs |  1.02 ms |     826 µs |    955 µs |      158 µs |   1.63 ms |
| 50          |      1.03 ms |                  2.21 ms |  3.68 ms |    2.76 ms |   3.55 ms |  **753 µs** |   6.43 ms |
| 100         |  **1.51 ms** |                  4.00 ms |  7.81 ms |    4.94 ms |   6.65 ms |     3.93 ms |  10.27 ms |
| 500         |  **5.39 ms** |                 17.51 ms | 36.43 ms |   24.33 ms |  34.32 ms |     9.70 ms |  50.26 ms |
| 1000        | **10.57 ms** |                 35.37 ms | 58.97 ms |   43.97 ms |  58.78 ms |    15.37 ms |  97.39 ms |

**Node 24: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |  postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | -----------: | ----------: |
| 1           |  **36,473 ±12%** |               35,063 ±7% | 20,127 ±11% | 26,637 ±12% | 18,716 ±12% |  28,761 ±18% |  11,303 ±7% |
| 10          | **160,231 ±14%** |              103,230 ±9% |  67,374 ±3% | 62,678 ±14% | 55,206 ±10% |   42,766 ±8% | 27,661 ±13% |
| 50          | **374,013 ±11%** |              92,177 ±19% | 63,010 ±18% | 54,955 ±14% | 60,412 ±12% |  41,999 ±10% |  29,542 ±9% |
| 100         |  **463,480 ±9%** |              98,846 ±17% |  62,989 ±6% |  57,462 ±7% | 57,907 ±15% |   41,414 ±2% | 31,551 ±25% |
| 500         |  **451,477 ±7%** |              96,846 ±11% |  62,624 ±9% | 55,933 ±12% | 57,006 ±14% | 146,521 ±15% | 29,449 ±10% |
| 1000        |  **402,969 ±5%** |             102,440 ±12% | 64,617 ±14% |  60,667 ±2% | 52,831 ±15% |  157,047 ±8% | 27,305 ±15% |

**Node 24: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **34.8 µs** |                  40.1 µs |  72.8 µs |    57.7 µs |   76.0 µs |     48.1 µs |    162 µs |
| 10          |  **130 µs** |                   196 µs |   480 µs |     511 µs |    467 µs |      449 µs |    910 µs |
| 50          |  **367 µs** |                  1.27 ms |  1.50 ms |    1.74 ms |   1.38 ms |     2.45 ms |   2.81 ms |
| 100         | **1.11 ms** |                  2.03 ms |  2.61 ms |    2.74 ms |   2.72 ms |     5.41 ms |   5.44 ms |
| 500         | **5.07 ms** |                  7.89 ms | 12.09 ms |   13.47 ms |  10.87 ms |     9.25 ms |  22.12 ms |
| 1000        | **5.33 ms** |                 14.39 ms | 22.04 ms |   23.55 ms |  22.04 ms |    11.88 ms |  42.21 ms |

**Node 24: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |  postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | -----------: | ----------: |
| 1           |   **36,326 ±9%** |               33,916 ±4% |  20,187 ±3% |  26,744 ±4% |  18,645 ±5% |  26,345 ±14% |  10,798 ±9% |
| 10          |     113,763 ±20% |         **116,744 ±22%** | 61,964 ±10% | 58,520 ±22% |  62,118 ±5% |  68,646 ±11% |  30,297 ±9% |
| 50          | **306,706 ±10%** |               98,256 ±8% | 61,202 ±23% | 60,308 ±17% |  57,766 ±8% |  41,444 ±15% | 32,349 ±20% |
| 100         | **384,321 ±24%** |             101,850 ±12% | 61,156 ±10% |  60,398 ±5% |  61,228 ±9% |  42,676 ±13% | 29,168 ±13% |
| 500         | **495,571 ±18%** |              94,924 ±14% |  64,905 ±9% | 61,256 ±17% | 53,687 ±13% | 120,719 ±14% | 28,485 ±13% |
| 1000        |  **462,016 ±8%** |              95,496 ±12% | 64,827 ±16% |  59,702 ±4% |  57,178 ±9% | 143,063 ±13% | 32,511 ±22% |

**Node 24: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **35.3 µs** |                  40.9 µs |  69.7 µs |    56.6 µs |   73.8 µs |     55.6 µs |    189 µs |
| 10          |  **177 µs** |                   183 µs |   553 µs |     617 µs |    393 µs |      265 µs |    938 µs |
| 50          |  **431 µs** |                  1.26 ms |  1.59 ms |    1.58 ms |   1.45 ms |     2.55 ms |   2.75 ms |
| 100         | **1.03 ms** |                  2.11 ms |  2.77 ms |    2.73 ms |   2.55 ms |     5.37 ms |   5.37 ms |
| 500         | **6.97 ms** |                  7.94 ms | 12.83 ms |   13.01 ms |  13.15 ms |    12.31 ms |  23.76 ms |
| 1000        | **8.78 ms** |                 16.10 ms | 22.71 ms |   22.97 ms |  20.90 ms |    14.05 ms |  39.74 ms |

**Node 24: pool size 50, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg | pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ---------: | ----------: | ----------: | ----------: |
| 1           |       35,867 ±7% |          **35,928 ±13%** | 18,976 ±16% | 26,977 ±9% | 18,892 ±15% |  28,225 ±5% |  11,914 ±7% |
| 10          | **118,154 ±17%** |              108,578 ±9% | 66,726 ±16% | 61,445 ±2% |  58,431 ±7% |  70,073 ±9% | 32,585 ±18% |
| 50          | **112,391 ±13%** |              110,780 ±6% | 61,298 ±10% | 61,378 ±4% | 53,335 ±13% |  65,272 ±7% | 30,139 ±22% |
| 100         |  **160,976 ±4%** |             105,183 ±13% | 65,438 ±11% | 58,136 ±6% | 58,328 ±16% |  41,595 ±4% | 29,013 ±14% |
| 500         |  **360,883 ±4%** |             101,584 ±10% | 63,788 ±11% | 56,349 ±5% |  57,341 ±5% |  43,001 ±1% | 26,989 ±18% |
| 1000        |  **417,023 ±2%** |             100,313 ±18% | 62,813 ±11% | 58,846 ±9% | 57,564 ±11% |  42,976 ±8% | 30,228 ±20% |

**Node 24: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           |     36.8 µs |              **36.1 µs** |  81.9 µs |    57.0 µs |   74.4 µs |     51.4 µs |    153 µs |
| 10          |  **182 µs** |                   201 µs |   571 µs |     462 µs |    410 µs |      264 µs |    918 µs |
| 50          |     1.18 ms |              **1.17 ms** |  1.87 ms |    1.65 ms |   1.62 ms |     1.64 ms |   3.50 ms |
| 100         | **1.64 ms** |                  1.95 ms |  2.88 ms |    2.95 ms |   2.69 ms |     6.47 ms |   6.34 ms |
| 500         | **2.78 ms** |                  8.13 ms | 11.58 ms |   12.80 ms |  11.48 ms |    24.21 ms |  23.96 ms |
| 1000        | **4.61 ms** |                 14.20 ms | 22.87 ms |   24.25 ms |  20.49 ms |    49.82 ms |  39.75 ms |

## Concurrency sweep (Bun 1.4): point lookups/s

**Bun 1.4: pool size 1, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |     postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | --------------: | ----------: |
| 1           |   **40,117 ±6%** |  23,789 ±9% |     33,905 ±15% |  34,593 ±3% |
| 10          |      113,862 ±6% |  23,745 ±4% | **116,963 ±8%** | 85,432 ±10% |
| 50          |     110,040 ±10% |  23,935 ±5% | **119,449 ±6%** | 83,290 ±10% |
| 100         | **121,700 ±14%** | 23,075 ±13% |    119,698 ±17% | 83,925 ±12% |
| 500         |  **118,960 ±8%** | 21,925 ±17% |     108,080 ±9% |  92,581 ±5% |
| 1000        |  **120,789 ±5%** | 23,865 ±18% |     110,907 ±5% |  93,463 ±5% |

**Bun 1.4: pool size 1, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |  Bun.sql |
| ----------- | ----------: | -------: | ----------: | -------: |
| 1           | **31.0 µs** |  52.6 µs |     40.6 µs |  35.9 µs |
| 10          |  **110 µs** |   775 µs |      131 µs |   160 µs |
| 50          |  **559 µs** |  3.01 ms |      959 µs |  1.28 ms |
| 100         |  **979 µs** |  5.55 ms |     1.55 ms |  1.86 ms |
| 500         | **5.03 ms** | 31.07 ms |     6.13 ms |  6.49 ms |
| 1000        | **9.29 ms** | 43.99 ms |    10.70 ms | 12.07 ms |

**Bun 1.4: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |  postgres.js |      Bun.sql |
| ----------- | ---------------: | ----------: | -----------: | -----------: |
| 1           |   **40,113 ±5%** |  23,550 ±4% |   34,398 ±2% |  34,012 ±15% |
| 10          |  **183,087 ±8%** | 84,946 ±11% |   63,956 ±2% |  113,785 ±9% |
| 50          |  **462,666 ±9%** |  78,168 ±7% |   64,657 ±9% | 176,309 ±13% |
| 100         |  **500,838 ±8%** |  82,764 ±3% |   66,071 ±6% |  182,004 ±8% |
| 500         |  **507,866 ±7%** | 78,915 ±12% |  213,149 ±2% |  196,917 ±6% |
| 1000        | **428,368 ±12%** | 72,912 ±11% | 209,493 ±12% | 209,464 ±10% |

**Bun 1.4: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js | Bun.sql |
| ----------- | ----------: | -------: | ----------: | ------: |
| 1           | **33.1 µs** |  54.0 µs |     39.0 µs | 37.3 µs |
| 10          | **91.2 µs** |   531 µs |      309 µs |  173 µs |
| 50          |  **455 µs** |  1.45 ms |     1.78 ms | 1.10 ms |
| 100         | **1.13 ms** |  2.11 ms |     3.23 ms | 1.72 ms |
| 500         |     5.37 ms |  8.02 ms | **4.34 ms** | 5.11 ms |
| 1000        | **6.80 ms** | 15.90 ms |     6.85 ms | 8.49 ms |

**Bun 1.4: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |  postgres.js |      Bun.sql |
| ----------- | ---------------: | ----------: | -----------: | -----------: |
| 1           |  **38,853 ±10%** |  22,636 ±5% |  32,710 ±12% |  31,541 ±11% |
| 10          | **143,580 ±12%** | 84,866 ±13% |  93,319 ±16% |  77,732 ±13% |
| 50          |  **353,763 ±9%** |  85,537 ±2% |   61,353 ±4% | 156,060 ±12% |
| 100         |  **469,204 ±2%** |  83,488 ±3% |   62,863 ±3% |  160,555 ±9% |
| 500         |  **494,696 ±8%** | 78,283 ±17% |  186,696 ±7% |  191,085 ±5% |
| 1000        |  **489,179 ±9%** |  74,547 ±8% | 193,368 ±10% |  196,746 ±7% |

**Bun 1.4: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |     Bun.sql |
| ----------- | ----------: | -------: | ----------: | ----------: |
| 1           | **33.9 µs** |  59.5 µs |     41.7 µs |     40.7 µs |
| 10          |  **125 µs** |   542 µs |      205 µs |      262 µs |
| 50          |  **326 µs** |  1.35 ms |     1.92 ms |     1.24 ms |
| 100         |  **632 µs** |  2.18 ms |     3.41 ms |     1.69 ms |
| 500         |     9.20 ms |  8.22 ms |     6.72 ms | **5.32 ms** |
| 1000        |    12.87 ms | 15.15 ms | **9.36 ms** |     9.89 ms |

**Bun 1.4: pool size 50, point lookups/s by concurrency**

| Concurrency |           quarry |          pg | postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | ----------: | ----------: |
| 1           |   **39,360 ±6%** | 23,765 ±11% |  32,393 ±9% |  33,205 ±4% |
| 10          | **145,129 ±15%** |  85,885 ±6% |  94,145 ±5% |  83,008 ±8% |
| 50          | **125,219 ±14%** | 80,748 ±10% |  79,539 ±6% | 84,457 ±19% |
| 100         | **195,161 ±17%** | 77,033 ±10% |  58,505 ±8% | 108,408 ±7% |
| 500         | **370,265 ±19%** |  73,663 ±8% |  64,746 ±3% | 147,477 ±3% |
| 1000        | **478,598 ±20%** | 74,057 ±14% |  65,197 ±9% | 160,352 ±7% |

**Bun 1.4: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |      Bun.sql |
| ----------- | ----------: | -------: | ----------: | -----------: |
| 1           | **32.3 µs** |  55.2 µs |     42.0 µs |      38.2 µs |
| 10          |  **124 µs** |   546 µs |      190 µs |       241 µs |
| 50          |  **804 µs** |  1.41 ms |     1.44 ms |      1.13 ms |
| 100         | **1.04 ms** |  2.51 ms |     3.76 ms |      1.77 ms |
| 500         | **3.03 ms** |  9.53 ms |    16.19 ms |      6.60 ms |
| 1000        |    12.74 ms | 16.32 ms |    31.55 ms | **11.81 ms** |

## Pipelining depth

**quarry, one connection, 100 concurrent point lookups: throughput by `pipeline` depth (columns: RTT ms)**

| pipeline           |               0 |          5 |
| ------------------ | --------------: | ---------: |
| 1                  |  **21,600 ±2%** |   171 ±<1% |
| 2                  |  **42,747 ±1%** |   341 ±<1% |
| 4                  |  **75,100 ±2%** |   682 ±<1% |
| 8                  | **116,119 ±6%** | 1,346 ±<1% |
| 16                 | **118,289 ±1%** | 2,660 ±<1% |
| 32                 | **120,005 ±2%** |  5,197 ±1% |
| 64                 | **121,388 ±3%** | 9,961 ±<1% |
| 100                | **123,607 ±4%** | 15,657 ±2% |
| adaptive (default) | **123,873 ±2%** | 16,063 ±4% |

## db.batch

**quarry's query builder, 3 statements per operation: operations/s (columns: RTT ms)**

| Scenario                                                                  |              0 |         5 |
| ------------------------------------------------------------------------- | -------------: | --------: |
| 3 statements (lookup, insert, update): one after another                  |  **5,160 ±4%** |  55.9 ±2% |
| 3 statements (lookup, insert, update): Promise.all                        |  **9,782 ±1%** |   166 ±1% |
| 3 statements (lookup, insert, update): db.batch                           | **10,227 ±1%** |  167 ±<1% |
| 3 statements (lookup, insert, update) in a transaction: one after another |  **4,020 ±7%** | 42.2 ±<1% |
| 3 statements (lookup, insert, update) in a transaction: Promise.all       |  **4,965 ±3%** | 56.3 ±<1% |
| 3 statements (lookup, insert, update) in a transaction: db.batch          | **9,456 ±11%** |   165 ±1% |

## Network latency (RTT through Toxiproxy)

**Node 24: select 1, sequential: median latency by RTT**

| RTT   |          quarry |            pg |    pg (named) |    pg-native |       postgres.js |     neon (WS) |
| ----- | --------------: | ------------: | ------------: | -----------: | ----------------: | ------------: |
| 0 ms  | **40.4 µs ±1%** |   44.5 µs ±2% |   44.9 µs ±5% |  51.1 µs ±3% |      47.4 µs ±11% |   63.2 µs ±1% |
| 1 ms  | **1.39 ms ±3%** |   1.40 ms ±9% |   1.42 ms ±1% |  1.43 ms ±5% |       1.41 ms ±7% |   1.46 ms ±6% |
| 5 ms  | **5.79 ms ±2%** |   5.89 ms ±2% |   5.86 ms ±3% |  5.89 ms ±1% |       5.82 ms ±4% |   5.99 ms ±1% |
| 20 ms |   20.81 ms ±<1% | 20.88 ms ±<1% | 20.86 ms ±<1% | 20.86 ms ±1% | **20.79 ms ±<1%** | 20.98 ms ±<1% |

**Node 24: point lookup, sequential: median latency by RTT**

| RTT   |            quarry |           pg |   pg (named) |     pg-native |  postgres.js |    neon (WS) |
| ----- | ----------------: | -----------: | -----------: | ------------: | -----------: | -----------: |
| 0 ms  |   **44.7 µs ±2%** |  65.4 µs ±2% |  55.5 µs ±2% |   68.3 µs ±1% |  54.0 µs ±2% |   105 µs ±7% |
| 1 ms  |   **1.42 ms ±4%** |  1.53 ms ±6% |  1.49 ms ±4% |   1.51 ms ±9% |  1.44 ms ±6% | 1.62 ms ±19% |
| 5 ms  |   **5.88 ms ±3%** |  6.00 ms ±2% |  5.92 ms ±3% |   5.98 ms ±3% |  5.92 ms ±1% |  6.06 ms ±1% |
| 20 ms | **20.84 ms ±<1%** | 20.99 ms ±1% | 20.98 ms ±1% | 21.02 ms ±<1% | 20.92 ms ±1% | 21.18 ms ±1% |

**Node 24: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |          quarry |         pg |  pg (named) |  pg-native | postgres.js |   neon (WS) |
| ----- | --------------: | ---------: | ----------: | ---------: | ----------: | ----------: |
| 0 ms  | **262,958 ±5%** | 63,991 ±9% | 65,023 ±14% | 63,089 ±2% |  42,087 ±2% | 22,603 ±17% |
| 1 ms  |  **29,524 ±4%** |  5,810 ±1% |   6,045 ±3% |  5,740 ±3% |  18,831 ±1% |   5,084 ±1% |
| 5 ms  |   **8,333 ±1%** |  1,651 ±1% |   1,672 ±2% |  1,654 ±1% |  7,022 ±14% |   1,585 ±1% |
| 20 ms |  **2,359 ±<1%** |   475 ±<1% |    476 ±<1% |   474 ±<1% |  2,005 ±10% |     468 ±1% |

**Node 24: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |          quarry |         pg | pg (named) |   pg-native | postgres.js | neon (WS) |
| ----- | --------------: | ---------: | ---------: | ----------: | ----------: | --------: |
| 0 ms  | **122,851 ±3%** | 14,797 ±6% | 17,413 ±4% | 14,010 ±11% | 110,076 ±4% | 8,825 ±5% |
| 1 ms  |  **40,661 ±3%** |    657 ±4% |    685 ±3% |    648 ±12% |  31,175 ±2% |   627 ±3% |
| 5 ms  |  **16,390 ±5%** |    168 ±1% |    170 ±2% |    168 ±<1% | 12,300 ±14% |   167 ±1% |
| 20 ms |   **4,737 ±1%** |   47.7 ±1% |  47.9 ±<1% |   47.7 ±<1% |  3,438 ±16% | 47.4 ±<1% |

**Node 24: point lookup, 500 concurrent, pool 1 (deep pipelining): operations/s by RTT**

| RTT   |          quarry |         pg | pg (named) |  pg-native | postgres.js | neon (WS) |
| ----- | --------------: | ---------: | ---------: | ---------: | ----------: | --------: |
| 0 ms  | **118,845 ±3%** | 14,960 ±5% | 17,617 ±3% | 14,237 ±6% | 103,346 ±2% | 8,749 ±2% |
| 1 ms  | **123,084 ±4%** |   659 ±12% |    678 ±3% |    657 ±8% |  24,970 ±4% |   640 ±2% |
| 5 ms  |  **88,450 ±1%** |   169 ±<1% |    171 ±1% |    169 ±1% |   7,941 ±1% |   167 ±2% |
| 20 ms |  **23,503 ±2%** |  47.8 ±<1% |   48.0 ±1% |  47.8 ±<1% |  2,340 ±<1% | 47.6 ±<1% |

**Node 24: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |            pg |    pg (named) |     pg-native |   postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | ------------: | ------------: | ------------: | ------------: |
| 0 ms  |    **336 µs ±2%** |   1.37 ms ±4% |  1.33 ms ±12% |   1.65 ms ±2% |    966 µs ±1% |   1.51 ms ±4% |
| 1 ms  |   **1.99 ms ±6%** |   3.12 ms ±2% |   3.04 ms ±2% |   3.11 ms ±4% |  2.83 ms ±12% |   3.26 ms ±2% |
| 5 ms  |   **6.30 ms ±1%** |   7.29 ms ±1% |   7.28 ms ±1% |   7.38 ms ±1% |   7.08 ms ±1% |   7.48 ms ±1% |
| 20 ms | **21.37 ms ±<1%** | 22.34 ms ±<1% | 22.38 ms ±<1% | 22.49 ms ±<1% | 22.20 ms ±<1% | 22.55 ms ±<1% |

**Node 24: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |           quarry |            pg |   pg (named) |     pg-native |  postgres.js |     neon (WS) |
| ----- | ---------------: | ------------: | -----------: | ------------: | -----------: | ------------: |
| 0 ms  |  **87.3 µs ±2%** |    140 µs ±2% |   128 µs ±5% |    158 µs ±1% |   141 µs ±3% |    210 µs ±1% |
| 1 ms  |  **2.90 ms ±2%** |   4.35 ms ±2% |  4.24 ms ±9% |   4.33 ms ±3% |  4.35 ms ±1% |   4.51 ms ±2% |
| 5 ms  | **11.78 ms ±1%** |  17.51 ms ±3% | 17.48 ms ±1% |  17.62 ms ±7% | 17.63 ms ±2% | 17.90 ms ±<1% |
| 20 ms | **41.67 ms ±1%** | 62.55 ms ±<1% | 62.56 ms ±1% | 62.61 ms ±<1% | 62.64 ms ±1% |  62.89 ms ±1% |

**Node 24: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |          quarry |          pg | pg (named) |  pg-native | postgres.js |   neon (WS) |
| ----- | --------------: | ----------: | ---------: | ---------: | ----------: | ----------: |
| 0 ms  | **236,458 ±4%** | 78,991 ±12% | 79,699 ±7% | 74,158 ±5% |  41,435 ±2% | 21,732 ±11% |
| 1 ms  |  **28,234 ±3%** |   5,965 ±3% |  6,231 ±3% |  5,912 ±2% |  18,357 ±2% |   5,133 ±2% |
| 5 ms  |   **8,214 ±2%** |   1,657 ±1% |  1,671 ±3% |  1,663 ±1% |   6,748 ±3% |   1,598 ±2% |
| 20 ms |  **2,362 ±<1%** |    474 ±<1% |    476 ±1% |    475 ±1% |   1,974 ±5% |    469 ±<1% |

**Node 24: connect + select 1 + close: median latency by RTT**

| RTT   |           quarry |              pg |    pg (named) |     pg-native |  postgres.js |    neon (WS) |
| ----- | ---------------: | --------------: | ------------: | ------------: | -----------: | -----------: |
| 0 ms  |      2.67 ms ±4% | **2.62 ms ±4%** |   2.62 ms ±2% |   4.88 ms ±4% |  5.76 ms ±4% |  4.49 ms ±3% |
| 1 ms  |  **4.98 ms ±2%** |     5.05 ms ±5% |   5.00 ms ±2% |   9.79 ms ±2% |  9.48 ms ±7% |  7.08 ms ±2% |
| 5 ms  | **13.68 ms ±1%** |    13.97 ms ±1% |  13.92 ms ±1% |  26.82 ms ±1% | 22.23 ms ±1% | 16.01 ms ±3% |
| 20 ms | **43.86 ms ±1%** |   43.98 ms ±<1% | 43.99 ms ±<1% | 87.04 ms ±<1% | 67.97 ms ±1% | 46.43 ms ±2% |

**Bun 1.4: select 1, sequential: median latency by RTT**

| RTT   |          quarry |           Bun.sql |
| ----- | --------------: | ----------------: |
| 0 ms  | **38.8 µs ±2%** |       43.0 µs ±1% |
| 1 ms  |     1.38 ms ±1% |   **1.38 ms ±2%** |
| 5 ms  |     5.82 ms ±2% |   **5.80 ms ±1%** |
| 20 ms |   20.86 ms ±<1% | **20.81 ms ±<1%** |

**Bun 1.4: point lookup, sequential: median latency by RTT**

| RTT   |          quarry |          Bun.sql |
| ----- | --------------: | ---------------: |
| 0 ms  | **42.9 µs ±1%** |      46.8 µs ±9% |
| 1 ms  |     1.40 ms ±5% |  **1.38 ms ±2%** |
| 5 ms  |     5.86 ms ±3% |  **5.83 ms ±1%** |
| 20 ms |    20.93 ms ±1% | **20.83 ms ±1%** |

**Bun 1.4: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |          quarry |      Bun.sql |
| ----- | --------------: | -----------: |
| 0 ms  | **274,201 ±5%** | 157,170 ±10% |
| 1 ms  |  **30,357 ±4%** |   28,385 ±1% |
| 5 ms  |   **8,458 ±1%** |   8,329 ±<1% |
| 20 ms |  **2,376 ±<1%** |   2,374 ±<1% |

**Bun 1.4: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |          quarry |        Bun.sql |
| ----- | --------------: | -------------: |
| 0 ms  | **123,184 ±2%** |     93,333 ±1% |
| 1 ms  |     41,787 ±10% | **82,967 ±1%** |
| 5 ms  |      16,224 ±5% | **16,361 ±1%** |
| 20 ms |   **4,737 ±2%** |      4,733 ±1% |

**Bun 1.4: point lookup, 500 concurrent, pool 1 (deep pipelining): operations/s by RTT**

| RTT   |          quarry |        Bun.sql |
| ----- | --------------: | -------------: |
| 0 ms  | **119,913 ±2%** |     93,901 ±5% |
| 1 ms  | **119,366 ±6%** |     91,843 ±6% |
| 5 ms  |      89,074 ±2% | **89,387 ±1%** |
| 20 ms |  **23,685 ±2%** |     23,263 ±1% |

**Bun 1.4: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |       Bun.sql |
| ----- | ----------------: | ------------: |
| 0 ms  |    **283 µs ±3%** |    422 µs ±2% |
| 1 ms  |   **1.90 ms ±2%** |   2.20 ms ±2% |
| 5 ms  |   **6.19 ms ±1%** |  6.49 ms ±<1% |
| 20 ms | **21.27 ms ±<1%** | 21.57 ms ±<1% |

**Bun 1.4: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |           quarry |       Bun.sql |
| ----- | ---------------: | ------------: |
| 0 ms  |  **84.8 µs ±1%** |    145 µs ±2% |
| 1 ms  |  **2.89 ms ±3%** |   4.22 ms ±2% |
| 5 ms  | **11.71 ms ±2%** |  17.29 ms ±2% |
| 20 ms | **41.71 ms ±1%** | 62.52 ms ±<1% |

**Bun 1.4: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |          quarry |        Bun.sql |
| ----- | --------------: | -------------: |
| 0 ms  | **250,190 ±7%** |   162,914 ±10% |
| 1 ms  |  **28,356 ±2%** |     27,165 ±2% |
| 5 ms  |   **8,294 ±1%** |      8,281 ±1% |
| 20 ms |      2,368 ±<1% | **2,370 ±<1%** |

**Bun 1.4: connect + select 1 + close: median latency by RTT**

| RTT   |        quarry |           Bun.sql |
| ----- | ------------: | ----------------: |
| 0 ms  |   2.68 ms ±4% |   **2.51 ms ±3%** |
| 1 ms  |   5.02 ms ±2% |   **4.87 ms ±2%** |
| 5 ms  |  13.63 ms ±1% |  **13.44 ms ±1%** |
| 20 ms | 43.93 ms ±<1% | **43.53 ms ±<1%** |

## PgBouncer

**Node 24 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |          quarry | quarry (prepare: false) |         pg | pg (named) |  pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | --------------: | ----------------------: | ---------: | ---------: | ---------: | ----------: | ---------------------------: |
| select 1                                               |  **21,441 ±2%** |              18,618 ±2% | 20,419 ±1% | 18,934 ±1% | 20,347 ±3% |  19,019 ±2% |                   19,358 ±3% |
| point lookup by primary key                            |  **19,147 ±3%** |              13,084 ±3% | 13,883 ±9% | 15,997 ±1% | 14,607 ±8% |  16,326 ±2% |                    8,566 ±2% |
| point lookup by primary key, concurrency 50            | **110,867 ±9%** |              74,399 ±2% | 69,340 ±5% | 65,898 ±9% | 73,415 ±3% |  39,809 ±3% |                   41,232 ±1% |
| fetch 1k rows (6 columns)                              |   **2,678 ±7%** |               1,177 ±1% |    725 ±2% |    737 ±2% |    614 ±6% |     871 ±3% |                      849 ±7% |
| insert one row                                         |  **19,310 ±2%** |              16,614 ±2% | 15,752 ±3% | 17,085 ±3% | 16,036 ±1% |  16,503 ±2% |                    8,942 ±2% |
| transaction: begin; insert; commit                     |   **9,396 ±2%** |               8,980 ±1% |  6,698 ±1% |  7,055 ±3% |  6,637 ±2% |   6,136 ±3% |                    4,719 ±4% |
| insert one row, concurrency 50                         |     105,909 ±1% |         **107,074 ±2%** | 82,319 ±1% | 68,073 ±4% | 81,006 ±5% |  39,531 ±1% |                   42,487 ±2% |
| query that fails (division by zero), connection reused |      15,731 ±1% |          **15,797 ±2%** |  5,986 ±1% |  5,416 ±3% |  4,770 ±4% |  12,239 ±3% |                   12,367 ±2% |

**Node 24 through PgBouncer: median latency**

| Scenario                                               |      quarry | quarry (prepare: false) |      pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | ----------: | ----------------------: | ------: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                                               | **44.8 µs** |                 50.1 µs | 46.3 µs |    50.0 µs |   46.9 µs |     49.6 µs |                      49.1 µs |
| point lookup by primary key                            | **50.2 µs** |                 71.6 µs | 68.3 µs |    58.9 µs |   65.9 µs |     57.6 µs |                       112 µs |
| point lookup by primary key, concurrency 50            |  **453 µs** |                  561 µs |  680 µs |     716 µs |    642 µs |     1.18 ms |                      1.13 ms |
| fetch 1k rows (6 columns)                              |  **355 µs** |                  799 µs | 1.41 ms |    1.37 ms |   1.66 ms |      984 µs |                       993 µs |
| insert one row                                         | **49.7 µs** |                 57.1 µs | 60.3 µs |    55.0 µs |   59.8 µs |     57.0 µs |                       107 µs |
| transaction: begin; insert; commit                     |  **101 µs** |                  106 µs |  144 µs |     136 µs |    147 µs |      154 µs |                       203 µs |
| insert one row, concurrency 50                         |      464 µs |              **461 µs** |  574 µs |     709 µs |    579 µs |     1.19 ms |                      1.12 ms |
| query that fails (division by zero), connection reused |     60.7 µs |             **60.0 µs** |  156 µs |     170 µs |    196 µs |     77.3 µs |                      77.1 µs |

**Node 24: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | quarry (prepare: false) |  pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ---------------------------------- | -----: | ----------------------: | --: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                           |    48% |                     56% | 57% |        54% |   **66%** |         60% |                          59% |
| point lookup by primary key        |    53% |                     71% | 69% |        59% |   **75%** |         58% |                          62% |
| fetch 1k rows (6 columns)          |    90% |                     94% | 94% |        92% |   **99%** |         94% |                          91% |
| insert one row                     |    55% |                     62% | 64% |        56% |   **75%** |         59% |                          61% |
| transaction: begin; insert; commit |    51% |                       — | 57% |        53% |   **71%** |         58% |                            — |

**Bun 1.4 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |          quarry |    Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | --------------: | ---------: | -----------------------: |
| select 1                                               |  **23,004 ±3%** | 21,325 ±3% |               21,552 ±4% |
| point lookup by primary key                            |  **20,487 ±2%** | 17,694 ±7% |               15,024 ±2% |
| point lookup by primary key, concurrency 50            | **104,721 ±1%** | 55,138 ±1% |               57,012 ±1% |
| fetch 1k rows (6 columns)                              |   **3,046 ±1%** |  2,186 ±1% |               2,189 ±<1% |
| insert one row                                         |  **20,529 ±2%** | 17,328 ±6% |               14,906 ±4% |
| transaction: begin; insert; commit                     |  **10,090 ±2%** |  6,964 ±1% |                6,472 ±2% |
| insert one row, concurrency 50                         | **106,056 ±1%** | 55,915 ±2% |               57,020 ±1% |
| query that fails (division by zero), connection reused |      16,922 ±4% | 19,115 ±2% |           **19,232 ±4%** |

**Bun 1.4 through PgBouncer: median latency**

| Scenario                                               |      quarry |     Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | ----------: | ----------: | -----------------------: |
| select 1                                               | **42.6 µs** |     45.5 µs |                  45.4 µs |
| point lookup by primary key                            | **47.8 µs** |     56.0 µs |                  65.0 µs |
| point lookup by primary key, concurrency 50            |  **474 µs** |      895 µs |                   853 µs |
| fetch 1k rows (6 columns)                              |  **311 µs** |      443 µs |                   444 µs |
| insert one row                                         | **47.5 µs** |     57.0 µs |                  65.6 µs |
| transaction: begin; insert; commit                     | **96.2 µs** |      140 µs |                   151 µs |
| insert one row, concurrency 50                         |  **469 µs** |      882 µs |                   851 µs |
| query that fails (division by zero), connection reused |     56.9 µs | **50.2 µs** |                  50.4 µs |

**Bun 1.4: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | Bun.sql | Bun.sql (prepare: false) |
| ---------------------------------- | -----: | ------: | -----------------------: |
| select 1                           |    45% | **57%** |                      55% |
| point lookup by primary key        |    50% |     51% |                  **66%** |
| fetch 1k rows (6 columns)          |    85% |     87% |                  **89%** |
| insert one row                     |    52% |     51% |                  **59%** |
| transaction: begin; insert; commit |    49% | **64%** |                        — |

## Server restart

`pg_ctl restart -m fast` while a pool runs `select 1` every 5 ms (2 s client timeout per query).

| Runtime  | Client                   | Recovered | Time from server up to first success (median) | Failed queries (median) |
| -------- | ------------------------ | --------: | --------------------------------------------: | ----------------------: |
| Node 24  | quarry                   |       5/5 |                                       3.00 ms |                      26 |
| Node 24  | pg                       |       5/5 |                                       5.00 ms |                      27 |
| Node 24  | pg (named)               |       5/5 |                                       3.00 ms |                      27 |
| Node 24  | pg-native                |       5/5 |                                       5.00 ms |                      25 |
| Node 24  | postgres.js              |       5/5 |                                      46.00 ms |                      14 |
| Bun 1.4  | quarry                   |       5/5 |                                       4.00 ms |                      27 |
| Bun 1.4  | postgres.js              |       5/5 |                                      17.00 ms |                      14 |
| Bun 1.4  | Bun.sql                  |       5/5 |                                       5.00 ms |                      17 |
| Deno 2.9 | quarry                   |       5/5 |                                       4.00 ms |                      24 |
| Deno 2.9 | deno-postgres (+nodelay) |       0/5 |                                             — |                      16 |

## Footprint and cold start

| Package                                              | Installed size | Packages installed |
| ---------------------------------------------------- | -------------: | -----------------: |
| quarry (whole package: query builder + driver + src) |       2634 KiB |                  1 |
| pg                                                   |        464 KiB |                 14 |
| pg + pg-native (libpq addon, built)                  |       1377 KiB |                 19 |
| postgres.js                                          |        293 KiB |                  1 |
| @neondatabase/serverless (+ ws on Node)              |        582 KiB |                  2 |
| deno-postgres (jsr, source modules)                  |        531 KiB |                  7 |
| Bun.sql (built into Bun)                             |          0 KiB |                  0 |

| Bundle (esbuild, minified, platform node) |                                                  Size |     gzip |
| ----------------------------------------- | ----------------------------------------------------: | -------: |
| quarry/driver                             |                                             112.2 KiB | 37.7 KiB |
| pg                                        |                                              84.4 KiB | 26.3 KiB |
| postgres.js                               |                                              37.1 KiB | 14.3 KiB |
| @neondatabase/serverless                  |                                             142.9 KiB | 46.3 KiB |
| pg-native                                 | native addon (libpq .node + libpq.so): not bundleable |          |

| Runtime / client   |   Import | Connect + first query | Process start → first result | Wall time of the process |
| ------------------ | -------: | --------------------: | ---------------------------: | -----------------------: |
| node/none          |   2.1 µs |               10.8 µs |                     40.12 ms |                 47.56 ms |
| node/quarry        |  6.71 ms |              10.59 ms |                     59.27 ms |                 64.76 ms |
| node/pg            | 21.66 ms |               6.64 ms |                     71.45 ms |                 76.80 ms |
| node/pg-native     | 21.10 ms |               7.80 ms |                     70.94 ms |                 77.62 ms |
| node/postgres.js   | 13.72 ms |               8.68 ms |                     63.13 ms |                 71.18 ms |
| node/neon          | 25.42 ms |              10.88 ms |                     75.66 ms |                 80.83 ms |
| bun/none           |   0.8 µs |               12.5 µs |                      1.85 ms |                  4.45 ms |
| bun/quarry         |  8.15 ms |              13.92 ms |                     24.02 ms |                 28.05 ms |
| bun/pg             | 13.76 ms |               8.23 ms |                     23.91 ms |                 27.33 ms |
| bun/postgres.js    | 12.34 ms |               8.95 ms |                     23.28 ms |                 29.08 ms |
| bun/bun.sql        |  3.24 ms |               3.74 ms |                      8.87 ms |                 12.26 ms |
| deno/none          |   2.2 µs |               17.6 µs |                     11.02 ms |                 22.10 ms |
| deno/quarry        |  3.46 ms |              13.84 ms |                     27.13 ms |                 38.15 ms |
| deno/pg            | 13.33 ms |               7.69 ms |                     30.47 ms |                 40.43 ms |
| deno/postgres.js   | 11.61 ms |              10.80 ms |                     32.02 ms |                 44.10 ms |
| deno/deno-postgres | 19.50 ms |               5.03 ms |                     34.41 ms |                 45.06 ms |
