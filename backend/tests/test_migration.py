from app.db import connect, init_db, upsert_accounts


class TestFreshSchema:
    """Early-dev: a single schema version, no migration ladder."""

    def test_fresh_db_created_at_v1(self, tmp_path):
        path = tmp_path / "fresh.db"
        init_db(path)
        with connect(path) as conn:
            assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
            assert conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0  # no roots
            # Accounts are user data (accounts.csv), never seeded from code.
            assert conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0

    def test_init_is_idempotent(self, tmp_path):
        path = tmp_path / "fresh.db"
        init_db(path)
        with connect(path) as conn:
            upsert_accounts(conn, [("PERSO", "Compte perso", "checking", 1, 1, None)], [("PERSO", "PERSO")])
        init_db(path)  # second call must not touch existing accounts or error
        with connect(path) as conn:
            assert conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 1


class TestUpsertAccounts:
    def test_upsert_updates_in_place_and_uppercases_aliases(self, tmp_path):
        path = tmp_path / "fresh.db"
        init_db(path)
        with connect(path) as conn:
            upsert_accounts(conn, [("PERSO", "Old", "checking", 1, 1, None)], [("compte perso", "PERSO")])
            upsert_accounts(conn, [("PERSO", "New", "checking", 1, 1, None)], [("compte perso", "PERSO")])
            assert conn.execute("SELECT label FROM accounts").fetchall() == [("New",)]
            assert conn.execute("SELECT alias FROM account_aliases").fetchall() == [("COMPTE PERSO",)]
