"""Jita price snapshots for every mined ore and everything it refines into."""

import logging
from datetime import UTC, datetime

from sqlalchemy import select, union
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import esi
from app.config import get_settings
from app.models import LedgerEntry, Price, SdeType, SdeTypeMaterial

log = logging.getLogger(__name__)

FUZZWORK_URL = "https://market.fuzzwork.co.uk/aggregates/"


async def priced_type_ids(db: AsyncSession) -> list[int]:
    mined = select(LedgerEntry.type_id).distinct()
    # Price every known ore, not only mined ones, so a first sync has values immediately.
    ores = select(SdeType.type_id).where(SdeType.ore_class != "other")
    mats = select(SdeTypeMaterial.material_type_id).where(SdeTypeMaterial.type_id.in_(ores))
    return sorted(set((await db.execute(union(mined, ores, mats))).scalars()))


async def fetch_jita(type_ids: list[int]) -> dict[int, tuple[float, float]]:
    out: dict[int, tuple[float, float]] = {}
    station = get_settings().jita_station_id
    for i in range(0, len(type_ids), 200):
        chunk = type_ids[i : i + 200]
        r = await esi.client().get(FUZZWORK_URL, params={"station": station, "types": ",".join(map(str, chunk))})
        r.raise_for_status()
        for tid, agg in r.json().items():
            # The 5% percentile ignores single troll orders at either end of the book.
            buy = float(agg["buy"]["percentile"] or 0)
            sell = float(agg["sell"]["percentile"] or 0)
            if buy or sell:
                out[int(tid)] = (buy, sell)
    return out


async def fetch_esi_average() -> dict[int, float]:
    r = await esi.esi_get("/markets/prices/")
    if r.status_code != 200:
        return {}
    return {p["type_id"]: p.get("average_price") or p.get("adjusted_price") or 0 for p in r.json()}


async def refresh_prices(db: AsyncSession) -> int:
    type_ids = await priced_type_ids(db)
    if not type_ids:
        return 0
    try:
        prices = await fetch_jita(type_ids)
    except Exception as e:
        log.warning("Fuzzwork price fetch failed: %r", e)
        prices = {}
    missing = [t for t in type_ids if t not in prices]
    if missing:
        avg = await fetch_esi_average()
        for t in missing:
            if avg.get(t):
                prices[t] = (avg[t], avg[t])

    today = datetime.now(UTC).date()
    rows = [{"type_id": t, "date": today, "buy": b, "sell": s} for t, (b, s) in prices.items()]
    for i in range(0, len(rows), 2000):
        stmt = insert(Price).values(rows[i : i + 2000])
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=["type_id", "date"], set_={"buy": stmt.excluded.buy, "sell": stmt.excluded.sell}
            )
        )
    await db.commit()
    return len(rows)
