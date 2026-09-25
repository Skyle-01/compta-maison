import random

import pytest

from app.core.categorize import income_and_expenses, transfers_summary, uncategorized_balance
from app.core.transfers import (
    Leg,
    effective_markers,
    pair_legs,
    pair_manually,
    recompute_transfers,
    set_transfer_mode,
)
from app.db import connect, import_transactions, replace_transfer_markers


def _import(db, *rows):
    columns = ["Date operation", "Date valeur", "Libelle", "Debit", "Credit", "account"]
    records = [dict(zip(columns, row, strict=True)) for row in rows]
    for record in records:
        record["budget_month"] = record["Date valeur"][:7]
    import_transactions(records, db)


def _kinds(db) -> dict[str, str]:
    with connect(db) as conn:
        return dict(conn.execute("SELECT libelle, kind FROM transactions").fetchall())


class TestRecomputeTransfers:
    def test_pairs_matching_cross_account_legs(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-11", "2026-06-11", "VIR de COMPTE", 0, 500, "LIVRET"),
        )
        assert recompute_transfers(db) == 2
        kinds = _kinds(db)
        assert kinds["VIR vers LIVRET"] == "transfer"
        assert kinds["VIR de COMPTE"] == "transfer"
        with connect(db) as conn:
            groups = [g for (g,) in conn.execute("SELECT transfer_group_id FROM transactions")]
        assert groups[0] is not None and groups[0] == groups[1]

    def test_same_account_not_paired(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "ACHAT", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "REMBOURSEMENT", 0, 500, "PERSO"),
        )
        assert recompute_transfers(db) == 0
        assert _kinds(db) == {"ACHAT": "expense", "REMBOURSEMENT": "income"}

    def test_amount_mismatch_not_paired(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 400, "LIVRET"),
        )
        assert recompute_transfers(db) == 0

    def test_outside_date_window_not_paired(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-20", "2026-06-20", "VIR de COMPTE", 0, 500, "LIVRET"),
        )
        assert recompute_transfers(db) == 0

    def test_transfers_excluded_from_totals_and_balance(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 500, "LIVRET"),
            ("2026-06-12", "2026-06-12", "COURSES", 60, 0, "JOINT"),
        )
        recompute_transfers(db)
        income, expenses = income_and_expenses(db, "2026-06")
        assert income == 0  # the 500 credit is a transfer, not income
        assert expenses == 60  # only the real expense remains
        summary = transfers_summary(db, "2026-06")
        assert summary == {"count": 1, "total": 500.0}
        stats = uncategorized_balance(db, "2026-06")
        assert stats["count"] == 1  # transfers no longer counted as uncategorised residual

    def test_idempotent(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 500, "LIVRET"),
        )
        assert recompute_transfers(db) == 2
        assert recompute_transfers(db) == 2  # stable on re-run


class TestTransferMarkers:
    """Both legs must start with a transfer marker (default 'VIR', case-insensitive)."""

    def test_round_amount_false_positive_not_paired(self, db):
        # 50 € of groceries on the joint account and 50 € refunded by a friend the next day are
        # not an internal transfer, even though amount and dates line up.
        _import(
            db,
            ("2026-06-12", "2026-06-12", "CARTE 12/06 SUPERMARCHE", 50, 0, "JOINT"),
            ("2026-06-13", "2026-06-13", "VIR SEPA RECU /DE AMI", 0, 50, "PERSO"),
        )
        assert recompute_transfers(db) == 0
        assert _kinds(db) == {"CARTE 12/06 SUPERMARCHE": "expense", "VIR SEPA RECU /DE AMI": "income"}

    def test_default_marker_is_case_insensitive_prefix(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "VIREMENT vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "  Vir de COMPTE", 0, 500, "LIVRET"),
            ("2026-06-11", "2026-06-11", "CARTE 11/06 VIRTUO", 30, 0, "PERSO"),
            ("2026-06-11", "2026-06-11", "VIR DE AMI", 0, 30, "JOINT"),
        )
        assert recompute_transfers(db) == 2
        kinds = _kinds(db)
        assert kinds["VIREMENT vers LIVRET"] == kinds["  Vir de COMPTE"] == "transfer"
        assert (kinds["CARTE 11/06 VIRTUO"], kinds["VIR DE AMI"]) == ("expense", "income")

    def test_both_legs_must_match_marker(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VERSEMENT", 0, 500, "LIVRET"),
        )
        assert recompute_transfers(db) == 0
        with connect(db) as conn:
            replace_transfer_markers(conn, ["VIR", "VERSEMENT"])
        assert recompute_transfers(db) == 2

    def test_star_marker_restores_legacy_pairing(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "ACHAT", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "REMBOURSEMENT", 0, 500, "JOINT"),
        )
        assert recompute_transfers(db) == 0
        with connect(db) as conn:
            replace_transfer_markers(conn, ["*"])
        assert recompute_transfers(db) == 2

    def test_effective_markers_default_when_empty(self, db):
        with connect(db) as conn:
            assert effective_markers(conn) == ["VIR"]
            assert replace_transfer_markers(conn, [" X ", "", "X", "Y"]) == ["X", "Y"]
            assert effective_markers(conn) == ["X", "Y"]

    def test_external_savings_deposits_ignore_markers(self, db):
        _import(db, ("2026-06-10", "2026-06-10", "PRLV VERS LIVRET ENFANT", 25, 0, "JOINT"))
        assert recompute_transfers(db) == 1


def _quadratic_reference(debits, credits, window=3):
    """The pre-bisect pairing loop, kept to lock pair_legs' tie-breaking."""
    used, pairs = set(), []
    for debit in debits:
        best = None
        for credit in credits:
            if credit.id in used or credit.account_id == debit.account_id or credit.cents != debit.cents:
                continue
            distance = abs(credit.day - debit.day)
            if distance > window:
                continue
            if best is None or distance < best[0]:
                best = (distance, credit.id)
        if best is not None:
            used.add(best[1])
            pairs.append((debit.id, best[1]))
    return pairs


def test_pair_legs_matches_quadratic_reference():
    rng = random.Random(42)
    accounts = ["A", "B", "C"]
    legs = [
        Leg(i, rng.choice(accounts), rng.choice([1000, 2500, 5000]), 738000 + rng.randrange(30), "VIR")
        for i in range(400)
    ]
    debits = sorted(legs[:200], key=lambda leg: (leg.day, leg.id))
    credits = sorted(legs[200:], key=lambda leg: (leg.day, leg.id))
    expected = _quadratic_reference(debits, credits)
    assert expected  # the fixture does exercise pairing
    assert pair_legs(debits, credits) == expected


class TestManualTransfers:
    LEGS = (
        ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
        ("2026-06-11", "2026-06-11", "VIR de COMPTE", 0, 500, "LIVRET"),
    )

    @staticmethod
    def _ids(db) -> dict[str, int]:
        with connect(db) as conn:
            return dict(conn.execute("SELECT libelle, id FROM transactions").fetchall())

    @staticmethod
    def _state(db) -> dict[str, tuple]:
        with connect(db) as conn:
            return {
                lib: (kind, manual, group is not None)
                for lib, kind, manual, group in conn.execute(
                    "SELECT libelle, kind, kind_manual, transfer_group_id FROM transactions"
                )
            }

    def test_manual_unpair_survives_recompute(self, db):
        _import(db, *self.LEGS)
        recompute_transfers(db)
        touched = set_transfer_mode(db, self._ids(db)["VIR vers LIVRET"], "none")
        assert len(touched) == 2
        recompute_transfers(db)
        assert self._state(db) == {
            "VIR vers LIVRET": ("expense", 1, False),
            "VIR de COMPTE": ("income", 1, False),
        }
        # Unpaired legs no longer share a group: "auto" releases one row at a time.
        set_transfer_mode(db, self._ids(db)["VIR de COMPTE"], "auto")
        assert self._state(db)["VIR de COMPTE"] == ("income", 0, False)  # its old partner is still manual
        set_transfer_mode(db, self._ids(db)["VIR vers LIVRET"], "auto")
        assert self._state(db)["VIR vers LIVRET"] == ("transfer", 0, True)

    def test_manual_pair_outside_window_survives_recompute(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "CHEQUE 123", 500, 0, "PERSO"),
            ("2026-06-15", "2026-06-15", "REMISE CHEQUE", 0, 500, "JOINT"),
        )
        ids = self._ids(db)
        pair_manually(db, ids["CHEQUE 123"], ids["REMISE CHEQUE"])
        recompute_transfers(db)
        assert self._state(db) == {
            "CHEQUE 123": ("transfer", 1, True),
            "REMISE CHEQUE": ("transfer", 1, True),
        }
        assert transfers_summary(db, "2026-06") == {"count": 1, "total": 500.0}

    def test_manual_pair_releases_previous_partner(self, db):
        _import(db, *self.LEGS, ("2026-06-10", "2026-06-10", "VIR de PERSO", 0, 500, "JOINT"))
        recompute_transfers(db)
        ids = self._ids(db)
        pair_manually(db, ids["VIR vers LIVRET"], ids["VIR de PERSO"])
        with connect(db) as conn:
            sizes = [
                n
                for (n,) in conn.execute(
                    "SELECT COUNT(*) FROM transactions WHERE transfer_group_id IS NOT NULL GROUP BY transfer_group_id"
                )
            ]
        assert sizes == [2]  # the old LIVRET leg went back to auto and found no partner
        assert self._state(db)["VIR de COMPTE"] == ("income", 0, False)

    def test_mark_single_row_transfer_then_auto(self, db):
        _import(db, ("2026-06-10", "2026-06-10", "VIR vers COMPTE TIERS", 80, 0, "PERSO"))
        row_id = self._ids(db)["VIR vers COMPTE TIERS"]
        set_transfer_mode(db, row_id, "transfer")
        assert self._state(db)["VIR vers COMPTE TIERS"] == ("transfer", 1, False)
        assert income_and_expenses(db, "2026-06") == (0, 0)
        set_transfer_mode(db, row_id, "auto")
        assert self._state(db)["VIR vers COMPTE TIERS"] == ("expense", 0, False)

    def test_manual_pair_validation(self, db):
        _import(
            db,
            ("2026-06-10", "2026-06-10", "A", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "B", 500, 0, "JOINT"),
            ("2026-06-10", "2026-06-10", "C", 0, 400, "JOINT"),
            ("2026-06-10", "2026-06-10", "D", 0, 500, "PERSO"),
        )
        ids = self._ids(db)
        for a, b in (("A", "B"), ("A", "C"), ("A", "D"), ("A", "A")):
            with pytest.raises(ValueError):
                pair_manually(db, ids[a], ids[b])
        with pytest.raises(LookupError):
            pair_manually(db, ids["A"], 9999)
        with pytest.raises(LookupError):
            set_transfer_mode(db, 9999, "none")
