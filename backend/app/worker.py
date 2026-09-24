"""Background worker: ledger sync, price snapshots, affiliation refresh.

Runs as its own systemd service so API workers stay stateless:
    python -m app.worker
"""

import asyncio
import logging
import time

from app import pricing, sync
from app.config import get_settings
from app.database import SessionLocal

log = logging.getLogger("strata.worker")


async def run_forever() -> None:
    s = get_settings()
    last_prices = 0.0
    last_affiliations = 0.0
    while True:
        try:
            async with SessionLocal() as db:
                if time.monotonic() - last_prices > s.price_refresh_minutes * 60 or last_prices == 0:
                    n = await pricing.refresh_prices(db)
                    log.info("Prices refreshed for %d types", n)
                    last_prices = time.monotonic()

                if time.monotonic() - last_affiliations > 6 * 3600 or last_affiliations == 0:
                    await sync.refresh_affiliations(db)
                    last_affiliations = time.monotonic()

                chars = await sync.due_characters(db)
                for char in chars:
                    n = await sync.sync_character(db, char)
                    log.info("Synced %s: %d ledger rows", char.name, n)
        except Exception:
            log.exception("Worker loop error")
        await asyncio.sleep(30)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    asyncio.run(run_forever())


if __name__ == "__main__":
    main()
