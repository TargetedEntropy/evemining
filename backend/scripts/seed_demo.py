"""Dev only: create a demo account with a fleet of fake alts and months of plausible ledger data.

    python -m scripts.seed_demo            # creates/refreshes the demo user, prints a session cookie
    python -m scripts.seed_demo --remove   # deletes it

Never run against production.
"""

import argparse
import asyncio
import random
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, select

from app.database import SessionLocal
from app.models import Character, LedgerEntry, SdeSystem, SdeType, User
from app.security import create_session_token, encrypt

DEMO_BASE_ID = 9_000_000_000
NAMES = [
    "Oskar Venn", "Maerin Tal", "Kessa Ruun", "Joric Aldane", "Ilse Varrow", "Teo Brask",
    "Senna Holt", "Dray Kovan", "Arla Metsu", "Pim Okonkwo", "Rhys Tannor", "Vey Lintu",
    "Hadra Sol", "Nils Oduya",
]
SYSTEMS = ["Osmon", "Hek", "Dodixie", "Amamake", "Vard", "Otela", "Tama"]
BELT_ORES = ["Veldspar", "Scordite", "Pyroxeres", "Plagioclase", "Kernite", "Omber", "Jaspet", "Hemorphite"]
MOON_ORES = ["Zeolites", "Sylvite", "Bitumens", "Coesite", "Cobaltite", "Euxenite", "Otavite"]
ICE = ["Clear Icicle", "White Glaze", "Glacial Mass"]


async def main(remove: bool) -> None:
    async with SessionLocal() as db:
        await db.execute(delete(User).where(User.id.in_(
            select(Character.user_id).where(Character.character_id >= DEMO_BASE_ID)
        )))
        await db.commit()
        if remove:
            print("Demo user removed")
            return

        types = {t.name: t for t in (await db.execute(select(SdeType))).scalars()}
        systems = {s.name: s for s in (await db.execute(select(SdeSystem).where(SdeSystem.name.in_(SYSTEMS)))).scalars()}

        user = User(primary_character_id=DEMO_BASE_ID, is_admin=True)
        db.add(user)
        await db.flush()

        rng = random.Random(7)
        today = datetime.now(UTC).date()
        rows = []
        for i, name in enumerate(NAMES):
            cid = DEMO_BASE_ID + i
            db.add(Character(
                character_id=cid, user_id=user.id, name=name, owner_hash=f"demo{i}",
                corporation_name="Deep Core Collective" if i < 10 else "Hollow Rock Industries",
                alliance_name="Outer Ring Consortium" if i < 10 else None,
                refresh_token_enc=encrypt("demo"), scopes="esi-industry.read_character_mining.v1",
                token_valid=i != 11, last_error="Access was revoked or expired. Log this character in again." if i == 11 else None,
                last_synced_at=datetime.now(UTC) - timedelta(minutes=rng.randint(2, 40)),
                next_sync_at=datetime.now(UTC) + timedelta(days=3650),
            ))
            role = "ice" if i in (3, 8) else "moon" if i % 3 == 0 else "belt"
            start = today - timedelta(days=rng.randint(60, 200))
            d = start
            while d <= today:
                weekend = d.weekday() >= 5
                if rng.random() < (0.75 if weekend else 0.5) and not (i == 11 and d > today - timedelta(days=20)):
                    sysname = rng.choice(SYSTEMS[:3] if role != "moon" else SYSTEMS[3:])
                    if sysname not in systems:
                        d += timedelta(days=1)
                        continue
                    pool = ICE if role == "ice" else MOON_ORES if role == "moon" else BELT_ORES
                    for ore in rng.sample(pool, k=rng.randint(1, min(3, len(pool)))):
                        t = types.get(ore)
                        if not t:
                            continue
                        m3 = rng.uniform(4000, 28000) * (1.4 if weekend else 1)
                        rows.append({
                            "character_id": cid, "date": d, "solar_system_id": systems[sysname].system_id,
                            "type_id": t.type_id, "quantity": max(1, int(m3 / t.volume)),
                        })
                d += timedelta(days=1)
        await db.flush()
        for j in range(0, len(rows), 2000):
            await db.execute(LedgerEntry.__table__.insert(), rows[j : j + 2000])
        await db.commit()
        print(f"Demo user {user.id}: {len(NAMES)} alts, {len(rows)} ledger rows")
        print(f"strata_session={create_session_token(user.id)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--remove", action="store_true")
    asyncio.run(main(ap.parse_args().remove))
