# Strata

Mining ledger for EVE Online players with many alts. Live at https://mining.tovdc.com.

- Log in with EVE SSO, then add each alt (EVE remembers your account login, so each extra alt is two clicks).
- A worker syncs every alt's ESI mining ledger every 30 minutes and keeps it forever. ESI itself only keeps 30 days.
- Totals and breakdowns by alt, ore, ore class, system, and day, plus a year calendar.
- Valued at Jita buy or sell, at the price today and on the day the ore was mined, and as refined minerals at your own reprocessing yield.

See `CLAUDE.md` for architecture, commands, and production layout.

## First-time server setup (already done for mining.tovdc.com)

1. `CREATE ROLE evemining LOGIN PASSWORD '…'; CREATE DATABASE evemining OWNER evemining;`
2. `/opt/evemining/backend/.env` from `backend/.env.example` (new `SECRET_KEY` and `TOKEN_ENCRYPTION_KEY`).
3. Copy `deploy/*.service` to `/etc/systemd/system/`, `systemctl daemon-reload && systemctl enable --now evemining-api evemining-worker`.
4. Append `deploy/Caddyfile.snippet` to `/etc/caddy/Caddyfile`, validate, reload.
5. `./deploy/deploy.sh`, then on the server: `cd /opt/evemining/backend && .venv/bin/python -m scripts.load_sde`.
6. Log in. The first account becomes admin.

Re-run `scripts.load_sde` after EVE expansions that add ores (unknown ores are also fetched from ESI automatically).
