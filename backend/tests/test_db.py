from app.db import connect, init_db, upsert_accounts
from tests.conftest import import_rows


class TestImportTransactions:
    def test_inserts_new_rows(self, db):
        rows = (
            ("2026-06-01", "2026-06-01", "EMPLOYEUR", 0, 2500, "PERSO"),
            ("2026-06-02", "2026-06-02", "LECLERC", 60, 0, "JOINT"),
        )
        assert import_rows(db, *rows) == 2

    def test_dedup_on_reimport(self, db):
        row = ("2026-06-01", "2026-06-01", "EMPLOYEUR", 0, 2500, "PERSO")
        import_rows(db, row)
        assert import_rows(db, row) == 0

    def test_amounts_stored_as_cents(self, db):
        import_rows(db, ("2026-06-05", "2026-06-05", "SUPERMARCHE", 45.53, 0, "JOINT"))
        with connect(db) as conn:
            row = conn.execute(
                "SELECT libelle, debit_cents, account, budget_month FROM transactions"
            ).fetchone()
        assert row == ("SUPERMARCHE", 4553, "JOINT", "2026-06")

    def test_identical_rows_in_one_file_both_kept(self, db):
        # Two genuinely identical operations (same shop, same day, same amount)
        rows = (
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0, "JOINT"),
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0, "JOINT"),
        )
        assert import_rows(db, *rows) == 2

    def test_identical_rows_dedup_against_overlapping_reupload(self, db):
        rows = (
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0, "JOINT"),
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0, "JOINT"),
        )
        import_rows(db, *rows)
        assert import_rows(db, *rows) == 0  # same pair re-uploaded -> all duplicates

    def test_dedup_across_aliases_of_one_account(self, db):
        # Same statement, first with the account inferred from the filename, then typed by hand:
        # both strings resolve to JOINT, so the second import must not duplicate the rows.
        rows = [
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0),
            ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0),
            ("2026-06-07", "2026-06-07", "BOULANGERIE", 3.2, 0),
        ]
        assert import_rows(db, *[(*r, "JOINT") for r in rows]) == 3
        assert import_rows(db, *[(*r, "Compte joint") for r in rows]) == 0
        # A third identical operation that day is still new.
        extra = [*rows, ("2026-06-06", "2026-06-06", "CARTE U EXPRESS", 8.05, 0)]
        assert import_rows(db, *[(*r, "COMPTE JOINT") for r in extra]) == 1

    def test_partial_reimport(self, db):
        import_rows(db, ("2026-06-01", "2026-06-01", "EMPLOYEUR", 0, 2500, "PERSO"))
        assert (
            import_rows(
                db,
                ("2026-06-01", "2026-06-01", "EMPLOYEUR", 0, 2500, "PERSO"),  # duplicate
                ("2026-06-03", "2026-06-03", "BOULANGERIE", 5, 0, "PERSO"),  # new
            )
            == 1
        )


class TestFreshSchema:
    """Early-dev: a single schema version, no migration ladder."""

    def test_fresh_db_is_empty(self, tmp_path):
        path = tmp_path / "fresh.db"
        init_db(path)
        with connect(path) as conn:
            assert conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0  # no roots
            # Accounts are user data (accounts.csv), never seeded from code.
            assert conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0

    def test_init_is_idempotent(self, tmp_path):
        path = tmp_path / "fresh.db"
        init_db(path)
        with connect(path) as conn:
            upsert_accounts(conn, [("PERSO", "Compte perso", "checking", 1, None)], [("PERSO", "PERSO")])
        init_db(path)  # second call must not touch existing accounts or error
        with connect(path) as conn:
            assert conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 1


class TestUpsertAccounts:
    def test_upsert_updates_in_place_and_uppercases_aliases(self, tmp_path):
        path = tmp_path / "fresh.db"
        init_db(path)
        with connect(path) as conn:
            upsert_accounts(conn, [("PERSO", "Old", "checking", 1, None)], [("compte perso", "PERSO")])
            upsert_accounts(conn, [("PERSO", "New", "checking", 1, None)], [("compte perso", "PERSO")])
            assert conn.execute("SELECT label FROM accounts").fetchall() == [("New",)]
            assert conn.execute("SELECT alias FROM account_aliases").fetchall() == [("COMPTE PERSO",)]
