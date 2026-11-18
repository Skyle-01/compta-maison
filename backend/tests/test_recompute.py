import pytest

from app.core import recompute
from app.core.recompute import recompute_all
from app.db import connect
from tests.conftest import import_rows


def _state(db) -> list[tuple]:
    with connect(db) as conn:
        return conn.execute(
            "SELECT libelle, budget_month, kind, transfer_group_id, category_id FROM transactions ORDER BY id"
        ).fetchall()


def test_failing_step_leaves_no_half_applied_recompute(seeded_db, monkeypatch):
    # The salary (28 May, an income anchor) pays for June, and the PERSO -> LIVRET pair is a transfer:
    # the first two steps change rows, the third (rules) fails.
    import_rows(
        seeded_db,
        ("2026-05-28", "2026-05-28", "VIR EMPLOYEUR", 0, 2000, "PERSO"),
        ("2026-06-02", "2026-06-02", "VIR vers LIVRET", 300, 0, "PERSO"),
        ("2026-06-02", "2026-06-02", "VIR de COMPTE", 0, 300, "LIVRET"),
    )
    imported = _state(seeded_db)

    def boom(conn):
        raise RuntimeError("rules step failed")

    monkeypatch.setattr(recompute, "apply_rules_in", boom)
    with pytest.raises(RuntimeError):
        recompute_all(seeded_db)

    assert _state(seeded_db) == imported  # imported rows kept, nothing of steps 1-2 applied

    monkeypatch.undo()
    recompute_all(seeded_db)
    assert _state(seeded_db) != imported  # the steps do change these rows when they all run
