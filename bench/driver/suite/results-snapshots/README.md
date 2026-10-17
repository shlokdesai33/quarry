# Results snapshots

The generated tables (`analyze.ts`), footprint figures (`footprint.ts`) and run metadata of full runs, kept because `results/` is gitignored. The raw results stayed on the benchmark VM.

| Run                  | quarry              | Notes                                                                                                                                                                                                            |
| -------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-10-11-e45dd3c` | `main` at `e45dd3c` | First full run, before the pool pipelining fix (#12)                                                                                                                                                             |
| `2026-10-12-28faa23` | `main` at `28faa23` | After #12 (pool fix) and #11 (driver compat fixes)                                                                                                                                                               |
| `2026-10-13-af58bb2` | `main` at `af58bb2` | After #13–#15 and #17–#21 (not #16). First run with equal-work memory, JS-array scenarios, transactions at every RTT and 500-caller single-connection cells                                                      |
| `2026-10-17-c646f4b` | `main` at `c646f4b` | After #22–#29: PgBouncer unnamed pipelining, per-query garbage cut, lazy result shapes and `db.batch`, unified codecs. Adds the `batch` phase (`db.batch` vs sequential and `Promise.all`). Fresh VM, Node 24.22 |

`meta.json`'s `quarry` field is the suite branch's commit; the driver commit is in the table above.
