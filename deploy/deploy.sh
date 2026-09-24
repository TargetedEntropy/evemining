#!/usr/bin/env bash
# Build the frontend and ship everything to mining.tovdc.com.
# First-time setup (DB, .env, systemd, Caddy) is described in README.md.
set -euo pipefail
HOST=root@mining.tovdc.com
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

(cd "$ROOT/frontend" && npm run build)

rsync -az --delete \
  --exclude .venv --exclude .env --exclude sde-cache --exclude __pycache__ --exclude .pytest_cache \
  "$ROOT/backend/" "$HOST:/opt/evemining/backend/"
rsync -az --delete "$ROOT/frontend/dist/" "$HOST:/opt/evemining/frontend/dist/"

ssh "$HOST" 'set -e
  cd /opt/evemining/backend
  [ -d .venv ] || python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
  .venv/bin/alembic upgrade head
  systemctl restart evemining-api evemining-worker
  sleep 2
  curl -fsS localhost:8010/api/health && echo " api ok"'
