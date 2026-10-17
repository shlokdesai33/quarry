### Correctness

Every result compared in canonical form (see `canon.ts`) against the majority digest for its runtime and scenario.

560 (runtime, client, scenario) results checked; 0 differ from the majority.

### Failed runs

- reconnect deno deno-postgres (+nodelay) reconnect (max 10, c -, rtt -): 5 failed: BrokenPipe: Broken pipe (os error 32)

## Node 24

**Node 24: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |    pg-native |    postgres.js |    neon (WS) |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | -------------: | -----------: |
| select 1                                                      |  **23.1 µs ±1%** |  26.2 µs ±2% |  26.1 µs ±1% | 31.2 µs ±42% |    28.3 µs ±2% | 47.0 µs ±73% |
| point lookup by primary key                                   |  **29.3 µs ±2%** |  48.0 µs ±6% |  36.5 µs ±3% |  51.2 µs ±1% |    34.5 µs ±5% | 84.1 µs ±36% |
| range scan, 100 rows                                          |  **99.1 µs ±2%** |   192 µs ±1% |   188 µs ±5% |   197 µs ±1% |     168 µs ±3% |   229 µs ±7% |
| fetch 1k rows (6 columns)                                     |  **389 µs ±14%** |  1.33 ms ±9% |  1.31 ms ±4% |  1.65 ms ±1% |   1.00 ms ±12% |  1.55 ms ±8% |
| 100 parameters (id in (…)), 100 rows                          |   **251 µs ±4%** |   336 µs ±3% |  296 µs ±37% |   337 µs ±3% |     287 µs ±5% |  371 µs ±11% |
| 1000 parameters (id in (…)), 1000 rows                        |  **2.11 ms ±9%** |  2.64 ms ±3% |  2.12 ms ±9% |  2.89 ms ±7% |    2.33 ms ±8% | 2.56 ms ±10% |
| insert one row                                                |  **27.8 µs ±2%** |  38.8 µs ±1% |  30.3 µs ±1% |  44.5 µs ±3% |    33.4 µs ±2% |  72.2 µs ±8% |
| multi-row insert: 100 rows, 300 parameters                    |   **214 µs ±5%** |   311 µs ±6% |   225 µs ±5% |   318 µs ±3% |     346 µs ±3% |   324 µs ±7% |
| update one row by primary key                                 |  **32.7 µs ±1%** |  46.3 µs ±2% |  34.8 µs ±3% |  51.7 µs ±1% |    36.8 µs ±1% |  117 µs ±32% |
| upsert (insert … on conflict do update)                       |  **33.5 µs ±2%** |  44.1 µs ±1% |  35.2 µs ±2% |  49.7 µs ±1% |    37.7 µs ±5% |  78.6 µs ±7% |
| delete one row by primary key                                 |  **27.7 µs ±6%** | 37.9 µs ±37% |  29.6 µs ±2% |  42.9 µs ±1% |    31.2 µs ±2% | 72.2 µs ±55% |
| transaction: begin; select 1; commit                          |  **65.1 µs ±3%** |  69.0 µs ±6% |  69.6 µs ±1% |  84.5 µs ±2% |    82.7 µs ±3% |  128 µs ±65% |
| transaction: begin; insert; commit                            |  **70.8 µs ±2%** |  82.4 µs ±2% |  73.3 µs ±3% | 99.3 µs ±19% |    91.3 µs ±3% |  152 µs ±69% |
| transaction with 5 savepoints (select 1 in each)              |       369 µs ±6% |   385 µs ±1% |   394 µs ±5% |   472 µs ±3% | **341 µs ±5%** |   725 µs ±1% |
| query that fails (division by zero), connection reused        |  **35.8 µs ±4%** |  2.35 ms ±3% |  2.45 ms ±5% |  4.97 ms ±2% |   64.3 µs ±14% |  2.75 ms ±4% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **33.5 µs ±10%** |  41.7 µs ±3% | 37.6 µs ±10% |  47.5 µs ±1% |    37.0 µs ±2% |  77.2 µs ±6% |

**Node 24: throughput, sequential (operations/s)**

| Scenario                                                      |         quarry |          pg |   pg (named) |   pg-native |   postgres.js |   neon (WS) |
| ------------------------------------------------------------- | -------------: | ----------: | -----------: | ----------: | ------------: | ----------: |
| select 1                                                      | **39,454 ±2%** |  35,126 ±2% |   35,449 ±2% | 30,006 ±23% |    32,457 ±6% | 18,884 ±40% |
| point lookup by primary key                                   | **31,272 ±3%** |  18,660 ±5% |   24,689 ±6% |  18,369 ±3% |    26,113 ±8% | 10,803 ±20% |
| range scan, 100 rows                                          |  **9,091 ±4%** |   4,783 ±3% |    4,903 ±5% |   4,819 ±2% |     5,123 ±6% |   3,833 ±5% |
| fetch 1k rows (6 columns)                                     | **2,284 ±17%** |     758 ±4% |      757 ±2% |     612 ±2% |      834 ±11% |    629 ±10% |
| 100 parameters (id in (…)), 100 rows                          |  **3,787 ±5%** |   2,788 ±4% |   3,221 ±26% |   2,831 ±4% |     3,263 ±6% |  2,465 ±15% |
| 1000 parameters (id in (…)), 1000 rows                        |        448 ±8% |     363 ±3% | **460 ±11%** |     341 ±7% |       395 ±8% |     378 ±8% |
| insert one row                                                | **32,908 ±2%** |  24,042 ±1% |   30,467 ±4% |  20,895 ±8% |    27,576 ±6% |  12,541 ±7% |
| multi-row insert: 100 rows, 300 parameters                    |  **4,404 ±5%** |   3,019 ±4% |    4,161 ±5% |   3,029 ±5% |     2,769 ±5% |   2,842 ±5% |
| update one row by primary key                                 | **28,282 ±2%** |  20,211 ±8% |  27,059 ±11% |  18,222 ±2% |    25,263 ±2% |  8,040 ±43% |
| upsert (insert … on conflict do update)                       | **26,568 ±7%** |  21,057 ±2% |   26,065 ±7% |  18,700 ±5% |   24,222 ±10% |  11,557 ±5% |
| delete one row by primary key                                 | **33,029 ±8%** | 23,404 ±23% |   31,027 ±5% |  21,682 ±4% |    29,396 ±5% | 12,320 ±32% |
| transaction: begin; select 1; commit                          | **14,226 ±4%** |  13,482 ±8% |   13,519 ±1% |  11,277 ±3% |    11,029 ±3% |  7,108 ±38% |
| transaction: begin; insert; commit                            | **13,311 ±8%** |  11,332 ±5% |   12,647 ±6% |  9,472 ±14% |     9,947 ±6% |  6,103 ±39% |
| transaction with 5 savepoints (select 1 in each)              |      2,539 ±7% |   2,463 ±6% |    2,372 ±5% |   1,994 ±5% | **2,716 ±7%** |   1,288 ±2% |
| query that fails (division by zero), connection reused        | **25,269 ±7%** |     415 ±3% |      396 ±5% |     200 ±3% |   14,597 ±13% |     350 ±4% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **27,061 ±9%** |  21,738 ±5% |  23,706 ±13% |  19,765 ±4% |    24,046 ±7% |  11,242 ±3% |

**Node 24: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | --------: | ----------: | --------: |
| select 1                                                      | **41.1 µs** | 45.3 µs |     47.0 µs |   47.1 µs |     45.1 µs |    114 µs |
| point lookup by primary key                                   | **48.7 µs** | 85.3 µs |     69.6 µs |   74.9 µs |     61.6 µs |    227 µs |
| range scan, 100 rows                                          |      397 µs |  568 µs |      574 µs |    370 µs |  **334 µs** |    692 µs |
| fetch 1k rows (6 columns)                                     | **1.22 ms** | 1.91 ms |     2.02 ms |   2.08 ms |     7.64 ms |   2.25 ms |
| 100 parameters (id in (…)), 100 rows                          |  **438 µs** |  784 µs |      582 µs |    629 µs |      588 µs |    946 µs |
| 1000 parameters (id in (…)), 1000 rows                        |     3.47 ms | 3.69 ms | **2.87 ms** |   3.38 ms |     5.16 ms |   3.50 ms |
| insert one row                                                | **56.1 µs** | 66.2 µs |     59.3 µs |   78.6 µs |     60.8 µs |    185 µs |
| multi-row insert: 100 rows, 300 parameters                    |      442 µs |  585 µs |  **430 µs** |    544 µs |      718 µs |    702 µs |
| update one row by primary key                                 | **50.7 µs** | 74.9 µs |     55.0 µs |   76.2 µs |     59.2 µs |    234 µs |
| upsert (insert … on conflict do update)                       | **54.1 µs** | 71.9 µs |     60.5 µs |   78.7 µs |     61.3 µs |    198 µs |
| delete one row by primary key                                 | **49.5 µs** | 71.1 µs |     55.0 µs |   65.3 µs |     53.6 µs |    178 µs |
| transaction: begin; select 1; commit                          |      118 µs |  103 µs | **99.4 µs** |    121 µs |      135 µs |    227 µs |
| transaction: begin; insert; commit                            |  **122 µs** |  132 µs |      127 µs |    152 µs |      152 µs |    339 µs |
| transaction with 5 savepoints (select 1 in each)              |      906 µs |  563 µs |      667 µs |    680 µs |  **548 µs** |   2.38 ms |
| query that fails (division by zero), connection reused        | **63.6 µs** | 3.20 ms |     3.64 ms |   6.05 ms |      107 µs |   4.13 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler | **75.3 µs** | 90.5 µs |     87.6 µs |   83.0 µs |     80.6 µs |    343 µs |

**Node 24: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) |   pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ----------: | ----------: | --------: |
| select 1                                                      |      397 µs |  419 µs |      401 µs |  **239 µs** |      293 µs |    670 µs |
| point lookup by primary key                                   |      474 µs |  544 µs |      523 µs |      425 µs |  **384 µs** |    808 µs |
| range scan, 100 rows                                          |      788 µs |  913 µs |      898 µs |  **637 µs** |     7.78 ms |   1.16 ms |
| fetch 1k rows (6 columns)                                     | **2.30 ms** | 2.43 ms |     2.73 ms |     3.45 ms |    13.09 ms |   3.38 ms |
| 100 parameters (id in (…)), 100 rows                          |     1.18 ms | 1.50 ms |     1.39 ms | **1.15 ms** |     3.67 ms |   1.98 ms |
| 1000 parameters (id in (…)), 1000 rows                        |     4.46 ms | 4.65 ms | **3.68 ms** |     4.73 ms |     8.34 ms |   4.31 ms |
| insert one row                                                |      474 µs |  457 µs |      464 µs |      434 µs |  **280 µs** |    679 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **750 µs** | 1.36 ms |     1.37 ms |      755 µs |     2.21 ms |   1.61 ms |
| update one row by primary key                                 |      500 µs |  509 µs |      454 µs |      466 µs |  **345 µs** |    861 µs |
| upsert (insert … on conflict do update)                       |      544 µs |  534 µs |      501 µs |      433 µs |  **410 µs** |    829 µs |
| delete one row by primary key                                 |      443 µs |  500 µs |      430 µs |      420 µs |  **353 µs** |    804 µs |
| transaction: begin; select 1; commit                          |      640 µs |  810 µs |      963 µs |  **503 µs** |      973 µs |   2.07 ms |
| transaction: begin; insert; commit                            |      704 µs | 1.05 ms |  **676 µs** |      815 µs |      857 µs |   2.05 ms |
| transaction with 5 savepoints (select 1 in each)              | **1.77 ms** | 3.19 ms |     3.21 ms |     2.97 ms |     6.00 ms |   5.45 ms |
| query that fails (division by zero), connection reused        |  **447 µs** | 3.79 ms |     4.14 ms |     6.32 ms |      620 µs |   6.20 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler |      527 µs |  552 µs |      534 µs |  **441 µs** |      689 µs |    929 µs |

**Node 24: latency distribution, select 1**

| Percentile |          quarry |            pg |   pg (named) |       pg-native |  postgres.js |    neon (WS) |
| ---------- | --------------: | ------------: | -----------: | --------------: | -----------: | -----------: |
| p50        | **23.1 µs ±1%** |   26.2 µs ±2% |  26.1 µs ±1% |    31.2 µs ±42% |  28.3 µs ±2% | 47.0 µs ±73% |
| p90        | **26.3 µs ±8%** |   29.3 µs ±5% | 28.7 µs ±15% |    35.9 µs ±33% | 31.3 µs ±22% | 58.8 µs ±59% |
| p99        | **41.1 µs ±5%** |  45.3 µs ±11% |  47.0 µs ±5% |    47.1 µs ±32% | 45.1 µs ±23% |  114 µs ±61% |
| p99.9      |      397 µs ±5% |    419 µs ±7% |   401 µs ±6% | **239 µs ±32%** |  293 µs ±23% |  670 µs ±67% |
| max        |    1.94 ms ±47% | 2.52 ms ±223% | 2.92 ms ±38% | **730 µs ±78%** | 4.72 ms ±46% | 3.07 ms ±31% |

**Node 24: latency distribution, point lookup by primary key**

| Percentile |           quarry |           pg |       pg (named) |    pg-native |     postgres.js |    neon (WS) |
| ---------- | ---------------: | -----------: | ---------------: | -----------: | --------------: | -----------: |
| p50        |  **29.3 µs ±2%** |  48.0 µs ±6% |      36.5 µs ±3% |  51.2 µs ±1% |     34.5 µs ±5% | 84.1 µs ±36% |
| p90        |  **33.0 µs ±9%** | 59.2 µs ±12% |     43.8 µs ±12% |  58.1 µs ±5% |    40.6 µs ±10% |  101 µs ±25% |
| p99        | **48.7 µs ±29%** | 85.3 µs ±18% |     69.6 µs ±31% | 74.9 µs ±10% |    61.6 µs ±15% |  227 µs ±37% |
| p99.9      |      474 µs ±12% |   544 µs ±8% |       523 µs ±6% |  425 µs ±15% | **384 µs ±22%** |  808 µs ±15% |
| max        |    2.94 ms ±217% | 3.45 ms ±39% | **2.87 ms ±70%** | 3.82 ms ±44% |    6.57 ms ±39% | 3.73 ms ±44% |

**Node 24: large results and bulk work, time per operation (median)**

| Scenario                                                                    |            quarry |           pg |   pg (named) |        pg-native |   postgres.js |     neon (WS) |
| --------------------------------------------------------------------------- | ----------------: | -----------: | -----------: | ---------------: | ------------: | ------------: |
| fetch 100k rows                                                             | **44.21 ms ±14%** |   134 ms ±4% |   135 ms ±4% |      150 ms ±11% |    105 ms ±5% |    149 ms ±9% |
| fetch 1M rows (one result)                                                  |   **603 ms ±12%** |  1395 ms ±4% |  1407 ms ±4% |      1526 ms ±4% |   1135 ms ±4% |   1561 ms ±8% |
| wide rows: 1k rows × 100 columns                                            |   **4.57 ms ±2%** | 15.54 ms ±5% | 14.93 ms ±3% |     21.71 ms ±3% |  15.84 ms ±4% |  18.07 ms ±9% |
| large values: 10 × 1 MB text                                                |   **4.84 ms ±4%** |  5.83 ms ±4% | 5.79 ms ±13% |     12.64 ms ±7% |  5.03 ms ±10% | 10.07 ms ±15% |
| large values: 10 × 1 MB bytea                                               |  **3.97 ms ±14%** | 18.38 ms ±6% | 17.84 ms ±2% |     35.30 ms ±8% |  16.95 ms ±5% |  26.26 ms ±6% |
| large values: 20 × 200 KB jsonb                                             |  **25.42 ms ±4%** | 25.46 ms ±1% | 25.71 ms ±9% |    39.84 ms ±12% |  26.30 ms ±4% | 29.42 ms ±12% |
| arrays: 1k rows of int4[100] + text[20]                                     |  **7.49 ms ±27%** | 24.31 ms ±2% | 24.48 ms ±4% |     28.19 ms ±5% |   8.96 ms ±4% |  25.95 ms ±5% |
| bulk insert 10k rows (unnest arrays)                                        |      13.61 ms ±5% | 13.47 ms ±6% | 13.64 ms ±2% | **13.32 ms ±1%** |  13.38 ms ±2% | 13.84 ms ±16% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |  **12.90 ms ±3%** | 13.37 ms ±5% | 12.93 ms ±2% |              n/a | 55.98 ms ±<1% |           n/a |
| stream 1M rows with a cursor (1000 per batch)                               |    **838 ms ±5%** |  1331 ms ±3% |  1348 ms ±7% |              n/a |   1145 ms ±4% |           n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |    **427 ms ±3%** |   737 ms ±3% |   730 ms ±2% |              n/a |    709 ms ±4% |           n/a |

**Node 24: rows per second (median)**

| Scenario                                      |        quarry |      pg |  pg (named) |   pg-native | postgres.js | neon (WS) |
| --------------------------------------------- | ------------: | ------: | ----------: | ----------: | ----------: | --------: |
| fetch 1k rows (6 columns)                     | **2,283,565** | 758,386 |     757,113 |     612,280 |     834,363 |   628,938 |
| fetch 100k rows                               | **2,144,347** | 737,404 |     735,957 |     655,801 |     936,195 |   654,872 |
| fetch 1M rows (one result)                    | **1,679,969** | 720,157 |     713,187 |     654,213 |     887,305 |   635,539 |
| wide rows: 1k rows × 100 columns              |   **211,248** |  61,650 |      63,405 |      44,208 |      53,741 |    52,617 |
| arrays: 1k rows of int4[100] + text[20]       |   **126,825** |  38,656 |      38,960 |      34,671 |      98,480 |    36,429 |
| stream 1M rows with a cursor (1000 per batch) | **1,178,937** | 751,559 |     740,336 |         n/a |     873,791 |       n/a |
| bulk insert 10k rows (unnest arrays)          |       732,315 | 724,755 |     730,185 | **747,985** |     742,089 |   715,439 |
| bulk insert 10k rows (COPY FROM STDIN, text)  |       765,560 | 747,351 | **767,118** |         n/a |     178,598 |       n/a |

**Node 24: peak RSS (MB) during the scenario**

| Scenario                                                                    |  quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------------------------------------- | ------: | ----: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key                                                 |     107 |   106 |        106 |       105 |         154 |   **104** |
| fetch 100k rows                                                             | **478** |   541 |        541 |       526 |         515 |       571 |
| fetch 1M rows (one result)                                                  |   1,916 | 1,369 |      1,368 |     1,665 |   **1,120** |     1,397 |
| stream 1M rows with a cursor (1000 per batch)                               | **158** |   211 |        210 |       n/a |         246 |       n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |     188 |   120 |    **120** |       n/a |         229 |       n/a |
| large values: 10 × 1 MB text                                                |     195 |   205 |        208 |       281 |     **194** |       235 |
| large values: 10 × 1 MB bytea                                               |     195 |   212 |        210 |       242 |     **192** |       237 |
| large values: 20 × 200 KB jsonb                                             |     367 |   318 |        304 |   **261** |         387 |       347 |

**Node 24: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |  quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------------------- | ------: | ------: | ---------: | --------: | ----------: | --------: |
| RSS growth during pause | **0.0** | **0.0** |    **0.0** |       n/a |     **0.0** |       n/a |

**Node 24: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry | quarry (lossless) |           pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------- | -----------: | ----------------: | -----------: | ---------: | --------: | ----------: | --------: |
| int4                 |  **80 ±11%** |            84 ±5% |      200 ±6% |    206 ±8% |   204 ±3% |     293 ±5% |   326 ±8% |
| int8                 |  **137 ±8%** |           186 ±7% |      241 ±4% |    242 ±2% |   226 ±2% |     273 ±7% |   370 ±9% |
| float8               |     129 ±15% |      **121 ±19%** |     218 ±27% |   220 ±12% |   236 ±2% |     318 ±5% |  362 ±10% |
| numeric              |     183 ±10% |           188 ±3% | **180 ±23%** |    181 ±5% |   243 ±3% |     274 ±9% |   307 ±8% |
| text                 |  **137 ±9%** |          150 ±20% |      182 ±8% |    185 ±7% |   208 ±2% |     266 ±8% |  296 ±10% |
| bool                 |      89 ±12% |        **86 ±2%** |     152 ±14% |    156 ±5% |  171 ±10% |     241 ±9% |  244 ±19% |
| timestamptz          | **160 ±21%** |           185 ±4% |      700 ±5% |    695 ±5% |   763 ±4% |     481 ±6% |   820 ±7% |
| date                 | **141 ±11%** |          148 ±22% |      522 ±4% |    518 ±3% |  461 ±19% |     385 ±6% |   625 ±6% |
| uuid                 |     161 ±10% |      **155 ±13%** |      199 ±9% |    205 ±8% |   235 ±4% |     275 ±2% |   294 ±8% |
| jsonb (small object) |      474 ±5% |           465 ±6% |  **442 ±8%** |   447 ±29% |   573 ±3% |     544 ±4% |   660 ±9% |
| int4[5]              | **610 ±10%** |          614 ±14% |    1,414 ±4% | 1,386 ±16% | 1,449 ±3% |     680 ±5% | 1,910 ±6% |
| bytea (16 B)         |  **237 ±5%** |           242 ±3% |      402 ±6% |    414 ±2% |   420 ±9% |     416 ±4% |   527 ±2% |

**Node 24: writes, operations/s (bulk rows: batches of 10k rows per second)**

| Scenario                                     |           quarry |          pg |   pg (named) |    pg-native | postgres.js |   neon (WS) |
| -------------------------------------------- | ---------------: | ----------: | -----------: | -----------: | ----------: | ----------: |
| insert one row                               |   **32,908 ±2%** |  24,042 ±1% |   30,467 ±4% |   20,895 ±8% |  27,576 ±6% |  12,541 ±7% |
| insert one row, concurrency 50               | **199,905 ±10%** |  81,068 ±8% |  73,540 ±10% |  70,651 ±12% |  40,256 ±7% | 30,773 ±38% |
| multi-row insert: 100 rows, 300 parameters   |    **4,404 ±5%** |   3,019 ±4% |    4,161 ±5% |    3,029 ±5% |   2,769 ±5% |   2,842 ±5% |
| bulk insert 10k rows (unnest arrays)         |         73.2 ±5% |    72.5 ±9% |     73.0 ±2% | **74.8 ±3%** |    74.2 ±4% |   71.5 ±14% |
| bulk insert 10k rows (COPY FROM STDIN, text) |         76.6 ±8% |    74.7 ±5% | **76.7 ±2%** |          n/a |    17.9 ±1% |         n/a |
| update one row by primary key                |   **28,282 ±2%** |  20,211 ±8% |  27,059 ±11% |   18,222 ±2% |  25,263 ±2% |  8,040 ±43% |
| upsert (insert … on conflict do update)      |   **26,568 ±7%** |  21,057 ±2% |   26,065 ±7% |   18,700 ±5% | 24,222 ±10% |  11,557 ±5% |
| delete one row by primary key                |   **33,029 ±8%** | 23,404 ±23% |   31,027 ±5% |   21,682 ±4% |  29,396 ±5% | 12,320 ±32% |

**Node 24: transactions, operations/s**

| Scenario                                         |         quarry |         pg | pg (named) |  pg-native |   postgres.js |  neon (WS) |
| ------------------------------------------------ | -------------: | ---------: | ---------: | ---------: | ------------: | ---------: |
| transaction: begin; select 1; commit             | **14,226 ±4%** | 13,482 ±8% | 13,519 ±1% | 11,277 ±3% |    11,029 ±3% | 7,108 ±38% |
| transaction: begin; insert; commit               | **13,311 ±8%** | 11,332 ±5% | 12,647 ±6% | 9,472 ±14% |     9,947 ±6% | 6,103 ±39% |
| transaction with 5 savepoints (select 1 in each) |      2,539 ±7% |  2,463 ±6% |  2,372 ±5% |  1,994 ±5% | **2,716 ±7%** |  1,288 ±2% |

**Node 24: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | --------: | ----------: | --------: |
| select 1                                               |   **17.2** |    17.8 |       20.1 |      20.9 |        23.3 |      28.5 |
| point lookup by primary key                            |   **18.5** |    28.0 |       27.8 |      27.5 |        28.7 |      59.4 |
| fetch 1k rows (6 columns)                              |    **452** |   1,215 |      1,221 |     1,271 |       1,313 |     1,366 |
| fetch 100k rows                                        | **65,364** | 176,405 |    176,887 |   170,557 |     140,085 |   196,739 |
| insert one row                                         |   **17.6** |    19.2 |       20.0 |      24.2 |        26.4 |      50.9 |
| insert one row, concurrency 50                         |    **5.5** |    13.1 |       14.6 |      14.8 |        29.4 |      33.8 |
| transaction: begin; insert; commit                     |   **47.2** |    52.7 |       53.2 |      62.7 |        86.0 |      95.7 |
| query that fails (division by zero), connection reused |   **31.5** |     579 |        609 |     1,324 |        60.6 |     1,083 |

**Node 24: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------ | -------: | ---: | ---------: | --------: | ----------: | --------: |
| select 1                             |  **9.4** | 11.8 |        9.6 |      15.2 |        11.7 |      12.7 |
| point lookup by primary key          | **15.3** | 28.4 |       15.6 |      32.0 |        15.9 |      40.7 |
| fetch 1k rows (6 columns)            |  **243** |  421 |        390 |       491 |         397 |       461 |
| 100 parameters (id in (…)), 100 rows |  **192** |  251 |        205 |       258 |         193 |       272 |
| insert one row                       |     14.2 | 24.2 |   **14.2** |      29.0 |        14.3 |      35.7 |
| insert one row, concurrency 50       | **12.2** | 35.0 |       19.1 |      42.3 |        18.8 |      44.1 |
| transaction: begin; insert; commit   | **30.5** | 42.5 |       31.6 |      53.5 |        31.5 |      52.0 |

**Node 24: GC time (ms per second of run) / longest GC pause**

| Scenario                                       |  quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ---------------------------------------------- | ------: | ------: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: GC ms/s           |    19.0 |    18.3 |       24.9 |   **9.8** |        26.6 |      17.4 |
| point lookup by primary key: max pause ms      |     0.9 |     0.7 |        0.7 |   **0.4** |         5.8 |       0.6 |
| insert one row, concurrency 50: GC ms/s        |    40.3 |    28.3 |       29.1 |  **19.9** |        27.6 |      20.4 |
| insert one row, concurrency 50: max pause ms   |     2.1 |     1.3 |        1.4 |   **1.2** |         7.5 |       2.0 |
| fetch 1k rows (6 columns): GC ms/s             |    42.1 |    16.9 |       17.4 |  **12.8** |        97.8 |      21.7 |
| fetch 1k rows (6 columns): max pause ms        |     2.1 | **0.7** |        0.8 |       1.3 |        10.7 |       0.8 |
| fetch 100k rows: GC ms/s                       |   177.0 |   146.1 |      150.2 |  **93.6** |       147.8 |     145.8 |
| fetch 100k rows: max pause ms                  |    14.7 |    16.9 |       16.1 |      15.4 |        16.5 |  **13.1** |
| fetch 1M rows (one result): GC ms/s            |   207.0 |   174.7 |      184.1 |  **88.6** |       182.6 |     174.6 |
| fetch 1M rows (one result): max pause ms       |    21.5 |    22.5 |       23.1 |      17.7 |        27.5 |  **17.6** |
| wide rows: 1k rows × 100 columns: GC ms/s      |    28.5 |    28.2 |       27.8 |  **18.4** |       141.3 |      53.4 |
| wide rows: 1k rows × 100 columns: max pause ms | **1.6** |     4.3 |        4.0 |       3.6 |        10.6 |       4.0 |
| large values: 20 × 200 KB jsonb: GC ms/s       |    30.9 |    34.8 |       31.8 |  **14.0** |        29.6 |      46.6 |
| large values: 20 × 200 KB jsonb: max pause ms  |     6.8 |     7.3 |        6.6 |   **4.9** |         7.3 |       7.1 |

**Node 24: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |   quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | -------: | ------: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: p99                   |      0.3 |     0.3 |        0.2 |   **0.1** |         1.9 |       0.4 |
| point lookup by primary key: max                   |      0.5 |     0.6 |    **0.3** |       0.4 |         2.1 |       0.4 |
| insert one row, concurrency 50: p99                |      0.8 |     0.4 |        0.3 |   **0.2** |         5.3 |       0.4 |
| insert one row, concurrency 50: max                |      0.9 |     0.7 |        0.6 |   **0.4** |         5.3 |       0.6 |
| fetch 1k rows (6 columns): p99                     |      0.9 | **0.5** |        0.8 |       1.1 |         8.5 |       1.5 |
| fetch 1k rows (6 columns): max                     |      1.2 | **0.6** |        1.0 |       1.1 |         8.5 |       1.5 |
| fetch 100k rows: p99                               | **17.8** |    41.5 |       41.6 |     121.4 |        26.9 |      46.5 |
| fetch 100k rows: max                               | **20.1** |    41.5 |       41.6 |     121.4 |        26.9 |      46.5 |
| fetch 1M rows (one result): p99                    | **27.1** |    35.1 |       34.6 |   1,206.3 |        39.0 |      41.0 |
| fetch 1M rows (one result): max                    | **34.4** |    37.0 |       37.5 |   1,208.4 |        56.2 |      73.5 |
| stream 1M rows with a cursor (1000 per batch): p99 |  **0.8** |     0.9 |        0.9 |       n/a |         7.1 |       n/a |
| stream 1M rows with a cursor (1000 per batch): max |      1.8 | **1.8** |        1.8 |       n/a |         7.9 |       n/a |

**Node 24: connections (median time per operation)**

| Scenario                                                    |       quarry |              pg |      pg (named) |     pg-native |  postgres.js |       neon (WS) |
| ----------------------------------------------------------- | -----------: | --------------: | --------------: | ------------: | -----------: | --------------: |
| connect + select 1 + close (no TLS, trust)                  | 4.02 ms ±10% |     4.03 ms ±7% | **4.01 ms ±8%** |   4.87 ms ±8% |  7.10 ms ±2% |    4.59 ms ±20% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | 5.79 ms ±10% | **5.53 ms ±3%** |     5.56 ms ±6% |   7.62 ms ±4% |  8.14 ms ±3% |    68.95 ms ±3% |
| connect + select 1 + close (TLS verify-full, trust)         |  5.51 ms ±2% |     5.27 ms ±5% |     5.17 ms ±3% |   5.08 ms ±2% | 52.63 ms ±1% | **4.58 ms ±3%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |  7.54 ms ±3% |     6.91 ms ±3% | **6.85 ms ±6%** |   7.78 ms ±2% | 55.91 ms ±5% |    68.26 ms ±5% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     | 9.64 ms ±23% |     8.76 ms ±5% |     8.93 ms ±4% | 13.97 ms ±15% | 15.28 ms ±2% | **8.75 ms ±1%** |

**Node 24: cancellation, notifications, errors**

| Scenario                                      |      quarry |            pg |  pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------- | ----------: | ------------: | ----------: | --------: | ----------: | --------: |
| cancel: time from cancel() to rejection (p50) |     1.69 ms |       1.64 ms | **1.61 ms** |   2.57 ms |     1.66 ms |       n/a |
| cancel: share of queries actually cancelled   |    **100%** |      **100%** |    **100%** |  **100%** |    **100%** |       n/a |
| NOTIFY latency p50                            | **33.5 µs** |       41.7 µs |     37.6 µs |   47.5 µs |     37.0 µs |   77.2 µs |
| NOTIFY latency p99                            | **75.3 µs** |       90.5 µs |     87.6 µs |   83.0 µs |     80.6 µs |    343 µs |
| NOTIFY throughput (notifications/s)           |   1,704,040 | **1,969,964** |   1,916,935 |   817,894 |   1,676,654 | 1,646,185 |
| error path: failing queries/s                 |  **25,269** |           415 |         396 |       200 |      14,597 |       350 |

**Node 24: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |              pg-native |            postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ---------------------: | ---------------------: |
| select 1                                | 39,454 / 32,699 / +21% |  35,449 / 35,126 / +1% |  29,867 / 30,006 / -0% |  32,457 / 32,307 / +0% |
| point lookup by primary key             | 31,272 / 18,605 / +68% | 24,689 / 18,660 / +32% | 23,022 / 18,369 / +25% | 26,113 / 13,172 / +98% |
| range scan, 100 rows                    |   9,091 / 5,896 / +54% |    4,903 / 4,783 / +2% |    4,918 / 4,819 / +2% |   5,123 / 4,437 / +15% |
| fetch 1k rows (6 columns)               |  2,284 / 1,132 / +102% |        757 / 758 / -0% |        625 / 612 / +2% |        834 / 813 / +3% |
| 100 parameters (id in (…)), 100 rows    |   3,787 / 2,947 / +28% |   3,221 / 2,788 / +16% |   3,534 / 2,831 / +25% |   3,263 / 2,430 / +34% |
| 1000 parameters (id in (…)), 1000 rows  |       448 / 375 / +19% |       460 / 363 / +27% |       410 / 341 / +20% |       395 / 347 / +14% |
| insert one row                          | 32,908 / 23,404 / +41% | 30,467 / 24,042 / +27% | 26,327 / 20,895 / +26% | 27,576 / 14,073 / +96% |
| upsert (insert … on conflict do update) | 26,568 / 21,051 / +26% | 26,065 / 21,057 / +24% | 23,022 / 18,700 / +23% | 24,222 / 13,506 / +79% |

**Node 24: quarry decoding modes (time per op)**

| Scenario                                |            quarry | quarry (lossless) |
| --------------------------------------- | ----------------: | ----------------: |
| point lookup by primary key             |   **29.3 µs ±2%** |       29.6 µs ±5% |
| fetch 1k rows (6 columns)               |   **389 µs ±14%** |        392 µs ±1% |
| fetch 100k rows                         | **44.21 ms ±14%** |      44.42 ms ±4% |
| fetch 1M rows (one result)              |       603 ms ±12% |    **559 ms ±4%** |
| wide rows: 1k rows × 100 columns        |   **4.57 ms ±2%** |       4.59 ms ±1% |
| arrays: 1k rows of int4[100] + text[20] |      7.49 ms ±27% |   **7.25 ms ±5%** |
| decode 100k × int8                      |  **13.66 ms ±8%** |      18.57 ms ±7% |
| decode 100k × timestamptz               | **16.04 ms ±21%** |      18.45 ms ±4% |
| decode 100k × date                      | **14.06 ms ±11%** |     14.75 ms ±22% |

**Node 24: shipped defaults vs tuned (median latency)**

| Scenario                                   |   neon (WS) | neon (WS, defaults) |
| ------------------------------------------ | ----------: | ------------------: |
| select 1                                   | **47.0 µs** |             1.54 ms |
| point lookup by primary key                | **84.1 µs** |             1.67 ms |
| fetch 1k rows (6 columns)                  | **1.55 ms** |             3.16 ms |
| insert one row                             | **72.2 µs** |             1.66 ms |
| transaction: begin; insert; commit         |  **152 µs** |             4.65 ms |
| connect + select 1 + close (no TLS, trust) |     4.59 ms |                   — |

## Bun 1.4

**Bun 1.4: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |          quarry |           pg |      pg (named) |    postgres.js |         Bun.sql |
| ------------------------------------------------------------- | --------------: | -----------: | --------------: | -------------: | --------------: |
| select 1                                                      | **20.8 µs ±4%** |  22.7 µs ±6% |     21.7 µs ±2% |    24.2 µs ±2% |     24.6 µs ±4% |
| point lookup by primary key                                   | **26.9 µs ±1%** |  42.2 µs ±5% |     29.3 µs ±2% |    28.8 µs ±2% |     29.1 µs ±5% |
| range scan, 100 rows                                          | **86.0 µs ±2%** |   143 µs ±1% |      140 µs ±6% |     135 µs ±1% |     91.4 µs ±1% |
| fetch 1k rows (6 columns)                                     |  **279 µs ±3%** |  924 µs ±14% |      926 µs ±9% |     808 µs ±2% |     387 µs ±13% |
| 100 parameters (id in (…)), 100 rows                          | **222 µs ±22%** |   303 µs ±8% |     237 µs ±11% |     241 µs ±8% |      222 µs ±3% |
| 1000 parameters (id in (…)), 1000 rows                        |     2.01 ms ±4% |  2.57 ms ±6% |     2.03 ms ±6% |    2.03 ms ±6% | **1.89 ms ±3%** |
| insert one row                                                | **26.0 µs ±2%** |  35.4 µs ±2% |     26.1 µs ±8% |    27.7 µs ±3% |     28.4 µs ±2% |
| multi-row insert: 100 rows, 300 parameters                    |      198 µs ±3% |   295 µs ±4% |      207 µs ±1% |     237 µs ±2% |  **193 µs ±3%** |
| update one row by primary key                                 |     30.7 µs ±2% |  42.5 µs ±2% | **30.7 µs ±1%** |    31.6 µs ±1% |     32.5 µs ±2% |
| upsert (insert … on conflict do update)                       | **31.2 µs ±3%** |  41.0 µs ±1% |     31.5 µs ±3% |    32.4 µs ±1% |     33.3 µs ±2% |
| delete one row by primary key                                 | **25.1 µs ±4%** |  34.9 µs ±2% |     25.6 µs ±1% |    26.6 µs ±2% |     28.0 µs ±6% |
| transaction: begin; select 1; commit                          |     58.9 µs ±2% |  59.2 µs ±3% | **58.4 µs ±2%** |    68.1 µs ±3% |    74.4 µs ±15% |
| transaction: begin; insert; commit                            |     64.3 µs ±2% |  73.4 µs ±3% | **63.4 µs ±3%** |    71.2 µs ±3% |     78.9 µs ±8% |
| transaction with 5 savepoints (select 1 in each)              |      334 µs ±6% |   334 µs ±2% |      331 µs ±1% | **288 µs ±3%** |     440 µs ±34% |
| query that fails (division by zero), connection reused        |     32.1 µs ±3% | 2.35 ms ±11% |    2.37 ms ±11% |    37.7 µs ±1% | **28.6 µs ±3%** |
| LISTEN/NOTIFY latency: notify on another connection → handler | **29.8 µs ±1%** |  35.6 µs ±1% |     31.0 µs ±2% |    32.1 µs ±4% |     33.5 µs ±2% |

**Bun 1.4: throughput, sequential (operations/s)**

| Scenario                                                      |         quarry |             pg |      pg (named) |   postgres.js |        Bun.sql |
| ------------------------------------------------------------- | -------------: | -------------: | --------------: | ------------: | -------------: |
| select 1                                                      | **45,365 ±7%** |     41,622 ±5% |      44,025 ±4% |    38,909 ±3% |    38,786 ±13% |
| point lookup by primary key                                   | **35,169 ±4%** |     21,970 ±3% |      32,289 ±3% |    32,568 ±2% |    33,505 ±16% |
| range scan, 100 rows                                          | **10,933 ±5%** |      6,492 ±5% |       6,522 ±9% |     6,969 ±6% |     10,382 ±2% |
| fetch 1k rows (6 columns)                                     | **3,205 ±13%** |       981 ±19% |         991 ±9% |    1,123 ±11% |      2,473 ±8% |
| 100 parameters (id in (…)), 100 rows                          |     4,350 ±22% |      3,145 ±8% |      4,079 ±12% |    3,978 ±12% |  **4,425 ±9%** |
| 1000 parameters (id in (…)), 1000 rows                        |        477 ±6% |        376 ±5% |         485 ±8% |       481 ±6% |    **525 ±4%** |
| insert one row                                                |     35,757 ±4% |     26,779 ±2% | **36,453 ±11%** |    34,065 ±7% |     33,079 ±3% |
| multi-row insert: 100 rows, 300 parameters                    |      4,635 ±5% |      3,186 ±6% |       4,499 ±3% |     4,021 ±3% |  **4,947 ±4%** |
| update one row by primary key                                 |    30,642 ±11% |     22,343 ±6% |  **31,143 ±3%** |    30,158 ±4% |     29,456 ±6% |
| upsert (insert … on conflict do update)                       | **30,168 ±4%** |     23,074 ±3% |      30,023 ±4% |    29,373 ±1% |     28,838 ±4% |
| delete one row by primary key                                 | **37,370 ±5%** |     26,456 ±4% |      36,851 ±3% |    34,900 ±4% |     33,489 ±6% |
| transaction: begin; select 1; commit                          |    16,044 ±17% | **16,065 ±3%** |      15,993 ±3% |    13,994 ±7% |    12,081 ±19% |
| transaction: begin; insert; commit                            |     14,638 ±3% |     12,709 ±3% |  **15,055 ±5%** |    13,256 ±7% |     10,866 ±9% |
| transaction with 5 savepoints (select 1 in each)              |      2,839 ±5% |      2,873 ±3% |       2,913 ±1% | **3,289 ±7%** |     1,967 ±11% |
| query that fails (division by zero), connection reused        |     28,943 ±4% |        413 ±9% |         413 ±9% |    23,945 ±2% | **32,765 ±4%** |
| LISTEN/NOTIFY latency: notify on another connection → handler | **31,576 ±2%** |     26,172 ±2% |      30,408 ±5% |    29,130 ±8% |     28,514 ±2% |

**Bun 1.4: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ----------: | ----------: |
| select 1                                                      | **29.0 µs** | 32.8 µs |     29.7 µs |     36.0 µs |     34.6 µs |
| point lookup by primary key                                   | **38.2 µs** | 65.9 µs |     42.5 µs |     43.2 µs |     39.4 µs |
| range scan, 100 rows                                          |      181 µs |  458 µs |      444 µs |      440 µs |  **145 µs** |
| fetch 1k rows (6 columns)                                     |      752 µs | 1.71 ms |     1.57 ms |     1.57 ms |  **734 µs** |
| 100 parameters (id in (…)), 100 rows                          |      326 µs |  582 µs |      431 µs |      538 µs |  **285 µs** |
| 1000 parameters (id in (…)), 1000 rows                        |     2.84 ms | 3.52 ms |     2.62 ms |     2.87 ms | **2.19 ms** |
| insert one row                                                |     46.0 µs | 54.8 µs | **41.9 µs** |     45.6 µs |     45.1 µs |
| multi-row insert: 100 rows, 300 parameters                    |      395 µs |  560 µs |      408 µs |      505 µs |  **283 µs** |
| update one row by primary key                                 |     45.3 µs | 66.1 µs | **45.0 µs** |     47.0 µs |     47.3 µs |
| upsert (insert … on conflict do update)                       |     47.0 µs | 62.0 µs | **46.2 µs** |     46.8 µs |     47.0 µs |
| delete one row by primary key                                 | **35.9 µs** | 55.7 µs |     40.2 µs |     40.2 µs |     43.3 µs |
| transaction: begin; select 1; commit                          |     86.7 µs | 85.7 µs | **85.3 µs** |     94.8 µs |      311 µs |
| transaction: begin; insert; commit                            |     99.0 µs |  117 µs | **96.6 µs** |      108 µs |      352 µs |
| transaction with 5 savepoints (select 1 in each)              |      673 µs |  643 µs |  **642 µs** |      780 µs |     1.10 ms |
| query that fails (division by zero), connection reused        |     46.0 µs | 3.24 ms |     3.05 ms |     58.7 µs | **44.2 µs** |
| LISTEN/NOTIFY latency: notify on another connection → handler | **49.8 µs** | 62.2 µs |     54.0 µs |     54.4 µs |     50.9 µs |

**Bun 1.4: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ----------: | ----------: |
| select 1                                                      | **66.0 µs** |  190 µs |      251 µs |      335 µs |      161 µs |
| point lookup by primary key                                   |      216 µs |  405 µs |      417 µs |      382 µs |  **175 µs** |
| range scan, 100 rows                                          |      535 µs |  695 µs |      717 µs |      612 µs |  **379 µs** |
| fetch 1k rows (6 columns)                                     |     2.02 ms | 3.09 ms |     3.01 ms |     2.67 ms | **1.09 ms** |
| 100 parameters (id in (…)), 100 rows                          |      956 µs | 1.06 ms |      729 µs |      793 µs |  **506 µs** |
| 1000 parameters (id in (…)), 1000 rows                        |     3.62 ms | 3.91 ms |     2.92 ms |     3.28 ms | **2.69 ms** |
| insert one row                                                |      281 µs |  366 µs |      248 µs |      241 µs |  **205 µs** |
| multi-row insert: 100 rows, 300 parameters                    |      928 µs |  783 µs |      714 µs |      688 µs |  **502 µs** |
| update one row by primary key                                 |      208 µs |  336 µs |      301 µs |      326 µs |  **195 µs** |
| upsert (insert … on conflict do update)                       |      191 µs |  357 µs |      325 µs |      280 µs |  **177 µs** |
| delete one row by primary key                                 |  **118 µs** |  452 µs |      286 µs |      288 µs |      203 µs |
| transaction: begin; select 1; commit                          |      729 µs |  479 µs |      464 µs |      539 µs |  **462 µs** |
| transaction: begin; insert; commit                            |      787 µs |  519 µs |  **509 µs** |      569 µs |      696 µs |
| transaction with 5 savepoints (select 1 in each)              |     1.69 ms | 1.26 ms | **1.10 ms** |     1.46 ms |     1.85 ms |
| query that fails (division by zero), connection reused        |      315 µs | 3.61 ms |     3.47 ms |      489 µs |  **202 µs** |
| LISTEN/NOTIFY latency: notify on another connection → handler |      436 µs |  473 µs |      413 µs |      476 µs |  **284 µs** |

**Bun 1.4: latency distribution, select 1**

| Percentile |            quarry |          pg |    pg (named) |   postgres.js |          Bun.sql |
| ---------- | ----------------: | ----------: | ------------: | ------------: | ---------------: |
| p50        |   **20.8 µs ±4%** | 22.7 µs ±6% |   21.7 µs ±2% |   24.2 µs ±2% |      24.6 µs ±4% |
| p90        |  **23.4 µs ±11%** | 26.4 µs ±8% |   23.7 µs ±6% |   27.9 µs ±4% |     27.7 µs ±35% |
| p99        |  **29.0 µs ±26%** | 32.8 µs ±8% |   29.7 µs ±7% |   36.0 µs ±7% |     34.6 µs ±33% |
| p99.9      | **66.0 µs ±122%** | 190 µs ±57% |   251 µs ±52% |   335 µs ±71% |      161 µs ±21% |
| max        |     1.90 ms ±180% | 864 µs ±20% | 2.87 ms ±122% | 1.23 ms ±290% | **575 µs ±935%** |

**Bun 1.4: latency distribution, point lookup by primary key**

| Percentile |           quarry |           pg |   pg (named) |  postgres.js |          Bun.sql |
| ---------- | ---------------: | -----------: | -----------: | -----------: | ---------------: |
| p50        |  **26.9 µs ±1%** |  42.2 µs ±5% |  29.3 µs ±2% |  28.8 µs ±2% |      29.1 µs ±5% |
| p90        | **30.4 µs ±13%** |  51.4 µs ±8% |  33.6 µs ±5% |  33.0 µs ±6% |     30.7 µs ±46% |
| p99        | **38.2 µs ±18%** | 65.9 µs ±22% | 42.5 µs ±18% | 43.2 µs ±10% |     39.4 µs ±40% |
| p99.9      |     216 µs ±104% |  405 µs ±22% |   417 µs ±7% |  382 µs ±66% |  **175 µs ±44%** |
| max        |    1.56 ms ±212% | 2.17 ms ±73% | 1.11 ms ±36% | 1.88 ms ±96% | **638 µs ±130%** |

**Bun 1.4: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |               pg |   pg (named) |   postgres.js |          Bun.sql |
| --------------------------------------------------------------------------- | ---------------: | ---------------: | -----------: | ------------: | ---------------: |
| fetch 100k rows                                                             | **26.85 ms ±5%** |       101 ms ±8% | 99.77 ms ±5% |  89.38 ms ±9% |     33.48 ms ±2% |
| fetch 1M rows (one result)                                                  |   **323 ms ±7%** |       952 ms ±7% |   969 ms ±6% |  1080 ms ±10% |       374 ms ±3% |
| wide rows: 1k rows × 100 columns                                            |  **3.61 ms ±3%** |     11.51 ms ±4% | 11.32 ms ±3% |  10.66 ms ±2% |      8.85 ms ±3% |
| large values: 10 × 1 MB text                                                |      5.54 ms ±3% |      5.40 ms ±9% |  5.25 ms ±6% |  5.37 ms ±20% |  **4.66 ms ±6%** |
| large values: 10 × 1 MB bytea                                               |  **4.54 ms ±9%** |    12.49 ms ±14% | 12.33 ms ±7% | 11.87 ms ±11% |     11.21 ms ±5% |
| large values: 20 × 200 KB jsonb                                             | **17.27 ms ±3%** |     17.41 ms ±6% | 17.46 ms ±5% |  17.48 ms ±1% |     17.67 ms ±6% |
| arrays: 1k rows of int4[100] + text[20]                                     |      6.12 ms ±5% |     18.11 ms ±6% | 18.50 ms ±7% |   8.22 ms ±2% |  **4.93 ms ±3%** |
| bulk insert 10k rows (unnest arrays)                                        |     12.94 ms ±6% |     13.21 ms ±5% | 12.97 ms ±4% |  13.23 ms ±2% | **12.77 ms ±4%** |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     12.99 ms ±1% | **12.90 ms ±2%** | 12.92 ms ±5% |  13.05 ms ±4% |              n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **625 ms ±2%** |     1032 ms ±10% |  1053 ms ±5% |    823 ms ±5% |              n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |  **425 ms ±<1%** |       683 ms ±1% |   685 ms ±2% |    667 ms ±2% |              n/a |

**Bun 1.4: rows per second (median)**

| Scenario                                      |        quarry |          pg | pg (named) | postgres.js |     Bun.sql |
| --------------------------------------------- | ------------: | ----------: | ---------: | ----------: | ----------: |
| fetch 1k rows (6 columns)                     | **3,204,568** |     980,761 |    990,581 |   1,122,861 |   2,473,240 |
| fetch 100k rows                               | **3,725,618** |     985,430 |  1,001,888 |   1,130,616 |   2,861,205 |
| fetch 1M rows (one result)                    | **3,091,285** |   1,036,945 |  1,007,794 |     937,043 |   2,632,785 |
| wide rows: 1k rows × 100 columns              |   **274,252** |      86,886 |     86,923 |      93,286 |     110,060 |
| arrays: 1k rows of int4[100] + text[20]       |       161,746 |      54,621 |     53,779 |     122,882 | **194,841** |
| stream 1M rows with a cursor (1000 per batch) | **1,616,275** |     964,798 |    945,600 |   1,208,435 |         n/a |
| bulk insert 10k rows (unnest arrays)          |       756,189 |     754,800 |    755,305 |     751,743 | **772,448** |
| bulk insert 10k rows (COPY FROM STDIN, text)  |       767,216 | **772,704** |    771,208 |     759,486 |         n/a |

**Bun 1.4: peak RSS (MB) during the scenario**

| Scenario                                                                    |  quarry |     pg | pg (named) | postgres.js | Bun.sql |
| --------------------------------------------------------------------------- | ------: | -----: | ---------: | ----------: | ------: |
| point lookup by primary key                                                 |      61 |     63 |         64 |          55 |  **47** |
| fetch 100k rows                                                             |     261 |    329 |        341 |     **178** |     196 |
| fetch 1M rows (one result)                                                  | **986** |  1,269 |      1,267 |       1,004 |   1,076 |
| stream 1M rows with a cursor (1000 per batch)                               |      72 | **67** |         67 |          67 |     n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |      61 |     63 |         64 |      **60** |     n/a |
| large values: 10 × 1 MB text                                                |     155 |    232 |        219 |         175 | **127** |
| large values: 10 × 1 MB bytea                                               |     161 |    243 |        239 |         175 | **120** |
| large values: 20 × 200 KB jsonb                                             |     136 |    190 |        190 |         124 |  **81** |

**Bun 1.4: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |    quarry |    pg | pg (named) | postgres.js | Bun.sql |
| ----------------------- | --------: | ----: | ---------: | ----------: | ------: |
| RSS growth during pause | **-20.9** | -12.5 |      -13.0 |       -15.5 |     n/a |

**Bun 1.4: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |      quarry | quarry (lossless) |       pg | pg (named) | postgres.js |     Bun.sql |
| -------------------- | ----------: | ----------------: | -------: | ---------: | ----------: | ----------: |
| int4                 |  **80 ±1%** |           88 ±10% | 176 ±11% |    184 ±9% |     159 ±6% |     105 ±2% |
| int8                 | **106 ±7%** |           140 ±3% |  197 ±5% |   207 ±10% |     170 ±5% |     124 ±1% |
| float8               |  **85 ±2%** |            85 ±2% |  208 ±9% |   203 ±12% |     178 ±9% |     116 ±7% |
| numeric              | **139 ±4%** |           143 ±2% |  182 ±6% |    176 ±7% |     172 ±2% |     141 ±5% |
| text                 | **110 ±3%** |           113 ±5% | 186 ±13% |   195 ±13% |     169 ±4% |     126 ±6% |
| bool                 |      89 ±3% |        **86 ±5%** |  158 ±8% |   141 ±16% |     140 ±3% |      92 ±4% |
| timestamptz          |  **98 ±5%** |           165 ±1% |  454 ±3% |    457 ±2% |     366 ±6% |    166 ±13% |
| date                 | **116 ±1%** |           117 ±3% |  343 ±7% |    359 ±8% |     266 ±7% |     215 ±3% |
| uuid                 |     134 ±6% |           137 ±3% | 188 ±16% |    190 ±9% |     172 ±4% | **130 ±5%** |
| jsonb (small object) |     334 ±8% |           348 ±5% |  478 ±7% |    422 ±5% |    416 ±11% | **323 ±6%** |
| int4[5]              |     350 ±4% |       **348 ±4%** |  824 ±4% |    840 ±8% |     438 ±3% |     386 ±2% |
| bytea (16 B)         |     144 ±9% |           147 ±9% | 478 ±15% |   486 ±17% |     499 ±5% | **134 ±4%** |

**Bun 1.4: writes, operations/s (bulk rows: batches of 10k rows per second)**

| Scenario                                     |          quarry |           pg |      pg (named) | postgres.js |       Bun.sql |
| -------------------------------------------- | --------------: | -----------: | --------------: | ----------: | ------------: |
| insert one row                               |      35,757 ±4% |   26,779 ±2% | **36,453 ±11%** |  34,065 ±7% |    33,079 ±3% |
| insert one row, concurrency 50               | **232,664 ±2%** |   97,641 ±2% |     106,176 ±2% |  63,952 ±1% |   139,971 ±2% |
| multi-row insert: 100 rows, 300 parameters   |       4,635 ±5% |    3,186 ±6% |       4,499 ±3% |   4,021 ±3% | **4,947 ±4%** |
| bulk insert 10k rows (unnest arrays)         |        75.6 ±6% |     75.5 ±6% |        75.5 ±5% |    75.2 ±3% |  **77.2 ±2%** |
| bulk insert 10k rows (COPY FROM STDIN, text) |        76.7 ±1% | **77.3 ±4%** |        77.1 ±7% |    75.9 ±3% |           n/a |
| update one row by primary key                |     30,642 ±11% |   22,343 ±6% |  **31,143 ±3%** |  30,158 ±4% |    29,456 ±6% |
| upsert (insert … on conflict do update)      |  **30,168 ±4%** |   23,074 ±3% |      30,023 ±4% |  29,373 ±1% |    28,838 ±4% |
| delete one row by primary key                |  **37,370 ±5%** |   26,456 ±4% |      36,851 ±3% |  34,900 ±4% |    33,489 ±6% |

**Bun 1.4: transactions, operations/s**

| Scenario                                         |      quarry |             pg |     pg (named) |   postgres.js |     Bun.sql |
| ------------------------------------------------ | ----------: | -------------: | -------------: | ------------: | ----------: |
| transaction: begin; select 1; commit             | 16,044 ±17% | **16,065 ±3%** |     15,993 ±3% |    13,994 ±7% | 12,081 ±19% |
| transaction: begin; insert; commit               |  14,638 ±3% |     12,709 ±3% | **15,055 ±5%** |    13,256 ±7% |  10,866 ±9% |
| transaction with 5 savepoints (select 1 in each) |   2,839 ±5% |      2,873 ±3% |      2,913 ±1% | **3,289 ±7%** |  1,967 ±11% |

**Bun 1.4: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |       pg | pg (named) | postgres.js |  Bun.sql |
| ------------------------------------------------------ | ---------: | -------: | ---------: | ----------: | -------: |
| select 1                                               |       13.1 | **12.8** |       13.8 |        14.1 |     13.5 |
| point lookup by primary key                            |   **15.4** |     20.9 |       17.8 |        16.8 |     16.7 |
| fetch 1k rows (6 columns)                              |    **296** |      969 |        958 |         844 |      355 |
| fetch 100k rows                                        | **35,276** |  117,418 |    116,077 |     100,199 |   40,080 |
| insert one row                                         |   **14.4** |     16.0 |       14.5 |        16.2 |     16.7 |
| insert one row, concurrency 50                         |    **4.5** |     10.5 |        9.9 |        16.0 |      7.8 |
| transaction: begin; insert; commit                     |   **38.3** |     43.3 |       41.1 |        46.0 |     45.9 |
| query that fails (division by zero), connection reused |       26.1 |      464 |        461 |        31.4 | **18.9** |

**Bun 1.4: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | Bun.sql |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | ------: |
| select 1                             |  **9.3** | 11.9 |        9.7 |        11.9 |    12.1 |
| point lookup by primary key          |     14.8 | 29.6 |       15.2 |    **14.7** |    17.0 |
| fetch 1k rows (6 columns)            |  **245** |  388 |        353 |         378 |     355 |
| 100 parameters (id in (…)), 100 rows |  **188** |  251 |        190 |         189 |     189 |
| insert one row                       |     14.5 | 24.4 |       14.5 |    **14.4** |    17.2 |
| insert one row, concurrency 50       | **12.5** | 32.6 |       18.5 |        16.7 |    14.1 |
| transaction: begin; insert; commit   |     32.2 | 42.0 |       31.2 |    **30.2** |    45.1 |

**Bun 1.4: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |    quarry |    pg | pg (named) | postgres.js | Bun.sql |
| -------------------------------------------------- | --------: | ----: | ---------: | ----------: | ------: |
| point lookup by primary key: p99                   |       0.6 |   0.3 |        0.4 |         0.4 | **0.1** |
| point lookup by primary key: max                   |       0.6 |   0.3 |        0.4 |         0.4 | **0.1** |
| insert one row, concurrency 50: p99                |       0.8 |   0.7 |    **0.6** |         1.0 |     1.6 |
| insert one row, concurrency 50: max                |       0.8 |   0.7 |    **0.6** |         1.0 |     1.6 |
| fetch 1k rows (6 columns): p99                     |       0.5 |   0.9 |        1.4 |         0.7 | **0.1** |
| fetch 1k rows (6 columns): max                     |       0.5 |   0.9 |        1.4 |         0.7 | **0.1** |
| fetch 100k rows: p99                               |  **22.5** | 107.7 |      101.5 |        86.6 |    25.7 |
| fetch 100k rows: max                               |  **25.1** | 107.7 |      101.5 |        86.6 |    32.5 |
| fetch 1M rows (one result): p99                    | **375.4** | 991.5 |      980.3 |     1,077.7 |   419.1 |
| fetch 1M rows (one result): max                    | **375.4** | 991.5 |      980.3 |     1,077.7 |   419.1 |
| stream 1M rows with a cursor (1000 per batch): p99 |       0.8 |   1.1 |        1.1 |     **0.8** |     n/a |
| stream 1M rows with a cursor (1000 per batch): max |       1.8 |   1.5 |        2.0 |     **1.4** |     n/a |

**Bun 1.4: connections (median time per operation)**

| Scenario                                                    |       quarry |          pg |   pg (named) |  postgres.js |          Bun.sql |
| ----------------------------------------------------------- | -----------: | ----------: | -----------: | -----------: | ---------------: |
| connect + select 1 + close (no TLS, trust)                  |  3.99 ms ±1% | 3.98 ms ±1% |  3.99 ms ±1% |  6.76 ms ±3% |  **2.33 ms ±3%** |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          |  5.25 ms ±5% | 5.28 ms ±4% | 5.25 ms ±11% |  7.67 ms ±5% |  **3.07 ms ±2%** |
| connect + select 1 + close (TLS verify-full, trust)         | 4.67 ms ±13% | 4.34 ms ±1% |  4.44 ms ±6% |  7.40 ms ±3% |  **3.76 ms ±6%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |  6.24 ms ±7% | 5.70 ms ±6% |  5.68 ms ±4% |  8.08 ms ±1% |  **4.22 ms ±8%** |
| pool warm-up: new pool (max 10), 10 concurrent select 1     | 9.68 ms ±21% | 8.69 ms ±3% |  8.95 ms ±5% | 15.31 ms ±3% | **7.98 ms ±19%** |

**Bun 1.4: cancellation, notifications, errors**

| Scenario                                      |      quarry |        pg |  pg (named) | postgres.js |       Bun.sql |
| --------------------------------------------- | ----------: | --------: | ----------: | ----------: | ------------: |
| cancel: time from cancel() to rejection (p50) |     1.68 ms |   1.70 ms | **1.63 ms** |     1.69 ms |       2974 ms |
| cancel: share of queries actually cancelled   |    **100%** |  **100%** |    **100%** |    **100%** |            0% |
| NOTIFY latency p50                            | **29.8 µs** |   35.6 µs |     31.0 µs |     32.1 µs |       33.5 µs |
| NOTIFY latency p99                            | **49.8 µs** |   62.2 µs |     54.0 µs |     54.4 µs |       50.9 µs |
| NOTIFY throughput (notifications/s)           |   2,069,210 | 1,990,128 |   1,975,688 |   1,617,962 | **2,498,081** |
| error path: failing queries/s                 |      28,943 |       413 |         413 |      23,945 |    **32,765** |

**Bun 1.4: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |                Bun.sql |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: | ---------------------: |
| select 1                                | 45,365 / 36,585 / +24% |  44,025 / 41,622 / +6% |   38,909 / 39,460 / -1% |  38,786 / 39,386 / -2% |
| point lookup by primary key             | 35,169 / 22,522 / +56% | 32,289 / 21,970 / +47% | 32,568 / 14,945 / +118% | 33,505 / 22,215 / +51% |
| range scan, 100 rows                    |  10,933 / 7,785 / +40% |    6,522 / 6,492 / +0% |    6,969 / 5,629 / +24% |  10,382 / 8,978 / +16% |
| fetch 1k rows (6 columns)               |  3,205 / 1,561 / +105% |        991 / 981 / +1% |     1,123 / 1,053 / +7% |    2,473 / 2,441 / +1% |
| 100 parameters (id in (…)), 100 rows    |   4,350 / 3,200 / +36% |   4,079 / 3,145 / +30% |    3,978 / 2,677 / +49% |   4,425 / 3,299 / +34% |
| 1000 parameters (id in (…)), 1000 rows  |       477 / 376 / +27% |       485 / 376 / +29% |        481 / 356 / +35% |       525 / 434 / +21% |
| insert one row                          | 35,757 / 26,399 / +35% | 36,453 / 26,779 / +36% | 34,065 / 16,938 / +101% | 33,079 / 24,982 / +32% |
| upsert (insert … on conflict do update) | 30,168 / 22,560 / +34% | 30,023 / 23,074 / +30% |  29,373 / 15,210 / +93% | 28,838 / 21,102 / +37% |

**Bun 1.4: quarry decoding modes (time per op)**

| Scenario                                |           quarry | quarry (lossless) |
| --------------------------------------- | ---------------: | ----------------: |
| point lookup by primary key             |      26.9 µs ±1% |   **26.7 µs ±5%** |
| fetch 1k rows (6 columns)               |   **279 µs ±3%** |        341 µs ±3% |
| fetch 100k rows                         | **26.85 ms ±5%** |      32.70 ms ±7% |
| fetch 1M rows (one result)              |   **323 ms ±7%** |       340 ms ±10% |
| wide rows: 1k rows × 100 columns        |  **3.61 ms ±3%** |       3.97 ms ±5% |
| arrays: 1k rows of int4[100] + text[20] |  **6.12 ms ±5%** |       6.26 ms ±6% |
| decode 100k × int8                      | **10.63 ms ±7%** |      14.03 ms ±3% |
| decode 100k × timestamptz               |  **9.81 ms ±5%** |      16.46 ms ±1% |
| decode 100k × date                      | **11.56 ms ±1%** |      11.65 ms ±3% |

## Deno 2.9

**Deno 2.9: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |    postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -------------: | -----------------------: |
| select 1                                                      |  **26.3 µs ±6%** |  29.0 µs ±2% |  29.8 µs ±3% |    31.6 µs ±5% |              37.2 µs ±1% |
| point lookup by primary key                                   |  **33.5 µs ±5%** |  53.0 µs ±1% |  40.0 µs ±8% |    38.9 µs ±3% |              73.0 µs ±2% |
| range scan, 100 rows                                          |   **105 µs ±1%** |   202 µs ±9% |   198 µs ±6% |     166 µs ±1% |               971 µs ±2% |
| fetch 1k rows (6 columns)                                     |  **389 µs ±12%** |  1.44 ms ±7% |  1.39 ms ±5% |    1.04 ms ±4% |              7.27 ms ±4% |
| 100 parameters (id in (…)), 100 rows                          |   **251 µs ±8%** |  349 µs ±15% |  285 µs ±18% |     303 µs ±6% |               836 µs ±9% |
| 1000 parameters (id in (…)), 1000 rows                        |  **2.12 ms ±2%** |  2.95 ms ±6% | 2.47 ms ±14% |    2.61 ms ±6% |              6.66 ms ±3% |
| insert one row                                                | **31.8 µs ±30%** |  43.7 µs ±5% | 34.3 µs ±11% |    37.9 µs ±1% |              55.7 µs ±1% |
| multi-row insert: 100 rows, 300 parameters                    |  **223 µs ±10%** |   373 µs ±1% |   272 µs ±4% |     420 µs ±3% |               447 µs ±3% |
| update one row by primary key                                 |  **36.3 µs ±2%** | 51.3 µs ±28% |  39.2 µs ±4% |    40.8 µs ±2% |              63.6 µs ±3% |
| upsert (insert … on conflict do update)                       |  **37.2 µs ±8%** |  49.5 µs ±8% |  40.1 µs ±3% |    42.3 µs ±4% |              60.6 µs ±1% |
| delete one row by primary key                                 |  **31.3 µs ±8%** |  43.8 µs ±5% |  33.3 µs ±2% |    35.6 µs ±1% |              54.7 µs ±1% |
| transaction: begin; select 1; commit                          |  **74.3 µs ±3%** | 76.3 µs ±48% |  76.8 µs ±2% |    88.8 µs ±2% |              93.9 µs ±6% |
| transaction: begin; insert; commit                            |  **78.2 µs ±1%** |  93.1 µs ±3% |  82.9 µs ±3% |    97.9 µs ±7% |              113 µs ±40% |
| transaction with 5 savepoints (select 1 in each)              |       409 µs ±1% |   417 µs ±2% |   438 µs ±3% | **369 µs ±2%** |               524 µs ±3% |
| query that fails (division by zero), connection reused        |  **37.9 µs ±5%** |  2.40 ms ±7% |  2.48 ms ±3% |    99.5 µs ±1% |              41.6 µs ±4% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **37.7 µs ±1%** | 45.6 µs ±27% |  41.6 µs ±2% |    41.0 µs ±9% |                      n/a |

**Deno 2.9: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) |   postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ------------: | -----------------------: |
| select 1                                                      |  **35,361 ±7%** |  32,148 ±4% |  31,490 ±9% |    28,542 ±3% |               24,088 ±4% |
| point lookup by primary key                                   |  **27,355 ±7%** |  17,934 ±2% |  22,698 ±3% |    23,557 ±6% |               12,595 ±4% |
| range scan, 100 rows                                          |   **8,868 ±3%** |   4,721 ±9% |   4,807 ±4% |     5,223 ±1% |                  968 ±3% |
| fetch 1k rows (6 columns)                                     |  **2,406 ±25%** |     697 ±5% |     710 ±5% |       818 ±2% |                  120 ±2% |
| 100 parameters (id in (…)), 100 rows                          |   **3,776 ±7%** |  2,705 ±13% |  3,257 ±18% |     2,995 ±7% |                1,050 ±8% |
| 1000 parameters (id in (…)), 1000 rows                        |     **465 ±3%** |     333 ±5% |    394 ±12% |       362 ±9% |                  149 ±3% |
| insert one row                                                | **28,922 ±16%** |  20,696 ±3% | 26,612 ±12% |    24,053 ±1% |               16,348 ±2% |
| multi-row insert: 100 rows, 300 parameters                    |   **4,244 ±9%** |   2,564 ±1% |   3,520 ±7% |     2,242 ±3% |                1,800 ±2% |
| update one row by primary key                                 |  **25,051 ±3%** | 18,340 ±23% |  23,510 ±3% |    22,268 ±4% |               14,487 ±7% |
| upsert (insert … on conflict do update)                       | **24,779 ±12%** | 19,134 ±11% |  22,681 ±3% |    21,859 ±5% |               15,147 ±1% |
| delete one row by primary key                                 |  **28,996 ±7%** |  21,702 ±4% |  27,432 ±3% |    25,596 ±4% |               16,779 ±2% |
| transaction: begin; select 1; commit                          |  **12,778 ±4%** | 12,199 ±24% |  12,174 ±5% |    10,038 ±3% |               9,820 ±13% |
| transaction: begin; insert; commit                            |  **12,113 ±2%** |  10,076 ±5% |  10,946 ±5% |     8,914 ±6% |               8,243 ±27% |
| transaction with 5 savepoints (select 1 in each)              |       2,323 ±3% |   2,264 ±3% |   2,140 ±1% | **2,454 ±3%** |                1,784 ±5% |
| query that fails (division by zero), connection reused        |  **23,577 ±8%** |     406 ±7% |     396 ±3% |     9,084 ±1% |               21,000 ±7% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **24,664 ±2%** | 20,176 ±21% |  21,997 ±2% |    21,536 ±9% |                      n/a |

**Deno 2.9: tail latency p99, sequential**

| Scenario                                                      |      quarry |         pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ---------: | ---------: | ----------: | -----------------------: |
| select 1                                                      | **48.8 µs** |    52.9 µs |    59.5 µs |     55.4 µs |                   111 µs |
| point lookup by primary key                                   | **63.7 µs** |    97.1 µs |    81.6 µs |     68.7 µs |                   178 µs |
| range scan, 100 rows                                          |  **194 µs** |     312 µs |     309 µs |      449 µs |                  2.01 ms |
| fetch 1k rows (6 columns)                                     |  **710 µs** |    2.25 ms |    2.06 ms |     6.28 ms |                 13.40 ms |
| 100 parameters (id in (…)), 100 rows                          |  **427 µs** |     648 µs |     505 µs |      654 µs |                  1.89 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **2.71 ms** |    3.71 ms |    3.51 ms |     6.54 ms |                 11.41 ms |
| insert one row                                                | **66.5 µs** |    93.7 µs |    71.0 µs |     70.1 µs |                   152 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **356 µs** |     683 µs |     416 µs |      813 µs |                  2.27 ms |
| update one row by primary key                                 | **68.5 µs** |    98.6 µs |    75.5 µs |     69.5 µs |                   161 µs |
| upsert (insert … on conflict do update)                       | **68.2 µs** |    85.2 µs |    78.7 µs |     70.7 µs |                   168 µs |
| delete one row by primary key                                 |     67.4 µs |    81.3 µs |    64.4 µs | **63.5 µs** |                   144 µs |
| transaction: begin; select 1; commit                          |      127 µs | **110 µs** |     113 µs |      149 µs |                   210 µs |
| transaction: begin; insert; commit                            |      146 µs |     150 µs | **145 µs** |      171 µs |                   235 µs |
| transaction with 5 savepoints (select 1 in each)              |  **628 µs** |     644 µs |     667 µs |      778 µs |                   911 µs |
| query that fails (division by zero), connection reused        | **78.8 µs** |    3.20 ms |    3.28 ms |      173 µs |                   113 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler | **82.8 µs** |     113 µs |     107 µs |     86.3 µs |                      n/a |

**Deno 2.9: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |         pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ---------: | ---------: | ----------: | -----------------------: |
| select 1                                                      |      146 µs | **144 µs** |     152 µs |      356 µs |                   219 µs |
| point lookup by primary key                                   |  **274 µs** |     391 µs |     296 µs |      472 µs |                   541 µs |
| range scan, 100 rows                                          |  **506 µs** |     571 µs |     613 µs |     4.93 ms |                  4.72 ms |
| fetch 1k rows (6 columns)                                     | **1.62 ms** |    4.70 ms |    4.93 ms |     9.19 ms |                 16.32 ms |
| 100 parameters (id in (…)), 100 rows                          |      752 µs |     889 µs | **733 µs** |     3.97 ms |                  4.15 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **3.76 ms** |    5.72 ms |    4.10 ms |    10.62 ms |                 12.70 ms |
| insert one row                                                |      274 µs |     231 µs | **216 µs** |      418 µs |                   329 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **696 µs** |     952 µs |     728 µs |     1.81 ms |                  2.77 ms |
| update one row by primary key                                 |      327 µs |     364 µs | **233 µs** |      469 µs |                   411 µs |
| upsert (insert … on conflict do update)                       |      331 µs |     375 µs |     284 µs |      507 µs |               **283 µs** |
| delete one row by primary key                                 |      334 µs |     205 µs | **202 µs** |      477 µs |                   327 µs |
| transaction: begin; select 1; commit                          |  **266 µs** |     789 µs |     666 µs |     2.17 ms |                   423 µs |
| transaction: begin; insert; commit                            |  **411 µs** |    1.36 ms |     938 µs |     2.71 ms |                   587 µs |
| transaction with 5 savepoints (select 1 in each)              | **1.13 ms** |    4.88 ms |    5.04 ms |     6.39 ms |                  4.64 ms |
| query that fails (division by zero), connection reused        |  **238 µs** |    4.09 ms |    3.67 ms |      741 µs |                   371 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **304 µs** |     436 µs |     359 µs |      731 µs |                      n/a |

**Deno 2.9: latency distribution, select 1**

| Percentile |           quarry |              pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | ---------------: | --------------: | -----------: | -----------: | -----------------------: |
| p50        |  **26.3 µs ±6%** |     29.0 µs ±2% |  29.8 µs ±3% |  31.6 µs ±5% |              37.2 µs ±1% |
| p90        | **30.2 µs ±10%** |    32.8 µs ±13% | 34.4 µs ±22% | 35.6 µs ±11% |              47.3 µs ±6% |
| p99        | **48.8 µs ±13%** |    52.9 µs ±16% |  59.5 µs ±7% | 55.4 µs ±42% |              111 µs ±11% |
| p99.9      |     146 µs ±108% | **144 µs ±88%** |  152 µs ±66% |  356 µs ±46% |             219 µs ±122% |
| max        |     3.33 ms ±79% |    3.36 ms ±29% | 4.23 ms ±83% | 7.46 ms ±47% |          **3.09 ms ±5%** |

**Deno 2.9: latency distribution, point lookup by primary key**

| Percentile |           quarry |               pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | ---------------: | ---------------: | -----------: | -----------: | -----------------------: |
| p50        |  **33.5 µs ±5%** |      53.0 µs ±1% |  40.0 µs ±8% |  38.9 µs ±3% |              73.0 µs ±2% |
| p90        |  **39.0 µs ±7%** |      59.5 µs ±9% |  48.6 µs ±7% | 45.3 µs ±18% |             87.1 µs ±10% |
| p99        | **63.7 µs ±36%** |      97.1 µs ±7% | 81.6 µs ±21% | 68.7 µs ±37% |               178 µs ±7% |
| p99.9      |  **274 µs ±27%** |      391 µs ±42% |  296 µs ±27% |  472 µs ±39% |              541 µs ±24% |
| max        |     3.21 ms ±49% | **2.89 ms ±31%** | 3.17 ms ±35% | 7.17 ms ±42% |             3.21 ms ±38% |

**Deno 2.9: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |            pg |   pg (named) |   postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ---------------: | ------------: | -----------: | ------------: | -----------------------: |
| fetch 100k rows                                                             | **43.37 ms ±3%** |    132 ms ±6% |   135 ms ±6% |    100 ms ±6% |              868 ms ±11% |
| fetch 1M rows (one result)                                                  |  **553 ms ±10%** |   1424 ms ±9% |  1476 ms ±7% |   1045 ms ±5% |              9488 ms ±9% |
| wide rows: 1k rows × 100 columns                                            |  **4.24 ms ±4%** |  16.56 ms ±3% | 16.74 ms ±3% |  17.52 ms ±7% |             85.73 ms ±2% |
| large values: 10 × 1 MB text                                                |     10.63 ms ±7% |  10.53 ms ±9% | 10.49 ms ±4% |  11.23 ms ±8% |         **7.17 ms ±14%** |
| large values: 10 × 1 MB bytea                                               | **3.60 ms ±29%** |  21.75 ms ±9% | 21.58 ms ±9% |  19.41 ms ±4% |               395 ms ±2% |
| large values: 20 × 200 KB jsonb                                             |     23.08 ms ±6% | 23.33 ms ±12% | 22.11 ms ±5% | 24.77 ms ±22% |         **19.88 ms ±9%** |
| arrays: 1k rows of int4[100] + text[20]                                     |  **7.83 ms ±5%** |  25.86 ms ±3% | 26.05 ms ±2% |   9.55 ms ±3% |            32.14 ms ±24% |
| bulk insert 10k rows (unnest arrays)                                        | **13.33 ms ±4%** |  13.47 ms ±2% | 13.38 ms ±4% |  13.59 ms ±5% |             13.44 ms ±2% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                | **13.15 ms ±2%** |  13.17 ms ±3% | 13.29 ms ±5% |  56.08 ms ±1% |                      n/a |
| stream 1M rows with a cursor (1000 per batch)                               |  **900 ms ±10%** |   1392 ms ±5% |  1402 ms ±1% |   1158 ms ±2% |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **651 ms ±2%** |    913 ms ±1% |   905 ms ±3% |    866 ms ±2% |                      n/a |

**Deno 2.9: rows per second (median)**

| Scenario                                      |        quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------- | ------------: | ------: | ---------: | ----------: | -----------------------: |
| fetch 1k rows (6 columns)                     | **2,405,602** | 696,945 |    709,505 |     818,287 |                  120,326 |
| fetch 100k rows                               | **2,186,178** | 737,868 |    726,085 |     978,212 |                  117,177 |
| fetch 1M rows (one result)                    | **1,855,690** | 675,671 |    647,946 |     955,571 |                  106,900 |
| wide rows: 1k rows × 100 columns              |   **228,969** |  59,115 |     58,309 |      54,309 |                   11,861 |
| arrays: 1k rows of int4[100] + text[20]       |   **126,067** |  37,164 |     37,243 |      93,521 |                   30,594 |
| stream 1M rows with a cursor (1000 per batch) | **1,111,144** | 718,541 |    709,830 |     864,999 |                      n/a |
| bulk insert 10k rows (unnest arrays)          |   **748,228** | 737,254 |    718,867 |     715,691 |                  737,360 |
| bulk insert 10k rows (COPY FROM STDIN, text)  |   **754,237** | 749,571 |    751,056 |     176,528 |                      n/a |

**Deno 2.9: peak RSS (MB) during the scenario**

| Scenario                                                                    |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| point lookup by primary key                                                 |      80 |  **76** |         77 |         136 |                       79 |
| fetch 100k rows                                                             |     454 |     454 |        447 |         371 |                  **359** |
| fetch 1M rows (one result)                                                  |   1,298 |   1,370 |      1,349 |   **1,065** |                    1,472 |
| stream 1M rows with a cursor (1000 per batch)                               | **146** |     150 |        150 |         163 |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |     104 | **100** |        101 |         152 |                      n/a |
| large values: 10 × 1 MB text                                                |     252 |     284 |        279 |     **247** |                      260 |
| large values: 10 × 1 MB bytea                                               | **199** |     268 |        266 |         232 |                      226 |
| large values: 20 × 200 KB jsonb                                             |     220 |     205 |    **205** |         299 |                      218 |

**Deno 2.9: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  | quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ----------------------- | -----: | ------: | ---------: | ----------: | -----------------------: |
| RSS growth during pause |    0.2 | **0.1** |        0.2 |         0.2 |                      n/a |

**Deno 2.9: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry |        pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------- | -----------: | --------: | ---------: | ----------: | -----------------------: |
| int4                 |  **96 ±18%** |   267 ±1% |    266 ±6% |     252 ±4% |                4,042 ±4% |
| int8                 |  **143 ±8%** |   273 ±5% |    283 ±6% |     239 ±7% |                4,014 ±5% |
| float8               |   **84 ±2%** |   280 ±3% |   277 ±14% |     287 ±9% |                3,909 ±6% |
| numeric              |  **148 ±7%** |  228 ±15% |   232 ±17% |     240 ±6% |                3,900 ±9% |
| text                 | **160 ±11%** |  253 ±20% |    243 ±7% |     247 ±6% |                3,790 ±5% |
| bool                 |  **99 ±13%** |   201 ±6% |    211 ±6% |     202 ±5% |               4,041 ±26% |
| timestamptz          | **162 ±11%** |   727 ±4% |    755 ±3% |     488 ±7% |                4,859 ±3% |
| date                 | **144 ±10%** |   544 ±3% |    545 ±3% |     402 ±4% |                3,962 ±7% |
| uuid                 |  **188 ±7%** |   251 ±7% |    247 ±6% |     248 ±9% |                3,913 ±4% |
| jsonb (small object) |  **405 ±6%** |   507 ±7% |    509 ±3% |     515 ±2% |                4,689 ±8% |
| int4[5]              | **593 ±13%** | 1,310 ±8% | 1,234 ±12% |     679 ±7% |                5,308 ±6% |
| bytea (16 B)         |     445 ±12% |   450 ±5% |    438 ±4% | **433 ±6%** |                5,451 ±8% |

**Deno 2.9: writes, operations/s (bulk rows: batches of 10k rows per second)**

| Scenario                                     |          quarry |          pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------- | --------------: | ----------: | ----------: | ----------: | -----------------------: |
| insert one row                               | **28,922 ±16%** |  20,696 ±3% | 26,612 ±12% |  24,053 ±1% |               16,348 ±2% |
| insert one row, concurrency 50               | **170,665 ±3%** | 71,296 ±12% |  60,557 ±6% |  53,819 ±1% |              21,698 ±16% |
| multi-row insert: 100 rows, 300 parameters   |   **4,244 ±9%** |   2,564 ±1% |   3,520 ±7% |   2,242 ±3% |                1,800 ±2% |
| bulk insert 10k rows (unnest arrays)         |    **74.8 ±3%** |    73.7 ±2% |    71.9 ±5% |    71.6 ±8% |                 73.7 ±2% |
| bulk insert 10k rows (COPY FROM STDIN, text) |    **75.4 ±2%** |    75.0 ±3% |    75.1 ±5% |    17.7 ±1% |                      n/a |
| update one row by primary key                |  **25,051 ±3%** | 18,340 ±23% |  23,510 ±3% |  22,268 ±4% |               14,487 ±7% |
| upsert (insert … on conflict do update)      | **24,779 ±12%** | 19,134 ±11% |  22,681 ±3% |  21,859 ±5% |               15,147 ±1% |
| delete one row by primary key                |  **28,996 ±7%** |  21,702 ±4% |  27,432 ±3% |  25,596 ±4% |               16,779 ±2% |

**Deno 2.9: transactions, operations/s**

| Scenario                                         |         quarry |          pg | pg (named) |   postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------ | -------------: | ----------: | ---------: | ------------: | -----------------------: |
| transaction: begin; select 1; commit             | **12,778 ±4%** | 12,199 ±24% | 12,174 ±5% |    10,038 ±3% |               9,820 ±13% |
| transaction: begin; insert; commit               | **12,113 ±2%** |  10,076 ±5% | 10,946 ±5% |     8,914 ±6% |               8,243 ±27% |
| transaction with 5 savepoints (select 1 in each) |      2,323 ±3% |   2,264 ±3% |  2,140 ±1% | **2,454 ±3%** |                1,784 ±5% |

**Deno 2.9: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | ----------: | -----------------------: |
| select 1                                               |   **21.4** |    21.7 |       25.5 |        28.9 |                     35.6 |
| point lookup by primary key                            |   **24.4** |    31.7 |       31.9 |        33.7 |                     72.4 |
| fetch 1k rows (6 columns)                              |    **394** |   1,314 |      1,328 |       1,327 |                    9,214 |
| fetch 100k rows                                        | **63,328** | 170,964 |    171,224 |     133,180 |                1,025,850 |
| insert one row                                         |   **23.1** |    25.8 |       26.0 |        32.9 |                     55.7 |
| insert one row, concurrency 50                         |    **6.2** |    15.1 |       17.8 |        22.9 |                     51.5 |
| transaction: begin; insert; commit                     |   **58.1** |    68.1 |       66.5 |        97.4 |                      103 |
| query that fails (division by zero), connection reused |   **35.8** |     531 |        560 |         108 |                     41.8 |

**Deno 2.9: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | -----------------------: |
| select 1                             |  **9.6** | 11.7 |        9.8 |        11.8 |                     12.3 |
| point lookup by primary key          | **15.3** | 28.4 |       15.7 |        16.1 |                     35.2 |
| fetch 1k rows (6 columns)            |  **243** |  430 |        380 |         398 |                      488 |
| 100 parameters (id in (…)), 100 rows |  **191** |  255 |        196 |         200 |                      343 |
| insert one row                       |     14.6 | 24.5 |   **14.3** |        14.6 |                     32.0 |
| insert one row, concurrency 50       | **12.9** | 32.5 |       19.1 |        15.8 |                     55.6 |
| transaction: begin; insert; commit   | **30.0** | 42.7 |       31.1 |        33.4 |                     51.0 |

**Deno 2.9: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| point lookup by primary key: p99                   | **0.3** |     1.0 |        0.9 |         1.7 |                      0.7 |
| point lookup by primary key: max                   | **0.3** |     1.0 |        0.9 |         1.7 |                      0.7 |
| insert one row, concurrency 50: p99                |     1.0 |     0.7 |    **0.5** |         2.9 |                      2.1 |
| insert one row, concurrency 50: max                |     1.0 |     0.7 |    **0.5** |         2.9 |                      2.1 |
| fetch 1k rows (6 columns): p99                     | **1.0** |     1.8 |        2.2 |         4.9 |                      3.8 |
| fetch 1k rows (6 columns): max                     | **1.0** |     1.8 |        2.2 |         4.9 |                      3.8 |
| fetch 100k rows: p99                               |    18.3 |    52.5 |       48.8 |        22.4 |                  **4.7** |
| fetch 100k rows: max                               |    19.4 |    52.5 |       48.8 |        26.1 |                  **7.1** |
| fetch 1M rows (one result): p99                    |    24.0 |    67.6 |       71.6 |        27.8 |                  **4.3** |
| fetch 1M rows (one result): max                    |    39.1 |    82.8 |       85.3 |        33.3 |                 **10.6** |
| stream 1M rows with a cursor (1000 per batch): p99 |     1.7 | **1.6** |        1.7 |         5.4 |                      n/a |
| stream 1M rows with a cursor (1000 per batch): max | **1.8** |     2.1 |        2.1 |         6.3 |                      n/a |

**Deno 2.9: connections (median time per operation)**

| Scenario                                                    |      quarry |               pg |   pg (named) |  postgres.js | deno-postgres (stock) | deno-postgres (+nodelay) |
| ----------------------------------------------------------- | ----------: | ---------------: | -----------: | -----------: | --------------------: | -----------------------: |
| connect + select 1 + close (no TLS, trust)                  | 4.02 ms ±8% |      4.02 ms ±1% | 4.02 ms ±<1% |  8.12 ms ±7% |       **2.45 ms ±2%** |             2.52 ms ±17% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | 5.52 ms ±3% |      5.50 ms ±6% |  5.46 ms ±7% | 10.25 ms ±7% |                     — |          **3.93 ms ±2%** |
| connect + select 1 + close (TLS verify-full, trust)         | 4.98 ms ±4% |      4.85 ms ±4% |  4.73 ms ±8% | 52.73 ms ±4% |                     — |          **4.12 ms ±1%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) | 6.64 ms ±6% |      6.15 ms ±6% |  6.38 ms ±4% | 56.46 ms ±3% |                     — |          **5.68 ms ±8%** |
| pool warm-up: new pool (max 10), 10 concurrent select 1     | 9.51 ms ±3% | **8.73 ms ±22%** |  8.94 ms ±7% | 16.55 ms ±9% |                     — |              8.77 ms ±5% |

**Deno 2.9: cancellation, notifications, errors**

| Scenario                                      |      quarry |        pg |    pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------- | ----------: | --------: | ------------: | ----------: | -----------------------: |
| cancel: time from cancel() to rejection (p50) |     1.71 ms |   1.66 ms |   **1.63 ms** |     1.65 ms |                      n/a |
| cancel: share of queries actually cancelled   |    **100%** |  **100%** |      **100%** |    **100%** |                      n/a |
| NOTIFY latency p50                            | **37.7 µs** |   45.6 µs |       41.6 µs |     41.0 µs |                      n/a |
| NOTIFY latency p99                            | **82.8 µs** |    113 µs |        107 µs |     86.3 µs |                      n/a |
| NOTIFY throughput (notifications/s)           |   1,698,143 | 1,758,059 | **1,815,965** |   1,691,302 |                      n/a |
| error path: failing queries/s                 |  **23,577** |       406 |           396 |       9,084 |                   21,000 |

**Deno 2.9: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 35,361 / 28,939 / +22% |  31,490 / 32,148 / -2% |   28,542 / 29,487 / -3% |
| point lookup by primary key             | 27,355 / 18,404 / +49% | 22,698 / 17,934 / +27% | 23,557 / 11,379 / +107% |
| range scan, 100 rows                    |   8,868 / 5,828 / +52% |    4,807 / 4,721 / +2% |    5,223 / 4,310 / +21% |
| fetch 1k rows (6 columns)               |  2,406 / 1,038 / +132% |        710 / 697 / +2% |         818 / 813 / +1% |
| 100 parameters (id in (…)), 100 rows    |   3,776 / 2,844 / +33% |   3,257 / 2,705 / +20% |    2,995 / 2,199 / +36% |
| 1000 parameters (id in (…)), 1000 rows  |       465 / 378 / +23% |       394 / 333 / +18% |        362 / 315 / +15% |
| insert one row                          | 28,922 / 21,710 / +33% | 26,612 / 20,696 / +29% |  24,053 / 12,544 / +92% |
| upsert (insert … on conflict do update) | 24,779 / 18,966 / +31% | 22,681 / 19,134 / +19% |  21,859 / 12,082 / +81% |

**Deno 2.9: shipped defaults vs tuned (median latency)**

| Scenario                                   | deno-postgres (+nodelay) | deno-postgres (stock) |
| ------------------------------------------ | -----------------------: | --------------------: |
| select 1                                   |              **37.2 µs** |               37.4 µs |
| point lookup by primary key                |              **73.0 µs** |              43.98 ms |
| fetch 1k rows (6 columns)                  |              **7.27 ms** |               7.51 ms |
| insert one row                             |              **55.7 µs** |              44.04 ms |
| transaction: begin; insert; commit         |                   113 µs |                     — |
| connect + select 1 + close (no TLS, trust) |                  2.52 ms |           **2.45 ms** |

## Across runtimes

**Throughput (operations/s) by runtime**

| Scenario                           | quarry (node) | pg (node) | pg (named) (node) | pg-native (node) | postgres.js (node) | neon (WS) (node) | quarry (bun) | pg (bun) | pg (named) (bun) | postgres.js (bun) | Bun.sql (bun) | quarry (deno) | pg (deno) | pg (named) (deno) | postgres.js (deno) | deno-postgres (+nodelay) (deno) |
| ---------------------------------- | ------------: | --------: | ----------------: | ---------------: | -----------------: | ---------------: | -----------: | -------: | ---------------: | ----------------: | ------------: | ------------: | --------: | ----------------: | -----------------: | ------------------------------: |
| select 1                           |        39,454 |    35,126 |            35,449 |           30,006 |             32,457 |           18,884 |       45,365 |   41,622 |           44,025 |            38,909 |        38,786 |        35,361 |    32,148 |            31,490 |             28,542 |                          24,088 |
| point lookup by primary key        |        31,272 |    18,660 |            24,689 |           18,369 |             26,113 |           10,803 |       35,169 |   21,970 |           32,289 |            32,568 |        33,505 |        27,355 |    17,934 |            22,698 |             23,557 |                          12,595 |
| fetch 1k rows (6 columns)          |         2,284 |       758 |               757 |              612 |                834 |              629 |        3,205 |      981 |              991 |             1,123 |         2,473 |         2,406 |       697 |               710 |                818 |                             120 |
| fetch 100k rows                    |          21.4 |       7.4 |               7.4 |              6.6 |                9.4 |              6.5 |         37.3 |      9.9 |             10.0 |              11.3 |          28.6 |          21.9 |       7.4 |               7.3 |                9.8 |                             1.2 |
| insert one row                     |        32,908 |    24,042 |            30,467 |           20,895 |             27,576 |           12,541 |       35,757 |   26,779 |           36,453 |            34,065 |        33,079 |        28,922 |    20,696 |            26,612 |             24,053 |                          16,348 |
| insert one row, concurrency 50     |       199,905 |    81,068 |            73,540 |           70,651 |             40,256 |           30,773 |      232,664 |   97,641 |          106,176 |            63,952 |       139,971 |       170,665 |    71,296 |            60,557 |             53,819 |                          21,698 |
| transaction: begin; insert; commit |        13,311 |    11,332 |            12,647 |            9,472 |              9,947 |            6,103 |       14,638 |   12,709 |           15,055 |            13,256 |        10,866 |        12,113 |    10,076 |            10,946 |              8,914 |                           8,243 |

## Concurrency sweep (Node 24): point lookups/s

**Node 24: pool size 1, point lookups/s by concurrency**

| Concurrency |          quarry | quarry (pipeline: false) |         pg | pg (named) |   pg-native |     postgres.js |   neon (WS) |
| ----------- | --------------: | -----------------------: | ---------: | ---------: | ----------: | --------------: | ----------: |
| 1           |      32,163 ±2% |           **32,695 ±2%** | 19,694 ±3% | 25,991 ±3% |  18,471 ±2% |      27,357 ±2% |  11,448 ±2% |
| 10          |     106,217 ±3% |               32,761 ±2% | 20,199 ±2% | 26,683 ±4% | 19,164 ±13% | **107,827 ±2%** |  11,770 ±3% |
| 50          |     111,552 ±4% |               32,625 ±3% | 20,075 ±3% | 27,540 ±4% |  18,781 ±6% | **113,360 ±4%** | 11,989 ±32% |
| 100         |     111,608 ±7% |               31,996 ±1% | 20,032 ±6% | 26,429 ±3% |  19,125 ±1% | **117,751 ±5%** |  12,034 ±1% |
| 500         | **113,902 ±6%** |               32,005 ±3% | 20,133 ±4% | 26,696 ±4% | 19,022 ±12% |     104,500 ±4% |  11,855 ±3% |
| 1000        | **111,903 ±1%** |               31,746 ±4% | 19,616 ±2% | 26,096 ±4% |  18,872 ±4% |     104,292 ±6% |  11,807 ±3% |

**Node 24: pool size 1, p99 latency by concurrency**

| Concurrency |       quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | -----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           |      48.0 µs |              **46.3 µs** |  76.3 µs |    63.3 µs |   77.4 µs |     54.3 µs |    208 µs |
| 10          |       245 µs |                   811 µs |  1.10 ms |     880 µs |    990 µs |  **163 µs** |   1.82 ms |
| 50          |      1.36 ms |                  2.51 ms |  4.04 ms |    2.66 ms |   3.93 ms |  **993 µs** |   6.67 ms |
| 100         |  **2.18 ms** |                  4.91 ms |  7.82 ms |    6.13 ms |   6.71 ms |     5.27 ms |  11.81 ms |
| 500         |  **7.18 ms** |                 22.12 ms | 36.14 ms |   25.00 ms |  32.01 ms |    11.79 ms |  49.04 ms |
| 1000        | **14.04 ms** |                 41.35 ms | 62.99 ms |   46.24 ms |  60.87 ms |    18.84 ms |  95.48 ms |

**Node 24: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |  pg-native |  postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ---------: | -----------: | ----------: |
| 1           |       32,354 ±1% |           **32,685 ±1%** |  19,300 ±2% |  25,844 ±7% | 18,354 ±2% |   27,380 ±6% | 11,514 ±31% |
| 10          |  **129,647 ±9%** |               88,872 ±5% |  63,351 ±3% |  60,138 ±2% | 59,320 ±6% |   41,034 ±3% | 19,136 ±60% |
| 50          |  **279,829 ±8%** |              89,013 ±14% | 61,783 ±10% | 57,126 ±10% | 55,084 ±5% |   41,026 ±3% | 30,244 ±41% |
| 100         | **314,580 ±10%** |               87,725 ±4% |  62,773 ±8% | 58,186 ±14% | 57,239 ±3% |   41,409 ±2% | 28,759 ±41% |
| 500         |  **258,349 ±8%** |               83,356 ±8% |  61,039 ±4% |  57,215 ±4% | 56,261 ±2% | 130,605 ±10% |  27,818 ±4% |
| 1000        |  **259,258 ±7%** |               81,164 ±4% |  60,118 ±3% |  55,697 ±6% | 54,307 ±5% |  132,554 ±5% |  27,941 ±2% |

**Node 24: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **47.6 µs** |                  47.9 µs |  79.2 µs |    64.7 µs |   77.9 µs |     54.9 µs |    202 µs |
| 10          |  **202 µs** |                   470 µs |   570 µs |     591 µs |    474 µs |      461 µs |   1.13 ms |
| 50          | **1.01 ms** |                  1.43 ms |  1.69 ms |    1.78 ms |   1.55 ms |     2.65 ms |   2.96 ms |
| 100         | **1.53 ms** |                  2.27 ms |  2.69 ms |    2.86 ms |   2.83 ms |     5.36 ms |   6.22 ms |
| 500         | **4.22 ms** |                 10.85 ms | 12.13 ms |   12.48 ms |  11.98 ms |    10.53 ms |  27.36 ms |
| 1000        | **7.66 ms** |                 19.91 ms | 24.17 ms |   25.96 ms |  22.84 ms |    14.61 ms |  42.26 ms |

**Node 24: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |         pg | pg (named) |  pg-native | postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ---------: | ---------: | ---------: | ----------: | ----------: |
| 1           |   **32,419 ±1%** |               32,202 ±4% | 19,487 ±4% | 26,091 ±2% | 18,796 ±1% |  27,900 ±5% | 11,636 ±22% |
| 10          |  **94,023 ±16%** |               92,612 ±1% | 64,368 ±7% | 59,919 ±4% | 60,688 ±2% |  63,969 ±5% |  30,796 ±4% |
| 50          | **211,442 ±10%** |               88,973 ±5% | 64,508 ±4% | 58,850 ±6% | 59,154 ±7% | 40,633 ±10% |  29,446 ±7% |
| 100         | **293,463 ±18%** |               89,116 ±6% | 62,196 ±4% | 58,778 ±3% | 59,206 ±4% |  40,876 ±3% | 29,743 ±12% |
| 500         |  **312,671 ±4%** |               82,017 ±8% | 62,674 ±2% | 55,756 ±3% | 57,879 ±3% | 111,167 ±6% | 29,007 ±32% |
| 1000        |  **262,233 ±9%** |              81,752 ±15% | 60,597 ±6% | 55,109 ±5% | 57,747 ±3% | 128,664 ±1% | 28,439 ±31% |

**Node 24: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           |     48.1 µs |              **47.2 µs** |  76.6 µs |    59.8 µs |   72.0 µs |     53.8 µs |    188 µs |
| 10          |      321 µs |                   403 µs |   601 µs |     600 µs |    424 µs |  **274 µs** |   1.01 ms |
| 50          | **1.01 ms** |                  1.47 ms |  1.58 ms |    1.66 ms |   1.49 ms |     2.66 ms |   3.18 ms |
| 100         | **1.56 ms** |                  2.41 ms |  2.77 ms |    3.02 ms |   2.67 ms |     5.61 ms |   5.65 ms |
| 500         | **4.09 ms** |                 10.95 ms | 12.41 ms |   12.41 ms |  11.41 ms |    13.77 ms |  23.50 ms |
| 1000        | **7.45 ms** |                 19.28 ms | 24.49 ms |   25.55 ms |  21.31 ms |    15.81 ms |  43.10 ms |

**Node 24: pool size 50, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |  pg-native | postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ---------: | ----------: | ----------: |
| 1           |   **32,138 ±2%** |               31,876 ±1% |  19,510 ±2% |  25,840 ±3% | 18,755 ±2% |  27,601 ±2% | 11,389 ±29% |
| 10          |   **93,877 ±1%** |               91,226 ±5% | 63,685 ±16% |  58,766 ±3% | 57,430 ±8% |  61,653 ±6% |  31,012 ±5% |
| 50          |       88,801 ±5% |          **90,127 ±10%** |  60,352 ±5% |  58,400 ±3% | 55,670 ±5% | 58,769 ±11% |  29,945 ±3% |
| 100         | **108,943 ±11%** |               85,906 ±2% |  62,568 ±1% | 57,699 ±11% | 53,585 ±5% |  40,430 ±9% |  29,176 ±9% |
| 500         |  **201,533 ±8%** |               80,728 ±4% |  59,917 ±3% |  55,370 ±4% | 53,746 ±4% |  41,137 ±2% |  26,711 ±4% |
| 1000        | **218,524 ±12%** |               77,100 ±8% |  58,597 ±7% |  53,099 ±7% | 53,610 ±3% |  42,024 ±2% | 25,689 ±26% |

**Node 24: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **47.4 µs** |                  48.5 µs |  76.0 µs |    59.3 µs |   72.0 µs |     53.2 µs |    231 µs |
| 10          |  **320 µs** |                   353 µs |   598 µs |     601 µs |    438 µs |      325 µs |    998 µs |
| 50          | **1.50 ms** |                  1.50 ms |  1.80 ms |    1.78 ms |   1.58 ms |     2.01 ms |   3.62 ms |
| 100         | **2.25 ms** |                  2.34 ms |  3.09 ms |    3.15 ms |   3.08 ms |     7.77 ms |   5.76 ms |
| 500         | **5.46 ms** |                 10.73 ms | 11.51 ms |   12.90 ms |  12.70 ms |    26.05 ms |  24.88 ms |
| 1000        | **9.03 ms** |                 19.97 ms | 26.03 ms |   26.64 ms |  23.11 ms |    49.23 ms |  51.64 ms |

## Concurrency sweep (Bun 1.4): point lookups/s

**Bun 1.4: pool size 1, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |     postgres.js |    Bun.sql |
| ----------- | ---------------: | ----------: | --------------: | ---------: |
| 1           |   **36,666 ±2%** |  23,027 ±1% |      33,655 ±1% | 33,630 ±3% |
| 10          |      107,610 ±4% |  23,724 ±6% | **110,550 ±4%** | 82,285 ±1% |
| 50          | **114,036 ±13%** |  23,737 ±7% |     112,689 ±2% | 81,840 ±2% |
| 100         |      113,945 ±3% | 22,962 ±14% | **115,856 ±7%** | 86,671 ±4% |
| 500         |  **112,438 ±1%** |  22,709 ±1% |     107,237 ±5% | 91,172 ±8% |
| 1000        |  **112,578 ±4%** | 22,476 ±19% |     105,145 ±3% | 88,083 ±3% |

**Bun 1.4: pool size 1, p99 latency by concurrency**

| Concurrency |       quarry |       pg | postgres.js |  Bun.sql |
| ----------- | -----------: | -------: | ----------: | -------: |
| 1           |  **35.0 µs** |  58.3 µs |     40.4 µs |  39.0 µs |
| 10          |   **125 µs** |   894 µs |      145 µs |   163 µs |
| 50          |      1.07 ms |  3.02 ms |  **976 µs** |  1.33 ms |
| 100         |  **1.58 ms** |  5.81 ms |     1.64 ms |  1.89 ms |
| 500         |  **6.32 ms** | 24.39 ms |     6.60 ms |  6.71 ms |
| 1000        | **10.85 ms** | 47.65 ms |    11.56 ms | 13.52 ms |

**Bun 1.4: pool size 5, point lookups/s by concurrency**

| Concurrency |          quarry |         pg |  postgres.js |     Bun.sql |
| ----------- | --------------: | ---------: | -----------: | ----------: |
| 1           |  **36,409 ±5%** | 23,331 ±1% |   32,747 ±7% |  33,788 ±4% |
| 10          | **156,077 ±6%** | 83,493 ±4% |   63,774 ±1% | 122,041 ±1% |
| 50          | **343,305 ±2%** | 80,775 ±4% |   64,690 ±2% | 173,766 ±2% |
| 100         | **403,168 ±4%** | 79,897 ±1% |   62,953 ±5% | 182,187 ±3% |
| 500         | **377,729 ±4%** | 73,701 ±8% |  204,363 ±3% | 198,431 ±2% |
| 1000        | **361,689 ±4%** | 71,391 ±5% | 203,911 ±10% | 203,822 ±4% |

**Bun 1.4: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js | Bun.sql |
| ----------- | ----------: | -------: | ----------: | ------: |
| 1           | **36.1 µs** |  56.0 µs |     42.0 µs | 38.1 µs |
| 10          |  **122 µs** |   571 µs |      363 µs |  178 µs |
| 50          |  **698 µs** |  1.40 ms |     1.80 ms | 1.12 ms |
| 100         |  **979 µs** |  2.28 ms |     3.41 ms | 1.72 ms |
| 500         | **2.93 ms** |  9.11 ms |     4.57 ms | 5.06 ms |
| 1000        | **5.20 ms** | 16.25 ms |     7.46 ms | 9.00 ms |

**Bun 1.4: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry |         pg | postgres.js |     Bun.sql |
| ----------- | ---------------: | ---------: | ----------: | ----------: |
| 1           |   **36,335 ±5%** | 23,035 ±4% |  33,571 ±2% |  33,516 ±3% |
| 10          |  **107,455 ±6%** | 85,282 ±6% |  92,350 ±7% |  88,346 ±2% |
| 50          | **268,389 ±10%** | 83,961 ±3% |  62,978 ±2% | 146,244 ±5% |
| 100         |  **341,050 ±5%** | 81,044 ±7% |  64,141 ±3% | 165,103 ±3% |
| 500         |  **424,852 ±1%** | 76,203 ±5% | 178,954 ±4% | 185,703 ±2% |
| 1000        |  **365,721 ±4%** | 72,471 ±1% | 203,561 ±3% | 191,566 ±2% |

**Bun 1.4: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |  Bun.sql |
| ----------- | ----------: | -------: | ----------: | -------: |
| 1           | **35.2 µs** |  58.7 µs |     40.6 µs |  39.2 µs |
| 10          |  **176 µs** |   560 µs |      222 µs |   223 µs |
| 50          |  **830 µs** |  1.44 ms |     1.89 ms |  1.29 ms |
| 100         | **1.08 ms** |  2.24 ms |     3.46 ms |  1.69 ms |
| 500         | **3.09 ms** |  9.23 ms |     7.04 ms |  5.57 ms |
| 1000        | **5.10 ms** | 17.98 ms |     8.63 ms | 10.15 ms |

**Bun 1.4: pool size 50, point lookups/s by concurrency**

| Concurrency |          quarry |         pg | postgres.js |     Bun.sql |
| ----------- | --------------: | ---------: | ----------: | ----------: |
| 1           |  **36,157 ±5%** | 22,911 ±6% |  33,426 ±2% |  32,441 ±1% |
| 10          | **111,631 ±7%** | 86,845 ±3% |  92,416 ±2% |  80,451 ±5% |
| 50          | **109,100 ±6%** | 81,788 ±7% |  83,324 ±7% | 83,950 ±10% |
| 100         | **140,386 ±3%** | 80,845 ±3% |  60,536 ±3% | 106,478 ±4% |
| 500         | **255,333 ±4%** | 75,997 ±2% |  63,719 ±9% | 144,613 ±5% |
| 1000        | **289,934 ±3%** | 73,216 ±9% |  64,257 ±1% | 154,454 ±4% |

**Bun 1.4: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |     Bun.sql |
| ----------- | ----------: | -------: | ----------: | ----------: |
| 1           | **35.4 µs** |  60.3 µs |     39.4 µs |     42.6 µs |
| 10          |  **168 µs** |   558 µs |      209 µs |      256 µs |
| 50          |     1.41 ms |  1.49 ms |     1.54 ms | **1.14 ms** |
| 100         | **1.64 ms** |  2.53 ms |     3.57 ms |     1.85 ms |
| 500         | **4.43 ms** |  9.37 ms |    16.63 ms |     6.67 ms |
| 1000        | **6.88 ms** | 16.45 ms |    33.31 ms |    12.22 ms |

## Pipelining depth

**quarry, one connection, 100 concurrent point lookups: throughput by `pipeline` depth (columns: RTT ms)**

| pipeline |                0 |          5 |
| -------- | ---------------: | ---------: |
| 1        |   **20,109 ±2%** |    169 ±1% |
| 2        |   **39,928 ±1%** |    337 ±1% |
| 4        |   **70,564 ±3%** |    676 ±2% |
| 8        | **105,085 ±30%** |  1,334 ±1% |
| 16       |  **108,245 ±2%** |  2,620 ±2% |
| 32       |  **107,484 ±4%** |  5,089 ±1% |
| 64       |  **108,307 ±8%** |  9,729 ±8% |
| 100      |  **108,456 ±5%** | 16,356 ±5% |

## Network latency (RTT through Toxiproxy)

**Node 24: select 1, sequential: median latency by RTT**

| RTT   |            quarry |           pg |    pg (named) |       pg-native |  postgres.js |    neon (WS) |
| ----- | ----------------: | -----------: | ------------: | --------------: | -----------: | -----------: |
| 0 ms  |   **42.5 µs ±2%** | 44.5 µs ±42% |   45.1 µs ±3% |    52.1 µs ±12% |  47.6 µs ±1% | 63.2 µs ±22% |
| 1 ms  |   **1.42 ms ±4%** |  1.45 ms ±4% |   1.46 ms ±6% |     1.44 ms ±8% |  1.44 ms ±5% |  1.47 ms ±6% |
| 5 ms  |       5.85 ms ±3% |  5.88 ms ±1% |   5.84 ms ±2% | **5.83 ms ±2%** |  5.91 ms ±1% |  5.96 ms ±2% |
| 20 ms | **20.88 ms ±<1%** | 20.97 ms ±1% | 20.94 ms ±<1% |    20.89 ms ±1% | 20.92 ms ±1% | 21.11 ms ±1% |

**Node 24: point lookup, sequential: median latency by RTT**

| RTT   |          quarry |            pg |      pg (named) |     pg-native |       postgres.js |     neon (WS) |
| ----- | --------------: | ------------: | --------------: | ------------: | ----------------: | ------------: |
| 0 ms  | **49.7 µs ±3%** |  67.3 µs ±30% |    57.4 µs ±42% |  70.2 µs ±24% |       54.8 µs ±1% |   110 µs ±22% |
| 1 ms  | **1.45 ms ±5%** |   1.51 ms ±7% |     1.50 ms ±2% |   1.52 ms ±8% |       1.50 ms ±5% |   1.61 ms ±6% |
| 5 ms  |     5.93 ms ±1% |   5.97 ms ±2% | **5.92 ms ±1%** |   5.98 ms ±1% |       5.93 ms ±1% |   6.09 ms ±2% |
| 20 ms |    20.99 ms ±1% | 21.09 ms ±<1% |    21.01 ms ±1% | 21.12 ms ±<1% | **20.92 ms ±<1%** | 21.26 ms ±<1% |

**Node 24: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |          quarry |         pg | pg (named) |  pg-native | postgres.js |  neon (WS) |
| ----- | --------------: | ---------: | ---------: | ---------: | ----------: | ---------: |
| 0 ms  | **207,301 ±5%** | 62,047 ±5% | 56,772 ±9% | 58,879 ±6% |  38,855 ±4% | 22,484 ±5% |
| 1 ms  |  **27,805 ±3%** |  5,621 ±5% |  6,015 ±3% |  5,616 ±3% |  18,150 ±2% |  4,965 ±1% |
| 5 ms  |   **8,080 ±1%** | 1,643 ±<1% |  1,659 ±1% |  1,639 ±1% |   6,658 ±8% |  1,576 ±1% |
| 20 ms |  **2,351 ±<1%** |   471 ±<1% |   473 ±<1% |    472 ±1% |   1,955 ±4% |    467 ±1% |

**Node 24: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |          quarry |         pg |  pg (named) |   pg-native |     postgres.js |  neon (WS) |
| ----- | --------------: | ---------: | ----------: | ----------: | --------------: | ---------: |
| 0 ms  | **99,805 ±19%** | 13,852 ±4% | 16,050 ±14% | 13,677 ±16% |     93,343 ±26% | 8,434 ±20% |
| 1 ms  |      23,549 ±2% |    658 ±3% |     665 ±2% |     643 ±1% | **40,408 ±61%** |    630 ±3% |
| 5 ms  |       7,713 ±2% |   168 ±<1% |     169 ±2% |    167 ±<1% | **12,966 ±10%** |    166 ±1% |
| 20 ms |       2,318 ±1% |  47.6 ±<1% |   47.7 ±<1% |   47.6 ±<1% |   **3,362 ±7%** |  47.2 ±<1% |

**Node 24: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |            pg |   pg (named) |    pg-native |   postgres.js |    neon (WS) |
| ----- | ----------------: | ------------: | -----------: | -----------: | ------------: | -----------: |
| 0 ms  |    **414 µs ±6%** |   1.45 ms ±5% |  1.37 ms ±1% |  1.73 ms ±5% |   1.17 ms ±8% | 1.71 ms ±10% |
| 1 ms  |   **2.18 ms ±4%** |   3.22 ms ±2% |  3.15 ms ±1% |  3.24 ms ±1% |  3.03 ms ±13% |  3.44 ms ±4% |
| 5 ms  |  **6.48 ms ±<1%** |   7.43 ms ±1% |  7.38 ms ±1% | 7.44 ms ±<1% |   7.26 ms ±3% |  7.73 ms ±1% |
| 20 ms | **21.59 ms ±<1%** | 22.53 ms ±<1% | 22.50 ms ±2% | 22.64 ms ±1% | 22.34 ms ±<1% | 22.89 ms ±1% |

**Node 24: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |           quarry |            pg |   pg (named) |        pg-native |  postgres.js |     neon (WS) |
| ----- | ---------------: | ------------: | -----------: | ---------------: | -----------: | ------------: |
| 0 ms  |   **127 µs ±2%** |   141 µs ±13% |  140 µs ±25% |      158 µs ±56% |  146 µs ±63% |   213 µs ±28% |
| 1 ms  |  **4.30 ms ±4%** |   4.37 ms ±2% |  4.32 ms ±2% |      4.37 ms ±2% |  4.40 ms ±7% |   4.55 ms ±2% |
| 5 ms  |     17.58 ms ±1% |  17.60 ms ±1% | 17.54 ms ±1% | **17.54 ms ±2%** | 17.69 ms ±3% | 17.92 ms ±<1% |
| 20 ms | **62.70 ms ±1%** | 62.85 ms ±<1% | 62.83 ms ±1% |    62.82 ms ±<1% | 62.92 ms ±1% |  63.06 ms ±1% |

**Node 24: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |          pg |  pg (named) |  pg-native | postgres.js |   neon (WS) |
| ----- | ---------------: | ----------: | ----------: | ---------: | ----------: | ----------: |
| 0 ms  | **187,336 ±17%** | 75,406 ±10% | 76,155 ±27% | 67,770 ±8% | 36,759 ±13% | 21,729 ±16% |
| 1 ms  |   **26,559 ±3%** |   5,900 ±2% |   6,101 ±2% |  5,830 ±2% |  17,674 ±3% |   5,020 ±1% |
| 5 ms  |    **8,071 ±1%** |   1,654 ±1% |   1,661 ±1% |  1,647 ±1% |   6,774 ±1% |   1,578 ±1% |
| 20 ms |    **2,356 ±1%** |     473 ±1% |     474 ±1% |   473 ±<1% |   1,916 ±2% |    467 ±<1% |

**Node 24: connect + select 1 + close: median latency by RTT**

| RTT   |       quarry |               pg |       pg (named) |     pg-native |  postgres.js |    neon (WS) |
| ----- | -----------: | ---------------: | ---------------: | ------------: | -----------: | -----------: |
| 0 ms  | 2.89 ms ±18% |     2.90 ms ±21% | **2.82 ms ±17%** |   5.71 ms ±6% |  6.11 ms ±4% | 5.02 ms ±11% |
| 1 ms  | 5.39 ms ±11% |  **5.28 ms ±7%** |      5.58 ms ±6% |  10.21 ms ±5% |  9.88 ms ±4% |  7.72 ms ±5% |
| 5 ms  | 14.27 ms ±1% |     14.17 ms ±3% | **14.15 ms ±3%** |  27.74 ms ±1% | 22.88 ms ±3% | 16.80 ms ±2% |
| 20 ms | 45.07 ms ±1% | **44.67 ms ±2%** |     45.15 ms ±1% | 88.55 ms ±<1% | 68.43 ms ±2% | 47.60 ms ±1% |

**Bun 1.4: select 1, sequential: median latency by RTT**

| RTT   |          quarry |           Bun.sql |
| ----- | --------------: | ----------------: |
| 0 ms  | **40.1 µs ±2%** |      42.6 µs ±32% |
| 1 ms  |     1.39 ms ±1% |   **1.38 ms ±2%** |
| 5 ms  |     5.79 ms ±1% |   **5.78 ms ±1%** |
| 20 ms |   20.92 ms ±<1% | **20.87 ms ±<1%** |

**Bun 1.4: point lookup, sequential: median latency by RTT**

| RTT   |          quarry |           Bun.sql |
| ----- | --------------: | ----------------: |
| 0 ms  | **45.6 µs ±3%** |      49.2 µs ±26% |
| 1 ms  |     1.44 ms ±3% |   **1.39 ms ±1%** |
| 5 ms  |     5.87 ms ±1% |   **5.78 ms ±1%** |
| 20 ms |    20.96 ms ±1% | **20.91 ms ±<1%** |

**Bun 1.4: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |          quarry |        Bun.sql |
| ----- | --------------: | -------------: |
| 0 ms  | **234,784 ±5%** |   150,549 ±10% |
| 1 ms  |  **29,031 ±8%** |     27,510 ±4% |
| 5 ms  |   **8,267 ±1%** |      8,167 ±1% |
| 20 ms |      2,353 ±<1% | **2,354 ±<1%** |

**Bun 1.4: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |          quarry |         Bun.sql |
| ----- | --------------: | --------------: |
| 0 ms  | **110,190 ±6%** |      87,980 ±4% |
| 1 ms  |      24,000 ±6% | **78,429 ±29%** |
| 5 ms  |       7,912 ±2% |  **15,786 ±2%** |
| 20 ms |       2,320 ±1% |  **4,664 ±<1%** |

**Bun 1.4: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |      Bun.sql |
| ----- | ----------------: | -----------: |
| 0 ms  |   **310 µs ±14%** |   418 µs ±1% |
| 1 ms  |   **2.01 ms ±2%** |  2.26 ms ±9% |
| 5 ms  |   **6.35 ms ±1%** |  6.60 ms ±1% |
| 20 ms | **21.47 ms ±<1%** | 21.75 ms ±1% |

**Bun 1.4: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |           quarry |           Bun.sql |
| ----- | ---------------: | ----------------: |
| 0 ms  |   **122 µs ±2%** |       162 µs ±24% |
| 1 ms  |  **4.22 ms ±4%** |       4.27 ms ±1% |
| 5 ms  | **17.45 ms ±2%** |     17.49 ms ±<1% |
| 20 ms |    62.97 ms ±<1% | **62.78 ms ±<1%** |

**Bun 1.4: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |      Bun.sql |
| ----- | ---------------: | -----------: |
| 0 ms  | **191,952 ±24%** | 143,818 ±11% |
| 1 ms  |   **26,868 ±3%** |   26,239 ±2% |
| 5 ms  |    **8,214 ±1%** |    8,169 ±2% |
| 20 ms |   **2,360 ±<1%** |   2,357 ±<1% |

**Bun 1.4: connect + select 1 + close: median latency by RTT**

| RTT   |       quarry |          Bun.sql |
| ----- | -----------: | ---------------: |
| 0 ms  | 2.87 ms ±14% | **2.67 ms ±19%** |
| 1 ms  |  5.26 ms ±8% |  **5.01 ms ±3%** |
| 5 ms  | 14.18 ms ±4% | **14.03 ms ±2%** |
| 20 ms | 44.99 ms ±1% | **44.08 ms ±1%** |

## PgBouncer

**Node 24 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |         quarry | quarry (prepare: false) |          pg |    pg (named) |      pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | -------------: | ----------------------: | ----------: | ------------: | -------------: | ----------: | ---------------------------: |
| select 1                                               |     19,685 ±3% |              18,576 ±3% |  20,187 ±3% |    18,519 ±5% | **20,339 ±4%** |  18,439 ±3% |                   18,632 ±3% |
| point lookup by primary key                            | **17,181 ±3%** |              13,481 ±4% |  13,385 ±5% |    15,425 ±2% |     14,071 ±2% |  15,873 ±2% |                   8,296 ±19% |
| point lookup by primary key, concurrency 50            |     75,233 ±7% |        **120,469 ±10%** |  64,644 ±5% |    61,289 ±3% |     71,696 ±4% |  39,235 ±5% |                   38,288 ±3% |
| fetch 1k rows (6 columns)                              |  **2,194 ±3%** |               1,083 ±4% |     709 ±3% |       719 ±4% |        597 ±5% |     773 ±4% |                      788 ±5% |
| insert one row                                         | **17,807 ±5%** |              15,172 ±6% | 15,340 ±10% |    16,989 ±2% |     15,871 ±6% |  16,030 ±2% |                    8,662 ±2% |
| transaction: begin; insert; commit                     |      6,580 ±3% |               6,261 ±2% |   6,460 ±3% | **6,758 ±9%** |      6,473 ±3% |   5,826 ±6% |                    4,518 ±1% |
| insert one row, concurrency 50                         |     76,310 ±8% |         **119,576 ±3%** |  81,176 ±3% |    67,242 ±5% |     82,375 ±2% |  37,952 ±5% |                   38,723 ±6% |
| query that fails (division by zero), connection reused |     14,686 ±3% |          **14,834 ±2%** |   5,464 ±4% |    5,022 ±10% |      4,541 ±7% |  11,378 ±2% |                   11,873 ±3% |

**Node 24 through PgBouncer: median latency**

| Scenario                                               |      quarry | quarry (prepare: false) |      pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | ----------: | ----------------------: | ------: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                                               | **46.6 µs** |                 49.4 µs | 46.7 µs |    49.9 µs |   46.6 µs |     49.7 µs |                      49.6 µs |
| point lookup by primary key                            | **53.7 µs** |                 69.8 µs | 70.2 µs |    60.1 µs |   67.0 µs |     58.9 µs |                       113 µs |
| point lookup by primary key, concurrency 50            |      639 µs |              **312 µs** |  710 µs |     764 µs |    655 µs |     1.18 ms |                      1.17 ms |
| fetch 1k rows (6 columns)                              |  **412 µs** |                  865 µs | 1.42 ms |    1.40 ms |   1.67 ms |     1.11 ms |                      1.07 ms |
| insert one row                                         | **52.2 µs** |                 60.8 µs | 61.1 µs |    53.8 µs |   59.9 µs |     57.8 µs |                       108 µs |
| transaction: begin; insert; commit                     |      143 µs |                  150 µs |  146 µs | **141 µs** |    146 µs |      158 µs |                       208 µs |
| insert one row, concurrency 50                         |      630 µs |              **387 µs** |  568 µs |     698 µs |    567 µs |     1.21 ms |                      1.13 ms |
| query that fails (division by zero), connection reused |     63.3 µs |             **62.4 µs** |  166 µs |     178 µs |    201 µs |     78.5 µs |                      77.2 µs |

**Node 24: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | quarry (prepare: false) |  pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ---------------------------------- | -----: | ----------------------: | --: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                           |    50% |                     57% | 57% |        52% |   **68%** |         57% |                          58% |
| point lookup by primary key        |    55% |                     72% | 72% |        62% |   **77%** |         61% |                          63% |
| fetch 1k rows (6 columns)          |    96% |                     96% | 94% |        95% |   **97%** |         93% |                          97% |
| insert one row                     |    54% |                     65% | 64% |        56% |   **76%** |         58% |                          62% |
| transaction: begin; insert; commit |    49% |                       — | 57% |        53% |   **68%** |         59% |                            — |

**Bun 1.4 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |          quarry |        Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | --------------: | -------------: | -----------------------: |
| select 1                                               |  **21,526 ±3%** |     21,229 ±5% |               21,369 ±1% |
| point lookup by primary key                            | **18,902 ±21%** |     16,916 ±4% |               14,414 ±8% |
| point lookup by primary key, concurrency 50            |  **76,886 ±8%** |     54,697 ±2% |               56,669 ±5% |
| fetch 1k rows (6 columns)                              |   **2,806 ±4%** |      2,180 ±3% |                2,142 ±1% |
| insert one row                                         |  **19,011 ±2%** |     16,747 ±4% |               14,807 ±7% |
| transaction: begin; insert; commit                     |   **7,105 ±2%** |      6,919 ±2% |                6,440 ±2% |
| insert one row, concurrency 50                         |  **78,076 ±1%** |     55,641 ±4% |              56,880 ±16% |
| query that fails (division by zero), connection reused |      16,062 ±5% | **18,692 ±1%** |               18,489 ±5% |

**Bun 1.4 through PgBouncer: median latency**

| Scenario                                               |      quarry |     Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | ----------: | ----------: | -----------------------: |
| select 1                                               | **44.3 µs** |     45.2 µs |                  44.7 µs |
| point lookup by primary key                            | **50.7 µs** |     57.4 µs |                  66.3 µs |
| point lookup by primary key, concurrency 50            |  **630 µs** |      888 µs |                   841 µs |
| fetch 1k rows (6 columns)                              |  **326 µs** |      442 µs |                   443 µs |
| insert one row                                         | **49.5 µs** |     56.8 µs |                  64.0 µs |
| transaction: begin; insert; commit                     |  **135 µs** |      139 µs |                   150 µs |
| insert one row, concurrency 50                         |  **621 µs** |      883 µs |                   839 µs |
| query that fails (division by zero), connection reused |     57.7 µs | **50.2 µs** |                  50.2 µs |

**Bun 1.4: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | Bun.sql | Bun.sql (prepare: false) |
| ---------------------------------- | -----: | ------: | -----------------------: |
| select 1                           |    47% | **55%** |                      54% |
| point lookup by primary key        |    54% |     50% |                  **65%** |
| fetch 1k rows (6 columns)          |    88% | **88%** |                      88% |
| insert one row                     |    53% |     51% |                  **59%** |
| transaction: begin; insert; commit |    49% | **64%** |                        — |

## Server restart

`pg_ctl restart -m fast` while a pool runs `select 1` every 5 ms (2 s client timeout per query).

| Runtime  | Client                   | Recovered | Time from server up to first success (median) | Failed queries (median) |
| -------- | ------------------------ | --------: | --------------------------------------------: | ----------------------: |
| Node 24  | quarry                   |       5/5 |                                       1.00 ms |                      29 |
| Node 24  | pg                       |       5/5 |                                       2.00 ms |                      29 |
| Node 24  | pg (named)               |       5/5 |                                       3.00 ms |                      28 |
| Node 24  | pg-native                |       5/5 |                                       2.00 ms |                      26 |
| Node 24  | postgres.js              |       5/5 |                                      56.00 ms |                      17 |
| Bun 1.4  | quarry                   |       5/5 |                                       2.00 ms |                      29 |
| Bun 1.4  | postgres.js              |       5/5 |                                      67.00 ms |                      16 |
| Bun 1.4  | Bun.sql                  |       5/5 |                                       3.00 ms |                      17 |
| Deno 2.9 | quarry                   |       5/5 |                                       4.00 ms |                      25 |
| Deno 2.9 | deno-postgres (+nodelay) |       0/5 |                                             — |                       — |

## Footprint and cold start

| Package                                              | Installed size | Packages installed |
| ---------------------------------------------------- | -------------: | -----------------: |
| quarry (whole package: query builder + driver + src) |       1931 KiB |                  1 |
| pg                                                   |        464 KiB |                 14 |
| pg + pg-native (libpq addon, built)                  |       1377 KiB |                 19 |
| postgres.js                                          |        293 KiB |                  1 |
| @neondatabase/serverless (+ ws on Node)              |        582 KiB |                  2 |
| deno-postgres (jsr, source modules)                  |        531 KiB |                  7 |
| Bun.sql (built into Bun)                             |          0 KiB |                  0 |

| Bundle (esbuild, minified, platform node) |                                                  Size |     gzip |
| ----------------------------------------- | ----------------------------------------------------: | -------: |
| quarry/driver                             |                                              79.3 KiB | 26.8 KiB |
| pg                                        |                                              84.4 KiB | 26.3 KiB |
| postgres.js                               |                                              37.1 KiB | 14.3 KiB |
| @neondatabase/serverless                  |                                             142.9 KiB | 46.3 KiB |
| pg-native                                 | native addon (libpq .node + libpq.so): not bundleable |          |

| Runtime / client   |   Import | Connect + first query | Process start → first result | Wall time of the process |
| ------------------ | -------: | --------------------: | ---------------------------: | -----------------------: |
| node/none          |   2.2 µs |                8.3 µs |                     41.33 ms |                 48.63 ms |
| node/quarry        |  4.53 ms |              13.49 ms |                     59.75 ms |                 68.14 ms |
| node/pg            | 20.44 ms |               6.65 ms |                     69.36 ms |                 75.19 ms |
| node/pg-native     | 20.07 ms |               8.22 ms |                     70.44 ms |                 77.77 ms |
| node/postgres.js   | 16.18 ms |               9.16 ms |                     66.37 ms |                 75.22 ms |
| node/neon          | 22.52 ms |              11.04 ms |                     75.91 ms |                 82.05 ms |
| bun/none           |   0.8 µs |               12.3 µs |                      1.85 ms |                  4.64 ms |
| bun/quarry         |  6.01 ms |              14.21 ms |                     22.09 ms |                 27.98 ms |
| bun/pg             | 13.94 ms |               8.43 ms |                     24.03 ms |                 27.64 ms |
| bun/postgres.js    | 12.71 ms |               9.54 ms |                     24.29 ms |                 30.56 ms |
| bun/bun.sql        |  3.24 ms |               4.02 ms |                      9.11 ms |                 12.77 ms |
| deno/none          |   2.2 µs |               17.9 µs |                     10.66 ms |                 22.40 ms |
| deno/quarry        |  1.85 ms |              12.49 ms |                     24.79 ms |                 37.83 ms |
| deno/pg            | 13.57 ms |               8.01 ms |                     33.82 ms |                 44.52 ms |
| deno/postgres.js   | 12.00 ms |              11.42 ms |                     34.29 ms |                 48.96 ms |
| deno/deno-postgres | 16.64 ms |               5.53 ms |                     32.37 ms |                 43.40 ms |
