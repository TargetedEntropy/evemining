from app.models import Character, User


def character_payload(c: Character) -> dict:
    return {
        "character_id": c.character_id,
        "name": c.name,
        "corporation_id": c.corporation_id,
        "corporation_name": c.corporation_name,
        "alliance_id": c.alliance_id,
        "alliance_name": c.alliance_name,
        "token_valid": c.token_valid,
        "last_synced_at": c.last_synced_at,
        "last_error": c.last_error,
        "created_at": c.created_at,
    }


def user_payload(u: User) -> dict:
    return {
        "id": u.id,
        "is_admin": u.is_admin,
        "primary_character_id": u.primary_character_id,
        "reprocess_yield": u.reprocess_yield,
        "price_basis": u.price_basis,
        "characters": [character_payload(c) for c in u.characters],
    }
