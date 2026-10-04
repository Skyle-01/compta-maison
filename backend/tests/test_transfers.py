import random

import pytest

from app.core.categorize import income_and_expenses, transfers_summary, uncategorized_balance
from app.core.transfers import (
    Leg,
    account_refs,
    agreement,
    effective_markers,
    pair_legs,
    pair_manually,
    recompute_transfers,
    set_transfer_mode,
    transfer_candidates,
)
from app.core.triage import label_key
from app.db import connect, replace_transfer_markers, upsert_accounts
from tests.conftest import import_rows


def _kinds(db) -> dict[str, str]:
    with connect(db) as conn:
        return dict(conn.execute("SELECT libelle, kind FROM transactions").fetchall())


class TestRecomputeTransfers:
    def test_pairs_matching_cross_account_legs(self, db):
        import_rows(
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
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "ACHAT", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "REMBOURSEMENT", 0, 500, "PERSO"),
        )
        assert recompute_transfers(db) == 0
        assert _kinds(db) == {"ACHAT": "expense", "REMBOURSEMENT": "income"}

    def test_amount_mismatch_not_paired(self, db):
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 400, "LIVRET"),
        )
        assert recompute_transfers(db) == 0

    def test_outside_date_window_not_paired(self, db):
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-20", "2026-06-20", "VIR de COMPTE", 0, 500, "LIVRET"),
        )
        assert recompute_transfers(db) == 0

    def test_transfers_excluded_from_totals_and_balance(self, db):
        import_rows(
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
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 500, "LIVRET"),
        )
        assert recompute_transfers(db) == 2
        assert recompute_transfers(db) == 2  # stable on re-run


class TestTransferMarkers:
    """Both legs must start with a transfer marker (default 'VIR', case-insensitive) or name
    another account."""

    def test_round_amount_false_positive_not_paired(self, db):
        # 50 € of groceries on the joint account and 50 € refunded by a friend the next day are
        # not an internal transfer, even though amount and dates line up.
        import_rows(
            db,
            ("2026-06-12", "2026-06-12", "CARTE 12/06 SUPERMARCHE", 50, 0, "JOINT"),
            ("2026-06-13", "2026-06-13", "VIR SEPA RECU /DE AMI", 0, 50, "PERSO"),
        )
        assert recompute_transfers(db) == 0
        assert _kinds(db) == {"CARTE 12/06 SUPERMARCHE": "expense", "VIR SEPA RECU /DE AMI": "income"}

    def test_default_marker_is_case_insensitive_prefix(self, db):
        import_rows(
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
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VERSEMENT", 0, 500, "LIVRET"),
        )
        assert recompute_transfers(db) == 0
        with connect(db) as conn:
            replace_transfer_markers(conn, ["VIR", "VERSEMENT"])
        assert recompute_transfers(db) == 2

    def test_label_naming_an_account_stands_for_a_marker(self, db):
        import_rows(
            db,
            ("2026-06-06", "2026-06-06", "vers LIVRET A", 50, 0, "PERSO"),
            ("2026-06-06", "2026-06-06", "VIR de COMPTE PERSO - Epargne", 0, 50, "LIVRET"),
        )
        assert recompute_transfers(db) == 2

    def test_naming_an_account_does_not_make_the_other_leg_eligible(self, db):
        import_rows(
            db,
            ("2026-06-06", "2026-06-06", "vers LIVRET A", 50, 0, "PERSO"),
            ("2026-06-06", "2026-06-06", "VERSEMENT", 0, 50, "LIVRET"),
        )
        assert recompute_transfers(db) == 0

    def test_star_marker_restores_legacy_pairing(self, db):
        import_rows(
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
        import_rows(db, ("2026-06-10", "2026-06-10", "PRLV VERS LIVRET ENFANT", 25, 0, "JOINT"))
        assert recompute_transfers(db) == 1

    def test_external_savings_deposit_pattern_ignores_case(self, db):
        # Banks don't keep the payee's casing: 'vers Livret Enfant' still matches 'VERS LIVRET ENFANT'.
        import_rows(db, ("2026-06-10", "2026-06-10", "vers Livret Enfant", 25, 0, "JOINT"))
        assert recompute_transfers(db) == 1


class TestPairingAmbiguity:
    """A pair forms only when nothing else could be the other leg: a wrong pair silently hides an
    income (the tenant's rent) or an expense, an unpaired leg merely waits for a manual decision."""

    RENT = ("2026-09-03", "2026-09-03", "VIR INST LOCATAIRE DUPONT", 0, 570, "LOCATIF")

    def test_label_naming_the_account_wins_over_same_day_rent(self, db):
        # The rent is imported first: the old greedy pairing took it, as the lower id.
        import_rows(
            db,
            self.RENT,
            ("2026-09-03", "2026-09-03", "VIR de COMPTE PERSO - Septembre", 0, 570, "LOCATIF"),
            ("2026-09-03", "2026-09-03", "VIR vers APPARTEMENT LOCATIF", 570, 0, "PERSO"),
        )
        assert recompute_transfers(db) == 2
        assert _kinds(db) == {
            "VIR INST LOCATAIRE DUPONT": "income",
            "VIR de COMPTE PERSO - Septembre": "transfer",
            "VIR vers APPARTEMENT LOCATIF": "transfer",
        }

    def test_alias_naming_the_account_wins_over_same_day_rent(self, db):
        # Former bank names, kept as aliases, settle the ambiguity like a label would.
        with connect(db) as conn:
            upsert_accounts(conn, [], [("COMPTE CHEQUES 2", "PERSO"), ("COMPTE CHEQUES 3", "LOCATIF")])
        import_rows(
            db,
            self.RENT,
            ("2026-09-03", "2026-09-03", "VIR de COMPTE CHEQUES 2 - Septembre", 0, 570, "LOCATIF"),
            ("2026-09-03", "2026-09-03", "VIR vers COMPTE CHEQUES 3", 570, 0, "PERSO"),
        )
        assert recompute_transfers(db) == 2
        assert _kinds(db)["VIR INST LOCATAIRE DUPONT"] == "income"

    def test_competing_legs_nothing_tells_apart_stay_unpaired(self, db):
        # No label names an account, and a closer date is no proof: left for a manual decision.
        import_rows(
            db,
            self.RENT,
            ("2026-09-04", "2026-09-04", "VIR de MOI MEME", 0, 570, "LOCATIF"),
            ("2026-09-03", "2026-09-03", "VIR vers LOGEMENT", 570, 0, "PERSO"),
        )
        assert recompute_transfers(db) == 0
        assert set(_kinds(db).values()) == {"income", "expense"}

    def test_manual_pair_settles_an_ambiguity(self, db):
        import_rows(
            db,
            self.RENT,
            ("2026-09-04", "2026-09-04", "VIR de MOI MEME", 0, 570, "LOCATIF"),
            ("2026-09-03", "2026-09-03", "VIR vers LOGEMENT", 570, 0, "PERSO"),
        )
        with connect(db) as conn:
            ids = dict(conn.execute("SELECT libelle, id FROM transactions").fetchall())
        pair_manually(db, ids["VIR vers LOGEMENT"], ids["VIR de MOI MEME"])
        recompute_transfers(db)
        assert _kinds(db)["VIR INST LOCATAIRE DUPONT"] == "income"
        assert income_and_expenses(db, "2026-09") == (570.0, 0.0)

    def test_label_naming_a_third_account_excludes_the_pair(self, db):
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 100, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VIR de COMPTE JOINT", 0, 100, "LOCATIF"),
        )
        assert recompute_transfers(db) == 0

    def test_interchangeable_legs_pair_by_closest_date(self, db):
        # Same account and same label on each side: the same transfer made twice, no ambiguity.
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers EPARGNE", 100, 0, "PERSO"),
            ("2026-06-12", "2026-06-12", "VIR vers EPARGNE", 100, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 100, "LIVRET"),
            ("2026-06-12", "2026-06-12", "VIR de COMPTE", 0, 100, "LIVRET"),
        )
        assert recompute_transfers(db) == 4
        with connect(db) as conn:
            days = conn.execute(
                "SELECT GROUP_CONCAT(date_operation) FROM transactions GROUP BY transfer_group_id"
            ).fetchall()
        assert sorted(d for (d,) in days) == ["2026-06-10,2026-06-10", "2026-06-12,2026-06-12"]


class TestTransferCandidates:
    """The other legs « À classer » offers for an operation: no uniqueness required, user's pick."""

    AMBIGUOUS = (
        TestPairingAmbiguity.RENT,
        ("2026-09-04", "2026-09-04", "VIR de MOI MEME", 0, 570, "LOCATIF"),
        ("2026-09-03", "2026-09-03", "VIR vers LOGEMENT", 570, 0, "PERSO"),
    )

    @staticmethod
    def _ids(db) -> dict[str, int]:
        with connect(db) as conn:
            return dict(conn.execute("SELECT libelle, id FROM transactions").fetchall())

    def test_ambiguous_leg_gets_every_candidate_closest_first(self, db):
        import_rows(db, *self.AMBIGUOUS)
        recompute_transfers(db)
        ids = self._ids(db)
        found = transfer_candidates(db, ids.values())
        assert found[ids["VIR vers LOGEMENT"]] == [ids["VIR INST LOCATAIRE DUPONT"], ids["VIR de MOI MEME"]]
        assert found[ids["VIR de MOI MEME"]] == [ids["VIR vers LOGEMENT"]]

    def test_label_naming_the_account_ranks_first(self, db):
        import_rows(
            db,
            ("2026-09-03", "2026-09-03", "VIR INST LOCATAIRE DUPONT", 0, 570, "LOCATIF"),
            ("2026-09-05", "2026-09-05", "VIR de COMPTE PERSO", 0, 570, "LOCATIF"),
            ("2026-09-03", "2026-09-03", "VIR vers LOGEMENT", 570, 0, "PERSO"),
        )
        ids = self._ids(db)
        found = transfer_candidates(db, [ids["VIR vers LOGEMENT"]])
        assert found == {
            ids["VIR vers LOGEMENT"]: [ids["VIR de COMPTE PERSO"], ids["VIR INST LOCATAIRE DUPONT"]]
        }

    def test_paired_rows_take_no_part(self, db):
        import_rows(db, *self.AMBIGUOUS)
        ids = self._ids(db)
        pair_manually(db, ids["VIR vers LOGEMENT"], ids["VIR de MOI MEME"])
        assert transfer_candidates(db, ids.values()) == {}

    def test_a_row_the_user_said_is_no_transfer_takes_no_part(self, db):
        # A third credit keeps the debit ambiguous once the rent is ruled out (else it auto-pairs).
        import_rows(db, *self.AMBIGUOUS, ("2026-09-05", "2026-09-05", "VIR SEPA AMI", 0, 570, "JOINT"))
        recompute_transfers(db)
        ids = self._ids(db)
        set_transfer_mode(db, ids["VIR INST LOCATAIRE DUPONT"], "none")
        found = transfer_candidates(db, ids.values())
        assert found[ids["VIR vers LOGEMENT"]] == [ids["VIR de MOI MEME"], ids["VIR SEPA AMI"]]
        assert ids["VIR INST LOCATAIRE DUPONT"] not in found

    def test_label_naming_a_third_account_is_no_candidate(self, db):
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 100, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VIR de COMPTE JOINT", 0, 100, "LOCATIF"),
        )
        assert transfer_candidates(db, self._ids(db).values()) == {}

    def test_no_ids_no_query(self, db):
        assert transfer_candidates(db, []) == {}


def _reference_pairs(debits, credits, window=3):
    """A naive transcription of pair_legs' rule (no amount buckets, no bisect), to lock the
    optimised candidate search."""

    def options(leg, others, is_debit):
        found = []
        for other in others:
            if other.cents != leg.cents or other.account_id == leg.account_id:
                continue
            if abs(other.day - leg.day) > window:
                continue
            score = agreement(leg, other) if is_debit else agreement(other, leg)
            if score is not None:
                found.append((score, other))
        return found

    def pick(leg, found, taken):
        free = [(score, other) for score, other in found if other.id not in taken]
        if not free:
            return None
        top = max(score for score, _ in free)
        best = [other for score, other in free if score == top]
        if len({(other.account_id, label_key(other.libelle)) for other in best}) > 1:
            return None
        return min(best, key=lambda other: (abs(other.day - leg.day), other.day, other.id))

    paired, taken = {}, set()
    formed = True
    while formed:
        formed = False
        for debit in debits:
            if debit.id in paired:
                continue
            credit = pick(debit, options(debit, credits, True), taken)
            if credit is None:
                continue
            back = pick(credit, options(credit, debits, False), set(paired))
            if back is not None and back.id == debit.id:
                paired[debit.id] = credit.id
                taken.add(credit.id)
                formed = True
    return [(debit.id, paired[debit.id]) for debit in debits if debit.id in paired]


def test_account_refs_searches_names_not_codes():
    names = {"PERSO": ["Compte perso", "COMPTE CHEQUES 2"], "LOCATIF": ["Appartement locatif"]}
    assert account_refs("VIR de COMPTE CHEQUES 2", "LOCATIF", names) == {"PERSO"}
    assert account_refs("VIR vers compte perso", "LOCATIF", names) == {"PERSO"}
    assert account_refs("VIR vers LOCATIF", "PERSO", names) == frozenset()  # a code is no name
    assert account_refs("VIR de COMPTE PERSO", "PERSO", names) == frozenset()  # its own account


def test_pair_legs_matches_quadratic_reference():
    rng = random.Random(42)
    names = {"A": ["Compte A"], "B": ["Compte B"], "C": ["Compte C"]}
    libelles = ["VIR", "VIR SEPA LOYER", "VIR de COMPTE A", "VIR vers COMPTE B", "VIR de COMPTE C"]
    legs = []
    for i in range(400):
        account, libelle = rng.choice(list(names)), rng.choice(libelles)
        refs = account_refs(libelle, account, names)
        legs.append(
            Leg(i, account, rng.choice([1000, 2500, 5000]), 738000 + rng.randrange(30), libelle, refs)
        )
    debits = sorted(legs[:200], key=lambda leg: (leg.day, leg.id))
    credits = sorted(legs[200:], key=lambda leg: (leg.day, leg.id))
    expected = _reference_pairs(debits, credits)
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

    # The fictional ENFANT account (conftest) is external savings with pattern "VERS LIVRET ENFANT".
    DEPOSIT_AND_GIFT = (
        ("2026-06-10", "2026-06-10", "VIR VERS LIVRET ENFANT", 50, 0, "PERSO"),
        ("2026-06-10", "2026-06-10", "VIR SEPA MAMIE", 0, 50, "JOINT"),
    )

    def test_external_deposit_never_auto_paired(self, db):
        import_rows(db, *self.DEPOSIT_AND_GIFT)
        recompute_transfers(db)
        assert self._state(db) == {
            "VIR VERS LIVRET ENFANT": ("transfer", 0, False),  # single-legged savings deposit
            "VIR SEPA MAMIE": ("income", 0, False),  # the gift stays income
        }

    @pytest.mark.parametrize("modes", [["none"], ["transfer"], ["transfer", "none"]])
    def test_external_deposit_ignores_manual_modes(self, db, modes):
        # A manual "not a transfer" would count the deposit as an expense *and* as savings.
        import_rows(db, *self.DEPOSIT_AND_GIFT)
        recompute_transfers(db)
        for mode in modes:
            set_transfer_mode(db, self._ids(db)["VIR VERS LIVRET ENFANT"], mode)
        assert self._state(db)["VIR VERS LIVRET ENFANT"] == ("transfer", 0, False)
        assert income_and_expenses(db, "2026-06") == (50.0, 0.0)

    def test_pair_manually_rejects_external_deposit(self, db):
        import_rows(db, *self.DEPOSIT_AND_GIFT)
        ids = self._ids(db)
        with pytest.raises(ValueError, match="épargne externe"):
            pair_manually(db, ids["VIR VERS LIVRET ENFANT"], ids["VIR SEPA MAMIE"])

    def test_lowercase_external_deposit_is_never_paired(self, db):
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "VIR vers Livret Enfant", 50, 0, "PERSO"),
            ("2026-06-10", "2026-06-10", "VIR SEPA MAMIE", 0, 50, "JOINT"),
        )
        recompute_transfers(db)
        assert self._state(db) == {
            "VIR vers Livret Enfant": ("transfer", 0, False),
            "VIR SEPA MAMIE": ("income", 0, False),
        }
        ids = self._ids(db)
        with pytest.raises(ValueError, match="épargne externe"):
            pair_manually(db, ids["VIR vers Livret Enfant"], ids["VIR SEPA MAMIE"])

    def test_manual_unpair_survives_recompute(self, db):
        import_rows(db, *self.LEGS)
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
        import_rows(
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
        # Out of the window, so the JOINT credit doesn't compete with LIVRET for the auto pair.
        import_rows(db, *self.LEGS, ("2026-06-20", "2026-06-20", "VIR de PERSO", 0, 500, "JOINT"))
        recompute_transfers(db)
        assert self._state(db)["VIR de COMPTE"] == ("transfer", 0, True)
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
        import_rows(db, ("2026-06-10", "2026-06-10", "VIR vers COMPTE TIERS", 80, 0, "PERSO"))
        row_id = self._ids(db)["VIR vers COMPTE TIERS"]
        set_transfer_mode(db, row_id, "transfer")
        assert self._state(db)["VIR vers COMPTE TIERS"] == ("transfer", 1, False)
        assert income_and_expenses(db, "2026-06") == (0, 0)
        set_transfer_mode(db, row_id, "auto")
        assert self._state(db)["VIR vers COMPTE TIERS"] == ("expense", 0, False)

    def test_manual_pair_validation(self, db):
        import_rows(
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
