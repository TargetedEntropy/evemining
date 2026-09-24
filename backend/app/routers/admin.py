from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AuditLog, Character, LedgerEntry, User
from app.security import require_admin

router = APIRouter(prefix="/api/admin")


async def _audit(db: AsyncSession, request: Request, admin: User, action: str, target_id: int, details: str) -> None:
    primary = next((c.name for c in admin.characters if c.character_id == admin.primary_character_id), None)
    db.add(
        AuditLog(
            admin_user_id=admin.id,
            admin_character_name=primary,
            action=action,
            target_type="user",
            target_id=target_id,
            details=details,
            ip_address=request.headers.get("x-forwarded-for", request.client.host if request.client else None),
        )
    )


@router.get("/overview")
async def overview(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    users = (await db.execute(select(User).order_by(User.id))).scalars().all()
    ledger_rows = (await db.execute(select(func.count()).select_from(LedgerEntry))).scalar()
    invalid = (await db.execute(select(func.count()).where(Character.token_valid.is_(False)))).scalar()
    logs = (await db.execute(select(AuditLog).order_by(AuditLog.timestamp.desc()).limit(50))).scalars().all()
    return {
        "ledger_rows": ledger_rows,
        "invalid_tokens": invalid,
        "users": [
            {
                "id": u.id,
                "is_admin": u.is_admin,
                "created_at": u.created_at,
                "primary": next((c.name for c in u.characters if c.character_id == u.primary_character_id), None),
                "characters": [
                    {"character_id": c.character_id, "name": c.name, "token_valid": c.token_valid,
                     "last_synced_at": c.last_synced_at}
                    for c in u.characters
                ],
            }
            for u in users
        ],
        "audit": [
            {"timestamp": a.timestamp, "admin": a.admin_character_name, "action": a.action,
             "target_id": a.target_id, "details": a.details}
            for a in logs
        ],
    }


@router.post("/users/{user_id}/toggle-admin")
async def toggle_admin(user_id: int, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(400, "You can't change your own admin status")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.is_admin = not user.is_admin
    await _audit(db, request, admin, "toggle_admin", user_id, f"is_admin → {user.is_admin}")
    await db.commit()
    return {"is_admin": user.is_admin}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(400, "You can't delete your own account here")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    n = len(user.characters)
    await db.delete(user)
    await _audit(db, request, admin, "delete_user", user_id, f"Deleted user with {n} characters")
    await db.commit()
    return {"ok": True}
