### Correctness

Every result compared in canonical form (see `canon.ts`) against the majority digest for its runtime and scenario.

608 (runtime, client, scenario) results checked; 0 differ from the majority.

### Failed runs

- reconnect deno deno-postgres (+nodelay) reconnect (max 10, c -, rtt -): 5 failed: BrokenPipe: Broken pipe (os error 32)

## Node 24

**Node 24: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |          quarry |           pg |   pg (named) |    pg-native |  postgres.js |    neon (WS) |
| ------------------------------------------------------------- | --------------: | -----------: | -----------: | -----------: | -----------: | -----------: |
| select 1                                                      | **21.5 µs ±1%** |  26.5 µs ±1% |  26.7 µs ±8% |  31.6 µs ±1% | 28.9 µs ±45% | 48.5 µs ±66% |
| point lookup by primary key                                   | **26.7 µs ±1%** | 47.6 µs ±16% | 35.3 µs ±13% | 50.6 µs ±15% |  33.2 µs ±2% |  81.2 µs ±5% |
| range scan, 100 rows                                          | **89.2 µs ±4%** |  191 µs ±14% |   184 µs ±2% |   200 µs ±3% |  159 µs ±11% |   226 µs ±1% |
| fetch 1k rows (6 columns)                                     | **316 µs ±13%** |  1.35 ms ±9% |  1.27 ms ±6% | 1.69 ms ±13% |  946 µs ±14% |  1.53 ms ±1% |
| 100 parameters (id in (…)), 100 rows                          |  **231 µs ±2%** |   318 µs ±6% |   261 µs ±8% |   330 µs ±6% |   275 µs ±5% |   347 µs ±9% |
| 1000 parameters (id in (…)), 1000 rows                        | **1.95 ms ±1%** |  2.54 ms ±3% |  2.10 ms ±2% |  2.84 ms ±4% |  2.26 ms ±2% | 2.53 ms ±12% |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **1.81 ms ±4%** | 2.15 ms ±13% |  1.94 ms ±3% |  2.34 ms ±8% | 1.95 ms ±13% |  2.26 ms ±2% |
| insert one row                                                | **26.0 µs ±1%** | 39.2 µs ±18% |  31.0 µs ±9% |  44.7 µs ±1% |  34.2 µs ±5% |  72.9 µs ±9% |
| multi-row insert: 100 rows, 300 parameters                    |  **198 µs ±4%** |   305 µs ±1% |   216 µs ±4% |   325 µs ±3% |   342 µs ±3% |   306 µs ±6% |
| update one row by primary key                                 | **31.0 µs ±1%** |  46.2 µs ±2% |  35.7 µs ±9% |  51.5 µs ±2% | 38.5 µs ±16% |  80.8 µs ±7% |
| upsert (insert … on conflict do update)                       | **31.2 µs ±1%** | 44.0 µs ±30% | 35.5 µs ±<1% | 49.9 µs ±14% |  37.8 µs ±2% |  78.8 µs ±6% |
| delete one row by primary key                                 | **25.6 µs ±1%** |  38.1 µs ±6% |  29.6 µs ±1% | 43.0 µs ±11% |  31.5 µs ±9% | 70.7 µs ±13% |
| transaction: begin; select 1; commit                          | **46.7 µs ±3%** |  68.9 µs ±2% | 69.8 µs ±13% |  85.2 µs ±5% | 81.8 µs ±26% |   130 µs ±6% |
| transaction: begin; insert; commit                            | **51.3 µs ±7%** |  81.7 µs ±2% |  72.2 µs ±1% |  101 µs ±15% |  88.7 µs ±8% |   152 µs ±5% |
| transaction with 5 savepoints (select 1 in each)              | **259 µs ±<1%** |   385 µs ±2% |   392 µs ±6% |   510 µs ±9% |  336 µs ±41% |   715 µs ±3% |
| query that fails (division by zero), connection reused        | **33.7 µs ±1%** |  2.36 ms ±3% |  2.42 ms ±2% |  4.81 ms ±3% | 55.2 µs ±10% |  2.69 ms ±5% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **30.6 µs ±8%** | 41.8 µs ±18% |  37.8 µs ±2% |  46.7 µs ±3% | 36.3 µs ±23% | 76.5 µs ±11% |

**Node 24: throughput, sequential (operations/s)**

| Scenario                                                      |         quarry |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ------------------------------------------------------------- | -------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| select 1                                                      | **43,909 ±1%** |  35,273 ±4% |  34,330 ±4% |  30,033 ±1% | 31,493 ±27% | 18,468 ±36% |
| point lookup by primary key                                   | **35,676 ±4%** | 18,012 ±11% | 26,315 ±14% | 18,400 ±14% |  28,119 ±2% |  11,488 ±9% |
| range scan, 100 rows                                          | **10,476 ±8%** |  4,825 ±17% |   5,055 ±3% |   4,786 ±4% |   5,517 ±9% |  4,040 ±12% |
| fetch 1k rows (6 columns)                                     |  **2,881 ±8%** |     734 ±8% |     771 ±2% |    596 ±12% |    903 ±10% |     641 ±2% |
| 100 parameters (id in (…)), 100 rows                          |  **4,208 ±2%** |   2,946 ±5% |   3,640 ±8% |   2,712 ±9% |  3,461 ±10% |   2,647 ±7% |
| 1000 parameters (id in (…)), 1000 rows                        |    **498 ±2%** |     388 ±6% |     463 ±4% |     349 ±4% |     426 ±3% |     377 ±9% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |    **539 ±3%** |    458 ±12% |     499 ±4% |     418 ±7% |    494 ±13% |     416 ±5% |
| insert one row                                                | **36,163 ±1%** | 23,185 ±11% |  29,425 ±7% |  21,023 ±3% |  26,543 ±5% |  12,533 ±8% |
| multi-row insert: 100 rows, 300 parameters                    |  **4,753 ±4%** |   3,107 ±5% |   4,331 ±4% |   2,960 ±6% |   2,819 ±6% |  3,075 ±25% |
| update one row by primary key                                 | **30,694 ±5%** |  20,171 ±2% |  25,473 ±7% |  18,308 ±2% | 23,826 ±14% |  11,577 ±9% |
| upsert (insert … on conflict do update)                       | **30,470 ±3%** | 21,206 ±21% |  26,267 ±1% | 18,790 ±12% |  24,650 ±4% |  11,698 ±7% |
| delete one row by primary key                                 | **36,890 ±8%** |  24,366 ±5% |  31,361 ±3% | 21,563 ±11% |  29,278 ±7% | 12,857 ±10% |
| transaction: begin; select 1; commit                          | **20,079 ±4%** |  13,753 ±2% | 13,383 ±11% |  11,176 ±6% | 11,050 ±23% |   7,184 ±8% |
| transaction: begin; insert; commit                            | **17,932 ±5%** |  11,528 ±5% |  13,080 ±2% |  9,334 ±14% | 10,414 ±10% |   6,158 ±6% |
| transaction with 5 savepoints (select 1 in each)              |  **3,645 ±1%** |   2,465 ±2% |   2,427 ±4% |   1,909 ±8% |  2,793 ±22% |   1,288 ±7% |
| query that fails (division by zero), connection reused        | **27,686 ±3%** |     415 ±3% |     401 ±3% |     208 ±3% | 16,136 ±10% |     356 ±5% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **29,742 ±7%** | 21,078 ±15% |  23,537 ±5% |  20,168 ±6% | 24,608 ±15% | 11,659 ±13% |

**Node 24: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | --------: | ----------: | --------: |
| select 1                                                      | **31.6 µs** | 41.6 µs |    46.4 µs |   48.6 µs |     52.4 µs |   99.9 µs |
| point lookup by primary key                                   | **37.1 µs** | 97.5 µs |    59.7 µs |   81.3 µs |     51.6 µs |    169 µs |
| range scan, 100 rows                                          |  **240 µs** |  583 µs |     540 µs |    358 µs |      274 µs |    656 µs |
| fetch 1k rows (6 columns)                                     |  **790 µs** | 2.04 ms |    1.93 ms |   2.19 ms |     5.91 ms |   2.42 ms |
| 100 parameters (id in (…)), 100 rows                          |  **307 µs** |  683 µs |     461 µs |    669 µs |      398 µs |    857 µs |
| 1000 parameters (id in (…)), 1000 rows                        | **2.59 ms** | 3.44 ms |    2.97 ms |   3.78 ms |     3.83 ms |   3.84 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.46 ms** | 2.57 ms |    2.62 ms |   2.90 ms |     3.55 ms |   3.91 ms |
| insert one row                                                | **43.2 µs** | 72.3 µs |    60.1 µs |   77.0 µs |     63.2 µs |    164 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **333 µs** |  578 µs |     373 µs |    585 µs |      635 µs |    601 µs |
| update one row by primary key                                 | **44.4 µs** | 78.5 µs |    62.5 µs |   79.0 µs |     71.6 µs |    164 µs |
| upsert (insert … on conflict do update)                       | **44.0 µs** | 70.2 µs |    57.9 µs |   79.3 µs |     60.2 µs |    170 µs |
| delete one row by primary key                                 | **36.8 µs** | 63.9 µs |    48.2 µs |   68.1 µs |     52.2 µs |    156 µs |
| transaction: begin; select 1; commit                          | **78.5 µs** | 98.6 µs |     108 µs |    127 µs |      135 µs |    216 µs |
| transaction: begin; insert; commit                            | **98.9 µs** |  121 µs |     106 µs |    147 µs |      146 µs |    283 µs |
| transaction with 5 savepoints (select 1 in each)              |      669 µs |  537 µs |     570 µs |    683 µs |  **490 µs** |   2.20 ms |
| query that fails (division by zero), connection reused        | **53.7 µs** | 3.15 ms |    3.22 ms |   5.66 ms |     94.7 µs |   4.26 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler | **60.6 µs** | 91.4 µs |    89.2 µs |   80.1 µs |     78.6 µs |    258 µs |

**Node 24: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) |  pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ---------: | ----------: | --------: |
| select 1                                                      |      200 µs |  375 µs |      402 µs |     286 µs |  **188 µs** |    559 µs |
| point lookup by primary key                                   |      261 µs |  563 µs |      486 µs |     457 µs |  **216 µs** |    649 µs |
| range scan, 100 rows                                          |      654 µs |  943 µs |      816 µs | **628 µs** |     6.40 ms |   1.03 ms |
| fetch 1k rows (6 columns)                                     | **1.91 ms** | 2.70 ms |     3.15 ms |    3.74 ms |    10.41 ms |   2.89 ms |
| 100 parameters (id in (…)), 100 rows                          |  **785 µs** | 1.24 ms |     1.34 ms |    1.35 ms |     4.04 ms |   1.83 ms |
| 1000 parameters (id in (…)), 1000 rows                        |     3.56 ms | 4.66 ms | **3.55 ms** |    5.22 ms |     7.05 ms |   5.31 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **3.45 ms** | 3.89 ms |     7.73 ms |    4.40 ms |     6.06 ms |   8.37 ms |
| insert one row                                                |  **153 µs** |  495 µs |      480 µs |     451 µs |      327 µs |    673 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **707 µs** | 1.35 ms |     1.27 ms |    1.75 ms |     1.93 ms |   1.81 ms |
| update one row by primary key                                 |  **293 µs** |  515 µs |      449 µs |     480 µs |      302 µs |    714 µs |
| upsert (insert … on conflict do update)                       |  **289 µs** |  521 µs |      488 µs |     474 µs |      328 µs |    653 µs |
| delete one row by primary key                                 |      263 µs |  460 µs |      422 µs |     423 µs |  **176 µs** |    550 µs |
| transaction: begin; select 1; commit                          |      542 µs |  489 µs |      608 µs | **479 µs** |     1.63 ms |   2.18 ms |
| transaction: begin; insert; commit                            |      499 µs |  732 µs |  **483 µs** |     556 µs |     1.39 ms |   1.78 ms |
| transaction with 5 savepoints (select 1 in each)              | **1.15 ms** | 3.45 ms |     2.85 ms |    2.56 ms |     5.27 ms |   5.50 ms |
| query that fails (division by zero), connection reused        |  **377 µs** | 3.68 ms |     4.18 ms |    6.17 ms |      558 µs |   4.75 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler |      475 µs |  590 µs |      541 µs | **414 µs** |      693 µs |    930 µs |

**Node 24: latency distribution, select 1**

| Percentile |          quarry |            pg |    pg (named) |        pg-native |      postgres.js |     neon (WS) |
| ---------- | --------------: | ------------: | ------------: | ---------------: | ---------------: | ------------: |
| p50        | **21.5 µs ±1%** |   26.5 µs ±1% |   26.7 µs ±8% |      31.6 µs ±1% |     28.9 µs ±45% |  48.5 µs ±66% |
| p90        | **23.8 µs ±2%** |   29.4 µs ±6% |   29.6 µs ±5% |      34.8 µs ±4% |     34.5 µs ±34% |  61.6 µs ±47% |
| p99        | **31.6 µs ±7%** |  41.6 µs ±16% |   46.4 µs ±6% |      48.6 µs ±4% |     52.4 µs ±15% |  99.9 µs ±54% |
| p99.9      |     200 µs ±45% |   375 µs ±33% |    402 µs ±9% |      286 µs ±21% | **188 µs ±112%** |   559 µs ±70% |
| max        |    1.78 ms ±88% | 2.51 ms ±251% | 3.49 ms ±146% | **810 µs ±281%** |     5.51 ms ±36% | 3.47 ms ±165% |

**Node 24: latency distribution, point lookup by primary key**

| Percentile |            quarry |           pg |   pg (named) |    pg-native |     postgres.js |    neon (WS) |
| ---------- | ----------------: | -----------: | -----------: | -----------: | --------------: | -----------: |
| p50        |   **26.7 µs ±1%** | 47.6 µs ±16% | 35.3 µs ±13% | 50.6 µs ±15% |     33.2 µs ±2% |  81.2 µs ±5% |
| p90        |   **28.4 µs ±6%** | 58.1 µs ±25% | 39.4 µs ±16% | 57.3 µs ±26% |     37.1 µs ±7% | 91.3 µs ±23% |
| p99        |   **37.1 µs ±7%** | 97.5 µs ±77% | 59.7 µs ±24% | 81.3 µs ±26% |     51.6 µs ±5% |  169 µs ±21% |
| p99.9      |       261 µs ±68% |  563 µs ±10% |  486 µs ±21% |   457 µs ±6% | **216 µs ±33%** |  649 µs ±40% |
| max        | **2.25 ms ±302%** | 3.35 ms ±71% | 2.45 ms ±74% | 3.11 ms ±34% |    6.36 ms ±44% | 4.41 ms ±35% |

**Node 24: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |               pg |    pg (named) |     pg-native |      postgres.js |     neon (WS) |
| --------------------------------------------------------------------------- | ---------------: | ---------------: | ------------: | ------------: | ---------------: | ------------: |
| fetch 100k rows                                                             | **35.61 ms ±4%** |       128 ms ±4% |    127 ms ±5% |   149 ms ±13% |       101 ms ±4% |   134 ms ±12% |
| fetch 1M rows (one result)                                                  |  **521 ms ±15%** |      1279 ms ±4% |   1280 ms ±8% |   1488 ms ±6% |      1069 ms ±5% |   1485 ms ±4% |
| wide rows: 1k rows × 100 columns                                            |  **3.65 ms ±2%** |    14.74 ms ±19% |  14.73 ms ±4% |  21.85 ms ±2% |     15.09 ms ±4% | 18.09 ms ±18% |
| large values: 10 × 1 MB text                                                |  **4.90 ms ±6%** |      5.70 ms ±6% |   5.44 ms ±7% |  12.40 ms ±2% |      5.04 ms ±4% |  8.58 ms ±10% |
| large values: 10 × 1 MB bytea                                               | **3.55 ms ±18%** |    17.22 ms ±11% |  17.26 ms ±2% | 31.73 ms ±30% |    18.43 ms ±17% |  24.71 ms ±7% |
| large values: 20 × 200 KB jsonb                                             |    24.75 ms ±10% | **24.74 ms ±9%** |  24.75 ms ±3% |  39.12 ms ±3% |     25.70 ms ±2% |  28.91 ms ±4% |
| arrays: 1k rows of int4[100] + text[20]                                     | **3.18 ms ±11%** |     22.77 ms ±2% |  23.01 ms ±5% |  26.92 ms ±2% |     8.82 ms ±15% | 25.53 ms ±12% |
| bulk insert 10k rows (unnest arrays)                                        |    14.07 ms ±14% |     13.32 ms ±4% |  13.37 ms ±3% |  13.04 ms ±4% | **13.02 ms ±4%** |  13.88 ms ±2% |
| bulk insert 10k rows (unnest, JS array parameters)                          | **13.09 ms ±3%** |     15.95 ms ±3% |  15.91 ms ±3% |  16.12 ms ±4% |     16.40 ms ±4% |  16.93 ms ±2% |
| bulk insert 1k rows (unnest, JS array parameters)                           |  **1.51 ms ±4%** |      1.85 ms ±5% |   1.81 ms ±3% |   1.89 ms ±5% |      1.86 ms ±2% |   1.98 ms ±1% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     13.08 ms ±9% | **12.85 ms ±2%** | 12.95 ms ±15% |           n/a |    55.90 ms ±<1% |           n/a |
| stream 1M rows with a cursor (1000 per batch)                               |  **315 ms ±14%** |      1298 ms ±2% |   1301 ms ±2% |           n/a |      1095 ms ±5% |           n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **561 ms ±2%** |       730 ms ±3% |    727 ms ±8% |           n/a |       694 ms ±2% |           n/a |

**Node 24: rows per second (median)**

| Scenario                                           |        quarry |          pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | ------------: | ----------: | ---------: | --------: | ----------: | --------: |
| fetch 1k rows (6 columns)                          | **2,880,845** |     734,040 |    770,621 |   596,418 |     903,438 |   640,501 |
| fetch 100k rows                                    | **2,771,656** |     775,209 |    784,866 |   654,045 |     969,630 |   733,812 |
| fetch 1M rows (one result)                         | **1,820,585** |     780,436 |    781,941 |   668,034 |     944,816 |   675,138 |
| wide rows: 1k rows × 100 columns                   |   **258,796** |      64,697 |     63,431 |    43,963 |      58,613 |    53,542 |
| arrays: 1k rows of int4[100] + text[20]            |   **305,874** |      42,109 |     41,180 |    35,629 |     101,973 |    36,947 |
| stream 1M rows with a cursor (1000 per batch)      | **3,157,106** |     765,721 |    777,081 |       n/a |     922,519 |       n/a |
| bulk insert 10k rows (unnest arrays)               |       708,462 |     747,942 |    743,040 |   758,953 | **763,841** |   716,387 |
| bulk insert 10k rows (unnest, JS array parameters) |   **749,379** |     623,035 |    623,737 |   607,757 |     596,443 |   585,539 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **653,947** |     525,124 |    544,653 |   518,060 |     527,367 |   495,963 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       751,797 | **775,404** |    770,177 |       n/a |     179,567 |       n/a |

**Node 24: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |    quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------- | --------: | ----: | ---------: | --------: | ----------: | --------: |
| fetch 100k rows × 5                               |   **285** |   374 |        375 |       431 |         347 |       381 |
| fetch 1M rows (one result) × 3                    | **1,034** | 1,369 |      1,369 |     1,665 |       1,124 |     1,398 |
| wide rows: 1k rows × 100 columns × 50             |   **166** |   197 |        197 |       194 |         367 |       246 |
| large values: 10 × 1 MB text × 20                 |   **179** |   201 |        202 |       233 |         187 |       223 |
| large values: 10 × 1 MB bytea × 20                |   **190** |   210 |        206 |       218 |         196 |       231 |
| large values: 20 × 200 KB jsonb × 10              |       240 |   199 |        199 |   **196** |         254 |       209 |
| arrays: 1k rows of int4[100] + text[20] × 50      |   **146** |   324 |        324 |       268 |         268 |       317 |
| stream 1M rows with a cursor (1000 per batch) × 3 |   **117** |   212 |        212 |       n/a |         246 |       n/a |

**Node 24: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    |  quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------------------------------------- | ------: | ----: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key                                                 | **101** |   106 |        107 |       105 |         156 |       105 |
| fetch 100k rows                                                             | **514** |   543 |        542 |       526 |         516 |       597 |
| fetch 1M rows (one result)                                                  |   1,823 | 1,370 |      1,369 |     1,665 |   **1,122** |     1,396 |
| stream 1M rows with a cursor (1000 per batch)                               | **121** |   212 |        212 |       n/a |         246 |       n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) | **100** |   121 |        120 |       n/a |         232 |       n/a |
| large values: 10 × 1 MB text                                                | **193** |   209 |        213 |       283 |         196 |       238 |
| large values: 10 × 1 MB bytea                                               |     197 |   213 |        211 |       243 |     **196** |       233 |
| large values: 20 × 200 KB jsonb                                             |     354 |   300 |        301 |   **283** |         391 |       348 |

**Node 24: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |  quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------------------- | ------: | ------: | ---------: | --------: | ----------: | --------: |
| RSS growth during pause | **0.0** | **0.0** |        0.1 |       n/a |     **0.0** |       n/a |

**Node 24: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry | quarry (lossless) |         pg | pg (named) |  pg-native | postgres.js | neon (WS) |
| -------------------- | -----------: | ----------------: | ---------: | ---------: | ---------: | ----------: | --------: |
| int4                 |   **76 ±1%** |            77 ±8% |   200 ±16% |   197 ±11% |    203 ±2% |     267 ±5% |  303 ±13% |
| int8                 |     105 ±29% |       **80 ±15%** |    229 ±8% |   233 ±11% |    221 ±1% |    248 ±11% |   318 ±4% |
| float8               |       81 ±2% |        **81 ±9%** |   210 ±10% |    212 ±2% |   236 ±11% |     297 ±5% |  311 ±18% |
| numeric              |  **137 ±2%** |           138 ±1% |   169 ±12% |   167 ±10% |   242 ±11% |     247 ±6% |  287 ±31% |
| text                 |      108 ±9% |       **100 ±9%** |   169 ±11% |   170 ±11% |   204 ±16% |    267 ±20% |  266 ±10% |
| bool                 |   **83 ±2%** |            83 ±2% |   144 ±15% |    154 ±6% |    169 ±2% |     226 ±3% |   238 ±8% |
| timestamptz          | **115 ±14%** |           164 ±8% |   686 ±10% |    688 ±4% |    752 ±6% |    515 ±14% |   788 ±5% |
| date                 |  **112 ±9%** |           112 ±3% |    510 ±9% |   511 ±30% |   452 ±10% |     379 ±5% |  612 ±16% |
| uuid                 |      128 ±2% |       **127 ±3%** |    207 ±6% |   188 ±12% |    233 ±2% |     254 ±6% |  254 ±19% |
| jsonb (small object) | **378 ±12%** |           389 ±5% |    432 ±6% |   415 ±23% |    563 ±1% |    522 ±13% |   549 ±3% |
| int4[5]              |  **263 ±2%** |           266 ±5% | 1,327 ±13% | 1,241 ±10% | 1,256 ±11% |    630 ±15% | 1,745 ±9% |
| bytea (16 B)         | **167 ±12%** |           172 ±4% |    385 ±4% |    383 ±3% |    405 ±7% |     368 ±5% |  506 ±17% |

**Node 24: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |           quarry |           pg | pg (named) |   pg-native |  postgres.js |   neon (WS) |
| -------------------------------------------------- | ---------------: | -----------: | ---------: | ----------: | -----------: | ----------: |
| insert one row                                     |   **36,163 ±1%** |  23,185 ±11% | 29,425 ±7% |  21,023 ±3% |   26,543 ±5% |  12,533 ±8% |
| insert one row, concurrency 50                     | **252,977 ±19%** |  86,131 ±22% | 82,027 ±9% |  68,614 ±6% |   40,386 ±3% |  32,039 ±4% |
| multi-row insert: 100 rows, 300 parameters         |    **4,753 ±4%** |    3,107 ±5% |  4,331 ±4% |   2,960 ±6% |    2,819 ±6% |  3,075 ±25% |
| bulk insert 10k rows (unnest arrays)               |        70.8 ±13% |     74.8 ±5% |   74.3 ±4% |    75.9 ±3% | **76.4 ±3%** |    71.6 ±3% |
| bulk insert 10k rows (unnest, JS array parameters) |     **74.9 ±4%** |     62.3 ±4% |   62.4 ±4% |    60.8 ±7% |    59.6 ±12% |    58.6 ±2% |
| bulk insert 1k rows (unnest, JS array parameters)  |      **654 ±4%** |      525 ±5% |   545 ±10% |     518 ±5% |      527 ±3% |     496 ±1% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |         75.2 ±8% | **77.5 ±2%** |  77.0 ±13% |         n/a |     18.0 ±2% |         n/a |
| update one row by primary key                      |   **30,694 ±5%** |   20,171 ±2% | 25,473 ±7% |  18,308 ±2% |  23,826 ±14% |  11,577 ±9% |
| upsert (insert … on conflict do update)            |   **30,470 ±3%** |  21,206 ±21% | 26,267 ±1% | 18,790 ±12% |   24,650 ±4% |  11,698 ±7% |
| delete one row by primary key                      |   **36,890 ±8%** |   24,366 ±5% | 31,361 ±3% | 21,563 ±11% |   29,278 ±7% | 12,857 ±10% |

**Node 24: transactions, operations/s**

| Scenario                                         |         quarry |         pg |  pg (named) |  pg-native | postgres.js | neon (WS) |
| ------------------------------------------------ | -------------: | ---------: | ----------: | ---------: | ----------: | --------: |
| transaction: begin; select 1; commit             | **20,079 ±4%** | 13,753 ±2% | 13,383 ±11% | 11,176 ±6% | 11,050 ±23% | 7,184 ±8% |
| transaction: begin; insert; commit               | **17,932 ±5%** | 11,528 ±5% |  13,080 ±2% | 9,334 ±14% | 10,414 ±10% | 6,158 ±6% |
| transaction with 5 savepoints (select 1 in each) |  **3,645 ±1%** |  2,465 ±2% |   2,427 ±4% |  1,909 ±8% |  2,793 ±22% | 1,288 ±7% |

**Node 24: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | --------: | ----------: | --------: |
| select 1                                               |   **13.8** |    17.6 |       20.4 |      22.4 |        24.5 |      28.5 |
| point lookup by primary key                            |   **15.2** |    28.4 |       26.0 |      28.2 |        26.4 |      53.7 |
| fetch 1k rows (6 columns)                              |    **326** |   1,207 |      1,197 |     1,302 |       1,184 |     1,348 |
| fetch 100k rows                                        | **52,659** | 162,704 |    161,254 |   168,692 |     135,721 |   171,252 |
| insert one row                                         |   **14.2** |    21.0 |       20.2 |      24.6 |        27.0 |      47.8 |
| insert one row, concurrency 50                         |    **4.1** |    12.5 |       13.1 |      15.8 |        29.6 |      32.8 |
| transaction: begin; insert; commit                     |   **34.6** |    50.4 |       49.9 |      69.4 |        80.5 |      89.3 |
| query that fails (division by zero), connection reused |   **27.0** |     538 |        601 |     1,280 |        55.7 |     1,037 |

**Node 24: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------ | -------: | ---: | ---------: | --------: | ----------: | --------: |
| select 1                             |      9.8 | 11.9 |    **9.6** |      14.8 |        12.0 |      12.5 |
| point lookup by primary key          | **13.7** | 31.5 |       14.8 |      31.0 |        14.2 |      38.2 |
| fetch 1k rows (6 columns)            |  **240** |  426 |        382 |       503 |         398 |       463 |
| 100 parameters (id in (…)), 100 rows |      187 |  239 |        189 |       258 |     **184** |       253 |
| insert one row                       | **14.6** | 25.4 |       15.4 |      28.4 |        15.2 |      35.1 |
| insert one row, concurrency 50       | **12.1** | 34.8 |       17.9 |      41.7 |        17.8 |      41.9 |
| transaction: begin; insert; commit   | **25.1** | 41.7 |       31.1 |      51.7 |        32.4 |      52.0 |

**Node 24: GC time (ms per second of run) / longest GC pause**

| Scenario                                       | quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ---------------------------------------------- | -----: | ----: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: GC ms/s           |   11.4 |  17.6 |       23.3 |  **10.3** |        22.1 |      17.3 |
| point lookup by primary key: max pause ms      |    0.6 |   0.7 |        0.7 |   **0.6** |         5.7 |       0.6 |
| insert one row, concurrency 50: GC ms/s        |   30.3 |  27.0 |       27.5 |  **20.1** |        22.4 |      22.0 |
| insert one row, concurrency 50: max pause ms   |    1.4 |   1.6 |        1.4 |   **1.2** |         6.3 |       1.9 |
| fetch 1k rows (6 columns): GC ms/s             |   24.8 |  16.7 |       18.1 |  **12.9** |        82.3 |      18.5 |
| fetch 1k rows (6 columns): max pause ms        |    1.9 |   0.7 |        0.6 |       1.6 |         8.7 |   **0.6** |
| fetch 100k rows: GC ms/s                       |  233.6 | 132.0 |      120.4 |  **95.9** |       153.3 |     128.9 |
| fetch 100k rows: max pause ms                  |   19.1 |  15.0 |       12.6 |      14.8 |        19.6 |  **12.0** |
| fetch 1M rows (one result): GC ms/s            |  245.0 | 159.0 |      151.8 |  **84.4** |       178.1 |     164.3 |
| fetch 1M rows (one result): max pause ms       |   43.8 |  20.8 |       16.5 |      17.3 |        28.7 |  **15.0** |
| wide rows: 1k rows × 100 columns: GC ms/s      |   28.2 |  23.5 |       25.8 |  **16.8** |       129.7 |      43.5 |
| wide rows: 1k rows × 100 columns: max pause ms |    3.4 |   4.3 |        3.7 |   **3.2** |         8.8 |       3.2 |
| large values: 20 × 200 KB jsonb: GC ms/s       |   30.0 |  30.9 |       32.0 |  **14.9** |        28.4 |      50.5 |
| large values: 20 × 200 KB jsonb: max pause ms  |    5.8 |   5.3 |        6.0 |   **4.7** |         6.8 |       7.3 |

**Node 24: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |   quarry |   pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | -------: | ---: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: p99                   |  **0.1** |  0.3 |        0.2 |       0.1 |         3.4 |       1.2 |
| point lookup by primary key: max                   |  **0.1** |  1.1 |        0.3 |       0.3 |         3.4 |       2.1 |
| insert one row, concurrency 50: p99                |      0.6 |  0.4 |        0.4 |       0.5 |         3.9 |   **0.4** |
| insert one row, concurrency 50: max                |      0.9 |  0.6 |    **0.6** |       0.8 |         3.9 |       1.0 |
| fetch 1k rows (6 columns): p99                     |  **0.2** |  0.8 |        0.6 |       1.2 |         5.5 |       1.0 |
| fetch 1k rows (6 columns): max                     |  **0.3** |  1.1 |        0.6 |       1.2 |         5.5 |       1.1 |
| fetch 100k rows: p99                               | **19.2** | 34.7 |       38.4 |     123.8 |        25.0 |      38.7 |
| fetch 100k rows: max                               | **21.8** | 34.7 |       38.4 |     123.8 |        26.8 |      38.7 |
| fetch 1M rows (one result): p99                    |     44.9 | 31.3 |   **29.6** |   1,185.3 |        38.4 |      38.4 |
| fetch 1M rows (one result): max                    |     49.2 | 31.6 |   **31.3** |   1,185.3 |        53.1 |      61.8 |
| stream 1M rows with a cursor (1000 per batch): p99 |  **0.3** |  1.0 |        1.0 |       n/a |         6.0 |       n/a |
| stream 1M rows with a cursor (1000 per batch): max |  **0.3** |  1.3 |        1.7 |       n/a |         7.3 |       n/a |

**Node 24: connections (median time per operation)**

| Scenario                                                    |           quarry |          pg |  pg (named) |    pg-native |   postgres.js |       neon (WS) |
| ----------------------------------------------------------- | ---------------: | ----------: | ----------: | -----------: | ------------: | --------------: |
| connect + select 1 + close (no TLS, trust)                  | **2.43 ms ±12%** | 3.99 ms ±2% | 4.01 ms ±2% |  4.83 ms ±2% |   6.92 ms ±5% |     4.56 ms ±8% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          |  **2.72 ms ±3%** | 5.37 ms ±2% | 5.31 ms ±1% |  7.60 ms ±4% |   7.96 ms ±2% |    69.64 ms ±4% |
| connect + select 1 + close (TLS verify-full, trust)         |     5.06 ms ±16% | 5.14 ms ±3% | 5.24 ms ±6% |  5.07 ms ±2% | 52.26 ms ±<1% | **4.57 ms ±9%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) | **5.41 ms ±13%** | 6.80 ms ±5% | 6.82 ms ±2% |  7.82 ms ±5% |  53.08 ms ±5% |    70.58 ms ±7% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     |  **7.81 ms ±3%** | 8.59 ms ±6% | 8.87 ms ±7% | 13.68 ms ±8% | 15.19 ms ±13% |     8.34 ms ±2% |

**Node 24: cancellation, notifications, errors**

| Scenario                                      |        quarry |          pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------- | ------------: | ----------: | ---------: | --------: | ----------: | --------: |
| cancel: time from cancel() to rejection (p50) |       1.54 ms | **1.51 ms** |    1.53 ms |   2.29 ms |     1.54 ms |       n/a |
| cancel: share of queries actually cancelled   |      **100%** |    **100%** |   **100%** |  **100%** |    **100%** |       n/a |
| NOTIFY latency p50                            |   **30.6 µs** |     41.8 µs |    37.8 µs |   46.7 µs |     36.3 µs |   76.5 µs |
| NOTIFY latency p99                            |   **60.6 µs** |     91.4 µs |    89.2 µs |   80.1 µs |     78.6 µs |    258 µs |
| NOTIFY throughput (notifications/s)           | **2,444,460** |   2,048,252 |  2,037,783 |   813,218 |   1,722,011 | 1,630,309 |
| error path: failing queries/s                 |    **27,686** |         415 |        401 |       208 |      16,136 |       356 |

**Node 24: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |              pg-native |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 43,909 / 32,380 / +36% |  34,330 / 35,273 / -3% |  30,370 / 30,033 / +1% |   31,493 / 32,218 / -2% |
| point lookup by primary key             | 35,676 / 18,356 / +94% | 26,315 / 18,012 / +46% | 23,805 / 18,400 / +29% | 28,119 / 13,365 / +110% |
| range scan, 100 rows                    |  10,476 / 5,839 / +79% |    5,055 / 4,825 / +5% |    4,801 / 4,786 / +0% |    5,517 / 4,573 / +21% |
| fetch 1k rows (6 columns)               |  2,881 / 1,260 / +129% |        771 / 734 / +5% |        634 / 596 / +6% |         903 / 878 / +3% |
| 100 parameters (id in (…)), 100 rows    |   4,208 / 3,121 / +35% |   3,640 / 2,946 / +24% |   3,678 / 2,712 / +36% |    3,461 / 2,494 / +39% |
| 1000 parameters (id in (…)), 1000 rows  |       498 / 398 / +25% |       463 / 388 / +19% |       425 / 349 / +22% |        426 / 337 / +27% |
| insert one row                          | 36,163 / 26,131 / +38% | 29,425 / 23,185 / +27% | 26,023 / 21,023 / +24% |  26,543 / 14,133 / +88% |
| upsert (insert … on conflict do update) | 30,470 / 23,111 / +32% | 26,267 / 21,206 / +24% | 22,551 / 18,790 / +20% |  24,650 / 13,829 / +78% |

**Node 24: quarry decoding modes (time per op)**

| Scenario                                |            quarry | quarry (lossless) |
| --------------------------------------- | ----------------: | ----------------: |
| point lookup by primary key             |       26.7 µs ±1% |   **26.6 µs ±1%** |
| fetch 1k rows (6 columns)               |   **316 µs ±13%** |       345 µs ±14% |
| fetch 100k rows                         |      35.61 ms ±4% | **32.05 ms ±17%** |
| fetch 1M rows (one result)              |       521 ms ±15% |   **483 ms ±11%** |
| wide rows: 1k rows × 100 columns        |   **3.65 ms ±2%** |      3.74 ms ±19% |
| arrays: 1k rows of int4[100] + text[20] |  **3.18 ms ±11%** |       3.25 ms ±3% |
| decode 100k × int8                      |     10.48 ms ±29% |  **8.00 ms ±15%** |
| decode 100k × timestamptz               | **11.49 ms ±14%** |      16.41 ms ±8% |
| decode 100k × date                      |  **11.21 ms ±9%** |      11.24 ms ±3% |

**Node 24: shipped defaults vs tuned (median latency)**

| Scenario                                   |   neon (WS) | neon (WS, defaults) |
| ------------------------------------------ | ----------: | ------------------: |
| select 1                                   | **48.5 µs** |             1.55 ms |
| point lookup by primary key                | **81.2 µs** |             1.65 ms |
| fetch 1k rows (6 columns)                  | **1.53 ms** |             3.02 ms |
| insert one row                             | **72.9 µs** |             1.63 ms |
| transaction: begin; insert; commit         |  **152 µs** |             4.66 ms |
| connect + select 1 + close (no TLS, trust) |     4.56 ms |                   — |

## Bun 1.4

**Bun 1.4: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |  postgres.js |         Bun.sql |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | --------------: |
| select 1                                                      | **19.4 µs ±10%** |  23.3 µs ±4% |  21.9 µs ±2% |  24.7 µs ±2% |    25.1 µs ±20% |
| point lookup by primary key                                   |  **24.0 µs ±4%** |  40.5 µs ±2% |  28.6 µs ±4% |  28.1 µs ±3% |     28.8 µs ±4% |
| range scan, 100 rows                                          | **78.8 µs ±27%** |   143 µs ±8% |   137 µs ±1% |   134 µs ±1% |     89.1 µs ±7% |
| fetch 1k rows (6 columns)                                     |   **264 µs ±2%** |  943 µs ±12% |  897 µs ±10% |  893 µs ±13% |     384 µs ±22% |
| 100 parameters (id in (…)), 100 rows                          |   **214 µs ±2%** |   294 µs ±9% |   233 µs ±7% |   235 µs ±1% |     225 µs ±13% |
| 1000 parameters (id in (…)), 1000 rows                        |     1.88 ms ±11% |  2.47 ms ±1% |  1.99 ms ±3% |  2.03 ms ±2% | **1.88 ms ±8%** |
| id = any($1) with 1000 ids (JS array), 1000 rows              |  **1.73 ms ±2%** |  2.09 ms ±9% | 1.96 ms ±18% |  1.91 ms ±2% |     1.82 ms ±3% |
| insert one row                                                | **24.1 µs ±<1%** |  35.9 µs ±1% |  26.4 µs ±1% |  28.0 µs ±1% |     28.4 µs ±1% |
| multi-row insert: 100 rows, 300 parameters                    |   **185 µs ±2%** |   294 µs ±9% |   200 µs ±2% |   237 µs ±1% |      192 µs ±2% |
| update one row by primary key                                 | **28.4 µs ±10%** |  42.8 µs ±1% |  31.1 µs ±5% | 31.7 µs ±12% |     33.0 µs ±3% |
| upsert (insert … on conflict do update)                       |  **29.3 µs ±2%** | 40.8 µs ±16% |  31.6 µs ±3% |  32.6 µs ±1% |     33.6 µs ±4% |
| delete one row by primary key                                 |  **23.8 µs ±2%** |  34.8 µs ±1% |  26.1 µs ±2% |  27.0 µs ±6% |    27.7 µs ±<1% |
| transaction: begin; select 1; commit                          | **41.8 µs ±19%** |  60.3 µs ±1% |  59.7 µs ±2% |  68.9 µs ±1% |    76.7 µs ±19% |
| transaction: begin; insert; commit                            |  **46.7 µs ±2%** |  73.8 µs ±6% |  63.8 µs ±1% |  72.6 µs ±1% |    83.7 µs ±42% |
| transaction with 5 savepoints (select 1 in each)              |   **234 µs ±6%** |   346 µs ±3% |   336 µs ±1% |   288 µs ±1% |     451 µs ±28% |
| query that fails (division by zero), connection reused        |      31.9 µs ±3% |  2.26 ms ±2% |  2.35 ms ±1% |  37.2 µs ±2% | **28.3 µs ±7%** |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **28.1 µs ±2%** |  36.1 µs ±2% |  31.0 µs ±1% |  31.3 µs ±1% |     34.1 µs ±3% |

**Bun 1.4: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg | pg (named) | postgres.js |         Bun.sql |
| ------------------------------------------------------------- | --------------: | ----------: | ---------: | ----------: | --------------: |
| select 1                                                      | **49,907 ±11%** |  40,799 ±5% | 43,644 ±4% |  38,410 ±3% |     38,079 ±24% |
| point lookup by primary key                                   |  **40,503 ±5%** |  23,501 ±4% | 33,227 ±7% |  33,578 ±4% |      33,129 ±3% |
| range scan, 100 rows                                          | **11,805 ±21%** |   6,379 ±5% |  6,785 ±3% |   6,909 ±2% |      10,739 ±6% |
| fetch 1k rows (6 columns)                                     |   **3,473 ±5%** |    896 ±11% | 1,020 ±10% |  1,024 ±17% |      2,488 ±18% |
| 100 parameters (id in (…)), 100 rows                          |   **4,487 ±3%** |   3,211 ±5% | 4,184 ±11% |   4,114 ±2% |      4,235 ±12% |
| 1000 parameters (id in (…)), 1000 rows                        |        527 ±10% |     390 ±2% |    488 ±2% |     477 ±6% |    **528 ±10%** |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     **570 ±2%** |     465 ±9% |   494 ±15% |     511 ±3% |         538 ±5% |
| insert one row                                                |  **39,605 ±1%** |  26,371 ±1% | 35,691 ±3% |  33,636 ±3% |      33,479 ±3% |
| multi-row insert: 100 rows, 300 parameters                    |   **5,142 ±3%** |   3,206 ±8% |  4,740 ±2% |   3,991 ±2% |       4,920 ±2% |
| update one row by primary key                                 | **34,016 ±17%** |  22,392 ±1% | 30,410 ±5% | 30,351 ±12% |      29,177 ±5% |
| upsert (insert … on conflict do update)                       |  **33,076 ±1%** | 23,152 ±15% | 30,241 ±5% |  29,228 ±2% |      27,840 ±5% |
| delete one row by primary key                                 |  **40,033 ±4%** |  27,082 ±2% | 36,308 ±8% |  34,949 ±6% |      34,450 ±1% |
| transaction: begin; select 1; commit                          | **22,799 ±19%** |  15,923 ±1% | 15,935 ±2% |  13,861 ±1% |     11,396 ±16% |
| transaction: begin; insert; commit                            |  **20,396 ±3%** | 12,893 ±14% | 15,015 ±3% |  13,075 ±3% |     10,178 ±28% |
| transaction with 5 savepoints (select 1 in each)              |   **4,144 ±7%** |   2,716 ±7% |  2,874 ±1% |   3,341 ±1% |       1,985 ±8% |
| query that fails (division by zero), connection reused        |      28,995 ±4% |     436 ±1% |    412 ±2% |  24,773 ±2% | **32,644 ±10%** |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **33,865 ±3%** |  25,619 ±3% | 30,962 ±2% |  30,654 ±2% |      27,988 ±4% |

**Bun 1.4: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | ----------: | ----------: |
| select 1                                                      | **25.9 µs** | 32.6 µs |    31.5 µs |     35.6 µs |     36.8 µs |
| point lookup by primary key                                   | **31.3 µs** | 56.1 µs |    40.8 µs |     43.8 µs |     42.1 µs |
| range scan, 100 rows                                          |  **131 µs** |  448 µs |     424 µs |      447 µs |      132 µs |
| fetch 1k rows (6 columns)                                     |  **674 µs** | 1.88 ms |    1.70 ms |     1.62 ms |      714 µs |
| 100 parameters (id in (…)), 100 rows                          |  **314 µs** |  587 µs |     340 µs |      462 µs |      345 µs |
| 1000 parameters (id in (…)), 1000 rows                        |     2.34 ms | 3.46 ms |    2.70 ms |     2.81 ms | **2.25 ms** |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.12 ms** | 2.74 ms |    2.82 ms |     2.56 ms |     2.13 ms |
| insert one row                                                | **36.7 µs** | 55.7 µs |    41.8 µs |     44.4 µs |     45.1 µs |
| multi-row insert: 100 rows, 300 parameters                    |      299 µs |  572 µs |     314 µs |      509 µs |  **294 µs** |
| update one row by primary key                                 | **38.4 µs** | 60.6 µs |    45.4 µs |     45.0 µs |     47.6 µs |
| upsert (insert … on conflict do update)                       | **40.5 µs** | 68.9 µs |    44.0 µs |     47.6 µs |     52.8 µs |
| delete one row by primary key                                 | **34.1 µs** | 50.1 µs |    38.0 µs |     39.4 µs |     39.4 µs |
| transaction: begin; select 1; commit                          | **60.1 µs** | 83.6 µs |    85.4 µs |     94.5 µs |      338 µs |
| transaction: begin; insert; commit                            | **70.7 µs** |  113 µs |    94.1 µs |      107 µs |      371 µs |
| transaction with 5 savepoints (select 1 in each)              |  **348 µs** |  640 µs |     643 µs |      717 µs |      991 µs |
| query that fails (division by zero), connection reused        |     47.1 µs | 2.97 ms |    3.17 ms |     54.5 µs | **44.9 µs** |
| LISTEN/NOTIFY latency: notify on another connection → handler | **46.0 µs** | 62.4 µs |    50.2 µs |     48.9 µs |     49.6 µs |

**Bun 1.4: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | ----------: | ----------: |
| select 1                                                      | **50.2 µs** |  140 µs |     267 µs |     95.2 µs |      144 µs |
| point lookup by primary key                                   | **61.6 µs** |  424 µs |     405 µs |      357 µs |      190 µs |
| range scan, 100 rows                                          |      501 µs |  730 µs |     659 µs |      613 µs |  **331 µs** |
| fetch 1k rows (6 columns)                                     |  **970 µs** | 3.26 ms |    2.67 ms |     2.64 ms |     1.21 ms |
| 100 parameters (id in (…)), 100 rows                          |      574 µs |  964 µs |     667 µs |      740 µs |  **560 µs** |
| 1000 parameters (id in (…)), 1000 rows                        | **2.77 ms** | 4.67 ms |    3.49 ms |     4.92 ms |     3.10 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     3.31 ms | 3.30 ms |    3.40 ms |     2.96 ms | **2.80 ms** |
| insert one row                                                | **91.8 µs** |  338 µs |     336 µs |      234 µs |      208 µs |
| multi-row insert: 100 rows, 300 parameters                    |      493 µs |  831 µs |     546 µs |      843 µs |  **469 µs** |
| update one row by primary key                                 | **93.6 µs** |  336 µs |     311 µs |      229 µs |      162 µs |
| upsert (insert … on conflict do update)                       |  **101 µs** |  342 µs |     311 µs |      301 µs |      211 µs |
| delete one row by primary key                                 | **77.8 µs** |  309 µs |     273 µs |      166 µs |      169 µs |
| transaction: begin; select 1; commit                          |  **308 µs** |  409 µs |     448 µs |      516 µs |      539 µs |
| transaction: begin; insert; commit                            |  **351 µs** |  518 µs |     448 µs |      529 µs |      655 µs |
| transaction with 5 savepoints (select 1 in each)              |  **773 µs** | 1.26 ms |    1.45 ms |     1.07 ms |     1.48 ms |
| query that fails (division by zero), connection reused        |  **172 µs** | 3.63 ms |    3.73 ms |      508 µs |      202 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |      250 µs |  491 µs |     392 µs |      423 µs |  **250 µs** |

**Bun 1.4: latency distribution, select 1**

| Percentile |           quarry |           pg |    pg (named) |   postgres.js |          Bun.sql |
| ---------- | ---------------: | -----------: | ------------: | ------------: | ---------------: |
| p50        | **19.4 µs ±10%** |  23.3 µs ±4% |   21.9 µs ±2% |   24.7 µs ±2% |     25.1 µs ±20% |
| p90        | **20.6 µs ±18%** |  25.8 µs ±8% |   23.7 µs ±7% |   28.1 µs ±7% |     27.3 µs ±51% |
| p99        | **25.9 µs ±39%** | 32.6 µs ±20% |  31.5 µs ±12% |   35.6 µs ±9% |    36.8 µs ±129% |
| p99.9      | **50.2 µs ±15%** | 140 µs ±101% |   267 µs ±42% |  95.2 µs ±36% |      144 µs ±96% |
| max        |    1.67 ms ±463% | 1.67 ms ±54% | 1.37 ms ±194% | 945 µs ±1507% | **546 µs ±862%** |

**Bun 1.4: latency distribution, point lookup by primary key**

| Percentile |           quarry |           pg |    pg (named) |   postgres.js |       Bun.sql |
| ---------- | ---------------: | -----------: | ------------: | ------------: | ------------: |
| p50        |  **24.0 µs ±4%** |  40.5 µs ±2% |   28.6 µs ±4% |   28.1 µs ±3% |   28.8 µs ±4% |
| p90        |  **25.4 µs ±9%** |  45.1 µs ±7% |  31.9 µs ±12% |   32.2 µs ±7% |   30.9 µs ±9% |
| p99        | **31.3 µs ±15%** | 56.1 µs ±10% |  40.8 µs ±17% |   43.8 µs ±9% |   42.1 µs ±7% |
| p99.9      | **61.6 µs ±49%** |   424 µs ±9% |   405 µs ±11% |   357 µs ±32% |   190 µs ±48% |
| max        | **546 µs ±470%** | 3.34 ms ±77% | 1.11 ms ±144% | 2.78 ms ±346% | 1.19 ms ±347% |

**Bun 1.4: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |               pg |    pg (named) |   postgres.js |          Bun.sql |
| --------------------------------------------------------------------------- | ---------------: | ---------------: | ------------: | ------------: | ---------------: |
| fetch 100k rows                                                             | **23.84 ms ±3%** |     92.28 ms ±9% | 93.52 ms ±20% |  80.14 ms ±5% |     32.60 ms ±1% |
| fetch 1M rows (one result)                                                  |  **284 ms ±13%** |       961 ms ±6% |  1055 ms ±11% |    951 ms ±2% |       388 ms ±3% |
| wide rows: 1k rows × 100 columns                                            | **2.72 ms ±12%** |     11.08 ms ±2% |  11.28 ms ±8% |  10.37 ms ±8% |     8.72 ms ±14% |
| large values: 10 × 1 MB text                                                |      5.29 ms ±2% |      5.39 ms ±9% |   5.06 ms ±6% |   5.25 ms ±4% |  **4.39 ms ±7%** |
| large values: 10 × 1 MB bytea                                               | **4.34 ms ±12%** |     11.73 ms ±2% | 11.95 ms ±12% |  11.77 ms ±3% |     11.22 ms ±1% |
| large values: 20 × 200 KB jsonb                                             |     17.35 ms ±3% |     17.16 ms ±2% | 17.30 ms ±14% | 17.63 ms ±10% | **16.97 ms ±1%** |
| arrays: 1k rows of int4[100] + text[20]                                     |  **3.28 ms ±3%** |     18.54 ms ±6% |  18.29 ms ±7% |   8.03 ms ±2% |      4.93 ms ±9% |
| bulk insert 10k rows (unnest arrays)                                        |     12.90 ms ±3% |     13.18 ms ±5% |  12.82 ms ±5% |  12.93 ms ±2% | **12.77 ms ±2%** |
| bulk insert 10k rows (unnest, JS array parameters)                          | **12.83 ms ±4%** |     15.72 ms ±2% |  15.49 ms ±3% |  15.24 ms ±2% |     15.00 ms ±5% |
| bulk insert 1k rows (unnest, JS array parameters)                           |  **1.50 ms ±4%** |     1.82 ms ±10% |   1.72 ms ±4% |   1.69 ms ±3% |      1.60 ms ±6% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     13.06 ms ±4% | **12.81 ms ±2%** |  12.94 ms ±2% | 12.98 ms ±12% |              n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **254 ms ±2%** |      1044 ms ±8% |   1011 ms ±6% |    829 ms ±3% |              n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **542 ms ±2%** |       689 ms ±2% |    682 ms ±3% |    660 ms ±2% |              n/a |

**Bun 1.4: rows per second (median)**

| Scenario                                           |        quarry |          pg | pg (named) | postgres.js |     Bun.sql |
| -------------------------------------------------- | ------------: | ----------: | ---------: | ----------: | ----------: |
| fetch 1k rows (6 columns)                          | **3,473,078** |     896,437 |  1,019,712 |   1,024,249 |   2,487,630 |
| fetch 100k rows                                    | **4,029,950** |   1,064,726 |  1,065,719 |   1,240,283 |   2,980,027 |
| fetch 1M rows (one result)                         | **3,530,968** |   1,026,007 |    947,724 |   1,056,807 |   2,182,134 |
| wide rows: 1k rows × 100 columns                   |   **319,747** |      90,162 |     88,298 |      95,324 |     112,075 |
| arrays: 1k rows of int4[100] + text[20]            |   **288,918** |      54,007 |     54,209 |     126,428 |     197,285 |
| stream 1M rows with a cursor (1000 per batch)      | **3,873,666** |     961,707 |    986,131 |   1,183,639 |         n/a |
| bulk insert 10k rows (unnest arrays)               |       769,992 |     750,956 |    768,427 |     768,935 | **778,963** |
| bulk insert 10k rows (unnest, JS array parameters) |   **775,999** |     627,925 |    636,662 |     649,644 |     658,602 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **668,440** |     535,645 |    565,667 |     587,567 |     605,502 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       758,517 | **775,011** |    762,372 |     747,749 |         n/a |

**Bun 1.4: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |    pg | pg (named) | postgres.js | Bun.sql |
| ------------------------------------------------- | ------: | ----: | ---------: | ----------: | ------: |
| fetch 100k rows × 5                               |     142 |   206 |        208 |         146 | **117** |
| fetch 1M rows (one result) × 3                    | **589** | 1,264 |      1,263 |         762 |     616 |
| wide rows: 1k rows × 100 columns × 50             |     100 |   111 |        112 |          83 |  **61** |
| large values: 10 × 1 MB text × 20                 |     124 |   159 |        168 |         137 |  **86** |
| large values: 10 × 1 MB bytea × 20                |     126 |   212 |        211 |         139 |  **70** |
| large values: 20 × 200 KB jsonb × 10              |     110 |   133 |        140 |         105 |  **70** |
| arrays: 1k rows of int4[100] + text[20] × 50      |      75 |    94 |         97 |          93 |  **56** |
| stream 1M rows with a cursor (1000 per batch) × 3 |      69 |    67 |         68 |      **67** |     n/a |

**Bun 1.4: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    | quarry |    pg | pg (named) | postgres.js | Bun.sql |
| --------------------------------------------------------------------------- | -----: | ----: | ---------: | ----------: | ------: |
| point lookup by primary key                                                 |     61 |    63 |         64 |          55 |  **48** |
| fetch 100k rows                                                             |    219 |   290 |        303 |     **182** |     199 |
| fetch 1M rows (one result)                                                  |  1,155 | 1,481 |      1,268 |     **855** |     858 |
| stream 1M rows with a cursor (1000 per batch)                               |     71 |    68 |     **67** |          67 |     n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) | **58** |    63 |         63 |          59 |     n/a |
| large values: 10 × 1 MB text                                                |    167 |   238 |        245 |         173 | **156** |
| large values: 10 × 1 MB bytea                                               |    160 |   244 |        251 |         184 | **136** |
| large values: 20 × 200 KB jsonb                                             |    125 |   184 |        194 |         130 |  **80** |

**Bun 1.4: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |    quarry |    pg | pg (named) | postgres.js | Bun.sql |
| ----------------------- | --------: | ----: | ---------: | ----------: | ------: |
| RSS growth during pause | **-22.8** | -12.9 |      -13.2 |       -15.4 |     n/a |

**Bun 1.4: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |      quarry | quarry (lossless) |       pg | pg (named) | postgres.js |  Bun.sql |
| -------------------- | ----------: | ----------------: | -------: | ---------: | ----------: | -------: |
| int4                 |      77 ±1% |        **76 ±1%** | 173 ±25% |    171 ±4% |    157 ±15% | 105 ±16% |
| int8                 |      93 ±1% |        **82 ±3%** |  189 ±2% |   197 ±16% |    163 ±19% |  122 ±8% |
| float8               |      81 ±1% |        **81 ±5%** | 200 ±23% |    207 ±3% |     175 ±3% | 114 ±28% |
| numeric              | **137 ±2%** |           138 ±1% |  173 ±6% |   181 ±14% |     167 ±1% |  141 ±3% |
| text                 |  **98 ±3%** |           100 ±7% | 180 ±21% |    186 ±8% |     161 ±6% |  125 ±3% |
| bool                 |  **84 ±9%** |            84 ±6% | 160 ±11% |   153 ±15% |     140 ±3% |   91 ±2% |
| timestamptz          |  **92 ±2%** |           162 ±1% | 451 ±21% |    446 ±4% |     373 ±7% |  165 ±6% |
| date                 | **111 ±1%** |          113 ±13% | 328 ±17% |    349 ±9% |     259 ±7% |  203 ±7% |
| uuid                 | **129 ±3%** |           129 ±1% | 172 ±17% |    190 ±8% |     165 ±9% |  131 ±4% |
| jsonb (small object) | **292 ±2%** |          313 ±15% | 448 ±12% |    446 ±7% |    400 ±18% |  304 ±2% |
| int4[5]              | **258 ±6%** |           259 ±2% |  820 ±6% |    790 ±6% |     434 ±2% |  379 ±1% |
| bytea (16 B)         |     134 ±6% |       **131 ±2%** | 536 ±18% |   453 ±14% |    463 ±24% |  137 ±2% |

**Bun 1.4: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |           quarry |           pg |   pg (named) | postgres.js |      Bun.sql |
| -------------------------------------------------- | ---------------: | -----------: | -----------: | ----------: | -----------: |
| insert one row                                     |   **39,605 ±1%** |   26,371 ±1% |   35,691 ±3% |  33,636 ±3% |   33,479 ±3% |
| insert one row, concurrency 50                     | **225,028 ±29%** |  95,809 ±14% | 106,261 ±14% |  63,923 ±4% |  144,441 ±1% |
| multi-row insert: 100 rows, 300 parameters         |    **5,142 ±3%** |    3,206 ±8% |    4,740 ±2% |   3,991 ±2% |    4,920 ±2% |
| bulk insert 10k rows (unnest arrays)               |         77.0 ±4% |     75.1 ±5% |     76.8 ±4% |    76.9 ±3% | **77.9 ±3%** |
| bulk insert 10k rows (unnest, JS array parameters) |    **77.6 ±10%** |     62.8 ±2% |     63.7 ±4% |    65.0 ±3% |     65.9 ±7% |
| bulk insert 1k rows (unnest, JS array parameters)  |      **668 ±5%** |      536 ±9% |      566 ±6% |     588 ±2% |      606 ±6% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |         75.9 ±3% | **77.5 ±2%** |     76.2 ±3% |    74.8 ±5% |          n/a |
| update one row by primary key                      |  **34,016 ±17%** |   22,392 ±1% |   30,410 ±5% | 30,351 ±12% |   29,177 ±5% |
| upsert (insert … on conflict do update)            |   **33,076 ±1%** |  23,152 ±15% |   30,241 ±5% |  29,228 ±2% |   27,840 ±5% |
| delete one row by primary key                      |   **40,033 ±4%** |   27,082 ±2% |   36,308 ±8% |  34,949 ±6% |   34,450 ±1% |

**Bun 1.4: transactions, operations/s**

| Scenario                                         |          quarry |          pg | pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------ | --------------: | ----------: | ---------: | ----------: | ----------: |
| transaction: begin; select 1; commit             | **22,799 ±19%** |  15,923 ±1% | 15,935 ±2% |  13,861 ±1% | 11,396 ±16% |
| transaction: begin; insert; commit               |  **20,396 ±3%** | 12,893 ±14% | 15,015 ±3% |  13,075 ±3% | 10,178 ±28% |
| transaction with 5 savepoints (select 1 in each) |   **4,144 ±7%** |   2,716 ±7% |  2,874 ±1% |   3,341 ±1% |   1,985 ±8% |

**Bun 1.4: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | postgres.js |  Bun.sql |
| ------------------------------------------------------ | ---------: | ------: | ---------: | ----------: | -------: |
| select 1                                               |   **11.1** |    15.1 |       13.5 |        14.0 |     13.7 |
| point lookup by primary key                            |   **11.9** |    20.2 |       17.6 |        16.7 |     16.9 |
| fetch 1k rows (6 columns)                              |    **247** |   1,059 |        958 |         892 |      351 |
| fetch 100k rows                                        | **28,580** | 108,161 |    108,696 |      91,316 |   38,299 |
| insert one row                                         |   **11.6** |    15.9 |       14.5 |        16.0 |     16.4 |
| insert one row, concurrency 50                         |    **4.3** |    10.7 |        9.9 |        16.0 |      7.5 |
| transaction: begin; insert; commit                     |   **29.0** |    46.0 |       42.6 |        46.9 |     46.0 |
| query that fails (division by zero), connection reused |       25.8 |     429 |        471 |        30.3 | **18.6** |

**Bun 1.4: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | Bun.sql |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | ------: |
| select 1                             |      9.8 | 11.8 |    **9.8** |        11.9 |    12.1 |
| point lookup by primary key          | **13.8** | 26.4 |       14.1 |        14.3 |    16.6 |
| fetch 1k rows (6 columns)            |  **250** |  381 |        359 |         380 |     358 |
| 100 parameters (id in (…)), 100 rows |      187 |  245 |        186 |     **185** |     198 |
| insert one row                       | **14.3** | 24.6 |       14.5 |        14.7 |    17.0 |
| insert one row, concurrency 50       | **12.3** | 32.8 |       18.5 |        15.1 |    13.7 |
| transaction: begin; insert; commit   | **25.2** | 42.3 |       30.8 |        31.2 |    47.2 |

**Bun 1.4: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |    quarry |    pg | pg (named) | postgres.js | Bun.sql |
| -------------------------------------------------- | --------: | ----: | ---------: | ----------: | ------: |
| point lookup by primary key: p99                   |   **0.1** |   0.2 |        0.3 |         0.4 |     0.2 |
| point lookup by primary key: max                   |   **0.1** |   0.2 |        0.3 |         0.4 |     0.2 |
| insert one row, concurrency 50: p99                |   **0.5** |   0.5 |        0.5 |         1.3 |     0.8 |
| insert one row, concurrency 50: max                |   **0.5** |   0.5 |        0.5 |         1.3 |     0.8 |
| fetch 1k rows (6 columns): p99                     |       0.3 |   0.9 |        1.0 |         1.5 | **0.2** |
| fetch 1k rows (6 columns): max                     |       0.3 |   0.9 |        1.0 |         1.5 | **0.2** |
| fetch 100k rows: p99                               |  **12.3** |  95.1 |       93.0 |        76.5 |    15.0 |
| fetch 100k rows: max                               |  **15.8** |  95.1 |       93.0 |        76.5 |    20.0 |
| fetch 1M rows (one result): p99                    | **335.6** | 991.1 |    1,044.3 |       974.0 |   617.6 |
| fetch 1M rows (one result): max                    | **335.6** | 991.1 |    1,044.3 |       974.0 |   617.6 |
| stream 1M rows with a cursor (1000 per batch): p99 |   **0.5** |   1.0 |        1.0 |         0.7 |     n/a |
| stream 1M rows with a cursor (1000 per batch): max |   **1.0** |   1.6 |        1.5 |         1.3 |     n/a |

**Bun 1.4: connections (median time per operation)**

| Scenario                                                    |          quarry |          pg |  pg (named) |  postgres.js |         Bun.sql |
| ----------------------------------------------------------- | --------------: | ----------: | ----------: | -----------: | --------------: |
| connect + select 1 + close (no TLS, trust)                  |     2.38 ms ±2% | 3.89 ms ±2% | 3.95 ms ±1% |  6.60 ms ±8% | **2.31 ms ±6%** |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | **2.54 ms ±4%** | 5.03 ms ±3% | 4.90 ms ±4% |  7.33 ms ±3% |     2.99 ms ±5% |
| connect + select 1 + close (TLS verify-full, trust)         |     4.41 ms ±6% | 4.34 ms ±5% | 4.30 ms ±4% |  7.43 ms ±2% | **3.73 ms ±6%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |     4.69 ms ±3% | 5.76 ms ±6% | 5.69 ms ±1% |  8.00 ms ±1% | **4.22 ms ±5%** |
| pool warm-up: new pool (max 10), 10 concurrent select 1     | **7.83 ms ±4%** | 8.59 ms ±4% | 8.65 ms ±2% | 15.10 ms ±4% |     7.86 ms ±1% |

**Bun 1.4: cancellation, notifications, errors**

| Scenario                                      |      quarry |        pg | pg (named) | postgres.js |       Bun.sql |
| --------------------------------------------- | ----------: | --------: | ---------: | ----------: | ------------: |
| cancel: time from cancel() to rejection (p50) |     1.53 ms |   1.52 ms |    1.50 ms | **1.48 ms** |       2974 ms |
| cancel: share of queries actually cancelled   |    **100%** |  **100%** |   **100%** |    **100%** |            0% |
| NOTIFY latency p50                            | **28.1 µs** |   36.1 µs |    31.0 µs |     31.3 µs |       34.1 µs |
| NOTIFY latency p99                            | **46.0 µs** |   62.4 µs |    50.2 µs |     48.9 µs |       49.6 µs |
| NOTIFY throughput (notifications/s)           |   2,423,924 | 1,868,464 |  1,984,716 |   1,584,642 | **2,439,989** |
| error path: failing queries/s                 |      28,995 |       436 |        412 |      24,773 |    **32,644** |

**Bun 1.4: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |                Bun.sql |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: | ---------------------: |
| select 1                                | 49,907 / 36,419 / +37% |  43,644 / 40,799 / +7% |   38,410 / 39,053 / -2% |  38,079 / 38,556 / -1% |
| point lookup by primary key             | 40,503 / 20,961 / +93% | 33,227 / 23,501 / +41% | 33,578 / 15,452 / +117% | 33,129 / 21,586 / +53% |
| range scan, 100 rows                    |  11,805 / 7,695 / +53% |    6,785 / 6,379 / +6% |    6,909 / 5,534 / +25% |  10,739 / 9,133 / +18% |
| fetch 1k rows (6 columns)               |  3,473 / 1,674 / +107% |     1,020 / 896 / +14% |     1,024 / 1,041 / -2% |    2,488 / 2,457 / +1% |
| 100 parameters (id in (…)), 100 rows    |   4,487 / 3,431 / +31% |   4,184 / 3,211 / +30% |    4,114 / 2,958 / +39% |   4,235 / 3,464 / +22% |
| 1000 parameters (id in (…)), 1000 rows  |       527 / 411 / +28% |       488 / 390 / +25% |        477 / 386 / +24% |       528 / 442 / +19% |
| insert one row                          | 39,605 / 28,153 / +41% | 35,691 / 26,371 / +35% | 33,636 / 16,136 / +108% | 33,479 / 24,272 / +38% |
| upsert (insert … on conflict do update) | 33,076 / 24,420 / +35% | 30,241 / 23,152 / +31% |  29,228 / 15,192 / +92% | 27,840 / 22,202 / +25% |

**Bun 1.4: quarry decoding modes (time per op)**

| Scenario                                |           quarry | quarry (lossless) |
| --------------------------------------- | ---------------: | ----------------: |
| point lookup by primary key             |  **24.0 µs ±4%** |       24.6 µs ±3% |
| fetch 1k rows (6 columns)               |   **264 µs ±2%** |        336 µs ±7% |
| fetch 100k rows                         | **23.84 ms ±3%** |      29.98 ms ±1% |
| fetch 1M rows (one result)              |  **284 ms ±13%** |       303 ms ±12% |
| wide rows: 1k rows × 100 columns        | **2.72 ms ±12%** |       3.32 ms ±2% |
| arrays: 1k rows of int4[100] + text[20] |  **3.28 ms ±3%** |       3.31 ms ±5% |
| decode 100k × int8                      |      9.25 ms ±1% |   **8.15 ms ±3%** |
| decode 100k × timestamptz               |  **9.15 ms ±2%** |      16.23 ms ±1% |
| decode 100k × date                      | **11.10 ms ±1%** |     11.25 ms ±13% |

## Deno 2.9

**Deno 2.9: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | -----------------------: |
| select 1                                                      |  **23.0 µs ±8%** |  29.7 µs ±1% | 29.8 µs ±16% |  32.4 µs ±2% |              37.0 µs ±6% |
| point lookup by primary key                                   |  **27.6 µs ±2%** |  52.5 µs ±3% |  39.1 µs ±2% |  36.7 µs ±7% |              72.0 µs ±2% |
| range scan, 100 rows                                          |  **91.3 µs ±2%** |   201 µs ±2% |   195 µs ±2% |  160 µs ±12% |               965 µs ±6% |
| fetch 1k rows (6 columns)                                     |   **318 µs ±1%** | 1.46 ms ±16% | 1.44 ms ±16% |  1.00 ms ±3% |             7.34 ms ±25% |
| 100 parameters (id in (…)), 100 rows                          |   **232 µs ±3%** |   345 µs ±3% |  283 µs ±35% |   280 µs ±4% |              748 µs ±23% |
| 1000 parameters (id in (…)), 1000 rows                        |  **1.98 ms ±3%** | 2.90 ms ±13% |  2.28 ms ±8% | 2.43 ms ±11% |              6.51 ms ±4% |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **1.75 ms ±21%** |  2.15 ms ±2% |  1.94 ms ±1% |  1.96 ms ±6% |              5.52 ms ±7% |
| insert one row                                                |  **27.3 µs ±3%** |  43.3 µs ±5% |  34.3 µs ±2% |  38.5 µs ±3% |              56.6 µs ±1% |
| multi-row insert: 100 rows, 300 parameters                    |   **199 µs ±5%** |   365 µs ±4% |   274 µs ±5% |  392 µs ±12% |              437 µs ±27% |
| update one row by primary key                                 |  **32.2 µs ±5%** |  51.3 µs ±4% | 38.7 µs ±10% |  41.1 µs ±3% |              63.0 µs ±2% |
| upsert (insert … on conflict do update)                       |  **32.9 µs ±6%** |  49.3 µs ±2% | 39.8 µs ±35% |  41.9 µs ±3% |              61.4 µs ±3% |
| delete one row by primary key                                 |  **26.7 µs ±1%** |  43.1 µs ±2% | 34.0 µs ±10% |  35.1 µs ±3% |              55.0 µs ±3% |
| transaction: begin; select 1; commit                          |  **50.4 µs ±1%** |  75.6 µs ±2% | 78.7 µs ±16% | 89.0 µs ±20% |              93.5 µs ±3% |
| transaction: begin; insert; commit                            |  **56.6 µs ±4%** |  93.3 µs ±3% |  81.7 µs ±3% |  96.9 µs ±2% |              113 µs ±10% |
| transaction with 5 savepoints (select 1 in each)              |   **278 µs ±3%** |  434 µs ±12% |   437 µs ±5% |   365 µs ±9% |              528 µs ±10% |
| query that fails (division by zero), connection reused        |  **34.5 µs ±7%** |  2.41 ms ±3% |  2.50 ms ±6% |  99.9 µs ±2% |              41.3 µs ±3% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **33.0 µs ±1%** |  45.5 µs ±2% |  42.0 µs ±3% |  41.1 µs ±3% |                      n/a |

**Deno 2.9: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ----------: | -----------------------: |
| select 1                                                      |  **40,940 ±5%** |  30,988 ±3% | 31,158 ±17% |  28,338 ±3% |               24,557 ±9% |
| point lookup by primary key                                   |  **34,012 ±3%** | 18,013 ±11% | 23,303 ±10% |  24,721 ±7% |               12,707 ±7% |
| range scan, 100 rows                                          |  **10,436 ±8%** |   4,679 ±3% |   4,863 ±3% |  5,495 ±10% |                  968 ±2% |
| fetch 1k rows (6 columns)                                     |   **2,965 ±3%** |    682 ±16% |    675 ±11% |     846 ±4% |                 117 ±13% |
| 100 parameters (id in (…)), 100 rows                          |   **4,128 ±4%** |   2,720 ±5% |  3,244 ±23% |   3,296 ±5% |               1,155 ±15% |
| 1000 parameters (id in (…)), 1000 rows                        |     **490 ±4%** |    332 ±10% |     428 ±8% |    390 ±10% |                  154 ±4% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |    **562 ±18%** |     457 ±2% |     502 ±2% |     482 ±7% |                 180 ±10% |
| insert one row                                                |  **34,380 ±6%** |  21,498 ±4% |  26,553 ±1% |  23,653 ±5% |               16,038 ±3% |
| multi-row insert: 100 rows, 300 parameters                    |   **4,767 ±5%** |   2,575 ±4% |   3,502 ±6% |  2,384 ±10% |               1,803 ±19% |
| update one row by primary key                                 | **29,312 ±11%** |  18,237 ±5% |  24,006 ±8% |  22,743 ±3% |               14,896 ±6% |
| upsert (insert … on conflict do update)                       |  **28,307 ±3%** |  19,212 ±2% | 22,295 ±20% |  22,206 ±2% |               14,984 ±3% |
| delete one row by primary key                                 |  **35,459 ±1%** |  22,029 ±2% |  26,749 ±8% |  26,162 ±7% |               16,503 ±3% |
| transaction: begin; select 1; commit                          |  **18,568 ±3%** |  12,453 ±4% | 11,900 ±15% | 10,271 ±15% |                9,884 ±4% |
| transaction: begin; insert; commit                            |  **16,633 ±3%** |  10,107 ±5% |  11,317 ±2% |   9,381 ±2% |               8,046 ±10% |
| transaction with 5 savepoints (select 1 in each)              |   **3,451 ±2%** |  2,193 ±11% |   2,187 ±3% |  2,513 ±11% |                1,776 ±9% |
| query that fails (division by zero), connection reused        |  **26,625 ±7%** |     406 ±5% |     387 ±5% |   8,880 ±3% |               20,994 ±7% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **28,509 ±1%** |  20,332 ±6% |  22,141 ±3% | 21,985 ±19% |                      n/a |

**Deno 2.9: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ----------: | -----------------------: |
| select 1                                                      | **34.0 µs** | 58.1 µs |     59.3 µs |     55.9 µs |                   109 µs |
| point lookup by primary key                                   | **41.7 µs** |  101 µs |     85.4 µs |     65.0 µs |                   173 µs |
| range scan, 100 rows                                          |  **153 µs** |  317 µs |      293 µs |      364 µs |                  1.98 ms |
| fetch 1k rows (6 columns)                                     |  **526 µs** | 2.35 ms |     2.12 ms |     5.61 ms |                 14.37 ms |
| 100 parameters (id in (…)), 100 rows                          |  **335 µs** |  611 µs |      537 µs |      420 µs |                  1.82 ms |
| 1000 parameters (id in (…)), 1000 rows                        |     3.03 ms | 4.02 ms | **2.83 ms** |     6.57 ms |                 10.43 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.27 ms** | 2.67 ms |     2.40 ms |     5.31 ms |                  8.64 ms |
| insert one row                                                | **49.4 µs** | 82.7 µs |     73.2 µs |     75.0 µs |                   150 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **309 µs** |  652 µs |      431 µs |      764 µs |                  2.29 ms |
| update one row by primary key                                 | **50.1 µs** | 91.7 µs |     74.5 µs |     68.0 µs |                   150 µs |
| upsert (insert … on conflict do update)                       | **52.2 µs** | 86.1 µs |     87.4 µs |     71.2 µs |                   163 µs |
| delete one row by primary key                                 | **39.5 µs** | 76.1 µs |     68.4 µs |     62.9 µs |                   144 µs |
| transaction: begin; select 1; commit                          |  **106 µs** |  114 µs |      120 µs |      145 µs |                   204 µs |
| transaction: begin; insert; commit                            |  **121 µs** |  142 µs |      128 µs |      159 µs |                   247 µs |
| transaction with 5 savepoints (select 1 in each)              |  **417 µs** |  655 µs |      606 µs |      698 µs |                   886 µs |
| query that fails (division by zero), connection reused        | **66.7 µs** | 3.13 ms |     3.38 ms |      185 µs |                   115 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler | **64.1 µs** |  103 µs |     94.0 µs |     85.0 µs |                      n/a |

**Deno 2.9: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |         pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ---------: | ---------: | ----------: | -----------------------: |
| select 1                                                      |  **105 µs** |     132 µs |     130 µs |      287 µs |                   242 µs |
| point lookup by primary key                                   |  **184 µs** |     393 µs |     308 µs |      485 µs |                   381 µs |
| range scan, 100 rows                                          |  **359 µs** |     736 µs |     519 µs |     3.65 ms |                  4.70 ms |
| fetch 1k rows (6 columns)                                     | **2.32 ms** |    4.85 ms |    3.70 ms |     8.58 ms |                 16.44 ms |
| 100 parameters (id in (…)), 100 rows                          |  **527 µs** |     953 µs |     927 µs |     3.40 ms |                  3.73 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **4.42 ms** |    4.60 ms |    4.88 ms |     9.13 ms |                 12.39 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **3.02 ms** |    4.62 ms |    4.40 ms |    10.19 ms |                 10.39 ms |
| insert one row                                                |  **209 µs** |     237 µs |     270 µs |      494 µs |                   284 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **691 µs** |    1.01 ms |     725 µs |     1.68 ms |                  2.89 ms |
| update one row by primary key                                 |      226 µs |     393 µs | **213 µs** |      356 µs |                   273 µs |
| upsert (insert … on conflict do update)                       |      244 µs | **239 µs** |     308 µs |      429 µs |                   341 µs |
| delete one row by primary key                                 |      179 µs |     186 µs | **175 µs** |      425 µs |                   259 µs |
| transaction: begin; select 1; commit                          |  **255 µs** |     624 µs |     883 µs |     2.11 ms |                   457 µs |
| transaction: begin; insert; commit                            |  **360 µs** |    1.13 ms |     626 µs |     1.79 ms |                   558 µs |
| transaction with 5 savepoints (select 1 in each)              |  **665 µs** |    5.36 ms |    4.19 ms |     5.15 ms |                  4.30 ms |
| query that fails (division by zero), connection reused        |  **131 µs** |    3.66 ms |    5.16 ms |      823 µs |                   323 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **266 µs** |     361 µs |     330 µs |      635 µs |                      n/a |

**Deno 2.9: latency distribution, select 1**

| Percentile |           quarry |            pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | ---------------: | ------------: | -----------: | -----------: | -----------------------: |
| p50        |  **23.0 µs ±8%** |   29.7 µs ±1% | 29.8 µs ±16% |  32.4 µs ±2% |              37.0 µs ±6% |
| p90        |  **25.9 µs ±4%** |   33.9 µs ±2% | 34.2 µs ±39% |  37.5 µs ±6% |             43.6 µs ±17% |
| p99        | **34.0 µs ±17%** |   58.1 µs ±7% | 59.3 µs ±45% | 55.9 µs ±13% |               109 µs ±7% |
| p99.9      |  **105 µs ±13%** |   132 µs ±28% |  130 µs ±31% |  287 µs ±41% |              242 µs ±25% |
| max        | **2.16 ms ±77%** | 2.98 ms ±160% | 3.89 ms ±45% | 7.69 ms ±10% |            3.43 ms ±104% |

**Deno 2.9: latency distribution, point lookup by primary key**

| Percentile |          quarry |               pg |    pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | --------------: | ---------------: | ------------: | -----------: | -----------------------: |
| p50        | **27.6 µs ±2%** |      52.5 µs ±3% |   39.1 µs ±2% |  36.7 µs ±7% |              72.0 µs ±2% |
| p90        | **30.9 µs ±7%** |     59.5 µs ±37% |  46.1 µs ±35% | 42.8 µs ±17% |             87.1 µs ±17% |
| p99        | **41.7 µs ±6%** |      101 µs ±54% |   85.4 µs ±8% | 65.0 µs ±14% |               173 µs ±7% |
| p99.9      | **184 µs ±36%** |      393 µs ±37% |   308 µs ±32% |  485 µs ±33% |              381 µs ±23% |
| max        |    6.17 ms ±65% | **2.67 ms ±35%** | 3.60 ms ±174% | 5.23 ms ±57% |            3.82 ms ±255% |

**Deno 2.9: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |            pg |       pg (named) |   postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ---------------: | ------------: | ---------------: | ------------: | -----------------------: |
| fetch 100k rows                                                             | **39.05 ms ±3%** |    132 ms ±6% |       128 ms ±4% |    103 ms ±7% |               826 ms ±6% |
| fetch 1M rows (one result)                                                  |  **458 ms ±20%** |   1381 ms ±4% |      1453 ms ±5% |  1022 ms ±23% |              8903 ms ±3% |
| wide rows: 1k rows × 100 columns                                            | **4.02 ms ±16%** |  16.22 ms ±4% |     15.98 ms ±7% |  16.53 ms ±9% |             83.80 ms ±6% |
| large values: 10 × 1 MB text                                                |     9.71 ms ±38% | 10.10 ms ±10% |     9.71 ms ±12% | 10.39 ms ±23% |         **7.59 ms ±18%** |
| large values: 10 × 1 MB bytea                                               | **3.44 ms ±21%** | 19.66 ms ±21% |    19.02 ms ±21% |  18.26 ms ±6% |               388 ms ±2% |
| large values: 20 × 200 KB jsonb                                             |    21.79 ms ±13% | 22.82 ms ±10% |     22.11 ms ±8% | 22.12 ms ±15% |        **19.11 ms ±16%** |
| arrays: 1k rows of int4[100] + text[20]                                     |  **3.28 ms ±6%** |  25.53 ms ±6% |     25.26 ms ±4% |   9.54 ms ±5% |             31.75 ms ±3% |
| bulk insert 10k rows (unnest arrays)                                        |     13.12 ms ±3% | 13.20 ms ±16% |     13.17 ms ±6% |  13.29 ms ±2% |        **13.09 ms ±23%** |
| bulk insert 10k rows (unnest, JS array parameters)                          | **13.92 ms ±3%** | 16.14 ms ±15% |     15.78 ms ±3% | 15.94 ms ±14% |             16.26 ms ±8% |
| bulk insert 1k rows (unnest, JS array parameters)                           | **1.62 ms ±15%** |   1.92 ms ±4% |      1.79 ms ±2% |  1.85 ms ±15% |              1.79 ms ±2% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     12.90 ms ±2% | 12.93 ms ±18% | **12.89 ms ±1%** | 55.98 ms ±<1% |                      n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **306 ms ±3%** |   1329 ms ±3% |      1350 ms ±3% |   1121 ms ±2% |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **729 ms ±2%** |    905 ms ±2% |       900 ms ±2% |    857 ms ±3% |                      n/a |

**Deno 2.9: rows per second (median)**

| Scenario                                           |        quarry |      pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | ------------: | ------: | ----------: | ----------: | -----------------------: |
| fetch 1k rows (6 columns)                          | **2,964,691** | 682,370 |     674,605 |     846,407 |                  117,149 |
| fetch 100k rows                                    | **2,599,500** | 740,153 |     752,750 |     928,613 |                  121,089 |
| fetch 1M rows (one result)                         | **2,223,954** | 703,686 |     680,138 |     972,564 |                  113,758 |
| wide rows: 1k rows × 100 columns                   |   **207,936** |  60,235 |      61,306 |      58,831 |                   11,971 |
| arrays: 1k rows of int4[100] + text[20]            |   **292,382** |  37,626 |      37,985 |      95,920 |                   30,801 |
| stream 1M rows with a cursor (1000 per batch)      | **3,164,356** | 740,026 |     735,564 |     889,981 |                      n/a |
| bulk insert 10k rows (unnest arrays)               |       759,492 | 750,298 |     756,311 |     748,804 |              **760,349** |
| bulk insert 10k rows (unnest, JS array parameters) |   **705,994** | 609,159 |     623,695 |     623,405 |                  601,646 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **614,899** | 508,664 |     551,392 |     507,676 |                  558,864 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       771,783 | 761,884 | **775,434** |     179,035 |                      n/a |

**Deno 2.9: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| fetch 100k rows × 5                               | **271** |     299 |        300 |         290 |                      359 |
| fetch 1M rows (one result) × 3                    | **965** |   1,371 |      1,368 |       1,065 |                    1,462 |
| wide rows: 1k rows × 100 columns × 50             |     202 | **162** |        162 |         265 |                      236 |
| large values: 10 × 1 MB text × 20                 |     248 | **233** |        248 |         239 |                      239 |
| large values: 10 × 1 MB bytea × 20                | **187** |     278 |        255 |         213 |                      231 |
| large values: 20 × 200 KB jsonb × 10              |     208 |     166 |    **162** |         237 |                      209 |
| arrays: 1k rows of int4[100] + text[20] × 50      |     188 |     268 |        268 |         205 |                  **168** |
| stream 1M rows with a cursor (1000 per batch) × 3 |  **95** |     151 |        150 |         163 |                      n/a |

**Deno 2.9: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    |  quarry |    pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ------: | ----: | ---------: | ----------: | -----------------------: |
| point lookup by primary key                                                 |      76 |    76 |     **75** |         137 |                       79 |
| fetch 100k rows                                                             |     417 |   454 |        453 |         382 |                  **358** |
| fetch 1M rows (one result)                                                  |   1,399 | 1,348 |      1,371 |   **1,065** |                    1,458 |
| stream 1M rows with a cursor (1000 per batch)                               |  **96** |   151 |        150 |         163 |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |  **85** |   102 |        102 |         152 |                      n/a |
| large values: 10 × 1 MB text                                                |     259 |   285 |        280 |     **248** |                      254 |
| large values: 10 × 1 MB bytea                                               | **209** |   263 |        262 |         225 |                      229 |
| large values: 20 × 200 KB jsonb                                             |     218 |   206 |    **205** |         274 |                      217 |

**Deno 2.9: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |  quarry |  pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ----------------------- | ------: | --: | ---------: | ----------: | -----------------------: |
| RSS growth during pause | **0.1** | 0.2 |        0.2 |         0.3 |                      n/a |

**Deno 2.9: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry |         pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------- | -----------: | ---------: | ---------: | ----------: | -----------------------: |
| int4                 |   **76 ±1%** |    259 ±8% |    260 ±7% |     236 ±5% |                3,802 ±4% |
| int8                 |   **95 ±5%** |    275 ±5% |    265 ±8% |     231 ±4% |                3,858 ±3% |
| float8               |   **81 ±2%** |    262 ±5% |   267 ±35% |    280 ±12% |                3,714 ±6% |
| numeric              |  **142 ±6%** |    216 ±5% |    223 ±3% |    235 ±11% |                3,614 ±4% |
| text                 |  **103 ±9%** |    237 ±6% |    244 ±9% |     236 ±4% |                3,660 ±4% |
| bool                 |   **83 ±1%** |    196 ±3% |    198 ±4% |     194 ±6% |                3,663 ±4% |
| timestamptz          | **134 ±10%** |    716 ±2% |   741 ±18% |     465 ±8% |                4,750 ±7% |
| date                 |  **113 ±1%** |    523 ±2% |    532 ±5% |    383 ±17% |               3,981 ±35% |
| uuid                 | **129 ±31%** |    242 ±7% |    235 ±1% |    277 ±13% |                3,744 ±4% |
| jsonb (small object) |  **382 ±5%** |    486 ±3% |    493 ±2% |     491 ±7% |                4,358 ±3% |
| int4[5]              |  **259 ±6%** | 1,188 ±17% |  1,166 ±5% |     621 ±2% |                5,196 ±5% |
| bytea (16 B)         |  **376 ±5%** |    418 ±2% |   424 ±17% |    420 ±14% |                5,303 ±9% |

**Deno 2.9: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |          quarry |         pg |   pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | --------------: | ---------: | -----------: | ----------: | -----------------------: |
| insert one row                                     |  **34,380 ±6%** | 21,498 ±4% |   26,553 ±1% |  23,653 ±5% |               16,038 ±3% |
| insert one row, concurrency 50                     | **226,324 ±8%** | 70,874 ±9% |   65,484 ±2% |  54,376 ±5% |              20,517 ±20% |
| multi-row insert: 100 rows, 300 parameters         |   **4,767 ±5%** |  2,575 ±4% |    3,502 ±6% |  2,384 ±10% |               1,803 ±19% |
| bulk insert 10k rows (unnest arrays)               |        75.9 ±5% |  75.0 ±14% |     75.6 ±5% |    74.9 ±2% |            **76.0 ±21%** |
| bulk insert 10k rows (unnest, JS array parameters) |    **70.6 ±3%** |  60.9 ±11% |     62.4 ±2% |   62.3 ±16% |                 60.2 ±6% |
| bulk insert 1k rows (unnest, JS array parameters)  |    **615 ±15%** |    509 ±5% |      551 ±2% |    508 ±10% |                  559 ±4% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |        77.2 ±1% |  76.2 ±15% | **77.5 ±5%** |    17.9 ±1% |                      n/a |
| update one row by primary key                      | **29,312 ±11%** | 18,237 ±5% |   24,006 ±8% |  22,743 ±3% |               14,896 ±6% |
| upsert (insert … on conflict do update)            |  **28,307 ±3%** | 19,212 ±2% |  22,295 ±20% |  22,206 ±2% |               14,984 ±3% |
| delete one row by primary key                      |  **35,459 ±1%** | 22,029 ±2% |   26,749 ±8% |  26,162 ±7% |               16,503 ±3% |

**Deno 2.9: transactions, operations/s**

| Scenario                                         |         quarry |         pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------ | -------------: | ---------: | ----------: | ----------: | -----------------------: |
| transaction: begin; select 1; commit             | **18,568 ±3%** | 12,453 ±4% | 11,900 ±15% | 10,271 ±15% |                9,884 ±4% |
| transaction: begin; insert; commit               | **16,633 ±3%** | 10,107 ±5% |  11,317 ±2% |   9,381 ±2% |               8,046 ±10% |
| transaction with 5 savepoints (select 1 in each) |  **3,451 ±2%** | 2,193 ±11% |   2,187 ±3% |  2,513 ±11% |                1,776 ±9% |

**Deno 2.9: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | ----------: | -----------------------: |
| select 1                                               |   **16.0** |    22.7 |       24.9 |        29.6 |                     34.9 |
| point lookup by primary key                            |   **17.7** |    31.6 |       31.8 |        32.4 |                     71.4 |
| fetch 1k rows (6 columns)                              |    **318** |   1,339 |      1,399 |       1,246 |                    9,537 |
| fetch 100k rows                                        | **55,509** | 169,634 |    165,934 |     137,030 |                  979,974 |
| insert one row                                         |   **16.9** |    25.0 |       25.6 |        33.6 |                     55.9 |
| insert one row, concurrency 50                         |    **4.6** |    15.2 |       16.5 |        22.5 |                     54.0 |
| transaction: begin; insert; commit                     |   **40.4** |    65.3 |       65.2 |        92.2 |                      106 |
| query that fails (division by zero), connection reused |   **30.0** |     562 |        604 |         108 |                     41.7 |

**Deno 2.9: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | -----------------------: |
| select 1                             |  **9.6** | 11.9 |        9.8 |        12.9 |                     12.2 |
| point lookup by primary key          | **14.0** | 27.2 |       15.0 |        14.6 |                     34.8 |
| fetch 1k rows (6 columns)            |  **239** |  427 |        390 |         401 |                      492 |
| 100 parameters (id in (…)), 100 rows |      191 |  243 |        189 |     **186** |                      277 |
| insert one row                       | **14.5** | 24.5 |       14.7 |        14.8 |                     32.5 |
| insert one row, concurrency 50       | **12.5** | 33.0 |       18.3 |        15.8 |                     60.3 |
| transaction: begin; insert; commit   | **25.2** | 42.5 |       31.8 |        32.6 |                     52.2 |

**Deno 2.9: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |  quarry |   pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | ------: | ---: | ---------: | ----------: | -----------------------: |
| point lookup by primary key: p99                   |     0.7 |  0.8 |        0.9 |         2.5 |                  **0.5** |
| point lookup by primary key: max                   |     0.7 |  0.8 |        0.9 |         2.5 |                  **0.5** |
| insert one row, concurrency 50: p99                |     1.0 |  0.6 |    **0.5** |         2.9 |                      1.6 |
| insert one row, concurrency 50: max                |     1.0 |  0.6 |    **0.5** |         2.9 |                      1.6 |
| fetch 1k rows (6 columns): p99                     | **0.8** |  2.0 |        2.0 |         4.3 |                      4.1 |
| fetch 1k rows (6 columns): max                     | **0.8** |  2.0 |        2.0 |         4.3 |                      4.1 |
| fetch 100k rows: p99                               |    12.3 | 51.3 |       53.5 |        25.7 |                  **4.6** |
| fetch 100k rows: max                               |    14.0 | 51.3 |       53.5 |        26.5 |                  **7.6** |
| fetch 1M rows (one result): p99                    |    29.2 | 57.1 |       78.3 |        24.7 |                  **4.1** |
| fetch 1M rows (one result): max                    |    33.6 | 84.8 |       95.4 |        38.1 |                 **11.8** |
| stream 1M rows with a cursor (1000 per batch): p99 | **0.7** |  1.5 |        1.6 |         4.5 |                      n/a |
| stream 1M rows with a cursor (1000 per batch): max | **1.0** |  1.8 |        2.5 |         5.3 |                      n/a |

**Deno 2.9: connections (median time per operation)**

| Scenario                                                    |           quarry |          pg |   pg (named) |   postgres.js | deno-postgres (stock) | deno-postgres (+nodelay) |
| ----------------------------------------------------------- | ---------------: | ----------: | -----------: | ------------: | --------------------: | -----------------------: |
| connect + select 1 + close (no TLS, trust)                  | **2.39 ms ±15%** | 3.98 ms ±1% |  4.00 ms ±3% |   8.06 ms ±7% |           2.49 ms ±7% |             2.53 ms ±12% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          |  **2.63 ms ±4%** | 5.25 ms ±2% |  5.32 ms ±3% |   9.85 ms ±5% |                     — |              3.93 ms ±5% |
| connect + select 1 + close (TLS verify-full, trust)         |      4.74 ms ±6% | 4.62 ms ±5% |  4.63 ms ±6% |  52.69 ms ±4% |                     — |          **4.04 ms ±3%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |  **5.24 ms ±5%** | 6.15 ms ±2% |  6.14 ms ±3% |  56.24 ms ±1% |                     — |              5.55 ms ±3% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     | **7.88 ms ±10%** | 8.77 ms ±7% | 8.82 ms ±31% | 16.44 ms ±11% |                     — |             8.55 ms ±25% |

**Deno 2.9: cancellation, notifications, errors**

| Scenario                                      |        quarry |        pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------- | ------------: | --------: | ---------: | ----------: | -----------------------: |
| cancel: time from cancel() to rejection (p50) |   **1.54 ms** |   1.55 ms |    1.58 ms |     1.63 ms |                      n/a |
| cancel: share of queries actually cancelled   |      **100%** |  **100%** |   **100%** |    **100%** |                      n/a |
| NOTIFY latency p50                            |   **33.0 µs** |   45.5 µs |    42.0 µs |     41.1 µs |                      n/a |
| NOTIFY latency p99                            |   **64.1 µs** |    103 µs |    94.0 µs |     85.0 µs |                      n/a |
| NOTIFY throughput (notifications/s)           | **2,524,171** | 1,838,022 |  1,812,958 |   1,710,511 |                      n/a |
| error path: failing queries/s                 |    **26,625** |       406 |        387 |       8,880 |                   20,994 |

**Deno 2.9: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 40,940 / 31,724 / +29% |  31,158 / 30,988 / +1% |   28,338 / 27,976 / +1% |
| point lookup by primary key             | 34,012 / 19,113 / +78% | 23,303 / 18,013 / +29% | 24,721 / 12,043 / +105% |
| range scan, 100 rows                    |  10,436 / 6,240 / +67% |    4,863 / 4,679 / +4% |    5,495 / 4,481 / +23% |
| fetch 1k rows (6 columns)               |  2,965 / 1,241 / +139% |        675 / 682 / -1% |         846 / 840 / +1% |
| 100 parameters (id in (…)), 100 rows    |   4,128 / 3,020 / +37% |   3,244 / 2,720 / +19% |    3,296 / 2,417 / +36% |
| 1000 parameters (id in (…)), 1000 rows  |       490 / 411 / +19% |       428 / 332 / +29% |        390 / 321 / +22% |
| insert one row                          | 34,380 / 24,308 / +41% | 26,553 / 21,498 / +24% |  23,653 / 12,581 / +88% |
| upsert (insert … on conflict do update) | 28,307 / 21,479 / +32% | 22,295 / 19,212 / +16% |  22,206 / 12,154 / +83% |

**Deno 2.9: shipped defaults vs tuned (median latency)**

| Scenario                                   | deno-postgres (+nodelay) | deno-postgres (stock) |
| ------------------------------------------ | -----------------------: | --------------------: |
| select 1                                   |              **37.0 µs** |               37.0 µs |
| point lookup by primary key                |              **72.0 µs** |              44.00 ms |
| fetch 1k rows (6 columns)                  |                  7.34 ms |           **7.08 ms** |
| insert one row                             |              **56.6 µs** |              44.02 ms |
| transaction: begin; insert; commit         |                   113 µs |                     — |
| connect + select 1 + close (no TLS, trust) |                  2.53 ms |           **2.49 ms** |

## Across runtimes

**Throughput (operations/s) by runtime**

| Scenario                           | quarry (node) | pg (node) | pg (named) (node) | pg-native (node) | postgres.js (node) | neon (WS) (node) | quarry (bun) | pg (bun) | pg (named) (bun) | postgres.js (bun) | Bun.sql (bun) | quarry (deno) | pg (deno) | pg (named) (deno) | postgres.js (deno) | deno-postgres (+nodelay) (deno) |
| ---------------------------------- | ------------: | --------: | ----------------: | ---------------: | -----------------: | ---------------: | -----------: | -------: | ---------------: | ----------------: | ------------: | ------------: | --------: | ----------------: | -----------------: | ------------------------------: |
| select 1                           |        43,909 |    35,273 |            34,330 |           30,033 |             31,493 |           18,468 |       49,907 |   40,799 |           43,644 |            38,410 |        38,079 |        40,940 |    30,988 |            31,158 |             28,338 |                          24,557 |
| point lookup by primary key        |        35,676 |    18,012 |            26,315 |           18,400 |             28,119 |           11,488 |       40,503 |   23,501 |           33,227 |            33,578 |        33,129 |        34,012 |    18,013 |            23,303 |             24,721 |                          12,707 |
| fetch 1k rows (6 columns)          |         2,881 |       734 |               771 |              596 |                903 |              641 |        3,473 |      896 |            1,020 |             1,024 |         2,488 |         2,965 |       682 |               675 |                846 |                             117 |
| fetch 100k rows                    |          27.7 |       7.8 |               7.8 |              6.5 |                9.7 |              7.3 |         40.3 |     10.6 |             10.7 |              12.4 |          29.8 |          26.0 |       7.4 |               7.5 |                9.3 |                             1.2 |
| insert one row                     |        36,163 |    23,185 |            29,425 |           21,023 |             26,543 |           12,533 |       39,605 |   26,371 |           35,691 |            33,636 |        33,479 |        34,380 |    21,498 |            26,553 |             23,653 |                          16,038 |
| insert one row, concurrency 50     |       252,977 |    86,131 |            82,027 |           68,614 |             40,386 |           32,039 |      225,028 |   95,809 |          106,261 |            63,923 |       144,441 |       226,324 |    70,874 |            65,484 |             54,376 |                          20,517 |
| transaction: begin; insert; commit |        17,932 |    11,528 |            13,080 |            9,334 |             10,414 |            6,158 |       20,396 |   12,893 |           15,015 |            13,075 |        10,178 |        16,633 |    10,107 |            11,317 |              9,381 |                           8,046 |

## Concurrency sweep (Node 24): point lookups/s

**Node 24: pool size 1, point lookups/s by concurrency**

| Concurrency |          quarry | quarry (pipeline: false) |         pg |  pg (named) |   pg-native |     postgres.js |   neon (WS) |
| ----------- | --------------: | -----------------------: | ---------: | ----------: | ----------: | --------------: | ----------: |
| 1           |  **35,068 ±5%** |               34,810 ±6% | 19,701 ±2% |  26,593 ±3% |  18,828 ±2% |      28,087 ±7% |  11,725 ±3% |
| 10          | **112,822 ±3%** |               35,673 ±7% | 20,100 ±7% | 27,329 ±12% |  19,206 ±1% |     108,447 ±8% |  11,847 ±7% |
| 50          |    113,047 ±10% |               34,503 ±5% | 20,172 ±4% |  26,877 ±6% |  18,928 ±7% | **120,405 ±2%** |  11,998 ±6% |
| 100         |     117,868 ±7% |              35,583 ±12% | 20,427 ±8% |  27,423 ±3% |  19,270 ±3% | **120,579 ±5%** |  11,642 ±9% |
| 500         | **120,025 ±4%** |              32,371 ±11% | 20,824 ±2% |  26,902 ±5% |  18,755 ±4% |    110,491 ±12% |  11,962 ±3% |
| 1000        | **113,723 ±6%** |               34,942 ±3% | 20,088 ±4% |  27,127 ±3% | 19,315 ±11% |    109,121 ±10% | 12,158 ±27% |

**Node 24: pool size 1, p99 latency by concurrency**

| Concurrency |       quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | -----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           |  **39.0 µs** |                  43.0 µs |  74.6 µs |    59.0 µs |   75.7 µs |     51.7 µs |    169 µs |
| 10          |   **136 µs** |                   677 µs |  1.04 ms |     823 µs |    952 µs |      159 µs |   1.60 ms |
| 50          |      1.08 ms |                  2.29 ms |  3.98 ms |    2.93 ms |   3.73 ms |  **962 µs** |   6.42 ms |
| 100         |  **1.59 ms** |                  3.88 ms |  8.02 ms |    5.55 ms |   6.52 ms |     4.03 ms |  13.27 ms |
| 500         |  **5.62 ms** |                 18.98 ms | 33.71 ms |   25.30 ms |  35.98 ms |    10.60 ms |  49.48 ms |
| 1000        | **13.44 ms** |                 35.37 ms | 60.84 ms |   47.59 ms |  59.94 ms |    17.01 ms |  93.12 ms |

**Node 24: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg | pg (named) |   pg-native |  postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ---------: | ----------: | -----------: | ----------: |
| 1           |   **35,777 ±9%** |              35,096 ±11% |  19,740 ±2% | 26,369 ±8% |  18,745 ±6% |   27,978 ±2% |  11,799 ±4% |
| 10          |  **161,474 ±5%** |             107,775 ±24% |  65,388 ±2% | 60,407 ±8% | 59,459 ±26% |  41,496 ±18% |  30,870 ±2% |
| 50          |  **362,081 ±3%** |              105,916 ±3% | 63,296 ±10% | 60,290 ±4% | 58,286 ±11% |   40,456 ±7% |  29,112 ±6% |
| 100         |  **446,857 ±7%** |              103,343 ±2% | 64,261 ±10% | 59,460 ±1% |  56,789 ±2% |   41,408 ±5% | 28,464 ±31% |
| 500         | **468,354 ±11%** |               99,527 ±3% |  63,708 ±9% | 60,329 ±3% | 56,320 ±13% | 142,513 ±16% | 29,776 ±27% |
| 1000        | **369,475 ±26%** |              102,264 ±2% |  61,794 ±3% | 58,972 ±7% |  56,937 ±8% |  143,107 ±9% | 29,929 ±11% |

**Node 24: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **37.4 µs** |                  39.7 µs |  74.1 µs |    58.0 µs |   75.3 µs |     54.3 µs |    159 µs |
| 10          |  **134 µs** |                   192 µs |   538 µs |     627 µs |    491 µs |      458 µs |    875 µs |
| 50          |  **399 µs** |                  1.25 ms |  1.62 ms |    1.59 ms |   1.54 ms |     2.65 ms |   3.17 ms |
| 100         | **1.16 ms** |                  1.94 ms |  2.62 ms |    2.92 ms |   2.84 ms |     5.75 ms |   5.71 ms |
| 500         | **4.98 ms** |                  7.52 ms | 11.53 ms |   11.89 ms |  14.59 ms |     9.88 ms |  24.65 ms |
| 1000        | **6.03 ms** |                 15.15 ms | 23.87 ms |   24.97 ms |  22.96 ms |    13.26 ms |  42.99 ms |

**Node 24: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| 1           |   **35,814 ±2%** |               34,580 ±4% |  19,842 ±4% |  26,279 ±2% |  18,104 ±3% |  27,400 ±3% |  11,505 ±4% |
| 10          | **118,627 ±12%** |              115,938 ±3% | 65,926 ±11% |  61,118 ±3% |  58,040 ±4% | 66,111 ±14% | 29,797 ±14% |
| 50          | **320,898 ±12%** |              107,640 ±5% |  65,392 ±5% | 60,029 ±11% |  59,422 ±8% |  39,119 ±7% | 29,841 ±59% |
| 100         | **410,913 ±11%** |              95,917 ±11% |  64,722 ±7% | 58,444 ±14% | 59,904 ±11% |  41,068 ±3% |  31,587 ±7% |
| 500         |  **467,543 ±6%** |              105,341 ±8% |  63,042 ±5% | 56,141 ±23% |  57,320 ±9% | 115,989 ±8% | 30,983 ±75% |
| 1000        | **463,988 ±15%** |              100,864 ±5% |  62,387 ±6% | 59,104 ±10% |  59,446 ±5% | 137,091 ±7% | 28,424 ±33% |

**Node 24: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **38.8 µs** |                  39.7 µs |  73.7 µs |    59.1 µs |   83.1 µs |     54.1 µs |    163 µs |
| 10          |  **176 µs** |                   192 µs |   585 µs |     624 µs |    440 µs |      262 µs |    987 µs |
| 50          |  **485 µs** |                  1.26 ms |  1.56 ms |    1.72 ms |   1.47 ms |     3.12 ms |   3.08 ms |
| 100         | **1.15 ms** |                  2.04 ms |  2.67 ms |    3.86 ms |   2.64 ms |     5.98 ms |   5.24 ms |
| 500         | **5.01 ms** |                  7.40 ms | 12.52 ms |   13.65 ms |  12.34 ms |    12.70 ms |  27.91 ms |
| 1000        | **5.59 ms** |                 14.72 ms | 23.97 ms |   25.02 ms |  21.46 ms |    15.05 ms |  53.21 ms |

**Node 24: pool size 50, point lookups/s by concurrency**

| Concurrency |          quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----------- | --------------: | -----------------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| 1           |  **35,937 ±2%** |              35,347 ±13% | 19,786 ±12% | 26,436 ±11% |  18,855 ±2% | 25,915 ±14% | 11,511 ±11% |
| 10          | **117,942 ±2%** |              115,892 ±3% |  65,630 ±2% |  60,841 ±9% |  60,001 ±5% | 66,650 ±16% | 31,368 ±36% |
| 50          | **116,500 ±2%** |              111,080 ±4% |  65,493 ±4% |  58,869 ±4% | 54,765 ±14% | 58,772 ±31% | 31,662 ±26% |
| 100         | **160,526 ±3%** |               99,468 ±6% |  61,704 ±7% |  59,367 ±6% |  55,562 ±5% |  40,450 ±8% |  30,696 ±1% |
| 500         | **340,654 ±3%** |              96,515 ±35% |  63,581 ±5% |  57,225 ±9% |  55,348 ±9% |  41,159 ±8% |  29,005 ±8% |
| 1000        | **392,088 ±4%** |              91,355 ±15% |  62,214 ±3% |  55,221 ±5% |  52,826 ±8% |  42,502 ±3% | 28,810 ±26% |

**Node 24: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **37.4 µs** |                  38.8 µs |  80.5 µs |    59.9 µs |   74.1 µs |     71.3 µs |    166 µs |
| 10          |  **187 µs** |                   194 µs |   578 µs |     598 µs |    414 µs |      275 µs |    953 µs |
| 50          | **1.15 ms** |                  1.20 ms |  1.75 ms |    1.71 ms |   1.62 ms |     2.29 ms |   3.47 ms |
| 100         | **1.68 ms** |                  2.20 ms |  2.94 ms |    3.03 ms |   2.98 ms |     6.89 ms |   5.67 ms |
| 500         | **3.15 ms** |                  7.69 ms | 11.96 ms |   13.07 ms |  12.52 ms |    26.74 ms |  25.38 ms |
| 1000        | **5.22 ms** |                 16.61 ms | 23.87 ms |   26.37 ms |  25.24 ms |    49.01 ms |  45.80 ms |

## Concurrency sweep (Bun 1.4): point lookups/s

**Bun 1.4: pool size 1, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |     postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | --------------: | ----------: |
| 1           |   **39,675 ±2%** | 22,973 ±18% |      33,861 ±4% | 34,273 ±10% |
| 10          |  **114,071 ±5%** |  23,424 ±3% |     113,206 ±4% |  85,390 ±7% |
| 50          | **116,716 ±15%** |  23,595 ±8% |     116,080 ±7% | 86,480 ±22% |
| 100         |     116,747 ±12% | 23,725 ±13% | **119,906 ±2%** |  89,790 ±1% |
| 500         | **119,527 ±10%** | 22,308 ±10% |     110,123 ±2% | 89,492 ±14% |
| 1000        |  **120,969 ±6%** |  22,923 ±6% |    107,509 ±13% |  92,085 ±5% |

**Bun 1.4: pool size 1, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |  Bun.sql |
| ----------- | ----------: | -------: | ----------: | -------: |
| 1           | **33.9 µs** |  58.1 µs |     41.5 µs |  37.4 µs |
| 10          |  **116 µs** |   895 µs |      142 µs |   151 µs |
| 50          |  **555 µs** |  3.16 ms |      974 µs |  1.30 ms |
| 100         | **1.22 ms** |  5.53 ms |     1.58 ms |  1.85 ms |
| 500         | **5.58 ms** | 27.89 ms |     5.90 ms |  6.83 ms |
| 1000        | **9.54 ms** | 47.17 ms |    11.62 ms | 13.51 ms |

**Bun 1.4: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |  postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | -----------: | ----------: |
| 1           |   **38,608 ±4%** | 22,648 ±19% |   34,350 ±5% |  33,776 ±9% |
| 10          | **190,706 ±32%** | 81,007 ±13% |   63,180 ±3% | 121,951 ±5% |
| 50          | **439,498 ±24%** |  80,562 ±1% |   64,352 ±2% | 176,146 ±5% |
| 100         |  **498,861 ±5%** |  76,177 ±6% |   65,667 ±5% | 184,106 ±1% |
| 500         |  **518,261 ±1%** |  75,951 ±9% | 202,145 ±14% | 196,082 ±3% |
| 1000        |  **447,753 ±8%** |  73,662 ±5% | 209,250 ±12% | 204,389 ±5% |

**Bun 1.4: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js | Bun.sql |
| ----------- | ----------: | -------: | ----------: | ------: |
| 1           | **35.7 µs** |  61.6 µs |     39.6 µs | 39.6 µs |
| 10          | **98.6 µs** |   559 µs |      349 µs |  167 µs |
| 50          |  **515 µs** |  1.42 ms |     1.78 ms | 1.11 ms |
| 100         | **1.22 ms** |  2.43 ms |     3.31 ms | 1.70 ms |
| 500         |     5.24 ms |  8.91 ms | **4.78 ms** | 5.08 ms |
| 1000        | **5.18 ms** | 15.25 ms |     7.26 ms | 8.91 ms |

**Bun 1.4: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry |          pg | postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | ----------: | ----------: |
| 1           |   **39,952 ±4%** | 23,383 ±17% |  33,920 ±6% |  33,189 ±3% |
| 10          | **141,101 ±12%** |  85,078 ±2% |  91,444 ±8% |  86,659 ±3% |
| 50          |  **388,666 ±7%** |  77,173 ±9% | 61,986 ±11% | 152,740 ±5% |
| 100         |  **490,620 ±6%** |  80,790 ±4% |  64,259 ±3% | 164,017 ±9% |
| 500         | **500,450 ±17%** |  78,209 ±4% | 177,616 ±8% | 187,549 ±7% |
| 1000        | **454,270 ±14%** |  76,822 ±4% | 208,205 ±2% | 195,052 ±4% |

**Bun 1.4: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |     Bun.sql |
| ----------- | ----------: | -------: | ----------: | ----------: |
| 1           | **32.5 µs** |  60.0 µs |     40.7 µs |     45.0 µs |
| 10          |  **136 µs** |   557 µs |      224 µs |      241 µs |
| 50          |  **356 µs** |  1.52 ms |     1.94 ms |     1.27 ms |
| 100         | **1.13 ms** |  2.22 ms |     3.42 ms |     1.67 ms |
| 500         |     5.76 ms |  8.79 ms |     7.28 ms | **5.49 ms** |
| 1000        | **6.07 ms** | 16.70 ms |     8.66 ms |    10.00 ms |

**Bun 1.4: pool size 50, point lookups/s by concurrency**

| Concurrency |          quarry |         pg | postgres.js |     Bun.sql |
| ----------- | --------------: | ---------: | ----------: | ----------: |
| 1           |  **39,037 ±4%** | 23,327 ±5% |  33,190 ±4% |  32,998 ±8% |
| 10          | **143,151 ±1%** | 85,193 ±2% |  92,640 ±1% | 81,895 ±21% |
| 50          | **137,942 ±3%** | 81,479 ±3% |  82,551 ±2% |  83,866 ±5% |
| 100         | **195,785 ±4%** | 80,115 ±2% |  58,817 ±9% | 107,027 ±8% |
| 500         | **410,195 ±7%** | 77,479 ±3% |  64,691 ±1% | 142,188 ±3% |
| 1000        | **483,889 ±7%** | 75,371 ±2% |  64,947 ±5% | 159,507 ±4% |

**Bun 1.4: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |  Bun.sql |
| ----------- | ----------: | -------: | ----------: | -------: |
| 1           | **33.8 µs** |  58.8 µs |     43.4 µs |  40.6 µs |
| 10          |  **128 µs** |   556 µs |      223 µs |   283 µs |
| 50          |  **724 µs** |  1.52 ms |     1.51 ms |  1.15 ms |
| 100         | **1.04 ms** |  2.49 ms |     3.78 ms |  1.80 ms |
| 500         | **2.76 ms** |  9.20 ms |    16.19 ms |  6.83 ms |
| 1000        | **6.89 ms** | 15.45 ms |    32.50 ms | 11.93 ms |

## Pipelining depth

**quarry, one connection, 100 concurrent point lookups: throughput by `pipeline` depth (columns: RTT ms)**

| pipeline           |               0 |          5 |
| ------------------ | --------------: | ---------: |
| 1                  |  **20,855 ±5%** |    169 ±3% |
| 2                  |  **41,383 ±2%** |    339 ±1% |
| 4                  |  **74,780 ±4%** |    674 ±1% |
| 8                  | **111,689 ±1%** |  1,338 ±1% |
| 16                 | **113,483 ±2%** |  2,634 ±2% |
| 32                 | **116,923 ±4%** |  5,130 ±1% |
| 64                 | **115,928 ±2%** |  9,732 ±2% |
| 100                | **117,930 ±2%** | 16,362 ±2% |
| adaptive (default) | **119,369 ±2%** | 15,923 ±5% |

## db.batch

**quarry's query builder, 3 statements per operation: operations/s (columns: RTT ms)**

| Scenario                                                                  |               0 |        5 |
| ------------------------------------------------------------------------- | --------------: | -------: |
| 3 statements (lookup, insert, update): one after another                  |   **5,898 ±3%** | 56.3 ±3% |
| 3 statements (lookup, insert, update): Promise.all                        | **12,835 ±10%** | 166 ±<1% |
| 3 statements (lookup, insert, update): db.batch                           | **11,200 ±13%** |  166 ±1% |
| 3 statements (lookup, insert, update) in a transaction: one after another |   **4,516 ±4%** | 42.1 ±1% |
| 3 statements (lookup, insert, update) in a transaction: Promise.all       |   **5,574 ±4%** | 56.2 ±1% |
| 3 statements (lookup, insert, update) in a transaction: db.batch          |  **10,175 ±3%** |  164 ±1% |

## Query builder under concurrency

**Node, pool 10, 0 ms RTT: operations/s (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              |   quarry builder |           quarry |          pg |  postgres.js |
| ------------------------------- | ---------------: | ---------------: | ----------: | -----------: |
| lookup, 1                       |       17,650 ±6% |   **21,037 ±8%** |  13,774 ±4% |   16,968 ±4% |
| lookup, 100                     |     150,563 ±10% |  **368,498 ±3%** |  66,848 ±2% |   41,307 ±4% |
| lookup, 500                     |     163,065 ±19% | **464,360 ±11%** | 61,991 ±11% | 136,023 ±10% |
| lookup, 1000                    |     179,196 ±20% | **438,704 ±19%** |  62,331 ±6% |  142,364 ±6% |
| lookup, statement timeout, 1    |       15,510 ±6% |                — |           — |            — |
| lookup, statement timeout, 100  |     107,987 ±10% |                — |           — |            — |
| lookup, statement timeout, 500  |     114,286 ±21% |                — |           — |            — |
| lookup, statement timeout, 1000 |     110,821 ±10% |                — |           — |            — |
| insert, 1                       |      18,311 ±38% |   **21,468 ±1%** | 16,274 ±12% |   17,250 ±2% |
| insert, 100                     |      189,868 ±7% | **238,477 ±32%** |  75,664 ±3% |  41,392 ±14% |
| insert, 500                     |     203,579 ±11% | **207,917 ±20%** | 76,878 ±27% | 109,394 ±10% |
| insert, 1000                    | **207,833 ±19%** |      193,947 ±3% | 76,817 ±42% |  135,117 ±5% |
| update, 1                       |       17,219 ±6% |   **18,918 ±6%** |  14,480 ±9% |  16,444 ±12% |
| update, 100                     |     213,958 ±12% |  **248,235 ±3%** |  73,484 ±8% |   42,397 ±2% |
| update, 500                     |      241,647 ±7% |  **246,901 ±7%** | 77,587 ±15% | 148,610 ±11% |
| update, 1000                    |     240,124 ±27% |  **254,723 ±2%** |  75,336 ±7% | 177,405 ±18% |

**Node, pool 10, 0 ms RTT: p99 latency (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              |    quarry builder |            quarry |            pg |   postgres.js |
| ------------------------------- | ----------------: | ----------------: | ------------: | ------------: |
| lookup, 1                       |      95.3 µs ±14% |  **64.4 µs ±20%** |    116 µs ±8% |  92.1 µs ±17% |
| lookup, 100                     |      1.84 ms ±18% |   **1.16 ms ±7%** |  2.88 ms ±11% |  5.97 ms ±32% |
| lookup, 500                     |      8.19 ms ±24% |  **5.31 ms ±74%** | 15.78 ms ±31% | 11.13 ms ±12% |
| lookup, 1000                    |     12.36 ms ±24% | **10.51 ms ±41%** | 23.27 ms ±20% |  15.14 ms ±6% |
| lookup, statement timeout, 1    |        128 µs ±8% |                 — |             — |             — |
| lookup, statement timeout, 100  |      2.59 ms ±26% |                 — |             — |             — |
| lookup, statement timeout, 500  |     10.23 ms ±23% |                 — |             — |             — |
| lookup, statement timeout, 1000 |     20.41 ms ±12% |                 — |             — |             — |
| insert, 1                       |      98.6 µs ±70% |   **73.6 µs ±6%** |  97.0 µs ±24% |   90.5 µs ±5% |
| insert, 100                     |   **1.70 ms ±3%** |      3.15 ms ±60% |  2.84 ms ±19% |  5.86 ms ±36% |
| insert, 500                     |  **6.45 ms ±11%** |     11.50 ms ±21% | 11.16 ms ±19% | 12.91 ms ±21% |
| insert, 1000                    | **12.10 ms ±43%** |      20.75 ms ±8% | 20.12 ms ±65% | 14.54 ms ±14% |
| update, 1                       |      92.7 µs ±11% |  **72.9 µs ±21%** |   105 µs ±17% |  93.5 µs ±40% |
| update, 100                     |  **1.80 ms ±35%** |      2.03 ms ±32% |  2.52 ms ±13% |  5.81 ms ±25% |
| update, 500                     |  **7.09 ms ±10%** |      7.29 ms ±13% | 10.23 ms ±51% | 10.38 ms ±13% |
| update, 1000                    |     11.84 ms ±18% | **10.47 ms ±14%** | 16.82 ms ±14% | 13.61 ms ±17% |

**Node, pool 10, 5 ms RTT: operations/s (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              | quarry builder |          quarry |         pg | postgres.js |
| ------------------------------- | -------------: | --------------: | ---------: | ----------: |
| lookup, 1                       |        168 ±1% |         169 ±1% |    167 ±2% | **170 ±2%** |
| lookup, 100                     |     15,952 ±3% |  **16,319 ±1%** | 1,642 ±<1% |  13,878 ±4% |
| lookup, 500                     | **79,367 ±1%** |      73,985 ±2% |  1,641 ±1% |  37,880 ±3% |
| lookup, 1000                    |    152,891 ±4% | **157,680 ±6%** |  1,639 ±1% |  75,169 ±2% |
| lookup, statement timeout, 1    |       167 ±<1% |               — |          — |           — |
| lookup, statement timeout, 100  |     16,056 ±1% |               — |          — |           — |
| lookup, statement timeout, 500  |     80,520 ±5% |               — |          — |           — |
| lookup, statement timeout, 1000 |    121,484 ±9% |               — |          — |           — |
| insert, 1                       |        169 ±1% |         169 ±1% |    168 ±1% | **169 ±1%** |
| insert, 100                     |     16,139 ±3% |  **16,318 ±1%** |  1,648 ±1% |  14,058 ±2% |
| insert, 500                     |     79,616 ±1% |  **81,019 ±1%** |  1,646 ±1% |  37,932 ±3% |
| insert, 1000                    |    155,995 ±3% | **162,267 ±2%** |  1,646 ±1% |  75,480 ±1% |
| update, 1                       |        168 ±1% |     **169 ±1%** |    167 ±1% |     169 ±1% |
| update, 100                     |     15,784 ±1% |  **15,913 ±2%** |  1,643 ±1% |  13,771 ±7% |
| update, 500                     |     78,422 ±5% |  **80,180 ±1%** |  1,636 ±1% |  39,767 ±6% |
| update, 1000                    |    163,712 ±1% | **165,018 ±2%** |  1,646 ±2% |  72,850 ±2% |

**Node, pool 10, 5 ms RTT: p99 latency (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              |  quarry builder |           quarry |            pg |     postgres.js |
| ------------------------------- | --------------: | ---------------: | ------------: | --------------: |
| lookup, 1                       |     6.45 ms ±3% |  **6.36 ms ±4%** |  6.48 ms ±31% |    6.44 ms ±25% |
| lookup, 100                     |     7.14 ms ±2% |  **6.76 ms ±5%** |  61.91 ms ±1% |    12.13 ms ±4% |
| lookup, 500                     | **8.27 ms ±6%** |      8.48 ms ±6% |   307 ms ±<1% |   27.35 ms ±10% |
| lookup, 1000                    |   10.81 ms ±23% | **9.31 ms ±15%** |    616 ms ±1% |    21.21 ms ±5% |
| lookup, statement timeout, 1    |     6.46 ms ±2% |                — |             — |               — |
| lookup, statement timeout, 100  |     7.32 ms ±2% |                — |             — |               — |
| lookup, statement timeout, 500  |    9.30 ms ±19% |                — |             — |               — |
| lookup, statement timeout, 1000 |   16.06 ms ±14% |                — |             — |               — |
| insert, 1                       |     6.39 ms ±3% |      6.30 ms ±4% |   6.37 ms ±1% | **6.30 ms ±1%** |
| insert, 100                     |     7.25 ms ±4% |  **7.07 ms ±2%** | 64.87 ms ±24% |    11.99 ms ±3% |
| insert, 500                     |     8.91 ms ±4% | **8.27 ms ±20%** |    308 ms ±1% |   27.24 ms ±28% |
| insert, 1000                    |   11.26 ms ±22% | **8.97 ms ±43%** |    615 ms ±1% |    19.38 ms ±4% |
| update, 1                       |     6.42 ms ±1% |      6.42 ms ±2% |   6.48 ms ±4% | **6.31 ms ±2%** |
| update, 100                     |     7.23 ms ±4% |  **7.02 ms ±1%** |  62.30 ms ±4% |    12.64 ms ±3% |
| update, 500                     |    8.65 ms ±47% |  **8.17 ms ±3%** |    310 ms ±2% |   25.39 ms ±10% |
| update, 1000                    |    9.28 ms ±11% |  **9.13 ms ±7%** |    614 ms ±1% |    22.03 ms ±4% |

## Network latency (RTT through Toxiproxy)

**Node 24: select 1, sequential: median latency by RTT**

| RTT   |            quarry |           pg |    pg (named) |    pg-native |   postgres.js |    neon (WS) |
| ----- | ----------------: | -----------: | ------------: | -----------: | ------------: | -----------: |
| 0 ms  |   **41.3 µs ±3%** | 46.3 µs ±26% |   44.9 µs ±9% | 51.8 µs ±16% |  47.3 µs ±16% | 62.9 µs ±17% |
| 1 ms  |   **1.38 ms ±8%** |  1.41 ms ±5% |   1.42 ms ±2% |  1.42 ms ±4% |  1.44 ms ±13% |  1.49 ms ±3% |
| 5 ms  |   **5.84 ms ±4%** |  5.93 ms ±4% |   5.89 ms ±1% |  5.93 ms ±2% |   5.90 ms ±2% |  5.95 ms ±4% |
| 20 ms | **20.87 ms ±<1%** | 20.91 ms ±1% | 20.94 ms ±<1% | 20.95 ms ±1% | 20.90 ms ±<1% | 21.05 ms ±1% |

**Node 24: point lookup, sequential: median latency by RTT**

| RTT   |            quarry |           pg |   pg (named) |    pg-native |   postgres.js |    neon (WS) |
| ----- | ----------------: | -----------: | -----------: | -----------: | ------------: | -----------: |
| 0 ms  |  **44.9 µs ±20%** |  66.3 µs ±3% |  56.3 µs ±1% |  70.6 µs ±3% |  55.6 µs ±55% |   108 µs ±2% |
| 1 ms  |  **1.40 ms ±10%** |  1.53 ms ±7% |  1.47 ms ±6% |  1.55 ms ±1% |  1.46 ms ±10% |  1.64 ms ±6% |
| 5 ms  |   **5.92 ms ±1%** |  5.98 ms ±6% |  5.95 ms ±1% |  5.97 ms ±1% |  5.94 ms ±<1% |  6.07 ms ±1% |
| 20 ms | **20.94 ms ±<1%** | 21.05 ms ±1% | 21.00 ms ±2% | 20.94 ms ±1% | 20.97 ms ±<1% | 21.21 ms ±1% |

**Node 24: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |          pg | pg (named) |   pg-native | postgres.js |  neon (WS) |
| ----- | ---------------: | ----------: | ---------: | ----------: | ----------: | ---------: |
| 0 ms  | **246,802 ±18%** | 63,003 ±30% | 62,078 ±8% | 59,965 ±15% |  39,872 ±3% | 20,323 ±8% |
| 1 ms  |   **29,358 ±2%** |   5,847 ±1% |  6,034 ±3% |   5,716 ±5% |  18,475 ±3% |  4,977 ±3% |
| 5 ms  |    **8,242 ±1%** |   1,643 ±2% |  1,658 ±1% |   1,639 ±1% |   6,891 ±3% |  1,571 ±1% |
| 20 ms |   **2,357 ±<1%** |    472 ±<1% |    474 ±1% |    473 ±<1% |  1,888 ±11% |    466 ±1% |

**Node 24: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |          quarry |         pg | pg (named) |  pg-native | postgres.js | neon (WS) |
| ----- | --------------: | ---------: | ---------: | ---------: | ----------: | --------: |
| 0 ms  | **116,758 ±3%** | 13,914 ±2% | 16,743 ±3% | 13,299 ±9% | 101,979 ±4% | 8,391 ±9% |
| 1 ms  |  **42,396 ±6%** |    649 ±1% |    667 ±2% |    648 ±8% | 31,678 ±15% |   623 ±2% |
| 5 ms  |  **16,277 ±4%** |   167 ±<1% |    168 ±1% |    168 ±1% | 11,928 ±10% |   166 ±1% |
| 20 ms |   **4,717 ±1%** |   47.6 ±1% |  47.7 ±<1% |  47.7 ±<1% |   3,583 ±9% | 47.4 ±<1% |

**Node 24: point lookup, 500 concurrent, pool 1 (deep pipelining): operations/s by RTT**

| RTT   |           quarry |          pg |  pg (named) |  pg-native | postgres.js | neon (WS) |
| ----- | ---------------: | ----------: | ----------: | ---------: | ----------: | --------: |
| 0 ms  | **115,706 ±13%** | 13,847 ±12% | 16,630 ±37% | 13,291 ±5% |  93,262 ±3% | 8,571 ±4% |
| 1 ms  |  **119,647 ±3%** |     645 ±2% |     682 ±8% |    641 ±9% |  23,484 ±3% |  627 ±14% |
| 5 ms  |   **85,080 ±4%** |     168 ±1% |     171 ±1% |    168 ±1% |   7,799 ±2% |   166 ±1% |
| 20 ms |   **23,367 ±1%** |   47.7 ±<1% |   47.9 ±<1% |  47.6 ±<1% |   2,330 ±1% | 47.4 ±<1% |

**Node 24: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |           pg |   pg (named) |     pg-native |   postgres.js |    neon (WS) |
| ----- | ----------------: | -----------: | -----------: | ------------: | ------------: | -----------: |
| 0 ms  |    **340 µs ±9%** |  1.41 ms ±6% |  1.34 ms ±2% |   1.74 ms ±4% |  1.09 ms ±22% |  1.56 ms ±2% |
| 1 ms  |   **2.02 ms ±3%** |  3.17 ms ±2% |  3.10 ms ±3% |   3.22 ms ±6% |   2.93 ms ±3% |  3.41 ms ±3% |
| 5 ms  |   **6.36 ms ±4%** |  7.38 ms ±3% |  7.35 ms ±1% |  7.48 ms ±<1% |   7.20 ms ±1% |  7.63 ms ±3% |
| 20 ms | **21.45 ms ±<1%** | 22.51 ms ±1% | 22.47 ms ±1% | 22.57 ms ±<1% | 22.24 ms ±<1% | 22.69 ms ±1% |

**Node 24: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |            quarry |            pg |    pg (named) |    pg-native |  postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | ------------: | -----------: | -----------: | ------------: |
| 0 ms  |   **88.4 µs ±1%** |    143 µs ±2% |   129 µs ±<1% |   159 µs ±4% |  151 µs ±13% |    213 µs ±3% |
| 1 ms  |   **2.91 ms ±5%** |   4.38 ms ±2% |   4.33 ms ±1% | 4.38 ms ±14% |  4.39 ms ±2% |   4.31 ms ±9% |
| 5 ms  |  **11.84 ms ±1%** |  17.68 ms ±1% |  17.64 ms ±1% | 17.65 ms ±4% | 17.75 ms ±1% |  17.78 ms ±4% |
| 20 ms | **41.85 ms ±<1%** | 62.81 ms ±<1% | 62.78 ms ±<1% | 62.72 ms ±1% | 62.72 ms ±1% | 62.93 ms ±<1% |

**Node 24: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |          pg |  pg (named) |   pg-native | postgres.js |  neon (WS) |
| ----- | ---------------: | ----------: | ----------: | ----------: | ----------: | ---------: |
| 0 ms  | **203,871 ±27%** | 75,305 ±13% | 78,101 ±38% | 71,148 ±36% |  40,414 ±4% | 22,171 ±4% |
| 1 ms  |   **27,543 ±3%** |   6,003 ±5% |   6,206 ±4% |   5,818 ±2% |  18,329 ±5% |  5,108 ±3% |
| 5 ms  |    **8,131 ±1%** |   1,645 ±1% |   1,655 ±2% |   1,629 ±1% |   6,609 ±3% |  1,582 ±2% |
| 20 ms |    **2,354 ±1%** |    474 ±<1% |    475 ±<1% |     473 ±1% |   1,932 ±6% |    468 ±1% |

**Node 24: connect + select 1 + close: median latency by RTT**

| RTT   |            quarry |              pg |    pg (named) |    pg-native |   postgres.js |    neon (WS) |
| ----- | ----------------: | --------------: | ------------: | -----------: | ------------: | -----------: |
| 0 ms  |      2.79 ms ±16% | **2.77 ms ±5%** |  3.13 ms ±12% |  5.14 ms ±6% |   6.07 ms ±3% | 4.81 ms ±11% |
| 1 ms  |       5.21 ms ±2% | **5.19 ms ±5%** |   5.20 ms ±4% |  9.93 ms ±2% |   9.72 ms ±2% |  7.45 ms ±2% |
| 5 ms  |  **13.85 ms ±2%** |    14.08 ms ±1% | 14.00 ms ±<1% | 27.26 ms ±2% |  22.76 ms ±3% | 16.20 ms ±2% |
| 20 ms | **44.02 ms ±<1%** |    44.46 ms ±1% |  44.10 ms ±1% | 87.60 ms ±1% | 68.01 ms ±<1% | 47.05 ms ±1% |

**Bun 1.4: select 1, sequential: median latency by RTT**

| RTT   |          quarry |           Bun.sql |
| ----- | --------------: | ----------------: |
| 0 ms  | **39.1 µs ±2%** |      43.2 µs ±17% |
| 1 ms  | **1.37 ms ±2%** |       1.38 ms ±2% |
| 5 ms  |     5.84 ms ±2% |   **5.77 ms ±2%** |
| 20 ms |    20.85 ms ±1% | **20.81 ms ±<1%** |

**Bun 1.4: point lookup, sequential: median latency by RTT**

| RTT   |           quarry |           Bun.sql |
| ----- | ---------------: | ----------------: |
| 0 ms  | **43.0 µs ±<1%** |       46.9 µs ±5% |
| 1 ms  |     1.42 ms ±<1% |   **1.39 ms ±1%** |
| 5 ms  |      5.88 ms ±1% |   **5.77 ms ±1%** |
| 20 ms |    20.93 ms ±<1% | **20.91 ms ±<1%** |

**Bun 1.4: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |          quarry |        Bun.sql |
| ----- | --------------: | -------------: |
| 0 ms  | **283,289 ±6%** |   152,845 ±19% |
| 1 ms  |  **29,607 ±6%** |     27,253 ±6% |
| 5 ms  |   **8,377 ±1%** |      8,233 ±1% |
| 20 ms |      2,362 ±<1% | **2,365 ±<1%** |

**Bun 1.4: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |          quarry |        Bun.sql |
| ----- | --------------: | -------------: |
| 0 ms  | **118,759 ±4%** |    87,971 ±20% |
| 1 ms  |     46,473 ±65% | **80,615 ±7%** |
| 5 ms  |  **16,646 ±3%** |     16,162 ±6% |
| 20 ms |   **4,745 ±1%** |      4,666 ±1% |

**Bun 1.4: point lookup, 500 concurrent, pool 1 (deep pipelining): operations/s by RTT**

| RTT   |           quarry |        Bun.sql |
| ----- | ---------------: | -------------: |
| 0 ms  | **102,632 ±25%** |     92,558 ±8% |
| 1 ms  | **118,113 ±10%** |     92,466 ±7% |
| 5 ms  |       85,492 ±2% | **86,864 ±4%** |
| 20 ms |  **23,348 ±<1%** |     23,073 ±1% |

**Bun 1.4: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |      Bun.sql |
| ----- | ----------------: | -----------: |
| 0 ms  |    **284 µs ±1%** |  418 µs ±14% |
| 1 ms  |   **1.95 ms ±2%** |  2.27 ms ±3% |
| 5 ms  |   **6.27 ms ±3%** |  6.51 ms ±2% |
| 20 ms | **21.37 ms ±<1%** | 21.65 ms ±1% |

**Bun 1.4: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |           quarry |       Bun.sql |
| ----- | ---------------: | ------------: |
| 0 ms  |  **85.5 µs ±2%** |    155 µs ±7% |
| 1 ms  |  **2.88 ms ±6%** |   4.24 ms ±4% |
| 5 ms  | **11.63 ms ±6%** |  17.35 ms ±5% |
| 20 ms | **41.82 ms ±1%** | 62.79 ms ±<1% |

**Bun 1.4: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |        Bun.sql |
| ----- | ---------------: | -------------: |
| 0 ms  | **226,209 ±14%** |    154,902 ±2% |
| 1 ms  |   **28,241 ±3%** |     26,763 ±3% |
| 5 ms  |    **8,244 ±1%** |      8,164 ±1% |
| 20 ms |        2,363 ±1% | **2,364 ±<1%** |

**Bun 1.4: connect + select 1 + close: median latency by RTT**

| RTT   |       quarry |           Bun.sql |
| ----- | -----------: | ----------------: |
| 0 ms  | 2.81 ms ±15% |   **2.64 ms ±6%** |
| 1 ms  |  5.24 ms ±4% |   **4.97 ms ±2%** |
| 5 ms  | 13.79 ms ±1% |  **13.55 ms ±1%** |
| 20 ms | 44.03 ms ±1% | **43.84 ms ±<1%** |

## PgBouncer

**Node 24 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |           quarry | quarry (prepare: false) |         pg | pg (named) |  pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | ---------------: | ----------------------: | ---------: | ---------: | ---------: | ----------: | ---------------------------: |
| select 1                                               |   **21,040 ±4%** |              18,388 ±2% | 20,120 ±1% | 18,255 ±3% | 20,119 ±2% |  18,595 ±3% |                   18,762 ±2% |
| point lookup by primary key                            |   **18,585 ±3%** |             12,639 ±13% | 12,920 ±6% | 15,219 ±3% | 14,086 ±2% |  15,889 ±1% |                    8,264 ±2% |
| point lookup by primary key, concurrency 50            |  **109,860 ±6%** |              70,556 ±7% | 67,209 ±3% | 63,332 ±4% | 67,163 ±5% |  39,051 ±2% |                   37,807 ±6% |
| fetch 1k rows (6 columns)                              |    **2,572 ±2%** |              1,157 ±<1% |    719 ±1% |    721 ±2% |    586 ±3% |     795 ±8% |                     855 ±10% |
| insert one row                                         |   **18,961 ±3%** |              15,833 ±7% | 15,550 ±3% | 16,921 ±5% | 15,556 ±3% |  16,061 ±8% |                    8,704 ±1% |
| transaction: begin; insert; commit                     |    **9,148 ±1%** |               8,901 ±4% |  6,445 ±3% |  6,881 ±4% |  6,526 ±2% |  5,928 ±13% |                    4,394 ±3% |
| insert one row, concurrency 50                         | **104,754 ±12%** |            102,313 ±26% | 79,590 ±6% | 66,124 ±4% | 79,940 ±9% |  38,372 ±8% |                   41,136 ±5% |
| query that fails (division by zero), connection reused |   **15,120 ±4%** |              15,095 ±4% |  5,161 ±3% |  4,613 ±9% |  4,152 ±3% |  11,921 ±7% |                   11,999 ±3% |

**Node 24 through PgBouncer: median latency**

| Scenario                                               |      quarry | quarry (prepare: false) |      pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | ----------: | ----------------------: | ------: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                                               | **45.2 µs** |                 49.9 µs | 46.8 µs |    51.0 µs |   47.1 µs |     50.0 µs |                      49.5 µs |
| point lookup by primary key                            | **50.9 µs** |                 73.3 µs | 70.4 µs |    60.4 µs |   67.1 µs |     59.0 µs |                       113 µs |
| point lookup by primary key, concurrency 50            |  **452 µs** |                  582 µs |  685 µs |     727 µs |    665 µs |     1.17 ms |                      1.17 ms |
| fetch 1k rows (6 columns)                              |  **358 µs** |                  804 µs | 1.37 ms |    1.38 ms |   1.71 ms |     1.09 ms |                      1.00 ms |
| insert one row                                         | **50.2 µs** |                 58.4 µs | 60.8 µs |    55.0 µs |   60.6 µs |     58.3 µs |                       109 µs |
| transaction: begin; insert; commit                     |  **103 µs** |                  107 µs |  146 µs |     139 µs |    147 µs |      159 µs |                       212 µs |
| insert one row, concurrency 50                         |  **467 µs** |                  471 µs |  583 µs |     712 µs |    581 µs |     1.20 ms |                      1.13 ms |
| query that fails (division by zero), connection reused |     61.6 µs |             **61.1 µs** |  175 µs |     194 µs |    217 µs |     77.5 µs |                      76.9 µs |

**Node 24: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | quarry (prepare: false) |  pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ---------------------------------- | -----: | ----------------------: | --: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                           |    48% |                     57% | 57% |        53% |   **67%** |         59% |                          58% |
| point lookup by primary key        |    52% |                     69% | 72% |        58% |   **77%** |         57% |                          62% |
| fetch 1k rows (6 columns)          |    89% |                     92% | 98% |        94% |   **98%** |         88% |                          97% |
| insert one row                     |    52% |                     61% | 67% |        58% |   **74%** |         61% |                          62% |
| transaction: begin; insert; commit |    51% |                       — | 56% |        53% |   **70%** |         57% |                            — |

**Bun 1.4 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |          quarry |    Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | --------------: | ---------: | -----------------------: |
| select 1                                               |  **22,524 ±3%** | 21,068 ±1% |               21,173 ±3% |
| point lookup by primary key                            |  **19,975 ±2%** | 17,455 ±9% |               14,449 ±3% |
| point lookup by primary key, concurrency 50            | **103,102 ±5%** | 53,451 ±1% |               56,691 ±3% |
| fetch 1k rows (6 columns)                              |   **2,957 ±7%** |  2,151 ±2% |                2,156 ±1% |
| insert one row                                         |  **19,683 ±4%** | 16,805 ±5% |               14,621 ±3% |
| transaction: begin; insert; commit                     |   **9,716 ±7%** |  6,707 ±7% |                6,408 ±9% |
| insert one row, concurrency 50                         | **101,594 ±5%** | 52,859 ±4% |               55,894 ±1% |
| query that fails (division by zero), connection reused |      16,717 ±3% | 18,757 ±1% |           **18,802 ±3%** |

**Bun 1.4 through PgBouncer: median latency**

| Scenario                                               |      quarry | Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | ----------: | ------: | -----------------------: |
| select 1                                               | **42.9 µs** | 45.8 µs |                  45.5 µs |
| point lookup by primary key                            | **48.2 µs** | 56.3 µs |                  66.2 µs |
| point lookup by primary key, concurrency 50            |  **474 µs** |  907 µs |                   853 µs |
| fetch 1k rows (6 columns)                              |  **314 µs** |  443 µs |                   442 µs |
| insert one row                                         | **48.5 µs** | 57.8 µs |                  65.3 µs |
| transaction: begin; insert; commit                     | **97.2 µs** |  143 µs |                   150 µs |
| insert one row, concurrency 50                         |  **481 µs** |  898 µs |                   865 µs |
| query that fails (division by zero), connection reused |     56.9 µs | 50.5 µs |              **50.4 µs** |

**Bun 1.4: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | Bun.sql | Bun.sql (prepare: false) |
| ---------------------------------- | -----: | ------: | -----------------------: |
| select 1                           |    45% | **55%** |                      55% |
| point lookup by primary key        |    49% |     53% |                  **67%** |
| fetch 1k rows (6 columns)          |    85% |     86% |                  **88%** |
| insert one row                     |    50% |     50% |                  **60%** |
| transaction: begin; insert; commit |    48% | **66%** |                        — |

## Server restart

`pg_ctl restart -m fast` while a pool runs `select 1` every 5 ms (2 s client timeout per query).

| Runtime  | Client                   | Recovered | Time from server up to first success (median) | Failed queries (median) |
| -------- | ------------------------ | --------: | --------------------------------------------: | ----------------------: |
| Node 24  | quarry                   |       5/5 |                                       4.00 ms |                      28 |
| Node 24  | pg                       |       5/5 |                                       3.00 ms |                      28 |
| Node 24  | pg (named)               |       5/5 |                                       3.00 ms |                      29 |
| Node 24  | pg-native                |       5/5 |                                       3.00 ms |                      26 |
| Node 24  | postgres.js              |       5/5 |                                      78.00 ms |                      14 |
| Bun 1.4  | quarry                   |       5/5 |                                       1.00 ms |                      28 |
| Bun 1.4  | postgres.js              |       5/5 |                                      54.00 ms |                      15 |
| Bun 1.4  | Bun.sql                  |       5/5 |                                       3.00 ms |                      18 |
| Deno 2.9 | quarry                   |       5/5 |                                       4.00 ms |                      24 |
| Deno 2.9 | deno-postgres (+nodelay) |       0/5 |                                             — |                       — |

## Footprint and cold start

| Package                                              | Installed size | Packages installed |
| ---------------------------------------------------- | -------------: | -----------------: |
| quarry (whole package: query builder + driver + src) |       3892 KiB |                  1 |
| pg                                                   |        464 KiB |                 14 |
| pg + pg-native (libpq addon, built)                  |       1377 KiB |                 19 |
| postgres.js                                          |        293 KiB |                  1 |
| @neondatabase/serverless (+ ws on Node)              |        582 KiB |                  2 |
| deno-postgres (jsr, source modules)                  |        531 KiB |                  7 |
| Bun.sql (built into Bun)                             |          0 KiB |                  0 |

| Bundle (esbuild, minified, platform node) |                                                  Size |     gzip |
| ----------------------------------------- | ----------------------------------------------------: | -------: |
| quarry/driver                             |                                             123.2 KiB | 41.2 KiB |
| pg                                        |                                              84.4 KiB | 26.3 KiB |
| postgres.js                               |                                              37.1 KiB | 14.3 KiB |
| @neondatabase/serverless                  |                                             142.9 KiB | 46.3 KiB |
| pg-native                                 | native addon (libpq .node + libpq.so): not bundleable |          |

| Runtime / client   |   Import | Connect + first query | Process start → first result | Wall time of the process |
| ------------------ | -------: | --------------------: | ---------------------------: | -----------------------: |
| node/none          |   2.5 µs |               13.2 µs |                     48.57 ms |                 56.54 ms |
| node/quarry        |  8.18 ms |              11.10 ms |                     66.15 ms |                 72.13 ms |
| node/pg            | 22.58 ms |               6.78 ms |                     72.50 ms |                 77.86 ms |
| node/pg-native     | 23.80 ms |               7.69 ms |                     74.12 ms |                 80.86 ms |
| node/postgres.js   | 14.23 ms |               9.00 ms |                     65.69 ms |                 73.44 ms |
| node/neon          | 25.77 ms |              11.51 ms |                     78.35 ms |                 83.61 ms |
| bun/none           |   0.8 µs |               12.7 µs |                      1.94 ms |                  4.78 ms |
| bun/quarry         |  9.27 ms |              14.30 ms |                     25.54 ms |                 29.92 ms |
| bun/pg             | 13.87 ms |               8.48 ms |                     24.23 ms |                 27.99 ms |
| bun/postgres.js    | 12.45 ms |               9.52 ms |                     23.86 ms |                 30.03 ms |
| bun/bun.sql        |  3.28 ms |               3.88 ms |                      9.13 ms |                 12.80 ms |
| deno/none          |   2.3 µs |               16.6 µs |                     10.07 ms |                 20.75 ms |
| deno/quarry        |  3.72 ms |              14.47 ms |                     27.97 ms |                 38.89 ms |
| deno/pg            | 13.62 ms |               7.95 ms |                     33.62 ms |                 43.99 ms |
| deno/postgres.js   | 11.88 ms |              11.28 ms |                     35.71 ms |                 48.28 ms |
| deno/deno-postgres | 16.63 ms |               5.51 ms |                     31.69 ms |                 42.50 ms |
