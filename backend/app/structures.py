"""Structure finder: public Upwell structures and NPC stations, ranked for reprocessing.

What comes from where:
  SDE   stargate graph (jumps), system security, NPC station efficiency/tax/services,
        structure hull refining bonus and whether it can fit a reprocessing facility,
        rig yields and their security multipliers.
  ESI   the list of public structures (+ market / manufacturing flags), each one's
        name/owner/system/type, and per-character docking access (403 = not allowed).
  Users rigs, tax and whether reprocessing is actually online. ESI exposes none of it.
"""

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import esi
from app.config import STRUCTURE_SCOPE
from app.models import Character, SdeStargate, SdeSystem, Structure, StructureAccess
from app.security import decrypt, encrypt

log = logging.getLogger(__name__)

# From SDE dogma (Standup reprocessing rigs, all sizes): refiningYieldMultiplier by tier,
# and hi/low/nullSecModifier. The security multiplier only applies when a rig is fitted.
RIG_YIELD = {0: 0.50, 1: 0.51, 2: 0.53}
RIG_SEC_MODIFIER = {"high": 1.00, "low": 1.06, "null": 1.12}
ACCESS_TTL = timedelta(hours=24)


def sec_band(security: float) -> str:
    if security >= 0.45:
        return "high"
    if security > 0.0:
        return "low"
    return "null"


def structure_yield(refining_bonus: float, security: float, rig_tier: int) -> float:
    """Structure part of the reprocessing formula, before skills and implant."""
    sec_mod = RIG_SEC_MODIFIER[sec_band(security)] if rig_tier else 1.0
    return RIG_YIELD[rig_tier] * sec_mod * (1 + refining_bonus)


# ───────────── Jump graph (SDE, cached per process) ─────────────


@dataclass
class Universe:
    adjacency: dict[int, list[int]]
    security: dict[int, float]
    loaded_at: float


_universe: Universe | None = None


async def universe(db: AsyncSession) -> Universe:
    global _universe
    if _universe and time.monotonic() - _universe.loaded_at < 86400:
        return _universe
    adjacency: dict[int, list[int]] = {}
    for a, b in (await db.execute(select(SdeStargate.from_system_id, SdeStargate.to_system_id))).all():
        adjacency.setdefault(a, []).append(b)
    security = dict((await db.execute(select(SdeSystem.system_id, SdeSystem.security))).all())
    _universe = Universe(adjacency, security, time.monotonic())
    return _universe


def jumps_from(u: Universe, origin: int, max_jumps: int, highsec_only: bool) -> dict[int, int]:
    """Breadth-first distances. With highsec_only the route never leaves high-sec
    (the origin itself may be anywhere, so you can start from a low-sec belt)."""
    dist = {origin: 0}
    queue = deque([origin])
    while queue:
        sys = queue.popleft()
        d = dist[sys]
        if d >= max_jumps:
            continue
        for nxt in u.adjacency.get(sys, ()):
            if nxt in dist:
                continue
            if highsec_only and u.security.get(nxt, -1) < 0.45:
                continue
            dist[nxt] = d + 1
            queue.append(nxt)
    return dist


# ───────────── Tokens ─────────────

_access_tokens: dict[int, tuple[float, str]] = {}


async def access_token(db: AsyncSession, char: Character) -> str | None:
    """Short-lived ESI token for a character, cached in-process. None if access was revoked."""
    cached = _access_tokens.get(char.character_id)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    try:
        tokens = await esi.refresh(decrypt(char.refresh_token_enc))
    except esi.TokenRevoked:
        char.token_valid = False
        char.last_error = "Access was revoked or expired. Log this character in again."
        await db.commit()
        return None
    char.refresh_token_enc = encrypt(tokens["refresh_token"])
    await db.commit()
    _access_tokens[char.character_id] = (time.monotonic() + tokens.get("expires_in", 1200) - 60, tokens["access_token"])
    return tokens["access_token"]


def has_structure_scope(char: Character) -> bool:
    return char.token_valid and STRUCTURE_SCOPE in (char.scopes or "").split()


# ───────────── Public structure list (worker) ─────────────


async def refresh_public_structures(db: AsyncSession, resolve_limit: int = 1500) -> dict:
    """Sync the public list, then resolve unknown or stale structures with any authorised token."""
    now = datetime.now(UTC)
    all_ids = set(await esi.public_structure_ids())
    market = set(await esi.public_structure_ids("market"))
    manufacturing = set(await esi.public_structure_ids("manufacturing_basic"))

    if all_ids:
        rows = [
            {"structure_id": sid, "has_market": sid in market, "has_manufacturing": sid in manufacturing,
             "is_public": True, "last_listed": now}
            for sid in all_ids
        ]
        for i in range(0, len(rows), 2000):
            stmt = insert(Structure).values(rows[i : i + 2000])
            await db.execute(
                stmt.on_conflict_do_update(
                    index_elements=["structure_id"],
                    set_={c: stmt.excluded[c] for c in ("has_market", "has_manufacturing", "is_public", "last_listed")},
                )
            )
        await db.execute(update(Structure).where(Structure.structure_id.not_in(all_ids)).values(is_public=False))
        await db.commit()

    resolvers = [c for c in (await db.execute(select(Character))).scalars() if has_structure_scope(c)]
    if not resolvers:
        return {"listed": len(all_ids), "resolved": 0, "note": "no character with structure access yet"}

    stale = now - timedelta(days=7)
    todo = list(
        (
            await db.execute(
                select(Structure.structure_id)
                .where(Structure.is_public.is_(True))
                .where((Structure.resolved_at.is_(None)) | (Structure.resolved_at < stale))
                .order_by(Structure.resolved_at.nulls_first())
                .limit(resolve_limit)
            )
        ).scalars()
    )
    resolved = await resolve_structures(db, todo, resolvers)
    return {"listed": len(all_ids), "resolved": resolved}


async def resolve_structures(db: AsyncSession, structure_ids: list[int], resolvers: list[Character]) -> int:
    if not structure_ids:
        return 0
    tokens = [t for t in [await access_token(db, c) for c in resolvers] if t]
    if not tokens:
        return 0
    sem = asyncio.Semaphore(6)
    results: dict[int, tuple[int, dict | None]] = {}

    async def one(i: int, sid: int):
        async with sem:
            # Try each resolver in turn; a 403 for one character can succeed for another.
            for k in range(len(tokens)):
                status, body = await esi.structure(sid, tokens[(i + k) % len(tokens)])
                if status != 403:
                    break
            results[sid] = (status, body)

    await asyncio.gather(*(one(i, sid) for i, sid in enumerate(structure_ids)))

    owners = await esi.names([b["owner_id"] for s, b in results.values() if b])
    now = datetime.now(UTC)
    ok = 0
    for sid, (status, body) in results.items():
        values: dict = {"resolved_at": now, "resolve_status": status}
        if body:
            ok += 1
            values |= {
                "name": body.get("name"),
                "owner_id": body.get("owner_id"),
                "owner_name": owners.get(body.get("owner_id")),
                "system_id": body.get("solar_system_id"),
                "type_id": body.get("type_id"),
            }
        await db.execute(update(Structure).where(Structure.structure_id == sid).values(**values))
    await db.commit()
    return ok


# ───────────── Docking access (per user, on demand) ─────────────


async def check_access(db: AsyncSession, chars: list[Character], structure_ids: list[int]) -> dict[int, dict[int, bool]]:
    """{structure_id: {character_id: allowed}} using cached answers younger than a day."""
    chars = [c for c in chars if has_structure_scope(c)]
    if not chars or not structure_ids:
        return {}
    fresh_after = datetime.now(UTC) - ACCESS_TTL
    cached = (
        await db.execute(
            select(StructureAccess).where(
                StructureAccess.character_id.in_([c.character_id for c in chars]),
                StructureAccess.structure_id.in_(structure_ids),
                StructureAccess.checked_at > fresh_after,
            )
        )
    ).scalars()
    out: dict[int, dict[int, bool]] = {}
    for a in cached:
        out.setdefault(a.structure_id, {})[a.character_id] = a.allowed

    sem = asyncio.Semaphore(6)
    rows = []

    async def one(char: Character, token: str, sid: int):
        async with sem:
            status, _ = await esi.structure(sid, token)
        if status in (200, 403):
            out.setdefault(sid, {})[char.character_id] = status == 200
            rows.append({"character_id": char.character_id, "structure_id": sid, "allowed": status == 200,
                         "checked_at": datetime.now(UTC)})

    jobs = []
    for char in chars:
        missing = [sid for sid in structure_ids if char.character_id not in out.get(sid, {})]
        if not missing:
            continue
        token = await access_token(db, char)
        if token:
            jobs += [one(char, token, sid) for sid in missing]
    await asyncio.gather(*jobs)

    if rows:
        stmt = insert(StructureAccess).values(rows)
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=["character_id", "structure_id"],
                set_={"allowed": stmt.excluded.allowed, "checked_at": stmt.excluded.checked_at},
            )
        )
        await db.commit()
    return out


# ───────────── Search ─────────────

LATEST_REPORTS = """
    SELECT structure_id,
        (ARRAY_AGG(has_reprocessing ORDER BY created_at DESC) FILTER (WHERE has_reprocessing IS NOT NULL))[1] AS has_reprocessing,
        (ARRAY_AGG(rig_tier ORDER BY created_at DESC) FILTER (WHERE rig_tier IS NOT NULL))[1] AS rig_tier,
        (ARRAY_AGG(tax ORDER BY created_at DESC) FILTER (WHERE tax IS NOT NULL))[1] AS tax,
        MAX(created_at) AS reported_at,
        (ARRAY_AGG(reporter_name ORDER BY created_at DESC))[1] AS reporter,
        COUNT(*) AS reports
    FROM structure_reports
    WHERE structure_id = ANY(:ids)
    GROUP BY structure_id
"""


@dataclass
class SearchParams:
    systems: dict[int, int | None]  # system_id -> jumps (None when searching by region)
    service: str  # reprocessing | market | manufacturing | any
    include_stations: bool
    include_unconfirmed: bool  # citadels/ECs that could fit reprocessing but nobody has confirmed


async def search(db: AsyncSession, p: SearchParams) -> list[dict]:
    system_ids = list(p.systems)
    if not system_ids:
        return []
    info = {
        r.system_id: r
        for r in (
            await db.execute(
                text("""SELECT s.system_id, s.name, s.security, r.name AS region
                        FROM sde_systems s LEFT JOIN sde_regions r ON r.region_id = s.region_id
                        WHERE s.system_id = ANY(:ids)"""),
                {"ids": system_ids},
            )
        )
    }
    results: list[dict] = []

    structures = (
        await db.execute(
            text("""SELECT st.structure_id, st.name, st.owner_id, st.owner_name, st.system_id, st.type_id,
                           st.has_market, st.has_manufacturing, t.name AS type_name, t.group_name,
                           COALESCE(t.refining_bonus, 0) AS refining_bonus, COALESCE(t.can_reprocess, false) AS can_reprocess
                    FROM structures st LEFT JOIN sde_structure_types t ON t.type_id = st.type_id
                    WHERE st.is_public AND st.system_id = ANY(:ids)"""),
            {"ids": system_ids},
        )
    ).all()
    reports = {
        r.structure_id: r
        for r in await db.execute(text(LATEST_REPORTS), {"ids": [s.structure_id for s in structures]})
    }

    for s in structures:
        sysinfo = info.get(s.system_id)
        if sysinfo is None:
            continue
        rep = reports.get(s.structure_id)
        reprocessing = _structure_reprocessing(s, sysinfo.security, rep)
        if p.service == "market" and not s.has_market:
            continue
        if p.service == "manufacturing" and not s.has_manufacturing:
            continue
        if p.service == "reprocessing":
            if reprocessing["status"] in ("none", "impossible"):
                continue
            if reprocessing["status"] == "possible" and not p.include_unconfirmed:
                continue
        results.append(
            {
                "kind": "structure",
                "id": s.structure_id,
                "name": s.name,
                "type_id": s.type_id,
                "type_name": s.type_name,
                "group_name": s.group_name,
                "owner_id": s.owner_id,
                "owner_name": s.owner_name,
                "system_id": s.system_id,
                "system_name": sysinfo.name,
                "security": sysinfo.security,
                "region": sysinfo.region,
                "jumps": p.systems[s.system_id],
                "has_market": s.has_market,
                "has_manufacturing": s.has_manufacturing,
                "reprocessing": reprocessing,
                "report": (
                    {"reported_at": rep.reported_at, "reporter": rep.reporter, "reports": rep.reports} if rep else None
                ),
            }
        )

    if p.include_stations and p.service in ("reprocessing", "any"):
        stations = await db.execute(
            text("""SELECT station_id, name, system_id, type_id, owner_id, owner_name, has_reprocessing,
                           reprocessing_efficiency, reprocessing_tax
                    FROM sde_stations WHERE system_id = ANY(:ids)"""),
            {"ids": system_ids},
        )
        for st in stations:
            if p.service == "reprocessing" and not st.has_reprocessing:
                continue
            sysinfo = info[st.system_id]
            results.append(
                {
                    "kind": "station",
                    "id": st.station_id,
                    "name": st.name,
                    "type_id": st.type_id,
                    "type_name": "NPC station",
                    "group_name": "NPC station",
                    "owner_id": st.owner_id,
                    "owner_name": st.owner_name,
                    "system_id": st.system_id,
                    "system_name": sysinfo.name,
                    "security": sysinfo.security,
                    "region": sysinfo.region,
                    "jumps": p.systems[st.system_id],
                    "has_market": None,
                    "has_manufacturing": None,
                    "reprocessing": {
                        "status": "npc" if st.has_reprocessing else "none",
                        "yield_min": st.reprocessing_efficiency,
                        "yield_max": st.reprocessing_efficiency,
                        "rig_tier": None,
                        # Standings lower this; the SDE value is the no-standings rate.
                        "tax": st.reprocessing_tax,
                        "tax_source": "sde",
                    },
                    "report": None,
                }
            )
    return results


def _structure_reprocessing(s, security: float, rep) -> dict:
    """Status + yield range for one structure, narrowed by any user report."""
    bonus = s.refining_bonus
    if s.type_id is None:
        status = "unknown"
    elif not s.can_reprocess:
        status = "impossible"
    elif rep is not None and rep.has_reprocessing is not None:
        status = "confirmed" if rep.has_reprocessing else "none"
    elif s.group_name == "Refinery":
        status = "likely"  # refineries exist to reprocess and almost always run the service
    else:
        status = "possible"

    rig = rep.rig_tier if rep is not None else None
    lo = structure_yield(bonus, security, rig if rig is not None else 0)
    hi = structure_yield(bonus, security, rig if rig is not None else 2)
    return {
        "status": status,
        "yield_min": lo,
        "yield_max": hi,
        "rig_tier": rig,
        "tax": rep.tax if rep is not None else None,
        "tax_source": "report" if rep is not None and rep.tax is not None else None,
    }


def net_yield(r: dict) -> float:
    """Best-case yield after tax: the upper yield bound, less known tax (unknown counts as 0)."""
    rp = r["reprocessing"]
    return rp["yield_max"] * (1 - (rp["tax"] or 0))


SORTS = {
    "best": lambda r: (-net_yield(r), r["jumps"] if r["jumps"] is not None else 99),
    "jumps": lambda r: (r["jumps"] if r["jumps"] is not None else 99, -net_yield(r)),
    "yield": lambda r: (-r["reprocessing"]["yield_max"], r["jumps"] or 0),
    "tax": lambda r: (r["reprocessing"]["tax"] if r["reprocessing"]["tax"] is not None else 9, r["jumps"] or 0),
}
