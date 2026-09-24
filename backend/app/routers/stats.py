from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app import stats
from app.database import get_db
from app.models import User
from app.security import get_current_user

router = APIRouter(prefix="/api/stats")


def scope(
    start: date | None = None,
    end: date | None = None,
    characters: str | None = Query(None, description="Comma-separated character ids"),
    user: User = Depends(get_current_user),
) -> stats.Scope:
    today = datetime.now(UTC).date()
    end = min(end or today, today)
    start = start or end - timedelta(days=29)
    if start > end:
        raise HTTPException(400, "start must be before end")
    if (end - start).days > 3660:
        raise HTTPException(400, "Range is limited to ten years")
    ids = None
    if characters:
        owned = {c.character_id for c in user.characters}
        ids = [int(x) for x in characters.split(",") if x.strip().isdigit() and int(x) in owned] or None
    return stats.Scope(user=user, start=start, end=end, character_ids=ids)


@router.get("/summary")
async def summary(s: stats.Scope = Depends(scope), db: AsyncSession = Depends(get_db)):
    return await stats.summary(db, s)


@router.get("/daily")
async def daily(s: stats.Scope = Depends(scope), db: AsyncSession = Depends(get_db)):
    return await stats.daily(db, s)


@router.get("/characters")
async def characters(s: stats.Scope = Depends(scope), db: AsyncSession = Depends(get_db)):
    return await stats.characters(db, s)


@router.get("/ores")
async def ores(s: stats.Scope = Depends(scope), db: AsyncSession = Depends(get_db)):
    return await stats.ores(db, s)


@router.get("/systems")
async def systems(s: stats.Scope = Depends(scope), db: AsyncSession = Depends(get_db)):
    return await stats.systems(db, s)


@router.get("/minerals")
async def minerals(s: stats.Scope = Depends(scope), db: AsyncSession = Depends(get_db)):
    return await stats.minerals(db, s)


@router.get("/calendar")
async def calendar(s: stats.Scope = Depends(scope), db: AsyncSession = Depends(get_db)):
    return await stats.calendar(db, s)
