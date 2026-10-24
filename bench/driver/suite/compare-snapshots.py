#!/usr/bin/env python3
"""Compares one client's figures between two `tables.md` files (results
snapshots or fresh runs), row by row, for the tables both contain.

    python3 compare-snapshots.py <old tables.md> <new tables.md> [--column quarry] [--match TEXT]

Prints a markdown table: table, row, old value, new value, and the change
(for times and memory, negative is better; for rates, positive is better).
"""
import re
import sys

UNITS = {"µs": 1e-3, "ms": 1.0, "s": 1e3}


def parse(path):
    """{table title: {"columns": [...], "rows": {label: [cells]}}}"""
    tables, title, cols = {}, None, None
    for line in open(path, encoding="utf8"):
        line = line.rstrip("\n")
        m = re.match(r"^\*\*(.+)\*\*$", line)
        if m:
            title, cols = m.group(1), None
            continue
        if title and line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if cols is None:
                cols = cells
                tables[title] = {"columns": cols[1:], "rows": {}}
            elif not all(re.fullmatch(r":?-+:?", c) for c in cells):
                tables[title]["rows"][cells[0]] = cells[1:]
        elif not line.startswith("|"):
            if line.strip() and not line.startswith("**"):
                title = None
    return tables


def value(cell):
    """A cell as a number (times in ms), or None."""
    text = cell.replace("*", "").split("±")[0].strip().replace(",", "")
    m = re.fullmatch(r"(-?[\d.]+)\s*(µs|ms|s|%)?", text)
    if not m:
        return None
    v = float(m.group(1))
    return v * UNITS.get(m.group(2) or "", 1.0)


def main():
    args = sys.argv[1:]
    opt = lambda name, default=None: args[args.index(name) + 1] if name in args else default
    column = opt("--column", "quarry")
    match = opt("--match")
    old, new = parse(args[0]), parse(args[1])
    print(f"| Table | Row | old | new | change |\n|---|---|---:|---:|---:|")
    for title, t in new.items():
        if match and match not in title:
            continue
        o = old.get(title)
        if not o or column not in t["columns"] or column not in o["columns"]:
            continue
        ci, oi = t["columns"].index(column), o["columns"].index(column)
        for label, cells in t["rows"].items():
            if label not in o["rows"]:
                continue
            a, b = value(o["rows"][label][oi]), value(cells[ci])
            change = f"{(b - a) / a * 100:+.0f}%" if a and b is not None else "—"
            print(f"| {title} | {label} | {o['rows'][label][oi].replace('**', '')} | {cells[ci].replace('**', '')} | {change} |")


main()
