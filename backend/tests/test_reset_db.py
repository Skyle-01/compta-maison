import shutil

import pytest
from fastapi.testclient import TestClient

from app.core.config_export import export_config
from app.core.parsing import parse_csv
from app.db import connect, get_transfer_markers, import_transactions
from app.main import create_app
from tests.api_helpers import (
    EXAMPLE_PROFILES,
    PROFILE_CSV,
    PROFILE_FILENAME,
    SAMPLE_CSV,
    _category_id,
    _upload,
    _write_profiles,
    _write_start_date,
)
from tests.conftest import isolate_reset_db


class TestResetDb:
    """reset_db.py rebuilds the DB from _inputs/ + a taxonomy source, preserving manual overrides."""

    def _isolate(self, tmp_path, monkeypatch):
        """Point reset_db at a temp _inputs/ (holding the sample statement); return the _backups/ next
        to seeded_db, where reset_db snapshots it."""
        reset_db = isolate_reset_db(tmp_path, monkeypatch)
        reset_db.INPUTS_DIR.mkdir()
        # Same filename _upload uses, so the inferred account (and thus import_hash) matches.
        (reset_db.INPUTS_DIR / "RELEVE_COMPTE_JOINT_2026_06_08.csv").write_bytes(SAMPLE_CSV)
        return reset_db, tmp_path / "_backups"  # next to seeded_db

    @staticmethod
    def _mystery_row(db_path):
        with connect(db_path) as conn:
            return conn.execute(
                "SELECT t.category_manual, c.name, t.note FROM transactions t "
                "LEFT JOIN categories c ON c.id = t.category_id WHERE t.libelle = 'MYSTERY SHOP'"
            ).fetchone()

    @staticmethod
    def _accounts(db_path):
        with connect(db_path) as conn:
            return conn.execute(
                "SELECT code, label, deposit_pattern FROM accounts ORDER BY sort_order, code"
            ).fetchall()

    @staticmethod
    def _count(db_path, table):
        with connect(db_path) as conn:
            return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def test_defaults_falls_back_to_example_data(self, tmp_path, monkeypatch):
        reset_db, _backups = self._isolate(tmp_path, monkeypatch)
        db_path = tmp_path / "new.db"

        reset_db.reset(db_path, "defaults", None)  # no _config/ -> the fictional data/ example

        assert [code for code, *_ in self._accounts(db_path)] == [
            "PERSO",
            "JOINT",
            "LIVRET",
            "LOCATIF",
            "ENFANT",
        ]
        assert self._count(db_path, "label_rules") > 0
        assert self._count(db_path, "transactions") == 4  # the sample statement resolved to JOINT

    def test_demo_statements_build_a_working_example(self, tmp_path, monkeypatch):
        # data/demo/ holds fictional statements for data/'s example accounts: copied into _inputs/,
        # they must all import, pair their transfers and leave little uncategorised.
        reset_db = isolate_reset_db(tmp_path, monkeypatch)
        shutil.copytree(EXAMPLE_PROFILES.parent / "demo", reset_db.INPUTS_DIR)
        db_path = tmp_path / "demo.db"

        reset_db.reset(db_path, "defaults", None)

        with connect(db_path) as conn:
            accounts = {a for (a,) in conn.execute("SELECT DISTINCT account_id FROM transactions")}
            kinds = dict(conn.execute("SELECT kind, COUNT(*) FROM transactions GROUP BY kind").fetchall())
            uncategorised = conn.execute(
                "SELECT COUNT(*) FROM transactions WHERE category_id IS NULL AND kind != 'transfer'"
            ).fetchone()[0]
        assert accounts == {"PERSO", "JOINT", "LIVRET"}
        assert kinds["transfer"] > 0 and kinds["income"] > 0 and kinds["expense"] > 0
        assert 0 < uncategorised < kinds["expense"] / 5  # a few rows left to classify, not most

    def test_demo_averages_reconcile_with_the_history(self, tmp_path, monkeypatch):
        reset_db = isolate_reset_db(tmp_path, monkeypatch)
        shutil.copytree(EXAMPLE_PROFILES.parent / "demo", reset_db.INPUTS_DIR)
        db_path = tmp_path / "demo.db"
        reset_db.reset(db_path, "defaults", None)

        with TestClient(create_app(db_path)) as client:
            dashboard = client.get("/api/dashboard").json()
            for period in ("3", "6", "12", "all"):
                avg = client.get("/api/dashboard/averages", params={"months": period}).json()
                # The latest budget month (still filling) is never averaged.
                assert avg["current_month"] == dashboard["months_available"][0] == dashboard["month"]
                window = [h for h in dashboard["history"] if h["month"] < avg["current_month"]]
                if period != "all":
                    window = window[-int(period) :]
                assert avg["months"] == len(window) > 0
                assert (avg["first_month"], avg["last_month"]) == (window[0]["month"], window[-1]["month"])
                totals = avg["totals"]
                for key in ("income", "expenses", "epargne", "desepargne", "reste"):
                    assert totals[key] == pytest.approx(sum(h[key] for h in window) / len(window), abs=0.01)
                # Category rows + Non classé + compensations add up to the cards (a cent per row).
                rows = len(avg["groups"]) + 2
                offset = avg["offset"]["value"]
                spent = sum(g["expenses"] for g in avg["groups"]) + avg["uncategorized"]["expenses"]
                earned = sum(g["income"] for g in avg["groups"]) + avg["uncategorized"]["income"]
                assert spent + offset == pytest.approx(totals["expenses"], abs=0.01 * rows)
                assert earned + offset == pytest.approx(totals["income"], abs=0.01 * rows)
                saved = sum(s["epargne"] for s in avg["savings"])
                dipped = sum(s["desepargne"] for s in avg["savings"])
                assert (saved, dipped) == pytest.approx((totals["epargne"], totals["desepargne"]), abs=0.01)

    def test_defaults_prefers_private_config_dir(self, tmp_path, monkeypatch):
        reset_db, _backups = self._isolate(tmp_path, monkeypatch)
        config = tmp_path / "_config"
        config.mkdir()
        # An older accounts.csv with the since-removed include_in_full_view column still loads.
        (config / "accounts.csv").write_text(
            "code;label;type;include_in_full_view;sort_order;deposit_pattern;aliases\n"
            "MAIN;Mon compte;checking;1;1;;JOINT\n",
            encoding="utf-8",
        )
        (config / "categories.csv").write_text("path\nVariable\nVariable / Courses\n", encoding="utf-8")
        (config / "rules.csv").write_text(
            "category_path;pattern;priority;is_income_anchor;description\n"
            "Variable / Courses;SUPERMARCHE;1;0;\n",
            encoding="utf-8",
        )
        db_path = tmp_path / "new.db"

        reset_db.reset(db_path, "defaults", None)

        assert self._accounts(db_path) == [("MAIN", "Mon compte", None)]
        # The statement filename (RELEVE_COMPTE_JOINT_…) resolved through the private alias.
        with connect(db_path) as conn:
            assert conn.execute("SELECT DISTINCT account_id FROM transactions").fetchall() == [("MAIN",)]
            assert (
                conn.execute("SELECT COUNT(*) FROM transactions WHERE category_id IS NOT NULL").fetchone()[0]
                == 1
            )

    def test_live_snapshots_and_preserves_overrides(self, seeded_db, client, tmp_path, monkeypatch):
        reset_db, backups = self._isolate(tmp_path, monkeypatch)
        _upload(client)
        mystery = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        client.patch(
            f"/api/transactions/{mystery['id']}",
            json={"category_id": _category_id(client, "courses"), "note": "cadeau"},
        )

        reset_db.reset(seeded_db, "live", None)

        # A restore point was written under _backups/<ts>/, and the override survived the rebuild.
        snaps = list(backups.glob("*"))
        assert len(snaps) == 1 and (snaps[0] / "overrides.csv").exists()
        assert self._mystery_row(seeded_db) == (1, "courses", "cadeau")
        # Accounts (and their aliases) are part of the snapshot and survive the rebuild too.
        assert (snaps[0] / "accounts.csv").exists()
        assert self._accounts(seeded_db)[0] == ("PERSO", "Compte perso", None)
        assert ("ENFANT", "Livret enfant", "VERS LIVRET ENFANT") in self._accounts(seeded_db)

    def test_snapshots_sit_next_to_the_db(self, seeded_db, tmp_path, monkeypatch):
        """Rebuilding a throwaway DB elsewhere never adds a snapshot to the real restore points."""
        reset_db, backups = self._isolate(tmp_path, monkeypatch)
        demo_db = tmp_path / "demo" / "compta.db"
        demo_db.parent.mkdir()
        reset_db.reset(demo_db, "defaults", None)

        reset_db.reset(demo_db, "defaults", None)  # the demo DB exists now: it gets snapshotted

        assert len(list((demo_db.parent / "_backups").glob("*"))) == 1
        assert not backups.exists()

    def test_live_rebuild_keeps_transfer_markers(self, seeded_db, client, tmp_path, monkeypatch):
        reset_db, backups = self._isolate(tmp_path, monkeypatch)
        client.put("/api/transfer-markers", json={"markers": ["*"]})

        reset_db.reset(seeded_db, "live", None)

        snap = next(backups.glob("*"))
        assert (snap / "transfer_markers.csv").read_text(encoding="utf-8-sig").splitlines() == ["marker", "*"]
        with connect(seeded_db) as conn:
            assert get_transfer_markers(conn) == ["*"]

    def test_backup_restores_without_live_db(self, seeded_db, client, tmp_path, monkeypatch):
        reset_db, backups = self._isolate(tmp_path, monkeypatch)
        _upload(client)
        mystery = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        client.patch(
            f"/api/transactions/{mystery['id']}",
            json={"category_id": _category_id(client, "courses"), "note": "cadeau"},
        )
        export_config(seeded_db, backups / "20260101_000000")
        seeded_db.unlink()  # simulate a lost DB

        reset_db.reset(seeded_db, "backup", None)  # restore from the latest snapshot + _inputs

        assert seeded_db.exists()
        assert self._mystery_row(seeded_db) == (1, "courses", "cadeau")

    def test_inputs_use_user_profiles(self, tmp_path, monkeypatch):
        reset_db, _backups = self._isolate(tmp_path, monkeypatch)
        _write_profiles(tmp_path)
        (tmp_path / "_inputs" / PROFILE_FILENAME).write_bytes(PROFILE_CSV)
        db_path = tmp_path / "new.db"

        reset_db.reset(db_path, "defaults", None)

        with connect(db_path) as conn:
            by_account = dict(
                conn.execute("SELECT account_id, COUNT(*) FROM transactions GROUP BY account_id")
            )
        assert by_account == {"JOINT": 4, "PERSO": 2}

    def test_rebuild_skips_rows_before_start_date(self, tmp_path, monkeypatch):
        reset_db, _backups = self._isolate(tmp_path, monkeypatch)
        _write_start_date(tmp_path, "2026-06-07")
        db_path = tmp_path / "new.db"

        reset_db.reset(db_path, "defaults", None)

        with connect(db_path) as conn:
            assert conn.execute("SELECT MIN(date_valeur), COUNT(*) FROM transactions").fetchone() == (
                "2026-06-07",
                2,
            )

    def test_live_rebuild_with_profiles_keeps_overrides(self, seeded_db, client, tmp_path, monkeypatch):
        # An upload and a rebuild parse the statement with the same profile, so the override made
        # on the uploaded row reattaches to the rebuilt one by import_hash.
        reset_db, _backups = self._isolate(tmp_path, monkeypatch)
        _write_profiles(tmp_path)
        (tmp_path / "_inputs" / PROFILE_FILENAME).write_bytes(PROFILE_CSV)
        _upload(client, filename=PROFILE_FILENAME, content=PROFILE_CSV)
        row = client.get("/api/transactions", params={"libelle_contains": "BOULANGERIE"}).json()["items"][0]
        client.patch(
            f"/api/transactions/{row['id']}",
            json={"category_id": _category_id(client, "courses"), "note": "pain"},
        )

        reset_db.reset(seeded_db, "live", None)

        with connect(seeded_db) as conn:
            assert conn.execute(
                "SELECT t.category_manual, c.name, t.note FROM transactions t "
                "JOIN categories c ON c.id = t.category_id WHERE t.libelle = 'CARTE BOULANGERIE'"
            ).fetchone() == (1, "courses", "pain")

    def test_invalid_profiles_exit_before_delete(self, seeded_db, tmp_path, monkeypatch):
        reset_db, backups = self._isolate(tmp_path, monkeypatch)
        config = tmp_path / "_config"
        config.mkdir()
        (config / "bank_profiles.toml").write_text("pas du toml [", encoding="utf-8")

        with pytest.raises(SystemExit, match="bank_profiles.toml"):
            reset_db.reset(seeded_db, "live", None)

        assert seeded_db.exists()
        assert not backups.exists()


class TestUploadMatchesRebuild:
    """An upload hashes its rows like reset_db.py rebuilds them, and lands in _inputs/, so manual
    overrides made after an upload survive a rebuild."""

    LIVRET_FILE = "RELEVE_LIVRET_A_2026_06_08.csv"

    @staticmethod
    def _mystery(db_path):
        with connect(db_path) as conn:
            return conn.execute(
                "SELECT t.account, t.category_manual, c.name, t.note FROM transactions t "
                "LEFT JOIN categories c ON c.id = t.category_id WHERE t.libelle = 'MYSTERY SHOP'"
            ).fetchone()

    def _set_override(self, client):
        row = client.get("/api/transactions", params={"libelle_contains": "MYSTERY"}).json()["items"][0]
        client.patch(
            f"/api/transactions/{row['id']}",
            json={"category_id": _category_id(client, "courses"), "note": "cadeau"},
        )

    def test_picked_code_hashes_with_filename_alias(self, client, tmp_path):
        resp = _upload(client, filename=self.LIVRET_FILE, account="LIVRET")
        assert resp.status_code == 201
        body = resp.json()
        assert body["account"] == "LIVRET A"  # what reset_db.py infers from the filename
        assert body["archived_as"] == self.LIVRET_FILE
        assert (tmp_path / "_inputs" / self.LIVRET_FILE).read_bytes() == SAMPLE_CSV

    def test_override_survives_rebuild(self, seeded_db, client, tmp_path, monkeypatch):
        reset_db = isolate_reset_db(tmp_path, monkeypatch)
        _upload(client, filename=self.LIVRET_FILE, account="LIVRET")
        self._set_override(client)

        reset_db.reset(seeded_db, "live", None)

        assert self._mystery(seeded_db) == ("LIVRET A", 1, "courses", "cadeau")

    def test_hand_picked_account_is_archived_under_an_inferable_name(
        self, seeded_db, client, tmp_path, monkeypatch
    ):
        reset_db = isolate_reset_db(tmp_path, monkeypatch)
        body = _upload(client, filename="export.csv", account="PERSO").json()
        assert body["account"] == "PERSO"
        assert body["archived_as"].startswith("RELEVE_PERSO_") and body["archived_as"].endswith("_export.csv")
        self._set_override(client)

        reset_db.reset(seeded_db, "live", None)

        assert self._mystery(seeded_db) == ("PERSO", 1, "courses", "cadeau")

    def test_archive_never_overwrites(self, client, tmp_path):
        inputs = tmp_path / "_inputs"
        inputs.mkdir()
        (inputs / self.LIVRET_FILE).write_bytes(b"another statement")

        first = _upload(client, filename=self.LIVRET_FILE).json()["archived_as"]
        again = _upload(client, filename=self.LIVRET_FILE).json()["archived_as"]

        assert first == again == "RELEVE_LIVRET_A_2026_06_08 (2).csv"
        assert (inputs / self.LIVRET_FILE).read_bytes() == b"another statement"
        assert {p.name for p in inputs.iterdir()} == {self.LIVRET_FILE, first}

    def test_rebuild_reattaches_overrides_of_rows_hashed_with_the_code(
        self, seeded_db, client, tmp_path, monkeypatch
    ):
        # A DB from before the fix holds rows uploaded under the code: their hash isn't the one the
        # rebuild computes, so the override is found again by account, date, libellé and amounts.
        reset_db = isolate_reset_db(tmp_path, monkeypatch)
        rows = parse_csv(SAMPLE_CSV)
        for row in rows:
            row["account"] = "LIVRET"
        import_transactions(rows, seeded_db)
        (tmp_path / "_inputs").mkdir()
        (tmp_path / "_inputs" / self.LIVRET_FILE).write_bytes(SAMPLE_CSV)
        self._set_override(client)

        reset_db.reset(seeded_db, "live", None)

        assert self._mystery(seeded_db) == ("LIVRET A", 1, "courses", "cadeau")
