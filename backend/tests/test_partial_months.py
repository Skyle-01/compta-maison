"""Partial budget months: an imported checking account had not started, so the monthly averages
leave the month out (the totals of « Tous les mois » stay untouched)."""

from datetime import date

from app.core.categorize import averaging_window
from app.core.periods import partial_months
from app.core.recompute import recompute_all
from app.db import connect, set_account_start_date
from tests.conftest import import_rows


def _debit(day: str, label: str, euros: float, account: str) -> tuple:
    return (day, day, label, euros, 0, account)


def _salary(day: str) -> tuple:
    return (day, day, "PAIE EMPLOYEUR", 0, 2500, "JOINT")


def _joint_history(db) -> None:
    """JOINT from June: salaries open the budget months 2026-06 (05/06) to 2026-10, with groceries
    of 100, 100, 200, 300 and 400 euros in them. The labels carry no transfer marker nor account name."""
    import_rows(
        db,
        _salary("2026-06-05"),
        _debit("2026-06-10", "CARTE SUPERMARCHE", 100, "JOINT"),
        _salary("2026-07-03"),
        _debit("2026-07-10", "CARTE SUPERMARCHE", 100, "JOINT"),
        _salary("2026-08-03"),
        _debit("2026-08-10", "CARTE SUPERMARCHE", 200, "JOINT"),
        _salary("2026-09-02"),
        _debit("2026-09-10", "CARTE SUPERMARCHE", 300, "JOINT"),
        _salary("2026-10-02"),
        _debit("2026-10-10", "CARTE SUPERMARCHE", 400, "JOINT"),
    )


def _partial(db) -> set[str]:
    with connect(db) as conn:
        return partial_months(conn)


class TestPartialMonths:
    def test_no_account_started_late_means_no_partial_month(self, seeded_db):
        _joint_history(seeded_db)
        recompute_all(seeded_db)
        assert _partial(seeded_db) == set()

    def test_months_before_an_accounts_first_operation_are_partial(self, seeded_db):
        _joint_history(seeded_db)
        import_rows(seeded_db, _debit("2026-07-20", "CARTE LIBRAIRIE", 9, "PERSO"))
        recompute_all(seeded_db)
        # 2026-07 opens on 03/07: the account starts 17 days later. 2026-08 opens after it.
        assert _partial(seeded_db) == {"2026-06", "2026-07"}

    def test_starting_within_the_tolerance_is_not_partial(self, seeded_db):
        _joint_history(seeded_db)
        import_rows(seeded_db, _debit("2026-08-07", "CARTE LIBRAIRIE", 9, "PERSO"))  # opening + 4 days
        recompute_all(seeded_db)
        assert _partial(seeded_db) == {"2026-06", "2026-07"}
        import_rows(
            seeded_db, _debit("2026-09-07", "CARTE PRIMEUR", 4, "LOCATIF")
        )  # opening + 5 days, and the 09 month too
        recompute_all(seeded_db)
        assert _partial(seeded_db) == {"2026-06", "2026-07", "2026-08", "2026-09"}

    def test_the_accounts_start_date_wins_over_its_first_operation(self, seeded_db):
        _joint_history(seeded_db)
        import_rows(seeded_db, _debit("2026-09-20", "CARTE LIBRAIRIE", 9, "PERSO"))
        with connect(seeded_db) as conn:
            set_account_start_date(conn, "PERSO", date(2026, 7, 3))
        recompute_all(seeded_db)
        assert _partial(seeded_db) == {"2026-06"}

    def test_a_savings_account_never_makes_a_month_partial(self, seeded_db):
        _joint_history(seeded_db)
        import_rows(seeded_db, (("2026-10-01", "2026-10-01", "INTERETS", 0, 3, "LIVRET")))
        recompute_all(seeded_db)
        assert _partial(seeded_db) == set()

    def test_averaging_window_skips_partial_months(self):
        months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
        assert averaging_window(months, None, {"2026-06", "2026-07"}) == ["2026-08", "2026-09"]
        assert averaging_window(months, 1, {"2026-09"}) == ["2026-08"]
        assert averaging_window(months, 6, {"2026-10"}) == ["2026-06", "2026-07", "2026-08", "2026-09"]
        assert averaging_window(months, None, set(months)) == []


class TestPartialMonthsApi:
    def _late_account(self, db):
        _joint_history(db)
        import_rows(db, _debit("2026-07-20", "CARTE LIBRAIRIE", 9, "PERSO"))
        recompute_all(db)

    def test_dashboard_lists_the_partial_months(self, seeded_db, client):
        self._late_account(seeded_db)
        body = client.get("/api/dashboard").json()
        assert body["months_partial"] == ["2026-07", "2026-06"]
        assert body["months_available"][0] == "2026-10"

    def test_averages_ignore_them(self, seeded_db, client):
        self._late_account(seeded_db)
        body = client.get("/api/dashboard/averages", params={"months": "all"}).json()
        assert (body["months"], body["first_month"], body["last_month"]) == (2, "2026-08", "2026-09")
        variable = next(g for g in body["groups"] if g["name"] == "variable")
        assert variable["expenses"] == 250  # (200 + 300) / 2, not the 4-month 175

    def test_all_months_totals_keep_them(self, seeded_db, client):
        self._late_account(seeded_db)
        body = client.get("/api/dashboard", params={"month": "all"}).json()
        assert body["expenses"] == 1109  # 100 + 100 + 200 + 300 + 400 groceries and the 9 of PERSO
