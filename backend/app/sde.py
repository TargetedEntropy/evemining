"""Static data: ore classification and lazy fill-in for types/systems missing from the SDE load."""

import logging

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import esi
from app.models import SdeGroup, SdeRegion, SdeSystem, SdeType

log = logging.getLogger(__name__)

ASTEROID_CATEGORY = 25
ICE_GROUP = 465
GAS_GROUP = 711
MOON_GROUPS = {1884: 4, 1920: 8, 1921: 16, 1922: 32, 1923: 64}


def classify(group_id: int, category_id: int | None) -> tuple[str, int | None]:
    if group_id in MOON_GROUPS:
        return "moon", MOON_GROUPS[group_id]
    if group_id == ICE_GROUP:
        return "ice", None
    if group_id == GAS_GROUP:
        return "gas", None
    if category_id == ASTEROID_CATEGORY:
        return "asteroid", None
    return "other", None


async def ensure_types(db: AsyncSession, type_ids: set[int]) -> None:
    """Make sure every mined type has a row; fetch unknown ones (new ores) from ESI."""
    if not type_ids:
        return
    known = set((await db.execute(select(SdeType.type_id).where(SdeType.type_id.in_(type_ids)))).scalars())
    for type_id in type_ids - known:
        info = await esi.type_info(type_id)
        if not info:
            continue
        group = await db.get(SdeGroup, info["group_id"])
        ore_class, rarity = classify(info["group_id"], group.category_id if group else ASTEROID_CATEGORY)
        await db.execute(
            insert(SdeType)
            .values(
                type_id=type_id,
                name=info["name"],
                group_id=info["group_id"],
                volume=info.get("packaged_volume") or info.get("volume") or 0,
                portion_size=info.get("portion_size", 1),
                ore_class=ore_class,
                moon_rarity=rarity,
            )
            .on_conflict_do_nothing()
        )
        log.info("Added type %s (%s) from ESI", type_id, info["name"])


async def ensure_systems(db: AsyncSession, system_ids: set[int]) -> None:
    if not system_ids:
        return
    known = set((await db.execute(select(SdeSystem.system_id).where(SdeSystem.system_id.in_(system_ids)))).scalars())
    for system_id in system_ids - known:
        info = await esi.system_info(system_id)
        if not info:
            continue
        region_id = 0
        r = await esi.esi_get(f"/universe/constellations/{info['constellation_id']}/")
        if r.status_code == 200:
            region_id = r.json()["region_id"]
            if not await db.get(SdeRegion, region_id):
                region_names = await esi.names([region_id])
                await db.execute(
                    insert(SdeRegion)
                    .values(region_id=region_id, name=region_names.get(region_id, str(region_id)))
                    .on_conflict_do_nothing()
                )
        await db.execute(
            insert(SdeSystem)
            .values(system_id=system_id, name=info["name"], region_id=region_id, security=info["security_status"])
            .on_conflict_do_nothing()
        )
