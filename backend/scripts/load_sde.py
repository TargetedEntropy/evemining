"""Load the slice of CCP's static data export this app needs.

Downloads the official JSONL SDE, then upserts: all groups, all regions and solar
systems, every mineable type (asteroid category, ice, gas) plus everything they
reprocess into, and the reprocessing tables for the mineable types.

    python -m scripts.load_sde [--zip path/to/sde.zip]
"""

import argparse
import asyncio
import io
import json
import zipfile
from pathlib import Path

import httpx
from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.models import SdeGroup, SdeRegion, SdeSystem, SdeType, SdeTypeMaterial
from app.sde import ASTEROID_CATEGORY, GAS_GROUP, ICE_GROUP, classify

SDE_URL = "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip"
CACHE = Path(__file__).resolve().parent.parent / "sde-cache" / "sde.zip"


def jsonl(zf: zipfile.ZipFile, name: str):
    with zf.open(name) as f:
        for line in io.TextIOWrapper(f, encoding="utf-8"):
            if line.strip():
                yield json.loads(line)


def en(value) -> str:
    return value.get("en", "") if isinstance(value, dict) else str(value)


async def upsert(db, model, rows: list[dict], keys: list[str]) -> None:
    for i in range(0, len(rows), 2000):
        chunk = rows[i : i + 2000]
        stmt = insert(model).values(chunk)
        update = {c: stmt.excluded[c] for c in chunk[0] if c not in keys}
        await db.execute(stmt.on_conflict_do_update(index_elements=keys, set_=update) if update else stmt.on_conflict_do_nothing())


async def main(zip_path: Path | None) -> None:
    if zip_path is None:
        zip_path = CACHE
        CACHE.parent.mkdir(exist_ok=True)
        print("Downloading SDE…")
        async with httpx.AsyncClient(follow_redirects=True, timeout=300) as c:
            async with c.stream("GET", SDE_URL) as r:
                r.raise_for_status()
                with open(zip_path, "wb") as f:
                    async for chunk in r.aiter_bytes(1 << 20):
                        f.write(chunk)

    zf = zipfile.ZipFile(zip_path)

    groups = {g["_key"]: g for g in jsonl(zf, "groups.jsonl")}
    mine_groups = {gid for gid, g in groups.items() if g.get("categoryID") == ASTEROID_CATEGORY} | {ICE_GROUP, GAS_GROUP}

    types = {}
    for t in jsonl(zf, "types.jsonl"):
        types[t["_key"]] = (en(t["name"]), t["groupID"], t.get("packagedVolume") or t.get("volume") or 0, t.get("portionSize", 1))
    mineable = {tid for tid, t in types.items() if t[1] in mine_groups}

    materials = []
    for m in jsonl(zf, "typeMaterials.jsonl"):
        if m["_key"] in mineable:
            for mat in m.get("materials", []):
                materials.append({"type_id": m["_key"], "material_type_id": mat["materialTypeID"], "quantity": mat["quantity"]})
    wanted = mineable | {m["material_type_id"] for m in materials}

    type_rows = []
    for tid in wanted:
        if tid not in types:
            continue
        name, gid, vol, portion = types[tid]
        ore_class, rarity = classify(gid, groups.get(gid, {}).get("categoryID"))
        type_rows.append(
            {"type_id": tid, "name": name, "group_id": gid, "volume": vol, "portion_size": portion,
             "ore_class": ore_class, "moon_rarity": rarity}
        )

    regions = [{"region_id": r["_key"], "name": en(r["name"])} for r in jsonl(zf, "mapRegions.jsonl")]
    systems = [
        {"system_id": s["_key"], "name": en(s["name"]), "region_id": s["regionID"], "security": s.get("securityStatus", 0.0)}
        for s in jsonl(zf, "mapSolarSystems.jsonl")
    ]
    group_rows = [{"group_id": gid, "name": en(g["name"]), "category_id": g.get("categoryID", 0)} for gid, g in groups.items()]

    async with SessionLocal() as db:
        await upsert(db, SdeGroup, group_rows, ["group_id"])
        await upsert(db, SdeType, type_rows, ["type_id"])
        await upsert(db, SdeTypeMaterial, materials, ["type_id", "material_type_id"])
        await upsert(db, SdeRegion, regions, ["region_id"])
        await upsert(db, SdeSystem, systems, ["system_id"])
        await db.commit()

    print(f"groups={len(group_rows)} types={len(type_rows)} materials={len(materials)} regions={len(regions)} systems={len(systems)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", type=Path)
    asyncio.run(main(ap.parse_args().zip))
