# Results snapshots

The generated tables (`analyze.ts`), footprint figures (`footprint.ts`) and run metadata of full runs, kept because `results/` is gitignored. The raw results stayed on the benchmark VM.

| Run                  | quarry              | Notes                                                |
| -------------------- | ------------------- | ---------------------------------------------------- |
| `2026-10-11-e45dd3c` | `main` at `e45dd3c` | First full run, before the pool pipelining fix (#12) |
| `2026-10-12-28faa23` | `main` at `28faa23` | After #12 (pool fix) and #11 (driver compat fixes)   |

`meta.json`'s `quarry` field is the suite branch's commit; the driver commit is in the table above.
