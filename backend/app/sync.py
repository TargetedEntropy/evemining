"""Pull each character's mining ledger from ESI into the long-term history table."""

import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import esi, sde
from app.config import get_settings
from app.models import Character, LedgerEntry
from app.security import decrypt, encrypt

log = logging.getLogger(__name__)


async def sync_character(db: AsyncSession, char: Character) -> int:
    """Refresh the token, fetch the ledger and upsert it. Returns rows written."""
    now = datetime.now(UTC)
    interval = timedelta(minutes=get_settings().ledger_sync_minutes)
    try:
        tokens = await esi.refresh(decrypt(char.refresh_token_enc))
        # SSO may rotate the refresh token; always keep the newest one.
        char.refresh_token_enc = encrypt(tokens["refresh_token"])
        rows = await esi.mining_ledger(char.character_id, tokens["access_token"])
    except esi.TokenRevoked as e:
        char.token_valid = False
        char.last_error = "Access was revoked or expired. Log this character in again."
        char.next_sync_at = now + timedelta(days=1)
        log.info("Token revoked for %s: %s", char.name, e)
        await db.commit()
        return 0
    except Exception as e:  # network, ESI outage — retry sooner
        char.last_error = f"Sync failed: {e.__class__.__name__}"
        char.next_sync_at = now + timedelta(minutes=10)
        log.warning("Sync failed for %s: %r", char.name, e)
        await db.commit()
        return 0

    written = await store_ledger(db, char.character_id, rows)
    char.token_valid = True
    char.last_error = None
    char.last_synced_at = now
    char.next_sync_at = now + interval
    await db.commit()
    return written


async def store_ledger(db: AsyncSession, character_id: int, rows: list[dict]) -> int:
    if not rows:
        return 0
    await sde.ensure_types(db, {r["type_id"] for r in rows})
    await sde.ensure_systems(db, {r["solar_system_id"] for r in rows})
    values = [
        {
            "character_id": character_id,
            "date": date.fromisoformat(r["date"]),
            "solar_system_id": r["solar_system_id"],
            "type_id": r["type_id"],
            "quantity": r["quantity"],
        }
        for r in rows
    ]
    stmt = insert(LedgerEntry).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["character_id", "date", "solar_system_id", "type_id"],
        set_={"quantity": stmt.excluded.quantity, "updated_at": func.now()},
        where=LedgerEntry.quantity != stmt.excluded.quantity,
    )
    await db.execute(stmt)
    return len(values)


async def due_characters(db: AsyncSession, limit: int = 50) -> list[Character]:
    q = (
        select(Character)
        .where(Character.token_valid.is_(True), Character.next_sync_at <= func.now())
        .order_by(Character.next_sync_at)
        .limit(limit)
    )
    return list((await db.execute(q)).scalars())


async def refresh_affiliations(db: AsyncSession) -> None:
    chars = list((await db.execute(select(Character))).scalars())
    if not chars:
        return
    aff = await esi.affiliations([c.character_id for c in chars])
    ids = {v.get("corporation_id") for v in aff.values()} | {v.get("alliance_id") for v in aff.values()}
    names = await esi.names([i for i in ids if i])
    for c in chars:
        a = aff.get(c.character_id)
        if not a:
            continue
        c.corporation_id = a.get("corporation_id")
        c.corporation_name = names.get(c.corporation_id)
        c.alliance_id = a.get("alliance_id")
        c.alliance_name = names.get(c.alliance_id) if c.alliance_id else None
    await db.commit()
