import secrets
from datetime import UTC, datetime, timedelta

import jwt
from cryptography.fernet import Fernet
from fastapi import Cookie, Depends, HTTPException, Request, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import User

SESSION_COOKIE = "strata_session"
ALGORITHM = "HS256"
BLACKLIST_PREFIX = "strata:session_blacklist:"
OAUTH_STATE_PREFIX = "strata:oauth_state:"
OAUTH_STATE_TTL = 600

_fernet: Fernet | None = None


def fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(get_settings().token_encryption_key.encode())
    return _fernet


def encrypt(value: str) -> str:
    return fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    return fernet().decrypt(value.encode()).decode()


def create_session_token(user_id: int) -> str:
    s = get_settings()
    payload = {
        "sub": str(user_id),
        "jti": secrets.token_urlsafe(16),
        "exp": datetime.now(UTC) + timedelta(hours=s.session_expire_hours),
        "type": "session",
    }
    return jwt.encode(payload, s.secret_key, algorithm=ALGORITHM)


def decode_session_token(token: str) -> tuple[int, str] | None:
    try:
        payload = jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "session":
        return None
    return int(payload["sub"]), payload.get("jti", "")


async def blacklist_session(redis: Redis, user_id: int, jti: str) -> None:
    await redis.setex(f"{BLACKLIST_PREFIX}{user_id}:{jti}", get_settings().session_expire_hours * 3600, "1")


async def session_user_id(request: Request, token: str | None) -> int | None:
    """Resolve a session cookie to a user id, honouring logout revocation."""
    if not token:
        return None
    data = decode_session_token(token)
    if not data:
        return None
    user_id, jti = data
    if jti and await request.app.state.redis.exists(f"{BLACKLIST_PREFIX}{user_id}:{jti}"):
        return None
    return user_id


async def get_current_user(
    request: Request,
    strata_session: str | None = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    user_id = await session_user_id(request, strata_session)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account no longer exists")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user
