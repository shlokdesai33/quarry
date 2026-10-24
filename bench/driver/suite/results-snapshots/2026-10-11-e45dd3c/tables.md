### Correctness

Every result compared in canonical form (see `canon.ts`) against the majority digest for its runtime and scenario.

560 (runtime, client, scenario) results checked; 0 differ from the majority.

### Failed runs

- reconnect deno deno-postgres (+nodelay) reconnect (max 10, c -, rtt -): 5 failed: BrokenPipe: Broken pipe (os error 32)

## Node 24

**Node 24: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |      pg (named) |    pg-native |     postgres.js |    neon (WS) |
| ------------------------------------------------------------- | ---------------: | -----------: | --------------: | -----------: | --------------: | -----------: |
| select 1                                                      |  **24.6 µs ±6%** | 26.5 µs ±10% |    28.0 µs ±12% |  34.2 µs ±3% |    31.3 µs ±10% | 52.8 µs ±13% |
| point lookup by primary key                                   |  **31.4 µs ±4%** |  51.2 µs ±7% |    35.6 µs ±10% | 53.8 µs ±15% |    37.1 µs ±13% | 92.9 µs ±11% |
| range scan, 100 rows                                          |  **100 µs ±14%** |  212 µs ±10% |      206 µs ±8% |  227 µs ±13% |     183 µs ±10% |  242 µs ±21% |
| fetch 1k rows (6 columns)                                     |  **404 µs ±26%** |  1.46 ms ±5% |     1.31 ms ±6% | 1.66 ms ±14% |    1.07 ms ±15% |  1.57 ms ±6% |
| 100 parameters (id in (…)), 100 rows                          |  **258 µs ±11%** |  355 µs ±26% |     278 µs ±32% |  377 µs ±11% |     293 µs ±19% |  442 µs ±23% |
| 1000 parameters (id in (…)), 1000 rows                        |  **2.22 ms ±7%** |  2.75 ms ±7% |     2.22 ms ±6% | 2.92 ms ±15% |    2.34 ms ±10% | 2.70 ms ±11% |
| insert one row                                                |  **30.5 µs ±8%** | 43.8 µs ±11% |     32.1 µs ±6% |  46.3 µs ±9% |    35.6 µs ±18% | 79.4 µs ±45% |
| multi-row insert: 100 rows, 300 parameters                    |  **240 µs ±21%** |   346 µs ±7% |      241 µs ±9% |  343 µs ±17% |     382 µs ±19% |   359 µs ±9% |
| update one row by primary key                                 | **32.6 µs ±11%** | 48.4 µs ±14% |     36.6 µs ±9% | 58.0 µs ±16% |     38.8 µs ±6% | 89.2 µs ±47% |
| upsert (insert … on conflict do update)                       |  **36.2 µs ±9%** |  46.8 µs ±7% |    39.4 µs ±11% | 51.2 µs ±10% |    38.3 µs ±27% | 87.2 µs ±13% |
| delete one row by primary key                                 |  **30.3 µs ±8%** |  41.0 µs ±8% |     32.6 µs ±7% | 47.3 µs ±12% |     33.3 µs ±7% |  72.7 µs ±9% |
| transaction: begin; select 1; commit                          | **65.9 µs ±10%** |  70.7 µs ±5% |     74.3 µs ±9% | 86.6 µs ±11% |     86.5 µs ±4% |  131 µs ±17% |
| transaction: begin; insert; commit                            |     77.8 µs ±44% |  87.7 µs ±6% | **76.7 µs ±7%** | 98.8 µs ±10% |     97.0 µs ±5% |  158 µs ±73% |
| transaction with 5 savepoints (select 1 in each)              |      377 µs ±10% |   418 µs ±7% |      420 µs ±5% |   479 µs ±9% | **349 µs ±10%** |   745 µs ±4% |
| query that fails (division by zero), connection reused        |  **36.4 µs ±8%** |  2.45 ms ±7% |    2.45 ms ±12% |  4.98 ms ±3% |     59.5 µs ±6% |  2.96 ms ±9% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **36.0 µs ±13%** |  43.5 µs ±5% |    38.0 µs ±12% |  51.9 µs ±9% |     36.5 µs ±4% | 83.2 µs ±55% |

**Node 24: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) |   pg-native |   postgres.js |   neon (WS) |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ----------: | ------------: | ----------: |
| select 1                                                      |  **37,167 ±6%** |  34,334 ±7% | 32,995 ±10% |  27,677 ±4% |   29,661 ±10% |  17,376 ±6% |
| point lookup by primary key                                   |  **29,722 ±7%** |  17,902 ±7% |  25,281 ±9% | 16,970 ±14% |   24,611 ±15% |  9,920 ±12% |
| range scan, 100 rows                                          |  **8,986 ±14%** |   4,400 ±9% |   4,558 ±7% |  4,167 ±15% |    4,853 ±14% |  3,764 ±17% |
| fetch 1k rows (6 columns)                                     |  **2,209 ±25%** |    656 ±11% |     712 ±7% |    605 ±16% |       811 ±8% |     616 ±5% |
| 100 parameters (id in (…)), 100 rows                          |  **3,620 ±11%** |  2,584 ±17% |  3,216 ±22% |  2,469 ±19% |    3,140 ±19% |  2,085 ±32% |
| 1000 parameters (id in (…)), 1000 rows                        |        436 ±12% |     346 ±8% | **441 ±5%** |    329 ±10% |       409 ±9% |    359 ±13% |
| insert one row                                                |  **29,980 ±9%** | 20,413 ±14% |  28,249 ±7% | 20,317 ±12% |   25,598 ±15% | 11,529 ±31% |
| multi-row insert: 100 rows, 300 parameters                    |  **3,997 ±17%** |   2,759 ±8% |   3,831 ±8% |  2,805 ±20% |    2,489 ±22% |   2,610 ±8% |
| update one row by primary key                                 |  **27,941 ±9%** | 19,180 ±12% |  25,468 ±9% | 15,785 ±14% |    23,572 ±5% | 10,402 ±32% |
| upsert (insert … on conflict do update)                       |  **25,475 ±8%** |  19,803 ±5% | 23,770 ±12% | 17,509 ±10% |   23,637 ±25% | 10,734 ±15% |
| delete one row by primary key                                 |  **30,659 ±8%** |  22,531 ±7% |  28,299 ±6% | 19,828 ±13% |    26,703 ±7% | 12,355 ±12% |
| transaction: begin; select 1; commit                          |  **13,964 ±8%** |  13,143 ±5% | 12,703 ±12% |  10,810 ±7% |    10,566 ±4% |  7,052 ±16% |
| transaction: begin; insert; commit                            | **12,236 ±27%** |  10,777 ±5% |  12,049 ±8% |   9,542 ±7% |     9,072 ±9% |  5,857 ±40% |
| transaction with 5 savepoints (select 1 in each)              |      2,509 ±10% |   2,292 ±6% |   2,233 ±3% |   1,982 ±8% | **2,615 ±8%** |   1,241 ±5% |
| query that fails (division by zero), connection reused        |  **24,699 ±9%** |     399 ±6% |    398 ±11% |     196 ±6% |   14,388 ±13% |    326 ±10% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **25,322 ±12%** |  20,088 ±8% | 23,300 ±10% |  18,020 ±5% |    24,641 ±6% | 10,604 ±33% |

**Node 24: tail latency p99, sequential**

| Scenario                                                      |      quarry |          pg |  pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ----------: | ----------: | --------: | ----------: | --------: |
| select 1                                                      |     47.8 µs | **45.3 µs** |     53.8 µs |   52.5 µs |     50.6 µs |    113 µs |
| point lookup by primary key                                   | **58.1 µs** |     91.5 µs |     66.9 µs |   95.8 µs |     61.6 µs |    214 µs |
| range scan, 100 rows                                          |      388 µs |      602 µs |      596 µs |    452 µs |  **335 µs** |    698 µs |
| fetch 1k rows (6 columns)                                     | **1.21 ms** |     2.50 ms |     2.28 ms |   2.43 ms |     7.99 ms |   2.43 ms |
| 100 parameters (id in (…)), 100 rows                          |  **600 µs** |      838 µs |      682 µs |    891 µs |      632 µs |    954 µs |
| 1000 parameters (id in (…)), 1000 rows                        |     3.40 ms |     4.00 ms | **3.04 ms** |   4.40 ms |     4.80 ms |   4.21 ms |
| insert one row                                                | **66.3 µs** |     89.1 µs |     66.7 µs |   80.1 µs |     70.3 µs |    232 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **491 µs** |      642 µs |      497 µs |    655 µs |      789 µs |    770 µs |
| update one row by primary key                                 | **54.2 µs** |     91.1 µs |     61.2 µs |   99.6 µs |     71.8 µs |    229 µs |
| upsert (insert … on conflict do update)                       | **62.1 µs** |     79.3 µs |     68.2 µs |   99.2 µs |     69.6 µs |    196 µs |
| delete one row by primary key                                 | **53.0 µs** |     71.7 µs |     57.9 µs |   80.8 µs |     62.5 µs |    171 µs |
| transaction: begin; select 1; commit                          |      121 µs |  **103 µs** |      118 µs |    131 µs |      150 µs |    228 µs |
| transaction: begin; insert; commit                            |      128 µs |      141 µs |  **121 µs** |    154 µs |      182 µs |    322 µs |
| transaction with 5 savepoints (select 1 in each)              |      932 µs |  **561 µs** |      688 µs |    704 µs |      591 µs |   2.25 ms |
| query that fails (division by zero), connection reused        | **66.8 µs** |     3.47 ms |     3.64 ms |   6.35 ms |      117 µs |   4.45 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler |     88.6 µs |      102 µs |     91.6 µs |   98.2 µs | **74.5 µs** |    370 µs |

**Node 24: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) |  pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ---------: | ----------: | --------: |
| select 1                                                      |      414 µs |  412 µs |      444 µs |     287 µs |  **183 µs** |    656 µs |
| point lookup by primary key                                   |      572 µs |  587 µs |      536 µs |     496 µs |  **366 µs** |    733 µs |
| range scan, 100 rows                                          |  **696 µs** |  936 µs |      975 µs |     745 µs |     8.66 ms |   1.36 ms |
| fetch 1k rows (6 columns)                                     | **2.88 ms** | 2.98 ms |     2.91 ms |    3.96 ms |    11.19 ms |   3.34 ms |
| 100 parameters (id in (…)), 100 rows                          | **1.22 ms** | 1.78 ms |     1.63 ms |    1.46 ms |     3.65 ms |   1.85 ms |
| 1000 parameters (id in (…)), 1000 rows                        |     4.36 ms | 4.52 ms | **3.84 ms** |    4.70 ms |     9.19 ms |   4.93 ms |
| insert one row                                                |      521 µs |  550 µs |      482 µs |     464 µs |  **333 µs** |    735 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **779 µs** | 1.62 ms |     1.42 ms |     887 µs |     2.04 ms |   1.64 ms |
| update one row by primary key                                 |      488 µs |  528 µs |      493 µs |     587 µs |  **439 µs** |    668 µs |
| upsert (insert … on conflict do update)                       |      570 µs |  570 µs |      553 µs |     454 µs |  **377 µs** |    677 µs |
| delete one row by primary key                                 |      480 µs |  509 µs |      524 µs |     473 µs |  **265 µs** |    668 µs |
| transaction: begin; select 1; commit                          |      742 µs |  668 µs |      822 µs | **598 µs** |     1.32 ms |   2.29 ms |
| transaction: begin; insert; commit                            |  **644 µs** |  992 µs |      726 µs |     663 µs |     1.55 ms |   1.93 ms |
| transaction with 5 savepoints (select 1 in each)              | **1.54 ms** | 3.34 ms |     3.59 ms |    3.21 ms |     6.03 ms |   5.81 ms |
| query that fails (division by zero), connection reused        |  **497 µs** | 4.21 ms |     4.00 ms |    6.52 ms |      554 µs |   4.87 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **523 µs** |  597 µs |      560 µs |     529 µs |      666 µs |    948 µs |

**Node 24: latency distribution, select 1**

| Percentile |          quarry |               pg |   pg (named) |       pg-native |     postgres.js |    neon (WS) |
| ---------- | --------------: | ---------------: | -----------: | --------------: | --------------: | -----------: |
| p50        | **24.6 µs ±6%** |     26.5 µs ±10% | 28.0 µs ±12% |     34.2 µs ±3% |    31.3 µs ±10% | 52.8 µs ±13% |
| p90        | **28.4 µs ±6%** |      30.9 µs ±6% | 32.0 µs ±18% |     39.7 µs ±9% |    35.5 µs ±10% |  62.7 µs ±6% |
| p99        |     47.8 µs ±9% | **45.3 µs ±13%** | 53.8 µs ±35% |    52.5 µs ±16% |    50.6 µs ±13% |  113 µs ±14% |
| p99.9      |     414 µs ±10% |      412 µs ±21% |   444 µs ±8% |     287 µs ±32% | **183 µs ±87%** |  656 µs ±13% |
| max        |    1.59 ms ±22% |     2.38 ms ±52% | 2.26 ms ±81% | **917 µs ±18%** |    5.80 ms ±48% | 3.49 ms ±25% |

**Node 24: latency distribution, point lookup by primary key**

| Percentile |           quarry |           pg |   pg (named) |    pg-native |     postgres.js |    neon (WS) |
| ---------- | ---------------: | -----------: | -----------: | -----------: | --------------: | -----------: |
| p50        |  **31.4 µs ±4%** |  51.2 µs ±7% | 35.6 µs ±10% | 53.8 µs ±15% |    37.1 µs ±13% | 92.9 µs ±11% |
| p90        | **36.3 µs ±12%** |  62.9 µs ±8% | 43.7 µs ±10% | 69.9 µs ±17% |    43.6 µs ±16% |  113 µs ±15% |
| p99        |  **58.1 µs ±7%** | 91.5 µs ±11% | 66.9 µs ±12% | 95.8 µs ±24% |    61.6 µs ±22% |  214 µs ±29% |
| p99.9      |      572 µs ±12% |  587 µs ±11% |  536 µs ±15% |  496 µs ±15% | **366 µs ±15%** |  733 µs ±12% |
| max        | **2.01 ms ±79%** | 3.18 ms ±24% | 2.47 ms ±38% | 3.34 ms ±35% |    5.28 ms ±73% | 4.14 ms ±39% |

**Node 24: large results and bulk work, time per operation (median)**

| Scenario                                                                    |            quarry |               pg |    pg (named) |     pg-native |   postgres.js |     neon (WS) |
| --------------------------------------------------------------------------- | ----------------: | ---------------: | ------------: | ------------: | ------------: | ------------: |
| fetch 100k rows                                                             | **51.68 ms ±18%** |       141 ms ±9% |    145 ms ±8% |    159 ms ±9% |    106 ms ±6% |    160 ms ±5% |
| fetch 1M rows (one result)                                                  |    **612 ms ±6%** |      1529 ms ±7% |  1543 ms ±14% |  1598 ms ±12% |   1207 ms ±7% |  1721 ms ±13% |
| wide rows: 1k rows × 100 columns                                            |   **4.77 ms ±8%** |     15.65 ms ±9% |  15.72 ms ±9% |  22.00 ms ±8% | 17.73 ms ±15% |  19.86 ms ±8% |
| large values: 10 × 1 MB text                                                |   **5.03 ms ±9%** |      5.93 ms ±4% |   5.97 ms ±5% |  12.53 ms ±6% |  5.66 ms ±16% | 10.10 ms ±17% |
| large values: 10 × 1 MB bytea                                               |  **3.88 ms ±10%** |     19.23 ms ±8% |  18.18 ms ±5% | 37.22 ms ±10% | 18.08 ms ±13% | 26.20 ms ±23% |
| large values: 20 × 200 KB jsonb                                             |     27.50 ms ±26% | **26.57 ms ±7%** |  27.32 ms ±5% | 41.15 ms ±11% |  27.84 ms ±5% |  31.38 ms ±5% |
| arrays: 1k rows of int4[100] + text[20]                                     |   **7.83 ms ±5%** |    25.72 ms ±12% | 24.74 ms ±48% |  32.24 ms ±6% |   9.48 ms ±5% | 28.97 ms ±15% |
| bulk insert 10k rows (unnest arrays)                                        |      14.31 ms ±5% | **13.63 ms ±8%** |  13.78 ms ±5% | 15.63 ms ±56% | 13.67 ms ±12% |  14.91 ms ±5% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |  **13.44 ms ±4%** |     14.17 ms ±7% |  13.70 ms ±9% |           n/a |  56.21 ms ±1% |           n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **849 ms ±17%** |      1356 ms ±6% |   1417 ms ±6% |           n/a |   1243 ms ±6% |           n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **434 ms ±<1%** |       749 ms ±2% |    744 ms ±4% |           n/a |    727 ms ±4% |           n/a |

**Node 24: rows per second (median)**

| Scenario                                      |        quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------- | ------------: | ------: | ---------: | --------: | ----------: | --------: |
| fetch 1k rows (6 columns)                     | **2,209,118** | 656,088 |    712,082 |   604,736 |     810,676 |   616,244 |
| fetch 100k rows                               | **1,843,061** | 682,520 |    687,964 |   623,595 |     917,531 |   607,628 |
| fetch 1M rows (one result)                    | **1,630,761** | 654,295 |    647,327 |   622,591 |     833,670 |   569,837 |
| wide rows: 1k rows × 100 columns              |   **202,947** |  60,169 |     60,460 |    42,822 |      49,791 |    48,296 |
| arrays: 1k rows of int4[100] + text[20]       |   **119,471** |  36,788 |     37,323 |    29,830 |      93,282 |    32,887 |
| stream 1M rows with a cursor (1000 per batch) | **1,138,580** | 743,007 |    716,642 |       n/a |     795,545 |       n/a |
| bulk insert 10k rows (unnest arrays)          |       689,205 | 711,695 |    721,720 |   591,996 | **726,091** |   662,331 |
| bulk insert 10k rows (COPY FROM STDIN, text)  |   **736,222** | 700,153 |    705,966 |       n/a |     175,205 |       n/a |

**Node 24: peak RSS (MB) during the scenario**

| Scenario                                                                    |  quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------------------------------------- | ------: | ----: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key                                                 |     106 |   105 |        106 |   **104** |         151 |       104 |
| fetch 100k rows                                                             | **432** |   525 |        524 |       526 |         516 |       537 |
| fetch 1M rows (one result)                                                  |   1,620 | 1,369 |      1,370 |     1,665 |   **1,119** |     1,398 |
| stream 1M rows with a cursor (1000 per batch)                               | **157** |   210 |        210 |       n/a |         246 |       n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |     192 |   120 |    **119** |       n/a |         230 |       n/a |
| large values: 10 × 1 MB text                                                |     194 |   207 |        207 |       280 |     **193** |       236 |
| large values: 10 × 1 MB bytea                                               |     196 |   209 |        214 |       250 |     **194** |       234 |
| large values: 20 × 200 KB jsonb                                             |     352 |   298 |        296 |   **260** |         391 |       347 |

**Node 24: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |  quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------------------- | ------: | ------: | ---------: | --------: | ----------: | --------: |
| RSS growth during pause | **0.0** | **0.0** |    **0.0** |       n/a |     **0.0** |       n/a |

**Node 24: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry | quarry (lossless) |        pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------- | -----------: | ----------------: | --------: | ---------: | --------: | ----------: | --------: |
| int4                 |   **84 ±4%** |           90 ±19% |  236 ±16% |    222 ±8% |   214 ±8% |    302 ±10% |  349 ±13% |
| int8                 | **166 ±23%** |          211 ±55% |  256 ±10% |    266 ±6% |   226 ±4% |     302 ±4% |  344 ±17% |
| float8               | **100 ±20%** |          107 ±22% |   229 ±5% |   272 ±23% |  245 ±14% |     323 ±4% |  387 ±20% |
| numeric              | **189 ±19%** |          190 ±22% |  203 ±14% |   199 ±17% |  239 ±12% |    292 ±14% |  307 ±27% |
| text                 | **160 ±24%** |          165 ±12% |   198 ±8% |   190 ±10% |   215 ±3% |     267 ±7% |   315 ±9% |
| bool                 |      97 ±21% |        **94 ±6%** |  174 ±12% |    159 ±9% |  178 ±21% |    243 ±14% |  281 ±16% |
| timestamptz          |      217 ±2% |       **193 ±4%** |   746 ±7% |   758 ±11% |  778 ±22% |     531 ±9% |  924 ±17% |
| date                 | **145 ±29%** |          178 ±15% |  548 ±13% |   587 ±10% |   498 ±6% |     426 ±7% |   688 ±2% |
| uuid                 |     189 ±34% |       **181 ±7%** |  221 ±14% |   243 ±22% |   240 ±8% |     304 ±8% |  336 ±13% |
| jsonb (small object) | **474 ±14%** |           496 ±8% |  492 ±35% |   507 ±51% |  610 ±15% |    544 ±15% |  683 ±18% |
| int4[5]              |  **638 ±6%** |           673 ±8% | 1,484 ±6% | 1,522 ±16% | 1,504 ±7% |    699 ±11% | 1,920 ±5% |
| bytea (16 B)         |     264 ±14% |      **260 ±26%** |   439 ±9% |    431 ±3% |   423 ±9% |     444 ±9% |  581 ±13% |

**Node 24: writes, operations/s (bulk rows: batches of 10k rows per second)**

| Scenario                                     |           quarry |          pg |  pg (named) |   pg-native |   postgres.js |   neon (WS) |
| -------------------------------------------- | ---------------: | ----------: | ----------: | ----------: | ------------: | ----------: |
| insert one row                               |   **29,980 ±9%** | 20,413 ±14% |  28,249 ±7% | 20,317 ±12% |   25,598 ±15% | 11,529 ±31% |
| insert one row, concurrency 50               | **186,056 ±12%** | 78,993 ±29% | 71,802 ±24% |  65,722 ±6% |    37,920 ±4% | 28,207 ±26% |
| multi-row insert: 100 rows, 300 parameters   |   **3,997 ±17%** |   2,759 ±8% |   3,831 ±8% |  2,805 ±20% |    2,489 ±22% |   2,610 ±8% |
| bulk insert 10k rows (unnest arrays)         |         68.9 ±5% |   71.2 ±13% |    72.2 ±8% |   59.2 ±29% | **72.6 ±13%** |    66.2 ±5% |
| bulk insert 10k rows (COPY FROM STDIN, text) |     **73.6 ±4%** |   70.0 ±10% |    70.6 ±7% |         n/a |      17.5 ±3% |         n/a |
| update one row by primary key                |   **27,941 ±9%** | 19,180 ±12% |  25,468 ±9% | 15,785 ±14% |    23,572 ±5% | 10,402 ±32% |
| upsert (insert … on conflict do update)      |   **25,475 ±8%** |  19,803 ±5% | 23,770 ±12% | 17,509 ±10% |   23,637 ±25% | 10,734 ±15% |
| delete one row by primary key                |   **30,659 ±8%** |  22,531 ±7% |  28,299 ±6% | 19,828 ±13% |    26,703 ±7% | 12,355 ±12% |

**Node 24: transactions, operations/s**

| Scenario                                         |          quarry |         pg |  pg (named) |  pg-native |   postgres.js |  neon (WS) |
| ------------------------------------------------ | --------------: | ---------: | ----------: | ---------: | ------------: | ---------: |
| transaction: begin; select 1; commit             |  **13,964 ±8%** | 13,143 ±5% | 12,703 ±12% | 10,810 ±7% |    10,566 ±4% | 7,052 ±16% |
| transaction: begin; insert; commit               | **12,236 ±27%** | 10,777 ±5% |  12,049 ±8% |  9,542 ±7% |     9,072 ±9% | 5,857 ±40% |
| transaction with 5 savepoints (select 1 in each) |      2,509 ±10% |  2,292 ±6% |   2,233 ±3% |  1,982 ±8% | **2,615 ±8%** |  1,241 ±5% |

**Node 24: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------ | ---------: | -------: | ---------: | --------: | ----------: | --------: |
| select 1                                               |       18.7 | **18.5** |       21.6 |      22.8 |        25.9 |      32.3 |
| point lookup by primary key                            |   **20.3** |     30.4 |       26.7 |      31.0 |        31.3 |      64.2 |
| fetch 1k rows (6 columns)                              |    **461** |    1,374 |      1,309 |     1,294 |       1,336 |     1,470 |
| fetch 100k rows                                        | **74,888** |  185,692 |    185,260 |   178,100 |     142,579 |   210,906 |
| insert one row                                         |   **20.0** |     23.4 |       21.1 |      24.9 |        29.3 |      53.3 |
| insert one row, concurrency 50                         |    **6.2** |     13.5 |       15.1 |      16.0 |        31.5 |      37.4 |
| transaction: begin; insert; commit                     |   **52.2** |     57.7 |       56.0 |      62.1 |        90.9 |       102 |
| query that fails (division by zero), connection reused |   **31.8** |      648 |        623 |     1,352 |        64.4 |     1,134 |

**Node 24: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------ | -------: | ---: | ---------: | --------: | ----------: | --------: |
| select 1                             |  **9.7** | 11.8 |       10.3 |      16.0 |        12.7 |      12.9 |
| point lookup by primary key          | **15.8** | 30.8 |       15.8 |      33.6 |        16.3 |      44.4 |
| fetch 1k rows (6 columns)            |  **253** |  452 |        390 |       496 |         413 |       474 |
| 100 parameters (id in (…)), 100 rows |      199 |  278 |        214 |       285 |     **194** |       312 |
| insert one row                       |     15.5 | 28.9 |       16.0 |      29.0 |    **15.2** |      39.9 |
| insert one row, concurrency 50       | **13.2** | 36.3 |       20.4 |      42.6 |        20.0 |      49.7 |
| transaction: begin; insert; commit   |     33.5 | 44.3 |   **33.2** |      52.8 |        39.2 |      53.9 |

**Node 24: GC time (ms per second of run) / longest GC pause**

| Scenario                                       |   quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ---------------------------------------------- | -------: | ----: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: GC ms/s           |     21.6 |  18.4 |       22.7 |   **9.9** |        24.3 |      17.9 |
| point lookup by primary key: max pause ms      |      1.0 |   0.8 |        0.6 |   **0.5** |         4.3 |       0.7 |
| insert one row, concurrency 50: GC ms/s        |     51.3 |  30.7 |       29.7 |  **20.4** |        26.8 |      23.4 |
| insert one row, concurrency 50: max pause ms   |      2.5 |   1.9 |        1.7 |   **1.6** |         7.9 |       2.0 |
| fetch 1k rows (6 columns): GC ms/s             |     34.6 |  18.3 |       16.9 |  **13.7** |        93.8 |      24.2 |
| fetch 1k rows (6 columns): max pause ms        |      2.2 |   0.9 |    **0.7** |       1.7 |         9.3 |       0.9 |
| fetch 100k rows: GC ms/s                       |    168.1 | 137.4 |      140.1 | **101.7** |       151.8 |     149.1 |
| fetch 100k rows: max pause ms                  | **14.6** |  15.3 |       16.9 |      14.9 |        19.3 |      15.2 |
| fetch 1M rows (one result): GC ms/s            |    201.0 | 180.2 |      184.3 |  **91.1** |       173.1 |     168.2 |
| fetch 1M rows (one result): max pause ms       |     22.6 |  25.9 |       23.1 |      22.5 |        29.0 |  **20.0** |
| wide rows: 1k rows × 100 columns: GC ms/s      |     29.1 |  29.6 |       29.2 |  **18.1** |       136.3 |      55.9 |
| wide rows: 1k rows × 100 columns: max pause ms |  **1.8** |   4.3 |        4.7 |       3.6 |        10.8 |       4.3 |
| large values: 20 × 200 KB jsonb: GC ms/s       |     33.2 |  35.5 |       33.6 |  **13.5** |        32.2 |      46.4 |
| large values: 20 × 200 KB jsonb: max pause ms  |      7.5 |   7.7 |        7.4 |   **5.1** |         8.4 |       7.9 |

**Node 24: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |   quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | -------: | ------: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: p99                   |      0.2 |     0.5 |        0.2 |   **0.1** |         1.9 |       0.2 |
| point lookup by primary key: max                   |      0.4 |     2.2 |    **0.4** |       1.4 |         1.9 |       1.2 |
| insert one row, concurrency 50: p99                |      0.7 |     0.5 |        0.7 |   **0.3** |         3.0 |       0.4 |
| insert one row, concurrency 50: max                |      0.9 |     0.9 |        1.6 |   **0.4** |         3.0 |       0.9 |
| fetch 1k rows (6 columns): p99                     |  **0.4** |     1.0 |        1.1 |       1.3 |         8.0 |       1.6 |
| fetch 1k rows (6 columns): max                     |      1.0 | **1.0** |        1.1 |       1.3 |         8.0 |       1.6 |
| fetch 100k rows: p99                               | **20.4** |    43.8 |       40.6 |     135.1 |        30.9 |      48.5 |
| fetch 100k rows: max                               | **21.7** |    43.8 |       40.6 |     135.1 |        30.9 |      48.5 |
| fetch 1M rows (one result): p99                    | **31.5** |    40.1 |       37.4 |   1,230.6 |        38.3 |      49.6 |
| fetch 1M rows (one result): max                    |     44.8 |    44.5 |   **41.1** |   1,251.4 |        49.6 |     101.2 |
| stream 1M rows with a cursor (1000 per batch): p99 |  **0.7** |     0.9 |        1.1 |       n/a |         9.0 |       n/a |
| stream 1M rows with a cursor (1000 per batch): max |  **1.6** |     1.7 |        2.3 |       n/a |         9.7 |       n/a |

**Node 24: connections (median time per operation)**

| Scenario                                                    |       quarry |               pg |      pg (named) |     pg-native |  postgres.js |       neon (WS) |
| ----------------------------------------------------------- | -----------: | ---------------: | --------------: | ------------: | -----------: | --------------: |
| connect + select 1 + close (no TLS, trust)                  |  4.02 ms ±2% |      4.02 ms ±6% | **4.01 ms ±3%** |   5.04 ms ±3% |  7.40 ms ±4% |     4.53 ms ±4% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          |  6.01 ms ±7% |  **5.67 ms ±3%** |     5.87 ms ±9% |   7.56 ms ±9% |  8.48 ms ±8% |    73.10 ms ±5% |
| connect + select 1 + close (TLS verify-full, trust)         |  5.61 ms ±7% |      5.52 ms ±3% |    5.51 ms ±10% |  5.24 ms ±11% | 53.25 ms ±4% | **4.92 ms ±6%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |  7.58 ms ±8% |  **7.21 ms ±5%** |     7.28 ms ±5% |   7.87 ms ±4% | 56.09 ms ±3% |    72.12 ms ±5% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     | 9.36 ms ±10% | **8.52 ms ±14%** |     9.36 ms ±5% | 14.10 ms ±12% | 16.36 ms ±9% |     9.26 ms ±9% |

**Node 24: cancellation, notifications, errors**

| Scenario                                      |      quarry |        pg |    pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------- | ----------: | --------: | ------------: | --------: | ----------: | --------: |
| cancel: time from cancel() to rejection (p50) | **1.57 ms** |   1.68 ms |       1.67 ms |   2.67 ms |     1.63 ms |       n/a |
| cancel: share of queries actually cancelled   |    **100%** |  **100%** |      **100%** |  **100%** |    **100%** |       n/a |
| NOTIFY latency p50                            | **36.0 µs** |   43.5 µs |       38.0 µs |   51.9 µs |     36.5 µs |   83.2 µs |
| NOTIFY latency p99                            |     88.6 µs |    102 µs |       91.6 µs |   98.2 µs | **74.5 µs** |    370 µs |
| NOTIFY throughput (notifications/s)           |   1,652,068 | 1,877,818 | **1,904,356** |   772,872 |   1,696,500 | 1,538,931 |
| error path: failing queries/s                 |  **24,699** |       399 |           398 |       196 |      14,388 |       326 |

**Node 24: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |              pg-native |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 37,167 / 30,712 / +21% |  32,995 / 34,334 / -4% |  27,677 / 27,677 / -0% |   29,661 / 30,779 / -4% |
| point lookup by primary key             | 29,722 / 18,527 / +60% | 25,281 / 17,902 / +41% | 22,044 / 16,970 / +30% | 24,611 / 11,743 / +110% |
| range scan, 100 rows                    |   8,986 / 5,758 / +56% |    4,558 / 4,400 / +4% |   4,714 / 4,167 / +13% |    4,853 / 4,169 / +16% |
| fetch 1k rows (6 columns)               |  2,209 / 1,011 / +119% |        712 / 656 / +9% |        626 / 605 / +3% |        811 / 696 / +17% |
| 100 parameters (id in (…)), 100 rows    |   3,620 / 2,822 / +28% |   3,216 / 2,584 / +24% |   3,197 / 2,469 / +29% |    3,140 / 2,321 / +35% |
| 1000 parameters (id in (…)), 1000 rows  |       436 / 361 / +21% |       441 / 346 / +28% |       369 / 329 / +12% |        409 / 333 / +23% |
| insert one row                          | 29,980 / 20,486 / +46% | 28,249 / 20,413 / +38% | 24,800 / 20,317 / +22% |  25,598 / 13,506 / +90% |
| upsert (insert … on conflict do update) | 25,475 / 18,909 / +35% | 23,770 / 19,803 / +20% | 21,247 / 17,509 / +21% |  23,637 / 12,471 / +90% |

**Node 24: quarry decoding modes (time per op)**

| Scenario                                |            quarry | quarry (lossless) |
| --------------------------------------- | ----------------: | ----------------: |
| point lookup by primary key             |       31.4 µs ±4% |   **29.2 µs ±3%** |
| fetch 1k rows (6 columns)               |   **404 µs ±26%** |        409 µs ±8% |
| fetch 100k rows                         |     51.68 ms ±18% | **47.50 ms ±19%** |
| fetch 1M rows (one result)              |        612 ms ±6% |   **603 ms ±13%** |
| wide rows: 1k rows × 100 columns        |       4.77 ms ±8% |  **4.70 ms ±11%** |
| arrays: 1k rows of int4[100] + text[20] |       7.83 ms ±5% |  **7.53 ms ±89%** |
| decode 100k × int8                      | **16.56 ms ±23%** |     21.07 ms ±55% |
| decode 100k × timestamptz               |      21.74 ms ±2% |  **19.34 ms ±4%** |
| decode 100k × date                      | **14.53 ms ±29%** |     17.82 ms ±15% |

**Node 24: shipped defaults vs tuned (median latency)**

| Scenario                                   |   neon (WS) | neon (WS, defaults) |
| ------------------------------------------ | ----------: | ------------------: |
| select 1                                   | **52.8 µs** |             1.48 ms |
| point lookup by primary key                | **92.9 µs** |             1.61 ms |
| fetch 1k rows (6 columns)                  | **1.57 ms** |             3.19 ms |
| insert one row                             | **79.4 µs** |             1.56 ms |
| transaction: begin; insert; commit         |  **158 µs** |             4.61 ms |
| connect + select 1 + close (no TLS, trust) |     4.53 ms |                   — |

## Bun 1.4

**Bun 1.4: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |               pg |       pg (named) |      postgres.js |         Bun.sql |
| ------------------------------------------------------------- | ---------------: | ---------------: | ---------------: | ---------------: | --------------: |
| select 1                                                      |  **21.9 µs ±4%** |      23.2 µs ±8% |     22.4 µs ±15% |     24.6 µs ±13% |     25.7 µs ±6% |
| point lookup by primary key                                   |  **29.1 µs ±6%** |      42.9 µs ±9% |      31.2 µs ±8% |      29.8 µs ±5% |    32.3 µs ±13% |
| range scan, 100 rows                                          |  **87.3 µs ±7%** |      150 µs ±13% |       154 µs ±8% |       141 µs ±6% |     102 µs ±10% |
| fetch 1k rows (6 columns)                                     |   **288 µs ±4%** |     1.08 ms ±10% |      924 µs ±10% |      855 µs ±15% |      407 µs ±6% |
| 100 parameters (id in (…)), 100 rows                          |  **223 µs ±21%** |      313 µs ±18% |      230 µs ±22% |      295 µs ±20% |      231 µs ±6% |
| 1000 parameters (id in (…)), 1000 rows                        |      2.02 ms ±8% |     2.71 ms ±11% |     2.12 ms ±17% |      2.19 ms ±7% | **1.96 ms ±5%** |
| insert one row                                                |  **27.3 µs ±5%** |     36.1 µs ±11% |     28.2 µs ±11% |     30.5 µs ±21% |    28.9 µs ±19% |
| multi-row insert: 100 rows, 300 parameters                    |      216 µs ±28% |      344 µs ±14% |       218 µs ±5% |      253 µs ±11% |  **206 µs ±8%** |
| update one row by primary key                                 |      33.6 µs ±9% |     45.8 µs ±12% |     33.8 µs ±10% | **31.8 µs ±12%** |    35.7 µs ±10% |
| upsert (insert … on conflict do update)                       |  **30.3 µs ±9%** |      41.1 µs ±2% |      31.6 µs ±8% |      35.2 µs ±4% |     36.3 µs ±9% |
| delete one row by primary key                                 | **25.3 µs ±20%** |     35.5 µs ±25% |      27.3 µs ±4% |     27.6 µs ±18% |     30.3 µs ±7% |
| transaction: begin; select 1; commit                          |     62.6 µs ±11% | **60.0 µs ±21%** |      62.2 µs ±7% |      76.7 µs ±8% |    83.9 µs ±10% |
| transaction: begin; insert; commit                            |      69.6 µs ±7% |      74.6 µs ±5% | **68.3 µs ±54%** |     72.2 µs ±16% |     86.7 µs ±7% |
| transaction with 5 savepoints (select 1 in each)              |       347 µs ±6% |       357 µs ±7% |       334 µs ±7% |   **303 µs ±6%** |     449 µs ±43% |
| query that fails (division by zero), connection reused        | **31.1 µs ±13%** |      2.37 ms ±9% |     2.49 ms ±13% |     37.7 µs ±20% |    32.5 µs ±30% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **31.6 µs ±7%** |      39.4 µs ±9% |      32.3 µs ±9% |      33.5 µs ±7% |     35.7 µs ±7% |

**Bun 1.4: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |      pg (named) |     postgres.js |       Bun.sql |
| ------------------------------------------------------------- | --------------: | ----------: | --------------: | --------------: | ------------: |
| select 1                                                      |  **43,312 ±4%** |  40,911 ±8% |     41,902 ±12% |     37,755 ±12% |    36,687 ±8% |
| point lookup by primary key                                   | **32,644 ±10%** |  21,191 ±8% |     30,061 ±10% |      31,617 ±6% |   29,655 ±15% |
| range scan, 100 rows                                          |  **10,523 ±5%** |  6,189 ±15% |      5,906 ±10% |       6,715 ±7% |    9,157 ±13% |
| fetch 1k rows (6 columns)                                     |   **3,126 ±4%** |    832 ±11% |         985 ±8% |      1,065 ±10% |    2,339 ±15% |
| 100 parameters (id in (…)), 100 rows                          |  **4,326 ±19%** |  2,977 ±15% |      4,123 ±20% |      3,241 ±24% |     4,270 ±8% |
| 1000 parameters (id in (…)), 1000 rows                        |         483 ±8% |    364 ±14% |        461 ±15% |         446 ±7% |   **495 ±8%** |
| insert one row                                                |  **34,893 ±7%** |  25,489 ±7% |     33,388 ±10% |     30,987 ±19% |   32,443 ±18% |
| multi-row insert: 100 rows, 300 parameters                    |      4,322 ±20% |  2,740 ±18% |       4,384 ±4% |      3,788 ±11% | **4,419 ±7%** |
| update one row by primary key                                 |      28,121 ±8% | 20,031 ±14% |     28,316 ±11% | **29,771 ±10%** |   26,402 ±13% |
| upsert (insert … on conflict do update)                       |  **31,192 ±8%** |  22,593 ±4% |      29,656 ±7% |      26,924 ±3% |    26,251 ±5% |
| delete one row by primary key                                 | **36,227 ±15%** | 26,175 ±21% |      34,424 ±5% |     33,826 ±14% |    31,854 ±9% |
| transaction: begin; select 1; commit                          |     15,273 ±11% | 15,285 ±16% |  **15,322 ±7%** |     12,244 ±10% |   10,334 ±13% |
| transaction: begin; insert; commit                            |      13,625 ±6% |  12,699 ±4% | **14,108 ±36%** |     13,098 ±16% |     9,559 ±8% |
| transaction with 5 savepoints (select 1 in each)              |       2,741 ±5% |   2,722 ±8% |       2,878 ±5% |   **3,119 ±6%** |    1,917 ±25% |
| query that fails (division by zero), connection reused        | **29,402 ±11%** |     414 ±9% |        392 ±11% |     23,947 ±15% |   28,303 ±21% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **29,081 ±10%** | 22,573 ±17% |      28,532 ±7% |      27,845 ±8% |    26,717 ±9% |

**Bun 1.4: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ----------: | ----------: |
| select 1                                                      |     33.4 µs | 32.7 µs | **32.3 µs** |     39.2 µs |     38.1 µs |
| point lookup by primary key                                   | **41.8 µs** | 71.5 µs |     49.9 µs |     46.5 µs |     47.8 µs |
| range scan, 100 rows                                          |  **157 µs** |  466 µs |      470 µs |      411 µs |      172 µs |
| fetch 1k rows (6 columns)                                     |  **756 µs** | 2.44 ms |     1.80 ms |     1.61 ms |      770 µs |
| 100 parameters (id in (…)), 100 rows                          |      359 µs |  698 µs |      449 µs |      666 µs |  **319 µs** |
| 1000 parameters (id in (…)), 1000 rows                        |     3.24 ms | 3.51 ms |     3.05 ms |     2.91 ms | **2.40 ms** |
| insert one row                                                | **43.8 µs** | 65.2 µs |     49.4 µs |     51.8 µs |     48.2 µs |
| multi-row insert: 100 rows, 300 parameters                    |      443 µs |  675 µs |      389 µs |      549 µs |  **369 µs** |
| update one row by primary key                                 | **48.9 µs** | 76.0 µs |     51.0 µs |     53.1 µs |     53.9 µs |
| upsert (insert … on conflict do update)                       | **47.4 µs** | 66.6 µs |     48.7 µs |     53.5 µs |     58.0 µs |
| delete one row by primary key                                 | **40.5 µs** | 54.8 µs |     43.7 µs |     42.9 µs |     45.6 µs |
| transaction: begin; select 1; commit                          | **85.3 µs** | 99.1 µs |     88.1 µs |      121 µs |      392 µs |
| transaction: begin; insert; commit                            |      110 µs |  115 µs |  **100 µs** |      114 µs |      408 µs |
| transaction with 5 savepoints (select 1 in each)              |  **637 µs** |  781 µs |      646 µs |      803 µs |     1.06 ms |
| query that fails (division by zero), connection reused        | **48.6 µs** | 3.19 ms |     3.39 ms |     60.6 µs |     60.9 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |     55.3 µs | 74.9 µs |     60.1 µs |     55.8 µs | **53.5 µs** |

**Bun 1.4: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |         pg |  pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ---------: | ----------: | ----------: | ----------: |
| select 1                                                      | **67.7 µs** |     259 µs |      140 µs |      198 µs |      201 µs |
| point lookup by primary key                                   |  **172 µs** |     450 µs |      443 µs |      372 µs |      226 µs |
| range scan, 100 rows                                          |      575 µs |     730 µs |      852 µs |      647 µs |  **474 µs** |
| fetch 1k rows (6 columns)                                     |     2.08 ms |    3.70 ms |     2.94 ms |     2.49 ms | **1.58 ms** |
| 100 parameters (id in (…)), 100 rows                          |      888 µs |    1.13 ms |      754 µs |     1.04 ms |  **629 µs** |
| 1000 parameters (id in (…)), 1000 rows                        |     3.86 ms |    4.46 ms |     3.67 ms |     3.73 ms | **3.60 ms** |
| insert one row                                                |  **134 µs** |     409 µs |      301 µs |      399 µs |      207 µs |
| multi-row insert: 100 rows, 300 parameters                    |      960 µs |    1.09 ms |  **738 µs** |      889 µs |      959 µs |
| update one row by primary key                                 |  **140 µs** |     462 µs |      340 µs |      270 µs |      266 µs |
| upsert (insert … on conflict do update)                       |      260 µs |     384 µs |      290 µs |      366 µs |  **240 µs** |
| delete one row by primary key                                 |  **105 µs** |     377 µs |      375 µs |      297 µs |      204 µs |
| transaction: begin; select 1; commit                          |      850 µs | **476 µs** |      497 µs |      733 µs |      696 µs |
| transaction: begin; insert; commit                            |      809 µs |     546 µs |  **536 µs** |      553 µs |      733 µs |
| transaction with 5 savepoints (select 1 in each)              |     1.69 ms |    1.35 ms | **1.15 ms** |     1.34 ms |     1.75 ms |
| query that fails (division by zero), connection reused        |      298 µs |    3.77 ms |     3.86 ms |      605 µs |  **268 µs** |
| LISTEN/NOTIFY latency: notify on another connection → handler |      459 µs |     513 µs |      474 µs |      541 µs |  **320 µs** |

**Bun 1.4: latency distribution, select 1**

| Percentile |           quarry |           pg |       pg (named) |   postgres.js |       Bun.sql |
| ---------- | ---------------: | -----------: | ---------------: | ------------: | ------------: |
| p50        |  **21.9 µs ±4%** |  23.2 µs ±8% |     22.4 µs ±15% |  24.6 µs ±13% |   25.7 µs ±6% |
| p90        |  **25.1 µs ±8%** | 26.2 µs ±12% |     25.8 µs ±18% |  29.6 µs ±17% |  29.2 µs ±12% |
| p99        |     33.4 µs ±15% | 32.7 µs ±17% | **32.3 µs ±22%** |  39.2 µs ±32% |  38.1 µs ±59% |
| p99.9      | **67.7 µs ±51%** |  259 µs ±55% |      140 µs ±66% |   198 µs ±92% |   201 µs ±63% |
| max        |     1.08 ms ±94% | 1.10 ms ±34% |  **884 µs ±64%** | 1.47 ms ±503% | 1.07 ms ±549% |

**Bun 1.4: latency distribution, point lookup by primary key**

| Percentile |           quarry |               pg |    pg (named) |  postgres.js |       Bun.sql |
| ---------- | ---------------: | ---------------: | ------------: | -----------: | ------------: |
| p50        |  **29.1 µs ±6%** |      42.9 µs ±9% |   31.2 µs ±8% |  29.8 µs ±5% |  32.3 µs ±13% |
| p90        | **33.3 µs ±15%** |     53.9 µs ±10% |  36.8 µs ±10% |  35.3 µs ±9% |  36.5 µs ±33% |
| p99        | **41.8 µs ±95%** |     71.5 µs ±14% |  49.9 µs ±29% | 46.5 µs ±12% |  47.8 µs ±26% |
| p99.9      | **172 µs ±103%** |      450 µs ±30% |   443 µs ±13% |  372 µs ±67% |   226 µs ±27% |
| max        |    1.62 ms ±465% | **1.14 ms ±31%** | 1.30 ms ±107% | 1.77 ms ±61% | 1.37 ms ±288% |

**Bun 1.4: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |            pg |        pg (named) |   postgres.js |          Bun.sql |
| --------------------------------------------------------------------------- | ---------------: | ------------: | ----------------: | ------------: | ---------------: |
| fetch 100k rows                                                             | **27.57 ms ±6%** |  96.17 ms ±5% |       107 ms ±11% | 92.23 ms ±12% |     35.35 ms ±7% |
| fetch 1M rows (one result)                                                  |   **342 ms ±4%** |   1040 ms ±3% |       1035 ms ±7% |   1137 ms ±5% |      395 ms ±13% |
| wide rows: 1k rows × 100 columns                                            |  **3.69 ms ±6%** |  11.54 ms ±8% |     11.77 ms ±11% |  10.90 ms ±3% |      9.60 ms ±9% |
| large values: 10 × 1 MB text                                                |      5.41 ms ±7% |  5.85 ms ±11% |       5.65 ms ±5% |   5.37 ms ±7% | **4.52 ms ±44%** |
| large values: 10 × 1 MB bytea                                               |  **4.57 ms ±5%** | 14.47 ms ±10% |      12.73 ms ±5% | 12.06 ms ±23% |    12.35 ms ±10% |
| large values: 20 × 200 KB jsonb                                             |     18.76 ms ±5% |  19.02 ms ±7% | **17.89 ms ±18%** | 18.60 ms ±11% |     18.09 ms ±8% |
| arrays: 1k rows of int4[100] + text[20]                                     |      7.03 ms ±9% |  18.66 ms ±6% |     19.28 ms ±14% |  8.36 ms ±10% |  **5.19 ms ±8%** |
| bulk insert 10k rows (unnest arrays)                                        |     13.97 ms ±8% |  14.48 ms ±9% |     13.75 ms ±14% |  14.62 ms ±8% | **13.48 ms ±5%** |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     13.90 ms ±5% |  13.89 ms ±4% |  **13.51 ms ±8%** |  13.92 ms ±9% |              n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **679 ms ±7%** |  1090 ms ±11% |      1116 ms ±11% |   887 ms ±19% |              n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |  **424 ms ±<1%** |    704 ms ±6% |        707 ms ±5% |    677 ms ±2% |              n/a |

**Bun 1.4: rows per second (median)**

| Scenario                                      |        quarry |        pg |  pg (named) | postgres.js |     Bun.sql |
| --------------------------------------------- | ------------: | --------: | ----------: | ----------: | ----------: |
| fetch 1k rows (6 columns)                     | **3,126,179** |   831,528 |     984,936 |   1,064,889 |   2,338,925 |
| fetch 100k rows                               | **3,526,047** | 1,042,847 |     929,220 |   1,084,882 |   2,698,858 |
| fetch 1M rows (one result)                    | **2,909,495** |   948,206 |     954,213 |     877,865 |   2,439,150 |
| wide rows: 1k rows × 100 columns              |   **269,197** |    85,409 |      84,546 |      88,030 |     103,170 |
| arrays: 1k rows of int4[100] + text[20]       |       141,547 |    49,898 |      51,279 |     120,942 | **183,548** |
| stream 1M rows with a cursor (1000 per batch) | **1,468,658** |   912,806 |     909,289 |   1,127,015 |         n/a |
| bulk insert 10k rows (unnest arrays)          |       696,925 |   683,443 |     710,655 |     662,955 | **718,384** |
| bulk insert 10k rows (COPY FROM STDIN, text)  |       712,711 |   708,421 | **724,891** |     696,269 |         n/a |

**Bun 1.4: peak RSS (MB) during the scenario**

| Scenario                                                                    | quarry |    pg | pg (named) | postgres.js | Bun.sql |
| --------------------------------------------------------------------------- | -----: | ----: | ---------: | ----------: | ------: |
| point lookup by primary key                                                 |     60 |    63 |         64 |          56 |  **48** |
| fetch 100k rows                                                             |    242 |   337 |        334 |     **179** |     201 |
| fetch 1M rows (one result)                                                  |  1,038 | 1,262 |      1,026 |   **1,002** |   1,075 |
| stream 1M rows with a cursor (1000 per batch)                               |     72 |    68 |         68 |      **67** |     n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |     61 |    64 |         63 |      **60** |     n/a |
| large values: 10 × 1 MB text                                                |    165 |   243 |        230 |         173 | **152** |
| large values: 10 × 1 MB bytea                                               |    174 |   244 |        251 |         184 | **117** |
| large values: 20 × 200 KB jsonb                                             |    129 |   183 |        184 |         169 |  **84** |

**Bun 1.4: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |    quarry |    pg | pg (named) | postgres.js | Bun.sql |
| ----------------------- | --------: | ----: | ---------: | ----------: | ------: |
| RSS growth during pause | **-20.8** | -13.1 |      -11.6 |       -16.9 |     n/a |

**Bun 1.4: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry | quarry (lossless) |       pg | pg (named) | postgres.js |     Bun.sql |
| -------------------- | -----------: | ----------------: | -------: | ---------: | ----------: | ----------: |
| int4                 |       87 ±3% |        **84 ±9%** |  187 ±9% |   188 ±10% |    181 ±13% |     110 ±3% |
| int8                 | **108 ±23%** |           145 ±8% | 205 ±11% |   212 ±13% |    176 ±12% |     132 ±8% |
| float8               |       92 ±4% |       **90 ±10%** |  223 ±5% |    222 ±4% |    195 ±11% |     124 ±7% |
| numeric              |      151 ±8% |          160 ±12% | 182 ±31% |   184 ±14% |     184 ±8% | **145 ±3%** |
| text                 |  **114 ±6%** |           121 ±9% | 198 ±14% |    205 ±8% |    175 ±14% |    135 ±10% |
| bool                 |       95 ±8% |       **93 ±10%** | 173 ±26% |   161 ±18% |    150 ±15% |      98 ±5% |
| timestamptz          |   **97 ±6%** |           168 ±4% |  480 ±5% |    476 ±5% |     406 ±6% |     180 ±6% |
| date                 |  **123 ±4%** |           123 ±5% | 359 ±14% |   376 ±10% |    290 ±11% |    216 ±12% |
| uuid                 |     140 ±11% |          147 ±23% |  216 ±7% |   206 ±13% |    185 ±11% | **132 ±7%** |
| jsonb (small object) |      348 ±9% |          354 ±21% |  462 ±9% |   431 ±13% |     445 ±8% | **328 ±9%** |
| int4[5]              |      379 ±6% |       **347 ±6%** | 854 ±17% |   925 ±11% |     462 ±8% |    389 ±17% |
| bytea (16 B)         |      160 ±7% |           164 ±6% |  518 ±7% |   527 ±13% |    526 ±24% | **140 ±4%** |

**Bun 1.4: writes, operations/s (bulk rows: batches of 10k rows per second)**

| Scenario                                     |           quarry |          pg |   pg (named) |     postgres.js |       Bun.sql |
| -------------------------------------------- | ---------------: | ----------: | -----------: | --------------: | ------------: |
| insert one row                               |   **34,893 ±7%** |  25,489 ±7% |  33,388 ±10% |     30,987 ±19% |   32,443 ±18% |
| insert one row, concurrency 50               | **216,755 ±17%** | 86,076 ±26% |   97,343 ±6% |      59,373 ±6% |   129,937 ±8% |
| multi-row insert: 100 rows, 300 parameters   |       4,322 ±20% |  2,740 ±18% |    4,384 ±4% |      3,788 ±11% | **4,419 ±7%** |
| bulk insert 10k rows (unnest arrays)         |        69.7 ±10% |   68.3 ±11% |    71.1 ±11% |       66.3 ±11% |  **71.8 ±7%** |
| bulk insert 10k rows (COPY FROM STDIN, text) |         71.3 ±5% |    70.8 ±9% | **72.5 ±7%** |        69.6 ±7% |           n/a |
| update one row by primary key                |       28,121 ±8% | 20,031 ±14% |  28,316 ±11% | **29,771 ±10%** |   26,402 ±13% |
| upsert (insert … on conflict do update)      |   **31,192 ±8%** |  22,593 ±4% |   29,656 ±7% |      26,924 ±3% |    26,251 ±5% |
| delete one row by primary key                |  **36,227 ±15%** | 26,175 ±21% |   34,424 ±5% |     33,826 ±14% |    31,854 ±9% |

**Bun 1.4: transactions, operations/s**

| Scenario                                         |      quarry |          pg |      pg (named) |   postgres.js |     Bun.sql |
| ------------------------------------------------ | ----------: | ----------: | --------------: | ------------: | ----------: |
| transaction: begin; select 1; commit             | 15,273 ±11% | 15,285 ±16% |  **15,322 ±7%** |   12,244 ±10% | 10,334 ±13% |
| transaction: begin; insert; commit               |  13,625 ±6% |  12,699 ±4% | **14,108 ±36%** |   13,098 ±16% |   9,559 ±8% |
| transaction with 5 savepoints (select 1 in each) |   2,741 ±5% |   2,722 ±8% |       2,878 ±5% | **3,119 ±6%** |  1,917 ±25% |

**Bun 1.4: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |       pg | pg (named) | postgres.js |  Bun.sql |
| ------------------------------------------------------ | ---------: | -------: | ---------: | ----------: | -------: |
| select 1                                               |       13.4 | **13.0** |       13.9 |        14.9 |     14.6 |
| point lookup by primary key                            |   **16.5** |     21.7 |       19.6 |        17.7 |     18.6 |
| fetch 1k rows (6 columns)                              |    **306** |    1,130 |        986 |         887 |      373 |
| fetch 100k rows                                        | **37,416** |  111,638 |    126,077 |     104,454 |   42,535 |
| insert one row                                         |   **15.5** |     17.3 |       16.4 |        18.1 |     17.6 |
| insert one row, concurrency 50                         |    **4.9** |     12.0 |       10.9 |        17.3 |      8.4 |
| transaction: begin; insert; commit                     |   **43.1** |     44.1 |       44.5 |        46.4 |     48.9 |
| query that fails (division by zero), connection reused |       24.8 |      483 |        503 |        31.5 | **23.2** |

**Bun 1.4: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | Bun.sql |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | ------: |
| select 1                             |     10.1 | 12.0 |   **10.1** |        12.3 |    12.5 |
| point lookup by primary key          |     15.8 | 30.6 |       16.0 |    **15.4** |    18.9 |
| fetch 1k rows (6 columns)            |  **249** |  415 |        383 |         385 |     372 |
| 100 parameters (id in (…)), 100 rows |  **187** |  251 |        189 |         215 |     192 |
| insert one row                       |     15.3 | 25.7 |   **15.3** |        15.9 |    17.3 |
| insert one row, concurrency 50       | **13.5** | 36.6 |       19.8 |        16.7 |    14.9 |
| transaction: begin; insert; commit   |     34.0 | 42.5 |       34.0 |    **31.9** |    49.5 |

**Bun 1.4: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |    quarry |      pg | pg (named) | postgres.js |  Bun.sql |
| -------------------------------------------------- | --------: | ------: | ---------: | ----------: | -------: |
| point lookup by primary key: p99                   |       0.5 | **0.1** |        0.2 |         0.4 |      0.2 |
| point lookup by primary key: max                   |       0.5 | **0.1** |        0.2 |         0.4 |      0.2 |
| insert one row, concurrency 50: p99                |       0.8 | **0.7** |        0.9 |         1.3 |      1.3 |
| insert one row, concurrency 50: max                |       0.8 | **0.7** |        0.9 |         1.3 |      1.3 |
| fetch 1k rows (6 columns): p99                     |       0.4 |     0.9 |        1.0 |         0.7 |  **0.3** |
| fetch 1k rows (6 columns): max                     |       0.4 |     0.9 |        1.0 |         0.7 |  **0.3** |
| fetch 100k rows: p99                               |      25.3 |    94.2 |      107.2 |        92.5 | **19.2** |
| fetch 100k rows: max                               |      28.8 |    94.2 |      107.2 |        92.5 | **22.1** |
| fetch 1M rows (one result): p99                    | **395.9** | 1,060.5 |    1,030.3 |     1,162.0 |    522.4 |
| fetch 1M rows (one result): max                    | **395.9** | 1,060.5 |    1,030.3 |     1,162.0 |    522.4 |
| stream 1M rows with a cursor (1000 per batch): p99 |   **0.7** |     1.0 |        1.2 |         0.9 |      n/a |
| stream 1M rows with a cursor (1000 per batch): max |   **0.9** |     2.2 |        2.1 |         1.3 |      n/a |

**Bun 1.4: connections (median time per operation)**

| Scenario                                                    |       quarry |           pg |    pg (named) |  postgres.js |          Bun.sql |
| ----------------------------------------------------------- | -----------: | -----------: | ------------: | -----------: | ---------------: |
| connect + select 1 + close (no TLS, trust)                  |  4.00 ms ±2% |  4.00 ms ±1% |   3.96 ms ±2% | 6.82 ms ±10% |  **2.33 ms ±2%** |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | 5.30 ms ±10% |  5.16 ms ±6% |   5.46 ms ±4% |  7.72 ms ±4% |  **3.09 ms ±5%** |
| connect + select 1 + close (TLS verify-full, trust)         |  5.00 ms ±5% | 4.55 ms ±14% |   4.45 ms ±5% |  7.53 ms ±2% |  **3.83 ms ±8%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |  6.45 ms ±8% |  6.00 ms ±7% |   5.92 ms ±7% | 8.42 ms ±10% | **4.83 ms ±13%** |
| pool warm-up: new pool (max 10), 10 concurrent select 1     | 9.49 ms ±15% |  9.18 ms ±6% | 10.04 ms ±13% | 15.95 ms ±8% |  **8.37 ms ±6%** |

**Bun 1.4: cancellation, notifications, errors**

| Scenario                                      |      quarry |          pg | pg (named) | postgres.js |       Bun.sql |
| --------------------------------------------- | ----------: | ----------: | ---------: | ----------: | ------------: |
| cancel: time from cancel() to rejection (p50) |     1.62 ms | **1.59 ms** |    1.78 ms |     1.63 ms |       2974 ms |
| cancel: share of queries actually cancelled   |    **100%** |    **100%** |   **100%** |    **100%** |            0% |
| NOTIFY latency p50                            | **31.6 µs** |     39.4 µs |    32.3 µs |     33.5 µs |       35.7 µs |
| NOTIFY latency p99                            |     55.3 µs |     74.9 µs |    60.1 µs |     55.8 µs |   **53.5 µs** |
| NOTIFY throughput (notifications/s)           |   1,818,653 |   1,683,316 |  1,871,879 |   1,503,313 | **2,396,569** |
| error path: failing queries/s                 |  **29,402** |         414 |        392 |      23,947 |        28,303 |

**Bun 1.4: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |                Bun.sql |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: | ---------------------: |
| select 1                                | 43,312 / 34,839 / +24% |  41,902 / 40,911 / +2% |   37,755 / 39,661 / -5% |  36,687 / 37,932 / -3% |
| point lookup by primary key             | 32,644 / 20,522 / +59% | 30,061 / 21,191 / +42% | 31,617 / 13,192 / +140% | 29,655 / 19,941 / +49% |
| range scan, 100 rows                    |  10,523 / 7,054 / +49% |    5,906 / 6,189 / -5% |    6,715 / 5,098 / +32% |    9,157 / 8,487 / +8% |
| fetch 1k rows (6 columns)               |  3,126 / 1,453 / +115% |       985 / 832 / +18% |       1,065 / 994 / +7% |    2,339 / 2,248 / +4% |
| 100 parameters (id in (…)), 100 rows    |   4,326 / 2,819 / +53% |   4,123 / 2,977 / +39% |    3,241 / 2,586 / +25% |   4,270 / 3,291 / +30% |
| 1000 parameters (id in (…)), 1000 rows  |       483 / 355 / +36% |       461 / 364 / +27% |        446 / 354 / +26% |       495 / 433 / +14% |
| insert one row                          | 34,893 / 23,137 / +51% | 33,388 / 25,489 / +31% | 30,987 / 15,346 / +102% | 32,443 / 22,631 / +43% |
| upsert (insert … on conflict do update) | 31,192 / 20,936 / +49% | 29,656 / 22,593 / +31% |  26,924 / 13,819 / +95% | 26,251 / 21,225 / +24% |

**Bun 1.4: quarry decoding modes (time per op)**

| Scenario                                |            quarry | quarry (lossless) |
| --------------------------------------- | ----------------: | ----------------: |
| point lookup by primary key             |   **29.1 µs ±6%** |      30.8 µs ±39% |
| fetch 1k rows (6 columns)               |    **288 µs ±4%** |       365 µs ±16% |
| fetch 100k rows                         |  **27.57 ms ±6%** |     35.64 ms ±14% |
| fetch 1M rows (one result)              |    **342 ms ±4%** |        368 ms ±5% |
| wide rows: 1k rows × 100 columns        |   **3.69 ms ±6%** |       4.14 ms ±6% |
| arrays: 1k rows of int4[100] + text[20] |       7.03 ms ±9% |   **6.21 ms ±8%** |
| decode 100k × int8                      | **10.84 ms ±23%** |      14.53 ms ±8% |
| decode 100k × timestamptz               |   **9.75 ms ±6%** |      16.78 ms ±4% |
| decode 100k × date                      |  **12.32 ms ±4%** |      12.33 ms ±5% |

## Deno 2.9

**Deno 2.9: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |     postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | --------------: | -----------------------: |
| select 1                                                      | **27.1 µs ±12%** |  30.1 µs ±8% | 30.8 µs ±18% |     33.8 µs ±8% |             39.1 µs ±11% |
| point lookup by primary key                                   |  **34.8 µs ±9%** | 59.7 µs ±12% |  43.4 µs ±9% |     38.8 µs ±7% |              82.1 µs ±8% |
| range scan, 100 rows                                          |   **106 µs ±7%** |  221 µs ±14% |  207 µs ±15% |      175 µs ±6% |              1.04 ms ±9% |
| fetch 1k rows (6 columns)                                     |  **393 µs ±10%** | 1.49 ms ±11% |  1.43 ms ±5% |    1.14 ms ±17% |             8.96 ms ±11% |
| 100 parameters (id in (…)), 100 rows                          |  **265 µs ±11%** |  352 µs ±33% |   288 µs ±5% |     321 µs ±11% |              873 µs ±26% |
| 1000 parameters (id in (…)), 1000 rows                        | **2.40 ms ±28%** | 3.01 ms ±13% |  2.43 ms ±7% |     2.57 ms ±9% |             7.00 ms ±10% |
| insert one row                                                | **34.2 µs ±11%** |  48.6 µs ±7% | 35.8 µs ±19% |     40.1 µs ±7% |              60.7 µs ±8% |
| multi-row insert: 100 rows, 300 parameters                    |  **241 µs ±15%** |   401 µs ±8% |   303 µs ±5% |      446 µs ±7% |              458 µs ±28% |
| update one row by primary key                                 |  **38.9 µs ±2%** |  55.5 µs ±5% |  40.8 µs ±6% |    42.1 µs ±21% |             66.9 µs ±12% |
| upsert (insert … on conflict do update)                       |  **37.0 µs ±6%** |  51.5 µs ±8% | 41.2 µs ±17% |    43.0 µs ±14% |              64.9 µs ±4% |
| delete one row by primary key                                 |  **31.8 µs ±4%** |  44.7 µs ±3% |  33.8 µs ±8% |     37.5 µs ±7% |              58.6 µs ±8% |
| transaction: begin; select 1; commit                          |  **75.8 µs ±8%** |  79.0 µs ±4% |  81.3 µs ±5% |     90.1 µs ±4% |               103 µs ±6% |
| transaction: begin; insert; commit                            |  **85.4 µs ±9%** | 96.8 µs ±10% | 89.1 µs ±15% |      105 µs ±7% |              115 µs ±13% |
| transaction with 5 savepoints (select 1 in each)              |      428 µs ±54% |   433 µs ±8% |   432 µs ±4% | **376 µs ±12%** |              549 µs ±11% |
| query that fails (division by zero), connection reused        | **42.5 µs ±12%** |  2.40 ms ±3% |  2.45 ms ±9% |     103 µs ±10% |             47.5 µs ±14% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **39.7 µs ±4%** |  48.0 µs ±9% |  46.0 µs ±8% |     43.4 µs ±7% |                      n/a |

**Deno 2.9: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) |   postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ------------: | -----------------------: |
| select 1                                                      | **34,534 ±16%** |  30,934 ±8% | 29,993 ±20% |   26,335 ±12% |              23,223 ±13% |
| point lookup by primary key                                   |  **26,568 ±8%** | 15,720 ±15% | 21,004 ±10% |    23,437 ±5% |               11,341 ±6% |
| range scan, 100 rows                                          |  **8,401 ±11%** |  4,337 ±14% |   4,538 ±8% |     4,932 ±7% |                  895 ±8% |
| fetch 1k rows (6 columns)                                     |  **2,392 ±18%** |    644 ±12% |     699 ±9% |      738 ±20% |                 104 ±11% |
| 100 parameters (id in (…)), 100 rows                          |   **3,571 ±9%** |  2,638 ±22% |   3,252 ±5% |    2,891 ±12% |               1,020 ±16% |
| 1000 parameters (id in (…)), 1000 rows                        |    **404 ±23%** |    320 ±22% |     396 ±7% |       366 ±9% |                  141 ±9% |
| insert one row                                                | **26,730 ±12%** |  19,212 ±9% | 25,102 ±12% |    22,485 ±7% |               14,982 ±9% |
| multi-row insert: 100 rows, 300 parameters                    |  **3,937 ±13%** |   2,222 ±9% |   3,130 ±5% |     2,066 ±8% |               1,746 ±30% |
| update one row by primary key                                 |  **23,857 ±5%** |  16,859 ±7% |  22,700 ±6% |   21,253 ±15% |              13,923 ±11% |
| upsert (insert … on conflict do update)                       |  **24,915 ±5%** |  17,699 ±7% | 22,608 ±16% |   20,905 ±10% |               13,759 ±4% |
| delete one row by primary key                                 |  **29,027 ±4%** |  20,657 ±4% |  27,239 ±7% |    23,974 ±8% |               15,680 ±9% |
| transaction: begin; select 1; commit                          |  **12,460 ±6%** |  11,868 ±4% |  11,426 ±6% |    10,005 ±6% |                8,806 ±4% |
| transaction: begin; insert; commit                            | **10,995 ±12%** |  9,597 ±10% | 10,328 ±15% |     8,616 ±7% |               7,901 ±11% |
| transaction with 5 savepoints (select 1 in each)              |      2,255 ±32% |  2,225 ±11% |   2,244 ±6% | **2,355 ±9%** |               1,692 ±11% |
| query that fails (division by zero), connection reused        | **21,517 ±12%** |     403 ±2% |     402 ±9% |    8,828 ±10% |              19,053 ±15% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **23,207 ±7%** |  19,077 ±8% | 19,282 ±11% |    20,236 ±7% |                      n/a |

**Deno 2.9: tail latency p99, sequential**

| Scenario                                                      |      quarry |         pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ---------: | ---------: | ----------: | -----------------------: |
| select 1                                                      | **51.7 µs** |    58.6 µs |    65.3 µs |     62.1 µs |                   117 µs |
| point lookup by primary key                                   | **64.5 µs** |     111 µs |    87.2 µs |     70.8 µs |                   188 µs |
| range scan, 100 rows                                          |  **208 µs** |     351 µs |     370 µs |      384 µs |                  2.15 ms |
| fetch 1k rows (6 columns)                                     |  **768 µs** |    2.93 ms |    2.06 ms |     7.24 ms |                 16.70 ms |
| 100 parameters (id in (…)), 100 rows                          |  **496 µs** |     677 µs |     533 µs |      625 µs |                  1.97 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **3.61 ms** |    4.55 ms |    3.80 ms |     7.18 ms |                 10.10 ms |
| insert one row                                                | **79.1 µs** |    94.3 µs |    81.8 µs |     82.8 µs |                   166 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **411 µs** |     898 µs |     555 µs |     1.03 ms |                  2.21 ms |
| update one row by primary key                                 | **76.4 µs** |     102 µs |    80.1 µs |     76.4 µs |                   170 µs |
| upsert (insert … on conflict do update)                       | **66.2 µs** |     102 µs |    83.5 µs |     77.6 µs |                   185 µs |
| delete one row by primary key                                 | **58.8 µs** |    84.6 µs |    66.9 µs |     70.6 µs |                   156 µs |
| transaction: begin; select 1; commit                          |      145 µs | **127 µs** |     136 µs |      149 µs |                   251 µs |
| transaction: begin; insert; commit                            |      175 µs |     174 µs | **164 µs** |      185 µs |                   260 µs |
| transaction with 5 savepoints (select 1 in each)              |  **667 µs** |     860 µs |     715 µs |      870 µs |                  1.01 ms |
| query that fails (division by zero), connection reused        | **81.4 µs** |    3.27 ms |    3.16 ms |      181 µs |                   128 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler | **91.0 µs** |     125 µs |     119 µs |     97.0 µs |                      n/a |

**Deno 2.9: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ----------: | -----------------------: |
| select 1                                                      |  **146 µs** |  150 µs |      254 µs |      408 µs |                   285 µs |
| point lookup by primary key                                   |      244 µs |  357 µs |  **233 µs** |      426 µs |                   433 µs |
| range scan, 100 rows                                          |  **510 µs** |  723 µs |      921 µs |     5.14 ms |                  6.46 ms |
| fetch 1k rows (6 columns)                                     | **1.42 ms** | 4.31 ms |     4.80 ms |    10.78 ms |                 19.11 ms |
| 100 parameters (id in (…)), 100 rows                          |      846 µs | 1.06 ms |  **806 µs** |     4.09 ms |                  3.75 ms |
| 1000 parameters (id in (…)), 1000 rows                        |     5.76 ms | 5.50 ms | **4.61 ms** |     9.87 ms |                 12.59 ms |
| insert one row                                                |      275 µs |  341 µs |  **247 µs** |      495 µs |                   359 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **730 µs** | 1.12 ms |      926 µs |     2.47 ms |                  2.74 ms |
| update one row by primary key                                 |  **284 µs** |  343 µs |      375 µs |      545 µs |                   447 µs |
| upsert (insert … on conflict do update)                       |      342 µs |  417 µs |  **338 µs** |      424 µs |                   427 µs |
| delete one row by primary key                                 |  **228 µs** |  254 µs |      272 µs |      398 µs |                   373 µs |
| transaction: begin; select 1; commit                          |  **462 µs** |  750 µs |      804 µs |     3.17 ms |                   496 µs |
| transaction: begin; insert; commit                            |  **531 µs** |  997 µs |     1.51 ms |     2.78 ms |                   621 µs |
| transaction with 5 savepoints (select 1 in each)              |     1.62 ms | 3.59 ms | **1.21 ms** |     5.90 ms |                  4.12 ms |
| query that fails (division by zero), connection reused        |  **212 µs** | 3.92 ms |     3.68 ms |      842 µs |                   367 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **358 µs** |  551 µs |      371 µs |      758 µs |                      n/a |

**Deno 2.9: latency distribution, select 1**

| Percentile |           quarry |               pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | ---------------: | ---------------: | -----------: | -----------: | -----------------------: |
| p50        | **27.1 µs ±12%** |      30.1 µs ±8% | 30.8 µs ±18% |  33.8 µs ±8% |             39.1 µs ±11% |
| p90        | **32.2 µs ±29%** |      35.5 µs ±9% | 36.5 µs ±31% | 41.0 µs ±11% |             48.9 µs ±20% |
| p99        | **51.7 µs ±19%** |     58.6 µs ±10% | 65.3 µs ±37% | 62.1 µs ±17% |              117 µs ±40% |
| p99.9      |  **146 µs ±66%** |       150 µs ±8% |  254 µs ±57% |  408 µs ±68% |              285 µs ±21% |
| max        |     3.82 ms ±79% | **2.94 ms ±45%** | 3.58 ms ±26% | 7.71 ms ±37% |              2.97 ms ±6% |

**Deno 2.9: latency distribution, point lookup by primary key**

| Percentile |           quarry |               pg |      pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | ---------------: | ---------------: | --------------: | -----------: | -----------------------: |
| p50        |  **34.8 µs ±9%** |     59.7 µs ±12% |     43.4 µs ±9% |  38.8 µs ±7% |              82.1 µs ±8% |
| p90        | **40.8 µs ±16%** |     71.1 µs ±13% |    56.0 µs ±17% |  45.9 µs ±5% |              106 µs ±11% |
| p99        | **64.5 µs ±25%** |      111 µs ±22% |    87.2 µs ±23% | 70.8 µs ±10% |              188 µs ±21% |
| p99.9      |      244 µs ±10% |      357 µs ±26% | **233 µs ±87%** |  426 µs ±27% |              433 µs ±39% |
| max        |     3.06 ms ±62% | **2.28 ms ±47%** |    3.65 ms ±79% | 5.21 ms ±27% |              3.23 ms ±9% |

**Deno 2.9: large results and bulk work, time per operation (median)**

| Scenario                                                                    |            quarry |            pg |       pg (named) |   postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ----------------: | ------------: | ---------------: | ------------: | -----------------------: |
| fetch 100k rows                                                             | **47.64 ms ±10%** |    151 ms ±4% |       146 ms ±8% |    104 ms ±9% |              963 ms ±16% |
| fetch 1M rows (one result)                                                  |   **577 ms ±22%** |  1649 ms ±17% |     1435 ms ±31% |  1175 ms ±20% |               10.1 s ±9% |
| wide rows: 1k rows × 100 columns                                            |  **4.47 ms ±11%** | 17.41 ms ±26% |     18.33 ms ±9% |  18.03 ms ±6% |            94.29 ms ±10% |
| large values: 10 × 1 MB text                                                |      11.10 ms ±9% | 10.27 ms ±23% |    10.48 ms ±19% | 12.24 ms ±13% |          **7.57 ms ±8%** |
| large values: 10 × 1 MB bytea                                               |  **3.82 ms ±17%** | 22.93 ms ±14% |     23.39 ms ±7% | 20.11 ms ±11% |              434 ms ±11% |
| large values: 20 × 200 KB jsonb                                             |      23.99 ms ±6% | 24.17 ms ±10% |     24.80 ms ±8% |  24.75 ms ±8% |         **22.08 ms ±6%** |
| arrays: 1k rows of int4[100] + text[20]                                     |  **8.87 ms ±14%** | 26.59 ms ±20% |    28.63 ms ±20% | 10.84 ms ±14% |            34.91 ms ±11% |
| bulk insert 10k rows (unnest arrays)                                        |  **13.93 ms ±4%** |  14.08 ms ±5% |     14.35 ms ±4% | 14.09 ms ±18% |            14.32 ms ±14% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     13.91 ms ±12% |  14.04 ms ±8% | **13.78 ms ±9%** |  56.80 ms ±4% |                      n/a |
| stream 1M rows with a cursor (1000 per batch)                               |  **1018 ms ±16%** |   1454 ms ±3% |      1410 ms ±5% |  1212 ms ±13% |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |    **651 ms ±2%** |    935 ms ±2% |       926 ms ±1% |    870 ms ±3% |                      n/a |

**Deno 2.9: rows per second (median)**

| Scenario                                      |        quarry |      pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------- | ------------: | ------: | ----------: | ----------: | -----------------------: |
| fetch 1k rows (6 columns)                     | **2,391,595** | 644,410 |     698,640 |     738,445 |                  103,700 |
| fetch 100k rows                               | **2,003,033** | 634,192 |     664,786 |     941,996 |                  104,467 |
| fetch 1M rows (one result)                    | **1,735,406** | 610,238 |     650,374 |     851,931 |                  102,037 |
| wide rows: 1k rows × 100 columns              |   **216,116** |  56,655 |      52,650 |      51,921 |                   10,454 |
| arrays: 1k rows of int4[100] + text[20]       |   **110,369** |  35,345 |      33,187 |      83,390 |                   27,994 |
| stream 1M rows with a cursor (1000 per batch) |   **964,829** | 683,209 |     698,584 |     824,544 |                      n/a |
| bulk insert 10k rows (unnest arrays)          |   **707,561** | 698,621 |     685,665 |     705,801 |                  695,026 |
| bulk insert 10k rows (COPY FROM STDIN, text)  |       709,394 | 709,838 | **722,329** |     174,415 |                      n/a |

**Deno 2.9: peak RSS (MB) during the scenario**

| Scenario                                                                    |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| point lookup by primary key                                                 |      80 |  **75** |         76 |         136 |                       80 |
| fetch 100k rows                                                             |     457 |     441 |        499 |         440 |                  **356** |
| fetch 1M rows (one result)                                                  |   1,371 |   1,370 |      1,371 |   **1,055** |                    1,454 |
| stream 1M rows with a cursor (1000 per batch)                               |     166 | **149** |        150 |         163 |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) | **104** |     105 |        105 |         151 |                      n/a |
| large values: 10 × 1 MB text                                                | **250** |     280 |        278 |         250 |                      263 |
| large values: 10 × 1 MB bytea                                               | **200** |     259 |        264 |         228 |                      225 |
| large values: 20 × 200 KB jsonb                                             |     212 |     204 |    **204** |         295 |                      218 |

**Deno 2.9: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  | quarry |  pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ----------------------- | -----: | --: | ---------: | ----------: | -----------------------: |
| RSS growth during pause |    0.2 | 0.2 |    **0.1** |         0.2 |                      n/a |

**Deno 2.9: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry |           pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------- | -----------: | -----------: | ---------: | ----------: | -----------------------: |
| int4                 | **119 ±16%** |     312 ±12% |    285 ±6% |     258 ±8% |               4,255 ±10% |
| int8                 |  **165 ±7%** |     303 ±12% |   308 ±23% |    253 ±20% |               4,366 ±10% |
| float8               |  **83 ±31%** |     297 ±10% |   297 ±14% |     324 ±8% |               4,179 ±15% |
| numeric              |  **158 ±7%** |     261 ±12% |   235 ±22% |    246 ±10% |               4,471 ±14% |
| text                 | **167 ±20%** |      267 ±9% |    255 ±9% |    253 ±10% |                4,027 ±9% |
| bool                 | **115 ±14%** |     203 ±15% |    239 ±8% |    218 ±10% |               4,085 ±16% |
| timestamptz          | **171 ±27%** |      778 ±6% |    780 ±9% |     503 ±4% |               5,382 ±13% |
| date                 | **159 ±13%** |      547 ±4% |   591 ±18% |    442 ±11% |               4,508 ±12% |
| uuid                 |  **188 ±9%** |     275 ±20% |    276 ±2% |    288 ±10% |               4,436 ±12% |
| jsonb (small object) | **445 ±10%** |     541 ±13% |   578 ±57% |    532 ±17% |               4,991 ±15% |
| int4[5]              | **705 ±14%** |   1,604 ±11% | 1,493 ±22% |    789 ±21% |               5,373 ±30% |
| bytea (16 B)         |     502 ±11% | **460 ±12%** |   484 ±11% |    460 ±12% |                6,245 ±9% |

**Deno 2.9: writes, operations/s (bulk rows: batches of 10k rows per second)**

| Scenario                                     |           quarry |         pg |   pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------- | ---------------: | ---------: | -----------: | ----------: | -----------------------: |
| insert one row                               |  **26,730 ±12%** | 19,212 ±9% |  25,102 ±12% |  22,485 ±7% |               14,982 ±9% |
| insert one row, concurrency 50               | **150,068 ±26%** | 65,548 ±7% |  52,858 ±14% |  50,084 ±8% |              19,788 ±13% |
| multi-row insert: 100 rows, 300 parameters   |   **3,937 ±13%** |  2,222 ±9% |    3,130 ±5% |   2,066 ±8% |               1,746 ±30% |
| bulk insert 10k rows (unnest arrays)         |     **70.8 ±5%** |   69.9 ±3% |     68.6 ±5% |   70.6 ±15% |                69.5 ±10% |
| bulk insert 10k rows (COPY FROM STDIN, text) |         70.9 ±9% |   71.0 ±8% | **72.2 ±8%** |    17.4 ±2% |                      n/a |
| update one row by primary key                |   **23,857 ±5%** | 16,859 ±7% |   22,700 ±6% | 21,253 ±15% |              13,923 ±11% |
| upsert (insert … on conflict do update)      |   **24,915 ±5%** | 17,699 ±7% |  22,608 ±16% | 20,905 ±10% |               13,759 ±4% |
| delete one row by primary key                |   **29,027 ±4%** | 20,657 ±4% |   27,239 ±7% |  23,974 ±8% |               15,680 ±9% |

**Deno 2.9: transactions, operations/s**

| Scenario                                         |          quarry |         pg |  pg (named) |   postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------ | --------------: | ---------: | ----------: | ------------: | -----------------------: |
| transaction: begin; select 1; commit             |  **12,460 ±6%** | 11,868 ±4% |  11,426 ±6% |    10,005 ±6% |                8,806 ±4% |
| transaction: begin; insert; commit               | **10,995 ±12%** | 9,597 ±10% | 10,328 ±15% |     8,616 ±7% |               7,901 ±11% |
| transaction with 5 savepoints (select 1 in each) |      2,255 ±32% | 2,225 ±11% |   2,244 ±6% | **2,355 ±9%** |               1,692 ±11% |

**Deno 2.9: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | ----------: | -----------------------: |
| select 1                                               |   **22.3** |    23.1 |       26.8 |        32.6 |                     37.8 |
| point lookup by primary key                            |   **25.6** |    38.1 |       36.1 |        34.1 |                     77.8 |
| fetch 1k rows (6 columns)                              |    **400** |   1,414 |      1,346 |       1,501 |                   11,033 |
| fetch 100k rows                                        | **69,954** | 204,416 |    192,298 |     138,015 |                1,139,091 |
| insert one row                                         |   **26.0** |    28.7 |       27.8 |        35.8 |                     61.4 |
| insert one row, concurrency 50                         |    **7.3** |    16.4 |       20.5 |        24.8 |                     56.1 |
| transaction: begin; insert; commit                     |   **63.1** |    71.3 |       75.9 |         105 |                      109 |
| query that fails (division by zero), connection reused |   **39.9** |     554 |        563 |         110 |                     47.2 |

**Deno 2.9: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | -----------------------: |
| select 1                             |  **9.8** | 12.6 |       10.5 |        12.2 |                     12.1 |
| point lookup by primary key          |     16.2 | 31.9 |       16.9 |    **15.4** |                     38.9 |
| fetch 1k rows (6 columns)            |  **248** |  464 |        400 |         431 |                      588 |
| 100 parameters (id in (…)), 100 rows |      201 |  261 |    **195** |         214 |                      333 |
| insert one row                       |     16.1 | 26.8 |   **15.5** |        16.0 |                     33.1 |
| insert one row, concurrency 50       | **14.5** | 34.9 |       20.2 |        18.4 |                     59.0 |
| transaction: begin; insert; commit   |     34.2 | 42.7 |   **32.6** |        33.8 |                     52.4 |

**Deno 2.9: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| point lookup by primary key: p99                   | **0.4** |     1.0 |        0.4 |         2.9 |                      0.9 |
| point lookup by primary key: max                   | **0.4** |     1.0 |        0.4 |         2.9 |                      0.9 |
| insert one row, concurrency 50: p99                |     1.0 | **0.5** |        0.8 |         3.7 |                      1.7 |
| insert one row, concurrency 50: max                |     1.0 | **0.5** |        0.8 |         3.7 |                      1.7 |
| fetch 1k rows (6 columns): p99                     | **1.1** |     2.4 |        1.8 |         5.3 |                      3.2 |
| fetch 1k rows (6 columns): max                     | **1.1** |     2.4 |        1.8 |         5.3 |                      3.2 |
| fetch 100k rows: p99                               |    20.2 |    54.0 |       54.4 |        29.1 |                  **4.6** |
| fetch 100k rows: max                               |    24.7 |    54.0 |       54.4 |        29.2 |                  **7.2** |
| fetch 1M rows (one result): p99                    |    31.9 |    67.3 |       65.0 |        30.1 |                  **4.5** |
| fetch 1M rows (one result): max                    |    49.9 |    79.0 |       81.4 |        38.0 |                 **13.2** |
| stream 1M rows with a cursor (1000 per batch): p99 |     3.4 | **1.7** |        1.8 |         5.4 |                      n/a |
| stream 1M rows with a cursor (1000 per batch): max |     4.8 | **2.3** |        2.3 |         6.7 |                      n/a |

**Deno 2.9: connections (median time per operation)**

| Scenario                                                    |       quarry |          pg |   pg (named) |   postgres.js | deno-postgres (stock) | deno-postgres (+nodelay) |
| ----------------------------------------------------------- | -----------: | ----------: | -----------: | ------------: | --------------------: | -----------------------: |
| connect + select 1 + close (no TLS, trust)                  | 4.03 ms ±12% | 4.07 ms ±7% |  4.00 ms ±3% |   8.31 ms ±3% |      **2.48 ms ±13%** |              2.62 ms ±2% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          |  5.82 ms ±8% | 5.48 ms ±6% |  5.57 ms ±9% | 10.29 ms ±12% |                     — |          **4.03 ms ±4%** |
| connect + select 1 + close (TLS verify-full, trust)         |  5.13 ms ±4% | 4.77 ms ±4% |  4.71 ms ±5% |  55.57 ms ±1% |                     — |          **4.22 ms ±3%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |  6.73 ms ±7% | 6.46 ms ±4% |  6.44 ms ±5% |  56.80 ms ±2% |                     — |         **5.53 ms ±12%** |
| pool warm-up: new pool (max 10), 10 concurrent select 1     |  9.33 ms ±7% | 9.37 ms ±7% | 9.43 ms ±13% | 17.39 ms ±15% |                     — |         **9.07 ms ±13%** |

**Deno 2.9: cancellation, notifications, errors**

| Scenario                                      |      quarry |            pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------- | ----------: | ------------: | ---------: | ----------: | -----------------------: |
| cancel: time from cancel() to rejection (p50) | **1.65 ms** |       1.74 ms |    1.73 ms |     1.75 ms |                      n/a |
| cancel: share of queries actually cancelled   |    **100%** |      **100%** |   **100%** |    **100%** |                      n/a |
| NOTIFY latency p50                            | **39.7 µs** |       48.0 µs |    46.0 µs |     43.4 µs |                      n/a |
| NOTIFY latency p99                            | **91.0 µs** |        125 µs |     119 µs |     97.0 µs |                      n/a |
| NOTIFY throughput (notifications/s)           |   1,691,569 | **1,705,195** |  1,648,935 |   1,606,223 |                      n/a |
| error path: failing queries/s                 |  **21,517** |           403 |        402 |       8,828 |                   19,053 |

**Deno 2.9: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 34,534 / 26,645 / +30% |  29,993 / 30,934 / -3% |   26,335 / 28,337 / -7% |
| point lookup by primary key             | 26,568 / 16,643 / +60% | 21,004 / 15,720 / +34% | 23,437 / 11,376 / +106% |
| range scan, 100 rows                    |   8,401 / 5,315 / +58% |    4,538 / 4,337 / +5% |    4,932 / 4,330 / +14% |
| fetch 1k rows (6 columns)               |  2,392 / 1,007 / +137% |        699 / 644 / +8% |         738 / 691 / +7% |
| 100 parameters (id in (…)), 100 rows    |   3,571 / 2,554 / +40% |   3,252 / 2,638 / +23% |    2,891 / 2,196 / +32% |
| 1000 parameters (id in (…)), 1000 rows  |        404 / 380 / +6% |       396 / 320 / +24% |        366 / 304 / +20% |
| insert one row                          | 26,730 / 19,393 / +38% | 25,102 / 19,212 / +31% |  22,485 / 11,959 / +88% |
| upsert (insert … on conflict do update) | 24,915 / 17,322 / +44% | 22,608 / 17,699 / +28% |  20,905 / 11,759 / +78% |

**Deno 2.9: shipped defaults vs tuned (median latency)**

| Scenario                                   | deno-postgres (+nodelay) | deno-postgres (stock) |
| ------------------------------------------ | -----------------------: | --------------------: |
| select 1                                   |                  39.1 µs |           **38.1 µs** |
| point lookup by primary key                |              **82.1 µs** |              44.03 ms |
| fetch 1k rows (6 columns)                  |                  8.96 ms |           **7.96 ms** |
| insert one row                             |              **60.7 µs** |              44.00 ms |
| transaction: begin; insert; commit         |                   115 µs |                     — |
| connect + select 1 + close (no TLS, trust) |                  2.62 ms |           **2.48 ms** |

## Across runtimes

**Throughput (operations/s) by runtime**

| Scenario                           | quarry (node) | pg (node) | pg (named) (node) | pg-native (node) | postgres.js (node) | neon (WS) (node) | quarry (bun) | pg (bun) | pg (named) (bun) | postgres.js (bun) | Bun.sql (bun) | quarry (deno) | pg (deno) | pg (named) (deno) | postgres.js (deno) | deno-postgres (+nodelay) (deno) |
| ---------------------------------- | ------------: | --------: | ----------------: | ---------------: | -----------------: | ---------------: | -----------: | -------: | ---------------: | ----------------: | ------------: | ------------: | --------: | ----------------: | -----------------: | ------------------------------: |
| select 1                           |        37,167 |    34,334 |            32,995 |           27,677 |             29,661 |           17,376 |       43,312 |   40,911 |           41,902 |            37,755 |        36,687 |        34,534 |    30,934 |            29,993 |             26,335 |                          23,223 |
| point lookup by primary key        |        29,722 |    17,902 |            25,281 |           16,970 |             24,611 |            9,920 |       32,644 |   21,191 |           30,061 |            31,617 |        29,655 |        26,568 |    15,720 |            21,004 |             23,437 |                          11,341 |
| fetch 1k rows (6 columns)          |         2,209 |       656 |               712 |              605 |                811 |              616 |        3,126 |      832 |              985 |             1,065 |         2,339 |         2,392 |       644 |               699 |                738 |                             104 |
| fetch 100k rows                    |          18.4 |       6.8 |               6.9 |              6.2 |                9.2 |              6.1 |         35.3 |     10.4 |              9.3 |              10.8 |          27.0 |          20.0 |       6.3 |               6.6 |                9.4 |                             1.0 |
| insert one row                     |        29,980 |    20,413 |            28,249 |           20,317 |             25,598 |           11,529 |       34,893 |   25,489 |           33,388 |            30,987 |        32,443 |        26,730 |    19,212 |            25,102 |             22,485 |                          14,982 |
| insert one row, concurrency 50     |       186,056 |    78,993 |            71,802 |           65,722 |             37,920 |           28,207 |      216,755 |   86,076 |           97,343 |            59,373 |       129,937 |       150,068 |    65,548 |            52,858 |             50,084 |                          19,788 |
| transaction: begin; insert; commit |        12,236 |    10,777 |            12,049 |            9,542 |              9,072 |            5,857 |       13,625 |   12,699 |           14,108 |            13,098 |         9,559 |        10,995 |     9,597 |            10,328 |              8,616 |                           7,901 |

## Concurrency sweep (Node 24): point lookups/s

**Node 24: pool size 1, point lookups/s by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |         pg |  pg (named) |   pg-native |      postgres.js |   neon (WS) |
| ----------- | ----------: | -----------------------: | ---------: | ----------: | ----------: | ---------------: | ----------: |
| 1           |  31,574 ±8% |           **31,937 ±8%** | 18,951 ±5% | 24,591 ±19% |  17,387 ±8% |       26,676 ±8% |  11,310 ±6% |
| 10          | 98,790 ±10% |               32,522 ±2% | 20,059 ±7% |  26,807 ±5% |  19,074 ±6% |  **102,672 ±8%** |  12,058 ±7% |
| 50          | 111,174 ±8% |               32,641 ±8% | 20,301 ±7% | 26,689 ±11% |  19,046 ±5% | **113,827 ±17%** |  11,787 ±3% |
| 100         | 32,261 ±20% |               31,583 ±8% | 20,154 ±3% | 27,164 ±11% | 18,772 ±11% | **120,669 ±18%** | 11,459 ±84% |
| 500         |  32,051 ±9% |               31,008 ±5% | 19,864 ±2% | 26,209 ±12% |  18,551 ±7% | **107,338 ±10%** |  11,552 ±4% |
| 1000        |  31,609 ±8% |              28,856 ±10% | 18,866 ±6% |  26,536 ±9% |  18,510 ±5% |  **106,445 ±4%** | 11,905 ±11% |

**Node 24: pool size 1, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native |  postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | -----------: | --------: |
| 1           | **52.0 µs** |                  52.4 µs |  84.1 µs |    70.0 µs |   88.4 µs |      63.8 µs |    180 µs |
| 10          |      450 µs |                   823 µs |  1.07 ms |     895 µs |    964 µs |   **187 µs** |   1.79 ms |
| 50          |     1.25 ms |                  2.58 ms |  3.96 ms |    3.01 ms |   3.53 ms |   **938 µs** |   7.00 ms |
| 100         |     5.17 ms |                  4.84 ms |  7.99 ms |    5.61 ms |   9.70 ms |  **4.29 ms** |  12.09 ms |
| 500         |    22.56 ms |                 22.56 ms | 39.10 ms |   25.98 ms |  33.69 ms | **11.72 ms** |  52.93 ms |
| 1000        |    39.56 ms |                 46.44 ms | 65.58 ms |   49.48 ms |  61.23 ms | **15.63 ms** |  99.80 ms |

**Node 24: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |      postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | ---------------: | ----------: |
| 1           |       30,897 ±5% |           **32,339 ±3%** | 18,702 ±10% |  25,397 ±6% |  17,493 ±8% |       27,445 ±8% |  10,948 ±7% |
| 10          | **122,056 ±13%** |               87,554 ±1% |  63,289 ±5% | 58,036 ±13% |  57,027 ±6% |      41,917 ±11% | 28,876 ±16% |
| 50          |  **273,192 ±6%** |              85,434 ±13% |  57,012 ±8% |  56,396 ±8% |  56,021 ±8% |      39,048 ±22% | 25,887 ±26% |
| 100         |  **339,180 ±3%** |               82,009 ±9% |  56,625 ±9% |  57,594 ±4% | 55,361 ±14% |       39,920 ±6% | 29,539 ±10% |
| 500         |       78,724 ±8% |               85,664 ±4% |  60,337 ±1% | 57,265 ±13% |  53,385 ±9% | **122,478 ±14%** |  27,845 ±6% |
| 1000        |      78,292 ±12% |              73,115 ±12% | 61,301 ±14% | 53,599 ±11% | 51,665 ±12% | **123,064 ±15%** | 28,345 ±28% |

**Node 24: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native |  postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | -----------: | --------: |
| 1           |     55.0 µs |              **49.8 µs** |  89.1 µs |    70.8 µs |   85.0 µs |      54.7 µs |    195 µs |
| 10          |  **248 µs** |                   487 µs |   593 µs |     624 µs |    481 µs |       468 µs |    952 µs |
| 50          | **1.03 ms** |                  1.52 ms |  1.82 ms |    1.77 ms |   1.61 ms |      3.11 ms |   3.31 ms |
| 100         | **1.44 ms** |                  2.66 ms |  3.06 ms |    2.94 ms |   2.80 ms |      6.19 ms |   5.61 ms |
| 500         |    12.07 ms |             **10.42 ms** | 12.20 ms |   12.66 ms |  13.77 ms |     11.12 ms |  24.32 ms |
| 1000        |    21.49 ms |                 22.39 ms | 24.25 ms |   27.91 ms |  26.17 ms | **16.08 ms** |  44.03 ms |

**Node 24: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |      postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | ---------------: | ----------: |
| 1           |   **31,193 ±8%** |               30,511 ±7% |  19,500 ±8% | 26,208 ±10% |  18,350 ±9% |       27,192 ±9% |  11,115 ±6% |
| 10          |       89,566 ±9% |          **90,388 ±10%** | 61,864 ±13% | 59,082 ±10% | 59,016 ±16% |      57,791 ±14% | 28,288 ±68% |
| 50          | **209,959 ±11%** |               88,550 ±6% |  60,639 ±4% | 54,184 ±11% | 57,121 ±11% |       40,706 ±2% | 29,334 ±20% |
| 100         |  **287,998 ±7%** |               81,779 ±8% | 62,478 ±10% | 57,315 ±12% |  57,990 ±4% |       41,439 ±8% | 29,451 ±11% |
| 500         | **308,906 ±23%** |              81,474 ±10% | 63,078 ±21% |  57,522 ±3% | 53,984 ±10% |     115,163 ±13% | 26,523 ±13% |
| 1000        |      76,250 ±12% |              76,819 ±16% | 55,819 ±16% | 55,516 ±11% |  56,107 ±5% | **126,238 ±18%** | 24,776 ±21% |

**Node 24: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native |  postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | -----------: | --------: |
| 1           | **51.1 µs** |                  54.3 µs |  81.8 µs |    63.1 µs |   81.6 µs |      57.4 µs |    182 µs |
| 10          |      359 µs |                   406 µs |   627 µs |     622 µs |    426 µs |   **341 µs** |   1.04 ms |
| 50          | **1.06 ms** |                  1.45 ms |  1.75 ms |    1.91 ms |   1.53 ms |      2.70 ms |   2.95 ms |
| 100         | **1.50 ms** |                  2.59 ms |  2.83 ms |    2.92 ms |   2.78 ms |      5.70 ms |   5.17 ms |
| 500         | **4.85 ms** |                 10.21 ms | 13.22 ms |   13.12 ms |  13.62 ms |     13.04 ms |  25.11 ms |
| 1000        |    20.97 ms |                 23.10 ms | 26.20 ms |   26.46 ms |  21.97 ms | **17.05 ms** |  56.55 ms |

**Node 24: pool size 50, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| 1           |       30,351 ±8% |           **32,463 ±5%** |  18,567 ±9% |  25,551 ±8% |  18,207 ±8% |  26,831 ±5% |  11,348 ±5% |
| 10          |      82,307 ±16% |          **87,110 ±16%** |  60,921 ±3% |  56,910 ±7% |  57,506 ±8% |  58,341 ±8% | 29,240 ±22% |
| 50          |   **85,372 ±9%** |              80,349 ±16% |  61,934 ±8% |  54,889 ±6% |  54,964 ±8% |  56,182 ±9% | 26,877 ±45% |
| 100         |  **109,953 ±9%** |               80,676 ±4% | 60,575 ±11% | 56,310 ±15% |  52,981 ±5% |  39,557 ±5% | 26,104 ±15% |
| 500         | **210,377 ±17%** |               80,889 ±6% |  59,460 ±5% |  51,657 ±9% |  49,521 ±8% | 41,825 ±10% | 26,161 ±40% |
| 1000        | **234,060 ±14%** |               70,092 ±6% | 57,614 ±22% |  43,096 ±7% | 49,002 ±12% |  42,295 ±5% | 25,508 ±15% |

**Node 24: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           |     52.9 µs |              **49.1 µs** |  98.7 µs |    63.6 µs |   84.1 µs |     60.2 µs |    185 µs |
| 10          |      385 µs |                   516 µs |   608 µs |     626 µs |    425 µs |  **360 µs** |    993 µs |
| 50          | **1.62 ms** |                  1.65 ms |  1.90 ms |    1.98 ms |   1.64 ms |     2.38 ms |   4.04 ms |
| 100         | **2.38 ms** |                  2.68 ms |  3.15 ms |    3.12 ms |   3.18 ms |     7.60 ms |   7.57 ms |
| 500         | **5.86 ms** |                 10.36 ms | 12.55 ms |   14.67 ms |  15.82 ms |    28.41 ms |  28.58 ms |
| 1000        | **9.29 ms** |                 21.83 ms | 28.03 ms |   31.88 ms |  27.90 ms |    49.31 ms |  55.68 ms |

## Concurrency sweep (Bun 1.4): point lookups/s

**Bun 1.4: pool size 1, point lookups/s by concurrency**

| Concurrency |          quarry |          pg |      postgres.js |     Bun.sql |
| ----------- | --------------: | ----------: | ---------------: | ----------: |
| 1           | **34,846 ±14%** | 21,681 ±10% |       33,671 ±5% |  33,895 ±3% |
| 10          |    106,581 ±10% | 23,096 ±11% | **112,069 ±13%** |  80,742 ±9% |
| 50          | **116,273 ±8%** |  23,640 ±7% |      107,310 ±8% |  84,804 ±3% |
| 100         |      36,248 ±5% |  23,369 ±5% | **110,313 ±10%** |  83,811 ±8% |
| 500         |      35,707 ±9% | 20,290 ±18% |  **109,192 ±4%** |  88,367 ±8% |
| 1000        |      34,272 ±1% |  22,820 ±5% | **109,729 ±14%** | 89,986 ±15% |

**Bun 1.4: pool size 1, p99 latency by concurrency**

| Concurrency |      quarry |       pg |  postgres.js |  Bun.sql |
| ----------- | ----------: | -------: | -----------: | -------: |
| 1           | **40.2 µs** |  72.3 µs |      41.8 µs |  41.6 µs |
| 10          |      164 µs |   953 µs |   **154 µs** |   215 µs |
| 50          |     1.05 ms |  3.09 ms |  **1.04 ms** |  1.33 ms |
| 100         |     3.94 ms |  5.51 ms |  **1.80 ms** |  1.99 ms |
| 500         |    16.35 ms | 30.08 ms |  **6.36 ms** |  7.47 ms |
| 1000        |    34.56 ms | 49.01 ms | **11.07 ms** | 14.63 ms |

**Bun 1.4: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |      postgres.js |         Bun.sql |
| ----------- | ---------------: | ----------: | ---------------: | --------------: |
| 1           |   **36,518 ±8%** |  22,056 ±5% |       33,783 ±7% |     31,990 ±12% |
| 10          |  **148,172 ±9%** | 81,004 ±10% |       63,211 ±9% |     121,580 ±2% |
| 50          | **318,446 ±10%** |  75,837 ±7% |       62,173 ±5% |     165,261 ±8% |
| 100         |  **412,199 ±9%** |  74,299 ±6% |       64,699 ±3% |    178,128 ±11% |
| 500         |       98,467 ±9% | 68,416 ±13% | **193,513 ±13%** |    188,415 ±10% |
| 1000        |      87,575 ±10% | 65,489 ±15% |     191,586 ±13% | **192,802 ±7%** |

**Bun 1.4: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js | Bun.sql |
| ----------- | ----------: | -------: | ----------: | ------: |
| 1           | **40.5 µs** |  67.3 µs |     41.7 µs | 45.3 µs |
| 10          |  **143 µs** |   571 µs |      335 µs |  163 µs |
| 50          |  **730 µs** |  1.53 ms |     1.86 ms | 1.13 ms |
| 100         |  **968 µs** |  2.42 ms |     3.42 ms | 1.77 ms |
| 500         |     7.77 ms | 10.84 ms | **4.90 ms** | 5.33 ms |
| 1000        |    14.31 ms | 18.00 ms | **8.50 ms** | 9.56 ms |

**Bun 1.4: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |     postgres.js |      Bun.sql |
| ----------- | ---------------: | ----------: | --------------: | -----------: |
| 1           |   **36,207 ±3%** |  22,503 ±9% |      33,271 ±9% |   32,129 ±7% |
| 10          | **104,772 ±13%** |  82,131 ±9% |     91,639 ±12% |  79,544 ±14% |
| 50          | **249,745 ±10%** | 84,143 ±11% |      62,168 ±6% | 144,576 ±14% |
| 100         |  **325,849 ±9%** |  79,243 ±6% |      63,697 ±4% | 162,685 ±12% |
| 500         |  **457,309 ±4%** |  73,350 ±5% |    168,024 ±23% |  182,823 ±6% |
| 1000        |      91,080 ±14% | 74,422 ±10% | **192,474 ±5%** |  188,675 ±3% |

**Bun 1.4: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |  Bun.sql |
| ----------- | ----------: | -------: | ----------: | -------: |
| 1           | **38.1 µs** |  62.2 µs |     45.5 µs |  49.3 µs |
| 10          |  **194 µs** |   584 µs |      249 µs |   309 µs |
| 50          |  **865 µs** |  1.39 ms |     1.93 ms |  1.31 ms |
| 100         | **1.09 ms** |  2.29 ms |     3.45 ms |  1.71 ms |
| 500         | **3.32 ms** |  9.23 ms |     7.48 ms |  5.64 ms |
| 1000        |    13.62 ms | 16.37 ms | **9.03 ms** | 10.39 ms |

**Bun 1.4: pool size 50, point lookups/s by concurrency**

| Concurrency |           quarry |          pg | postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | ----------: | ----------: |
| 1           |   **36,754 ±1%** |  21,977 ±8% | 33,133 ±22% | 31,473 ±12% |
| 10          | **113,078 ±10%** |  78,524 ±5% | 90,262 ±13% |  73,805 ±6% |
| 50          |  **98,113 ±11%** |  79,295 ±3% |  84,124 ±8% | 83,118 ±14% |
| 100         |  **130,659 ±5%** |  77,914 ±6% |  60,075 ±4% | 101,362 ±6% |
| 500         | **253,943 ±19%** | 70,585 ±10% | 62,134 ±13% | 143,567 ±9% |
| 1000        |  **303,889 ±5%** | 66,535 ±14% |  62,952 ±5% | 151,741 ±6% |

**Bun 1.4: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |     Bun.sql |
| ----------- | ----------: | -------: | ----------: | ----------: |
| 1           | **37.0 µs** |  73.4 µs |     43.3 µs |     47.3 µs |
| 10          |  **176 µs** |   576 µs |      280 µs |      316 µs |
| 50          |     1.45 ms |  1.51 ms |     1.53 ms | **1.16 ms** |
| 100         | **1.82 ms** |  2.65 ms |     3.73 ms |     1.92 ms |
| 500         | **4.51 ms** |  9.87 ms |    18.31 ms |     6.72 ms |
| 1000        | **6.48 ms** | 18.85 ms |    33.47 ms |    12.64 ms |

## Pipelining depth

**quarry, one connection, 100 concurrent point lookups: throughput by `pipeline` depth (columns: RTT ms)**

| pipeline |               0 |           5 |
| -------- | --------------: | ----------: |
| 1        | **19,401 ±87%** |    169 ±13% |
| 2        |  **19,842 ±9%** |    171 ±14% |
| 4        |  **19,376 ±8%** |     172 ±4% |
| 8        |  **19,375 ±6%** |     173 ±1% |
| 16       | **18,717 ±11%** |    176 ±15% |
| 32       |  **19,300 ±7%** |     185 ±2% |
| 64       |  **20,136 ±3%** |     196 ±3% |
| 100      | **90,547 ±62%** | 16,227 ±21% |

## Network latency (RTT through Toxiproxy)

**Node 24: select 1, sequential: median latency by RTT**

| RTT   |           quarry |           pg |   pg (named) |    pg-native |   postgres.js |    neon (WS) |
| ----- | ---------------: | -----------: | -----------: | -----------: | ------------: | -----------: |
| 0 ms  | **44.0 µs ±31%** |  44.3 µs ±4% |  44.3 µs ±6% |  54.7 µs ±3% |  50.7 µs ±34% | 65.1 µs ±37% |
| 1 ms  |  **1.42 ms ±3%** |  1.42 ms ±2% |  1.45 ms ±6% |  1.45 ms ±2% |   1.45 ms ±3% |  1.51 ms ±2% |
| 5 ms  | **5.77 ms ±<1%** |  5.84 ms ±1% |  5.81 ms ±2% |  5.78 ms ±1% |   5.85 ms ±2% |  5.97 ms ±2% |
| 20 ms | **20.80 ms ±1%** | 20.92 ms ±1% | 20.93 ms ±1% | 20.92 ms ±1% | 20.88 ms ±<1% | 20.96 ms ±1% |

**Node 24: point lookup, sequential: median latency by RTT**

| RTT   |          quarry |           pg |   pg (named) |     pg-native |       postgres.js |    neon (WS) |
| ----- | --------------: | -----------: | -----------: | ------------: | ----------------: | -----------: |
| 0 ms  | **51.7 µs ±8%** | 69.7 µs ±18% | 59.0 µs ±49% |  78.6 µs ±12% |      57.1 µs ±50% |  114 µs ±52% |
| 1 ms  | **1.44 ms ±6%** |  1.54 ms ±6% |  1.47 ms ±2% |   1.50 ms ±4% |       1.47 ms ±1% |  1.62 ms ±4% |
| 5 ms  | **5.85 ms ±1%** |  5.91 ms ±3% |  5.86 ms ±2% |   5.90 ms ±1% |       5.92 ms ±1% |  6.00 ms ±2% |
| 20 ms |   20.96 ms ±<1% | 21.07 ms ±1% | 21.00 ms ±1% | 20.98 ms ±<1% | **20.95 ms ±<1%** | 21.04 ms ±1% |

**Node 24: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |          pg |  pg (named) |   pg-native | postgres.js |  neon (WS) |
| ----- | ---------------: | ----------: | ----------: | ----------: | ----------: | ---------: |
| 0 ms  | **194,717 ±16%** | 53,376 ±26% | 53,155 ±15% | 55,283 ±18% |  38,148 ±4% | 20,747 ±8% |
| 1 ms  |   **27,037 ±2%** |   5,744 ±5% |   5,905 ±1% |   5,721 ±5% |  17,775 ±2% |  4,956 ±1% |
| 5 ms  |    **8,119 ±1%** |   1,635 ±1% |   1,658 ±1% |   1,650 ±2% |   6,741 ±7% |  1,583 ±1% |
| 20 ms |   **2,346 ±<1%** |    472 ±<1% |     473 ±1% |    472 ±<1% |   1,885 ±8% |   467 ±<1% |

**Node 24: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |      quarry |          pg |  pg (named) |   pg-native |     postgres.js | neon (WS) |
| ----- | ----------: | ----------: | ----------: | ----------: | --------------: | --------: |
| 0 ms  | 18,581 ±39% | 13,373 ±31% | 15,185 ±27% | 11,706 ±12% | **98,816 ±28%** | 7,821 ±7% |
| 1 ms  |     724 ±2% |     658 ±5% |     668 ±9% |     655 ±4% |  **34,326 ±6%** |   631 ±2% |
| 5 ms  |     190 ±2% |     167 ±1% |     169 ±1% |     169 ±1% |  **13,022 ±8%** |   165 ±1% |
| 20 ms |   59.9 ±<1% |    47.6 ±1% |   47.8 ±<1% |   47.6 ±<1% |  **3,558 ±13%** | 47.4 ±<1% |

**Node 24: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |            pg |   pg (named) |    pg-native |  postgres.js |    neon (WS) |
| ----- | ----------------: | ------------: | -----------: | -----------: | -----------: | -----------: |
| 0 ms  |    **437 µs ±8%** |  1.49 ms ±11% | 1.53 ms ±11% |  1.82 ms ±9% | 1.16 ms ±13% |  1.67 ms ±7% |
| 1 ms  |   **2.25 ms ±5%** |   3.27 ms ±3% |  3.20 ms ±4% | 3.28 ms ±13% |  3.07 ms ±3% |  3.46 ms ±3% |
| 5 ms  |   **6.50 ms ±1%** |   7.56 ms ±1% |  7.50 ms ±2% |  7.57 ms ±1% |  7.30 ms ±5% |  7.85 ms ±2% |
| 20 ms | **21.54 ms ±<1%** | 22.57 ms ±<1% | 22.55 ms ±1% | 22.65 ms ±1% | 22.36 ms ±1% | 22.88 ms ±3% |

**Node 24: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |          quarry |            pg |       pg (named) |    pg-native |   postgres.js |     neon (WS) |
| ----- | --------------: | ------------: | ---------------: | -----------: | ------------: | ------------: |
| 0 ms  | **132 µs ±38%** |   154 µs ±51% |      151 µs ±47% |  174 µs ±13% |   153 µs ±26% |   231 µs ±19% |
| 1 ms  | **4.18 ms ±7%** |   4.45 ms ±2% |      4.28 ms ±3% |  4.33 ms ±2% |   4.36 ms ±3% |   4.53 ms ±5% |
| 5 ms  |    17.42 ms ±1% |  17.54 ms ±1% | **17.36 ms ±2%** | 17.51 ms ±1% |  17.56 ms ±2% |  17.74 ms ±1% |
| 20 ms |    62.91 ms ±1% | 62.84 ms ±<1% | **62.56 ms ±1%** | 62.70 ms ±1% | 62.68 ms ±<1% | 63.07 ms ±<1% |

**Node 24: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |         pg | pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----- | ---------------: | ---------: | ---------: | ----------: | ----------: | ----------: |
| 0 ms  | **185,304 ±27%** | 72,851 ±9% | 77,356 ±2% | 58,517 ±20% |  37,597 ±5% | 20,695 ±22% |
| 1 ms  |   **26,931 ±3%** |  5,964 ±3% |  6,085 ±4% |  5,695 ±10% |  17,828 ±2% |   4,908 ±4% |
| 5 ms  |    **8,093 ±1%** |  1,647 ±1% |  1,664 ±1% |   1,647 ±3% |   6,762 ±3% |   1,585 ±1% |
| 20 ms |   **2,353 ±<1%** |   473 ±<1% |    474 ±1% |    473 ±<1% |   1,888 ±3% |    468 ±<1% |

**Node 24: connect + select 1 + close: median latency by RTT**

| RTT   |           quarry |               pg |      pg (named) |    pg-native |  postgres.js |    neon (WS) |
| ----- | ---------------: | ---------------: | --------------: | -----------: | -----------: | -----------: |
| 0 ms  |      2.89 ms ±2% | **2.84 ms ±20%** |    2.89 ms ±13% |  5.16 ms ±8% |  6.36 ms ±6% |  5.10 ms ±5% |
| 1 ms  |     5.41 ms ±10% |     5.36 ms ±10% | **5.35 ms ±3%** | 10.05 ms ±7% | 10.46 ms ±6% |  7.67 ms ±5% |
| 5 ms  |     14.21 ms ±5% | **14.12 ms ±3%** |    14.18 ms ±3% | 27.60 ms ±2% | 22.86 ms ±1% | 16.86 ms ±3% |
| 20 ms | **44.59 ms ±2%** |     44.95 ms ±2% |    44.76 ms ±1% | 88.79 ms ±1% | 69.56 ms ±2% | 47.14 ms ±1% |

**Bun 1.4: select 1, sequential: median latency by RTT**

| RTT   |           quarry |          Bun.sql |
| ----- | ---------------: | ---------------: |
| 0 ms  | **39.6 µs ±17%** |     45.1 µs ±32% |
| 1 ms  |      1.37 ms ±9% |  **1.37 ms ±2%** |
| 5 ms  |      5.78 ms ±3% |  **5.74 ms ±3%** |
| 20 ms |    20.88 ms ±<1% | **20.79 ms ±1%** |

**Bun 1.4: point lookup, sequential: median latency by RTT**

| RTT   |       quarry |           Bun.sql |
| ----- | -----------: | ----------------: |
| 0 ms  | 48.5 µs ±23% |  **48.0 µs ±12%** |
| 1 ms  |  1.42 ms ±7% |  **1.37 ms ±10%** |
| 5 ms  |  5.83 ms ±1% |   **5.82 ms ±3%** |
| 20 ms | 20.96 ms ±1% | **20.90 ms ±<1%** |

**Bun 1.4: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |        Bun.sql |
| ----- | ---------------: | -------------: |
| 0 ms  | **239,782 ±10%** |   139,818 ±12% |
| 1 ms  |   **28,277 ±4%** |     26,807 ±4% |
| 5 ms  |    **8,282 ±2%** |      8,182 ±1% |
| 20 ms |        2,351 ±1% | **2,352 ±<1%** |

**Bun 1.4: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |      quarry |         Bun.sql |
| ----- | ----------: | --------------: |
| 0 ms  | 20,364 ±18% | **88,569 ±11%** |
| 1 ms  |     745 ±4% | **57,363 ±40%** |
| 5 ms  |     190 ±2% |  **15,881 ±2%** |
| 20 ms |   59.9 ±<1% |  **4,665 ±<1%** |

**Bun 1.4: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |      Bun.sql |
| ----- | ----------------: | -----------: |
| 0 ms  |   **310 µs ±22%** |  426 µs ±15% |
| 1 ms  |   **2.03 ms ±5%** |  2.29 ms ±5% |
| 5 ms  |   **6.38 ms ±2%** |  6.58 ms ±2% |
| 20 ms | **21.49 ms ±<1%** | 21.78 ms ±1% |

**Bun 1.4: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |           quarry |           Bun.sql |
| ----- | ---------------: | ----------------: |
| 0 ms  |   **124 µs ±4%** |       169 µs ±24% |
| 1 ms  | **4.22 ms ±10%** |       4.34 ms ±3% |
| 5 ms  | **17.28 ms ±2%** |      17.42 ms ±1% |
| 20 ms |     62.83 ms ±1% | **62.77 ms ±<1%** |

**Bun 1.4: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |        Bun.sql |
| ----- | ---------------: | -------------: |
| 0 ms  | **205,668 ±15%** |   130,120 ±17% |
| 1 ms  |   **26,849 ±5%** |     26,494 ±6% |
| 5 ms  |    **8,196 ±1%** |      8,164 ±1% |
| 20 ms |        2,358 ±1% | **2,368 ±<1%** |

**Bun 1.4: connect + select 1 + close: median latency by RTT**

| RTT   |       quarry |          Bun.sql |
| ----- | -----------: | ---------------: |
| 0 ms  | 2.98 ms ±16% | **2.73 ms ±18%** |
| 1 ms  |  5.58 ms ±7% |  **5.19 ms ±3%** |
| 5 ms  | 14.21 ms ±1% | **13.70 ms ±3%** |
| 20 ms | 44.74 ms ±2% | **43.96 ms ±2%** |

## PgBouncer

**Node 24 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |          quarry | quarry (prepare: false) |          pg |      pg (named) |   pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | --------------: | ----------------------: | ----------: | --------------: | ----------: | ----------: | ---------------------------: |
| select 1                                               | **18,721 ±10%** |             16,760 ±17% | 17,434 ±13% |     16,679 ±33% | 17,172 ±15% |  16,357 ±7% |                  17,231 ±11% |
| point lookup by primary key                            |  **15,924 ±7%** |             11,774 ±37% | 11,622 ±30% |     13,360 ±13% |  12,271 ±8% | 14,299 ±20% |                   6,452 ±22% |
| point lookup by primary key, concurrency 50            |     64,085 ±52% |        **110,161 ±21%** | 58,161 ±52% |     52,940 ±58% | 57,420 ±43% |  35,886 ±6% |                  34,520 ±25% |
| fetch 1k rows (6 columns)                              |   **2,001 ±5%** |              1,013 ±18% |     596 ±9% |         675 ±9% |    554 ±14% |    672 ±11% |                     705 ±11% |
| insert one row                                         |     15,046 ±16% |              14,112 ±9% | 14,653 ±26% | **16,513 ±14%** |  13,963 ±6% | 13,617 ±35% |                   8,476 ±13% |
| transaction: begin; insert; commit                     |      5,709 ±45% |              5,662 ±16% |  5,915 ±14% |  **6,658 ±30%** |  5,942 ±23% |  5,540 ±20% |                   4,014 ±12% |
| insert one row, concurrency 50                         |     60,819 ±55% |         **96,464 ±46%** | 69,726 ±17% |     63,028 ±10% | 71,349 ±48% |  36,877 ±9% |                  30,922 ±60% |
| query that fails (division by zero), connection reused |  **14,098 ±8%** |             13,578 ±10% |  4,586 ±14% |      4,648 ±32% |  3,888 ±13% |  9,922 ±16% |                  10,048 ±14% |

**Node 24 through PgBouncer: median latency**

| Scenario                                               |      quarry | quarry (prepare: false) |      pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | ----------: | ----------------------: | ------: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                                               | **50.1 µs** |                 55.8 µs | 52.1 µs |    55.5 µs |   54.5 µs |     54.1 µs |                      54.0 µs |
| point lookup by primary key                            | **58.0 µs** |                 77.4 µs | 79.8 µs |    68.7 µs |   75.9 µs |     63.5 µs |                       146 µs |
| point lookup by primary key, concurrency 50            |      717 µs |              **420 µs** |  790 µs |     876 µs |    755 µs |     1.27 ms |                      1.33 ms |
| fetch 1k rows (6 columns)                              |  **446 µs** |                  915 µs | 1.53 ms |    1.45 ms |   1.75 ms |     1.26 ms |                      1.23 ms |
| insert one row                                         | **54.6 µs** |                 65.2 µs | 64.0 µs |    56.2 µs |   67.2 µs |     67.7 µs |                       111 µs |
| transaction: begin; insert; commit                     |      161 µs |                  166 µs |  160 µs | **141 µs** |    160 µs |      168 µs |                       230 µs |
| insert one row, concurrency 50                         |      797 µs |              **473 µs** |  658 µs |     741 µs |    651 µs |     1.26 ms |                      1.48 ms |
| query that fails (division by zero), connection reused |     67.0 µs |             **66.7 µs** |  185 µs |     190 µs |    233 µs |     92.9 µs |                      82.5 µs |

**Node 24: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | quarry (prepare: false) |      pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ---------------------------------- | -----: | ----------------------: | ------: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                           |    50% |                     55% |     51% |        51% |   **62%** |         55% |                          56% |
| point lookup by primary key        |    54% |                     64% |     65% |        53% |   **72%** |         58% |                          55% |
| fetch 1k rows (6 columns)          |    91% |                    100% |     91% |        95% |       92% |         83% |                     **101%** |
| insert one row                     |    50% |                     69% | **72%** |        58% |       69% |         53% |                          63% |
| transaction: begin; insert; commit |    47% |                       — |     55% |        55% |   **62%** |         61% |                            — |

**Bun 1.4 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |          quarry |     Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | --------------: | ----------: | -----------------------: |
| select 1                                               |  **20,920 ±6%** | 18,611 ±12% |              19,460 ±25% |
| point lookup by primary key                            |  **17,199 ±7%** | 14,801 ±36% |              12,376 ±47% |
| point lookup by primary key, concurrency 50            | **56,986 ±41%** | 50,740 ±49% |              52,878 ±13% |
| fetch 1k rows (6 columns)                              |  **2,391 ±12%** |   2,052 ±9% |               2,003 ±47% |
| insert one row                                         |  **17,737 ±9%** | 15,040 ±55% |              12,024 ±37% |
| transaction: begin; insert; commit                     |      6,024 ±49% |  5,980 ±56% |            **6,025 ±3%** |
| insert one row, concurrency 50                         | **67,377 ±20%** |  46,570 ±7% |              53,300 ±56% |
| query that fails (division by zero), connection reused |     14,858 ±19% |  17,716 ±8% |          **17,973 ±49%** |

**Bun 1.4 through PgBouncer: median latency**

| Scenario                                               |      quarry |    Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | ----------: | ---------: | -----------------------: |
| select 1                                               | **44.9 µs** |    49.4 µs |                  49.3 µs |
| point lookup by primary key                            | **55.2 µs** |    60.2 µs |                  78.7 µs |
| point lookup by primary key, concurrency 50            |  **804 µs** |     967 µs |                   905 µs |
| fetch 1k rows (6 columns)                              |  **372 µs** |     458 µs |                   486 µs |
| insert one row                                         | **53.6 µs** |    63.5 µs |                  81.5 µs |
| transaction: begin; insert; commit                     |      157 µs | **155 µs** |                   158 µs |
| insert one row, concurrency 50                         |  **684 µs** |    1.01 ms |                   909 µs |
| query that fails (division by zero), connection reused |     63.4 µs |    53.2 µs |              **53.1 µs** |

**Bun 1.4: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | Bun.sql | Bun.sql (prepare: false) |
| ---------------------------------- | -----: | ------: | -----------------------: |
| select 1                           |    48% |     51% |                  **51%** |
| point lookup by primary key        |    53% |     50% |                  **62%** |
| fetch 1k rows (6 columns)          |    76% |     88% |                  **89%** |
| insert one row                     |    51% |     46% |                  **53%** |
| transaction: begin; insert; commit |    44% | **63%** |                        — |

## Server restart

`pg_ctl restart -m fast` while a pool runs `select 1` every 5 ms (2 s client timeout per query).

| Runtime  | Client                   | Recovered | Time from server up to first success (median) | Failed queries (median) |
| -------- | ------------------------ | --------: | --------------------------------------------: | ----------------------: |
| Node 24  | quarry                   |       5/5 |                                       4.00 ms |                      28 |
| Node 24  | pg                       |       5/5 |                                       1.00 ms |                      29 |
| Node 24  | pg (named)               |       5/5 |                                       6.00 ms |                      28 |
| Node 24  | pg-native                |       5/5 |                                       1.00 ms |                      27 |
| Node 24  | postgres.js              |       5/5 |                                      90.00 ms |                      17 |
| Bun 1.4  | quarry                   |       5/5 |                                       2.00 ms |                      30 |
| Bun 1.4  | postgres.js              |       5/5 |                                      23.00 ms |                      16 |
| Bun 1.4  | Bun.sql                  |       5/5 |                                       2.00 ms |                      20 |
| Deno 2.9 | quarry                   |       5/5 |                                       2.00 ms |                      27 |
| Deno 2.9 | deno-postgres (+nodelay) |       0/5 |                                             — |                       — |

## Footprint and cold start

| Package                                              | Installed size | Packages installed |
| ---------------------------------------------------- | -------------: | -----------------: |
| quarry (whole package: query builder + driver + src) |       1873 KiB |                  1 |
| pg                                                   |        464 KiB |                 14 |
| pg + pg-native (libpq addon, built)                  |       1377 KiB |                 19 |
| postgres.js                                          |        293 KiB |                  1 |
| @neondatabase/serverless (+ ws on Node)              |        582 KiB |                  2 |
| deno-postgres (jsr, source modules)                  |        531 KiB |                  7 |
| Bun.sql (built into Bun)                             |          0 KiB |                  0 |

| Bundle (esbuild, minified, platform node) |                                                  Size |     gzip |
| ----------------------------------------- | ----------------------------------------------------: | -------: |
| quarry/driver                             |                                              76.3 KiB | 25.9 KiB |
| pg                                        |                                              84.4 KiB | 26.3 KiB |
| postgres.js                               |                                              37.1 KiB | 14.3 KiB |
| @neondatabase/serverless                  |                                             142.9 KiB | 46.3 KiB |
| pg-native                                 | native addon (libpq .node + libpq.so): not bundleable |          |

| Runtime / client   |   Import | Connect + first query | Process start → first result | Wall time of the process |
| ------------------ | -------: | --------------------: | ---------------------------: | -----------------------: |
| node/none          |   2.1 µs |                8.8 µs |                     42.83 ms |                 50.57 ms |
| node/quarry        |  4.65 ms |              14.16 ms |                     62.70 ms |                 71.80 ms |
| node/pg            | 22.22 ms |               7.60 ms |                     77.15 ms |                 83.49 ms |
| node/pg-native     | 21.76 ms |               8.87 ms |                     75.30 ms |                 83.88 ms |
| node/postgres.js   | 16.64 ms |               9.97 ms |                     70.58 ms |                 79.95 ms |
| node/neon          | 24.26 ms |              11.97 ms |                     79.65 ms |                 86.16 ms |
| bun/none           |   0.8 µs |               12.4 µs |                      1.83 ms |                  4.62 ms |
| bun/quarry         |  6.38 ms |              14.64 ms |                     22.62 ms |                 28.65 ms |
| bun/pg             | 14.36 ms |               8.70 ms |                     24.98 ms |                 28.57 ms |
| bun/postgres.js    | 13.45 ms |              10.09 ms |                     25.94 ms |                 32.52 ms |
| bun/bun.sql        |  3.34 ms |               4.03 ms |                      9.36 ms |                 12.89 ms |
| deno/none          |   2.4 µs |               18.8 µs |                     11.83 ms |                 23.75 ms |
| deno/quarry        |  2.00 ms |              13.09 ms |                     25.81 ms |                 41.09 ms |
| deno/pg            | 14.26 ms |               8.75 ms |                     34.41 ms |                 47.47 ms |
| deno/postgres.js   | 12.73 ms |              11.86 ms |                     35.16 ms |                 50.34 ms |
| deno/deno-postgres | 18.06 ms |               6.04 ms |                     35.18 ms |                 48.32 ms |
