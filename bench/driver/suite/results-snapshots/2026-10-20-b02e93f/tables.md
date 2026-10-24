### Correctness

Every result compared in canonical form (see `canon.ts`) against the majority digest for its runtime and scenario.

608 (runtime, client, scenario) results checked; 0 differ from the majority.

### Failed runs

- reconnect deno deno-postgres (+nodelay) reconnect (max 10, c -, rtt -): 5 failed: BrokenPipe: Broken pipe (os error 32)

## Node 24

**Node 24: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |          quarry |          pg |   pg (named) |   pg-native |  postgres.js |    neon (WS) |
| ------------------------------------------------------------- | --------------: | ----------: | -----------: | ----------: | -----------: | -----------: |
| select 1                                                      | **21.4 µs ±1%** | 26.2 µs ±2% |  26.2 µs ±2% | 31.5 µs ±1% |  28.2 µs ±1% |  46.0 µs ±2% |
| point lookup by primary key                                   | **26.4 µs ±1%** | 46.1 µs ±2% |  34.5 µs ±1% | 50.0 µs ±1% |  32.6 µs ±1% |  78.3 µs ±2% |
| range scan, 100 rows                                          | **88.1 µs ±4%** |  188 µs ±2% |   182 µs ±2% |  198 µs ±3% |   154 µs ±2% |   226 µs ±2% |
| fetch 1k rows (6 columns)                                     | **311 µs ±<1%** | 1.34 ms ±2% |  1.30 ms ±1% | 1.62 ms ±2% |   918 µs ±4% | 1.52 ms ±12% |
| 100 parameters (id in (…)), 100 rows                          |  **227 µs ±1%** | 314 µs ±<1% |   259 µs ±1% |  321 µs ±2% |   273 µs ±4% |   338 µs ±2% |
| 1000 parameters (id in (…)), 1000 rows                        | **1.93 ms ±2%** | 2.48 ms ±1% |  2.04 ms ±2% | 2.72 ms ±1% | 2.17 ms ±<1% |  2.45 ms ±3% |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **1.73 ms ±6%** | 2.07 ms ±2% | 1.92 ms ±20% | 2.28 ms ±2% |  1.94 ms ±2% |  2.16 ms ±5% |
| insert one row                                                | **25.8 µs ±3%** | 38.7 µs ±1% |  30.1 µs ±1% | 43.9 µs ±1% | 33.4 µs ±41% |  68.8 µs ±6% |
| multi-row insert: 100 rows, 300 parameters                    |  **193 µs ±1%** | 298 µs ±10% |  218 µs ±15% |  312 µs ±3% |  334 µs ±21% |  297 µs ±17% |
| update one row by primary key                                 | **30.5 µs ±2%** | 45.6 µs ±1% |  34.7 µs ±2% | 51.4 µs ±1% |  35.9 µs ±1% |  80.1 µs ±4% |
| upsert (insert … on conflict do update)                       | **31.1 µs ±1%** | 43.9 µs ±1% |  35.3 µs ±1% | 49.2 µs ±1% |  36.9 µs ±1% |  77.6 µs ±2% |
| delete one row by primary key                                 | **25.4 µs ±1%** | 37.6 µs ±1% |  29.6 µs ±1% | 42.9 µs ±2% |  31.1 µs ±3% | 70.1 µs ±54% |
| transaction: begin; select 1; commit                          | **45.6 µs ±1%** | 68.7 µs ±3% |  69.5 µs ±1% | 83.6 µs ±1% |  80.7 µs ±1% |  128 µs ±56% |
| transaction: begin; insert; commit                            | **50.7 µs ±1%** | 80.9 µs ±1% |  71.9 µs ±3% | 98.2 µs ±1% |  87.0 µs ±5% |   150 µs ±1% |
| transaction with 5 savepoints (select 1 in each)              |  **257 µs ±1%** |  377 µs ±1% |   383 µs ±1% |  463 µs ±2% |   329 µs ±2% |  719 µs ±62% |
| query that fails (division by zero), connection reused        | **33.7 µs ±1%** | 2.27 ms ±1% | 2.32 ms ±12% | 4.69 ms ±1% |  53.2 µs ±2% | 2.59 ms ±14% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **30.6 µs ±1%** | 40.9 µs ±1% |  37.0 µs ±1% | 46.6 µs ±1% | 36.1 µs ±44% |  73.9 µs ±5% |

**Node 24: throughput, sequential (operations/s)**

| Scenario                                                      |         quarry |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ------------------------------------------------------------- | -------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| select 1                                                      | **44,934 ±1%** |  35,429 ±3% |  35,418 ±4% |  30,615 ±4% |  32,906 ±1% |  20,053 ±4% |
| point lookup by primary key                                   | **36,006 ±2%** | 20,313 ±12% |  26,983 ±1% |  19,063 ±2% |  28,542 ±2% |  11,824 ±3% |
| range scan, 100 rows                                          | **10,582 ±9%** |   4,894 ±3% |   5,048 ±4% |   4,885 ±3% |   5,768 ±5% |   4,071 ±8% |
| fetch 1k rows (6 columns)                                     |  **3,037 ±1%** |     761 ±2% |     779 ±1% |     633 ±3% |     943 ±4% |    640 ±10% |
| 100 parameters (id in (…)), 100 rows                          |  **4,341 ±3%** |   3,023 ±2% |   3,733 ±5% |  3,009 ±12% |   3,428 ±3% |   2,826 ±2% |
| 1000 parameters (id in (…)), 1000 rows                        |    **512 ±3%** |     399 ±4% |     480 ±5% |     363 ±1% |     446 ±1% |    397 ±14% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |    **568 ±5%** |     478 ±2% |    514 ±17% |     428 ±3% |     502 ±4% |     451 ±6% |
| insert one row                                                | **36,737 ±5%** |  24,356 ±1% |  31,047 ±1% | 21,641 ±11% | 27,844 ±28% |  13,523 ±5% |
| multi-row insert: 100 rows, 300 parameters                    |  **4,933 ±3%** |  3,197 ±10% |  4,328 ±13% |   3,062 ±4% |  2,849 ±15% |  3,165 ±12% |
| update one row by primary key                                 | **31,974 ±5%** | 21,070 ±<1% | 27,499 ±12% |  18,630 ±1% |  26,715 ±4% |  11,561 ±9% |
| upsert (insert … on conflict do update)                       | **30,786 ±5%** |  21,708 ±1% | 26,984 ±12% |  19,398 ±3% |  25,538 ±2% |  11,942 ±2% |
| delete one row by primary key                                 | **37,519 ±1%** |  25,052 ±1% |  31,654 ±2% |  22,090 ±5% |  30,021 ±3% | 13,193 ±34% |
| transaction: begin; select 1; commit                          | **20,497 ±7%** |  13,953 ±6% |  13,749 ±2% |  11,382 ±2% |  11,515 ±1% |  7,379 ±29% |
| transaction: begin; insert; commit                            | **18,519 ±1%** |  11,875 ±2% | 13,200 ±13% |   9,694 ±2% |  10,639 ±6% |   6,264 ±1% |
| transaction with 5 savepoints (select 1 in each)              |  **3,712 ±1%** |   2,535 ±2% |   2,512 ±3% |   2,083 ±2% |   2,852 ±4% |  1,308 ±38% |
| query that fails (division by zero), connection reused        | **28,106 ±1%** |     432 ±1% |    421 ±12% |     211 ±2% |  17,207 ±4% |    373 ±11% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **31,014 ±1%** |  22,492 ±2% |  24,816 ±1% |  20,401 ±3% | 25,106 ±30% |  12,123 ±7% |

**Node 24: tail latency p99, sequential**

| Scenario                                                      |      quarry |         pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ---------: | ---------: | --------: | ----------: | --------: |
| select 1                                                      | **27.4 µs** |    40.3 µs |    44.4 µs |   43.9 µs |     43.0 µs |   83.3 µs |
| point lookup by primary key                                   | **35.8 µs** |    71.9 µs |    55.8 µs |   67.6 µs |     51.4 µs |    164 µs |
| range scan, 100 rows                                          |  **244 µs** |     540 µs |     555 µs |    337 µs |      250 µs |    624 µs |
| fetch 1k rows (6 columns)                                     |  **688 µs** |    1.74 ms |    1.77 ms |   1.80 ms |     5.50 ms |   2.34 ms |
| 100 parameters (id in (…)), 100 rows                          |  **305 µs** |     625 µs |     511 µs |    589 µs |      400 µs |    772 µs |
| 1000 parameters (id in (…)), 1000 rows                        | **2.24 ms** |    3.02 ms |    2.59 ms |   3.09 ms |     3.49 ms |   3.41 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.05 ms** |    2.54 ms |    2.29 ms |   2.79 ms |     3.75 ms |   2.84 ms |
| insert one row                                                | **43.3 µs** |    66.5 µs |    54.9 µs |   71.0 µs |     57.1 µs |    128 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **270 µs** |     531 µs |     350 µs |    535 µs |      632 µs |    568 µs |
| update one row by primary key                                 | **39.8 µs** |    65.7 µs |    51.7 µs |   73.9 µs |     51.5 µs |    167 µs |
| upsert (insert … on conflict do update)                       | **43.5 µs** |    64.7 µs |    55.3 µs |   72.6 µs |     54.7 µs |    147 µs |
| delete one row by primary key                                 | **33.8 µs** |    55.4 µs |    47.8 µs |   60.7 µs |     48.3 µs |    147 µs |
| transaction: begin; select 1; commit                          | **75.1 µs** |    94.3 µs |    96.3 µs |    107 µs |      122 µs |    212 µs |
| transaction: begin; insert; commit                            | **87.4 µs** |     114 µs |     106 µs |    141 µs |      140 µs |    290 µs |
| transaction with 5 savepoints (select 1 in each)              |      634 µs | **469 µs** |     503 µs |    556 µs |      496 µs |   2.09 ms |
| query that fails (division by zero), connection reused        | **48.0 µs** |    2.94 ms |    3.03 ms |   5.41 ms |     84.3 µs |   3.78 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler | **57.5 µs** |    82.9 µs |    80.4 µs |   78.5 µs |     72.7 µs |    244 µs |

**Node 24: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |          pg | pg (named) |  pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ----------: | ---------: | ---------: | ----------: | --------: |
| select 1                                                      |  **158 µs** |      346 µs |     379 µs |     211 µs |      189 µs |    518 µs |
| point lookup by primary key                                   |      322 µs |      498 µs |     462 µs |     419 µs |  **212 µs** |    618 µs |
| range scan, 100 rows                                          |      579 µs |      766 µs |     717 µs | **577 µs** |     4.66 ms |    990 µs |
| fetch 1k rows (6 columns)                                     | **1.35 ms** |     2.17 ms |    2.01 ms |    2.75 ms |     9.82 ms |   2.80 ms |
| 100 parameters (id in (…)), 100 rows                          |  **757 µs** |     1.36 ms |    1.52 ms |    1.01 ms |     3.81 ms |   1.91 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **2.78 ms** |     3.87 ms |    3.97 ms |    3.43 ms |     5.66 ms |   4.28 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     4.08 ms | **3.22 ms** |    4.54 ms |    3.43 ms |     5.98 ms |   3.97 ms |
| insert one row                                                |  **211 µs** |      451 µs |     404 µs |     404 µs |      224 µs |    534 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **546 µs** |     1.34 ms |    1.18 ms |     614 µs |     1.79 ms |   1.37 ms |
| update one row by primary key                                 |      298 µs |      466 µs |     424 µs |     448 µs |  **261 µs** |    592 µs |
| upsert (insert … on conflict do update)                       |  **264 µs** |      475 µs |     417 µs |     439 µs |      295 µs |    628 µs |
| delete one row by primary key                                 |  **139 µs** |      425 µs |     419 µs |     352 µs |      140 µs |    616 µs |
| transaction: begin; select 1; commit                          |      506 µs |  **452 µs** |     530 µs |     594 µs |      966 µs |   1.78 ms |
| transaction: begin; insert; commit                            |  **530 µs** |      619 µs |     626 µs |     654 µs |     1.23 ms |   1.79 ms |
| transaction with 5 savepoints (select 1 in each)              | **1.04 ms** |     3.21 ms |    2.80 ms |    2.14 ms |     4.19 ms |   5.33 ms |
| query that fails (division by zero), connection reused        |  **379 µs** |     3.39 ms |    3.37 ms |    7.67 ms |      514 µs |   4.30 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler |      443 µs |      527 µs |     494 µs | **424 µs** |      563 µs |    755 µs |

**Node 24: latency distribution, select 1**

| Percentile |            quarry |            pg |    pg (named) |    pg-native |  postgres.js |     neon (WS) |
| ---------- | ----------------: | ------------: | ------------: | -----------: | -----------: | ------------: |
| p50        |   **21.4 µs ±1%** |   26.2 µs ±2% |   26.2 µs ±2% |  31.5 µs ±1% |  28.2 µs ±1% |   46.0 µs ±2% |
| p90        |   **22.3 µs ±1%** |   27.8 µs ±9% |  27.8 µs ±18% | 32.4 µs ±18% |  30.9 µs ±2% |   50.7 µs ±4% |
| p99        |   **27.4 µs ±9%** |  40.3 µs ±15% |   44.4 µs ±7% | 43.9 µs ±10% |  43.0 µs ±2% |  83.3 µs ±11% |
| p99.9      |   **158 µs ±34%** |   346 µs ±20% |    379 µs ±4% |  211 µs ±57% |  189 µs ±51% |    518 µs ±8% |
| max        | **721 µs ±1103%** | 2.32 ms ±146% | 1.51 ms ±369% | 2.65 ms ±42% | 5.41 ms ±15% | 3.71 ms ±151% |

**Node 24: latency distribution, point lookup by primary key**

| Percentile |          quarry |           pg |        pg (named) |     pg-native |     postgres.js |    neon (WS) |
| ---------- | --------------: | -----------: | ----------------: | ------------: | --------------: | -----------: |
| p50        | **26.4 µs ±1%** |  46.1 µs ±2% |       34.5 µs ±1% |   50.0 µs ±1% |     32.6 µs ±1% |  78.3 µs ±2% |
| p90        | **27.6 µs ±2%** | 50.3 µs ±49% |       37.0 µs ±5% |   53.3 µs ±3% |     36.1 µs ±2% |  88.4 µs ±6% |
| p99        | **35.8 µs ±5%** | 71.9 µs ±26% |       55.8 µs ±8% |   67.6 µs ±3% |     51.4 µs ±9% |  164 µs ±15% |
| p99.9      |     322 µs ±60% |   498 µs ±6% |       462 µs ±12% |   419 µs ±14% | **212 µs ±51%** |  618 µs ±37% |
| max        |   2.11 ms ±246% | 2.78 ms ±80% | **1.28 ms ±250%** | 3.19 ms ±188% |    5.27 ms ±31% | 3.14 ms ±59% |

**Node 24: large results and bulk work, time per operation (median)**

| Scenario                                                                    |            quarry |               pg |   pg (named) |    pg-native |   postgres.js |    neon (WS) |
| --------------------------------------------------------------------------- | ----------------: | ---------------: | -----------: | -----------: | ------------: | -----------: |
| fetch 100k rows                                                             | **24.72 ms ±23%** |       116 ms ±5% |   118 ms ±4% |   141 ms ±1% |  92.50 ms ±4% |   130 ms ±6% |
| fetch 1M rows (one result)                                                  |   **398 ms ±13%** |      1296 ms ±3% |  1261 ms ±4% |  1499 ms ±3% |   1043 ms ±7% |  1395 ms ±4% |
| wide rows: 1k rows × 100 columns                                            |   **3.48 ms ±4%** |     14.03 ms ±1% | 13.98 ms ±1% | 21.26 ms ±1% |  14.20 ms ±2% | 16.00 ms ±1% |
| large values: 10 × 1 MB text                                                |  **4.74 ms ±12%** |      5.65 ms ±7% |  5.66 ms ±3% | 11.39 ms ±3% |   4.79 ms ±4% |  8.74 ms ±6% |
| large values: 10 × 1 MB bytea                                               |   **3.54 ms ±3%** |     17.09 ms ±4% | 17.21 ms ±2% | 32.01 ms ±4% |  15.57 ms ±2% | 24.23 ms ±6% |
| large values: 20 × 200 KB jsonb                                             |      24.76 ms ±4% | **23.87 ms ±3%** | 24.22 ms ±4% | 37.46 ms ±1% |  25.26 ms ±7% | 26.10 ms ±5% |
| arrays: 1k rows of int4[100] + text[20]                                     |   **3.26 ms ±8%** |     21.99 ms ±3% | 21.80 ms ±1% | 25.68 ms ±1% |   8.17 ms ±6% | 24.04 ms ±3% |
| bulk insert 10k rows (unnest arrays)                                        |  **12.67 ms ±6%** |     13.06 ms ±2% | 12.84 ms ±1% | 12.81 ms ±5% |  12.98 ms ±2% | 13.79 ms ±2% |
| bulk insert 10k rows (unnest, JS array parameters)                          |  **12.99 ms ±3%** |     15.80 ms ±2% | 15.42 ms ±4% | 15.65 ms ±2% |  16.24 ms ±2% | 16.42 ms ±2% |
| bulk insert 1k rows (unnest, JS array parameters)                           |   **1.47 ms ±4%** |      1.84 ms ±3% |  1.78 ms ±4% |  1.84 ms ±2% |   1.80 ms ±2% |  1.99 ms ±2% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |  **12.60 ms ±2%** |     12.72 ms ±1% | 12.74 ms ±2% |          n/a | 55.95 ms ±<1% |          n/a |
| stream 1M rows with a cursor (1000 per batch)                               |    **310 ms ±3%** |      1234 ms ±3% |  1258 ms ±2% |          n/a |   1036 ms ±2% |          n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |    **553 ms ±2%** |       712 ms ±1% |   709 ms ±1% |          n/a |    675 ms ±1% |          n/a |

**Node 24: large results and bulk work, time per operation (mean)**

| Scenario                                                                    |            quarry |               pg |       pg (named) |     pg-native |     postgres.js |    neon (WS) |
| --------------------------------------------------------------------------- | ----------------: | ---------------: | ---------------: | ------------: | --------------: | -----------: |
| fetch 100k rows                                                             | **26.12 ms ±19%** |       118 ms ±4% |       120 ms ±2% |    144 ms ±2% |    94.89 ms ±2% |   133 ms ±5% |
| fetch 1M rows (one result)                                                  |    **412 ms ±7%** |      1295 ms ±3% |      1289 ms ±3% |   1549 ms ±3% |     1038 ms ±4% |  1383 ms ±2% |
| wide rows: 1k rows × 100 columns                                            |   **3.81 ms ±8%** |     14.08 ms ±3% |     14.06 ms ±1% |  21.30 ms ±1% |    16.30 ms ±5% | 16.15 ms ±1% |
| large values: 10 × 1 MB text                                                |       5.65 ms ±7% |      5.93 ms ±7% |      6.01 ms ±4% |  11.74 ms ±3% | **5.49 ms ±6%** |  8.81 ms ±6% |
| large values: 10 × 1 MB bytea                                               |   **4.46 ms ±4%** |     17.41 ms ±4% |     17.47 ms ±2% |  32.35 ms ±3% |    15.65 ms ±2% | 24.58 ms ±5% |
| large values: 20 × 200 KB jsonb                                             |      26.43 ms ±2% | **25.33 ms ±6%** |     25.87 ms ±4% | 37.74 ms ±10% |    26.57 ms ±3% | 27.78 ms ±3% |
| arrays: 1k rows of int4[100] + text[20]                                     |   **3.34 ms ±7%** |     23.18 ms ±2% |     23.51 ms ±4% |  25.81 ms ±1% |     8.94 ms ±7% | 25.41 ms ±4% |
| bulk insert 10k rows (unnest arrays)                                        |  **12.84 ms ±5%** |     13.11 ms ±1% |     13.05 ms ±2% |  12.90 ms ±3% |    13.11 ms ±2% | 13.86 ms ±2% |
| bulk insert 10k rows (unnest, JS array parameters)                          |  **13.03 ms ±2%** |     15.85 ms ±1% |     15.49 ms ±3% |  15.73 ms ±2% |    16.57 ms ±3% | 16.63 ms ±3% |
| bulk insert 1k rows (unnest, JS array parameters)                           |   **1.45 ms ±4%** |      1.86 ms ±4% |      1.80 ms ±4% |   1.87 ms ±3% |     1.83 ms ±2% |  2.02 ms ±2% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |      12.72 ms ±1% |     12.78 ms ±1% | **12.72 ms ±3%** |           n/a |    56.04 ms ±2% |          n/a |
| stream 1M rows with a cursor (1000 per batch)                               |    **313 ms ±2%** |      1241 ms ±2% |      1259 ms ±2% |           n/a |     1037 ms ±3% |          n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |    **555 ms ±2%** |       716 ms ±1% |       710 ms ±1% |           n/a |      680 ms ±1% |          n/a |

**Node 24: rows per second (median)**

| Scenario                                           |        quarry |      pg |  pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | ------------: | ------: | ----------: | --------: | ----------: | --------: |
| fetch 1k rows (6 columns)                          | **3,036,921** | 760,528 |     779,367 |   632,736 |     942,516 |   639,560 |
| fetch 100k rows                                    | **3,827,133** | 846,082 |     833,509 |   696,529 |   1,053,698 |   752,791 |
| fetch 1M rows (one result)                         | **2,426,389** | 772,411 |     775,738 |   645,708 |     963,476 |   723,095 |
| wide rows: 1k rows × 100 columns                   |   **262,394** |  70,981 |      71,076 |    46,938 |      61,320 |    61,909 |
| arrays: 1k rows of int4[100] + text[20]            |   **298,866** |  43,132 |      42,525 |    38,741 |     111,739 |    39,346 |
| stream 1M rows with a cursor (1000 per batch)      | **3,195,204** | 805,674 |     794,562 |       n/a |     964,641 |       n/a |
| bulk insert 10k rows (unnest arrays)               |   **778,616** | 762,331 |     766,161 |   774,682 |     762,889 |   721,132 |
| bulk insert 10k rows (unnest, JS array parameters) |   **767,293** | 630,640 |     645,459 |   635,439 |     603,195 |   601,167 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **688,256** | 536,433 |     555,318 |   534,124 |     544,972 |   494,873 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       785,940 | 782,589 | **786,125** |       n/a |     178,422 |       n/a |

**Node 24: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------- | ------: | ----: | ---------: | --------: | ----------: | --------: |
| fetch 100k rows × 5                               | **178** |   363 |        364 |       394 |         319 |       382 |
| fetch 1M rows (one result) × 3                    | **736** | 1,370 |      1,368 |     1,665 |         818 |     1,396 |
| wide rows: 1k rows × 100 columns × 50             |     135 |   159 |        157 |   **135** |         318 |       234 |
| large values: 10 × 1 MB text × 20                 | **175** |   192 |        191 |       187 |         175 |       218 |
| large values: 10 × 1 MB bytea × 20                | **182** |   200 |        201 |       208 |         185 |       224 |
| large values: 20 × 200 KB jsonb × 10              |     183 |   167 |    **167** |       201 |         246 |       219 |
| arrays: 1k rows of int4[100] + text[20] × 50      | **119** |   306 |        308 |       246 |         265 |       303 |
| stream 1M rows with a cursor (1000 per batch) × 3 | **117** |   212 |        212 |       n/a |         245 |       n/a |

**Node 24: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    |  quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------------------------------------- | ------: | ----: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key                                                 | **100** |   106 |        108 |       105 |         152 |       104 |
| fetch 100k rows                                                             | **311** |   437 |        438 |       406 |         402 |       544 |
| fetch 1M rows (one result)                                                  |   1,161 | 1,387 |      1,386 |     1,782 |   **1,160** |     1,400 |
| stream 1M rows with a cursor (1000 per batch)                               | **152** |   211 |        213 |       n/a |         246 |       n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) | **103** |   121 |        121 |       n/a |         232 |       n/a |
| large values: 10 × 1 MB text                                                | **185** |   204 |        202 |       206 |         187 |       226 |
| large values: 10 × 1 MB bytea                                               |     188 |   201 |        208 |       233 |     **185** |       224 |
| large values: 20 × 200 KB jsonb                                             |     332 |   317 |        318 |   **203** |         361 |       328 |

**Node 24: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |  quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------------------- | ------: | ------: | ---------: | --------: | ----------: | --------: |
| RSS growth during pause | **0.0** | **0.0** |        0.3 |       n/a |         0.1 |       n/a |

**Node 24: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |      quarry | quarry (lossless) |        pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------- | ----------: | ----------------: | --------: | ---------: | --------: | ----------: | --------: |
| int4                 |      76 ±1% |        **75 ±1%** |   189 ±1% |    188 ±4% |   199 ±1% |     260 ±4% |   224 ±7% |
| int8                 |      90 ±9% |        **78 ±1%** |   196 ±7% |    195 ±9% |   216 ±1% |     236 ±4% |   281 ±4% |
| float8               |  **81 ±1%** |            81 ±7% |   205 ±5% |    200 ±2% |   231 ±4% |     282 ±4% |   272 ±6% |
| numeric              |     135 ±1% |      **135 ±<1%** |   155 ±3% |    155 ±2% |   236 ±2% |     235 ±4% |   243 ±4% |
| text                 |      95 ±4% |        **94 ±6%** |   161 ±4% |    159 ±5% |   200 ±6% |     233 ±4% |   235 ±3% |
| bool                 |  **83 ±7%** |            83 ±2% |   141 ±1% |    141 ±5% |  166 ±<1% |     210 ±5% |  161 ±28% |
| timestamptz          | **92 ±15%** |          160 ±<1% |   642 ±2% |    653 ±2% |  695 ±10% |     436 ±1% |   753 ±3% |
| date                 |     110 ±6% |       **109 ±8%** |   472 ±3% |    470 ±1% |   444 ±8% |     361 ±4% |   541 ±5% |
| uuid                 | **124 ±1%** |          125 ±11% |   153 ±5% |    155 ±5% |   228 ±2% |     240 ±3% |   187 ±2% |
| jsonb (small object) | **360 ±4%** |           364 ±5% |   410 ±5% |    411 ±3% |   547 ±2% |     494 ±4% |   497 ±4% |
| int4[5]              |     258 ±8% |       **256 ±4%** | 1,071 ±3% |  1,076 ±2% | 1,158 ±7% |     583 ±3% | 1,562 ±4% |
| bytea (16 B)         |     159 ±4% |       **158 ±2%** |   332 ±4% |    330 ±6% |   343 ±3% |     357 ±2% |   427 ±4% |

**Node 24: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |           quarry |          pg |   pg (named) |   pg-native | postgres.js |   neon (WS) |
| -------------------------------------------------- | ---------------: | ----------: | -----------: | ----------: | ----------: | ----------: |
| insert one row                                     |   **36,737 ±5%** |  24,356 ±1% |   31,047 ±1% | 21,641 ±11% | 27,844 ±28% |  13,523 ±5% |
| insert one row, concurrency 50                     | **277,475 ±13%** | 88,432 ±11% |  76,723 ±13% | 71,619 ±12% |  40,727 ±2% |  33,740 ±1% |
| multi-row insert: 100 rows, 300 parameters         |    **4,933 ±3%** |  3,197 ±10% |   4,328 ±13% |   3,062 ±4% |  2,849 ±15% |  3,165 ±12% |
| bulk insert 10k rows (unnest arrays)               |     **77.9 ±5%** |    76.2 ±1% |     76.6 ±2% |    77.5 ±3% |    76.3 ±2% |    72.1 ±2% |
| bulk insert 10k rows (unnest, JS array parameters) |     **76.7 ±2%** |    63.1 ±1% |     64.5 ±3% |    63.5 ±2% |    60.3 ±3% |    60.1 ±3% |
| bulk insert 1k rows (unnest, JS array parameters)  |      **688 ±4%** |     536 ±4% |      555 ±5% |     534 ±4% |     545 ±2% |     495 ±2% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |         78.6 ±1% |    78.3 ±1% | **78.6 ±3%** |         n/a |    17.8 ±2% |         n/a |
| update one row by primary key                      |   **31,974 ±5%** | 21,070 ±<1% |  27,499 ±12% |  18,630 ±1% |  26,715 ±4% |  11,561 ±9% |
| upsert (insert … on conflict do update)            |   **30,786 ±5%** |  21,708 ±1% |  26,984 ±12% |  19,398 ±3% |  25,538 ±2% |  11,942 ±2% |
| delete one row by primary key                      |   **37,519 ±1%** |  25,052 ±1% |   31,654 ±2% |  22,090 ±5% |  30,021 ±3% | 13,193 ±34% |

**Node 24: transactions, operations/s**

| Scenario                                         |         quarry |         pg |  pg (named) |  pg-native | postgres.js |  neon (WS) |
| ------------------------------------------------ | -------------: | ---------: | ----------: | ---------: | ----------: | ---------: |
| transaction: begin; select 1; commit             | **20,497 ±7%** | 13,953 ±6% |  13,749 ±2% | 11,382 ±2% |  11,515 ±1% | 7,379 ±29% |
| transaction: begin; insert; commit               | **18,519 ±1%** | 11,875 ±2% | 13,200 ±13% |  9,694 ±2% |  10,639 ±6% |  6,264 ±1% |
| transaction with 5 savepoints (select 1 in each) |  **3,712 ±1%** |  2,535 ±2% |   2,512 ±3% |  2,083 ±2% |   2,852 ±4% | 1,308 ±38% |

**Node 24: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | --------: | ----------: | --------: |
| select 1                                               |   **13.2** |    17.3 |       19.8 |      21.5 |        22.7 |      25.7 |
| point lookup by primary key                            |   **14.8** |    26.2 |       25.1 |      27.2 |        25.1 |      50.7 |
| fetch 1k rows (6 columns)                              |    **307** |   1,195 |      1,199 |     1,247 |       1,125 |     1,364 |
| fetch 100k rows                                        | **27,874** | 140,337 |    142,329 |   151,844 |     118,146 |   165,208 |
| insert one row                                         |   **14.5** |    19.2 |       19.3 |      23.4 |        25.8 |      42.6 |
| insert one row, concurrency 50                         |    **3.7** |    12.1 |       13.9 |      15.2 |        29.1 |      30.5 |
| transaction: begin; insert; commit                     |   **33.3** |    48.6 |       49.8 |      66.1 |        77.2 |      85.8 |
| query that fails (division by zero), connection reused |   **26.5** |     516 |        550 |     1,262 |        52.7 |     1,010 |

**Node 24: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------ | -------: | ---: | ---------: | --------: | ----------: | --------: |
| select 1                             |  **9.6** | 12.0 |        9.8 |      14.6 |        11.5 |      11.9 |
| point lookup by primary key          | **13.6** | 26.5 |       14.1 |      29.9 |        13.8 |      37.2 |
| fetch 1k rows (6 columns)            |  **235** |  406 |        371 |       478 |         386 |       458 |
| 100 parameters (id in (…)), 100 rows |  **182** |  239 |        185 |       246 |         184 |       244 |
| insert one row                       |     14.3 | 23.9 |   **14.2** |      27.5 |        14.4 |      33.6 |
| insert one row, concurrency 50       | **10.8** | 33.9 |       20.8 |      40.6 |        17.9 |      41.1 |
| transaction: begin; insert; commit   | **24.5** | 40.6 |       30.6 |      50.4 |        31.9 |      51.0 |

**Node 24: GC time (ms per second of run) / longest GC pause**

| Scenario                                       |   quarry |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ---------------------------------------------- | -------: | -------: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: GC ms/s           |     10.3 |     15.9 |       25.4 |  **10.1** |        19.5 |      17.0 |
| point lookup by primary key: max pause ms      |      0.6 |      0.5 |        0.6 |       0.6 |         4.7 |   **0.5** |
| insert one row, concurrency 50: GC ms/s        |     30.8 |     26.7 |       27.5 |  **17.9** |        23.2 |      21.5 |
| insert one row, concurrency 50: max pause ms   |      1.4 |      1.4 |        2.0 |   **1.2** |         6.0 |       1.9 |
| fetch 1k rows (6 columns): GC ms/s             |     21.3 |     29.7 |       27.6 |  **16.8** |        79.1 |      30.6 |
| fetch 1k rows (6 columns): max pause ms        |      1.1 |      0.6 |        0.5 |   **0.4** |         8.0 |       1.3 |
| fetch 100k rows: GC ms/s                       | **40.2** |     98.3 |       98.9 |      63.7 |       126.6 |     119.8 |
| fetch 100k rows: max pause ms                  |     12.1 | **11.0** |       12.2 |      11.1 |        12.8 |      11.2 |
| fetch 1M rows (one result): GC ms/s            |    211.5 |    150.6 |      142.6 |  **82.7** |       182.5 |     141.5 |
| fetch 1M rows (one result): max pause ms       |     26.1 |     22.0 |       21.0 |  **18.0** |        22.5 |      21.2 |
| wide rows: 1k rows × 100 columns: GC ms/s      |     35.5 |      6.0 |        6.0 |   **4.3** |       113.0 |       6.5 |
| wide rows: 1k rows × 100 columns: max pause ms |      2.8 |      0.4 |        0.5 |   **0.3** |         6.9 |       0.6 |
| large values: 20 × 200 KB jsonb: GC ms/s       |     27.4 |     27.1 |       29.2 |   **7.9** |        33.0 |      42.7 |
| large values: 20 × 200 KB jsonb: max pause ms  |      4.5 |      5.6 |        5.8 |   **1.4** |         4.5 |       4.9 |

**Node 24: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |   quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | -------: | ------: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: p99                   |  **0.1** |     0.2 |        0.2 |       0.2 |         2.0 |       0.2 |
| point lookup by primary key: max                   |      0.4 | **0.3** |        0.3 |       0.3 |         2.0 |       0.3 |
| insert one row, concurrency 50: p99                |      0.8 |     0.4 |    **0.4** |       0.4 |         3.0 |       0.6 |
| insert one row, concurrency 50: max                |      0.8 |     0.9 |    **0.4** |       0.5 |         3.0 |       1.0 |
| fetch 1k rows (6 columns): p99                     |  **0.2** |     0.6 |        0.8 |       1.0 |         4.4 |       0.8 |
| fetch 1k rows (6 columns): max                     |      1.0 |     0.9 |    **0.8** |       1.0 |         4.4 |       1.0 |
| fetch 100k rows: p99                               | **11.8** |    34.6 |       30.5 |     111.0 |        19.1 |      36.2 |
| fetch 100k rows: max                               | **13.9** |    34.6 |       30.5 |     111.0 |        21.2 |      36.2 |
| fetch 1M rows (one result): p99                    | **30.9** |    38.6 |       46.0 |   1,188.3 |        31.8 |      70.4 |
| fetch 1M rows (one result): max                    | **32.6** |    67.8 |       65.3 |   1,188.3 |        33.5 |      91.9 |
| stream 1M rows with a cursor (1000 per batch): p99 |  **0.2** |     0.8 |        1.0 |       n/a |         5.2 |       n/a |
| stream 1M rows with a cursor (1000 per batch): max |  **0.4** |     1.3 |        1.6 |       n/a |         7.5 |       n/a |

**Node 24: connections (median time per operation)**

| Scenario                                                    |          quarry |          pg |  pg (named) |    pg-native |  postgres.js |       neon (WS) |
| ----------------------------------------------------------- | --------------: | ----------: | ----------: | -----------: | -----------: | --------------: |
| connect + select 1 + close (no TLS, trust)                  | **2.29 ms ±1%** | 3.88 ms ±3% | 3.96 ms ±4% |  4.68 ms ±2% |  6.76 ms ±1% |    4.19 ms ±10% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | **2.59 ms ±2%** | 5.22 ms ±3% | 5.20 ms ±3% |  7.14 ms ±1% |  7.74 ms ±5% |    68.08 ms ±1% |
| connect + select 1 + close (TLS verify-full, trust)         |     4.88 ms ±3% | 4.95 ms ±1% | 5.09 ms ±7% |  4.96 ms ±5% | 52.20 ms ±5% | **4.34 ms ±2%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) | **5.19 ms ±1%** | 6.59 ms ±1% | 6.51 ms ±2% |  7.27 ms ±8% | 53.28 ms ±4% |    68.30 ms ±2% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     | **7.71 ms ±3%** | 8.16 ms ±2% | 8.43 ms ±2% | 13.10 ms ±2% | 14.26 ms ±4% |     8.24 ms ±3% |

**Node 24: cancellation, notifications, errors**

| Scenario                                      |        quarry |        pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------- | ------------: | --------: | ---------: | --------: | ----------: | --------: |
| cancel: time from cancel() to rejection (p50) |   **1.44 ms** |   1.46 ms |    1.47 ms |   2.19 ms |     1.48 ms |       n/a |
| cancel: share of queries actually cancelled   |      **100%** |  **100%** |   **100%** |  **100%** |    **100%** |       n/a |
| NOTIFY latency p50                            |   **30.6 µs** |   40.9 µs |    37.0 µs |   46.6 µs |     36.1 µs |   73.9 µs |
| NOTIFY latency p99                            |   **57.5 µs** |   82.9 µs |    80.4 µs |   78.5 µs |     72.7 µs |    244 µs |
| NOTIFY throughput (notifications/s)           | **2,549,175** | 2,082,678 |  2,018,389 |   835,105 |   1,749,175 | 1,718,527 |
| error path: failing queries/s                 |    **28,106** |       432 |        421 |       211 |      17,207 |       373 |

**Node 24: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |              pg-native |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 44,934 / 32,869 / +37% |  35,418 / 35,429 / -0% |  30,777 / 30,615 / +1% |   32,906 / 33,094 / -1% |
| point lookup by primary key             | 36,006 / 18,483 / +95% | 26,983 / 20,313 / +33% | 24,362 / 19,063 / +28% | 28,542 / 13,625 / +109% |
| range scan, 100 rows                    |  10,582 / 6,275 / +69% |    5,048 / 4,894 / +3% |    5,014 / 4,885 / +3% |    5,768 / 4,800 / +20% |
| fetch 1k rows (6 columns)               |  3,037 / 1,261 / +141% |        779 / 761 / +2% |        650 / 633 / +3% |         943 / 923 / +2% |
| 100 parameters (id in (…)), 100 rows    |   4,341 / 3,182 / +36% |   3,733 / 3,023 / +23% |   3,717 / 3,009 / +24% |    3,428 / 2,602 / +32% |
| 1000 parameters (id in (…)), 1000 rows  |       512 / 415 / +23% |       480 / 399 / +21% |       440 / 363 / +21% |        446 / 353 / +26% |
| insert one row                          | 36,737 / 26,689 / +38% | 31,047 / 24,356 / +27% | 26,595 / 21,641 / +23% |  27,844 / 14,543 / +91% |
| upsert (insert … on conflict do update) | 30,786 / 23,223 / +33% | 26,984 / 21,708 / +24% | 23,375 / 19,398 / +21% |  25,538 / 13,855 / +84% |

**Node 24: quarry decoding modes (time per op)**

| Scenario                                |            quarry | quarry (lossless) |
| --------------------------------------- | ----------------: | ----------------: |
| point lookup by primary key             |   **26.4 µs ±1%** |       26.5 µs ±3% |
| fetch 1k rows (6 columns)               |   **311 µs ±<1%** |        343 µs ±6% |
| fetch 100k rows                         | **24.72 ms ±23%** |      29.34 ms ±2% |
| fetch 1M rows (one result)              |       398 ms ±13% |   **365 ms ±20%** |
| wide rows: 1k rows × 100 columns        |   **3.48 ms ±4%** |       3.54 ms ±2% |
| arrays: 1k rows of int4[100] + text[20] |       3.26 ms ±8% |   **3.24 ms ±8%** |
| decode 100k × int8                      |       9.03 ms ±9% |   **7.83 ms ±1%** |
| decode 100k × timestamptz               |  **9.25 ms ±15%** |     16.02 ms ±<1% |
| decode 100k × date                      |      10.98 ms ±6% |  **10.93 ms ±8%** |

**Node 24: shipped defaults vs tuned (median latency)**

| Scenario                                   |   neon (WS) | neon (WS, defaults) |
| ------------------------------------------ | ----------: | ------------------: |
| select 1                                   | **46.0 µs** |             1.53 ms |
| point lookup by primary key                | **78.3 µs** |             1.66 ms |
| fetch 1k rows (6 columns)                  | **1.52 ms** |             2.96 ms |
| insert one row                             | **68.8 µs** |             1.58 ms |
| transaction: begin; insert; commit         |  **150 µs** |             4.65 ms |
| connect + select 1 + close (no TLS, trust) |     4.19 ms |                   — |

## Bun 1.4

**Bun 1.4: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |  postgres.js |         Bun.sql |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | --------------: |
| select 1                                                      |  **19.5 µs ±1%** |  22.9 µs ±1% |  21.9 µs ±2% |  24.5 µs ±1% |     24.8 µs ±1% |
| point lookup by primary key                                   |  **24.0 µs ±2%** |  40.5 µs ±1% |  28.6 µs ±2% |  27.5 µs ±2% |     28.2 µs ±1% |
| range scan, 100 rows                                          |  **75.5 µs ±3%** |   142 µs ±1% |   136 µs ±1% |   133 µs ±1% |     88.7 µs ±5% |
| fetch 1k rows (6 columns)                                     |   **262 µs ±1%** |   911 µs ±3% |   905 µs ±4% |  868 µs ±11% |      383 µs ±1% |
| 100 parameters (id in (…)), 100 rows                          |   **214 µs ±1%** |   285 µs ±3% |   230 µs ±1% |   235 µs ±1% |      217 µs ±2% |
| 1000 parameters (id in (…)), 1000 rows                        |      1.87 ms ±5% |  2.43 ms ±2% |  1.97 ms ±2% |  2.00 ms ±2% | **1.83 ms ±2%** |
| id = any($1) with 1000 ids (JS array), 1000 rows              |  **1.73 ms ±2%** |  2.07 ms ±2% |  1.92 ms ±1% |  1.92 ms ±2% |     1.80 ms ±1% |
| insert one row                                                |  **23.9 µs ±1%** |  35.8 µs ±1% |  26.5 µs ±2% |  27.9 µs ±2% |     28.4 µs ±1% |
| multi-row insert: 100 rows, 300 parameters                    |   **183 µs ±3%** |   283 µs ±2% |   198 µs ±8% |   230 µs ±5% |      188 µs ±1% |
| update one row by primary key                                 | **28.6 µs ±36%** |  42.8 µs ±2% |  30.9 µs ±1% | 31.7 µs ±<1% |     32.5 µs ±1% |
| upsert (insert … on conflict do update)                       | **28.9 µs ±<1%** |  40.8 µs ±1% |  31.4 µs ±1% |  32.3 µs ±1% |     33.4 µs ±2% |
| delete one row by primary key                                 |  **23.4 µs ±2%** |  34.6 µs ±1% |  25.7 µs ±1% |  26.9 µs ±1% |     27.7 µs ±1% |
| transaction: begin; select 1; commit                          |  **41.7 µs ±1%** |  60.0 µs ±1% |  59.5 µs ±1% |  68.9 µs ±1% |     75.3 µs ±1% |
| transaction: begin; insert; commit                            | **46.5 µs ±<1%** |  72.9 µs ±2% |  63.7 µs ±1% |  72.6 µs ±1% |    80.2 µs ±55% |
| transaction with 5 savepoints (select 1 in each)              |   **235 µs ±2%** |   336 µs ±3% |   333 µs ±1% |  288 µs ±53% |     506 µs ±14% |
| query that fails (division by zero), connection reused        |      31.0 µs ±2% |  2.20 ms ±2% | 2.22 ms ±20% |  37.1 µs ±1% | **28.1 µs ±1%** |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **28.1 µs ±1%** | 35.5 µs ±13% |  31.2 µs ±2% |  31.3 µs ±1% |    33.3 µs ±41% |

**Bun 1.4: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) | postgres.js |        Bun.sql |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ----------: | -------------: |
| select 1                                                      |  **49,977 ±9%** |  41,973 ±1% |  43,884 ±2% |  39,334 ±1% |     39,165 ±3% |
| point lookup by primary key                                   | **40,755 ±16%** |  23,734 ±2% |  33,446 ±2% |  34,927 ±2% |     34,531 ±2% |
| range scan, 100 rows                                          |  **12,719 ±4%** |   6,705 ±2% |   6,983 ±3% |   7,214 ±1% |     10,922 ±4% |
| fetch 1k rows (6 columns)                                     |   **3,589 ±2%** |     993 ±4% |   1,018 ±5% |  1,045 ±16% |      2,518 ±3% |
| 100 parameters (id in (…)), 100 rows                          |   **4,600 ±3%** |   3,408 ±4% |   4,243 ±1% |   4,153 ±1% |      4,548 ±2% |
| 1000 parameters (id in (…)), 1000 rows                        |         529 ±4% |     406 ±3% |     500 ±2% |     490 ±4% |    **538 ±8%** |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     **572 ±2%** |     472 ±2% |     512 ±1% |     513 ±2% |        551 ±1% |
| insert one row                                                |  **40,260 ±5%** |  26,606 ±2% |  35,933 ±3% |  33,530 ±3% |     33,977 ±2% |
| multi-row insert: 100 rows, 300 parameters                    |   **5,239 ±3%** |   3,386 ±2% |   4,810 ±7% |   4,156 ±5% |      5,084 ±1% |
| update one row by primary key                                 | **34,422 ±22%** |  22,511 ±7% |  31,783 ±1% | 30,830 ±<1% |     30,390 ±1% |
| upsert (insert … on conflict do update)                       |  **33,746 ±5%** |  23,915 ±1% |  30,454 ±2% |  29,585 ±5% |     29,217 ±5% |
| delete one row by primary key                                 |  **41,414 ±4%** |  27,796 ±2% |  36,948 ±1% |  35,482 ±3% |     34,787 ±2% |
| transaction: begin; select 1; commit                          |  **23,243 ±2%** |  16,151 ±2% |  16,273 ±1% |  13,805 ±4% |     11,867 ±5% |
| transaction: begin; insert; commit                            |  **20,698 ±1%** |  13,278 ±3% |  14,998 ±2% |  13,067 ±4% |    10,723 ±32% |
| transaction with 5 savepoints (select 1 in each)              |   **4,168 ±2%** |   2,910 ±4% |   2,935 ±1% |  3,340 ±33% |      1,891 ±7% |
| query that fails (division by zero), connection reused        |      30,440 ±2% |     449 ±2% |    443 ±18% |  24,914 ±1% | **33,726 ±1%** |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **34,523 ±2%** | 26,818 ±16% | 30,730 ±14% |  30,852 ±2% |    29,109 ±26% |

**Bun 1.4: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | ----------: | ----------: |
| select 1                                                      | **24.8 µs** | 30.2 µs |    28.7 µs |     31.8 µs |     33.2 µs |
| point lookup by primary key                                   | **30.6 µs** | 53.4 µs |    38.7 µs |     36.8 µs |     36.0 µs |
| range scan, 100 rows                                          |  **106 µs** |  424 µs |     414 µs |      206 µs |      128 µs |
| fetch 1k rows (6 columns)                                     |  **674 µs** | 1.73 ms |    1.61 ms |     1.58 ms |      710 µs |
| 100 parameters (id in (…)), 100 rows                          |      272 µs |  515 µs |     324 µs |      462 µs |  **256 µs** |
| 1000 parameters (id in (…)), 1000 rows                        |     2.18 ms | 2.99 ms |    2.51 ms |     2.67 ms | **2.17 ms** |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.02 ms** | 2.65 ms |    2.47 ms |     2.49 ms |     2.04 ms |
| insert one row                                                | **35.9 µs** | 55.7 µs |    41.8 µs |     43.9 µs |     42.4 µs |
| multi-row insert: 100 rows, 300 parameters                    |      261 µs |  473 µs |     276 µs |      489 µs |  **238 µs** |
| update one row by primary key                                 | **37.2 µs** | 70.5 µs |    40.5 µs |     42.7 µs |     42.0 µs |
| upsert (insert … on conflict do update)                       | **36.9 µs** | 52.8 µs |    42.8 µs |     46.2 µs |     43.8 µs |
| delete one row by primary key                                 | **29.7 µs** | 46.4 µs |    35.8 µs |     37.4 µs |     36.3 µs |
| transaction: begin; select 1; commit                          | **52.5 µs** | 77.6 µs |    79.3 µs |     90.3 µs |      309 µs |
| transaction: begin; insert; commit                            | **68.5 µs** |  104 µs |    91.1 µs |      109 µs |      341 µs |
| transaction with 5 savepoints (select 1 in each)              |  **296 µs** |  625 µs |     618 µs |      707 µs |     1.00 ms |
| query that fails (division by zero), connection reused        | **39.7 µs** | 2.86 ms |    2.86 ms |     51.4 µs |     40.6 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler | **44.8 µs** | 56.3 µs |    52.2 µs |     47.5 µs |     45.8 µs |

**Bun 1.4: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg |  pg (named) | postgres.js |    Bun.sql |
| ------------------------------------------------------------- | ----------: | ------: | ----------: | ----------: | ---------: |
| select 1                                                      | **42.1 µs** |  196 µs |      110 µs |     93.0 µs |     100 µs |
| point lookup by primary key                                   | **66.1 µs** |  366 µs |      369 µs |      125 µs |     116 µs |
| range scan, 100 rows                                          |      435 µs |  580 µs |      645 µs |      552 µs | **265 µs** |
| fetch 1k rows (6 columns)                                     |  **919 µs** | 2.65 ms |     2.55 ms |     2.35 ms |    1000 µs |
| 100 parameters (id in (…)), 100 rows                          |  **517 µs** |  727 µs |      602 µs |      693 µs |     538 µs |
| 1000 parameters (id in (…)), 1000 rows                        | **2.71 ms** | 4.24 ms |     3.80 ms |     4.18 ms |    4.68 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     5.69 ms | 3.55 ms | **3.03 ms** |     4.01 ms |    3.39 ms |
| insert one row                                                | **76.9 µs** |  363 µs |      198 µs |      281 µs |     196 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **446 µs** |  601 µs |      552 µs |      637 µs |     455 µs |
| update one row by primary key                                 | **92.9 µs** |  314 µs |      230 µs |      280 µs |     162 µs |
| upsert (insert … on conflict do update)                       | **84.3 µs** |  303 µs |      283 µs |      266 µs |     173 µs |
| delete one row by primary key                                 | **62.4 µs** |  304 µs |      306 µs |      221 µs |     132 µs |
| transaction: begin; select 1; commit                          |  **291 µs** |  393 µs |      373 µs |      543 µs |     529 µs |
| transaction: begin; insert; commit                            |  **320 µs** |  419 µs |      448 µs |      512 µs |     603 µs |
| transaction with 5 savepoints (select 1 in each)              |  **618 µs** | 1.10 ms |     1.05 ms |     1.18 ms |    1.97 ms |
| query that fails (division by zero), connection reused        | **88.2 µs** | 3.05 ms |     4.18 ms |      322 µs |     184 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |      244 µs |  461 µs |      384 µs |      447 µs | **232 µs** |

**Bun 1.4: latency distribution, select 1**

| Percentile |           quarry |            pg |   pg (named) |  postgres.js |           Bun.sql |
| ---------- | ---------------: | ------------: | -----------: | -----------: | ----------------: |
| p50        |  **19.5 µs ±1%** |   22.9 µs ±1% |  21.9 µs ±2% |  24.5 µs ±1% |       24.8 µs ±1% |
| p90        | **20.3 µs ±59%** |   23.8 µs ±2% | 23.0 µs ±11% |  25.4 µs ±2% |       25.7 µs ±6% |
| p99        | **24.8 µs ±40%** |   30.2 µs ±2% |  28.7 µs ±5% |  31.8 µs ±8% |       33.2 µs ±5% |
| p99.9      | **42.1 µs ±32%** |   196 µs ±61% | 110 µs ±137% | 93.0 µs ±33% |       100 µs ±69% |
| max        |    1.26 ms ±310% | 1.47 ms ±156% | 681 µs ±284% | 2.42 ms ±73% | **522 µs ±3998%** |

**Bun 1.4: latency distribution, point lookup by primary key**

| Percentile |           quarry |               pg |    pg (named) |  postgres.js |       Bun.sql |
| ---------- | ---------------: | ---------------: | ------------: | -----------: | ------------: |
| p50        |  **24.0 µs ±2%** |      40.5 µs ±1% |   28.6 µs ±2% |  27.5 µs ±2% |   28.2 µs ±1% |
| p90        | **24.9 µs ±57%** |      43.5 µs ±6% |   30.4 µs ±5% |  29.2 µs ±2% |   29.0 µs ±1% |
| p99        | **30.6 µs ±54%** |      53.4 µs ±6% |   38.7 µs ±7% |  36.8 µs ±5% |  36.0 µs ±22% |
| p99.9      | **66.1 µs ±42%** |      366 µs ±19% |   369 µs ±14% | 125 µs ±143% |   116 µs ±51% |
| max        |    1.75 ms ±203% | **1.06 ms ±33%** | 1.12 ms ±107% | 2.28 ms ±65% | 1.39 ms ±227% |

**Bun 1.4: large results and bulk work, time per operation (median)**

| Scenario                                                                    |           quarry |           pg |       pg (named) |  postgres.js |          Bun.sql |
| --------------------------------------------------------------------------- | ---------------: | -----------: | ---------------: | -----------: | ---------------: |
| fetch 100k rows                                                             | **23.73 ms ±2%** | 87.98 ms ±3% |     86.83 ms ±6% | 80.13 ms ±1% |     32.43 ms ±4% |
| fetch 1M rows (one result)                                                  |   **241 ms ±9%** |   949 ms ±6% |       954 ms ±7% |   959 ms ±3% |      359 ms ±23% |
| wide rows: 1k rows × 100 columns                                            |  **2.66 ms ±1%** | 10.87 ms ±2% |     11.08 ms ±4% | 10.17 ms ±2% |      8.34 ms ±4% |
| large values: 10 × 1 MB text                                                |      5.08 ms ±2% |  4.87 ms ±2% |      5.04 ms ±6% |  5.24 ms ±8% |  **4.55 ms ±3%** |
| large values: 10 × 1 MB bytea                                               |  **4.15 ms ±9%** | 11.74 ms ±2% |     11.66 ms ±3% | 11.66 ms ±2% |     11.04 ms ±2% |
| large values: 20 × 200 KB jsonb                                             |     16.99 ms ±3% | 16.92 ms ±1% |    16.83 ms ±<1% | 17.60 ms ±1% | **16.73 ms ±6%** |
| arrays: 1k rows of int4[100] + text[20]                                     |  **3.26 ms ±9%** | 18.03 ms ±2% |     17.56 ms ±2% |  7.72 ms ±3% |      4.87 ms ±1% |
| bulk insert 10k rows (unnest arrays)                                        |     12.78 ms ±3% | 13.02 ms ±3% |     12.67 ms ±1% | 12.74 ms ±1% | **12.44 ms ±2%** |
| bulk insert 10k rows (unnest, JS array parameters)                          | **12.49 ms ±5%** | 15.36 ms ±2% |     15.40 ms ±2% | 14.81 ms ±1% |     14.18 ms ±2% |
| bulk insert 1k rows (unnest, JS array parameters)                           |  **1.43 ms ±2%** |  1.73 ms ±3% |      1.65 ms ±1% |  1.64 ms ±2% |      1.56 ms ±1% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     12.77 ms ±1% | 12.64 ms ±1% | **12.60 ms ±2%** | 12.84 ms ±1% |              n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **243 ms ±5%** | 1032 ms ±10% |     1002 ms ±12% |   812 ms ±2% |              n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **536 ms ±1%** |   670 ms ±1% |       673 ms ±1% |   648 ms ±1% |              n/a |

**Bun 1.4: large results and bulk work, time per operation (mean)**

| Scenario                                                                    |           quarry |           pg |       pg (named) |  postgres.js |          Bun.sql |
| --------------------------------------------------------------------------- | ---------------: | -----------: | ---------------: | -----------: | ---------------: |
| fetch 100k rows                                                             | **24.16 ms ±1%** | 87.42 ms ±5% |     87.49 ms ±4% | 80.10 ms ±2% |     33.19 ms ±6% |
| fetch 1M rows (one result)                                                  |   **258 ms ±9%** |   970 ms ±4% |       965 ms ±4% |   966 ms ±3% |      477 ms ±17% |
| wide rows: 1k rows × 100 columns                                            |  **2.95 ms ±3%** | 11.02 ms ±2% |    11.02 ms ±12% | 10.14 ms ±2% |      8.62 ms ±5% |
| large values: 10 × 1 MB text                                                |      5.28 ms ±2% |  5.40 ms ±3% |      5.59 ms ±8% |  5.46 ms ±4% |  **4.72 ms ±2%** |
| large values: 10 × 1 MB bytea                                               |  **4.11 ms ±5%** | 12.51 ms ±4% |     12.50 ms ±9% | 12.09 ms ±2% |     11.18 ms ±1% |
| large values: 20 × 200 KB jsonb                                             |     17.44 ms ±3% | 17.28 ms ±2% |     17.33 ms ±1% | 17.68 ms ±1% | **16.96 ms ±8%** |
| arrays: 1k rows of int4[100] + text[20]                                     |  **3.41 ms ±9%** | 18.09 ms ±3% |     17.71 ms ±2% |  7.59 ms ±5% |      4.98 ms ±1% |
| bulk insert 10k rows (unnest arrays)                                        |     12.93 ms ±4% | 13.07 ms ±3% |     12.76 ms ±3% | 12.85 ms ±1% | **12.63 ms ±2%** |
| bulk insert 10k rows (unnest, JS array parameters)                          | **12.60 ms ±4%** | 15.68 ms ±2% |     15.52 ms ±9% | 15.00 ms ±7% |     14.37 ms ±2% |
| bulk insert 1k rows (unnest, JS array parameters)                           |  **1.43 ms ±3%** |  1.76 ms ±3% |      1.67 ms ±1% |  1.64 ms ±4% |      1.55 ms ±3% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |     12.83 ms ±1% | 12.65 ms ±1% | **12.63 ms ±2%** | 12.89 ms ±2% |              n/a |
| stream 1M rows with a cursor (1000 per batch)                               |   **243 ms ±7%** | 1031 ms ±10% |     1001 ms ±11% |   815 ms ±2% |              n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **538 ms ±1%** |   673 ms ±1% |       674 ms ±1% |   650 ms ±1% |              n/a |

**Bun 1.4: rows per second (median)**

| Scenario                                           |        quarry |        pg |  pg (named) | postgres.js |     Bun.sql |
| -------------------------------------------------- | ------------: | --------: | ----------: | ----------: | ----------: |
| fetch 1k rows (6 columns)                          | **3,589,127** |   992,744 |   1,017,675 |   1,044,648 |   2,517,701 |
| fetch 100k rows                                    | **4,137,914** | 1,143,765 |   1,142,881 |   1,248,235 |   3,012,456 |
| fetch 1M rows (one result)                         | **3,868,578** | 1,031,006 |   1,036,544 |   1,035,205 |   2,093,308 |
| wide rows: 1k rows × 100 columns                   |   **338,210** |    90,731 |      90,726 |      98,553 |     115,966 |
| arrays: 1k rows of int4[100] + text[20]            |   **292,754** |    55,257 |      56,439 |     131,699 |     200,491 |
| stream 1M rows with a cursor (1000 per batch)      | **4,109,160** |   969,586 |     998,685 |   1,227,343 |         n/a |
| bulk insert 10k rows (unnest arrays)               |       773,261 |   764,742 |     783,597 |     778,058 | **791,504** |
| bulk insert 10k rows (unnest, JS array parameters) |   **793,252** |   637,454 |     644,001 |     666,245 |     695,800 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **700,311** |   567,591 |     598,561 |     608,474 |     645,658 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       779,323 |   789,984 | **791,570** |     775,321 |         n/a |

**Bun 1.4: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |    pg | pg (named) | postgres.js | Bun.sql |
| ------------------------------------------------- | ------: | ----: | ---------: | ----------: | ------: |
| fetch 100k rows × 5                               |     141 |   208 |        208 |         155 | **117** |
| fetch 1M rows (one result) × 3                    | **592** | 1,263 |      1,262 |         776 |     621 |
| wide rows: 1k rows × 100 columns × 50             |     101 |   111 |        112 |          90 |  **61** |
| large values: 10 × 1 MB text × 20                 |     127 |   165 |        164 |         131 |  **86** |
| large values: 10 × 1 MB bytea × 20                |     124 |   214 |        222 |         146 |  **84** |
| large values: 20 × 200 KB jsonb × 10              |     110 |   134 |        137 |         108 |  **73** |
| arrays: 1k rows of int4[100] + text[20] × 50      |      74 |    97 |         92 |          94 |  **55** |
| stream 1M rows with a cursor (1000 per batch) × 3 |      70 |    68 |         67 |      **67** |     n/a |

**Bun 1.4: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    | quarry |    pg | pg (named) | postgres.js | Bun.sql |
| --------------------------------------------------------------------------- | -----: | ----: | ---------: | ----------: | ------: |
| point lookup by primary key                                                 |     60 |    63 |         63 |          55 |  **49** |
| fetch 100k rows                                                             |    261 |   322 |        323 |     **184** |     199 |
| fetch 1M rows (one result)                                                  |    910 | 1,275 |      1,493 |     **854** |     858 |
| stream 1M rows with a cursor (1000 per batch)                               |     73 |    68 |         68 |      **67** |     n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |     60 |    63 |         64 |      **60** |     n/a |
| large values: 10 × 1 MB text                                                |    172 |   222 |        233 |         175 | **135** |
| large values: 10 × 1 MB bytea                                               |    152 |   250 |        242 |         166 | **134** |
| large values: 20 × 200 KB jsonb                                             |    135 |   182 |        185 |         132 |  **94** |

**Bun 1.4: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  | quarry |    pg | pg (named) | postgres.js | Bun.sql |
| ----------------------- | -----: | ----: | ---------: | ----------: | ------: |
| RSS growth during pause |  -18.3 | -15.0 |      -14.0 |   **-19.3** |     n/a |

**Bun 1.4: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |      quarry | quarry (lossless) |       pg | pg (named) | postgres.js |     Bun.sql |
| -------------------- | ----------: | ----------------: | -------: | ---------: | ----------: | ----------: |
| int4                 |  **76 ±1%** |            76 ±1% | 165 ±26% |   165 ±15% |     158 ±3% |     102 ±3% |
| int8                 |      92 ±2% |        **80 ±4%** | 186 ±24% |    184 ±4% |     156 ±2% |     118 ±2% |
| float8               |  **80 ±1%** |            81 ±2% |  198 ±3% |    201 ±2% |     170 ±5% |     113 ±1% |
| numeric              |     136 ±1% |       **135 ±2%** | 172 ±13% |    175 ±4% |     164 ±3% |     137 ±1% |
| text                 |      98 ±8% |        **96 ±3%** | 169 ±10% |    177 ±8% |     154 ±2% |     121 ±5% |
| bool                 |      83 ±1% |        **82 ±1%** | 137 ±15% |    132 ±2% |     133 ±1% |      90 ±2% |
| timestamptz          |  **90 ±1%** |           161 ±1% |  433 ±1% |    430 ±7% |     352 ±3% |     164 ±1% |
| date                 |     111 ±2% |      **110 ±<1%** | 322 ±14% |    322 ±4% |     249 ±6% |     202 ±2% |
| uuid                 |     128 ±7% |           127 ±1% |  178 ±6% |    179 ±4% |     161 ±3% | **126 ±1%** |
| jsonb (small object) | **279 ±3%** |           281 ±3% |  396 ±3% |   405 ±11% |     383 ±3% |     298 ±1% |
| int4[5]              | **254 ±1%** |           255 ±1% |  776 ±6% |    780 ±2% |     414 ±2% |     373 ±2% |
| bytea (16 B)         |     132 ±4% |       **129 ±3%** |  440 ±6% |    436 ±9% |    452 ±10% |     130 ±3% |

**Bun 1.4: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |          quarry |          pg |   pg (named) | postgres.js |      Bun.sql |
| -------------------------------------------------- | --------------: | ----------: | -----------: | ----------: | -----------: |
| insert one row                                     |  **40,260 ±5%** |  26,606 ±2% |   35,933 ±3% |  33,530 ±3% |   33,977 ±2% |
| insert one row, concurrency 50                     | **239,045 ±9%** | 100,083 ±9% |  106,432 ±3% | 64,071 ±14% |  145,671 ±5% |
| multi-row insert: 100 rows, 300 parameters         |   **5,239 ±3%** |   3,386 ±2% |    4,810 ±7% |   4,156 ±5% |    5,084 ±1% |
| bulk insert 10k rows (unnest arrays)               |        77.3 ±4% |    76.5 ±3% |     78.4 ±3% |    77.8 ±1% | **79.2 ±2%** |
| bulk insert 10k rows (unnest, JS array parameters) |    **79.3 ±4%** |    63.7 ±2% |     64.4 ±9% |    66.6 ±6% |     69.6 ±2% |
| bulk insert 1k rows (unnest, JS array parameters)  |     **700 ±3%** |     568 ±3% |      599 ±1% |     608 ±4% |      646 ±3% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |        77.9 ±1% |    79.0 ±1% | **79.2 ±2%** |    77.5 ±2% |          n/a |
| update one row by primary key                      | **34,422 ±22%** |  22,511 ±7% |   31,783 ±1% | 30,830 ±<1% |   30,390 ±1% |
| upsert (insert … on conflict do update)            |  **33,746 ±5%** |  23,915 ±1% |   30,454 ±2% |  29,585 ±5% |   29,217 ±5% |
| delete one row by primary key                      |  **41,414 ±4%** |  27,796 ±2% |   36,948 ±1% |  35,482 ±3% |   34,787 ±2% |

**Bun 1.4: transactions, operations/s**

| Scenario                                         |         quarry |         pg | pg (named) | postgres.js |     Bun.sql |
| ------------------------------------------------ | -------------: | ---------: | ---------: | ----------: | ----------: |
| transaction: begin; select 1; commit             | **23,243 ±2%** | 16,151 ±2% | 16,273 ±1% |  13,805 ±4% |  11,867 ±5% |
| transaction: begin; insert; commit               | **20,698 ±1%** | 13,278 ±3% | 14,998 ±2% |  13,067 ±4% | 10,723 ±32% |
| transaction with 5 savepoints (select 1 in each) |  **4,168 ±2%** |  2,910 ±4% |  2,935 ±1% |  3,340 ±33% |   1,891 ±7% |

**Bun 1.4: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |     pg | pg (named) | postgres.js |  Bun.sql |
| ------------------------------------------------------ | ---------: | -----: | ---------: | ----------: | -------: |
| select 1                                               |   **10.6** |   14.4 |       13.5 |        13.8 |     13.3 |
| point lookup by primary key                            |   **11.6** |   20.1 |       17.2 |        15.6 |     16.4 |
| fetch 1k rows (6 columns)                              |    **236** |    967 |        966 |         881 |      345 |
| fetch 100k rows                                        | **27,260** | 99,875 |     99,209 |      90,429 |   37,017 |
| insert one row                                         |   **11.5** |   15.9 |       14.7 |        15.4 |     16.1 |
| insert one row, concurrency 50                         |    **4.1** |   10.3 |        9.9 |        15.9 |      7.4 |
| transaction: begin; insert; commit                     |   **27.1** |   43.0 |       42.4 |        45.8 |     45.4 |
| query that fails (division by zero), connection reused |       23.1 |    418 |        433 |        29.9 | **17.9** |

**Bun 1.4: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | Bun.sql |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | ------: |
| select 1                             |  **9.6** | 11.7 |        9.8 |        11.6 |    12.1 |
| point lookup by primary key          |     13.5 | 26.1 |       14.1 |    **13.5** |    15.9 |
| fetch 1k rows (6 columns)            |  **242** |  381 |        350 |         365 |     352 |
| 100 parameters (id in (…)), 100 rows |      185 |  234 |        183 |     **183** |     184 |
| insert one row                       | **14.2** | 24.1 |       14.6 |        14.6 |    16.2 |
| insert one row, concurrency 50       | **12.0** | 31.9 |       18.3 |        14.8 |    13.6 |
| transaction: begin; insert; commit   | **24.1** | 40.7 |       30.7 |        31.0 |    45.8 |

**Bun 1.4: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |    quarry |      pg | pg (named) | postgres.js | Bun.sql |
| -------------------------------------------------- | --------: | ------: | ---------: | ----------: | ------: |
| point lookup by primary key: p99                   |       0.1 |     0.1 |        0.3 |     **0.1** |     0.1 |
| point lookup by primary key: max                   |       0.1 |     0.1 |        0.3 |     **0.1** |     0.1 |
| insert one row, concurrency 50: p99                |       0.6 |     0.6 |    **0.5** |         1.2 |     1.1 |
| insert one row, concurrency 50: max                |       0.6 |     0.6 |    **0.5** |         1.2 |     1.1 |
| fetch 1k rows (6 columns): p99                     |       0.4 |     1.0 |        1.0 |         1.3 | **0.3** |
| fetch 1k rows (6 columns): max                     |       0.4 |     1.0 |        1.0 |         1.3 | **0.3** |
| fetch 100k rows: p99                               |   **7.5** |    87.9 |       88.6 |        75.1 |    13.7 |
| fetch 100k rows: max                               |  **11.7** |    87.9 |       88.6 |        75.1 |    14.2 |
| fetch 1M rows (one result): p99                    | **425.6** | 1,039.4 |    1,031.1 |       979.0 |   734.8 |
| fetch 1M rows (one result): max                    | **425.6** | 1,039.4 |    1,031.1 |       979.0 |   734.8 |
| stream 1M rows with a cursor (1000 per batch): p99 |   **0.4** |     1.2 |        1.1 |         0.6 |     n/a |
| stream 1M rows with a cursor (1000 per batch): max |       1.2 |     1.9 |        1.5 |     **1.2** |     n/a |

**Bun 1.4: connections (median time per operation)**

| Scenario                                                    |          quarry |          pg |   pg (named) |   postgres.js |          Bun.sql |
| ----------------------------------------------------------- | --------------: | ----------: | -----------: | ------------: | ---------------: |
| connect + select 1 + close (no TLS, trust)                  |    2.30 ms ±12% | 3.70 ms ±3% |  3.85 ms ±2% |  6.36 ms ±10% | **2.26 ms ±15%** |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | **2.42 ms ±1%** | 4.76 ms ±1% |  4.80 ms ±3% |   7.19 ms ±9% |      2.86 ms ±4% |
| connect + select 1 + close (TLS verify-full, trust)         |     4.28 ms ±3% | 4.10 ms ±2% |  4.11 ms ±1% |   7.09 ms ±1% | **3.62 ms ±11%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) |     4.56 ms ±4% | 5.42 ms ±2% |  5.44 ms ±4% |   7.86 ms ±3% | **4.04 ms ±15%** |
| pool warm-up: new pool (max 10), 10 concurrent select 1     |     7.77 ms ±1% | 8.16 ms ±3% | 8.34 ms ±24% | 14.50 ms ±14% | **7.60 ms ±20%** |

**Bun 1.4: cancellation, notifications, errors**

| Scenario                                      |      quarry |        pg | pg (named) | postgres.js |       Bun.sql |
| --------------------------------------------- | ----------: | --------: | ---------: | ----------: | ------------: |
| cancel: time from cancel() to rejection (p50) | **1.43 ms** |   1.44 ms |    1.44 ms |     1.45 ms |       2973 ms |
| cancel: share of queries actually cancelled   |    **100%** |  **100%** |   **100%** |    **100%** |            0% |
| NOTIFY latency p50                            | **28.1 µs** |   35.5 µs |    31.2 µs |     31.3 µs |       33.3 µs |
| NOTIFY latency p99                            | **44.8 µs** |   56.3 µs |    52.2 µs |     47.5 µs |       45.8 µs |
| NOTIFY throughput (notifications/s)           |   2,517,722 | 2,024,445 |  2,043,822 |   1,648,908 | **2,550,641** |
| error path: failing queries/s                 |      30,440 |       449 |        443 |      24,914 |    **33,726** |

**Bun 1.4: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |                Bun.sql |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: | ---------------------: |
| select 1                                | 49,977 / 37,570 / +33% |  43,884 / 41,973 / +5% |   39,334 / 40,125 / -2% |  39,165 / 39,077 / +0% |
| point lookup by primary key             | 40,755 / 22,137 / +84% | 33,446 / 23,734 / +41% | 34,927 / 15,950 / +119% | 34,531 / 22,950 / +50% |
| range scan, 100 rows                    |  12,719 / 7,798 / +63% |    6,983 / 6,705 / +4% |    7,214 / 5,784 / +25% |  10,922 / 9,431 / +16% |
| fetch 1k rows (6 columns)               |  3,589 / 1,787 / +101% |      1,018 / 993 / +3% |     1,045 / 1,055 / -1% |    2,518 / 2,515 / +0% |
| 100 parameters (id in (…)), 100 rows    |   4,600 / 3,529 / +30% |   4,243 / 3,408 / +25% |    4,153 / 3,040 / +37% |   4,548 / 3,556 / +28% |
| 1000 parameters (id in (…)), 1000 rows  |       529 / 422 / +25% |       500 / 406 / +23% |        490 / 394 / +25% |       538 / 455 / +18% |
| insert one row                          | 40,260 / 28,698 / +40% | 35,933 / 26,606 / +35% |  33,530 / 17,084 / +96% | 33,977 / 25,445 / +34% |
| upsert (insert … on conflict do update) | 33,746 / 24,939 / +35% | 30,454 / 23,915 / +27% |  29,585 / 15,832 / +87% | 29,217 / 22,658 / +29% |

**Bun 1.4: quarry decoding modes (time per op)**

| Scenario                                |           quarry | quarry (lossless) |
| --------------------------------------- | ---------------: | ----------------: |
| point lookup by primary key             |  **24.0 µs ±2%** |       24.2 µs ±1% |
| fetch 1k rows (6 columns)               |   **262 µs ±1%** |        330 µs ±1% |
| fetch 100k rows                         | **23.73 ms ±2%** |      29.88 ms ±2% |
| fetch 1M rows (one result)              |   **241 ms ±9%** |        275 ms ±8% |
| wide rows: 1k rows × 100 columns        |  **2.66 ms ±1%** |       3.29 ms ±2% |
| arrays: 1k rows of int4[100] + text[20] |  **3.26 ms ±9%** |       3.27 ms ±3% |
| decode 100k × int8                      |      9.16 ms ±2% |   **7.96 ms ±4%** |
| decode 100k × timestamptz               |  **9.00 ms ±1%** |      16.12 ms ±1% |
| decode 100k × date                      |     11.11 ms ±2% | **10.97 ms ±<1%** |

## Deno 2.9

**Deno 2.9: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |          quarry |           pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | --------------: | -----------: | -----------: | -----------: | -----------------------: |
| select 1                                                      | **22.6 µs ±3%** |  29.2 µs ±5% |  29.4 µs ±2% |  31.3 µs ±2% |              36.3 µs ±1% |
| point lookup by primary key                                   | **27.3 µs ±2%** | 50.6 µs ±27% |  38.6 µs ±2% |  35.9 µs ±8% |              70.8 µs ±1% |
| range scan, 100 rows                                          | **89.3 µs ±1%** |   200 µs ±2% |   194 µs ±1% |   159 µs ±4% |               971 µs ±7% |
| fetch 1k rows (6 columns)                                     |  **316 µs ±1%** |  1.38 ms ±6% |  1.38 ms ±1% |   971 µs ±3% |              7.89 ms ±4% |
| 100 parameters (id in (…)), 100 rows                          |  **227 µs ±3%** |   336 µs ±1% |   277 µs ±1% |   280 µs ±1% |               721 µs ±2% |
| 1000 parameters (id in (…)), 1000 rows                        | **1.93 ms ±1%** |  2.69 ms ±5% |  2.27 ms ±6% |  2.29 ms ±4% |              6.33 ms ±2% |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **1.73 ms ±7%** |  2.07 ms ±1% | 1.97 ms ±16% |  1.94 ms ±3% |              5.57 ms ±2% |
| insert one row                                                | **27.3 µs ±2%** |  42.5 µs ±2% |  33.9 µs ±3% |  37.2 µs ±5% |              55.4 µs ±1% |
| multi-row insert: 100 rows, 300 parameters                    |  **192 µs ±2%** |   356 µs ±6% |   267 µs ±5% |   389 µs ±2% |               427 µs ±2% |
| update one row by primary key                                 | **31.7 µs ±1%** |  49.6 µs ±1% |  38.3 µs ±1% |  39.7 µs ±1% |             62.7 µs ±19% |
| upsert (insert … on conflict do update)                       | **32.5 µs ±2%** |  48.1 µs ±1% |  39.6 µs ±5% |  40.8 µs ±1% |              61.3 µs ±2% |
| delete one row by primary key                                 | **26.7 µs ±1%** |  42.0 µs ±2% | 33.1 µs ±<1% |  34.7 µs ±4% |              54.3 µs ±1% |
| transaction: begin; select 1; commit                          | **49.8 µs ±2%** |  76.0 µs ±2% |  78.6 µs ±3% |  89.2 µs ±1% |              92.1 µs ±1% |
| transaction: begin; insert; commit                            | **55.5 µs ±1%** |  91.4 µs ±5% |  82.4 µs ±5% |  95.4 µs ±1% |               111 µs ±1% |
| transaction with 5 savepoints (select 1 in each)              |  **273 µs ±3%** |   418 µs ±2% |   435 µs ±3% |   361 µs ±2% |               516 µs ±2% |
| query that fails (division by zero), connection reused        | **33.8 µs ±1%** |  2.33 ms ±3% | 2.40 ms ±14% |  97.4 µs ±2% |              40.8 µs ±3% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **33.0 µs ±3%** |  44.8 µs ±2% |  41.3 µs ±1% | 40.4 µs ±36% |                      n/a |

**Deno 2.9: throughput, sequential (operations/s)**

| Scenario                                                      |         quarry |          pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | -------------: | ----------: | ----------: | ----------: | -----------------------: |
| select 1                                                      | **42,182 ±2%** |  31,776 ±2% |  31,813 ±2% |  29,183 ±2% |               25,002 ±1% |
| point lookup by primary key                                   | **34,861 ±2%** | 18,762 ±14% | 23,791 ±12% | 25,297 ±11% |               12,867 ±1% |
| range scan, 100 rows                                          | **10,608 ±5%** |   4,820 ±4% |   4,960 ±2% |   5,657 ±3% |                  984 ±6% |
| fetch 1k rows (6 columns)                                     |  **3,071 ±1%** |     728 ±2% |     725 ±3% |     874 ±3% |                  124 ±2% |
| 100 parameters (id in (…)), 100 rows                          |  **4,274 ±8%** |   2,851 ±2% |   3,469 ±2% |   3,370 ±2% |                1,181 ±3% |
| 1000 parameters (id in (…)), 1000 rows                        |    **513 ±1%** |     363 ±7% |     430 ±7% |     414 ±4% |                  158 ±2% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |   **574 ±10%** |     473 ±2% |    500 ±11% |     483 ±3% |                  183 ±2% |
| insert one row                                                | **34,854 ±1%** |  21,888 ±1% |  27,091 ±4% | 24,545 ±11% |               16,464 ±3% |
| multi-row insert: 100 rows, 300 parameters                    |  **4,970 ±1%** |   2,718 ±5% |   3,551 ±4% |   2,454 ±3% |                1,837 ±3% |
| update one row by primary key                                 | **30,219 ±2%** |  18,866 ±3% | 24,530 ±11% |  23,399 ±2% |              15,027 ±12% |
| upsert (insert … on conflict do update)                       | **29,123 ±2%** |  19,709 ±1% |  22,811 ±4% |  22,659 ±2% |               14,722 ±5% |
| delete one row by primary key                                 | **35,456 ±7%** |  21,998 ±4% |  28,151 ±1% |  26,691 ±4% |               17,228 ±2% |
| transaction: begin; select 1; commit                          | **18,736 ±2%** |  12,324 ±1% |  11,885 ±1% |  10,402 ±1% |               10,091 ±4% |
| transaction: begin; insert; commit                            | **16,971 ±2%** | 10,320 ±13% |  11,453 ±2% |   9,388 ±3% |                8,416 ±2% |
| transaction with 5 savepoints (select 1 in each)              |  **3,431 ±3%** |   2,269 ±3% |   2,153 ±2% |   2,563 ±2% |                1,821 ±3% |
| query that fails (division by zero), connection reused        | **27,432 ±3%** |     421 ±2% |    407 ±12% |   9,397 ±4% |               21,374 ±2% |
| LISTEN/NOTIFY latency: notify on another connection → handler | **29,102 ±6%** |  20,472 ±3% |  22,355 ±2% | 22,360 ±24% |                      n/a |

**Deno 2.9: tail latency p99, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | ----------: | -----------------------: |
| select 1                                                      | **30.3 µs** | 54.2 µs |    58.1 µs |     50.2 µs |                   103 µs |
| point lookup by primary key                                   | **39.7 µs** | 92.2 µs |    78.7 µs |     59.5 µs |                   167 µs |
| range scan, 100 rows                                          |  **140 µs** |  273 µs |     259 µs |      311 µs |                  1.83 ms |
| fetch 1k rows (6 columns)                                     |  **436 µs** | 1.81 ms |    1.76 ms |     5.03 ms |                 12.38 ms |
| 100 parameters (id in (…)), 100 rows                          |  **338 µs** |  540 µs |     428 µs |      434 µs |                  1.66 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **2.21 ms** | 3.18 ms |    2.75 ms |     4.89 ms |                 10.19 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **1.99 ms** | 2.67 ms |    2.30 ms |     4.24 ms |                  8.75 ms |
| insert one row                                                | **46.8 µs** | 79.9 µs |    72.3 µs |     68.9 µs |                   145 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **262 µs** |  586 µs |     388 µs |      734 µs |                  2.21 ms |
| update one row by primary key                                 | **46.5 µs** | 83.2 µs |    71.4 µs |     63.5 µs |                   148 µs |
| upsert (insert … on conflict do update)                       | **46.3 µs** | 81.4 µs |    79.7 µs |     67.6 µs |                   163 µs |
| delete one row by primary key                                 | **36.9 µs** | 80.1 µs |    64.1 µs |     56.2 µs |                   136 µs |
| transaction: begin; select 1; commit                          |  **105 µs** |  110 µs |     117 µs |      139 µs |                   201 µs |
| transaction: begin; insert; commit                            |  **113 µs** |  143 µs |     126 µs |      163 µs |                   223 µs |
| transaction with 5 savepoints (select 1 in each)              |  **410 µs** |  657 µs |     617 µs |      747 µs |                   824 µs |
| query that fails (division by zero), connection reused        | **56.1 µs** | 3.00 ms |    3.15 ms |      155 µs |                   107 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler | **60.7 µs** | 97.4 µs |    97.7 µs |     79.8 µs |                      n/a |

**Deno 2.9: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------------- | ----------: | ------: | ---------: | ----------: | -----------------------: |
| select 1                                                      | **97.0 µs** |  145 µs |     121 µs |      271 µs |                   245 µs |
| point lookup by primary key                                   |  **193 µs** |  320 µs |     241 µs |      371 µs |                   432 µs |
| range scan, 100 rows                                          |  **415 µs** |  564 µs |     506 µs |     3.64 ms |                  4.48 ms |
| fetch 1k rows (6 columns)                                     |  **746 µs** | 2.61 ms |    1.94 ms |     8.46 ms |                 13.41 ms |
| 100 parameters (id in (…)), 100 rows                          |  **532 µs** |  826 µs |     757 µs |     2.88 ms |                  3.89 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **3.08 ms** | 5.11 ms |    4.86 ms |     8.62 ms |                 12.31 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.26 ms** | 5.07 ms |    4.36 ms |     7.42 ms |                 10.11 ms |
| insert one row                                                |  **168 µs** |  176 µs |     283 µs |      371 µs |                   283 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **521 µs** |  756 µs |     737 µs |     1.74 ms |                  2.71 ms |
| update one row by primary key                                 |  **211 µs** |  217 µs |     270 µs |      387 µs |                   305 µs |
| upsert (insert … on conflict do update)                       |  **225 µs** |  307 µs |     239 µs |      518 µs |                   372 µs |
| delete one row by primary key                                 |      163 µs |  292 µs | **156 µs** |      333 µs |                   239 µs |
| transaction: begin; select 1; commit                          |  **199 µs** |  911 µs |     734 µs |     1.67 ms |                   417 µs |
| transaction: begin; insert; commit                            |  **246 µs** |  968 µs |     695 µs |     1.69 ms |                   466 µs |
| transaction with 5 savepoints (select 1 in each)              |  **762 µs** | 4.74 ms |    4.65 ms |     4.00 ms |                  4.22 ms |
| query that fails (division by zero), connection reused        |  **131 µs** | 4.92 ms |    3.53 ms |     1.21 ms |                   321 µs |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **226 µs** |  345 µs |     393 µs |      645 µs |                      n/a |

**Deno 2.9: latency distribution, select 1**

| Percentile |           quarry |           pg |    pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | ---------------: | -----------: | ------------: | -----------: | -----------------------: |
| p50        |  **22.6 µs ±3%** |  29.2 µs ±5% |   29.4 µs ±2% |  31.3 µs ±2% |              36.3 µs ±1% |
| p90        |  **25.1 µs ±2%** |  32.2 µs ±5% |   33.9 µs ±2% |  34.7 µs ±6% |              41.2 µs ±2% |
| p99        |  **30.3 µs ±3%** |  54.2 µs ±7% |   58.1 µs ±6% | 50.2 µs ±10% |               103 µs ±1% |
| p99.9      |  **97.0 µs ±8%** |  145 µs ±87% |   121 µs ±27% |  271 µs ±51% |              245 µs ±17% |
| max        | **2.11 ms ±61%** | 3.64 ms ±53% | 2.82 ms ±152% | 5.73 ms ±37% |            2.60 ms ±136% |

**Deno 2.9: latency distribution, point lookup by primary key**

| Percentile |           quarry |           pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| ---------- | ---------------: | -----------: | -----------: | -----------: | -----------------------: |
| p50        |  **27.3 µs ±2%** | 50.6 µs ±27% |  38.6 µs ±2% |  35.9 µs ±8% |              70.8 µs ±1% |
| p90        |  **29.3 µs ±4%** | 55.3 µs ±27% | 44.6 µs ±57% | 41.5 µs ±37% |              84.5 µs ±3% |
| p99        |  **39.7 µs ±8%** | 92.2 µs ±12% | 78.7 µs ±23% | 59.5 µs ±32% |               167 µs ±4% |
| p99.9      |   **193 µs ±7%** |  320 µs ±48% |  241 µs ±29% |  371 µs ±25% |              432 µs ±16% |
| max        | **2.40 ms ±60%** | 2.60 ms ±31% | 2.83 ms ±28% |  4.57 ms ±8% |            2.88 ms ±103% |

**Deno 2.9: large results and bulk work, time per operation (median)**

| Scenario                                                                    |            quarry |           pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ----------------: | -----------: | -----------: | -----------: | -----------------------: |
| fetch 100k rows                                                             | **35.52 ms ±27%** |   126 ms ±3% |   126 ms ±2% | 95.04 ms ±2% |               798 ms ±2% |
| fetch 1M rows (one result)                                                  |   **421 ms ±11%** |  1301 ms ±3% |  1349 ms ±2% |  1042 ms ±6% |              8783 ms ±2% |
| wide rows: 1k rows × 100 columns                                            |   **3.36 ms ±2%** | 15.71 ms ±1% | 15.64 ms ±1% | 15.84 ms ±3% |             81.59 ms ±4% |
| large values: 10 × 1 MB text                                                |      7.55 ms ±11% | 7.38 ms ±14% |  7.86 ms ±5% |  9.60 ms ±4% |          **4.92 ms ±6%** |
| large values: 10 × 1 MB bytea                                               |   **3.35 ms ±4%** | 18.59 ms ±7% | 18.09 ms ±3% | 17.74 ms ±6% |               383 ms ±2% |
| large values: 20 × 200 KB jsonb                                             |      19.10 ms ±5% | 19.85 ms ±6% | 19.55 ms ±1% | 22.85 ms ±9% |         **18.39 ms ±6%** |
| arrays: 1k rows of int4[100] + text[20]                                     |   **3.26 ms ±7%** | 25.10 ms ±5% | 25.00 ms ±2% | 9.00 ms ±18% |             30.88 ms ±2% |
| bulk insert 10k rows (unnest arrays)                                        |  **12.89 ms ±2%** | 13.12 ms ±5% | 13.14 ms ±4% | 13.05 ms ±6% |             13.10 ms ±5% |
| bulk insert 10k rows (unnest, JS array parameters)                          |  **13.70 ms ±1%** | 15.69 ms ±3% | 15.37 ms ±4% | 15.26 ms ±5% |             15.53 ms ±4% |
| bulk insert 1k rows (unnest, JS array parameters)                           |   **1.57 ms ±5%** |  1.79 ms ±2% |  1.73 ms ±2% |  1.82 ms ±3% |              1.76 ms ±5% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |  **12.68 ms ±2%** | 12.95 ms ±6% | 12.82 ms ±2% | 55.96 ms ±1% |                      n/a |
| stream 1M rows with a cursor (1000 per batch)                               |    **298 ms ±2%** | 1307 ms ±23% |  1302 ms ±2% |  1090 ms ±2% |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |    **722 ms ±1%** |   876 ms ±1% |   880 ms ±1% |   839 ms ±1% |                      n/a |

**Deno 2.9: large results and bulk work, time per operation (mean)**

| Scenario                                                                    |            quarry |           pg |   pg (named) |  postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ----------------: | -----------: | -----------: | -----------: | -----------------------: |
| fetch 100k rows                                                             | **34.48 ms ±19%** |   131 ms ±1% |   130 ms ±2% | 96.65 ms ±3% |               798 ms ±1% |
| fetch 1M rows (one result)                                                  |   **435 ms ±10%** |  1346 ms ±2% |  1360 ms ±2% |  1048 ms ±3% |              8778 ms ±2% |
| wide rows: 1k rows × 100 columns                                            |   **3.38 ms ±3%** | 15.93 ms ±2% | 15.88 ms ±2% | 16.21 ms ±3% |             82.35 ms ±4% |
| large values: 10 × 1 MB text                                                |       8.19 ms ±4% |  8.33 ms ±6% |  8.80 ms ±6% |  9.67 ms ±7% |          **5.51 ms ±9%** |
| large values: 10 × 1 MB bytea                                               |   **4.02 ms ±9%** | 19.40 ms ±7% | 18.85 ms ±3% | 18.59 ms ±5% |               382 ms ±2% |
| large values: 20 × 200 KB jsonb                                             |     19.59 ms ±18% | 20.25 ms ±5% | 19.90 ms ±2% | 24.16 ms ±5% |         **19.32 ms ±5%** |
| arrays: 1k rows of int4[100] + text[20]                                     |   **3.27 ms ±7%** | 25.93 ms ±8% | 25.58 ms ±3% | 9.87 ms ±20% |             31.41 ms ±1% |
| bulk insert 10k rows (unnest arrays)                                        |  **12.95 ms ±3%** | 13.26 ms ±5% | 13.43 ms ±3% | 13.09 ms ±6% |             13.28 ms ±3% |
| bulk insert 10k rows (unnest, JS array parameters)                          |  **13.86 ms ±1%** | 15.85 ms ±3% | 15.60 ms ±3% | 15.68 ms ±5% |             16.13 ms ±4% |
| bulk insert 1k rows (unnest, JS array parameters)                           |  **1.58 ms ±11%** |  1.83 ms ±2% |  1.74 ms ±4% |  1.86 ms ±3% |             1.76 ms ±15% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |  **12.70 ms ±3%** | 13.08 ms ±6% | 12.85 ms ±3% | 56.01 ms ±1% |                      n/a |
| stream 1M rows with a cursor (1000 per batch)                               |    **299 ms ±2%** | 1311 ms ±25% |  1301 ms ±2% |  1095 ms ±2% |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |    **729 ms ±1%** |   882 ms ±1% |   882 ms ±5% |   842 ms ±2% |                      n/a |

**Deno 2.9: rows per second (median)**

| Scenario                                           |        quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | ------------: | ------: | ---------: | ----------: | -----------------------: |
| fetch 1k rows (6 columns)                          | **3,071,287** | 727,758 |    725,456 |     873,695 |                  123,681 |
| fetch 100k rows                                    | **2,899,293** | 764,115 |    766,512 |   1,034,536 |                  125,297 |
| fetch 1M rows (one result)                         | **2,299,637** | 743,102 |    735,237 |     953,792 |                  113,917 |
| wide rows: 1k rows × 100 columns                   |   **295,391** |  62,745 |     62,936 |      61,643 |                   12,142 |
| arrays: 1k rows of int4[100] + text[20]            |   **305,858** |  38,550 |     39,081 |     101,311 |                   31,820 |
| stream 1M rows with a cursor (1000 per batch)      | **3,341,254** | 762,963 |    768,408 |     913,380 |                      n/a |
| bulk insert 10k rows (unnest arrays)               |   **772,140** | 753,812 |    744,453 |     763,459 |                  752,699 |
| bulk insert 10k rows (unnest, JS array parameters) |   **721,141** | 630,813 |    640,675 |     637,701 |                  619,716 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **633,670** | 545,945 |    573,721 |     538,560 |                  567,740 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |   **787,097** | 764,461 |    778,146 |     178,499 |                      n/a |

**Deno 2.9: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| fetch 100k rows × 5                               | **212** |     300 |        299 |         241 |                      234 |
| fetch 1M rows (one result) × 3                    |     965 |   1,325 |      1,327 |       1,065 |                  **795** |
| wide rows: 1k rows × 100 columns × 50             | **132** |     151 |        152 |         240 |                      200 |
| large values: 10 × 1 MB text × 20                 |     213 |     204 |    **200** |         204 |                      221 |
| large values: 10 × 1 MB bytea × 20                | **153** |     249 |        243 |         197 |                      217 |
| large values: 20 × 200 KB jsonb × 10              |     193 | **171** |        174 |         227 |                      185 |
| arrays: 1k rows of int4[100] + text[20] × 50      | **106** |     266 |        266 |         198 |                      160 |
| stream 1M rows with a cursor (1000 per batch) × 3 |  **95** |     151 |        150 |         163 |                      n/a |

**Deno 2.9: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| point lookup by primary key                                                 |      76 |  **76** |         77 |         136 |                       80 |
| fetch 100k rows                                                             |     319 |     447 |        457 |         241 |                  **236** |
| fetch 1M rows (one result)                                                  |   1,332 |   1,347 |      1,326 |       1,121 |                  **949** |
| stream 1M rows with a cursor (1000 per batch)                               |  **95** |     151 |        151 |         163 |                      n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |  **85** |     101 |        101 |         155 |                      n/a |
| large values: 10 × 1 MB text                                                |     221 |     236 |        245 |     **215** |                      223 |
| large values: 10 × 1 MB bytea                                               | **200** |     253 |        245 |         219 |                      217 |
| large values: 20 × 200 KB jsonb                                             |     198 | **197** |        199 |         239 |                      211 |

**Deno 2.9: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |  quarry |  pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ----------------------- | ------: | --: | ---------: | ----------: | -----------------------: |
| RSS growth during pause | **0.1** | 0.2 |        0.2 |         0.2 |                      n/a |

**Deno 2.9: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry |        pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------- | -----------: | --------: | ---------: | ----------: | -----------------------: |
| int4                 |   **75 ±1%** |   235 ±4% |    227 ±4% |     236 ±7% |                3,635 ±8% |
| int8                 |   **98 ±6%** |   237 ±3% |    235 ±1% |     220 ±2% |                3,763 ±2% |
| float8               |   **81 ±1%** |   248 ±2% |    244 ±4% |     271 ±1% |                3,499 ±3% |
| numeric              |  **137 ±1%** |   202 ±3% |    200 ±2% |     222 ±5% |                3,534 ±2% |
| text                 |   **98 ±4%** |   208 ±2% |   211 ±24% |     223 ±3% |                3,714 ±6% |
| bool                 |  **82 ±<1%** |   165 ±2% |    164 ±1% |     190 ±2% |                3,682 ±1% |
| timestamptz          | **109 ±23%** |   696 ±3% |    696 ±4% |     447 ±2% |                4,699 ±4% |
| date                 |  **111 ±1%** |  513 ±<1% |    514 ±2% |     373 ±6% |                3,814 ±3% |
| uuid                 |  **128 ±2%** |   213 ±6% |    215 ±3% |     237 ±3% |                3,653 ±2% |
| jsonb (small object) |  **348 ±6%** |   437 ±3% |    442 ±2% |     462 ±4% |                4,245 ±2% |
| int4[5]              |  **255 ±7%** | 1,119 ±3% |  1,110 ±4% |     605 ±2% |                4,901 ±2% |
| bytea (16 B)         |  **364 ±5%** |   398 ±4% |    402 ±3% |     392 ±2% |                6,009 ±2% |

**Deno 2.9: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |          quarry |          pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | --------------: | ----------: | ----------: | ----------: | -----------------------: |
| insert one row                                     |  **34,854 ±1%** |  21,888 ±1% |  27,091 ±4% | 24,545 ±11% |               16,464 ±3% |
| insert one row, concurrency 50                     | **235,970 ±6%** | 71,497 ±13% |  65,411 ±3% |  56,364 ±3% |               21,862 ±5% |
| multi-row insert: 100 rows, 300 parameters         |   **4,970 ±1%** |   2,718 ±5% |   3,551 ±4% |   2,454 ±3% |                1,837 ±3% |
| bulk insert 10k rows (unnest arrays)               |    **77.2 ±3%** |    75.4 ±4% |    74.4 ±4% |    76.3 ±5% |                 75.3 ±3% |
| bulk insert 10k rows (unnest, JS array parameters) |    **72.1 ±1%** |    63.1 ±3% |    64.1 ±3% |    63.8 ±5% |                 62.0 ±4% |
| bulk insert 1k rows (unnest, JS array parameters)  |    **634 ±10%** |     546 ±2% |     574 ±4% |     539 ±3% |                 568 ±13% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |    **78.7 ±3%** |    76.4 ±6% |    77.8 ±3% |    17.8 ±1% |                      n/a |
| update one row by primary key                      |  **30,219 ±2%** |  18,866 ±3% | 24,530 ±11% |  23,399 ±2% |              15,027 ±12% |
| upsert (insert … on conflict do update)            |  **29,123 ±2%** |  19,709 ±1% |  22,811 ±4% |  22,659 ±2% |               14,722 ±5% |
| delete one row by primary key                      |  **35,456 ±7%** |  21,998 ±4% |  28,151 ±1% |  26,691 ±4% |               17,228 ±2% |

**Deno 2.9: transactions, operations/s**

| Scenario                                         |         quarry |          pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------ | -------------: | ----------: | ---------: | ----------: | -----------------------: |
| transaction: begin; select 1; commit             | **18,736 ±2%** |  12,324 ±1% | 11,885 ±1% |  10,402 ±1% |               10,091 ±4% |
| transaction: begin; insert; commit               | **16,971 ±2%** | 10,320 ±13% | 11,453 ±2% |   9,388 ±3% |                8,416 ±2% |
| transaction with 5 savepoints (select 1 in each) |  **3,431 ±3%** |   2,269 ±3% |  2,153 ±2% |   2,563 ±2% |                1,821 ±3% |

**Deno 2.9: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | ----------: | -----------------------: |
| select 1                                               |   **15.3** |    21.7 |       24.4 |        27.6 |                     34.0 |
| point lookup by primary key                            |   **17.0** |    30.8 |       31.6 |        31.2 |                     71.7 |
| fetch 1k rows (6 columns)                              |    **310** |   1,268 |      1,296 |       1,214 |                    9,077 |
| fetch 100k rows                                        | **48,127** | 163,373 |    160,966 |     117,149 |                  946,875 |
| insert one row                                         |   **16.4** |    24.5 |       24.9 |        32.0 |                     54.2 |
| insert one row, concurrency 50                         |    **4.5** |    15.1 |       16.5 |        21.7 |                     51.0 |
| transaction: begin; insert; commit                     |   **39.1** |    62.6 |       64.1 |        90.8 |                      101 |
| query that fails (division by zero), connection reused |   **28.7** |     520 |        556 |         103 |                     41.1 |

**Deno 2.9: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| ------------------------------------ | -------: | ---: | ---------: | ----------: | -----------------------: |
| select 1                             |  **9.5** | 12.1 |       10.1 |        11.8 |                     11.9 |
| point lookup by primary key          | **13.4** | 26.6 |       14.3 |        14.1 |                     33.9 |
| fetch 1k rows (6 columns)            |  **236** |  421 |        371 |         388 |                      480 |
| 100 parameters (id in (…)), 100 rows |  **186** |  235 |        186 |         187 |                      263 |
| insert one row                       | **13.9** | 24.0 |       14.0 |        14.7 |                     31.6 |
| insert one row, concurrency 50       | **11.9** | 32.2 |       18.3 |        15.7 |                     54.5 |
| transaction: begin; insert; commit   | **24.9** | 43.6 |       32.3 |        31.4 |                     49.6 |

**Deno 2.9: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |  quarry |      pg | pg (named) | postgres.js | deno-postgres (+nodelay) |
| -------------------------------------------------- | ------: | ------: | ---------: | ----------: | -----------------------: |
| point lookup by primary key: p99                   |     0.2 | **0.2** |        0.6 |         1.7 |                      0.6 |
| point lookup by primary key: max                   |     0.2 | **0.2** |        0.6 |         1.7 |                      0.6 |
| insert one row, concurrency 50: p99                |     0.9 | **0.5** |        0.7 |         2.3 |                      1.7 |
| insert one row, concurrency 50: max                |     0.9 | **0.5** |        0.7 |         2.3 |                      1.7 |
| fetch 1k rows (6 columns): p99                     | **0.7** |     1.7 |        1.6 |         4.7 |                      2.2 |
| fetch 1k rows (6 columns): max                     | **0.7** |     1.7 |        1.6 |         4.7 |                      2.2 |
| fetch 100k rows: p99                               |    11.8 |    51.4 |       46.5 |        21.0 |                  **5.0** |
| fetch 100k rows: max                               |    12.7 |    51.4 |       46.5 |        21.4 |                  **6.3** |
| fetch 1M rows (one result): p99                    |    27.9 |    58.6 |       64.9 |        31.1 |                  **4.6** |
| fetch 1M rows (one result): max                    |    32.4 |    76.1 |       76.0 |        40.9 |                 **14.9** |
| stream 1M rows with a cursor (1000 per batch): p99 | **0.6** |     1.6 |        1.4 |         4.5 |                      n/a |
| stream 1M rows with a cursor (1000 per batch): max | **0.6** |     2.8 |        1.6 |         5.1 |                      n/a |

**Deno 2.9: connections (median time per operation)**

| Scenario                                                    |          quarry |           pg |  pg (named) |  postgres.js | deno-postgres (stock) | deno-postgres (+nodelay) |
| ----------------------------------------------------------- | --------------: | -----------: | ----------: | -----------: | --------------------: | -----------------------: |
| connect + select 1 + close (no TLS, trust)                  | **2.28 ms ±1%** |  3.90 ms ±3% | 3.95 ms ±3% |  7.92 ms ±5% |           2.40 ms ±2% |              2.41 ms ±4% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | **2.55 ms ±3%** |  5.22 ms ±5% | 5.19 ms ±3% |  9.70 ms ±1% |                     — |              3.80 ms ±2% |
| connect + select 1 + close (TLS verify-full, trust)         |     4.60 ms ±5% |  4.49 ms ±1% | 4.46 ms ±1% | 52.37 ms ±1% |                     — |          **3.98 ms ±8%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) | **4.94 ms ±2%** |  5.89 ms ±2% | 5.93 ms ±2% | 55.57 ms ±5% |                     — |             5.34 ms ±11% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     | **7.67 ms ±2%** | 8.40 ms ±25% | 8.40 ms ±6% | 15.85 ms ±1% |                     — |              8.27 ms ±7% |

**Deno 2.9: cancellation, notifications, errors**

| Scenario                                      |        quarry |        pg |  pg (named) | postgres.js | deno-postgres (+nodelay) |
| --------------------------------------------- | ------------: | --------: | ----------: | ----------: | -----------------------: |
| cancel: time from cancel() to rejection (p50) |       1.48 ms |   1.51 ms | **1.45 ms** |     1.54 ms |                      n/a |
| cancel: share of queries actually cancelled   |      **100%** |  **100%** |    **100%** |    **100%** |                      n/a |
| NOTIFY latency p50                            |   **33.0 µs** |   44.8 µs |     41.3 µs |     40.4 µs |                      n/a |
| NOTIFY latency p99                            |   **60.7 µs** |   97.4 µs |     97.7 µs |     79.8 µs |                      n/a |
| NOTIFY throughput (notifications/s)           | **2,595,671** | 1,854,845 |   1,866,123 |   1,772,958 |                      n/a |
| error path: failing queries/s                 |    **27,432** |       421 |         407 |       9,397 |                   21,374 |

**Deno 2.9: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 42,182 / 32,055 / +32% |  31,813 / 31,776 / +0% |   29,183 / 29,578 / -1% |
| point lookup by primary key             | 34,861 / 19,265 / +81% | 23,791 / 18,762 / +27% | 25,297 / 12,437 / +103% |
| range scan, 100 rows                    |  10,608 / 6,467 / +64% |    4,960 / 4,820 / +3% |    5,657 / 4,660 / +21% |
| fetch 1k rows (6 columns)               |  3,071 / 1,259 / +144% |        725 / 728 / -0% |         874 / 878 / -1% |
| 100 parameters (id in (…)), 100 rows    |   4,274 / 3,225 / +33% |   3,469 / 2,851 / +22% |    3,370 / 2,501 / +35% |
| 1000 parameters (id in (…)), 1000 rows  |       513 / 409 / +25% |       430 / 363 / +18% |        414 / 339 / +22% |
| insert one row                          | 34,854 / 25,282 / +38% | 27,091 / 21,888 / +24% |  24,545 / 12,898 / +90% |
| upsert (insert … on conflict do update) | 29,123 / 22,385 / +30% | 22,811 / 19,709 / +16% |  22,659 / 12,418 / +82% |

**Deno 2.9: shipped defaults vs tuned (median latency)**

| Scenario                                   | deno-postgres (+nodelay) | deno-postgres (stock) |
| ------------------------------------------ | -----------------------: | --------------------: |
| select 1                                   |                  36.3 µs |           **36.1 µs** |
| point lookup by primary key                |              **70.8 µs** |              43.99 ms |
| fetch 1k rows (6 columns)                  |              **7.89 ms** |               7.92 ms |
| insert one row                             |              **55.4 µs** |              43.99 ms |
| transaction: begin; insert; commit         |                   111 µs |                     — |
| connect + select 1 + close (no TLS, trust) |                  2.41 ms |           **2.40 ms** |

## Across runtimes

**Throughput (operations/s) by runtime**

| Scenario                           | quarry (node) | pg (node) | pg (named) (node) | pg-native (node) | postgres.js (node) | neon (WS) (node) | quarry (bun) | pg (bun) | pg (named) (bun) | postgres.js (bun) | Bun.sql (bun) | quarry (deno) | pg (deno) | pg (named) (deno) | postgres.js (deno) | deno-postgres (+nodelay) (deno) |
| ---------------------------------- | ------------: | --------: | ----------------: | ---------------: | -----------------: | ---------------: | -----------: | -------: | ---------------: | ----------------: | ------------: | ------------: | --------: | ----------------: | -----------------: | ------------------------------: |
| select 1                           |        44,934 |    35,429 |            35,418 |           30,615 |             32,906 |           20,053 |       49,977 |   41,973 |           43,884 |            39,334 |        39,165 |        42,182 |    31,776 |            31,813 |             29,183 |                          25,002 |
| point lookup by primary key        |        36,006 |    20,313 |            26,983 |           19,063 |             28,542 |           11,824 |       40,755 |   23,734 |           33,446 |            34,927 |        34,531 |        34,861 |    18,762 |            23,791 |             25,297 |                          12,867 |
| fetch 1k rows (6 columns)          |         3,037 |       761 |               779 |              633 |                943 |              640 |        3,589 |      993 |            1,018 |             1,045 |         2,518 |         3,071 |       728 |               725 |                874 |                             124 |
| fetch 100k rows                    |          38.3 |       8.5 |               8.3 |              7.0 |               10.5 |              7.5 |         41.4 |     11.4 |             11.4 |              12.5 |          30.1 |          29.0 |       7.6 |               7.7 |               10.3 |                             1.3 |
| insert one row                     |        36,737 |    24,356 |            31,047 |           21,641 |             27,844 |           13,523 |       40,260 |   26,606 |           35,933 |            33,530 |        33,977 |        34,854 |    21,888 |            27,091 |             24,545 |                          16,464 |
| insert one row, concurrency 50     |       277,475 |    88,432 |            76,723 |           71,619 |             40,727 |           33,740 |      239,045 |  100,083 |          106,432 |            64,071 |       145,671 |       235,970 |    71,497 |            65,411 |             56,364 |                          21,862 |
| transaction: begin; insert; commit |        18,519 |    11,875 |            13,200 |            9,694 |             10,639 |            6,264 |       20,698 |   13,278 |           14,998 |            13,067 |        10,723 |        16,971 |    10,320 |            11,453 |              9,388 |                           8,416 |

## Concurrency sweep (Node 24): point lookups/s

**Node 24: pool size 1, point lookups/s by concurrency**

| Concurrency |          quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |      postgres.js |   neon (WS) |
| ----------- | --------------: | -----------------------: | ----------: | ----------: | ----------: | ---------------: | ----------: |
| 1           |     35,432 ±27% |          **35,958 ±33%** | 20,019 ±23% |  26,936 ±1% | 19,014 ±17% |       28,973 ±3% | 12,074 ±17% |
| 10          |    114,121 ±29% |               36,269 ±8% | 20,971 ±16% |  28,239 ±7% | 18,583 ±18% |  **116,517 ±3%** | 12,385 ±32% |
| 50          |     120,079 ±8% |              30,425 ±20% | 20,748 ±21% | 22,807 ±25% | 19,601 ±13% | **124,912 ±23%** | 11,928 ±27% |
| 100         |     125,160 ±2% |               36,143 ±6% |  21,010 ±9% |  27,521 ±6% |  19,750 ±2% |  **126,465 ±3%** |  12,653 ±1% |
| 500         | **122,143 ±1%** |              36,422 ±36% |  21,245 ±3% | 28,163 ±11% |  19,790 ±6% |      115,951 ±2% | 12,440 ±31% |
| 1000        | **122,758 ±3%** |               35,982 ±3% |  21,364 ±2% | 27,953 ±27% |  19,734 ±1% |     114,461 ±21% |  12,541 ±3% |

**Node 24: pool size 1, p99 latency by concurrency**

| Concurrency |       quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | -----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           |  **35.6 µs** |                  37.4 µs |  75.1 µs |    57.2 µs |   77.5 µs |     48.7 µs |    156 µs |
| 10          |   **138 µs** |                   669 µs |  1.04 ms |     841 µs |    998 µs |      153 µs |   1.46 ms |
| 50          |       981 µs |                  2.61 ms |  3.53 ms |    3.26 ms |   3.51 ms |  **777 µs** |   6.57 ms |
| 100         |  **1.52 ms** |                  3.78 ms |  6.93 ms |    5.18 ms |   6.72 ms |     3.74 ms |   9.53 ms |
| 500         |  **5.85 ms** |                 16.19 ms | 29.83 ms |   23.23 ms |  31.92 ms |     9.53 ms |  50.58 ms |
| 1000        | **10.58 ms** |                 34.92 ms | 54.12 ms |   42.75 ms |  56.19 ms |    15.99 ms |  92.59 ms |

**Node 24: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |  postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | -----------: | ----------: |
| 1           |      34,663 ±32% |          **35,614 ±17%** | 20,482 ±24% |  27,232 ±9% | 19,057 ±23% |   28,580 ±2% |  12,174 ±5% |
| 10          | **150,205 ±14%** |             111,045 ±25% |  66,595 ±9% |  59,016 ±8% | 53,816 ±14% |   42,109 ±1% |  28,978 ±9% |
| 50          | **346,127 ±10%** |              97,845 ±12% | 61,060 ±11% |  59,840 ±4% |  57,989 ±7% |   41,171 ±2% |  28,674 ±3% |
| 100         | **451,434 ±21%** |              93,985 ±17% | 64,719 ±23% |  59,794 ±4% | 58,136 ±14% |   42,323 ±1% |  28,807 ±9% |
| 500         |  **481,409 ±8%** |              93,428 ±12% | 61,266 ±10% |  58,644 ±9% | 57,679 ±16% |  151,660 ±3% | 31,685 ±25% |
| 1000        | **376,802 ±13%** |             104,441 ±28% | 56,856 ±15% | 60,307 ±12% | 58,890 ±17% | 140,320 ±11% | 29,185 ±11% |

**Node 24: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           |     45.6 µs |              **39.1 µs** |  71.4 µs |    57.7 µs |   71.3 µs |     49.7 µs |    148 µs |
| 10          |  **133 µs** |                   187 µs |   535 µs |     589 µs |    489 µs |      453 µs |    864 µs |
| 50          |  **378 µs** |                  1.24 ms |  1.60 ms |    1.53 ms |   1.52 ms |     2.50 ms |   3.14 ms |
| 100         | **1.11 ms** |                  2.08 ms |  2.67 ms |    2.80 ms |   2.70 ms |     5.45 ms |   5.29 ms |
| 500         | **5.00 ms** |                  8.01 ms | 11.15 ms |   12.39 ms |  12.12 ms |     8.24 ms |  20.66 ms |
| 1000        | **5.79 ms** |                 13.14 ms | 24.50 ms |   24.60 ms |  21.28 ms |    14.44 ms |  40.90 ms |

**Node 24: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |  postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | -----------: | ----------: |
| 1           |      35,253 ±31% |          **36,177 ±19%** |  20,310 ±3% | 26,810 ±28% |  19,102 ±1% |   28,777 ±4% |  12,134 ±8% |
| 10          |  **110,399 ±9%** |              91,512 ±29% | 66,381 ±12% | 59,351 ±13% |  61,676 ±6% |   69,638 ±8% |  31,027 ±6% |
| 50          | **311,549 ±12%** |             108,779 ±23% |  61,399 ±8% |  58,004 ±8% | 52,082 ±16% |   42,143 ±2% | 28,155 ±62% |
| 100         | **457,747 ±13%** |             104,724 ±11% |  61,672 ±7% |  56,987 ±8% |  59,961 ±1% |   42,225 ±1% | 28,060 ±24% |
| 500         | **484,255 ±13%** |             106,031 ±20% | 66,931 ±22% | 57,916 ±14% |  55,878 ±8% |  133,382 ±7% | 31,627 ±57% |
| 1000        | **450,898 ±18%** |             106,463 ±14% | 64,926 ±13% | 60,263 ±13% | 59,986 ±10% | 148,456 ±15% | 31,486 ±36% |

**Node 24: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **36.7 µs** |                  37.3 µs |  72.5 µs |    61.2 µs |   68.0 µs |     49.2 µs |    153 µs |
| 10          |  **190 µs** |                   226 µs |   470 µs |     596 µs |    403 µs |      260 µs |    908 µs |
| 50          |  **519 µs** |                  1.22 ms |  1.54 ms |    1.62 ms |   1.62 ms |     2.52 ms |   2.75 ms |
| 100         | **1.13 ms** |                  1.97 ms |  2.76 ms |    2.83 ms |   2.56 ms |     5.26 ms |   6.11 ms |
| 500         | **4.97 ms** |                  7.31 ms | 11.99 ms |   12.83 ms |  11.25 ms |    10.62 ms |  22.11 ms |
| 1000        | **9.01 ms** |                 13.94 ms | 23.22 ms |   25.55 ms |  22.30 ms |    13.93 ms |  40.75 ms |

**Node 24: pool size 50, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| 1           |   **36,342 ±1%** |              36,222 ±37% | 20,404 ±11% |  26,920 ±2% | 19,015 ±11% |  28,556 ±1% | 11,319 ±27% |
| 10          |     109,286 ±22% |         **116,087 ±15%** | 61,274 ±15% | 61,890 ±11% |  57,665 ±5% |  68,189 ±5% |  30,675 ±8% |
| 50          |      105,116 ±4% |         **107,822 ±20%** | 58,624 ±14% |  58,162 ±5% | 55,926 ±12% |  62,715 ±7% |  30,376 ±9% |
| 100         | **148,435 ±10%** |             102,943 ±18% | 64,493 ±13% | 54,535 ±18% | 52,675 ±10% |  41,876 ±3% | 27,614 ±22% |
| 500         | **351,877 ±12%** |             101,974 ±11% | 58,797 ±13% | 54,442 ±12% |  56,663 ±8% |  42,946 ±2% | 30,417 ±16% |
| 1000        |  **412,088 ±9%** |              91,893 ±11% | 63,310 ±23% |  55,146 ±8% |  54,066 ±8% |  43,299 ±1% |  30,025 ±8% |

**Node 24: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **34.8 µs** |                  36.5 µs |  70.9 µs |    56.6 µs |   69.1 µs |     49.7 µs |    159 µs |
| 10          |  **193 µs** |                   200 µs |   608 µs |     512 µs |    413 µs |      255 µs |    932 µs |
| 50          |     1.17 ms |              **1.15 ms** |  1.88 ms |    1.76 ms |   1.64 ms |     1.85 ms |   3.82 ms |
| 100         | **1.68 ms** |                  2.04 ms |  2.90 ms |    3.35 ms |   3.07 ms |     6.22 ms |   5.83 ms |
| 500         | **3.25 ms** |                  7.52 ms | 11.44 ms |   15.21 ms |  12.64 ms |    24.07 ms |  22.45 ms |
| 1000        | **6.37 ms** |                 15.65 ms | 24.12 ms |   25.67 ms |  23.83 ms |    47.60 ms |  41.58 ms |

## Concurrency sweep (Bun 1.4): point lookups/s

**Bun 1.4: pool size 1, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |  postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | -----------: | ----------: |
| 1           |  **35,107 ±25%** |  23,776 ±5% |  34,476 ±32% |  34,626 ±6% |
| 10          |  **117,774 ±2%** | 24,254 ±23% | 116,498 ±18% | 85,598 ±36% |
| 50          | **120,637 ±26%** |  24,193 ±3% | 117,433 ±25% | 85,348 ±30% |
| 100         | **122,533 ±11%** |  24,209 ±1% |  122,428 ±1% | 90,569 ±20% |
| 500         |  **123,045 ±2%** |  23,086 ±7% | 111,800 ±22% |  93,647 ±3% |
| 1000        |  **123,435 ±3%** |  23,702 ±2% |  111,843 ±9% |  94,814 ±3% |

**Bun 1.4: pool size 1, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |     Bun.sql |
| ----------- | ----------: | -------: | ----------: | ----------: |
| 1           |     43.7 µs |  53.2 µs |     39.0 µs | **37.0 µs** |
| 10          |  **112 µs** |   807 µs |      128 µs |      159 µs |
| 50          |  **536 µs** |  3.02 ms |      976 µs |     1.26 ms |
| 100         | **1.14 ms** |  5.22 ms |     1.61 ms |     1.79 ms |
| 500         | **5.10 ms** | 24.61 ms |     6.48 ms |     6.52 ms |
| 1000        | **9.43 ms** | 44.36 ms |    10.48 ms |    12.19 ms |

**Bun 1.4: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry |          pg | postgres.js |      Bun.sql |
| ----------- | ---------------: | ----------: | ----------: | -----------: |
| 1           |   **40,543 ±3%** | 23,644 ±18% |  34,649 ±2% |  34,751 ±31% |
| 10          |  **198,432 ±6%** | 84,417 ±27% |  61,903 ±5% | 112,883 ±10% |
| 50          | **409,529 ±12%** | 71,917 ±17% |  64,674 ±2% |  179,386 ±7% |
| 100         | **468,275 ±11%** | 79,797 ±13% |  65,683 ±1% |  184,860 ±3% |
| 500         | **481,299 ±11%** | 78,251 ±13% | 208,472 ±4% |  191,457 ±5% |
| 1000        |  **460,686 ±5%** | 68,208 ±14% | 208,655 ±9% |  207,585 ±2% |

**Bun 1.4: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js | Bun.sql |
| ----------- | ----------: | -------: | ----------: | ------: |
| 1           | **31.2 µs** |  54.3 µs |     38.1 µs | 36.8 µs |
| 10          | **78.2 µs** |   553 µs |      346 µs |  161 µs |
| 50          |  **426 µs** |  1.40 ms |     1.77 ms | 1.09 ms |
| 100         | **1.17 ms** |  2.28 ms |     3.23 ms | 1.69 ms |
| 500         |     5.37 ms |  8.05 ms | **4.51 ms** | 5.10 ms |
| 1000        | **5.89 ms** | 16.29 ms |     6.89 ms | 8.70 ms |

**Bun 1.4: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry |          pg |  postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | -----------: | ----------: |
| 1           |  **39,794 ±34%** | 23,625 ±24% |   34,625 ±2% | 34,361 ±32% |
| 10          | **143,194 ±15%** | 83,531 ±23% |   93,378 ±6% | 78,467 ±16% |
| 50          | **393,261 ±16%** |  84,922 ±9% |   63,389 ±6% | 145,337 ±7% |
| 100         |  **470,817 ±9%** | 75,759 ±11% |   64,293 ±6% | 170,140 ±2% |
| 500         | **469,318 ±11%** | 78,538 ±17% | 176,905 ±14% | 190,314 ±4% |
| 1000        | **427,079 ±12%** | 69,471 ±15% |  206,359 ±4% | 195,373 ±5% |

**Bun 1.4: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |     Bun.sql |
| ----------- | ----------: | -------: | ----------: | ----------: |
| 1           | **35.3 µs** |  53.3 µs |     39.0 µs |     37.4 µs |
| 10          |  **130 µs** |   567 µs |      204 µs |      254 µs |
| 50          |  **332 µs** |  1.40 ms |     1.89 ms |     1.27 ms |
| 100         |  **943 µs** |  2.30 ms |     3.40 ms |     1.61 ms |
| 500         |     5.48 ms |  9.52 ms |     7.05 ms | **5.37 ms** |
| 1000        | **6.30 ms** | 17.71 ms |     8.35 ms |     9.87 ms |

**Bun 1.4: pool size 50, point lookups/s by concurrency**

| Concurrency |           quarry |          pg | postgres.js |     Bun.sql |
| ----------- | ---------------: | ----------: | ----------: | ----------: |
| 1           |  **40,283 ±24%** | 23,693 ±12% |  34,452 ±7% | 33,855 ±32% |
| 10          |  **143,899 ±7%** |  81,462 ±9% |  93,375 ±7% | 74,605 ±11% |
| 50          | **138,413 ±32%** | 82,204 ±10% | 76,600 ±10% | 75,901 ±12% |
| 100         |  **186,172 ±7%** |  73,816 ±4% |  60,545 ±7% | 102,587 ±8% |
| 500         | **413,708 ±10%** | 70,916 ±10% |  65,299 ±1% | 150,488 ±3% |
| 1000        |  **476,386 ±4%** | 69,342 ±13% | 65,465 ±11% | 155,952 ±4% |

**Bun 1.4: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry |       pg | postgres.js |  Bun.sql |
| ----------- | ----------: | -------: | ----------: | -------: |
| 1           | **30.9 µs** |  54.9 µs |     38.6 µs |  38.4 µs |
| 10          |  **121 µs** |   554 µs |      207 µs |   265 µs |
| 50          |  **756 µs** |  1.37 ms |     1.53 ms |  1.26 ms |
| 100         | **1.05 ms** |  2.66 ms |     3.58 ms |  1.84 ms |
| 500         | **2.77 ms** |  9.06 ms |    15.97 ms |  6.51 ms |
| 1000        | **7.61 ms** | 16.60 ms |    31.93 ms | 12.22 ms |

## Pipelining depth

**quarry, one connection, 100 concurrent point lookups: throughput by `pipeline` depth (columns: RTT ms)**

| pipeline           |               0 |          5 |
| ------------------ | --------------: | ---------: |
| 1                  |  **21,352 ±1%** |    170 ±1% |
| 2                  |  **41,963 ±3%** |    340 ±1% |
| 4                  |  **74,645 ±4%** |    679 ±1% |
| 8                  | **113,195 ±4%** |  1,343 ±1% |
| 16                 | **116,665 ±3%** | 2,648 ±<1% |
| 32                 | **117,173 ±2%** |  5,162 ±2% |
| 64                 | **118,621 ±3%** |  9,862 ±2% |
| 100                | **121,753 ±2%** | 16,121 ±4% |
| adaptive (default) | **120,953 ±6%** | 16,892 ±2% |

## db.batch

**quarry's query builder, 3 statements per operation: operations/s (columns: RTT ms)**

| Scenario                                                                  |               0 |        5 |
| ------------------------------------------------------------------------- | --------------: | -------: |
| 3 statements (lookup, insert, update): one after another                  |   **6,182 ±1%** | 56.5 ±1% |
| 3 statements (lookup, insert, update): Promise.all                        | **12,997 ±11%** |  167 ±1% |
| 3 statements (lookup, insert, update): db.batch                           |  **11,885 ±6%** | 168 ±<1% |
| 3 statements (lookup, insert, update) in a transaction: one after another |  **4,707 ±26%** | 42.6 ±1% |
| 3 statements (lookup, insert, update) in a transaction: Promise.all       |   **5,798 ±2%** | 56.6 ±1% |
| 3 statements (lookup, insert, update) in a transaction: db.batch          | **10,750 ±12%** |  166 ±1% |

## Query builder under concurrency

**Node, pool 10, 0 ms RTT: operations/s (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              |   quarry builder |           quarry |          pg |  postgres.js |
| ------------------------------- | ---------------: | ---------------: | ----------: | -----------: |
| lookup, 1                       |  **19,906 ±40%** |      16,689 ±29% | 13,708 ±16% |  15,012 ±17% |
| lookup, 100                     |     269,981 ±12% | **343,507 ±12%** |  67,315 ±7% |   42,307 ±3% |
| lookup, 500                     |     312,425 ±12% |  **438,403 ±7%** |  66,496 ±4% | 129,752 ±15% |
| lookup, 1000                    |     304,330 ±10% |  **388,839 ±6%** | 60,262 ±23% | 152,455 ±15% |
| lookup, statement timeout, 1    |      13,156 ±24% |                — |           — |            — |
| lookup, statement timeout, 100  |     160,668 ±15% |                — |           — |            — |
| lookup, statement timeout, 500  |     186,621 ±13% |                — |           — |            — |
| lookup, statement timeout, 1000 |      163,030 ±8% |                — |           — |            — |
| insert, 1                       |      19,550 ±27% |  **21,386 ±25%** | 13,923 ±20% |  17,741 ±14% |
| insert, 100                     | **181,594 ±22%** |     175,399 ±50% | 70,382 ±12% |  40,473 ±10% |
| insert, 500                     | **177,709 ±17%** |      150,156 ±9% | 62,663 ±25% |  113,503 ±7% |
| insert, 1000                    | **171,958 ±40%** |     157,364 ±29% | 64,366 ±23% |  133,333 ±8% |
| update, 1                       |      17,240 ±27% |  **19,394 ±35%** | 14,980 ±18% |  14,958 ±14% |
| update, 100                     | **245,595 ±32%** |     203,374 ±38% | 72,065 ±36% |   42,370 ±2% |
| update, 500                     |     190,674 ±30% |  **195,498 ±6%** | 70,704 ±25% | 129,589 ±13% |
| update, 1000                    |     189,016 ±40% |  **198,097 ±6%** |  70,888 ±8% | 162,945 ±15% |

**Node, pool 10, 0 ms RTT: p99 latency (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              |    quarry builder |           quarry |            pg |    postgres.js |
| ------------------------------- | ----------------: | ---------------: | ------------: | -------------: |
| lookup, 1                       |      76.8 µs ±68% | **76.1 µs ±35%** |   117 µs ±14% |   96.0 µs ±26% |
| lookup, 100                     |      1.50 ms ±18% | **1.24 ms ±22%** |  2.70 ms ±17% |   5.16 ms ±32% |
| lookup, 500                     |       5.68 ms ±6% | **5.32 ms ±17%** | 12.12 ms ±21% |  12.63 ms ±24% |
| lookup, 1000                    |      8.84 ms ±26% | **8.18 ms ±28%** | 26.47 ms ±17% |  13.89 ms ±21% |
| lookup, statement timeout, 1    |       134 µs ±28% |                — |             — |              — |
| lookup, statement timeout, 100  |      2.01 ms ±39% |                — |             — |              — |
| lookup, statement timeout, 500  |      6.68 ms ±35% |                — |             — |              — |
| lookup, statement timeout, 1000 |      14.40 ms ±9% |                — |             — |              — |
| insert, 1                       |      85.8 µs ±32% | **70.7 µs ±23%** |   108 µs ±18% |   85.1 µs ±19% |
| insert, 100                     |  **2.50 ms ±41%** |     4.65 ms ±66% |  3.15 ms ±22% |   5.76 ms ±14% |
| insert, 500                     | **10.74 ms ±19%** |    14.64 ms ±13% | 12.40 ms ±32% |  14.27 ms ±10% |
| insert, 1000                    | **17.20 ms ±33%** |    20.06 ms ±13% | 25.99 ms ±10% |  17.73 ms ±21% |
| update, 1                       |      94.3 µs ±24% | **70.4 µs ±48%** |  99.8 µs ±31% |   93.3 µs ±28% |
| update, 100                     |      2.39 ms ±59% | **2.22 ms ±72%** | 2.42 ms ±127% |   5.49 ms ±10% |
| update, 500                     |       8.30 ms ±9% |  **7.67 ms ±6%** | 11.84 ms ±16% |  12.09 ms ±25% |
| update, 1000                    | **11.38 ms ±13%** |    11.87 ms ±15% | 22.34 ms ±24% | 14.00 ms ±111% |

**Node, pool 10, 5 ms RTT: operations/s (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              |  quarry builder |           quarry |         pg | postgres.js |
| ------------------------------- | --------------: | ---------------: | ---------: | ----------: |
| lookup, 1                       |        169 ±<1% |      **169 ±1%** |    167 ±1% |     169 ±1% |
| lookup, 100                     |      16,112 ±2% |   **16,276 ±1%** |  1,653 ±2% |  13,971 ±3% |
| lookup, 500                     |      75,861 ±5% |   **75,902 ±2%** | 1,658 ±<1% |  38,554 ±4% |
| lookup, 1000                    | **160,208 ±6%** |      155,092 ±5% |  1,640 ±1% |  75,356 ±1% |
| lookup, statement timeout, 1    |        168 ±<1% |                — |          — |           — |
| lookup, statement timeout, 100  |      15,907 ±2% |                — |          — |           — |
| lookup, statement timeout, 500  |      80,137 ±2% |                — |          — |           — |
| lookup, statement timeout, 1000 |     149,760 ±9% |                — |          — |           — |
| insert, 1                       |        168 ±<1% |      **170 ±1%** |    169 ±1% |     170 ±1% |
| insert, 100                     |      16,107 ±1% |   **16,374 ±1%** |  1,663 ±1% |  13,939 ±4% |
| insert, 500                     |      80,942 ±2% |   **81,305 ±8%** |  1,655 ±2% |  38,158 ±4% |
| insert, 1000                    |     162,005 ±2% |  **164,746 ±3%** |  1,660 ±2% |  73,515 ±2% |
| update, 1                       |         168 ±1% |      **170 ±1%** |    167 ±1% |     170 ±1% |
| update, 100                     |  **16,075 ±2%** |       16,029 ±1% |  1,657 ±1% |  13,260 ±1% |
| update, 500                     |      81,611 ±7% |   **81,765 ±3%** |  1,657 ±4% |  39,774 ±2% |
| update, 1000                    |     168,366 ±7% | **171,558 ±33%** |  1,656 ±1% |  72,537 ±2% |

**Node, pool 10, 5 ms RTT: p99 latency (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              | quarry builder |           quarry |            pg |     postgres.js |
| ------------------------------- | -------------: | ---------------: | ------------: | --------------: |
| lookup, 1                       |    6.22 ms ±3% |      6.19 ms ±2% |   6.34 ms ±2% | **6.18 ms ±6%** |
| lookup, 100                     |    6.82 ms ±3% | **6.68 ms ±36%** | 68.23 ms ±26% |    12.04 ms ±5% |
| lookup, 500                     |    8.49 ms ±2% |  **7.94 ms ±2%** |    303 ms ±2% |    26.89 ms ±8% |
| lookup, 1000                    |  10.64 ms ±56% | **9.32 ms ±13%** |    613 ms ±3% |    20.28 ms ±6% |
| lookup, statement timeout, 1    |    6.28 ms ±2% |                — |             — |               — |
| lookup, statement timeout, 100  |   7.03 ms ±27% |                — |             — |               — |
| lookup, statement timeout, 500  |   8.83 ms ±11% |                — |             — |               — |
| lookup, statement timeout, 1000 |  13.54 ms ±23% |                — |             — |               — |
| insert, 1                       |    6.24 ms ±2% |  **6.17 ms ±2%** |   6.26 ms ±1% |     6.30 ms ±4% |
| insert, 100                     |   7.40 ms ±18% |  **6.93 ms ±4%** | 61.63 ms ±13% |    12.21 ms ±3% |
| insert, 500                     |    8.59 ms ±7% | **8.22 ms ±20%** |    308 ms ±6% |    28.39 ms ±7% |
| insert, 1000                    |  10.76 ms ±14% | **9.27 ms ±12%** |    609 ms ±6% |    21.07 ms ±8% |
| update, 1                       |    6.27 ms ±2% |      6.18 ms ±2% |  6.39 ms ±50% | **6.17 ms ±3%** |
| update, 100                     |    6.98 ms ±3% |  **6.95 ms ±5%** | 62.18 ms ±28% |    12.76 ms ±1% |
| update, 500                     |    8.31 ms ±8% |  **8.12 ms ±3%** |    310 ms ±3% |    25.68 ms ±3% |
| update, 1000                    |   9.80 ms ±23% | **8.57 ms ±66%** |    606 ms ±1% |    22.46 ms ±7% |

## Network latency (RTT through Toxiproxy)

**Node 24: select 1, sequential: median latency by RTT**

| RTT   |            quarry |               pg |   pg (named) |     pg-native |  postgres.js |     neon (WS) |
| ----- | ----------------: | ---------------: | -----------: | ------------: | -----------: | ------------: |
| 0 ms  |      55.9 µs ±27% | **44.0 µs ±71%** | 45.6 µs ±57% |  64.2 µs ±27% | 61.7 µs ±27% |  63.4 µs ±27% |
| 1 ms  |   **1.39 ms ±6%** |      1.46 ms ±4% |  1.40 ms ±3% |   1.44 ms ±7% |  1.42 ms ±5% |   1.56 ms ±6% |
| 5 ms  |   **5.82 ms ±4%** |     5.90 ms ±<1% |  5.88 ms ±2% |  5.89 ms ±<1% |  5.86 ms ±1% |   5.96 ms ±1% |
| 20 ms | **20.84 ms ±<1%** |    20.89 ms ±<1% | 20.91 ms ±1% | 20.87 ms ±<1% | 20.89 ms ±1% | 20.98 ms ±<1% |

**Node 24: point lookup, sequential: median latency by RTT**

| RTT   |            quarry |            pg |    pg (named) |     pg-native |      postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | ------------: | ------------: | ---------------: | ------------: |
| 0 ms  |      60.3 µs ±26% |  83.9 µs ±22% |  57.5 µs ±48% |  70.2 µs ±36% | **53.8 µs ±54%** |   120 µs ±20% |
| 1 ms  |   **1.42 ms ±1%** |   1.55 ms ±9% |   1.50 ms ±4% |   1.55 ms ±9% |      1.47 ms ±2% |   1.59 ms ±3% |
| 5 ms  |  **5.90 ms ±<1%** |   5.99 ms ±1% |   5.92 ms ±1% |  5.97 ms ±<1% |      5.91 ms ±1% |   6.05 ms ±1% |
| 20 ms | **20.90 ms ±<1%** | 21.01 ms ±<1% | 20.99 ms ±<1% | 20.98 ms ±<1% |    20.91 ms ±<1% | 21.13 ms ±<1% |

**Node 24: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |         pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----- | ---------------: | ---------: | ----------: | ----------: | ----------: | ----------: |
| 0 ms  | **228,424 ±22%** | 67,610 ±8% | 62,696 ±30% | 56,187 ±16% |  41,322 ±1% | 22,539 ±13% |
| 1 ms  |   **29,505 ±3%** |  5,800 ±2% |   6,093 ±2% |   5,723 ±2% |  17,937 ±5% |   5,021 ±3% |
| 5 ms  |    **8,286 ±1%** |  1,652 ±1% |   1,667 ±1% |   1,643 ±1% |   7,033 ±2% |   1,562 ±1% |
| 20 ms |   **2,359 ±<1%** |   473 ±<1% |    476 ±<1% |     473 ±1% |   2,004 ±3% |     467 ±1% |

**Node 24: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |           quarry |          pg |  pg (named) |   pg-native |  postgres.js |  neon (WS) |
| ----- | ---------------: | ----------: | ----------: | ----------: | -----------: | ---------: |
| 0 ms  | **118,107 ±26%** | 14,323 ±31% | 13,808 ±27% | 10,858 ±17% | 103,974 ±24% | 6,912 ±27% |
| 1 ms  |  **42,647 ±91%** |     646 ±2% |     668 ±3% |     643 ±3% |  30,958 ±26% |    623 ±8% |
| 5 ms  |   **16,281 ±3%** |    168 ±<1% |     169 ±1% |    168 ±<1% |  11,739 ±16% |    166 ±1% |
| 20 ms |    **4,680 ±2%** |    47.7 ±1% |   47.8 ±<1% |   47.7 ±<1% |    3,689 ±9% |  47.5 ±<1% |

**Node 24: point lookup, 500 concurrent, pool 1 (deep pipelining): operations/s by RTT**

| RTT   |           quarry |          pg |  pg (named) |   pg-native | postgres.js |  neon (WS) |
| ----- | ---------------: | ----------: | ----------: | ----------: | ----------: | ---------: |
| 0 ms  | **120,971 ±29%** | 14,158 ±18% | 17,713 ±34% | 13,958 ±29% |  97,423 ±3% | 8,623 ±24% |
| 1 ms  |  **94,751 ±32%** |     649 ±2% |     664 ±1% |     647 ±2% |  23,841 ±9% |    632 ±2% |
| 5 ms  |   **88,941 ±3%** |     169 ±3% |    171 ±<1% |     169 ±1% |   7,958 ±3% |   167 ±<1% |
| 20 ms |   **23,550 ±1%** |   47.8 ±<1% |   47.9 ±<1% |   47.7 ±<1% |   2,333 ±1% |  47.5 ±<1% |

**Node 24: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |            pg |    pg (named) |     pg-native |  postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | ------------: | ------------: | -----------: | ------------: |
| 0 ms  |   **335 µs ±14%** |   1.39 ms ±6% |   1.34 ms ±3% |   1.67 ms ±6% |  1.04 ms ±9% |   1.54 ms ±3% |
| 1 ms  |   **2.01 ms ±2%** |   3.04 ms ±3% |   3.06 ms ±3% |   3.27 ms ±4% |  2.93 ms ±4% |   3.29 ms ±2% |
| 5 ms  |  **6.30 ms ±<1%** |   7.32 ms ±1% |   7.25 ms ±1% |   7.42 ms ±1% |  7.07 ms ±2% |   7.51 ms ±1% |
| 20 ms | **21.38 ms ±<1%** | 22.37 ms ±<1% | 22.34 ms ±<1% | 22.41 ms ±<1% | 22.15 ms ±1% | 22.61 ms ±<1% |

**Node 24: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |            quarry |            pg |    pg (named) |     pg-native |   postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | ------------: | ------------: | ------------: | ------------: |
| 0 ms  |   **144 µs ±40%** |   224 µs ±37% |   214 µs ±40% |   158 µs ±59% |   194 µs ±28% |   217 µs ±40% |
| 1 ms  |   **2.93 ms ±1%** |   4.31 ms ±1% |   4.35 ms ±2% |   4.32 ms ±1% |   4.36 ms ±2% |   4.43 ms ±7% |
| 5 ms  | **11.75 ms ±<1%** |  17.53 ms ±1% | 17.51 ms ±<1% | 17.58 ms ±<1% | 17.59 ms ±<1% | 17.83 ms ±<1% |
| 20 ms | **41.75 ms ±<1%** | 62.67 ms ±<1% | 62.53 ms ±<1% | 62.69 ms ±<1% | 62.66 ms ±<1% | 62.89 ms ±<1% |

**Node 24: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |         pg |  pg (named) |   pg-native | postgres.js |  neon (WS) |
| ----- | ---------------: | ---------: | ----------: | ----------: | ----------: | ---------: |
| 0 ms  | **184,770 ±26%** | 71,374 ±6% | 73,213 ±27% | 68,525 ±17% |  41,088 ±5% | 21,806 ±9% |
| 1 ms  |   **27,497 ±2%** |  5,908 ±2% |   6,161 ±2% |   5,782 ±4% |  18,097 ±3% |  5,150 ±2% |
| 5 ms  |    **8,151 ±1%** |  1,657 ±1% |   1,650 ±2% |  1,645 ±<1% |   6,842 ±2% |  1,573 ±2% |
| 20 ms |    **2,351 ±1%** |    474 ±1% |     475 ±1% |    474 ±<1% |   1,962 ±6% |   468 ±<1% |

**Node 24: connect + select 1 + close: median latency by RTT**

| RTT   |            quarry |               pg |   pg (named) |     pg-native |   postgres.js |     neon (WS) |
| ----- | ----------------: | ---------------: | -----------: | ------------: | ------------: | ------------: |
| 0 ms  |      3.05 ms ±10% | **2.70 ms ±15%** | 3.07 ms ±12% |   5.25 ms ±6% |   5.94 ms ±4% |  4.56 ms ±12% |
| 1 ms  |   **5.13 ms ±5%** |      5.19 ms ±4% |  5.41 ms ±6% |  10.05 ms ±2% |   9.71 ms ±2% |   7.25 ms ±7% |
| 5 ms  |  **13.90 ms ±1%** |     14.21 ms ±2% | 14.19 ms ±2% |  27.07 ms ±1% |  22.44 ms ±1% |  16.01 ms ±2% |
| 20 ms | **44.00 ms ±<1%** |    44.03 ms ±<1% | 44.02 ms ±1% | 87.53 ms ±<1% | 67.84 ms ±<1% | 46.69 ms ±<1% |

**Bun 1.4: select 1, sequential: median latency by RTT**

| RTT   |            quarry |          Bun.sql |
| ----- | ----------------: | ---------------: |
| 0 ms  |      50.0 µs ±30% | **44.2 µs ±56%** |
| 1 ms  |       1.39 ms ±1% |  **1.36 ms ±3%** |
| 5 ms  |      5.81 ms ±<1% | **5.80 ms ±<1%** |
| 20 ms | **20.82 ms ±<1%** |    20.83 ms ±<1% |

**Bun 1.4: point lookup, sequential: median latency by RTT**

| RTT   |           quarry |           Bun.sql |
| ----- | ---------------: | ----------------: |
| 0 ms  | **45.0 µs ±57%** |      46.9 µs ±68% |
| 1 ms  |      1.40 ms ±5% |   **1.37 ms ±1%** |
| 5 ms  |     5.88 ms ±<1% |   **5.79 ms ±1%** |
| 20 ms |    20.95 ms ±<1% | **20.86 ms ±<1%** |

**Bun 1.4: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |      Bun.sql |
| ----- | ---------------: | -----------: |
| 0 ms  | **206,952 ±36%** | 135,669 ±18% |
| 1 ms  |   **29,385 ±2%** |   27,366 ±4% |
| 5 ms  |    **8,355 ±1%** |    8,248 ±1% |
| 20 ms |   **2,376 ±<1%** |    2,358 ±1% |

**Bun 1.4: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |           quarry |         Bun.sql |
| ----- | ---------------: | --------------: |
| 0 ms  | **122,933 ±19%** |      92,264 ±2% |
| 1 ms  |     41,306 ±105% | **81,844 ±21%** |
| 5 ms  |       16,204 ±3% |  **16,242 ±8%** |
| 20 ms |    **4,778 ±2%** |       4,700 ±2% |

**Bun 1.4: point lookup, 500 concurrent, pool 1 (deep pipelining): operations/s by RTT**

| RTT   |           quarry |     Bun.sql |
| ----- | ---------------: | ----------: |
| 0 ms  | **120,557 ±28%** | 89,175 ±31% |
| 1 ms  | **121,546 ±27%** | 95,777 ±28% |
| 5 ms  |   **89,717 ±3%** | 67,971 ±24% |
| 20 ms |   **23,510 ±1%** |  23,249 ±1% |

**Bun 1.4: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |       Bun.sql |
| ----- | ----------------: | ------------: |
| 0 ms  |   **287 µs ±23%** |   417 µs ±18% |
| 1 ms  |   **1.94 ms ±2%** |   2.23 ms ±2% |
| 5 ms  |   **6.22 ms ±1%** |   6.51 ms ±1% |
| 20 ms | **21.34 ms ±<1%** | 21.58 ms ±<1% |

**Bun 1.4: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |            quarry |       Bun.sql |
| ----- | ----------------: | ------------: |
| 0 ms  |  **84.4 µs ±62%** |   193 µs ±26% |
| 1 ms  |   **2.88 ms ±2%** |   4.30 ms ±1% |
| 5 ms  |  **11.70 ms ±1%** |  17.39 ms ±1% |
| 20 ms | **41.77 ms ±<1%** | 62.51 ms ±<1% |

**Bun 1.4: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |      Bun.sql |
| ----- | ---------------: | -----------: |
| 0 ms  | **189,744 ±30%** | 130,230 ±14% |
| 1 ms  |   **27,186 ±2%** |   26,972 ±4% |
| 5 ms  |    **8,211 ±1%** |    8,207 ±1% |
| 20 ms |   **2,365 ±<1%** |    2,364 ±1% |

**Bun 1.4: connect + select 1 + close: median latency by RTT**

| RTT   |        quarry |          Bun.sql |
| ----- | ------------: | ---------------: |
| 0 ms  |  3.04 ms ±12% | **2.93 ms ±12%** |
| 1 ms  |   5.31 ms ±4% |  **4.95 ms ±8%** |
| 5 ms  |  13.86 ms ±1% | **13.67 ms ±2%** |
| 20 ms | 44.10 ms ±<1% | **43.87 ms ±1%** |

## PgBouncer

**Node 24 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |           quarry | quarry (prepare: false) |          pg |  pg (named) |   pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | ---------------: | ----------------------: | ----------: | ----------: | ----------: | ----------: | ---------------------------: |
| select 1                                               |  **19,917 ±15%** |             18,187 ±33% | 18,161 ±13% | 18,543 ±22% | 19,308 ±17% | 18,940 ±19% |                  18,843 ±11% |
| point lookup by primary key                            |  **16,637 ±17%** |             11,105 ±18% | 13,773 ±21% |  15,640 ±4% | 13,761 ±12% | 16,113 ±17% |                   8,203 ±22% |
| point lookup by primary key, concurrency 50            | **105,379 ±23%** |             74,752 ±15% | 67,721 ±31% | 61,029 ±21% |  68,872 ±8% |  40,138 ±2% |                  38,704 ±19% |
| fetch 1k rows (6 columns)                              |    **2,674 ±3%** |               1,175 ±8% |     726 ±2% |     739 ±1% |     607 ±2% |     808 ±9% |                      817 ±8% |
| insert one row                                         |  **19,344 ±22%** |             16,429 ±18% | 15,640 ±10% | 16,198 ±13% |  16,042 ±6% | 15,834 ±17% |                   8,696 ±20% |
| transaction: begin; insert; commit                     |   **9,332 ±34%** |               8,958 ±9% |  6,307 ±19% |  5,638 ±24% |  6,580 ±19% |  5,638 ±30% |                   4,488 ±23% |
| insert one row, concurrency 50                         |  **94,460 ±12%** |             94,365 ±22% | 72,365 ±14% |  67,429 ±9% | 73,183 ±35% |  39,040 ±6% |                  36,580 ±22% |
| query that fails (division by zero), connection reused |      13,384 ±15% |         **15,454 ±16%** |  5,005 ±16% |  4,736 ±12% |  4,289 ±11% |  11,978 ±6% |                  10,572 ±16% |

**Node 24 through PgBouncer: median latency**

| Scenario                                               |      quarry | quarry (prepare: false) |      pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | ----------: | ----------------------: | ------: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                                               | **45.2 µs** |                 50.2 µs | 47.1 µs |    50.3 µs |   47.1 µs |     49.8 µs |                      49.2 µs |
| point lookup by primary key                            |     59.8 µs |                 85.8 µs | 69.0 µs |    59.8 µs |   68.8 µs | **58.2 µs** |                       113 µs |
| point lookup by primary key, concurrency 50            |  **475 µs** |                  555 µs |  680 µs |     754 µs |    679 µs |     1.15 ms |                      1.16 ms |
| fetch 1k rows (6 columns)                              |  **354 µs** |                  802 µs | 1.35 ms |    1.38 ms |   1.66 ms |      991 µs |                       999 µs |
| insert one row                                         | **49.8 µs** |                 57.4 µs | 60.4 µs |    55.1 µs |   59.7 µs |     57.9 µs |                       108 µs |
| transaction: begin; insert; commit                     |  **102 µs** |                  107 µs |  145 µs |     177 µs |    146 µs |      162 µs |                       208 µs |
| insert one row, concurrency 50                         |      518 µs |              **488 µs** |  633 µs |     699 µs |    642 µs |     1.16 ms |                      1.24 ms |
| query that fails (division by zero), connection reused |     73.0 µs |             **61.1 µs** |  174 µs |     193 µs |    211 µs |     77.8 µs |                      89.8 µs |

**Node 24: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | quarry (prepare: false) |  pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ---------------------------------- | -----: | ----------------------: | --: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                           |    44% |                     55% | 51% |        52% |   **63%** |         58% |                          57% |
| point lookup by primary key        |    46% |                     60% | 68% |        58% |   **72%** |         56% |                          60% |
| fetch 1k rows (6 columns)          |    88% |                     93% | 95% |        95% |   **96%** |         86% |                          89% |
| insert one row                     |    53% |                     62% | 64% |        52% |   **74%** |         57% |                          60% |
| transaction: begin; insert; commit |    50% |                       — | 53% |        43% |   **68%** |         53% |                            — |

**Bun 1.4 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |          quarry |     Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | --------------: | ----------: | -----------------------: |
| select 1                                               | **22,202 ±22%** | 21,385 ±21% |              18,557 ±17% |
| point lookup by primary key                            | **20,380 ±37%** | 17,935 ±13% |              14,479 ±21% |
| point lookup by primary key, concurrency 50            | **102,480 ±7%** | 50,438 ±37% |              52,330 ±20% |
| fetch 1k rows (6 columns)                              |  **3,036 ±14%** |   2,187 ±7% |                2,194 ±5% |
| insert one row                                         | **19,579 ±20%** |  16,946 ±6% |               14,681 ±9% |
| transaction: begin; insert; commit                     |  **10,021 ±5%** |  6,917 ±21% |               6,569 ±22% |
| insert one row, concurrency 50                         |  **94,877 ±8%** | 51,168 ±20% |              52,567 ±13% |
| query that fails (division by zero), connection reused |      16,436 ±8% | 18,970 ±25% |          **19,109 ±22%** |

**Bun 1.4 through PgBouncer: median latency**

| Scenario                                               |      quarry | Bun.sql | Bun.sql (prepare: false) |
| ------------------------------------------------------ | ----------: | ------: | -----------------------: |
| select 1                                               | **43.3 µs** | 45.7 µs |                  56.7 µs |
| point lookup by primary key                            | **47.6 µs** | 53.6 µs |                  66.0 µs |
| point lookup by primary key, concurrency 50            |  **476 µs** |  983 µs |                   921 µs |
| fetch 1k rows (6 columns)                              |  **312 µs** |  442 µs |                   441 µs |
| insert one row                                         | **47.6 µs** | 56.8 µs |                  64.7 µs |
| transaction: begin; insert; commit                     | **96.8 µs** |  141 µs |                   149 µs |
| insert one row, concurrency 50                         |  **516 µs** |  966 µs |                   927 µs |
| query that fails (division by zero), connection reused |     57.2 µs | 50.4 µs |              **50.2 µs** |

**Bun 1.4: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | Bun.sql | Bun.sql (prepare: false) |
| ---------------------------------- | -----: | ------: | -----------------------: |
| select 1                           |    44% | **55%** |                      47% |
| point lookup by primary key        |    50% |     52% |                  **63%** |
| fetch 1k rows (6 columns)          |    85% |     87% |                  **87%** |
| insert one row                     |    49% |     50% |                  **58%** |
| transaction: begin; insert; commit |    48% | **65%** |                        — |

## Server restart

`pg_ctl restart -m fast` while a pool runs `select 1` every 5 ms (2 s client timeout per query).

| Runtime  | Client                   | Recovered | Time from server up to first success (median) | Failed queries (median) |
| -------- | ------------------------ | --------: | --------------------------------------------: | ----------------------: |
| Node 24  | quarry                   |       5/5 |                                       4.00 ms |                      27 |
| Node 24  | pg                       |       5/5 |                                       1.00 ms |                      28 |
| Node 24  | pg (named)               |       5/5 |                                       3.00 ms |                      27 |
| Node 24  | pg-native                |       5/5 |                                       2.00 ms |                      26 |
| Node 24  | postgres.js              |       5/5 |                                      77.00 ms |                      14 |
| Bun 1.4  | quarry                   |       5/5 |                                       3.00 ms |                      28 |
| Bun 1.4  | postgres.js              |       5/5 |                                      53.00 ms |                      15 |
| Bun 1.4  | Bun.sql                  |       5/5 |                                       2.00 ms |                      18 |
| Deno 2.9 | quarry                   |       5/5 |                                       3.00 ms |                      24 |
| Deno 2.9 | deno-postgres (+nodelay) |       0/5 |                                             — |                       — |

## Footprint and cold start

| Package                                              | Installed size | Packages installed |
| ---------------------------------------------------- | -------------: | -----------------: |
| quarry (whole package: query builder + driver + src) |       3863 KiB |                  1 |
| pg                                                   |        464 KiB |                 14 |
| pg + pg-native (libpq addon, built)                  |       1377 KiB |                 19 |
| postgres.js                                          |        293 KiB |                  1 |
| @neondatabase/serverless (+ ws on Node)              |        582 KiB |                  2 |
| deno-postgres (jsr, source modules)                  |        531 KiB |                  7 |
| Bun.sql (built into Bun)                             |          0 KiB |                  0 |

| Bundle (esbuild, minified, platform node) |                                                  Size |     gzip |
| ----------------------------------------- | ----------------------------------------------------: | -------: |
| quarry/driver                             |                                             123.3 KiB | 41.2 KiB |
| pg                                        |                                              84.4 KiB | 26.3 KiB |
| postgres.js                               |                                              37.1 KiB | 14.3 KiB |
| @neondatabase/serverless                  |                                             142.9 KiB | 46.3 KiB |
| pg-native                                 | native addon (libpq .node + libpq.so): not bundleable |          |

| Runtime / client   |   Import | Connect + first query | Process start → first result | Wall time of the process |
| ------------------ | -------: | --------------------: | ---------------------------: | -----------------------: |
| node/none          |   2.0 µs |               10.8 µs |                     41.41 ms |                 48.69 ms |
| node/quarry        |  7.09 ms |              10.61 ms |                     58.32 ms |                 64.27 ms |
| node/pg            | 22.21 ms |               6.73 ms |                     69.40 ms |                 74.97 ms |
| node/pg-native     | 20.76 ms |               7.66 ms |                     69.93 ms |                 76.71 ms |
| node/postgres.js   | 13.49 ms |               8.68 ms |                     64.65 ms |                 72.39 ms |
| node/neon          | 25.19 ms |              11.22 ms |                     76.35 ms |                 81.80 ms |
| bun/none           |   0.8 µs |               12.8 µs |                      1.95 ms |                  4.86 ms |
| bun/quarry         |  9.21 ms |              13.99 ms |                     25.01 ms |                 29.30 ms |
| bun/pg             | 13.79 ms |               8.21 ms |                     23.92 ms |                 27.53 ms |
| bun/postgres.js    | 12.45 ms |               9.22 ms |                     23.58 ms |                 29.48 ms |
| bun/bun.sql        |  3.26 ms |               3.99 ms |                      9.07 ms |                 12.78 ms |
| deno/none          |   2.3 µs |               16.0 µs |                      9.77 ms |                 19.93 ms |
| deno/quarry        |  3.74 ms |              14.02 ms |                     27.65 ms |                 38.66 ms |
| deno/pg            | 13.32 ms |               7.91 ms |                     32.57 ms |                 43.20 ms |
| deno/postgres.js   | 11.76 ms |              11.31 ms |                     34.62 ms |                 47.93 ms |
| deno/deno-postgres | 16.31 ms |               5.46 ms |                     31.29 ms |                 41.89 ms |
