#!/usr/bin/env bash
# Per-boot startup for the quarry development environment.
# Brings the PostgreSQL cluster online and waits until it accepts connections.
# Idempotent: safe to run when the cluster is already started.
set -euo pipefail

PG_VERSION=16
PG_CLUSTER=main

echo "[start] Ensuring PostgreSQL ${PG_VERSION}/${PG_CLUSTER} is running..."
if sudo pg_lsclusters -h | awk '{print $4}' | grep -q '^online$'; then
  echo "[start] PostgreSQL cluster already online."
else
  sudo pg_ctlcluster "${PG_VERSION}" "${PG_CLUSTER}" start
fi

echo "[start] Waiting for PostgreSQL to accept connections..."
for _ in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    echo "[start] PostgreSQL is ready on 127.0.0.1:5432."
    exit 0
  fi
  sleep 1
done

echo "[start] ERROR: PostgreSQL did not become ready in time." >&2
sudo tail -n 40 "/var/log/postgresql/postgresql-${PG_VERSION}-${PG_CLUSTER}.log" >&2 || true
exit 1
