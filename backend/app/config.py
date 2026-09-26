from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# Only the mining ledger. Keeping the scope list minimal is a feature: people are
# handing us 5-20 alts each and should not have to trust us with wallets or assets.
SCOPES = ["esi-industry.read_character_mining.v1"]
# Opt-in, granted per character from the Structures page: lets Strata resolve public
# structures and check whether that character is allowed to dock at them.
STRUCTURE_SCOPE = "esi-universe.read_structures.v1"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    eve_client_id: str
    eve_client_secret: str
    eve_callback_url: str = "https://mining.tovdc.com/auth/callback"
    eve_authorize_url: str = "https://login.eveonline.com/v2/oauth/authorize"
    eve_token_url: str = "https://login.eveonline.com/v2/oauth/token"
    eve_jwks_url: str = "https://login.eveonline.com/oauth/jwks"
    esi_base_url: str = "https://esi.evetech.net/latest"
    user_agent: str = "Strata mining tracker (mining.tovdc.com)"

    secret_key: str
    token_encryption_key: str  # Fernet key for ESI refresh tokens at rest
    session_expire_hours: int = 24 * 30
    secure_cookies: bool = True

    database_url: str
    redis_url: str = "redis://localhost:6379/5"

    frontend_url: str = "https://mining.tovdc.com"

    # Worker cadence
    ledger_sync_minutes: int = 30
    price_refresh_minutes: int = 60
    jita_station_id: int = 60003760


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
