#!/usr/bin/env python3
"""The headline tables of the published report (docs/driver-benchmarks.md),
from analyze.ts's summary.json. The full set is in tables.md; these are
the curated subsets the report's sections quote.

    python3 report-tables.py results/<id>/summary.json > headline.md
"""
import json
import math
import sys

S = json.load(open(sys.argv[1]))
LABEL = S["labels"]
TITLE = {k: v["title"] for k, v in S["scenarios"].items()}
I = {}
for c in S["cells"]:
    I[(c["phase"], c["runtime"], c["driver"], c["scenario"], c["via"], c["max"], c.get("concurrency"), c.get("pipeline"), c.get("rtt"), c.get("memOps"))] = c


def get(phase, runtime, driver, scenario, via="direct", mx=10, conc=None, pipe=None, rtt=None, memops=None):
    c = I.get((phase, runtime, driver, scenario, via, mx, conc, pipe, rtt, memops))
    return c if c and c["runs"] else None


def val(c, m):
    if c is None or c.get(m) is None:
        return None
    v = c[m]["median"]
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else v


def t(ms):
    if ms is None:
        return "—"
    if ms < 1:
        return f"{ms * 1000:.1f} µs" if ms < 0.1 else f"{ms * 1000:.0f} µs"
    if ms < 100:
        return f"{ms:.2f} ms"
    return f"{ms:,.0f} ms" if ms < 10000 else f"{ms / 1000:.1f} s"


def r(v):
    return "—" if v is None else (f"{v:,.0f}" if v >= 100 else f"{v:.1f}")


def table(title, rows, drivers, cell, fmt, lower, head="Scenario", label=lambda d: LABEL.get(d, d), bold=True):
    lines = [f"**{title}**", "", f"| {head} | " + " | ".join(label(d) for d in drivers) + " |", "|---|" + "|".join("---:" for _ in drivers) + "|"]
    for name, key in rows:
        vals = [cell(key, d) for d in drivers]
        fin = [v for v in vals if v is not None]
        best = (min(fin) if lower else max(fin)) if len(fin) > 1 and bold else None
        lines.append(f"| {name} | " + " | ".join(f"**{fmt(v)}**" if v is not None and v == best else fmt(v) for v in vals) + " |")
    return "\n".join(lines) + "\n"


def main_cell(runtime, metric):
    return lambda s, d: val(get("main", runtime, d, s), metric)


NODE = ["quarry", "pg", "pg-named", "pg-native", "postgres.js", "neon"]
RTT_D = ["quarry", "pg", "pg-native", "postgres.js", "neon"]
out = []

seq = ["select1", "pk", "range100", "fetch1k", "insert1", "update", "tx-insert", "savepoints", "error"]
out.append(table("Sequential latency (p50), Node 24", [(TITLE[s], s) for s in seq], NODE, main_cell("node", "p50"), t, True))
big = ["fetch100k", "fetch1m", "wide", "large-bytea", "large-text", "large-jsonb", "arrays", "stream1m"]
out.append(table("Large results (time per fetch, p50), Node 24", [(TITLE[s], s) for s in big], NODE, main_cell("node", "p50"), t, True))
out.append(table("Large results (time per fetch, mean), Node 24", [(TITLE[s], s) for s in big], NODE, main_cell("node", "mean"), t, True))

MEM = [("fetch100k", 5), ("fetch1m", 3), ("wide", 50), ("large-jsonb", 10), ("large-bytea", 20), ("arrays", 50), ("stream1m", 3)]
out.append(table("Peak RSS at equal work (MB), Node 24", [(f"{TITLE[s]} × {n}", (s, n)) for s, n in MEM], NODE, lambda k, d: val(get("main", "node", d, k[0], memops=k[1]), "rssPeakMB"), r, True))

JS = [("bulk-unnest-js", "throughput", r, False, "bulk insert 10k rows, JS arrays (batches/s)"), ("bulk-unnest-js1k", "throughput", r, False, "bulk insert 1k rows, JS arrays (batches/s)"),
      ("bulk-unnest", "throughput", r, False, "bulk insert 10k rows, pre-encoded literals (batches/s)"), ("any1000-js", "p50", t, True, "id = any($1), 1000 ids (p50)")]
lines = ["**JS-array parameters, Node 24**", "", "| Scenario | " + " | ".join(LABEL.get(d, d) for d in NODE) + " |", "|---|" + "|".join("---:" for _ in NODE) + "|"]
for s, m, f, lower, label in JS:
    vals = [val(get("main", "node", d, s), m) for d in NODE]
    fin = [v for v in vals if v is not None]
    best = ((min(fin) if lower else max(fin)) if fin else None)
    lines.append(f"| {label} | " + " | ".join(f"**{f(v)}**" if v is not None and v == best else f(v) for v in vals) + " |")
out.append("\n".join(lines) + "\n")

CONC_D = ["quarry", "quarry-nopipe", "pg", "pg-named", "postgres.js", "neon"]
cells = [(1, 50), (1, 100), (1, 1000), (5, 100), (5, 500), (10, 100), (10, 500), (10, 1000), (50, 1000)]
out.append(table("Point lookups/s on Node, by pool size / callers", [(f"{m} / {c}", (m, c)) for m, c in cells], CONC_D, lambda k, d: val(get("conc", "node", d, "pk", mx=k[0], conc=k[1]), "throughput"), r, False, head="Pool / callers"))

for s, mx, c, name in [("pk", 10, 50, "50 callers, pool 10"), ("pk", 1, 100, "100 callers, pool 1"), ("pk", 1, 500, "500 callers, pool 1"), ("tx-insert", 10, None, "begin; insert; commit"), ("savepoints", 10, None, "5 savepoints"), ("connect-plain-trust", 10, None, "connect + select 1 + close")]:
    metric = "throughput" if c else "p50"
    out.append(table(f"RTT, {name} ({'ops/s' if c else 'median latency'})", [(f"{x} ms", x) for x in [0, 1, 5, 20]], RTT_D, lambda x, d, s=s, mx=mx, c=c, metric=metric: val(get("rtt", "node", d, s, via="toxiproxy", mx=mx, conc=c, rtt=x), metric), r if c else t, not c, head="RTT"))
out.append(table("quarry, 1 connection, 100 callers: ops/s by `pipeline` (RTT 0 / 5 ms)", [(str(p) if p else "adaptive (default)", p) for p in [1, 2, 4, 8, 16, 32, 64, 100, None]], [0, 5], lambda p, rtt: val(get("pipeline", "node", "quarry", "pk", via="toxiproxy", mx=1, conc=100, pipe=p, rtt=rtt), "throughput"), r, False, head="pipeline", label=lambda d: f"RTT {d} ms", bold=False))
batch = [s for s, v in S["scenarios"].items() if v["group"] == "batches"]
if batch:
    out.append(table("quarry's query builder, 3 statements per operation (ops/s)", [(TITLE[s], s) for s in batch], [0, 5], lambda s, rtt: val(get("batch", "node", "quarry-db", s, via="toxiproxy", rtt=rtt), "throughput"), r, False, label=lambda d: f"RTT {d} ms", bold=False))

B_OPS = [("lookup", "db-pk", "pk"), ("lookup, timeout", "db-pk-timed", None), ("insert", "db-insert", "insert1"), ("update", "db-update", "update")]
B_D = ["quarry-db", "quarry", "pg", "postgres.js"]


def builder_cell(rtt, metric):
    def cell(k, d):
        builder, plain, c = k
        s = builder if d == "quarry-db" else plain
        return None if s is None else val(get("builder", "node", d, s, via="toxiproxy", conc=c, rtt=rtt), metric)
    return cell


if any(c["phase"] == "builder" for c in S["cells"]):
    for rtt in [0, 5]:
        rows = [(f"{n}, {c}", (b, p, c)) for n, b, p in B_OPS for c in [1, 100, 500, 1000]]
        out.append(table(f"Query builder against the driver, pool 10, {rtt} ms RTT (ops/s)", rows, B_D, builder_cell(rtt, "throughput"), r, False, head="Statement, callers"))
        out.append(table(f"Query builder against the driver, pool 10, {rtt} ms RTT (p99)", rows, B_D, builder_cell(rtt, "p99"), t, True, head="Statement, callers"))

W = ["insert1", "insert1-c50", "insert-multi100", "bulk-unnest", "bulk-copy", "update", "upsert", "delete", "tx-empty", "tx-insert", "savepoints"]
out.append(table("Writes and transactions, Node 24 (operations/s)", [(TITLE[s], s) for s in W], NODE, main_cell("node", "throughput"), r, False))
print("\n".join(out))
