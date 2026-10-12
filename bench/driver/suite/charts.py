#!/usr/bin/env python3
"""Charts from analyze.ts's summary.json.

    python3 charts.py results/<id>/summary.json <output dir>
"""
import json
import math
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

summary = json.load(open(sys.argv[1]))
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
cells = summary["cells"]
labels = summary["labels"]
titles = {k: v["title"] for k, v in summary["scenarios"].items()}
SHORT = {
    "select1": "select 1", "pk": "point\nlookup", "range100": "range\n100 rows", "fetch1k": "fetch\n1k rows", "fetch100k": "fetch\n100k rows",
    "fetch1m": "fetch\n1M rows", "stream1m": "stream\n1M rows", "wide": "wide rows\n1k×100 cols", "arrays": "arrays\n1k rows", "params100": "100\nparams",
    "params1000": "1000\nparams", "insert1": "insert\n1 row", "insert1-c50": "insert\nc=50", "insert-multi100": "multi-row\ninsert 100", "bulk-unnest": "bulk 10k\nunnest",
    "bulk-copy": "bulk 10k\nCOPY", "update": "update", "upsert": "upsert", "delete": "delete", "tx-empty": "tx\nselect 1", "tx-insert": "tx\ninsert",
    "savepoints": "5 save-\npoints", "error": "failing\nquery", "large-text": "10×1MB\ntext", "large-bytea": "10×1MB\nbytea", "large-jsonb": "20×200KB\njsonb",
}

COLORS = {
    "quarry": "#d62728",
    "quarry-lossless": "#ff9896",
    "quarry-noprep": "#e377c2",
    "quarry-nopipe": "#8c564b",
    "pg": "#1f77b4",
    "pg-named": "#aec7e8",
    "pg-native": "#2ca02c",
    "pg-native-named": "#98df8a",
    "postgres.js": "#9467bd",
    "postgres.js-noprep": "#c5b0d5",
    "bun.sql": "#ff7f0e",
    "bun.sql-noprep": "#ffbb78",
    "neon": "#17becf",
    "neon-default": "#9edae5",
    "deno-postgres-nodelay": "#7f7f7f",
    "deno-postgres": "#c7c7c7",
}
ORDER = list(COLORS)
CORE = ["quarry", "pg", "pg-named", "pg-native", "postgres.js", "neon", "bun.sql", "deno-postgres-nodelay"]
RT = {"node": "Node 24", "bun": "Bun 1.4", "deno": "Deno 2.9"}
plt.rcParams.update({"figure.dpi": 130, "font.size": 9, "axes.grid": True, "grid.alpha": 0.3, "axes.axisbelow": True})
written = []


def find(phase, runtime, driver, scenario, **kw):
    for c in cells:
        if c["phase"] != phase or c["runtime"] != runtime or c["driver"] != driver or c["scenario"] != scenario:
            continue
        if any(c.get(k) != v for k, v in kw.items()):
            continue
        if c["runs"] == 0:
            return None
        return c
    return None


def val(c, metric):
    if c is None or c.get(metric) is None:
        return None
    m = c[metric]["median"]
    return None if m is None or (isinstance(m, float) and math.isnan(m)) else m


def err(c, metric):
    s = c[metric]
    return [[max(0, s["median"] - s["lo"])], [max(0, s["hi"] - s["median"])]]


def drivers_in(phase, runtime, core_only=True):
    seen = {c["driver"] for c in cells if c["phase"] == phase and c["runtime"] == runtime and c["runs"] > 0}
    return [d for d in ORDER if d in seen and (not core_only or d in CORE)]


def save(fig, name):
    path = os.path.join(out, name)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    written.append(path)


def grouped_bars(ax, groups, drivers, getter, ylabel, log=False, errs=None):
    n = len(drivers)
    width = 0.8 / max(1, n)
    for i, d in enumerate(drivers):
        xs, ys, es_lo, es_hi = [], [], [], []
        for g, group in enumerate(groups):
            c, v = getter(group, d)
            if v is None:
                continue
            xs.append(g + (i - (n - 1) / 2) * width)
            ys.append(v)
            if errs and c is not None:
                e = err(c, errs)
                es_lo.append(e[0][0])
                es_hi.append(e[1][0])
            else:
                es_lo.append(0)
                es_hi.append(0)
        ax.bar(xs, ys, width, label=labels.get(d, d), color=COLORS.get(d), yerr=[es_lo, es_hi] if errs else None, capsize=1.5, error_kw={"lw": 0.6})
    ax.set_xticks(range(len(groups)))
    ax.set_ylabel(ylabel)
    if log:
        ax.set_yscale("log")


# 1. latency percentiles (select 1 and point lookup), per runtime
for runtime in ["node", "bun", "deno"]:
    ds = drivers_in("main", runtime)
    if not ds:
        continue
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    for ax, scen in zip(axes, ["select1", "pk"]):
        ps = ["p50", "p90", "p99", "p999", "pmax"]
        grouped_bars(ax, ps, ds, lambda p, d: (find("main", runtime, d, scen), (lambda c: None if c is None or val(c, p) is None else val(c, p) * 1000)(find("main", runtime, d, scen))), "latency (µs, log)", log=True)
        ax.set_xticklabels(["p50", "p90", "p99", "p99.9", "max"])
        ax.set_title(f"{RT[runtime]}: {titles[scen]}, sequential")
    axes[0].legend(fontsize=7)
    save(fig, f"latency-percentiles-{runtime}.png")

# 2. relative throughput overview vs pg, per runtime
OVERVIEW = ["select1", "pk", "range100", "fetch1k", "fetch100k", "wide", "arrays", "params100", "insert1", "insert1-c50", "insert-multi100", "bulk-unnest", "update", "upsert", "tx-insert", "savepoints", "error"]
for runtime in ["node", "bun", "deno"]:
    ds = drivers_in("main", runtime)
    if "pg" not in ds:
        continue
    fig, ax = plt.subplots(figsize=(13, 4.5))
    def rel(s, d):
        c, base = find("main", runtime, d, s), find("main", runtime, "pg", s)
        v, b = val(c, "throughput"), val(base, "throughput")
        return c, (v / b if v and b else None)
    grouped_bars(ax, OVERVIEW, ds, rel, "throughput relative to pg (log)", log=True)
    ax.axhline(1, color="black", lw=0.8)
    ax.set_xticklabels([SHORT[s] for s in OVERVIEW], fontsize=7)
    ax.set_title(f"{RT[runtime]}: throughput relative to pg (higher is better; median of runs)")
    ax.legend(fontsize=7, ncol=4)
    save(fig, f"throughput-relative-{runtime}.png")

# 3. concurrency sweep
for runtime in ["node", "bun"]:
    ds = drivers_in("conc", runtime, core_only=False)
    if not ds:
        continue
    fig, axes = plt.subplots(1, 4, figsize=(15, 4), sharey=True)
    for ax, pool in zip(axes, [1, 5, 10, 50]):
        for d in ds:
            xs, ys = [], []
            for c in [1, 10, 50, 100, 500, 1000]:
                v = val(find("conc", runtime, d, "pk", max=pool, concurrency=c), "throughput")
                if v:
                    xs.append(c)
                    ys.append(v)
            ax.plot(xs, ys, marker="o", ms=3, label=labels.get(d, d), color=COLORS.get(d))
        ax.set_xscale("log")
        ax.set_title(f"pool size {pool}")
        ax.set_xlabel("concurrent callers")
    axes[0].set_ylabel("point lookups/s")
    axes[0].legend(fontsize=7)
    fig.suptitle(f"{RT[runtime]}: concurrency sweep, point lookup by primary key")
    save(fig, f"concurrency-sweep-{runtime}.png")

# 4. RTT sweep
RTT_VARIANTS = [
    ("select1", 10, None, "select 1, sequential"),
    ("pk", 10, 50, "point lookup, 50 concurrent, pool 10"),
    ("pk", 1, 100, "point lookup, 100 concurrent, pool 1"),
    ("tx-insert", 10, None, "begin; insert; commit, sequential"),
    ("insert1-c50", 10, None, "insert, 50 concurrent, pool 10"),
    ("connect-plain-trust", 10, None, "connect + select 1 + close"),
]
for runtime in ["node", "bun"]:
    ds = drivers_in("rtt", runtime)
    if not ds:
        continue
    fig, axes = plt.subplots(2, 3, figsize=(14, 7.5))
    for ax, (s, mx, conc, name) in zip(axes.flat, RTT_VARIANTS):
        for d in ds:
            xs, ys = [], []
            for rtt in [0, 1, 5, 20]:
                kw = {"max": mx, "rtt": rtt, "concurrency": conc}
                v = val(find("rtt", runtime, d, s, **kw), "throughput")
                if v:
                    xs.append(rtt)
                    ys.append(v)
            ax.plot(xs, ys, marker="o", ms=3, label=labels.get(d, d), color=COLORS.get(d))
        ax.set_yscale("log")
        ax.set_xscale("symlog", linthresh=1)
        ax.set_xticks([0, 1, 5, 20])
        ax.set_xticklabels(["0", "1", "5", "20"])
        ax.set_xlabel("simulated RTT (ms)")
        ax.set_ylabel("operations/s (log)")
        ax.set_title(name)
    axes.flat[0].legend(fontsize=7)
    fig.suptitle(f"{RT[runtime]}: throughput vs network round-trip time (Toxiproxy)")
    save(fig, f"rtt-sweep-{runtime}.png")

# 5. pipelining depth
pipe = summary.get("pipeline") or {}
if pipe:
    fig, ax = plt.subplots(figsize=(6, 4))
    for rtt, series in pipe.items():
        xs = [int(k) for k, v in series.items() if v]
        ys = [v["median"] for v in series.values() if v]
        ax.plot(xs, ys, marker="o", label=f"RTT {rtt} ms")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("quarry `pipeline` (queries in flight per connection)")
    ax.set_ylabel("point lookups/s (log)")
    ax.set_title("quarry: 1 connection, 100 concurrent callers")
    ax.legend()
    save(fig, "pipeline-depth.png")

# 6. large-result throughput (rows/s), per runtime
LARGE = ["fetch1k", "fetch100k", "fetch1m", "stream1m", "wide", "arrays"]
fig, axes = plt.subplots(1, 3, figsize=(16, 4.2))
for ax, runtime in zip(axes, ["node", "bun", "deno"]):
    ds = drivers_in("main", runtime)
    def rows_s(s, d):
        c = find("main", runtime, d, s)
        v = val(c, "throughput")
        return c, (v * summary["scenarios"][s]["rowsPerOp"] if v else None)
    grouped_bars(ax, LARGE, ds, rows_s, "rows/s (log)", log=True)
    ax.set_xticklabels([SHORT[s] for s in LARGE], fontsize=7)
    ax.set_title(f"{RT[runtime]}: large results, rows/s")
    ax.legend(fontsize=6.5)
save(fig, "large-results.png")

# 7. memory: peak RSS for 1M rows in one result vs streamed vs slow consumer
fig, axes = plt.subplots(1, 3, figsize=(15, 4))
for ax, runtime in zip(axes, ["node", "bun", "deno"]):
    ds = drivers_in("main", runtime)
    grouped_bars(ax, ["pk", "fetch100k", "fetch1m", "stream1m", "stream-slow"], ds, lambda s, d: (find("main", runtime, d, s), val(find("main", runtime, d, s), "rssPeakMB")), "peak RSS (MB)")
    ax.set_xticklabels(["point lookup\n(baseline)", "fetch 100k", "fetch 1M\n(one result)", "stream 1M\n(cursor)", "stream 200k\nslow consumer"], fontsize=7)
    ax.set_title(f"{RT[runtime]}: peak process RSS")
    ax.legend(fontsize=6.5)
save(fig, "memory.png")

# 8. per-type decode cost
TYPES = ["i4", "i8", "f8", "num", "txt", "b", "ts", "d", "u", "j", "i4a", "by"]
for runtime in ["node", "bun", "deno"]:
    ds = [d for d in drivers_in("main", runtime, core_only=False) if d in CORE or d == "quarry-lossless"]
    if not ds:
        continue
    fig, ax = plt.subplots(figsize=(13, 4.2))
    grouped_bars(ax, TYPES, ds, lambda t, d: (find("main", runtime, d, f"type-{t}"), (lambda v: v * 1e6 / 100000 if v else None)(val(find("main", runtime, d, f"type-{t}"), "p50"))), "ns per value (log)", log=True)
    ax.set_xticklabels([titles[f"type-{t}"].replace("decode 100k × ", "") for t in TYPES], fontsize=7)
    ax.set_title(f"{RT[runtime]}: decode cost per value (fetch 100k rows × 1 column, includes transfer)")
    ax.legend(fontsize=7, ncol=4)
    save(fig, f"types-decode-{runtime}.png")

# 9. connections
CONN = ["connect-plain-trust", "connect-plain-scram", "connect-tls-trust", "connect-tls-scram", "pool-warmup"]
fig, axes = plt.subplots(1, 3, figsize=(16, 4))
for ax, runtime in zip(axes, ["node", "bun", "deno"]):
    ds = drivers_in("main", runtime)
    grouped_bars(ax, CONN, ds, lambda s, d: (find("main", runtime, d, s), val(find("main", runtime, d, s), "p50")), "median ms (log)", log=True, errs="p50")
    ax.set_xticklabels(["plain\ntrust", "plain\nSCRAM", "TLS\ntrust", "TLS\nSCRAM", "pool warm-up\n(10 conns)"], fontsize=7)
    ax.set_title(f"{RT[runtime]}: connect + select 1 + close")
    ax.legend(fontsize=6.5)
save(fig, "connections.png")

# 10. CPU per query, client and server (Node)
for runtime in ["node"]:
    ds = drivers_in("main", runtime)
    fig, axes = plt.subplots(1, 2, figsize=(13, 4))
    SC = ["select1", "pk", "fetch1k", "insert1", "insert1-c50", "tx-insert"]
    for ax, metric, name in zip(axes, ["cpuUsPerOp", "serverCpuUsPerOp"], ["client CPU µs per operation", "server (PostgreSQL) CPU µs per operation"]):
        grouped_bars(ax, SC, ds, lambda s, d: (find("main", runtime, d, s), val(find("main", runtime, d, s), metric)), name + " (log)", log=True)
        ax.set_xticklabels([SHORT[s] for s in SC], fontsize=7)
        ax.set_title(f"{RT[runtime]}: {name}")
    axes[0].legend(fontsize=7)
    save(fig, f"cpu-per-op-{runtime}.png")

# 11. PgBouncer vs direct (Node)
ds = drivers_in("bouncer", "node", core_only=False)
if ds:
    fig, ax = plt.subplots(figsize=(11, 4))
    SB = [("select1", None), ("pk", None), ("pk", 50), ("fetch1k", None), ("insert1", None), ("tx-insert", None), ("insert1-c50", None)]
    def bget(sc, d):
        s, conc = sc
        c = find("bouncer", "node", d, s, concurrency=conc)
        return c, val(c, "throughput")
    grouped_bars(ax, SB, ds, bget, "operations/s (log)", log=True)
    ax.set_xticklabels([SHORT[s] + (f"\n(c={c})" if c else "") for s, c in SB], fontsize=7)
    ax.set_title("Node 24 through PgBouncer 1.26, transaction mode")
    ax.legend(fontsize=7, ncol=3)
    save(fig, "pgbouncer-node.png")

# 12. cold start
fp = summary.get("footprint")
if fp:
    cold = fp["cold"]
    keys = [k for k in cold if not k.endswith("/none")]
    fig, ax = plt.subplots(figsize=(12, 4))
    base = {k.split("/")[0]: cold[k]["sinceStartMs"] for k in cold if k.endswith("/none")}
    xs = range(len(keys))
    imp = [cold[k]["importMs"] for k in keys]
    fq = [cold[k]["firstQueryMs"] for k in keys]
    ax.bar(xs, imp, label="import", color="#1f77b4")
    ax.bar(xs, fq, bottom=imp, label="connect + first query", color="#ff7f0e")
    ax.set_xticks(list(xs))
    ax.set_xticklabels([k.replace("/", "\n") for k in keys], fontsize=7)
    ax.set_ylabel("ms")
    ax.set_title("Cold start: module import, then connect + first query (median of 15 fresh processes)")
    ax.legend()
    save(fig, "cold-start.png")

print("\n".join(written))

# 13. optional A/B: a candidate build's raw results (QUARRY_DIST) against the baseline, for quarry's concurrency sweep
if len(sys.argv) > 4:
    def load(path):
        rows = {}
        for line in open(path):
            r = json.loads(line)
            c = r["cell"]
            if "throughput" not in r["result"] or c["driver"] != "quarry" or c["runtime"] != "node" or c["scenario"] != "pk":
                continue
            rows.setdefault((c["phase"], c["max"], c.get("concurrency"), c.get("pipeline"), c.get("rtt")), []).append(r["result"]["throughput"])
        return {k: sorted(v)[len(v) // 2] for k, v in rows.items()}
    base, cand = load(sys.argv[3]), load(sys.argv[4])
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.2))
    for pool, color in zip([1, 5, 10], ["#1f77b4", "#2ca02c", "#d62728"]):
        xs = [1, 10, 50, 100, 500, 1000]
        axes[0].plot(xs, [base.get(("conc", pool, c, None, None)) for c in xs], color=color, ls="--", marker="o", ms=3, label=f"pool {pool}, main")
        axes[0].plot(xs, [cand.get(("conc", pool, c, None, None)) for c in xs], color=color, marker="o", ms=3, label=f"pool {pool}, with fix")
    axes[0].set_xscale("log")
    axes[0].set_xlabel("concurrent callers")
    axes[0].set_ylabel("point lookups/s")
    axes[0].set_title("quarry concurrency sweep: main vs pool fix (Node)")
    axes[0].legend(fontsize=7)
    depths = [1, 2, 4, 8, 16, 32, 64, 100]
    for rtt, color in [(0, "#9467bd"), (5, "#ff7f0e")]:
        axes[1].plot(depths, [base.get(("pipeline", 1, 100, p, rtt)) for p in depths], color=color, ls="--", marker="o", ms=3, label=f"RTT {rtt} ms, main")
        axes[1].plot(depths, [cand.get(("pipeline", 1, 100, p, rtt)) for p in depths], color=color, marker="o", ms=3, label=f"RTT {rtt} ms, with fix")
    axes[1].set_xscale("log")
    axes[1].set_yscale("log")
    axes[1].set_xlabel("`pipeline` option")
    axes[1].set_ylabel("point lookups/s (log)")
    axes[1].set_title("1 connection, 100 callers: main vs pool fix")
    axes[1].legend(fontsize=7)
    save(fig, "pool-fix-ab.png")
    print(written[-1])
