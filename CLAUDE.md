# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Strata** (mining.tovdc.com): a multi-user EVE Online mining tracker. Each user links many alts (5–20 is normal) via EVE SSO; a worker pulls every alt's ESI mining ledger into Postgres so history outlives ESI's 30-day window, and the UI shows totals, per-alt/ore/system breakdowns, Jita valuation, and refined-mineral value.

Auth follows `../EVE_SSO_AUTH_GUIDE.md` (JWT session cookie, Redis OAuth state + logout blacklist) with these deliberate differences:
- Only one ESI scope: `esi-industry.read_character_mining.v1` (`app/config.py:SCOPES`). Don't add scopes casually; users trust us with many alts.
- `/auth/login` is a plain 302 (no JSON step). If a session exists, its user id is stored in the OAuth state and the new character becomes an alt.
- The SSO callback is registered as `https://mining.tovdc.com/auth/callback` (not under `/api`), so Caddy proxies `/auth/*` as well as `/api/*`.
- Refresh tokens are Fernet-encrypted at rest (`TOKEN_ENCRYPTION_KEY`); access tokens are never stored.
- If a character's `owner_hash` changes (character transfer), its ledger history is deleted before re-linking.
- The first account ever created becomes admin.

## Layout

```
backend/            FastAPI + async SQLAlchemy + asyncpg (Python 3.12)
  app/config.py     settings (.env), SCOPES
  app/models.py     all tables (users, characters, mining_ledger, prices, sde_*, audit_logs)
  app/esi.py        SSO token exchange/refresh, JWT verify via JWKS, ESI GETs with error-budget backoff
  app/sync.py       per-character ledger sync (upsert; ESI quantities are daily running totals → overwrite, not add)
  app/pricing.py    hourly Jita snapshot (Fuzzwork aggregates, 5% percentile; ESI average price fallback)
  app/stats.py      every stats query builds on one `enriched` CTE (value now / value on mining day / refined value)
  app/worker.py     separate process: prices hourly, affiliations 6-hourly, due ledgers every 30 s tick
  app/sde.py        ore classification + lazy fill of unknown types/systems from ESI
  scripts/load_sde.py   loads the needed slice of CCP's official JSONL SDE
  scripts/seed_demo.py  DEV ONLY: fake 14-alt account with months of data; prints a session cookie
frontend/           React 18 + Vite + TS, react-query, d3-scale/shape (hand-drawn SVG charts), plain CSS
  src/styles.css    design tokens (dark "basalt" default + light), all component styles
  src/lib/hooks.ts  range / alt filter / measure live in the URL (?range=90d&alts=1,2&by=m3)
  src/components/charts.tsx  StrataBand, DailyChart, CalendarHeat, Sparkline
deploy/             systemd units, Caddy block, deploy.sh
```

## Commands

```bash
# backend
cd backend && uv venv .venv -p 3.12 && uv pip install -p .venv -r requirements.txt
.venv/bin/alembic upgrade head
.venv/bin/python -m scripts.load_sde [--zip sde.zip]
.venv/bin/uvicorn app.main:app --port 8010 --reload
.venv/bin/python -m app.worker
.venv/bin/python -m pytest -q tests
.venv/bin/alembic revision --autogenerate -m "..."   # after model changes

# frontend (vite proxies /api and /auth to :8010)
cd frontend && npm install && npm run dev
npm run typecheck && npm run build

# deploy (build + rsync + pip + migrate + restart)
./deploy/deploy.sh
```

Local dev has no Docker access; develop against the server's Postgres/Valkey through an SSH tunnel:
`ssh -f -N -L 55432:127.0.0.1:5432 -L 56379:127.0.0.1:6379 root@mining.tovdc.com` and use the `evemining_dev` database (`backend/.env`, `SECURE_COOKIES=false`). Seed it with `scripts.seed_demo` and set the printed `strata_session` cookie on localhost:5173.

## Production (root@mining.tovdc.com, shared host)

- Code: `/opt/evemining/{backend,frontend/dist}`; secrets in `/opt/evemining/backend/.env` (never overwrite it; deploy.sh excludes it).
- Services: `evemining-api` (uvicorn 127.0.0.1:8010, 2 workers), `evemining-worker`.
- Postgres 16 (shared): role/db `evemining` (prod), `evemining_dev` (dev/demo data). Redis/Valkey db **5**, keys prefixed `strata:`.
- Caddy: `mining.tovdc.com` block appended to `/etc/caddy/Caddyfile`. The file hosts other sites: append/edit only our block, back it up, `caddy validate` before `systemctl reload caddy`.
- SSO app credentials live in `.sso` (git-ignored).

## Conventions

- Stats SQL: add new aggregations as `SELECT … FROM enriched` via `stats._rows`; the price basis column is interpolated only from the `buy`/`sell` whitelist.
- Ore classes are `asteroid | moon | ice | gas | other`; the class colours (`--c-*`) are a validated categorical palette in fixed order. Use them for class identity only, and keep text in ink tokens, never series colours.
- UI copy: sentence case, plain verbs, no all-caps labels, no `·`-joined meta strings.
