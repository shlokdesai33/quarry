#!/usr/bin/env bash
# One-time setup of everything the driver benchmark needs, on Ubuntu 24.04
# (x86-64). Installs PostgreSQL 18 + PgBouncer (PGDG), Bun, Deno, Go (to
# build Neon's wsproxy), Toxiproxy, matplotlib, and the benchmark's npm
# dependencies, including the pg-native addon.
set -euo pipefail
cd "$(dirname "$0")"

sudo apt-get update -qq
sudo apt-get install -y -qq curl ca-certificates gnupg lsb-release unzip psmisc build-essential libpq-dev python3-pip
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-18 pgbouncer
# the packaged cluster and PgBouncer service aren't used
sudo systemctl disable --now postgresql pgbouncer 2>/dev/null || true

command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.3"
command -v deno >/dev/null || curl -fsSL https://deno.land/install.sh | sh -s -- -y v2.9.7

BIN="${BENCH_BIN:-$HOME/benchbin}"
mkdir -p "$BIN"
[ -x "$BIN/toxiproxy-server" ] || curl -fsSL -o "$BIN/toxiproxy-server" https://github.com/Shopify/toxiproxy/releases/download/v2.12.0/toxiproxy-server-linux-amd64
chmod +x "$BIN/toxiproxy-server"
if [ ! -x "$BIN/wsproxy" ]; then
	GO="$HOME/.local/go"
	[ -x "$GO/bin/go" ] || { mkdir -p "$GO"; curl -fsSL https://go.dev/dl/go1.25.3.linux-amd64.tar.gz | tar xz -C "$GO" --strip-components=1; }
	GOBIN="$BIN" "$GO/bin/go" install github.com/neondatabase/wsproxy@v0.0.0-20241104134926-99ed92dd75ba
fi

pip3 install --user --break-system-packages -q matplotlib

# quarry's dist (the benchmark imports the built driver, as users do)
(cd ../../.. && pnpm install && pnpm build)
pnpm install
# pnpm doesn't run libpq's install script: build the pg-native addon explicitly
(cd node_modules/.pnpm/libpq@*/node_modules/libpq && npx -y node-gyp rebuild >/dev/null)
node -e "require('pg').native || process.exit(1)" && echo "setup done"
