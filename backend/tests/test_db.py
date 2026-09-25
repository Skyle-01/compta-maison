from app.db import connect, import_transactions


def _make_df(*rows) -> list[dict]:
    columns = ["Date operation", "Date valeur", "Libelle", "Debit", "Credit", "account"]
    records = [dict(zip(columns, row, strict=True)) for row in rows]
    for record in records:
        record["budget_month"] = record["Date valeur"][:7]
    return records


class TestImportTransactions:
    def test_inserts_new_rows(self, db):
        df = _make_df(
            ("2026-06-01", "2026-06-01", "EMPLOYEUR", 0, 2500, "PERSO"),
            ("2026-06-02", "2026-06-02", "LECLERC", 60, 0, "JOINT"),
        )
        assert import_transactions(df, db) == 2

    def test_dedup_on_reimport(self, db):
        df = _make_df(("2026-06-01", "2026-06-01", "EMPLOYEUR", 0, 2500, "PERSO"))
        import_transactions(df, db)
        assert import_transactions(df, db) == 0

    def test_amounts_stored_as_cents(self, db):
        df = _make_df(("2026-06-05", "2026-06-05", "SUPERMARCHE", 45.53, 0, "JOINT"))
        import_transactions(df, db)
        with connect(db) as conn:
            row = conn.execute(
                "SELECT libelle, debit_cents, account, budget_month FROM transactions"
            ).fetchone()
        assert row == ("SUPERMARCHE", 4553, "JOINT", "2026-06")

    def test_identical_rows_in_one_file_both_kept(self, db):
        # Two genuinely identical operations (same shop, same day, same amount)
        df = _make_df(
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0, "JOINT"),
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0, "JOINT"),
        )
        assert import_transactions(df, db) == 2

    def test_identical_rows_dedup_against_overlapping_reupload(self, db):
        df = _make_df(
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0, "JOINT"),
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0, "JOINT"),
        )
        import_transactions(df, db)
        assert import_transactions(df, db) == 0  # same pair re-uploaded -> all duplicates

    def test_dedup_across_aliases_of_one_account(self, db):
        # Same statement, first with the account inferred from the filename, then typed by hand:
        # both strings resolve to JOINT, so the second import must not duplicate the rows.
        rows = [
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0),
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0),
            ("2026-06-07", "2026-06-07", "BOULANGERIE", 3.2, 0),
        ]
        assert import_transactions(_make_df(*[(*r, "JOINT") for r in rows]), db) == 3
        assert import_transactions(_make_df(*[(*r, "Compte joint") for r in rows]), db) == 0
        # A third identical operation that day is still new.
        extra = [*rows, ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0)]
        assert import_transactions(_make_df(*[(*r, "COMPTE JOINT") for r in extra]), db) == 1

    def test_partial_reimport(self, db):
        df1 = _make_df(("2026-06-01", "2026-06-01", "EMPLOYEUR", 0, 2500, "PERSO"))
        df2 = _make_df(
            ("2026-06-01", "2026-06-01", "EMPLOYEUR", 0, 2500, "PERSO"),  # duplicate
            ("2026-06-03", "2026-06-03", "BOULANGERIE", 5, 0, "PERSO"),  # new
        )
        import_transactions(df1, db)
        assert import_transactions(df2, db) == 1
