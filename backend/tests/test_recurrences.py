from datetime import date, timedelta

import pytest

from app.core.categorize import apply_rules
from app.core.recurrences import recurrences
from app.db import connect
from tests.conftest import import_rows


def _series(
    libelle: str,
    amounts: list[float],
    account: str = "PERSO",
    credit: bool = False,
    first: tuple[int, int] = (2026, 1),
    day: int = 5,
) -> list[tuple]:
    """One operation per month from `first` (year, month), on `day`, one per amount."""
    year, month = first
    rows = []
    for amount in amounts:
        when = f"{year}-{month:02d}-{day:02d}"
        rows.append((when, when, libelle, 0 if credit else amount, amount if credit else 0, account))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return rows


def _one(db, label: str) -> dict:
    """The only recurrence whose label is `label`, as a dict."""
    found = [r for r in recurrences(db) if r.label == label]
    assert len(found) == 1, f"{label}: {len(found)} recurrences"
    return vars(found[0])


def _kinds(item: dict) -> list[str]:
    return [flag["kind"] for flag in item["status"]]


class TestDetection:
    def test_detected_after_three_months_not_two(self, db):
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49] * 2))
        assert recurrences(db) == []
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49], first=(2026, 3)))
        item = _one(db, "PRLV NETFLIX.COM")
        assert (item["occurrences"], item["first_date"], item["last_date"]) == (3, "2026-01-05", "2026-03-05")
        assert item["next_expected"] == "2026-04-04"  # last + the median gap (30 days)

    def test_a_weekly_shop_is_not_recurring(self, db):
        rows = [
            (f"2026-{m:02d}-{d:02d}", f"2026-{m:02d}-{d:02d}", "CARTE BOULANGERIE", 4.2, 0, "PERSO")
            for m in (1, 2, 3)
            for d in (3, 10, 17, 24)
        ]
        import_rows(db, *rows)
        assert recurrences(db) == []

    def test_two_visits_in_most_months_are_not_recurring(self, db):
        # Gaps alternate 14 and 16 days; no month has a single visit.
        rows = [
            (f"2026-{m:02d}-{d:02d}", f"2026-{m:02d}-{d:02d}", "CARTE SALLE DE SPORT", 30, 0, "PERSO")
            for m in range(1, 6)
            for d in (2, 17)
        ]
        import_rows(db, *rows)
        assert recurrences(db) == []

    def test_same_words_on_two_accounts_stay_apart(self, db):
        import_rows(
            db,
            *_series("PRLV ASSURANCE HABITATION", [20.0] * 3, account="PERSO"),
            *_series("PRLV ASSURANCE HABITATION", [45.0] * 3, account="JOINT"),
        )
        found = recurrences(db)
        assert sorted((r.account_id, r.typical_cents) for r in found) == [("JOINT", 4500), ("PERSO", 2000)]

    def test_the_account_filter_narrows_the_list(self, db):
        import_rows(
            db,
            *_series("PRLV ASSURANCE HABITATION", [20.0] * 3, account="PERSO"),
            *_series("PRLV ASSURANCE HABITATION", [45.0] * 3, account="JOINT"),
        )
        assert [r.account_id for r in recurrences(db, "JOINT")] == ["JOINT"]

    def test_debits_and_credits_of_one_label_are_two_candidates(self, db):
        import_rows(
            db,
            *_series("VIR DUPONT LOYER", [600.0] * 3),
            *_series("VIR DUPONT LOYER", [600.0] * 3, credit=True),
        )
        assert sorted(r.side for r in recurrences(db)) == ["credit", "debit"]

    def test_transfers_are_left_out(self, db):
        import_rows(db, *_series("VIR VERS LIVRET", [100.0] * 4))
        with connect(db) as conn:
            conn.execute("UPDATE transactions SET kind = 'transfer'")
        assert recurrences(db) == []

    def test_a_partial_first_month_does_not_break_the_gap(self, db):
        rows = _series("PRLV FREE MOBILE", [19.99] * 4, first=(2026, 2))
        rows.append(("2026-01-28", "2026-01-28", "PRLV FREE MOBILE", 19.99, 0, "PERSO"))
        import_rows(db, *rows)
        item = _one(db, "PRLV FREE MOBILE")
        assert item["occurrences"] == 5
        assert item["next_expected"] == "2026-06-03"  # median gap 29 days

    def test_unclassified_is_listed_then_takes_the_majority_category(self, db):
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49] * 3))
        assert _one(db, "PRLV NETFLIX.COM")["category_id"] is None
        with connect(db) as conn:
            cat = conn.execute("INSERT INTO categories (name) VALUES ('loisirs')").lastrowid
            conn.execute("INSERT INTO label_rules (category_id, pattern) VALUES (?, 'NETFLIX')", (cat,))
        apply_rules(db)
        assert _one(db, "PRLV NETFLIX.COM")["category_id"] == cat

    def test_expenses_come_first_then_income_largest_first(self, db):
        import_rows(
            db,
            *_series("PRLV NETFLIX.COM", [13.49] * 3),
            *_series("PRLV LOYER", [700.0] * 3),
            *_series("VIR EMPLOYEUR SALAIRE", [2650.0] * 3, credit=True),
            *_series("VIR CAF PRESTATION", [120.0] * 3, credit=True),
        )
        assert [r.label for r in recurrences(db)] == [
            "PRLV LOYER",
            "PRLV NETFLIX.COM",
            "VIR EMPLOYEUR SALAIRE",
            "VIR CAF PRESTATION",
        ]


def _every(libelle: str, days: int, count: int, start: date = date(2026, 1, 1), amount: float = 20.0):
    """`count` operations of `amount`, `days` apart from `start`."""
    rows = []
    for i in range(count):
        when = (start + timedelta(days=i * days)).isoformat()
        rows.append((when, when, libelle, amount, 0, "PERSO"))
    return rows


class TestThresholds:
    """Each limit of the detection, one value inside and one just outside."""

    @pytest.mark.parametrize(("gap_days", "detected"), [(24, False), (25, True), (35, True), (36, False)])
    def test_the_median_gap_must_be_25_to_35_days(self, db, gap_days, detected):
        import_rows(db, *_every("PRLV ASSURANCE", gap_days, 6))
        assert bool(recurrences(db)) is detected

    @pytest.mark.parametrize(
        ("days", "detected"),
        [
            # March holds two operations: 4 of 5 months with a single one = 80 %, 3 of 4 = 75 %.
            (["2026-01-05", "2026-02-05", "2026-03-05", "2026-03-30", "2026-04-30", "2026-05-30"], True),
            (["2026-01-05", "2026-02-05", "2026-03-05", "2026-03-30", "2026-04-30"], False),
        ],
    )
    def test_at_least_80_percent_of_the_months_hold_a_single_operation(self, db, days, detected):
        import_rows(db, *[(d, d, "PRLV SALLE", 30, 0, "PERSO") for d in days])
        assert bool(recurrences(db)) is detected

    @pytest.mark.parametrize(
        ("amounts", "kept"),
        [
            ([65, 80, 100, 120, 135], True),  # the extremes sit exactly 35 % from the median
            ([64, 80, 100, 120, 136], False),
        ],
    )
    def test_a_variable_bill_stays_within_35_percent_of_its_median(self, db, amounts, kept):
        import_rows(db, *_series("PRLV EDF", [float(a) for a in amounts]))
        assert bool(recurrences(db)) is kept

    @pytest.mark.parametrize(
        ("base", "last", "is_a_step"),
        [
            (10.00, 10.50, False),  # under 25 EUR the 0.50 EUR floor applies
            (10.00, 10.51, True),
            (100.00, 102.00, False),  # above it the 2 % rate applies
            (100.00, 102.01, True),
        ],
    )
    def test_the_amount_tolerance_is_2_percent_with_a_50_cent_floor(self, db, base, last, is_a_step):
        import_rows(db, *_series("PRLV NETFLIX.COM", [base, base, last]))
        item = _one(db, "PRLV NETFLIX.COM")
        assert item["amount_kind"] == "fixed"
        assert _kinds(item) == (["price_change"] if is_a_step else [])


class TestAmounts:
    def test_a_steady_bill_is_variable(self, db):
        import_rows(db, *_series("PRLV EDF", [86.0, 88.0, 90.0, 92.0, 94.0, 96.0]))
        item = _one(db, "PRLV EDF")
        assert (item["amount_kind"], item["typical_cents"], item["status"]) == ("variable", 9100, [])

    def test_a_series_too_spread_out_is_a_shop_not_a_bill(self, db):
        import_rows(db, *_series("PRLV EDF", [30.0, 90.0, 40.0, 120.0]))
        assert recurrences(db) == []

    def test_a_flat_amount_is_fixed(self, db):
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49] * 6))
        item = _one(db, "PRLV NETFLIX.COM")
        assert (item["amount_kind"], item["typical_cents"], item["status"]) == ("fixed", 1349, [])

    def test_a_rise_inside_the_tolerance_is_not_a_change(self, db):
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49, 13.49, 13.49, 13.99]))
        item = _one(db, "PRLV NETFLIX.COM")
        assert (item["amount_kind"], item["status"]) == ("fixed", [])

    def test_a_one_off_between_two_runs_of_one_price_is_ignored(self, db):
        # The demo salary: a bonus in June, then back to the usual amount.
        import_rows(db, *_series("VIR EMPLOYEUR SALAIRE", [2650, 2650, 2650, 3050, 2650, 2650], credit=True))
        item = _one(db, "VIR EMPLOYEUR SALAIRE")
        assert (item["amount_kind"], item["typical_cents"], item["status"]) == ("fixed", 265000, [])

    def test_a_one_off_then_the_usual_amount_again_raises_nothing(self, db):
        import_rows(db, *_series("VIR EMPLOYEUR SALAIRE", [2650, 2650, 2650, 3050, 2650], credit=True))
        item = _one(db, "VIR EMPLOYEUR SALAIRE")
        assert (item["typical_cents"], item["status"]) == (265000, [])

    def test_a_step_is_a_price_change_with_the_date_of_the_new_price(self, db):
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49] * 3 + [15.99] * 3))
        item = _one(db, "PRLV NETFLIX.COM")
        assert (item["amount_kind"], item["typical_cents"]) == ("fixed", 1599)
        assert item["status"] == [
            {"kind": "price_change", "old_cents": 1349, "new_cents": 1599, "since": "2026-04-05"}
        ]

    def test_a_last_isolated_amount_is_a_candidate_step(self, db):
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49] * 4 + [15.99]))
        item = _one(db, "PRLV NETFLIX.COM")
        assert item["typical_cents"] == 1349  # still the old price until a second payment confirms it
        assert item["status"] == [
            {"kind": "price_change", "old_cents": 1349, "new_cents": 1599, "since": "2026-05-05"}
        ]

    def test_the_next_occurrence_confirms_the_candidate_step(self, db):
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49] * 4 + [15.99] * 2))
        item = _one(db, "PRLV NETFLIX.COM")
        assert item["typical_cents"] == 1599
        assert [f["since"] for f in item["status"]] == ["2026-05-05"]

    def test_the_next_occurrence_can_cancel_the_candidate_step(self, db):
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49] * 4 + [15.99, 13.49]))
        item = _one(db, "PRLV NETFLIX.COM")
        assert (item["typical_cents"], item["status"]) == (1349, [])

    def test_a_step_then_a_candidate_is_too_many_changes_to_be_fixed(self, db):
        import_rows(db, *_series("PRLV EDF", [10.0] * 2 + [14.0] * 2 + [18.0]))
        assert _one(db, "PRLV EDF")["amount_kind"] == "variable"

    def test_a_price_change_older_than_six_months_is_dropped(self, db):
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49] * 2 + [15.99] * 10, first=(2025, 1)))
        item = _one(db, "PRLV NETFLIX.COM")
        assert (item["typical_cents"], item["status"]) == (1599, [])


class TestStatus:
    def test_missing_then_ended_after_the_second_miss(self, db):
        # The account's latest operation is another flow: 2026-05-20 is one miss, 2026-06-20 is two.
        rows = _series("PRLV NETFLIX.COM", [13.49] * 4)
        import_rows(db, *rows, ("2026-05-20", "2026-05-20", "CARTE SUPERMARCHE", 10, 0, "PERSO"))
        item = _one(db, "PRLV NETFLIX.COM")
        assert (_kinds(item), item["next_expected"]) == (["missing"], "2026-05-06")
        import_rows(db, ("2026-06-20", "2026-06-20", "CARTE SUPERMARCHE", 10, 0, "PERSO"))
        item = _one(db, "PRLV NETFLIX.COM")
        assert (_kinds(item), item["next_expected"]) == (["ended"], None)

    def test_not_missing_inside_the_lateness_margin(self, db):
        import_rows(
            db,
            *_series("PRLV NETFLIX.COM", [13.49] * 4),
            ("2026-05-10", "2026-05-10", "CARTE SUPERMARCHE", 10, 0, "PERSO"),
        )
        assert _kinds(_one(db, "PRLV NETFLIX.COM")) == []

    def test_a_late_statement_flags_nothing(self, db):
        # JOINT's statement stops in April while PERSO's runs to June: judged on JOINT's own latest date.
        import_rows(
            db,
            *_series("PRLV ASSURANCE HABITATION", [20.0] * 4, account="JOINT"),
            ("2026-04-20", "2026-04-20", "CARTE SUPERMARCHE", 10, 0, "JOINT"),
            ("2026-06-20", "2026-06-20", "CARTE SUPERMARCHE", 10, 0, "PERSO"),
        )
        assert _kinds(_one(db, "PRLV ASSURANCE HABITATION")) == []

    def test_doubled_when_the_latest_month_holds_two(self, db):
        import_rows(
            db,
            *_series("PRLV NETFLIX.COM", [13.49] * 5),
            ("2026-05-20", "2026-05-20", "PRLV NETFLIX.COM", 13.49, 0, "PERSO"),
        )
        assert _kinds(_one(db, "PRLV NETFLIX.COM")) == ["doubled"]

    def test_flags_combine(self, db):
        rows = _series("PRLV NETFLIX.COM", [13.49] * 3 + [15.99] * 2)
        rows.append(("2026-05-20", "2026-05-20", "PRLV NETFLIX.COM", 15.99, 0, "PERSO"))
        rows.append(("2026-06-30", "2026-06-30", "CARTE SUPERMARCHE", 10, 0, "PERSO"))
        import_rows(db, *rows)
        assert _kinds(_one(db, "PRLV NETFLIX.COM")) == ["missing", "price_change", "doubled"]

    def test_price_change_never_flags_a_variable_series(self, db):
        import_rows(db, *_series("PRLV EDF", [86.0, 88.0, 90.0, 92.0, 94.0, 100.0]))
        item = _one(db, "PRLV EDF")
        assert (item["amount_kind"], item["status"]) == ("variable", [])


class TestApi:
    def _import(self, db):
        import_rows(
            db,
            *_series("PRLV NETFLIX.COM", [13.49] * 4),
            *_series("PRLV EDF", [86.0, 88.0, 90.0, 92.0]),
            *_series("VIR EMPLOYEUR SALAIRE", [2650.0] * 4, credit=True, account="JOINT"),
            *_series("PRLV SPOTIFY", [10.99] * 2, first=(2026, 1)),
        )

    def test_shape_and_totals_count_only_fixed_flows(self, db, client):
        self._import(db)
        body = client.get("/api/recurrences").json()
        assert [i["label"] for i in body["items"]] == [
            "PRLV EDF",
            "PRLV NETFLIX.COM",
            "VIR EMPLOYEUR SALAIRE",
        ]
        netflix = body["items"][1]
        assert netflix["amount_kind"] == "fixed"
        assert (netflix["typical_amount"], netflix["last_amount"], netflix["occurrences"]) == (
            13.49,
            13.49,
            4,
        )
        assert netflix["next_expected"] == "2026-05-06"
        assert netflix["last_operations"][0] == {
            "id": netflix["last_operations"][0]["id"],
            "date": "2026-04-05",
            "amount": 13.49,
        }
        assert len(netflix["last_operations"]) == 4
        # EDF is variable: out of the totals.
        assert (body["monthly_expenses"], body["monthly_income"]) == (13.49, 2650.0)

    def test_price_change_carries_both_amounts(self, db, client):
        import_rows(db, *_series("PRLV NETFLIX.COM", [13.49] * 3 + [15.99] * 3))
        item = client.get("/api/recurrences").json()["items"][0]
        assert item["status"] == [
            {"kind": "price_change", "old_amount": 13.49, "new_amount": 15.99, "since": "2026-04-05"}
        ]

    def test_account_filter(self, db, client):
        self._import(db)
        body = client.get("/api/recurrences", params={"account": "JOINT"}).json()
        assert [i["label"] for i in body["items"]] == ["VIR EMPLOYEUR SALAIRE"]
        assert (body["monthly_expenses"], body["monthly_income"]) == (0.0, 2650.0)

    def test_unknown_account_is_a_french_error(self, db, client):
        resp = client.get("/api/recurrences", params={"account": "NOPE"})
        assert resp.status_code == 422
        assert resp.json()["detail"] == ["Compte NOPE introuvable"]
