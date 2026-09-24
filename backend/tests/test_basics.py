import os

from cryptography.fernet import Fernet

os.environ.setdefault("EVE_CLIENT_ID", "x")
os.environ.setdefault("EVE_CLIENT_SECRET", "x")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")

from app.esi import authorize_url  # noqa: E402
from app.sde import classify  # noqa: E402
from app.security import create_session_token, decode_session_token, decrypt, encrypt  # noqa: E402


def test_classify():
    assert classify(462, 25) == ("asteroid", None)  # Veldspar
    assert classify(1884, 25) == ("moon", 4)
    assert classify(1923, 25) == ("moon", 64)
    assert classify(465, 25) == ("ice", None)
    assert classify(711, 2) == ("gas", None)
    assert classify(18, 4) == ("other", None)  # minerals


def test_session_roundtrip():
    user_id, jti = decode_session_token(create_session_token(42))
    assert user_id == 42 and jti
    assert decode_session_token("garbage") is None


def test_token_encryption():
    assert decrypt(encrypt("refresh-token")) == "refresh-token"


def test_authorize_url_has_only_mining_scope():
    url = authorize_url("abc")
    assert "esi-industry.read_character_mining.v1" in url
    assert "wallet" not in url and "state=abc" in url
