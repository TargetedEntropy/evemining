"""Thin clients for EVE SSO and ESI."""

import asyncio
import logging
import time
from urllib.parse import urlencode

import httpx
import jwt

from app.config import SCOPES, get_settings

log = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None
_jwks: tuple[float, dict] | None = None


class TokenRevoked(Exception):
    """The refresh token no longer works; the user has to log the character in again."""


class ESIError(Exception):
    pass


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0),
            headers={"User-Agent": get_settings().user_agent, "Accept": "application/json"},
        )
    return _client


def authorize_url(state: str) -> str:
    s = get_settings()
    params = {
        "response_type": "code",
        "redirect_uri": s.eve_callback_url,
        "client_id": s.eve_client_id,
        "scope": " ".join(SCOPES),
        "state": state,
    }
    return f"{s.eve_authorize_url}?{urlencode(params)}"


async def _token_request(data: dict) -> dict:
    s = get_settings()
    r = await client().post(
        s.eve_token_url,
        data=data,
        auth=(s.eve_client_id, s.eve_client_secret),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Host": "login.eveonline.com"},
    )
    if r.status_code in (400, 401) and data.get("grant_type") == "refresh_token":
        raise TokenRevoked(r.text[:200])
    r.raise_for_status()
    return r.json()


async def exchange_code(code: str) -> dict:
    return await _token_request({"grant_type": "authorization_code", "code": code})


async def refresh(refresh_token: str) -> dict:
    return await _token_request({"grant_type": "refresh_token", "refresh_token": refresh_token})


async def _jwks_keys() -> dict:
    global _jwks
    if _jwks and time.monotonic() - _jwks[0] < 3600:
        return _jwks[1]
    r = await client().get(get_settings().eve_jwks_url)
    r.raise_for_status()
    _jwks = (time.monotonic(), r.json())
    return _jwks[1]


async def verify_access_token(access_token: str) -> dict:
    """Verify the SSO JWT and return character_id, name, owner hash and scopes."""
    header = jwt.get_unverified_header(access_token)
    keys = await _jwks_keys()
    key_data = next((k for k in keys.get("keys", []) if k.get("kid") == header.get("kid")), None)
    if key_data is None:
        raise ValueError("SSO signing key not found")
    key = jwt.PyJWK(key_data).key
    payload = jwt.decode(
        access_token,
        key,
        algorithms=["RS256"],
        audience=[get_settings().eve_client_id, "EVE Online"],
        options={"verify_iss": False},
    )
    if payload.get("iss") not in ("login.eveonline.com", "https://login.eveonline.com"):
        raise ValueError("Unexpected token issuer")
    scopes = payload.get("scp", [])
    if isinstance(scopes, str):
        scopes = [scopes]
    return {
        "character_id": int(payload["sub"].split(":")[2]),
        "name": payload.get("name", "Unknown"),
        "owner": payload.get("owner", ""),
        "scopes": scopes,
    }


async def esi_get(path: str, token: str | None = None, params: dict | None = None) -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    url = f"{get_settings().esi_base_url}{path}"
    for attempt in range(3):
        r = await client().get(url, headers=headers, params=params)
        remain = int(r.headers.get("X-ESI-Error-Limit-Remain", "100"))
        if remain < 20:
            reset = int(r.headers.get("X-ESI-Error-Limit-Reset", "30"))
            log.warning("ESI error budget low (%s); sleeping %ss", remain, reset)
            await asyncio.sleep(reset)
        if r.status_code in (502, 503, 504) and attempt < 2:
            await asyncio.sleep(2 * (attempt + 1))
            continue
        return r
    return r


async def mining_ledger(character_id: int, token: str) -> list[dict]:
    rows: list[dict] = []
    page, pages = 1, 1
    while page <= pages:
        r = await esi_get(f"/characters/{character_id}/mining/", token, {"page": page})
        if r.status_code == 403:
            raise TokenRevoked("Missing mining ledger scope")
        if r.status_code != 200:
            raise ESIError(f"Mining ledger HTTP {r.status_code}: {r.text[:200]}")
        rows.extend(r.json())
        pages = int(r.headers.get("X-Pages", "1"))
        page += 1
    return rows


async def affiliations(character_ids: list[int]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for i in range(0, len(character_ids), 1000):
        chunk = character_ids[i : i + 1000]
        r = await client().post(f"{get_settings().esi_base_url}/characters/affiliation/", json=chunk)
        if r.status_code == 200:
            for a in r.json():
                out[a["character_id"]] = a
    return out


async def names(ids: list[int]) -> dict[int, str]:
    out: dict[int, str] = {}
    ids = list({i for i in ids if i})
    for i in range(0, len(ids), 1000):
        r = await client().post(f"{get_settings().esi_base_url}/universe/names/", json=ids[i : i + 1000])
        if r.status_code == 200:
            out.update({n["id"]: n["name"] for n in r.json()})
    return out


async def type_info(type_id: int) -> dict | None:
    r = await esi_get(f"/universe/types/{type_id}/")
    return r.json() if r.status_code == 200 else None


async def system_info(system_id: int) -> dict | None:
    r = await esi_get(f"/universe/systems/{system_id}/")
    return r.json() if r.status_code == 200 else None
