from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app import structures as S
from app.database import get_db
from app.models import Structure, StructureReport, User
from app.security import get_current_user

router = APIRouter(prefix="/api")

MAX_REGIONS = 25
MAX_JUMPS = 40


@router.get("/universe/systems")
async def systems(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """Every gate-connected system as [id, name, security, region_id] for client-side autocomplete."""
    rows = await db.execute(
        text("""SELECT s.system_id, s.name, round(s.security::numeric, 3), s.region_id
                FROM sde_systems s WHERE EXISTS (SELECT 1 FROM sde_stargates g WHERE g.from_system_id = s.system_id)
                ORDER BY s.name""")
    )
    return [[r[0], r[1], float(r[2]), r[3]] for r in rows]


@router.get("/universe/regions")
async def regions(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    rows = await db.execute(
        text("""SELECT r.region_id, r.name,
                       COUNT(DISTINCT s.system_id) AS systems,
                       COUNT(DISTINCT st.structure_id) FILTER (WHERE st.is_public) AS structures,
                       AVG(s.security) AS avg_security
                FROM sde_regions r
                JOIN sde_systems s ON s.region_id = r.region_id
                JOIN sde_stargates g ON g.from_system_id = s.system_id
                LEFT JOIN structures st ON st.system_id = s.system_id
                GROUP BY r.region_id, r.name ORDER BY r.name""")
    )
    return [dict(r._mapping) for r in rows]


@router.get("/structures/status")
async def status(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    listed, resolved, last = (
        await db.execute(
            select(
                func.count().filter(Structure.is_public),
                func.count().filter(Structure.is_public & Structure.name.is_not(None)),
                func.max(Structure.resolved_at),
            )
        )
    ).one()
    return {
        "listed": listed,
        "resolved": resolved,
        "last_resolved_at": last,
        "checkers": [
            {"character_id": c.character_id, "name": c.name} for c in user.characters if S.has_structure_scope(c)
        ],
    }


@router.get("/structures/search")
async def search(
    origin: int | None = None,
    jumps: int = Query(10, ge=0, le=MAX_JUMPS),
    route: str = Query("shortest", pattern="^(shortest|highsec)$"),
    regions: str | None = None,
    service: str = Query("reprocessing", pattern="^(reprocessing|market|manufacturing|any)$"),
    stations: bool = True,
    unconfirmed: bool = False,
    sort: str = Query("best", pattern="^(best|jumps|yield|tax)$"),
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if origin:
        u = await S.universe(db)
        if origin not in u.security:
            raise HTTPException(404, "Unknown system")
        system_jumps: dict[int, int | None] = dict(S.jumps_from(u, origin, jumps, route == "highsec"))
    elif regions:
        region_ids = [int(x) for x in regions.split(",") if x.strip().isdigit()][:MAX_REGIONS]
        ids = (
            await db.execute(text("SELECT system_id FROM sde_systems WHERE region_id = ANY(:r)"), {"r": region_ids})
        ).scalars()
        system_jumps = {sid: None for sid in ids}
    else:
        raise HTTPException(400, "Pick a system or at least one region")

    results = await S.search(
        db, S.SearchParams(systems=system_jumps, service=service, include_stations=stations, include_unconfirmed=unconfirmed)
    )
    results.sort(key=S.SORTS[sort])
    for r in results:
        r["net_yield_max"] = S.net_yield(r)
    kinds = {"structures": sum(r["kind"] == "structure" for r in results), "stations": sum(r["kind"] == "station" for r in results)}
    return {"systems_searched": len(system_jumps), "total": len(results), "counts": kinds, "results": results[:limit]}


class AccessIn(BaseModel):
    structure_ids: list[int] = Field(max_length=60)


@router.post("/structures/access")
async def access(body: AccessIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ids = [i for i in body.structure_ids if i > 100_000_000]  # structures, not NPC stations
    result = await S.check_access(db, list(user.characters), ids)
    return {str(k): {str(c): v for c, v in chars.items()} for k, chars in result.items()}


class ReportIn(BaseModel):
    has_reprocessing: bool | None = None
    rig_tier: int | None = Field(None, ge=0, le=2)
    tax: float | None = Field(None, ge=0, le=1)


@router.post("/structures/{structure_id}/reports")
async def report(structure_id: int, body: ReportIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if not await db.get(Structure, structure_id):
        raise HTTPException(404, "Structure not found")
    if body.has_reprocessing is None and body.rig_tier is None and body.tax is None:
        raise HTTPException(400, "Nothing to report")
    recent = await db.execute(
        select(func.count()).where(
            StructureReport.structure_id == structure_id,
            StructureReport.user_id == user.id,
            StructureReport.created_at > datetime.now(UTC) - timedelta(minutes=10),
        )
    )
    if recent.scalar():
        raise HTTPException(429, "You reported this structure a moment ago. Try again in a few minutes.")
    primary = next((c.name for c in user.characters if c.character_id == user.primary_character_id), None)
    db.add(StructureReport(structure_id=structure_id, user_id=user.id, reporter_name=primary, **body.model_dump()))
    await db.commit()
    return {"ok": True}
