### Correctness

Every result compared in canonical form (see `canon.ts`) against the majority digest for its scenario.

233 (client, scenario) results checked; 0 differ from the majority.

## Node 24

**Node 24: median latency (p50), sequential (one query at a time)**

| Scenario                                                      |           quarry |           pg |   pg (named) |    pg-native |  postgres.js |    neon (WS) |
| ------------------------------------------------------------- | ---------------: | -----------: | -----------: | -----------: | -----------: | -----------: |
| select 1                                                      |  **21.3 µs ±1%** | 26.0 µs ±53% | 26.4 µs ±51% |  31.3 µs ±1% |  28.7 µs ±2% | 46.7 µs ±71% |
| point lookup by primary key                                   |  **26.4 µs ±1%** |  46.0 µs ±1% |  35.2 µs ±3% |  49.6 µs ±1% |  32.4 µs ±3% | 79.3 µs ±46% |
| range scan, 100 rows                                          | **86.0 µs ±14%** |   187 µs ±2% |   183 µs ±4% |   197 µs ±2% |   157 µs ±1% |  226 µs ±17% |
| fetch 1k rows (6 columns)                                     |  **293 µs ±14%** |  1.33 ms ±4% |  1.30 ms ±1% |  1.65 ms ±3% |   923 µs ±8% | 1.51 ms ±14% |
| 100 parameters (id in (…)), 100 rows                          |   **219 µs ±3%** |   312 µs ±1% |   254 µs ±2% |   316 µs ±2% |   269 µs ±9% |   337 µs ±3% |
| 1000 parameters (id in (…)), 1000 rows                        |  **1.92 ms ±2%** |  2.51 ms ±4% |  2.01 ms ±2% |  2.67 ms ±6% |  2.16 ms ±2% |  2.47 ms ±4% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |  **1.72 ms ±3%** | 2.05 ms ±10% |  1.94 ms ±2% |  2.27 ms ±3% |  1.96 ms ±3% |  2.12 ms ±2% |
| insert one row                                                |  **26.0 µs ±1%** |  38.6 µs ±1% |  30.1 µs ±1% |  44.1 µs ±1% | 33.3 µs ±<1% | 70.1 µs ±54% |
| multi-row insert: 100 rows, 300 parameters                    |  **193 µs ±<1%** |   303 µs ±8% |   214 µs ±9% |   309 µs ±1% |   336 µs ±4% |  298 µs ±12% |
| update one row by primary key                                 | **30.6 µs ±50%** |  45.9 µs ±1% | 34.7 µs ±40% |  51.2 µs ±2% | 36.2 µs ±44% | 82.0 µs ±38% |
| upsert (insert … on conflict do update)                       | **30.9 µs ±44%** |  43.7 µs ±1% |  35.0 µs ±1% |  49.5 µs ±5% | 36.8 µs ±38% | 76.5 µs ±48% |
| delete one row by primary key                                 |  **25.4 µs ±1%** |  37.7 µs ±1% |  29.9 µs ±2% | 42.9 µs ±<1% |  30.7 µs ±1% |  108 µs ±36% |
| transaction: begin; select 1; commit                          |  **45.3 µs ±6%** |  67.9 µs ±1% |  69.2 µs ±1% |  83.1 µs ±1% |  80.0 µs ±4% |  210 µs ±40% |
| transaction: begin; insert; commit                            |  **50.8 µs ±5%** | 81.1 µs ±51% |  71.6 µs ±1% |  98.7 µs ±1% |  86.3 µs ±3% |  150 µs ±65% |
| transaction with 5 savepoints (select 1 in each)              |   **161 µs ±2%** |   375 µs ±2% |   380 µs ±1% |   460 µs ±1% |   327 µs ±5% |  743 µs ±60% |
| query that fails (division by zero), connection reused        | **33.7 µs ±40%** | 2.23 ms ±18% | 2.29 ms ±17% | 4.71 ms ±13% |  54.2 µs ±2% | 2.64 ms ±19% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **30.4 µs ±1%** | 41.3 µs ±18% |  36.9 µs ±2% |  46.9 µs ±1% |  35.8 µs ±1% |  119 µs ±38% |

**Node 24: throughput, sequential (operations/s)**

| Scenario                                                      |          quarry |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ------------------------------------------------------------- | --------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| select 1                                                      |  **45,145 ±1%** | 36,417 ±34% | 35,916 ±29% |  30,652 ±1% |  32,204 ±4% | 17,908 ±34% |
| point lookup by primary key                                   |  **36,142 ±2%** |  20,210 ±2% |  26,161 ±7% |  19,200 ±2% |  28,561 ±3% | 11,867 ±31% |
| range scan, 100 rows                                          |  **10,673 ±8%** |  4,986 ±16% |   5,062 ±7% |   4,901 ±2% |   5,767 ±2% |  4,002 ±14% |
| fetch 1k rows (6 columns)                                     |  **3,219 ±12%** |     757 ±2% |     779 ±2% |     621 ±4% |    941 ±10% |     644 ±8% |
| 100 parameters (id in (…)), 100 rows                          |  **4,443 ±11%** |   2,972 ±6% |   3,807 ±3% |   3,052 ±3% |  3,543 ±10% |   2,763 ±5% |
| 1000 parameters (id in (…)), 1000 rows                        |     **516 ±2%** |     391 ±4% |     486 ±2% |     371 ±6% |     449 ±1% |     396 ±4% |
| id = any($1) with 1000 ids (JS array), 1000 rows              |     **577 ±5%** |     482 ±9% |     507 ±3% |     433 ±4% |     487 ±5% |     458 ±2% |
| insert one row                                                |  **36,567 ±1%** |  24,627 ±2% |  31,274 ±8% |  21,477 ±1% |  27,975 ±5% | 13,136 ±33% |
| multi-row insert: 100 rows, 300 parameters                    |   **4,933 ±2%** |   3,114 ±6% |   4,413 ±9% |   3,113 ±1% |   2,827 ±3% |  3,182 ±12% |
| update one row by primary key                                 | **31,550 ±35%** |  20,705 ±5% | 26,491 ±20% |  18,747 ±4% | 25,975 ±28% | 11,331 ±31% |
| upsert (insert … on conflict do update)                       | **31,105 ±27%** |  21,765 ±4% |  27,078 ±2% | 19,224 ±11% | 25,508 ±24% | 12,080 ±30% |
| delete one row by primary key                                 |  **37,254 ±2%** |  24,931 ±5% |  31,707 ±6% |  22,255 ±1% |  30,403 ±4% |  8,898 ±51% |
| transaction: begin; select 1; commit                          | **20,745 ±20%** |  14,027 ±2% |  13,792 ±2% |  11,635 ±1% |  11,575 ±4% |  4,468 ±66% |
| transaction: begin; insert; commit                            | **17,824 ±14%** | 11,859 ±35% |  13,435 ±3% |   9,681 ±4% |  10,685 ±5% |  6,291 ±38% |
| transaction with 5 savepoints (select 1 in each)              |   **5,818 ±2%** |   2,581 ±2% |   2,536 ±1% |   2,113 ±3% |   2,838 ±5% |  1,145 ±30% |
| query that fails (division by zero), connection reused        | **27,933 ±27%** |    441 ±17% |    426 ±13% |    210 ±11% |  17,076 ±3% |    366 ±16% |
| LISTEN/NOTIFY latency: notify on another connection → handler |  **30,836 ±2%** | 22,315 ±15% |  24,874 ±2% |  20,211 ±1% |  25,401 ±4% |  7,801 ±60% |

**Node 24: tail latency p99, sequential**

| Scenario                                                      |      quarry |         pg |   pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ---------: | -----------: | --------: | ----------: | --------: |
| select 1                                                      | **28.3 µs** |    40.1 µs |      42.8 µs |   44.2 µs |     43.8 µs |    126 µs |
| point lookup by primary key                                   | **34.8 µs** |    71.8 µs |      57.8 µs |   67.0 µs |     49.5 µs |    177 µs |
| range scan, 100 rows                                          |      257 µs |     555 µs |       568 µs |    332 µs |  **241 µs** |    626 µs |
| fetch 1k rows (6 columns)                                     |  **720 µs** |    1.72 ms |      1.71 ms |   1.87 ms |     5.80 ms |   2.30 ms |
| 100 parameters (id in (…)), 100 rows                          |  **304 µs** |     712 µs |       380 µs |    594 µs |      423 µs |    852 µs |
| 1000 parameters (id in (…)), 1000 rows                        | **2.21 ms** |    3.71 ms |      2.52 ms |   3.07 ms |     3.33 ms |   3.16 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.02 ms** |    2.48 ms |      2.33 ms |   2.70 ms |     4.19 ms |   2.87 ms |
| insert one row                                                | **40.4 µs** |    63.2 µs |      54.4 µs |   69.7 µs |     56.7 µs |    152 µs |
| multi-row insert: 100 rows, 300 parameters                    |  **262 µs** |     606 µs |       346 µs |    495 µs |      626 µs |    576 µs |
| update one row by primary key                                 | **40.7 µs** |    68.7 µs |      58.2 µs |   68.3 µs |     59.5 µs |    170 µs |
| upsert (insert … on conflict do update)                       | **40.4 µs** |    63.9 µs |      54.4 µs |   69.9 µs |     55.0 µs |    164 µs |
| delete one row by primary key                                 | **34.7 µs** |    59.4 µs |      49.2 µs |   56.6 µs |     45.6 µs |    187 µs |
| transaction: begin; select 1; commit                          | **73.4 µs** |    91.7 µs |      93.6 µs |    105 µs |      115 µs |    379 µs |
| transaction: begin; insert; commit                            |      107 µs |     114 µs | **100.0 µs** |    130 µs |      128 µs |    253 µs |
| transaction with 5 savepoints (select 1 in each)              |      462 µs | **456 µs** |       463 µs |    584 µs |      506 µs |   2.33 ms |
| query that fails (division by zero), connection reused        | **49.0 µs** |    2.96 ms |      2.99 ms |   5.64 ms |     84.7 µs |   3.97 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler | **56.1 µs** |    82.8 µs |      80.7 µs |   79.8 µs |     70.9 µs |    319 µs |

**Node 24: tail latency p99.9, sequential**

| Scenario                                                      |      quarry |         pg | pg (named) |  pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------------- | ----------: | ---------: | ---------: | ---------: | ----------: | --------: |
| select 1                                                      |  **102 µs** |     356 µs |     374 µs |     287 µs |      267 µs |    603 µs |
| point lookup by primary key                                   |      282 µs |     501 µs |     433 µs |     435 µs |  **271 µs** |    669 µs |
| range scan, 100 rows                                          |  **561 µs** |     728 µs |     743 µs |     562 µs |     5.73 ms |    858 µs |
| fetch 1k rows (6 columns)                                     | **1.09 ms** |    2.24 ms |    2.02 ms |    2.20 ms |     9.00 ms |   2.95 ms |
| 100 parameters (id in (…)), 100 rows                          |  **781 µs** |    1.41 ms |    1.42 ms |     840 µs |     3.57 ms |   1.78 ms |
| 1000 parameters (id in (…)), 1000 rows                        | **2.86 ms** |    4.36 ms |    3.21 ms |    3.46 ms |     5.76 ms |   3.90 ms |
| id = any($1) with 1000 ids (JS array), 1000 rows              | **2.20 ms** |    3.06 ms |    2.91 ms |    3.69 ms |     6.85 ms |   6.68 ms |
| insert one row                                                |  **113 µs** |     423 µs |     440 µs |     413 µs |      284 µs |    562 µs |
| multi-row insert: 100 rows, 300 parameters                    |      707 µs |    1.34 ms |    1.31 ms | **650 µs** |     1.83 ms |   1.37 ms |
| update one row by primary key                                 |      299 µs |     460 µs |     434 µs |     430 µs |  **267 µs** |    591 µs |
| upsert (insert … on conflict do update)                       |  **289 µs** |     461 µs |     443 µs |     460 µs |      329 µs |    634 µs |
| delete one row by primary key                                 |  **254 µs** |     395 µs |     416 µs |     376 µs |      258 µs |    671 µs |
| transaction: begin; select 1; commit                          |      532 µs | **409 µs** |     682 µs |     415 µs |     1.28 ms |   2.20 ms |
| transaction: begin; insert; commit                            |      584 µs |     739 µs | **415 µs** |     752 µs |      845 µs |   1.64 ms |
| transaction with 5 savepoints (select 1 in each)              |  **926 µs** |    2.53 ms |    2.32 ms |    2.47 ms |     4.17 ms |   4.77 ms |
| query that fails (division by zero), connection reused        |  **393 µs** |    4.50 ms |    3.68 ms |    6.14 ms |      473 µs |   4.63 ms |
| LISTEN/NOTIFY latency: notify on another connection → handler |      421 µs |     510 µs |     513 µs | **406 µs** |      585 µs |    844 µs |

**Node 24: latency distribution, select 1**

| Percentile |           quarry |            pg |   pg (named) |     pg-native |  postgres.js |    neon (WS) |
| ---------- | ---------------: | ------------: | -----------: | ------------: | -----------: | -----------: |
| p50        |  **21.3 µs ±1%** |  26.0 µs ±53% | 26.4 µs ±51% |   31.3 µs ±1% |  28.7 µs ±2% | 46.7 µs ±71% |
| p90        |  **22.2 µs ±2%** |  27.6 µs ±53% | 27.5 µs ±52% |   32.5 µs ±1% |  31.6 µs ±9% | 67.5 µs ±29% |
| p99        |  **28.3 µs ±3%** |  40.1 µs ±38% | 42.8 µs ±30% |   44.2 µs ±8% | 43.8 µs ±19% |  126 µs ±37% |
| p99.9      |  **102 µs ±29%** |   356 µs ±44% |  374 µs ±45% |   287 µs ±23% |  267 µs ±45% |  603 µs ±22% |
| max        | **918 µs ±140%** | 1.45 ms ±167% | 1.17 ms ±91% | 1.34 ms ±123% | 6.54 ms ±23% | 2.56 ms ±69% |

**Node 24: latency distribution, point lookup by primary key**

| Percentile |           quarry |           pg |    pg (named) |    pg-native |     postgres.js |     neon (WS) |
| ---------- | ---------------: | -----------: | ------------: | -----------: | --------------: | ------------: |
| p50        |  **26.4 µs ±1%** |  46.0 µs ±1% |   35.2 µs ±3% |  49.6 µs ±1% |     32.4 µs ±3% |  79.3 µs ±46% |
| p90        | **27.6 µs ±21%** |  49.8 µs ±7% |  38.8 µs ±12% |  52.5 µs ±2% |     36.2 µs ±5% |  87.0 µs ±46% |
| p99        |  **34.8 µs ±8%** | 71.8 µs ±10% |  57.8 µs ±25% |  67.0 µs ±4% |    49.5 µs ±10% |   177 µs ±18% |
| p99.9      |      282 µs ±51% |   501 µs ±6% |   433 µs ±20% |  435 µs ±14% | **271 µs ±24%** |   669 µs ±17% |
| max        | **1.12 ms ±94%** | 2.88 ms ±45% | 2.68 ms ±144% | 2.64 ms ±61% |    6.33 ms ±65% | 2.15 ms ±135% |

**Node 24: large results and bulk work, time per operation (median)**

| Scenario                                                                    |            quarry |            pg |    pg (named) |     pg-native |   postgres.js |    neon (WS) |
| --------------------------------------------------------------------------- | ----------------: | ------------: | ------------: | ------------: | ------------: | -----------: |
| fetch 100k rows                                                             | **27.48 ms ±15%** |    118 ms ±2% |   118 ms ±10% |    146 ms ±2% |  91.79 ms ±2% |   138 ms ±4% |
| fetch 1M rows (one result)                                                  |    **373 ms ±7%** |   1283 ms ±4% |   1279 ms ±6% |   1547 ms ±4% |   1027 ms ±7% |  1433 ms ±6% |
| wide rows: 1k rows × 100 columns                                            |   **3.21 ms ±3%** |  14.09 ms ±2% |  14.00 ms ±2% |  21.23 ms ±8% |  14.47 ms ±2% | 16.71 ms ±4% |
| large values: 10 × 1 MB text                                                |   **4.70 ms ±5%** |  5.71 ms ±22% |  5.63 ms ±29% |  11.87 ms ±7% |   4.87 ms ±2% |  8.51 ms ±9% |
| large values: 10 × 1 MB bytea                                               |   **3.35 ms ±2%** |  17.57 ms ±8% |  17.28 ms ±4% | 32.45 ms ±17% | 15.46 ms ±10% | 23.93 ms ±4% |
| large values: 20 × 200 KB jsonb                                             |  **23.53 ms ±6%** | 24.54 ms ±10% |  23.91 ms ±6% |  37.88 ms ±4% | 25.55 ms ±16% | 27.28 ms ±3% |
| arrays: 1k rows of int4[100] + text[20]                                     |  **3.24 ms ±<1%** | 23.01 ms ±15% | 22.14 ms ±10% | 26.64 ms ±13% |  8.94 ms ±23% | 24.40 ms ±5% |
| bulk insert 10k rows (unnest arrays)                                        |  **12.56 ms ±2%** |  13.01 ms ±3% |  12.85 ms ±4% |  12.59 ms ±3% |  12.97 ms ±2% | 13.48 ms ±2% |
| bulk insert 10k rows (unnest, JS array parameters)                          |  **12.86 ms ±3%** |  15.39 ms ±5% |  15.34 ms ±1% |  15.72 ms ±3% |  15.57 ms ±4% | 16.67 ms ±3% |
| bulk insert 1k rows (unnest, JS array parameters)                           |   **1.44 ms ±1%** |   1.83 ms ±2% |   1.74 ms ±2% |   1.88 ms ±2% |   1.81 ms ±6% |  1.94 ms ±4% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |  **12.45 ms ±1%** |  12.76 ms ±3% |  12.57 ms ±1% |           n/a |  56.01 ms ±1% |          n/a |
| stream 1M rows with a cursor (1000 per batch)                               |    **300 ms ±2%** |   1241 ms ±2% |   1237 ms ±4% |           n/a |   1047 ms ±3% |          n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |    **549 ms ±1%** |    717 ms ±2% |   708 ms ±<1% |           n/a |    679 ms ±1% |          n/a |

**Node 24: large results and bulk work, time per operation (mean)**

| Scenario                                                                    |            quarry |            pg |       pg (named) |     pg-native |   postgres.js |     neon (WS) |
| --------------------------------------------------------------------------- | ----------------: | ------------: | ---------------: | ------------: | ------------: | ------------: |
| fetch 100k rows                                                             | **27.38 ms ±31%** |    119 ms ±3% |       123 ms ±7% |    147 ms ±3% |  94.32 ms ±5% |    140 ms ±4% |
| fetch 1M rows (one result)                                                  |   **393 ms ±11%** |   1278 ms ±7% |      1278 ms ±5% |   1538 ms ±8% |   1016 ms ±4% |   1443 ms ±9% |
| wide rows: 1k rows × 100 columns                                            |   **3.42 ms ±7%** |  14.16 ms ±2% |     14.11 ms ±2% |  21.35 ms ±9% |  16.96 ms ±4% |  16.80 ms ±4% |
| large values: 10 × 1 MB text                                                |   **5.24 ms ±7%** |  6.08 ms ±20% |     5.90 ms ±29% |  11.97 ms ±6% |   5.69 ms ±4% |   8.85 ms ±7% |
| large values: 10 × 1 MB bytea                                               |   **4.14 ms ±4%** |  18.31 ms ±7% |     17.89 ms ±4% | 32.63 ms ±17% | 15.38 ms ±13% | 23.72 ms ±31% |
| large values: 20 × 200 KB jsonb                                             |  **25.17 ms ±8%** | 26.68 ms ±11% |     25.64 ms ±7% |  38.01 ms ±4% | 28.83 ms ±10% |  28.78 ms ±5% |
| arrays: 1k rows of int4[100] + text[20]                                     |   **3.33 ms ±4%** | 23.65 ms ±16% |     23.15 ms ±7% | 27.01 ms ±12% |  10.01 ms ±9% |  25.39 ms ±7% |
| bulk insert 10k rows (unnest arrays)                                        |  **12.63 ms ±1%** | 13.03 ms ±10% |     13.04 ms ±4% |  12.70 ms ±2% |  12.98 ms ±3% |  13.54 ms ±2% |
| bulk insert 10k rows (unnest, JS array parameters)                          |  **12.95 ms ±4%** |  15.43 ms ±8% |     15.50 ms ±2% |  15.79 ms ±4% |  15.61 ms ±4% |  16.75 ms ±3% |
| bulk insert 1k rows (unnest, JS array parameters)                           |   **1.42 ms ±1%** |   1.86 ms ±2% |      1.76 ms ±2% |   1.90 ms ±5% |   1.84 ms ±5% |   1.96 ms ±4% |
| bulk insert 10k rows (COPY FROM STDIN, text)                                |      12.63 ms ±2% |  12.95 ms ±4% | **12.61 ms ±1%** |           n/a |  56.26 ms ±8% |           n/a |
| stream 1M rows with a cursor (1000 per batch)                               |    **304 ms ±3%** |   1248 ms ±2% |      1250 ms ±1% |           n/a |   1059 ms ±3% |           n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |    **551 ms ±2%** |    718 ms ±2% |      711 ms ±<1% |           n/a |    682 ms ±1% |           n/a |

**Node 24: rows per second (median)**

| Scenario                                           |        quarry |      pg |  pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | ------------: | ------: | ----------: | --------: | ----------: | --------: |
| fetch 1k rows (6 columns)                          | **3,219,218** | 757,440 |     779,282 |   621,431 |     941,255 |   644,080 |
| fetch 100k rows                                    | **3,651,276** | 838,719 |     811,733 |   680,213 |   1,060,091 |   712,615 |
| fetch 1M rows (one result)                         | **2,542,784** | 782,740 |     782,500 |   650,380 |     983,934 |   692,801 |
| wide rows: 1k rows × 100 columns                   |   **292,134** |  70,581 |      70,874 |    46,816 |      58,926 |    59,524 |
| arrays: 1k rows of int4[100] + text[20]            |   **300,357** |  42,279 |      43,192 |    37,020 |      99,862 |    39,371 |
| stream 1M rows with a cursor (1000 per batch)      | **3,293,355** | 800,998 |     800,268 |       n/a |     943,936 |       n/a |
| bulk insert 10k rows (unnest arrays)               |   **791,050** | 767,226 |     766,518 |   787,349 |     770,449 |   738,653 |
| bulk insert 10k rows (unnest, JS array parameters) |   **771,962** | 647,788 |     644,926 |   633,001 |     640,430 |   596,834 |
| bulk insert 1k rows (unnest, JS array parameters)  |   **703,478** | 537,587 |     568,553 |   525,160 |     543,574 |   510,421 |
| bulk insert 10k rows (COPY FROM STDIN, text)       |       791,700 | 771,843 | **792,669** |       n/a |     177,723 |       n/a |

**Node 24: peak RSS (MB) at equal work (the same number of operations for every client, after the same warm-up)**

| Scenario                                          |  quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------- | ------: | ----: | ---------: | --------: | ----------: | --------: |
| fetch 100k rows × 5                               | **274** |   362 |        363 |       394 |         318 |       382 |
| fetch 1M rows (one result) × 3                    | **751** | 1,369 |      1,369 |     1,665 |         815 |     1,399 |
| wide rows: 1k rows × 100 columns × 50             |     139 |   158 |        158 |   **134** |         317 |       233 |
| large values: 10 × 1 MB text × 20                 | **165** |   192 |        191 |       185 |         174 |       213 |
| large values: 10 × 1 MB bytea × 20                | **176** |   197 |        200 |       207 |         184 |       219 |
| large values: 20 × 200 KB jsonb × 10              | **163** |   166 |        167 |       201 |         245 |       218 |
| arrays: 1k rows of int4[100] + text[20] × 50      | **118** |   309 |        305 |       256 |         264 |       307 |
| stream 1M rows with a cursor (1000 per batch) × 3 | **117** |   212 |        211 |       n/a |         245 |       n/a |

**Node 24: peak RSS (MB) within the time window (secondary: faster clients do more operations in the window, so this favours slower ones)**

| Scenario                                                                    |    quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------------------------------------- | --------: | ----: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key                                                 |   **100** |   107 |        106 |       105 |         150 |       104 |
| fetch 100k rows                                                             |   **367** |   437 |        437 |       406 |         402 |       543 |
| fetch 1M rows (one result)                                                  | **1,171** | 1,387 |      1,387 |     1,781 |       1,404 |     1,399 |
| stream 1M rows with a cursor (1000 per batch)                               |   **151** |   212 |        211 |       n/a |         246 |       n/a |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) |   **102** |   121 |        120 |       n/a |         231 |       n/a |
| large values: 10 × 1 MB text                                                |   **176** |   203 |        201 |       205 |         184 |       222 |
| large values: 10 × 1 MB bytea                                               |   **179** |   201 |        201 |       234 |         185 |       223 |
| large values: 20 × 200 KB jsonb                                             |       303 |   317 |        317 |   **202** |         348 |       337 |

**Node 24: backpressure: RSS growth (MB) while the consumer pauses 3 s after the first batch of a 1M-row stream**

| Metric                  |  quarry |  pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------------------- | ------: | --: | ---------: | --------: | ----------: | --------: |
| RSS growth during pause | **0.0** | 0.1 |    **0.0** |       n/a |     **0.0** |       n/a |

**Node 24: per-type decode cost, ns per value (100k rows × 1 column)**

| Type                 |       quarry | quarry (lossless) |        pg | pg (named) |  pg-native | postgres.js |  neon (WS) |
| -------------------- | -----------: | ----------------: | --------: | ---------: | ---------: | ----------: | ---------: |
| int4                 |       76 ±1% |        **76 ±1%** |   188 ±6% |    191 ±4% |    200 ±1% |     251 ±9% |    231 ±4% |
| int8                 |      90 ±11% |       **79 ±15%** |   203 ±8% |    204 ±6% |    217 ±1% |     240 ±6% |   282 ±13% |
| float8               |      81 ±11% |        **80 ±3%** |   203 ±4% |    206 ±4% |    233 ±2% |     298 ±5% |    292 ±8% |
| numeric              |      136 ±1% |       **135 ±1%** |   156 ±2% |    160 ±4% |    237 ±7% |     244 ±8% |    250 ±2% |
| text                 |       96 ±3% |       **95 ±12%** |   160 ±6% |   155 ±11% |    201 ±1% |     232 ±4% |    246 ±6% |
| bool                 |       83 ±1% |       **83 ±<1%** |   142 ±8% |    142 ±4% |    165 ±1% |     211 ±3% |    161 ±3% |
| timestamptz          | **105 ±13%** |           160 ±1% |   653 ±1% |    651 ±2% |   720 ±11% |     479 ±9% |    760 ±7% |
| date                 |      110 ±1% |      **109 ±<1%** |  479 ±23% |   522 ±10% |    483 ±2% |     359 ±1% |   545 ±11% |
| uuid                 | **126 ±15%** |          127 ±14% |   160 ±4% |   160 ±10% |    229 ±1% |     248 ±4% |   189 ±19% |
| jsonb (small object) |  **314 ±3%** |          348 ±13% |   404 ±2% |   404 ±10% |    548 ±2% |    497 ±18% |    522 ±6% |
| int4[5]              |     262 ±14% |       **256 ±1%** | 1,119 ±5% | 1,089 ±14% | 1,229 ±11% |     595 ±3% | 1,673 ±14% |
| bytea (16 B)         |      175 ±9% |       **164 ±3%** |   341 ±4% |    342 ±2% |    351 ±3% |    371 ±12% |    442 ±9% |

**Node 24: writes, operations/s (bulk rows: batches per second)**

| Scenario                                           |           quarry |         pg |   pg (named) |   pg-native | postgres.js |   neon (WS) |
| -------------------------------------------------- | ---------------: | ---------: | -----------: | ----------: | ----------: | ----------: |
| insert one row                                     |   **36,567 ±1%** | 24,627 ±2% |   31,274 ±8% |  21,477 ±1% |  27,975 ±5% | 13,136 ±33% |
| insert one row, concurrency 50                     | **259,496 ±36%** | 87,074 ±3% |  83,678 ±10% |  70,185 ±7% |  40,677 ±3% | 29,941 ±38% |
| multi-row insert: 100 rows, 300 parameters         |    **4,933 ±2%** |  3,114 ±6% |    4,413 ±9% |   3,113 ±1% |   2,827 ±3% |  3,182 ±12% |
| bulk insert 10k rows (unnest arrays)               |     **79.1 ±1%** |   76.7 ±9% |     76.7 ±4% |    78.7 ±2% |    77.0 ±3% |    73.9 ±2% |
| bulk insert 10k rows (unnest, JS array parameters) |     **77.2 ±4%** |   64.8 ±7% |     64.5 ±2% |    63.3 ±4% |    64.0 ±4% |    59.7 ±3% |
| bulk insert 1k rows (unnest, JS array parameters)  |      **703 ±1%** |    538 ±2% |      569 ±2% |     525 ±5% |     544 ±6% |     510 ±4% |
| bulk insert 10k rows (COPY FROM STDIN, text)       |         79.2 ±2% |   77.2 ±4% | **79.3 ±1%** |         n/a |    17.8 ±7% |         n/a |
| update one row by primary key                      |  **31,550 ±35%** | 20,705 ±5% |  26,491 ±20% |  18,747 ±4% | 25,975 ±28% | 11,331 ±31% |
| upsert (insert … on conflict do update)            |  **31,105 ±27%** | 21,765 ±4% |   27,078 ±2% | 19,224 ±11% | 25,508 ±24% | 12,080 ±30% |
| delete one row by primary key                      |   **37,254 ±2%** | 24,931 ±5% |   31,707 ±6% |  22,255 ±1% |  30,403 ±4% |  8,898 ±51% |

**Node 24: transactions, operations/s**

| Scenario                                         |          quarry |          pg | pg (named) |  pg-native | postgres.js |  neon (WS) |
| ------------------------------------------------ | --------------: | ----------: | ---------: | ---------: | ----------: | ---------: |
| transaction: begin; select 1; commit             | **20,745 ±20%** |  14,027 ±2% | 13,792 ±2% | 11,635 ±1% |  11,575 ±4% | 4,468 ±66% |
| transaction: begin; insert; commit               | **17,824 ±14%** | 11,859 ±35% | 13,435 ±3% |  9,681 ±4% |  10,685 ±5% | 6,291 ±38% |
| transaction with 5 savepoints (select 1 in each) |   **5,818 ±2%** |   2,581 ±2% |  2,536 ±1% |  2,113 ±3% |   2,838 ±5% | 1,145 ±30% |

**Node 24: client CPU per operation (µs, all threads)**

| Scenario                                               |     quarry |      pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------------------------ | ---------: | ------: | ---------: | --------: | ----------: | --------: |
| select 1                                               |   **13.4** |    17.0 |       19.9 |      21.3 |        23.9 |      30.1 |
| point lookup by primary key                            |   **14.8** |    26.2 |       25.9 |      26.9 |        25.4 |      51.2 |
| fetch 1k rows (6 columns)                              |    **289** |   1,193 |      1,207 |     1,263 |       1,137 |     1,362 |
| fetch 100k rows                                        | **33,705** | 142,667 |    149,731 |   161,661 |     118,094 |   181,734 |
| insert one row                                         |   **14.3** |    19.0 |       19.3 |      24.2 |        25.6 |      44.1 |
| insert one row, concurrency 50                         |    **4.1** |    12.2 |       12.8 |      15.4 |        29.0 |      33.4 |
| transaction: begin; insert; commit                     |   **35.6** |    48.8 |       48.6 |      64.6 |        77.1 |      84.7 |
| query that fails (division by zero), connection reused |   **26.5** |     512 |        538 |     1,275 |        53.7 |     1,047 |

**Node 24: server CPU per operation (µs, all PostgreSQL processes)**

| Scenario                             |   quarry |   pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ------------------------------------ | -------: | ---: | ---------: | --------: | ----------: | --------: |
| select 1                             |  **9.4** | 11.5 |       10.0 |      14.7 |        11.8 |      12.9 |
| point lookup by primary key          | **13.6** | 26.7 |       14.3 |      30.0 |        14.4 |      36.2 |
| fetch 1k rows (6 columns)            |  **237** |  409 |        371 |       472 |         379 |       444 |
| 100 parameters (id in (…)), 100 rows |  **177** |  236 |        179 |       239 |         183 |       246 |
| insert one row                       | **13.9** | 23.7 |       14.4 |      27.0 |        15.0 |      34.8 |
| insert one row, concurrency 50       | **10.8** | 34.0 |       17.8 |      41.3 |        18.0 |      46.3 |
| transaction: begin; insert; commit   | **26.4** | 42.2 |       31.2 |      51.5 |        30.9 |      49.8 |

**Node 24: GC time (ms per second of run) / longest GC pause**

| Scenario                                       |   quarry |    pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ---------------------------------------------- | -------: | ----: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: GC ms/s           |     10.8 |  15.8 |       20.8 |   **9.8** |        24.2 |      16.3 |
| point lookup by primary key: max pause ms      |      0.7 |   0.5 |        0.5 |   **0.4** |         5.1 |       0.5 |
| insert one row, concurrency 50: GC ms/s        |     30.3 |  26.6 |       26.0 |  **19.0** |        23.9 |      20.5 |
| insert one row, concurrency 50: max pause ms   |      1.4 |   1.3 |    **1.2** |       1.5 |         6.7 |       1.8 |
| fetch 1k rows (6 columns): GC ms/s             |     24.9 |  28.2 |       28.5 |  **16.4** |        85.1 |      31.2 |
| fetch 1k rows (6 columns): max pause ms        |      1.3 |   0.6 |        0.6 |   **0.4** |         7.4 |       0.7 |
| fetch 100k rows: GC ms/s                       |    119.1 | 101.7 |      108.6 |  **74.6** |       133.1 |     138.3 |
| fetch 100k rows: max pause ms                  | **10.1** |  12.8 |       12.5 |      11.4 |        13.4 |      11.3 |
| fetch 1M rows (one result): GC ms/s            |    221.6 | 144.9 |      147.6 |  **89.9** |       177.9 |     149.5 |
| fetch 1M rows (one result): max pause ms       |     27.0 |  23.7 |       23.3 |  **17.7** |        22.0 |      18.1 |
| wide rows: 1k rows × 100 columns: GC ms/s      |     27.7 |   5.9 |        6.1 |   **4.1** |       130.8 |       5.4 |
| wide rows: 1k rows × 100 columns: max pause ms |      2.8 |   0.5 |        0.5 |       0.5 |         7.9 |   **0.4** |
| large values: 20 × 200 KB jsonb: GC ms/s       |     30.6 |  30.0 |       29.5 |   **7.7** |        30.8 |      39.9 |
| large values: 20 × 200 KB jsonb: max pause ms  |      6.6 |   7.3 |        6.6 |   **1.4** |         4.7 |       5.1 |

**Node 24: event-loop lag p99 / max (ms) while the scenario runs**

| Scenario                                           |   quarry |   pg | pg (named) | pg-native | postgres.js | neon (WS) |
| -------------------------------------------------- | -------: | ---: | ---------: | --------: | ----------: | --------: |
| point lookup by primary key: p99                   |  **0.2** |  0.3 |        0.2 |       0.4 |         2.1 |       0.3 |
| point lookup by primary key: max                   |  **0.3** |  1.0 |        0.4 |       1.8 |         2.7 |       0.4 |
| insert one row, concurrency 50: p99                |      0.5 |  0.4 |        0.4 |       0.3 |         3.0 |   **0.2** |
| insert one row, concurrency 50: max                |      0.6 |  0.6 |    **0.5** |       0.7 |         3.0 |       0.9 |
| fetch 1k rows (6 columns): p99                     |  **0.2** |  0.7 |        0.6 |       1.0 |         4.8 |       1.4 |
| fetch 1k rows (6 columns): max                     |  **0.3** |  0.8 |        0.8 |       1.0 |         4.8 |       1.4 |
| fetch 100k rows: p99                               | **12.7** | 34.0 |       33.8 |     119.1 |        18.8 |      35.8 |
| fetch 100k rows: max                               | **13.9** | 34.0 |       33.8 |     119.1 |        21.8 |      35.8 |
| fetch 1M rows (one result): p99                    | **27.9** | 39.9 |       41.7 |   1,227.2 |        30.8 |      62.0 |
| fetch 1M rows (one result): max                    | **30.0** | 63.1 |       64.0 |   1,229.2 |        35.7 |      76.4 |
| stream 1M rows with a cursor (1000 per batch): p99 |  **0.3** |  0.7 |        0.6 |       n/a |         6.6 |       n/a |
| stream 1M rows with a cursor (1000 per batch): max |  **0.4** |  1.2 |        1.3 |       n/a |         8.2 |       n/a |

**Node 24: connections (median time per operation)**

| Scenario                                                    |          quarry |           pg |  pg (named) |    pg-native |  postgres.js |       neon (WS) |
| ----------------------------------------------------------- | --------------: | -----------: | ----------: | -----------: | -----------: | --------------: |
| connect + select 1 + close (no TLS, trust)                  | **2.26 ms ±1%** |  3.97 ms ±4% | 3.97 ms ±3% |  4.70 ms ±8% |  6.67 ms ±1% |    4.14 ms ±14% |
| connect + select 1 + close (no TLS, SCRAM-SHA-256)          | **2.58 ms ±6%** | 5.21 ms ±13% | 5.34 ms ±7% |  7.35 ms ±1% |  7.82 ms ±1% |    67.90 ms ±2% |
| connect + select 1 + close (TLS verify-full, trust)         |     4.87 ms ±4% |  5.04 ms ±7% | 4.99 ms ±3% |  4.82 ms ±3% | 52.27 ms ±2% | **4.23 ms ±4%** |
| connect + select 1 + close (TLS verify-full, SCRAM-SHA-256) | **5.25 ms ±8%** |  6.62 ms ±3% | 6.77 ms ±3% |  7.43 ms ±7% | 53.02 ms ±4% |    67.08 ms ±2% |
| pool warm-up: new pool (max 10), 10 concurrent select 1     | **7.63 ms ±3%** | 8.41 ms ±22% | 8.37 ms ±4% | 13.00 ms ±8% | 14.46 ms ±4% |    8.18 ms ±25% |

**Node 24: cancellation, notifications, errors**

| Scenario                                      |        quarry |          pg | pg (named) | pg-native | postgres.js | neon (WS) |
| --------------------------------------------- | ------------: | ----------: | ---------: | --------: | ----------: | --------: |
| cancel: time from cancel() to rejection (p50) |       1.43 ms | **1.42 ms** |    1.48 ms |   2.14 ms |     1.45 ms |       n/a |
| cancel: share of queries actually cancelled   |      **100%** |    **100%** |   **100%** |  **100%** |    **100%** |       n/a |
| NOTIFY latency p50                            |   **30.4 µs** |     41.3 µs |    36.9 µs |   46.9 µs |     35.8 µs |    119 µs |
| NOTIFY latency p99                            |   **56.1 µs** |     82.8 µs |    80.7 µs |   79.8 µs |     70.9 µs |    319 µs |
| NOTIFY throughput (notifications/s)           | **2,506,360** |   2,073,165 |  2,097,074 |   835,842 |   1,686,186 | 1,698,099 |
| error path: failing queries/s                 |    **27,933** |         441 |        426 |       210 |      17,076 |       366 |

**Node 24: prepared vs unprepared, operations/s (prepared / unprepared / gain)**

| Scenario                                |                 quarry |                     pg |              pg-native |             postgres.js |
| --------------------------------------- | ---------------------: | ---------------------: | ---------------------: | ----------------------: |
| select 1                                | 45,145 / 35,139 / +28% |  35,916 / 36,417 / -1% |  30,724 / 30,652 / +0% |   32,204 / 33,217 / -3% |
| point lookup by primary key             | 36,142 / 21,865 / +65% | 26,161 / 20,210 / +29% | 24,428 / 19,200 / +27% | 28,561 / 13,576 / +110% |
| range scan, 100 rows                    |  10,673 / 6,665 / +60% |    5,062 / 4,986 / +2% |    4,982 / 4,901 / +2% |    5,767 / 4,661 / +24% |
| fetch 1k rows (6 columns)               |  3,219 / 1,401 / +130% |        779 / 757 / +3% |        636 / 621 / +2% |         941 / 904 / +4% |
| 100 parameters (id in (…)), 100 rows    |   4,443 / 3,247 / +37% |   3,807 / 2,972 / +28% |   3,834 / 3,052 / +26% |    3,543 / 2,582 / +37% |
| 1000 parameters (id in (…)), 1000 rows  |       516 / 415 / +24% |       486 / 391 / +24% |       443 / 371 / +20% |        449 / 364 / +23% |
| insert one row                          | 36,567 / 25,434 / +44% | 31,274 / 24,627 / +27% | 26,286 / 21,477 / +22% |  27,975 / 14,550 / +92% |
| upsert (insert … on conflict do update) | 31,105 / 22,186 / +40% | 27,078 / 21,765 / +24% | 23,270 / 19,224 / +21% |  25,508 / 13,960 / +83% |

**Node 24: quarry decoding modes (time per op)**

| Scenario                                |            quarry | quarry (lossless) |
| --------------------------------------- | ----------------: | ----------------: |
| point lookup by primary key             |   **26.4 µs ±1%** |       26.4 µs ±1% |
| fetch 1k rows (6 columns)               |   **293 µs ±14%** |       338 µs ±<1% |
| fetch 100k rows                         | **27.48 ms ±15%** |     29.96 ms ±14% |
| fetch 1M rows (one result)              |        373 ms ±7% |    **332 ms ±9%** |
| wide rows: 1k rows × 100 columns        |   **3.21 ms ±3%** |       3.31 ms ±3% |
| arrays: 1k rows of int4[100] + text[20] |      3.24 ms ±<1% |  **3.24 ms ±21%** |
| decode 100k × int8                      |      9.05 ms ±11% |  **7.88 ms ±15%** |
| decode 100k × timestamptz               | **10.53 ms ±13%** |      16.02 ms ±1% |
| decode 100k × date                      |      10.98 ms ±1% | **10.94 ms ±<1%** |

**Node 24: quarry streams, strict backpressure vs `readAhead: true`**

| Scenario                                                                          |       quarry | quarry (readAhead) |
| --------------------------------------------------------------------------------- | -----------: | -----------------: |
| stream 1M rows with a cursor (1000 per batch) (p50)                               |   300 ms ±2% |     **295 ms ±2%** |
| backpressure: stream 200k rows to a slow consumer (2 ms per 1000-row batch) (p50) |   549 ms ±1% |     **432 ms ±1%** |
| stream 1M rows with a cursor (1000 per batch) × 3: peak RSS (MB) at equal work    | **117 ±<1%** |           117 ±<1% |

**Node 24: shipped defaults vs tuned (median latency)**

| Scenario                                   |   neon (WS) | neon (WS, defaults) |
| ------------------------------------------ | ----------: | ------------------: |
| select 1                                   | **46.7 µs** |             1.56 ms |
| point lookup by primary key                | **79.3 µs** |             1.67 ms |
| fetch 1k rows (6 columns)                  | **1.51 ms** |             3.00 ms |
| insert one row                             | **70.1 µs** |             1.63 ms |
| transaction: begin; insert; commit         |  **150 µs** |             4.57 ms |
| connect + select 1 + close (no TLS, trust) |     4.14 ms |                   — |

## Concurrency sweep (Node 24): point lookups/s

**Node 24: pool size 1, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |      postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | ---------------: | ----------: |
| 1           |   **36,702 ±1%** |              36,214 ±21% | 20,447 ±25% |  27,131 ±2% | 19,329 ±22% |      28,106 ±28% |  12,324 ±2% |
| 10          |      117,613 ±4% |              36,715 ±24% |  21,282 ±1% | 28,538 ±33% |  20,127 ±2% | **118,448 ±15%** | 12,673 ±17% |
| 50          |      92,647 ±34% |              36,877 ±10% | 21,214 ±15% | 28,518 ±30% |  19,815 ±2% | **124,727 ±21%** | 12,581 ±20% |
| 100         | **125,285 ±31%** |              36,549 ±34% | 20,453 ±23% | 27,706 ±28% |  19,737 ±1% |     124,022 ±21% | 12,714 ±31% |
| 500         |  **124,420 ±2%** |               36,933 ±3% | 16,463 ±33% |  28,213 ±3% |  19,707 ±4% |     104,019 ±14% | 11,937 ±27% |
| 1000        |  **124,461 ±1%** |               36,468 ±4% | 21,255 ±11% |  28,893 ±3% |  19,835 ±3% |     114,900 ±27% |  12,629 ±6% |

**Node 24: pool size 1, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **33.3 µs** |                  34.6 µs |  72.4 µs |    55.1 µs |   66.6 µs |     56.6 µs |    139 µs |
| 10          |  **123 µs** |                   542 µs |   939 µs |     796 µs |    890 µs |      142 µs |   1.43 ms |
| 50          |     1.09 ms |                  2.17 ms |  3.78 ms |    2.54 ms |   3.33 ms |  **824 µs** |   6.96 ms |
| 100         | **1.54 ms** |                  3.71 ms |  7.31 ms |    6.06 ms |   6.40 ms |     3.33 ms |  11.46 ms |
| 500         | **5.16 ms** |                 16.05 ms | 39.26 ms |   23.06 ms |  31.09 ms |    11.18 ms |  51.61 ms |
| 1000        | **9.61 ms** |                 34.07 ms | 53.65 ms |   39.88 ms |  55.11 ms |    16.44 ms |  95.66 ms |

**Node 24: pool size 5, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native |  postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | -----------: | ----------: |
| 1           |  **36,795 ±26%** |               36,694 ±1% | 20,502 ±23% | 27,131 ±23% |  19,286 ±1% |  28,941 ±18% | 11,600 ±28% |
| 10          | **193,162 ±10%** |             108,168 ±21% | 62,837 ±10% |  59,232 ±7% |  56,771 ±8% |   43,269 ±3% |  29,376 ±8% |
| 50          | **347,028 ±10%** |             105,710 ±17% |  61,882 ±9% |  58,859 ±8% |  54,961 ±7% |   41,972 ±2% | 28,854 ±34% |
| 100         |  **401,510 ±5%** |              94,906 ±23% |  61,170 ±9% |  57,632 ±7% | 51,812 ±12% |   43,148 ±3% | 27,159 ±27% |
| 500         | **437,853 ±10%** |              98,035 ±12% |  62,507 ±7% |  58,098 ±9% |  55,425 ±4% | 155,921 ±21% | 26,913 ±26% |
| 1000        |  **376,415 ±7%** |              95,214 ±12% |  62,865 ±6% |  57,432 ±5% |  55,700 ±6% |  155,764 ±3% | 29,386 ±11% |

**Node 24: pool size 5, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **34.1 µs** |                  34.1 µs |  71.2 µs |    56.3 µs |   66.6 µs |     47.2 µs |    180 µs |
| 10          | **96.1 µs** |                   185 µs |   577 µs |     508 µs |    470 µs |      433 µs |    870 µs |
| 50          |  **377 µs** |                  1.25 ms |  1.57 ms |    1.59 ms |   1.53 ms |     2.45 ms |   2.93 ms |
| 100         | **1.02 ms** |                  2.09 ms |  2.59 ms |    2.64 ms |   2.86 ms |     5.21 ms |   5.48 ms |
| 500         | **5.05 ms** |                  6.98 ms | 10.74 ms |   11.92 ms |  11.58 ms |     7.95 ms |  23.94 ms |
| 1000        | **5.63 ms** |                 15.20 ms | 23.25 ms |   25.41 ms |  21.72 ms |    11.65 ms |  40.44 ms |

**Node 24: pool size 10, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| 1           |      36,601 ±33% |           **36,715 ±7%** | 20,506 ±15% | 25,131 ±26% | 18,729 ±21% | 28,960 ±29% | 12,259 ±33% |
| 10          | **174,089 ±14%** |              103,467 ±6% | 62,142 ±11% |  59,719 ±4% |  58,775 ±9% | 66,420 ±14% |  29,348 ±8% |
| 50          |  **313,225 ±5%** |              106,921 ±9% | 63,179 ±11% |  55,516 ±5% |  53,175 ±9% |  41,798 ±2% | 25,524 ±74% |
| 100         |  **426,611 ±8%** |              95,231 ±16% |  60,776 ±8% |  59,097 ±6% |  56,957 ±5% |  42,858 ±2% | 27,465 ±10% |
| 500         | **472,987 ±10%** |              87,386 ±10% | 62,398 ±11% |  58,900 ±9% |  52,767 ±8% | 133,266 ±5% | 27,256 ±18% |
| 1000        |  **404,250 ±6%** |              90,459 ±17% |  62,110 ±9% |  60,166 ±4% |  56,642 ±9% | 154,099 ±1% | 29,803 ±28% |

**Node 24: pool size 10, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           | **34.4 µs** |                  34.6 µs |  70.1 µs |    62.9 µs |   70.3 µs |     48.2 µs |    161 µs |
| 10          |  **105 µs** |                   207 µs |   449 µs |     488 µs |    405 µs |      270 µs |    928 µs |
| 50          |  **446 µs** |                  1.20 ms |  1.54 ms |    1.62 ms |   1.57 ms |     2.53 ms |   3.15 ms |
| 100         | **1.22 ms** |                  1.98 ms |  2.64 ms |    2.77 ms |   2.62 ms |     5.16 ms |   5.34 ms |
| 500         | **4.95 ms** |                  7.63 ms | 11.41 ms |   11.81 ms |  11.86 ms |    10.85 ms |  22.63 ms |
| 1000        | **6.11 ms** |                 15.60 ms | 22.83 ms |   24.57 ms |  23.36 ms |    13.55 ms |  54.51 ms |

**Node 24: pool size 50, point lookups/s by concurrency**

| Concurrency |           quarry | quarry (pipeline: false) |          pg |  pg (named) |   pg-native | postgres.js |   neon (WS) |
| ----------- | ---------------: | -----------------------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| 1           |  **37,109 ±31%** |               36,877 ±1% |  20,419 ±3% | 26,495 ±27% | 16,727 ±16% | 28,622 ±29% | 12,079 ±33% |
| 10          | **190,448 ±18%** |             102,909 ±23% | 62,699 ±17% |  59,005 ±7% |  56,021 ±4% |  69,135 ±9% |  32,121 ±9% |
| 50          | **310,106 ±11%** |             104,113 ±10% | 56,593 ±16% | 58,562 ±12% |  53,419 ±9% | 59,787 ±11% |  31,844 ±8% |
| 100         |  **326,772 ±8%** |              90,958 ±16% | 59,910 ±11% |  56,824 ±9% | 55,064 ±10% |  41,799 ±2% | 30,819 ±29% |
| 500         | **360,339 ±10%** |              91,779 ±10% |  60,408 ±2% | 56,525 ±11% |  53,315 ±8% |  43,592 ±3% | 27,284 ±24% |
| 1000        | **379,237 ±16%** |              91,956 ±10% |  60,124 ±9% |  59,561 ±3% |  53,552 ±4% |  43,962 ±2% |  27,913 ±9% |

**Node 24: pool size 50, p99 latency by concurrency**

| Concurrency |      quarry | quarry (pipeline: false) |       pg | pg (named) | pg-native | postgres.js | neon (WS) |
| ----------- | ----------: | -----------------------: | -------: | ---------: | --------: | ----------: | --------: |
| 1           |     34.1 µs |              **34.0 µs** |  69.8 µs |    59.2 µs |   81.2 µs |     53.5 µs |    159 µs |
| 10          |  **108 µs** |                   206 µs |   501 µs |     475 µs |    408 µs |      261 µs |    941 µs |
| 50          |  **497 µs** |                  1.14 ms |  1.82 ms |    1.72 ms |   1.56 ms |     1.87 ms |   3.40 ms |
| 100         | **1.19 ms** |                  2.19 ms |  2.93 ms |    2.92 ms |   2.92 ms |     5.87 ms |   5.57 ms |
| 500         | **2.99 ms** |                  7.70 ms | 11.38 ms |   13.41 ms |  12.35 ms |    23.70 ms |  22.79 ms |
| 1000        | **5.61 ms** |                 16.78 ms | 24.49 ms |   24.13 ms |  23.60 ms |    46.66 ms |  41.14 ms |

## Pipelining depth

**quarry, one connection, 100 concurrent point lookups: throughput by `pipeline` depth (columns: RTT ms)**

| pipeline           |               0 |          5 |
| ------------------ | --------------: | ---------: |
| 1                  |  **21,965 ±2%** |    172 ±2% |
| 2                  |  **42,261 ±1%** |    343 ±2% |
| 4                  |  **75,023 ±4%** |    683 ±1% |
| 8                  | **114,630 ±2%** |  1,343 ±2% |
| 16                 | **117,955 ±6%** |  2,658 ±1% |
| 32                 | **117,407 ±6%** |  5,199 ±2% |
| 64                 | **119,873 ±4%** | 9,938 ±<1% |
| 100                | **122,333 ±1%** | 15,767 ±6% |
| adaptive (default) | **121,888 ±3%** | 16,110 ±4% |

## db.batch

**quarry's query builder, 3 statements per operation: operations/s (columns: RTT ms)**

| Scenario                                                                  |               0 |        5 |
| ------------------------------------------------------------------------- | --------------: | -------: |
| 3 statements (lookup, insert, update): one after another                  |  **4,945 ±29%** | 56.2 ±1% |
| 3 statements (lookup, insert, update): Promise.all                        | **12,499 ±10%** | 168 ±<1% |
| 3 statements (lookup, insert, update): db.batch                           | **12,210 ±17%** |  167 ±1% |
| 3 statements (lookup, insert, update) in a transaction: one after another |   **4,532 ±7%** | 42.4 ±1% |
| 3 statements (lookup, insert, update) in a transaction: Promise.all       |   **5,794 ±5%** | 56.4 ±1% |
| 3 statements (lookup, insert, update) in a transaction: db.batch          | **11,020 ±12%** |  167 ±1% |

## Query builder under concurrency

**Node, pool 10, 0 ms RTT: operations/s (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              |   quarry builder |           quarry |          pg |  postgres.js |
| ------------------------------- | ---------------: | ---------------: | ----------: | -----------: |
| lookup, 1                       |      19,392 ±12% |  **21,214 ±24%** |  14,088 ±4% |  17,789 ±35% |
| lookup, 100                     |      237,341 ±7% | **376,519 ±15%** | 64,486 ±23% |   42,428 ±2% |
| lookup, 500                     |      320,474 ±4% | **433,308 ±11%** | 65,532 ±21% |  139,621 ±4% |
| lookup, 1000                    |      326,126 ±2% | **413,949 ±10%** | 64,719 ±26% |  152,549 ±7% |
| lookup, statement timeout, 1    |       17,470 ±3% |                — |           — |            — |
| lookup, statement timeout, 100  |      175,136 ±8% |                — |           — |            — |
| lookup, statement timeout, 500  |      174,754 ±8% |                — |           — |            — |
| lookup, statement timeout, 1000 |     144,960 ±22% |                — |           — |            — |
| insert, 1                       |       20,322 ±9% |  **21,508 ±39%** | 16,230 ±33% |  17,583 ±34% |
| insert, 100                     |     206,085 ±21% | **209,572 ±23%** | 75,381 ±22% |   41,997 ±2% |
| insert, 500                     | **258,055 ±32%** |     201,609 ±10% | 73,684 ±38% | 118,459 ±15% |
| insert, 1000                    | **230,846 ±12%** |      208,316 ±3% | 79,600 ±42% |  142,947 ±2% |
| update, 1                       |       17,953 ±2% |  **19,401 ±38%** | 14,964 ±31% |  16,460 ±17% |
| update, 100                     |     214,881 ±24% | **250,758 ±33%** | 48,519 ±62% |  42,691 ±15% |
| update, 500                     |     228,126 ±27% | **257,259 ±27%** | 76,690 ±39% | 135,917 ±20% |
| update, 1000                    | **244,377 ±25%** |     233,236 ±28% | 69,748 ±14% |  171,825 ±9% |

**Node, pool 10, 0 ms RTT: p99 latency (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              |    quarry builder |            quarry |            pg |      postgres.js |
| ------------------------------- | ----------------: | ----------------: | ------------: | ---------------: |
| lookup, 1                       |       85.1 µs ±7% |  **67.5 µs ±17%** |   106 µs ±11% |     77.8 µs ±54% |
| lookup, 100                     |       1.55 ms ±8% |  **1.13 ms ±20%** |  3.06 ms ±13% |     5.28 ms ±10% |
| lookup, 500                     |   **4.51 ms ±7%** |       5.39 ms ±7% | 13.81 ms ±14% |     10.67 ms ±8% |
| lookup, 1000                    |      7.65 ms ±17% |  **6.99 ms ±37%** | 24.01 ms ±10% |    13.32 ms ±21% |
| lookup, statement timeout, 1    |      93.1 µs ±23% |                 — |             — |                — |
| lookup, statement timeout, 100  |       1.79 ms ±3% |                 — |             — |                — |
| lookup, statement timeout, 500  |      6.63 ms ±15% |                 — |             — |                — |
| lookup, statement timeout, 1000 |     14.96 ms ±48% |                 — |             — |                — |
| insert, 1                       |      80.8 µs ±19% |  **72.9 µs ±36%** |   106 µs ±18% |     84.9 µs ±30% |
| insert, 100                     | **1.59 ms ±142%** |      3.41 ms ±68% |  2.90 ms ±30% |      5.39 ms ±5% |
| insert, 500                     | **5.52 ms ±105%** |     13.20 ms ±19% | 12.46 ms ±30% |    12.91 ms ±17% |
| insert, 1000                    |     14.83 ms ±29% |     20.46 ms ±10% | 19.01 ms ±75% | **13.06 ms ±4%** |
| update, 1                       |       86.2 µs ±6% |  **70.8 µs ±95%** |  97.2 µs ±25% |     83.6 µs ±13% |
| update, 100                     |  **2.32 ms ±66%** |      2.32 ms ±68% |  3.21 ms ±31% |     5.48 ms ±31% |
| update, 500                     |      6.80 ms ±27% |  **6.61 ms ±13%** | 10.59 ms ±22% |    11.61 ms ±28% |
| update, 1000                    |     11.75 ms ±15% | **11.63 ms ±15%** | 17.63 ms ±32% |    12.25 ms ±29% |

**Node, pool 10, 5 ms RTT: operations/s (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              |   quarry builder |          quarry |         pg | postgres.js |
| ------------------------------- | ---------------: | --------------: | ---------: | ----------: |
| lookup, 1                       |         169 ±<1% |     **171 ±1%** |   167 ±<1% |     170 ±1% |
| lookup, 100                     |       16,153 ±1% |  **16,345 ±2%** |  1,659 ±1% |  13,796 ±3% |
| lookup, 500                     |       75,416 ±2% |  **75,778 ±3%** |  1,647 ±1% |  38,577 ±4% |
| lookup, 1000                    |  **155,490 ±2%** |     154,267 ±7% |  1,649 ±1% | 75,037 ±<1% |
| lookup, statement timeout, 1    |          168 ±3% |               — |          — |           — |
| lookup, statement timeout, 100  |       15,932 ±1% |               — |          — |           — |
| lookup, statement timeout, 500  |       79,211 ±3% |               — |          — |           — |
| lookup, statement timeout, 1000 |     141,747 ±14% |               — |          — |           — |
| insert, 1                       |         170 ±<1% |         170 ±1% |    169 ±2% | **170 ±1%** |
| insert, 100                     |       16,121 ±1% |  **16,345 ±1%** | 1,649 ±<1% |  13,941 ±4% |
| insert, 500                     |       81,061 ±1% |  **81,892 ±2%** |  1,663 ±1% |  38,161 ±5% |
| insert, 1000                    |      161,391 ±3% | **165,570 ±2%** |  1,658 ±1% |  74,900 ±2% |
| update, 1                       |          169 ±1% |     **171 ±1%** |    168 ±1% |     169 ±1% |
| update, 100                     |       16,032 ±2% |  **16,064 ±1%** |  1,653 ±1% | 12,599 ±13% |
| update, 500                     |  **81,635 ±25%** |     81,038 ±10% | 1,659 ±<1% |  39,423 ±3% |
| update, 1000                    | **167,179 ±12%** |    163,502 ±13% |  1,655 ±2% |  72,808 ±1% |

**Node, pool 10, 5 ms RTT: p99 latency (`quarry-db` is the builder; the others run the same SQL through the driver)**

| Statement, callers              |   quarry builder |           quarry |            pg |   postgres.js |
| ------------------------------- | ---------------: | ---------------: | ------------: | ------------: |
| lookup, 1                       | **6.19 ms ±<1%** |      6.27 ms ±3% |   6.36 ms ±4% |   6.24 ms ±9% |
| lookup, 100                     |      6.97 ms ±3% |  **6.72 ms ±1%** | 61.91 ms ±17% |  12.45 ms ±3% |
| lookup, 500                     |      8.33 ms ±4% | **7.95 ms ±32%** |    307 ms ±2% |  25.46 ms ±3% |
| lookup, 1000                    |      9.31 ms ±6% | **9.05 ms ±10%** |    610 ms ±1% |  20.72 ms ±2% |
| lookup, statement timeout, 1    |      6.40 ms ±6% |                — |             — |             — |
| lookup, statement timeout, 100  |      7.07 ms ±8% |                — |             — |             — |
| lookup, statement timeout, 500  |     8.62 ms ±22% |                — |             — |             — |
| lookup, statement timeout, 1000 |    13.41 ms ±24% |                — |             — |             — |
| insert, 1                       |  **6.17 ms ±3%** |      6.21 ms ±1% |   6.26 ms ±4% |   6.21 ms ±1% |
| insert, 100                     |      7.06 ms ±5% |  **6.92 ms ±2%** | 64.22 ms ±41% |  12.35 ms ±5% |
| insert, 500                     |     8.22 ms ±14% | **8.11 ms ±33%** |    305 ms ±1% | 26.16 ms ±10% |
| insert, 1000                    |     9.96 ms ±14% |  **8.73 ms ±6%** |    607 ms ±4% |  19.55 ms ±4% |
| update, 1                       |      6.19 ms ±2% |  **6.17 ms ±3%** |   6.21 ms ±2% |  6.25 ms ±10% |
| update, 100                     |     7.06 ms ±12% |  **6.95 ms ±7%** | 63.25 ms ±14% |  12.92 ms ±2% |
| update, 500                     |     7.97 ms ±18% | **7.91 ms ±21%** |    308 ms ±2% | 25.21 ms ±27% |
| update, 1000                    |     9.44 ms ±11% | **8.82 ms ±36%** |    617 ms ±6% |  21.47 ms ±2% |

## Network latency (RTT through Toxiproxy)

**Node 24: select 1, sequential: median latency by RTT**

| RTT   |            quarry |            pg |    pg (named) |     pg-native |   postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | ------------: | ------------: | ------------: | ------------: |
| 0 ms  |   **40.5 µs ±1%** |  44.3 µs ±35% |  44.5 µs ±35% |  51.2 µs ±25% |   47.6 µs ±2% |  63.0 µs ±33% |
| 1 ms  |   **1.38 ms ±2%** |   1.41 ms ±3% |   1.41 ms ±2% |   1.45 ms ±7% |   1.41 ms ±7% |   1.47 ms ±4% |
| 5 ms  |   **5.80 ms ±1%** |  5.88 ms ±<1% |   5.87 ms ±1% |   5.87 ms ±1% |   5.87 ms ±1% |  5.97 ms ±<1% |
| 20 ms | **20.83 ms ±<1%** | 20.88 ms ±<1% | 20.87 ms ±<1% | 20.86 ms ±<1% | 20.87 ms ±<1% | 20.99 ms ±<1% |

**Node 24: point lookup, sequential: median latency by RTT**

| RTT   |            quarry |            pg |      pg (named) |     pg-native |   postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | --------------: | ------------: | ------------: | ------------: |
| 0 ms  |  **44.7 µs ±37%** |   65.4 µs ±2% |     55.3 µs ±6% |   69.0 µs ±1% |   53.8 µs ±2% |   107 µs ±12% |
| 1 ms  |       1.47 ms ±5% |   1.54 ms ±5% | **1.45 ms ±6%** |   1.55 ms ±5% |   1.47 ms ±1% |   1.65 ms ±2% |
| 5 ms  |   **5.85 ms ±1%** |  5.96 ms ±<1% |     5.89 ms ±1% |   5.97 ms ±1% |   5.89 ms ±1% |   6.03 ms ±1% |
| 20 ms | **20.88 ms ±<1%** | 21.02 ms ±<1% |   20.95 ms ±<1% | 21.00 ms ±<1% | 20.93 ms ±<1% | 21.12 ms ±<1% |

**Node 24: point lookup, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |         pg | pg (named) |  pg-native | postgres.js |  neon (WS) |
| ----- | ---------------: | ---------: | ---------: | ---------: | ----------: | ---------: |
| 0 ms  | **241,582 ±14%** | 68,387 ±8% | 64,270 ±2% | 61,044 ±5% |  41,651 ±4% | 22,618 ±3% |
| 1 ms  |   **29,593 ±4%** |  5,839 ±2% |  6,036 ±2% |  5,793 ±3% |  18,526 ±2% |  5,084 ±2% |
| 5 ms  |    **8,318 ±1%** | 1,654 ±<1% |  1,678 ±1% |  1,651 ±1% |   6,848 ±8% |  1,579 ±1% |
| 20 ms |    **2,367 ±1%** |   475 ±<1% |   476 ±<1% |    473 ±1% |  1,891 ±15% |   468 ±<1% |

**Node 24: point lookup, 100 concurrent, pool 1 (pipelining): operations/s by RTT**

| RTT   |           quarry |         pg | pg (named) |  pg-native |  postgres.js | neon (WS) |
| ----- | ---------------: | ---------: | ---------: | ---------: | -----------: | --------: |
| 0 ms  | **121,943 ±32%** | 14,566 ±4% | 17,496 ±2% | 14,035 ±1% | 110,587 ±11% | 8,851 ±5% |
| 1 ms  | **40,703 ±105%** |    651 ±3% |    684 ±1% |    657 ±2% |   31,250 ±2% |   634 ±2% |
| 5 ms  |   **16,153 ±5%** |   169 ±<1% |    170 ±1% |    169 ±1% |  11,302 ±11% |   166 ±1% |
| 20 ms |    **4,757 ±2%** |  47.8 ±<1% |  47.8 ±<1% |  47.7 ±<1% |   3,145 ±25% | 47.5 ±<1% |

**Node 24: point lookup, 500 concurrent, pool 1 (deep pipelining): operations/s by RTT**

| RTT   |          quarry |          pg |  pg (named) |  pg-native | postgres.js | neon (WS) |
| ----- | --------------: | ----------: | ----------: | ---------: | ----------: | --------: |
| 0 ms  | **121,512 ±2%** | 14,687 ±22% | 17,565 ±22% | 13,929 ±8% | 100,391 ±3% | 8,768 ±6% |
| 1 ms  | **124,536 ±2%** |     653 ±3% |     686 ±3% |    639 ±6% |  24,937 ±8% |   635 ±3% |
| 5 ms  |  **88,515 ±3%** |     169 ±3% |     171 ±1% |   169 ±<1% |  8,002 ±<1% |  167 ±<1% |
| 20 ms |  **23,295 ±1%** |   47.8 ±<1% |   47.9 ±<1% |  47.8 ±<1% |  2,343 ±<1% | 47.6 ±<1% |

**Node 24: fetch 1k rows, sequential: median latency by RTT**

| RTT   |            quarry |            pg |    pg (named) |     pg-native |   postgres.js |     neon (WS) |
| ----- | ----------------: | ------------: | ------------: | ------------: | ------------: | ------------: |
| 0 ms  |    **314 µs ±2%** |   1.38 ms ±3% |   1.33 ms ±5% |   1.64 ms ±3% |   963 µs ±20% |   1.53 ms ±3% |
| 1 ms  |   **1.99 ms ±1%** |   3.04 ms ±1% |   2.99 ms ±1% |   3.17 ms ±1% |   2.82 ms ±4% |   3.32 ms ±3% |
| 5 ms  |   **6.25 ms ±1%** |   7.27 ms ±1% |  7.21 ms ±<1% |   7.35 ms ±1% |   7.03 ms ±1% |   7.49 ms ±1% |
| 20 ms | **21.32 ms ±<1%** | 22.31 ms ±<1% | 22.28 ms ±<1% | 22.42 ms ±<1% | 22.13 ms ±<1% | 22.57 ms ±<1% |

**Node 24: transaction (begin; insert; commit), sequential: median latency by RTT**

| RTT   |            quarry |           pg |   pg (named) |     pg-native |   postgres.js |    neon (WS) |
| ----- | ----------------: | -----------: | -----------: | ------------: | ------------: | -----------: |
| 0 ms  |   **86.8 µs ±1%** |   141 µs ±1% |   128 µs ±1% |   158 µs ±28% |   142 µs ±34% |   209 µs ±1% |
| 1 ms  |   **2.89 ms ±2%** |  4.29 ms ±5% |  4.25 ms ±4% |   4.34 ms ±2% |   4.32 ms ±2% |  4.42 ms ±2% |
| 5 ms  |  **11.68 ms ±2%** | 17.52 ms ±1% | 17.56 ms ±1% |  17.52 ms ±1% | 17.55 ms ±<1% | 17.75 ms ±1% |
| 20 ms | **41.70 ms ±<1%** | 62.58 ms ±1% | 62.50 ms ±1% | 62.57 ms ±<1% | 62.61 ms ±<1% | 62.82 ms ±1% |

**Node 24: transaction with the insert marked last (queryAndCommit), sequential: median latency by RTT**

| RTT   |        quarry |
| ----- | ------------: |
| 0 ms  |  56.7 µs ±18% |
| 1 ms  |   1.47 ms ±4% |
| 5 ms  |   5.91 ms ±1% |
| 20 ms | 20.96 ms ±<1% |

**Node 24: insert, 50 concurrent, pool 10: operations/s by RTT**

| RTT   |           quarry |          pg |  pg (named) |  pg-native | postgres.js |   neon (WS) |
| ----- | ---------------: | ----------: | ----------: | ---------: | ----------: | ----------: |
| 0 ms  | **184,906 ±27%** | 71,940 ±10% | 65,811 ±23% | 68,963 ±8% |  41,574 ±3% | 22,869 ±32% |
| 1 ms  |   **27,472 ±5%** |   5,930 ±2% |   6,202 ±2% |  5,857 ±2% |  18,572 ±1% |   5,199 ±2% |
| 5 ms  |    **8,166 ±1%** |   1,661 ±1% |   1,655 ±2% | 1,658 ±<1% |   6,913 ±1% |   1,590 ±1% |
| 20 ms |   **2,358 ±<1%** |    475 ±<1% |     475 ±1% |    474 ±1% |   1,933 ±8% |     469 ±1% |

**Node 24: connect + select 1 + close: median latency by RTT**

| RTT   |            quarry |              pg |   pg (named) |    pg-native |   postgres.js |    neon (WS) |
| ----- | ----------------: | --------------: | -----------: | -----------: | ------------: | -----------: |
| 0 ms  |   **2.65 ms ±2%** |    2.73 ms ±11% | 2.66 ms ±14% |  4.97 ms ±5% |   6.02 ms ±6% | 4.50 ms ±10% |
| 1 ms  |       5.06 ms ±4% | **4.96 ms ±9%** |  5.30 ms ±5% |  9.64 ms ±3% |   9.62 ms ±2% |  7.41 ms ±4% |
| 5 ms  |  **13.64 ms ±1%** |    13.99 ms ±2% | 14.05 ms ±1% | 27.13 ms ±1% |  22.33 ms ±1% | 16.12 ms ±1% |
| 20 ms | **43.81 ms ±<1%** |    44.03 ms ±1% | 43.97 ms ±1% | 87.17 ms ±1% | 67.77 ms ±<1% | 46.61 ms ±1% |

## PgBouncer

**Node 24 through PgBouncer 1.26 (transaction mode): operations/s**

| Scenario                                               |          quarry | quarry (prepare: false) |          pg | pg (named) |  pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | --------------: | ----------------------: | ----------: | ---------: | ---------: | ----------: | ---------------------------: |
| select 1                                               |  **21,519 ±3%** |             19,962 ±36% | 20,111 ±35% | 18,832 ±1% | 20,614 ±1% |  19,271 ±3% |                   19,437 ±3% |
| point lookup by primary key                            |  **19,229 ±2%** |              14,733 ±1% |  13,979 ±1% | 15,904 ±4% | 14,473 ±7% |  16,443 ±2% |                    8,508 ±4% |
| point lookup by primary key, concurrency 50            |      91,592 ±5% |         **127,877 ±4%** |  68,913 ±1% | 65,261 ±2% | 73,121 ±2% |  39,811 ±1% |                   41,026 ±4% |
| fetch 1k rows (6 columns)                              |   **2,790 ±1%** |               1,296 ±1% |     736 ±1% |    751 ±6% |    618 ±3% |     886 ±3% |                     866 ±23% |
| insert one row                                         | **19,177 ±36%** |             16,578 ±18% | 15,829 ±31% | 17,425 ±1% | 15,951 ±4% |  16,488 ±2% |                   8,865 ±33% |
| transaction: begin; insert; commit                     |   **9,431 ±1%** |               9,103 ±1% |   6,536 ±6% |  6,946 ±1% |  6,740 ±2% |  6,031 ±35% |                    4,689 ±3% |
| insert one row, concurrency 50                         |    102,932 ±<1% |        **103,796 ±42%** |  80,493 ±7% | 67,580 ±8% | 80,296 ±9% |  39,765 ±3% |                  41,274 ±24% |
| query that fails (division by zero), connection reused |      15,732 ±2% |          **15,786 ±2%** |  5,431 ±10% | 4,770 ±22% |  4,325 ±6% | 12,295 ±15% |                  12,335 ±27% |

**Node 24 through PgBouncer: median latency**

| Scenario                                               |      quarry | quarry (prepare: false) |      pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ------------------------------------------------------ | ----------: | ----------------------: | ------: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                                               | **44.8 µs** |                 48.0 µs | 46.6 µs |    50.1 µs |   46.6 µs |     49.3 µs |                      48.9 µs |
| point lookup by primary key                            | **49.9 µs** |                 64.4 µs | 68.0 µs |    58.6 µs |   65.7 µs |     57.1 µs |                       112 µs |
| point lookup by primary key, concurrency 50            |      536 µs |              **370 µs** |  681 µs |     715 µs |    637 µs |     1.18 ms |                      1.14 ms |
| fetch 1k rows (6 columns)                              |  **339 µs** |                  727 µs | 1.30 ms |    1.34 ms |   1.66 ms |      976 µs |                       991 µs |
| insert one row                                         | **49.9 µs** |                 57.8 µs | 60.1 µs |    54.6 µs |   60.1 µs |     57.3 µs |                       107 µs |
| transaction: begin; insert; commit                     |  **101 µs** |                  105 µs |  144 µs |     138 µs |    144 µs |      155 µs |                       203 µs |
| insert one row, concurrency 50                         |      478 µs |              **473 µs** |  581 µs |     713 µs |    580 µs |     1.17 ms |                      1.13 ms |
| query that fails (division by zero), connection reused |     60.4 µs |             **60.2 µs** |  171 µs |     192 µs |    209 µs |     76.9 µs |                      76.4 µs |

**Node 24: PgBouncer throughput relative to direct (same client, sequential)**

| Scenario                           | quarry | quarry (prepare: false) |  pg | pg (named) | pg-native | postgres.js | postgres.js (prepare: false) |
| ---------------------------------- | -----: | ----------------------: | --: | ---------: | --------: | ----------: | ---------------------------: |
| select 1                           |    48% |                     57% | 55% |        52% |   **67%** |         60% |                          59% |
| point lookup by primary key        |    53% |                     67% | 69% |        61% |   **75%** |         58% |                          63% |
| fetch 1k rows (6 columns)          |    87% |                     92% | 97% |        96% |   **99%** |         94% |                          96% |
| insert one row                     |    52% |                     65% | 64% |        56% |   **74%** |         59% |                          61% |
| transaction: begin; insert; commit |    53% |                       — | 55% |        52% |   **70%** |         56% |                            — |

## Server restart

`pg_ctl restart -m fast` while a pool runs `select 1` every 5 ms (2 s client timeout per query).

| Client      | Recovered | Time from server up to first success (median) | Failed queries (median) |
| ----------- | --------: | --------------------------------------------: | ----------------------: |
| quarry      |       5/5 |                                       3.00 ms |                      27 |
| pg          |       5/5 |                                       4.00 ms |                      27 |
| pg (named)  |       5/5 |                                       4.00 ms |                      27 |
| pg-native   |       5/5 |                                       3.00 ms |                      25 |
| postgres.js |       5/5 |                                      22.00 ms |                      14 |

## Footprint and cold start

| Package                                              | Installed size | Packages installed |
| ---------------------------------------------------- | -------------: | -----------------: |
| quarry (whole package: query builder + driver + src) |       4375 KiB |                  1 |
| pg                                                   |        464 KiB |                 14 |
| pg + pg-native (libpq addon, built)                  |       1377 KiB |                 19 |
| postgres.js                                          |        293 KiB |                  1 |
| @neondatabase/serverless (+ ws on Node)              |        582 KiB |                  2 |

| Bundle (esbuild, minified, platform node) |                                                  Size |     gzip |
| ----------------------------------------- | ----------------------------------------------------: | -------: |
| quarry/driver                             |                                             132.9 KiB | 44.7 KiB |
| pg                                        |                                              84.4 KiB | 26.3 KiB |
| postgres.js                               |                                              37.1 KiB | 14.3 KiB |
| @neondatabase/serverless                  |                                             142.9 KiB | 46.3 KiB |
| pg-native                                 | native addon (libpq .node + libpq.so): not bundleable |          |

| Client      |   Import | Connect + first query | Process start → first result | Wall time of the process |
| ----------- | -------: | --------------------: | ---------------------------: | -----------------------: |
| none        |   2.1 µs |                8.3 µs |                     41.21 ms |                 49.84 ms |
| quarry      |  9.39 ms |              11.30 ms |                     63.22 ms |                 69.60 ms |
| pg          | 22.12 ms |               7.18 ms |                     72.25 ms |                 78.62 ms |
| pg-native   | 22.07 ms |               8.60 ms |                     73.33 ms |                 80.83 ms |
| postgres.js | 14.30 ms |               9.66 ms |                     67.48 ms |                 76.04 ms |
| neon        | 24.21 ms |              11.79 ms |                     79.30 ms |                 85.37 ms |
