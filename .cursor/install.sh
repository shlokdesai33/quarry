#!/usr/bin/env bash
# Idempotent bootstrap for the quarry development environment.
# Installs Bun and PostgreSQL (if missing), provisions the dev role/database,
# and installs project dependencies. Safe to run repeatedly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PG_VERSION=16
DB_ROLE=quarry
DB_PASSWORD=quarry
DB_NAME=quarry_dev

echo "[install] Ensuring Bun is installed..."
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="${BUN_INSTALL}/bin:${PATH}"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="${BUN_INSTALL}/bin:${PATH}"
fi
# Expose bun on a stable, non-interactive PATH location.
if [ -x "${BUN_INSTALL}/bin/bun" ]; then
  sudo ln -sf "${BUN_INSTALL}/bin/bun" /usr/local/bin/bun 2>/dev/null || true
fi
echo "[install] Bun version: $(bun --version)"

echo "[install] Ensuring PostgreSQL ${PG_VERSION} is installed..."
if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    "postgresql-${PG_VERSION}" "postgresql-contrib"
fi
echo "[install] $(psql --version)"

echo "[install] Starting PostgreSQL cluster..."
bash "${SCRIPT_DIR}/start.sh"

echo "[install] Ensuring role '${DB_ROLE}' and database '${DB_NAME}' exist..."
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_ROLE}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE ${DB_ROLE} WITH LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB;"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_ROLE}" "${DB_NAME}"
fi

echo "[install] Installing project dependencies..."
cd "${REPO_ROOT}"
bun install

echo "[install] Done."
