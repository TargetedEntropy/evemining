import logging
import secrets
from datetime import UTC, datetime
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import esi
from app.config import SCOPES, STRUCTURE_SCOPE, get_settings
from app.database import SessionLocal, get_db
from app.models import Character, LedgerEntry, User
from app.schemas import user_payload
from app.security import (
    OAUTH_STATE_PREFIX,
    OAUTH_STATE_TTL,
    SESSION_COOKIE,
    blacklist_session,
    create_session_token,
    decode_session_token,
    encrypt,
    get_current_user,
    session_user_id,
)
from app.structures import refresh_public_structures
from app.sync import sync_character

log = logging.getLogger(__name__)
router = APIRouter()


def _fail(reason: str, page: str = "/") -> RedirectResponse:
    key = "login_error" if page == "/" else "error"
    return RedirectResponse(f"{page}?{key}={quote(reason)}", status_code=302)


@router.get("/auth/login")
async def login(request: Request, grant: str | None = None, strata_session: str | None = Cookie(None)):
    """Send the browser to EVE SSO. If already signed in, the character becomes an alt.

    grant=structures additionally asks for structure lookup (opt-in, per character).
    """
    user_id = await session_user_id(request, strata_session)
    wants_structures = grant == "structures" and user_id is not None
    state = secrets.token_urlsafe(32)
    await request.app.state.redis.setex(
        f"{OAUTH_STATE_PREFIX}{state}", OAUTH_STATE_TTL, f"{user_id or 0}|{'structures' if wants_structures else ''}"
    )
    extra = [STRUCTURE_SCOPE] if wants_structures else None
    return RedirectResponse(esi.authorize_url(state, extra), status_code=302)


async def _resolve_structures() -> None:
    async with SessionLocal() as db:
        await refresh_public_structures(db)


async def _sync_now(character_id: int) -> None:
    async with SessionLocal() as db:
        char = await db.get(Character, character_id)
        if char:
            await sync_character(db, char)


@router.get("/auth/callback")
async def callback(
    request: Request,
    background: BackgroundTasks,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    if error or not code or not state:
        return _fail("EVE login was cancelled.")
    stored = await request.app.state.redis.getdel(f"{OAUTH_STATE_PREFIX}{state}")
    if stored is None:
        return _fail("That login link expired. Try again.")
    uid, _, grant = stored.partition("|")
    session_user = int(uid) or None
    back = "/structures" if grant == "structures" else "/alts" if session_user else "/"

    try:
        tokens = await esi.exchange_code(code)
        info = await esi.verify_access_token(tokens["access_token"])
    except Exception:
        log.exception("SSO exchange failed")
        return _fail("EVE SSO did not accept the login. Try again in a minute.", back)

    missing = set(SCOPES) - set(info["scopes"])
    if missing:
        return _fail("The mining ledger permission was not granted.", back)
    if grant == "structures" and STRUCTURE_SCOPE not in info["scopes"]:
        return _fail(
            "EVE did not grant structure lookup. The site admin needs to enable "
            "esi-universe.read_structures.v1 on the EVE developer application.",
            back,
        )

    user = await db.get(User, session_user) if session_user else None
    char = await db.get(Character, info["character_id"])
    added = False

    if char is not None:
        if char.owner_hash != info["owner"]:
            # The character was transferred to another EVE account: the previous
            # owner's history is not the new owner's to see.
            await db.execute(delete(LedgerEntry).where(LedgerEntry.character_id == char.character_id))
            old_user_id = char.user_id
            char.user_id = user.id if user else (await _new_user(db, char.character_id)).id
            await _cleanup_user(db, old_user_id)
        elif user and char.user_id != user.id:
            old_user_id = char.user_id
            char.user_id = user.id
            await _cleanup_user(db, old_user_id)
        char.name = info["name"]
        char.owner_hash = info["owner"]
        char.refresh_token_enc = encrypt(tokens["refresh_token"])
        char.scopes = " ".join(info["scopes"])
        char.token_valid = True
        char.last_error = None
        char.next_sync_at = datetime.now(UTC)
    else:
        if user is None:
            user = await _new_user(db, info["character_id"])
        added = True
        char = Character(
            character_id=info["character_id"],
            user_id=user.id,
            name=info["name"],
            owner_hash=info["owner"],
            refresh_token_enc=encrypt(tokens["refresh_token"]),
            scopes=" ".join(info["scopes"]),
            next_sync_at=datetime.now(UTC),
        )
        db.add(char)

    await db.flush()
    owner = await db.get(User, char.user_id)
    if owner.primary_character_id is None:
        owner.primary_character_id = char.character_id
    await db.commit()

    aff = await esi.affiliations([char.character_id])
    if a := aff.get(char.character_id):
        names = await esi.names([a.get("corporation_id"), a.get("alliance_id")])
        char.corporation_id = a.get("corporation_id")
        char.corporation_name = names.get(char.corporation_id)
        char.alliance_id = a.get("alliance_id")
        char.alliance_name = names.get(char.alliance_id) if char.alliance_id else None
        await db.commit()

    background.add_task(_sync_now, char.character_id)
    if grant == "structures":
        background.add_task(_resolve_structures)

    if grant == "structures":
        target = "/structures?granted=1"
    else:
        target = f"/alts?{'added' if added else 'updated'}={char.character_id}" if session_user else "/"
    response = RedirectResponse(target, status_code=302)
    response.set_cookie(
        SESSION_COOKIE,
        create_session_token(owner.id),
        httponly=True,
        secure=get_settings().secure_cookies,
        samesite="lax",
        max_age=get_settings().session_expire_hours * 3600,
    )
    return response


async def _new_user(db: AsyncSession, primary_character_id: int) -> User:
    first = (await db.execute(select(User.id).limit(1))).first() is None
    user = User(primary_character_id=primary_character_id, is_admin=first)  # first account runs the place
    db.add(user)
    await db.flush()
    return user


async def _cleanup_user(db: AsyncSession, user_id: int) -> None:
    """After a character moves away, drop an empty account or repoint its primary."""
    await db.flush()
    remaining = list(
        (await db.execute(select(Character.character_id).where(Character.user_id == user_id))).scalars()
    )
    user = await db.get(User, user_id)
    if user is None:
        return
    if not remaining:
        await db.delete(user)
    elif user.primary_character_id not in remaining:
        user.primary_character_id = remaining[0]


@router.get("/api/auth/me")
async def me(user: User = Depends(get_current_user)):
    return user_payload(user)


@router.post("/api/auth/logout")
async def logout(request: Request, strata_session: str | None = Cookie(None)):
    if strata_session and (data := decode_session_token(strata_session)):
        await blacklist_session(request.app.state.redis, *data)
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE)
    return response
