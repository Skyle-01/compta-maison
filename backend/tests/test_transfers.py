from app.core.categorize import income_and_expenses, transfers_summary, uncategorized_balance
from app.core.transfers import recompute_transfers
from app.db import connect, import_transactions


def _import(db, *rows):
    columns = ["Date operation", "Date valeur", "Libelle", "Debit", "Credit", "account"]
    records = [dict(zip(columns, row)) for row in rows]
    for record in records:
        record["budget_month"] = record["Date valeur"][:7]
    import_transactions(records, db)


def _kinds(db) -> dict[str, str]:
    with connect(db) as conn:
        return dict(conn.execute("SELECT libelle, kind FROM transactions").fetchall())


class TestRecomputeTransfers:
    def test_pairs_matching_cross_account_legs(self, db):
        _import(db,
                ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
                ("2026-06-11", "2026-06-11", "VIR de COMPTE", 0, 500, "LIVRET"))
        assert recompute_transfers(db) == 2
        kinds = _kinds(db)
        assert kinds["VIR vers LIVRET"] == "transfer"
        assert kinds["VIR de COMPTE"] == "transfer"
        with connect(db) as conn:
            groups = [g for (g,) in conn.execute("SELECT transfer_group_id FROM transactions")]
        assert groups[0] is not None and groups[0] == groups[1]

    def test_same_account_not_paired(self, db):
        _import(db,
                ("2026-06-10", "2026-06-10", "ACHAT", 500, 0, "PERSO"),
                ("2026-06-10", "2026-06-10", "REMBOURSEMENT", 0, 500, "PERSO"))
        assert recompute_transfers(db) == 0
        assert _kinds(db) == {"ACHAT": "expense", "REMBOURSEMENT": "income"}

    def test_amount_mismatch_not_paired(self, db):
        _import(db,
                ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
                ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 400, "LIVRET"))
        assert recompute_transfers(db) == 0

    def test_outside_date_window_not_paired(self, db):
        _import(db,
                ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
                ("2026-06-20", "2026-06-20", "VIR de COMPTE", 0, 500, "LIVRET"))
        assert recompute_transfers(db) == 0

    def test_transfers_excluded_from_totals_and_balance(self, db):
        _import(db,
                ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
                ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 500, "LIVRET"),
                ("2026-06-12", "2026-06-12", "COURSES", 60, 0, "JOINT"))
        recompute_transfers(db)
        income, expenses = income_and_expenses(db, "2026-06")
        assert income == 0          # the 500 credit is a transfer, not income
        assert expenses == 60       # only the real expense remains
        summary = transfers_summary(db, "2026-06")
        assert summary == {"count": 1, "total": 500.0}
        stats = uncategorized_balance(db, "2026-06")
        assert stats["count"] == 1  # transfers no longer counted as uncategorised residual

    def test_idempotent(self, db):
        _import(db,
                ("2026-06-10", "2026-06-10", "VIR vers LIVRET", 500, 0, "PERSO"),
                ("2026-06-10", "2026-06-10", "VIR de COMPTE", 0, 500, "LIVRET"))
        assert recompute_transfers(db) == 2
        assert recompute_transfers(db) == 2  # stable on re-run
