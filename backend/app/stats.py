"""Aggregations over a user's mining history.

Every query is built on one CTE (`enriched`) that joins ledger rows with ore
metadata and three valuations per row:

  value       quantity at today's Jita price (the user's chosen buy/sell basis)
  value_then  quantity at the Jita price on the day it was mined (nearest snapshot)
  refined     quantity reprocessed at the user's yield, minerals at today's price
"""

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


@dataclass
class Scope:
    user: User
    start: date
    end: date
    character_ids: list[int] | None = None

    @property
    def basis(self) -> str:
        # Interpolated into SQL, so only ever one of two literals.
        return "sell" if self.user.price_basis == "sell" else "buy"

    def params(self, start: date | None = None, end: date | None = None) -> dict:
        return {
            "user_id": self.user.id,
            "start": start or self.start,
            "end": end or self.end,
            "yield": self.user.reprocess_yield,
            "chars": self.character_ids,
        }


def _enriched(basis: str) -> str:
    return f"""
    WITH latest AS (
        SELECT DISTINCT ON (type_id) type_id, {basis} AS price
        FROM prices ORDER BY type_id, date DESC
    ),
    refine AS (
        SELECT tm.type_id, SUM(tm.quantity * lp.price) / MAX(t.portion_size) AS unit_value
        FROM sde_type_materials tm
        JOIN latest lp ON lp.type_id = tm.material_type_id
        JOIN sde_types t ON t.type_id = tm.type_id
        GROUP BY tm.type_id
    ),
    enriched AS (
        SELECT l.character_id, l.date, l.solar_system_id, l.type_id, l.quantity,
               t.name AS type_name, COALESCE(t.ore_class, 'other') AS ore_class, t.moon_rarity,
               l.quantity * COALESCE(t.volume, 0) AS m3,
               l.quantity * COALESCE(lp.price, 0) AS value,
               l.quantity * COALESCE(pt.price, lp.price, 0) AS value_then,
               CASE WHEN rf.unit_value IS NULL THEN l.quantity * COALESCE(lp.price, 0)
                    ELSE l.quantity * rf.unit_value * :yield END AS refined
        FROM mining_ledger l
        JOIN characters c ON c.character_id = l.character_id
        LEFT JOIN sde_types t ON t.type_id = l.type_id
        LEFT JOIN latest lp ON lp.type_id = l.type_id
        LEFT JOIN refine rf ON rf.type_id = l.type_id
        LEFT JOIN LATERAL (
            SELECT p.{basis} AS price FROM prices p
            WHERE p.type_id = l.type_id
            ORDER BY (p.date > l.date), abs(p.date - l.date)
            LIMIT 1
        ) pt ON true
        WHERE c.user_id = :user_id
          AND l.date BETWEEN :start AND :end
          AND (CAST(:chars AS bigint[]) IS NULL OR l.character_id = ANY(CAST(:chars AS bigint[])))
    )
    """


async def _rows(db: AsyncSession, scope: Scope, select_sql: str, **extra) -> list[dict]:
    params = scope.params(extra.pop("start", None), extra.pop("end", None)) | extra
    result = await db.execute(text(_enriched(scope.basis) + select_sql), params)
    return [dict(r._mapping) for r in result]


TOTALS = """
    SELECT COALESCE(SUM(quantity), 0) AS units,
           COALESCE(SUM(m3), 0) AS m3,
           COALESCE(SUM(value), 0) AS value,
           COALESCE(SUM(value_then), 0) AS value_then,
           COALESCE(SUM(refined), 0) AS refined,
           COUNT(DISTINCT date) AS active_days,
           COUNT(DISTINCT character_id) AS active_characters,
           COUNT(DISTINCT solar_system_id) AS systems
    FROM enriched
"""


async def summary(db: AsyncSession, scope: Scope) -> dict:
    totals = (await _rows(db, scope, TOTALS))[0]
    span = (scope.end - scope.start).days + 1
    prev_end = scope.start - timedelta(days=1)
    previous = (await _rows(db, scope, TOTALS, start=prev_end - timedelta(days=span - 1), end=prev_end))[0]

    by_class = await _rows(
        db,
        scope,
        """SELECT ore_class, SUM(m3) AS m3, SUM(value) AS value, SUM(refined) AS refined
           FROM enriched GROUP BY ore_class ORDER BY SUM(m3) DESC""",
    )
    best = await _rows(
        db,
        scope,
        """SELECT date, SUM(m3) AS m3, SUM(value) AS value, COUNT(DISTINCT character_id) AS characters
           FROM enriched GROUP BY date ORDER BY SUM(value) DESC LIMIT 1""",
    )
    return {
        "start": scope.start,
        "end": scope.end,
        "days": span,
        "totals": totals,
        "previous": previous,
        "by_class": by_class,
        "best_day": best[0] if best else None,
        "character_count": len(scope.user.characters),
        "price_basis": scope.basis,
        "reprocess_yield": scope.user.reprocess_yield,
    }


async def daily(db: AsyncSession, scope: Scope) -> list[dict]:
    return await _rows(
        db,
        scope,
        """SELECT date, ore_class, SUM(quantity) AS units, SUM(m3) AS m3, SUM(value) AS value,
                  COUNT(DISTINCT character_id) AS characters
           FROM enriched GROUP BY date, ore_class ORDER BY date""",
    )


async def characters(db: AsyncSession, scope: Scope) -> list[dict]:
    rows = await _rows(
        db,
        scope,
        """SELECT character_id, SUM(quantity) AS units, SUM(m3) AS m3, SUM(value) AS value,
                  SUM(refined) AS refined, COUNT(DISTINCT date) AS active_days, MAX(date) AS last_mined,
                  (ARRAY_AGG(type_name ORDER BY m3 DESC))[1] AS top_ore
           FROM enriched GROUP BY character_id""",
    )
    series = await _rows(
        db, scope, "SELECT character_id, date, SUM(m3) AS m3 FROM enriched GROUP BY character_id, date ORDER BY date"
    )
    ever = await db.execute(
        text("SELECT character_id, MAX(date) AS d FROM mining_ledger WHERE character_id = ANY(:ids) GROUP BY character_id"),
        {"ids": [c.character_id for c in scope.user.characters]},
    )
    last_ever = {r.character_id: r.d for r in ever}

    by_id = {r["character_id"]: r for r in rows}
    spark: dict[int, dict[date, float]] = {}
    for s in series:
        spark.setdefault(s["character_id"], {})[s["date"]] = s["m3"]

    out = []
    for c in scope.user.characters:
        if scope.character_ids and c.character_id not in scope.character_ids:
            continue
        r = by_id.get(c.character_id, {})
        out.append(
            {
                "character_id": c.character_id,
                "name": c.name,
                "corporation_name": c.corporation_name,
                "alliance_name": c.alliance_name,
                "token_valid": c.token_valid,
                "last_synced_at": c.last_synced_at,
                "last_error": c.last_error,
                "units": r.get("units", 0),
                "m3": r.get("m3", 0),
                "value": r.get("value", 0),
                "refined": r.get("refined", 0),
                "active_days": r.get("active_days", 0),
                "last_mined": last_ever.get(c.character_id),
                "top_ore": r.get("top_ore"),
                "daily": [
                    spark.get(c.character_id, {}).get(scope.start + timedelta(days=i), 0)
                    for i in range((scope.end - scope.start).days + 1)
                ],
            }
        )
    out.sort(key=lambda x: x["value"], reverse=True)
    return out


async def ores(db: AsyncSession, scope: Scope) -> list[dict]:
    return await _rows(
        db,
        scope,
        """SELECT type_id, type_name, ore_class, moon_rarity, SUM(quantity) AS units, SUM(m3) AS m3,
                  SUM(value) AS value, SUM(value_then) AS value_then, SUM(refined) AS refined,
                  COUNT(DISTINCT character_id) AS characters
           FROM enriched GROUP BY type_id, type_name, ore_class, moon_rarity ORDER BY SUM(value) DESC""",
    )


async def systems(db: AsyncSession, scope: Scope) -> list[dict]:
    return await _rows(
        db,
        scope,
        """SELECT e.solar_system_id AS system_id, s.name, s.security, r.name AS region,
                  SUM(e.m3) AS m3, SUM(e.value) AS value, COUNT(DISTINCT e.date) AS active_days,
                  COUNT(DISTINCT e.character_id) AS characters, MAX(e.date) AS last_mined
           FROM enriched e
           LEFT JOIN sde_systems s ON s.system_id = e.solar_system_id
           LEFT JOIN sde_regions r ON r.region_id = s.region_id
           GROUP BY e.solar_system_id, s.name, s.security, r.name ORDER BY SUM(e.value) DESC""",
    )


async def minerals(db: AsyncSession, scope: Scope) -> list[dict]:
    """What the ore becomes if refined at the user's yield."""
    return await _rows(
        db,
        scope,
        f"""SELECT tm.material_type_id AS type_id, mt.name,
                   SUM(e.quantity::float / t.portion_size * tm.quantity * :yield) AS quantity,
                   SUM(e.quantity::float / t.portion_size * tm.quantity * :yield) * MAX(lp.price) AS value
            FROM enriched e
            JOIN sde_types t ON t.type_id = e.type_id
            JOIN sde_type_materials tm ON tm.type_id = e.type_id
            LEFT JOIN sde_types mt ON mt.type_id = tm.material_type_id
            LEFT JOIN latest lp ON lp.type_id = tm.material_type_id
            GROUP BY tm.material_type_id, mt.name
            ORDER BY 4 DESC NULLS LAST""",
    )


async def calendar(db: AsyncSession, scope: Scope) -> list[dict]:
    return await _rows(
        db,
        scope,
        """SELECT date, SUM(m3) AS m3, SUM(value) AS value, COUNT(DISTINCT character_id) AS characters
           FROM enriched GROUP BY date ORDER BY date""",
    )
