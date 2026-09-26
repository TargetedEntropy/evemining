import os
from types import SimpleNamespace

from cryptography.fernet import Fernet

os.environ.setdefault("EVE_CLIENT_ID", "x")
os.environ.setdefault("EVE_CLIENT_SECRET", "x")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")

from app.structures import SORTS, Universe, _structure_reprocessing, jumps_from, net_yield, sec_band, structure_yield  # noqa: E402


def test_known_yields():
    # Tatara, T2 rig, null-sec, max skills and 4% implant: the widely quoted 90.6%.
    assert round(structure_yield(0.055, -0.4, 2) * 1.15 * 1.1 * 1.1 * 1.04, 3) == 0.906
    # No rig: security does not matter, only the hull bonus.
    assert structure_yield(0.02, -0.4, 0) == structure_yield(0.02, 0.9, 0) == 0.5 * 1.02
    assert round(structure_yield(0.0, 0.3, 1), 4) == round(0.51 * 1.06, 4)


def test_sec_band_matches_game_rounding():
    assert sec_band(0.45) == "high"  # displays as 0.5
    assert sec_band(0.44) == "low"
    assert sec_band(0.01) == "low"  # displays as 0.1
    assert sec_band(0.0) == "null"


def test_jumps_and_highsec_routing():
    # A - B - C is the short way through low-sec B; A - D - E - C stays in high-sec.
    adj = {1: [2, 4], 2: [1, 3], 3: [2, 5], 4: [1, 5], 5: [4, 3]}
    sec = {1: 0.9, 2: 0.3, 3: 0.8, 4: 0.7, 5: 0.6}
    u = Universe(adj, sec, 0)
    assert jumps_from(u, 1, 10, False)[3] == 2
    assert jumps_from(u, 1, 10, True)[3] == 3
    assert 2 not in jumps_from(u, 1, 10, True)
    assert jumps_from(u, 1, 1, False) == {1: 0, 2: 1, 4: 1}


def _row(group, can, bonus=0.0, type_id=1):
    return SimpleNamespace(group_name=group, can_reprocess=can, refining_bonus=bonus, type_id=type_id)


def test_reprocessing_status_and_reports():
    athanor = _row("Refinery", True, 0.02)
    unreported = _structure_reprocessing(athanor, 0.8, None)
    assert unreported["status"] == "likely" and unreported["yield_min"] < unreported["yield_max"]

    rep = SimpleNamespace(has_reprocessing=True, rig_tier=2, tax=0.05)
    reported = _structure_reprocessing(athanor, 0.8, rep)
    assert reported["status"] == "confirmed" and reported["yield_min"] == reported["yield_max"] and reported["tax"] == 0.05

    assert _structure_reprocessing(_row("Citadel", True), 0.8, None)["status"] == "possible"
    assert _structure_reprocessing(_row("Laboratory", False), 0.8, None)["status"] == "impossible"
    no = SimpleNamespace(has_reprocessing=False, rig_tier=None, tax=None)
    assert _structure_reprocessing(_row("Citadel", True), 0.8, no)["status"] == "none"


def test_best_sort_prefers_what_you_keep():
    def r(y, tax, jumps):
        return {"reprocessing": {"yield_max": y, "tax": tax}, "jumps": jumps}

    cheap_far, pricey_near = r(0.54, 0.0, 9), r(0.56, 0.10, 1)
    assert net_yield(cheap_far) > net_yield(pricey_near)
    assert sorted([pricey_near, cheap_far], key=SORTS["best"])[0] is cheap_far
    assert sorted([cheap_far, pricey_near], key=SORTS["jumps"])[0] is pricey_near
