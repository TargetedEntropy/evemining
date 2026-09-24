from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Character, User
from app.routers.auth import _sync_now
from app.schemas import user_payload
from app.security import get_current_user

router = APIRouter(prefix="/api")


async def _owned(db: AsyncSession, user: User, character_id: int) -> Character:
    char = await db.get(Character, character_id)
    if char is None or char.user_id != user.id:
        raise HTTPException(404, "Character not found on your account")
    return char


@router.post("/characters/{character_id}/primary")
async def set_primary(character_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _owned(db, user, character_id)
    user.primary_character_id = character_id
    await db.commit()
    return user_payload(user)


@router.post("/characters/{character_id}/sync")
async def sync_now(
    character_id: int,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    char = await _owned(db, user, character_id)
    if char.last_synced_at and datetime.now(UTC) - char.last_synced_at < timedelta(minutes=5):
        # ESI caches the ledger for a while; hammering it gains nothing.
        return {"queued": False}
    background.add_task(_sync_now, character_id)
    return {"queued": True}


@router.delete("/characters/{character_id}")
async def remove(character_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    char = await _owned(db, user, character_id)
    if len(user.characters) <= 1:
        raise HTTPException(400, "This is your only character. Delete your account from settings instead.")
    await db.delete(char)
    await db.flush()
    if user.primary_character_id == character_id:
        user.primary_character_id = next(c.character_id for c in user.characters if c.character_id != character_id)
    await db.commit()
    await db.refresh(user, ["characters"])
    return user_payload(user)


class SettingsIn(BaseModel):
    reprocess_yield: float = Field(ge=0.5, le=0.95)
    price_basis: str = Field(pattern="^(buy|sell)$")


@router.put("/settings")
async def update_settings(body: SettingsIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    user.reprocess_yield = body.reprocess_yield
    user.price_basis = body.price_basis
    await db.commit()
    return user_payload(user)


@router.delete("/account")
async def delete_account(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await db.delete(user)
    await db.commit()
    return {"ok": True}
