# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Strata** (mining.tovdc.com): a multi-user EVE Online mining tracker. Each user links many alts (5–20 is normal) via EVE SSO; a worker pulls every alt's ESI mining ledger into Postgres so history outlives ESI's 30-day window, and the UI shows totals, per-alt/ore/system breakdowns, Jita valuation, and refined-mineral value. A structure finder ranks public Upwell structures and NPC stations for reprocessing (and market/manufacturing) by distance, yield, and tax.

Repo: `git@github.com:TargetedEntropy/evemining.git` (branch `main`).

Auth follows `../EVE_SSO_AUTH_GUIDE.md` (JWT session cookie, Redis OAuth state + logout blacklist) with these deliberate differences:
- One required ESI scope: `esi-industry.read_character_mining.v1` (`app/config.py:SCOPES`). Don't add scopes casually; users trust us with many alts.
- `/auth/login` is a plain 302 (no JSON step). If a session exists, its user id is stored in the OAuth state and the new character becomes an alt.
- The SSO callback is registered as `https://mining.tovdc.com/auth/callback` (not under `/api`), so Caddy proxies `/auth/*` as well as `/api/*`.
- Refresh tokens are Fernet-encrypted at rest (`TOKEN_ENCRYPTION_KEY`); access tokens are never stored.
- If a character's `owner_hash` changes (character transfer), its ledger history is deleted before re-linking.
- The first account ever created becomes admin.
- Optional second scope `esi-universe.read_structures.v1` (`STRUCTURE_SCOPE`), requested only via `/auth/login?grant=structures` from the Structures page. The OAuth state carries `"<user_id>|structures"`. It must also be enabled on the EVE developer application.

## Layout

```
backend/            FastAPI + async SQLAlchemy + asyncpg (Python 3.12)
  app/config.py     settings (.env), SCOPES
  app/models.py     all tables (users, characters, mining_ledger, prices, sde_*, audit_logs)
  app/esi.py        SSO token exchange/refresh, JWT verify via JWKS, ESI GETs with error-budget backoff
  app/sync.py       per-character ledger sync (upsert; ESI quantities are daily running totals → overwrite, not add)
  app/pricing.py    hourly Jita snapshot (Fuzzwork aggregates, 5% percentile; ESI average price fallback)
  app/stats.py      every stats query builds on one `enriched` CTE (value now / value on mining day / refined value)
  app/worker.py     separate process: prices hourly, affiliations + public structures 6-hourly, due ledgers every 30 s tick
  app/sde.py        ore classification + lazy fill of unknown types/systems from ESI
  app/structures.py structure finder: SDE jump graph (BFS, optional high-sec-only), yield formula,
                    public-structure resolution, per-alt docking checks (ESI 403 = no access), search
  app/routers/      auth (SSO, /auth/*), characters (+ settings, account), stats, structures (+ /api/universe/*), admin
  scripts/load_sde.py   loads the needed slice of CCP's official JSONL SDE (ores, materials, systems, gates,
                        NPC stations, structure hulls); idempotent upserts
  scripts/seed_demo.py  DEV ONLY: fake 14-alt account, months of ledger data, demo structures; prints a session cookie
  tests/                pure unit tests (no DB needed): auth helpers, ore classification, yield math, routing, sorting
frontend/           React 18 + Vite + TS, react-query, d3-scale/shape (hand-drawn SVG charts), plain CSS
  src/styles.css    design tokens (dark "basalt" default + light), all component styles
  src/lib/hooks.ts  range / alt filter / measure live in the URL (?range=90d&alts=1,2&by=m3)
  src/components/charts.tsx  StrataBand, DailyChart, CalendarHeat, Sparkline
  src/components/Pickers.tsx SystemPicker (autocomplete combobox) and RegionPicker (filterable multi-select)
  src/components/SortTable.tsx, Sec.tsx (in-game security colours), Portrait.tsx
  src/pages/        Overview, Alts, Ores, Systems, Refining, Structures, Settings, Admin, Landing
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
# deploy.sh does NOT reload static data. After changing load_sde.py or adding sde_* tables:
ssh root@mining.tovdc.com 'cd /opt/evemining/backend && .venv/bin/python -m scripts.load_sde'
```

Local dev has no Docker access; develop against the server's Postgres/Valkey through an SSH tunnel:
`ssh -f -N -L 55432:127.0.0.1:5432 -L 56379:127.0.0.1:6379 root@mining.tovdc.com` and use the `evemining_dev` database (`backend/.env`, `SECURE_COOKIES=false`). Seed it with `scripts.seed_demo` and set the printed `strata_session` cookie on localhost:5173. Never run `seed_demo` against the `evemining` (prod) database. Kill the tunnel when done.

UI changes: screenshot with Playwright (desktop dark/light and a 390px phone) and check `document.documentElement.scrollWidth` stays at the viewport width on every page.

## Production (root@mining.tovdc.com, shared host)

- Code: `/opt/evemining/{backend,frontend/dist}`; secrets in `/opt/evemining/backend/.env` (never overwrite it; deploy.sh excludes it).
- Services: `evemining-api` (uvicorn 127.0.0.1:8010, 2 workers), `evemining-worker`.
- Postgres 16 (shared): role/db `evemining` (prod), `evemining_dev` (dev/demo data). Redis/Valkey db **5**, keys prefixed `strata:`.
- Caddy: `mining.tovdc.com` block appended to `/etc/caddy/Caddyfile`. The file hosts other sites: append/edit only our block, back it up, `caddy validate` before `systemctl reload caddy`.
- SSO app credentials live in `.sso` (git-ignored).

## Structure finder

- Static (SDE, via `scripts/load_sde.py`): `sde_stargates`, `sde_stations` (NPC reprocessing efficiency, tax, and whether the station operation has the Reprocessing Plant service), `sde_structure_types` (rig size, `strRefiningYieldBonus`, and whether the hull group can fit Standup Reprocessing Facility I).
- Yield = rig yield (0.50/0.51/0.53) × rig security modifier (1.00/1.06/1.12, only when rigged) × (1 + hull bonus) × the user's skill multiplier. `tests/test_structures.py` pins this to the known 90.6% Tatara case.
- ESI gives only the public structure list (with market/manufacturing flags) and each structure's name/owner/system/type. Services, rigs and tax are not in ESI: they come from `structure_reports` submitted by users. Unreported structures show a yield range and "tax unknown".
- "Best" sort = upper-bound yield × (1 − known tax, unknown counts as 0), then jumps.
- The worker lists public structures every 6 h and resolves new or stale ones (older than 7 days) with any character holding the scope. A grant also triggers an immediate resolve. Docking access is checked per alt on demand and cached for 24 h in `structure_access`.
- Search is server-side: `GET /api/structures/search` (origin+jumps+route or regions, service, stations, unconfirmed, sort, limit ≤ 500). The page shows 25 rows at a time. All finder state lives in the URL (`/structures?origin=…&jumps=…`); the mining range/alt filter row is hidden there and its query string is not carried across.
- `POST /api/structures/access` accepts at most 60 IDs per call. Every 403 counts against ESI's error budget, so keep checks to the rows on screen.
- `/api/universe/systems` ships every gate-connected system to the client once (`staleTime: Infinity`) for instant autocomplete.
- Dev: `scripts.seed_demo` also creates fake "Demo" structures with IDs ≥ 9.1e12 and a few reports.

## Conventions

- Stats SQL: add new aggregations as `SELECT … FROM enriched` via `stats._rows`; the price basis column is interpolated only from the `buy`/`sell` whitelist.
- Ore classes are `asteroid | moon | ice | gas | other`; the class colours (`--c-*`) are a validated categorical palette in fixed order. Use them for class identity only, and keep text in ink tokens, never series colours.
- UI copy: sentence case, plain verbs, no all-caps labels, no `·`-joined meta strings.
- Tables go in `.table-wrap` (it is `position: relative` so visually-hidden captions can't widen the page). Hide secondary columns with `.hide-sm` on phones and fold key info into the first cell with `.show-sm`.
- Grids/flex rows holding wide controls need `minmax(0, 1fr)` / `min-width: 0`, or they overflow on phones.
