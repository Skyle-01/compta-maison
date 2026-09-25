from app.core.periods import recompute_budget_months
from app.db import connect, import_transactions


def _import(db, *rows):
    columns = ["Date operation", "Date valeur", "Libelle", "Debit", "Credit", "account"]
    records = [dict(zip(columns, row, strict=True)) for row in rows]
    for record in records:
        record["budget_month"] = record["Date valeur"][:7]
    import_transactions(records, db)


def _months(db) -> dict[str, str]:
    with connect(db) as conn:
        return dict(conn.execute("SELECT libelle, budget_month FROM transactions").fetchall())


class TestRecomputeBudgetMonths:
    """seeded_db's EMPLOYEUR rule is flagged is_income_anchor."""

    def test_no_anchor_transactions_keeps_calendar_months(self, seeded_db):
        _import(seeded_db, ("2026-05-30", "2026-05-30", "CARTE LECLERC", 30, 0, "JOINT"))
        assert recompute_budget_months(seeded_db) == 0
        assert _months(seeded_db)["CARTE LECLERC"] == "2026-05"

    def test_no_anchor_rule_is_noop(self, seeded_db):
        with connect(seeded_db) as conn:
            conn.execute("UPDATE label_rules SET is_income_anchor = 0")
        _import(seeded_db,
                ("2026-05-28", "2026-05-28", "VIR EMPLOYEUR", 0, 2500, "PERSO"),
                ("2026-05-30", "2026-05-30", "CARTE LECLERC", 30, 0, "JOINT"))
        assert recompute_budget_months(seeded_db) == 0

    def test_spending_after_paycheck_rolls_into_next_month(self, seeded_db):
        _import(seeded_db,
                ("2026-05-28", "2026-05-28", "VIR EMPLOYEUR", 0, 2500, "PERSO"),
                ("2026-05-30", "2026-05-30", "CARTE LECLERC", 30, 0, "JOINT"),
                ("2026-05-27", "2026-05-27", "CARTE BOULANGERIE", 5, 0, "JOINT"))
        recompute_budget_months(seeded_db)
        months = _months(seeded_db)
        assert months["VIR EMPLOYEUR"] == "2026-06"       # salary pays for June
        assert months["CARTE LECLERC"] == "2026-06"        # spent from the June paycheck
        assert months["CARTE BOULANGERIE"] == "2026-05"    # before the deposit

    def test_period_closes_at_next_paycheck(self, seeded_db):
        _import(seeded_db,
                ("2026-04-28", "2026-04-28", "VIR EMPLOYEUR AVRIL", 0, 2500, "PERSO"),
                ("2026-05-28", "2026-05-28", "VIR EMPLOYEUR MAI", 0, 2500, "PERSO"),
                ("2026-05-15", "2026-05-15", "CARTE MID MAY", 20, 0, "JOINT"),
                ("2026-05-29", "2026-05-29", "CARTE END MAY", 20, 0, "JOINT"))
        recompute_budget_months(seeded_db)
        months = _months(seeded_db)
        assert months["CARTE MID MAY"] == "2026-05"
        assert months["CARTE END MAY"] == "2026-06"

    def test_salary_early_in_month_opens_same_month(self, seeded_db):
        _import(seeded_db,
                ("2026-06-02", "2026-06-02", "VIR EMPLOYEUR", 0, 2500, "PERSO"),
                ("2026-06-10", "2026-06-10", "CARTE LECLERC", 30, 0, "JOINT"))
        recompute_budget_months(seeded_db)
        months = _months(seeded_db)
        assert months["VIR EMPLOYEUR"] == "2026-06"
        assert months["CARTE LECLERC"] == "2026-06"

    def test_idempotent(self, seeded_db):
        _import(seeded_db,
                ("2026-05-28", "2026-05-28", "VIR EMPLOYEUR", 0, 2500, "PERSO"),
                ("2026-05-30", "2026-05-30", "CARTE LECLERC", 30, 0, "JOINT"))
        first = recompute_budget_months(seeded_db)
        assert first > 0
        assert recompute_budget_months(seeded_db) == 0

    def test_anchor_debit_is_not_an_anchor(self, seeded_db):
        # e.g. a refund TO the employer must not open a budget period
        _import(seeded_db, ("2026-05-28", "2026-05-28", "VIR EMPLOYEUR REMBOURSEMENT", 100, 0, "PERSO"))
        assert recompute_budget_months(seeded_db) == 0
