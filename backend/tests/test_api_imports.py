import pytest

from app.db import connect
from tests.api_helpers import (
    PROFILE_CSV,
    PROFILE_FILENAME,
    SAMPLE_CSV,
    _category_id,
    _upload,
    _write_profiles,
    _write_start_date,
)
from tests.test_parsing import GOLDEN_HASHES, GOLDEN_ROWS, _csv


class TestImports:
    def test_upload_imports_and_categorizes(self, seeded_db, client):
        resp = _upload(client)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["account"] == "JOINT"  # inferred from filename
        assert body["rows_total"] == 4
        assert body["rows_new"] == 4
        assert body["uncategorized_count"] == 1  # MYSTERY SHOP
        assert body["balance_warnings"] == {"2026-06": -10.0}

    def test_reupload_is_idempotent(self, seeded_db, client):
        _upload(client)
        resp = _upload(client)
        assert resp.json()["rows_new"] == 0

    def test_explicit_account_overrides_filename(self, seeded_db, client):
        resp = _upload(client, account="PERSO")
        assert resp.json()["account"] == "PERSO"

    def test_invalid_csv_rejected(self, client):
        resp = client.post(
            "/api/imports",
            files={"file": ("RELEVE_COMPTE_JOINT_2026.csv", b"not;a;bank;csv", "text/csv")},
        )
        assert resp.status_code == 422

    def test_missing_account_rejected(self, client):
        resp = client.post(
            "/api/imports",
            files={"file": ("export.csv", SAMPLE_CSV, "text/csv")},
        )
        assert resp.status_code == 422

    def test_unknown_account_rejected(self, client):
        resp = client.post(
            "/api/imports",
            files={"file": ("export.csv", SAMPLE_CSV, "text/csv")},
            data={"account": "WEIRD"},
        )
        assert resp.status_code == 422
        assert resp.json()["detail"][0].startswith("« WEIRD » ne désigne aucun compte connu")

    def test_upload_with_user_profile(self, seeded_db, client, tmp_path):
        _write_profiles(tmp_path)
        resp = _upload(client, filename=PROFILE_FILENAME, content=PROFILE_CSV)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert (body["account"], body["profile"], body["rows_new"]) == ("COMPTE PERSO", "banque-exemple", 2)
        with connect(seeded_db) as conn:
            rows = conn.execute(
                "SELECT account_id, debit_cents, credit_cents FROM transactions ORDER BY date_operation"
            ).fetchall()
        assert rows == [("PERSO", 420, 0), ("PERSO", 0, 250000)]

    def test_upload_default_import_hash_frozen_with_profiles(self, seeded_db, client, tmp_path):
        _write_profiles(tmp_path)
        resp = _upload(client, content=_csv(*GOLDEN_ROWS))
        assert resp.json()["profile"] == "default"
        with connect(seeded_db) as conn:
            hashes = [h for (h,) in conn.execute("SELECT import_hash FROM transactions ORDER BY id")]
        assert hashes == GOLDEN_HASHES

    def _drop_overlapping_statement(self, tmp_path) -> None:
        """Statements dropped in _inputs/ by hand: one overlapping the uploaded SAMPLE_CSV (its last
        two rows + two new ones), and one that names no account."""
        (tmp_path / "_inputs" / "RELEVE_COMPTE_JOINT_2026_06_12.csv").write_bytes(
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"07/06/2026";"07/06/2026";"BAR ANGELUS";"12,00";""\n'
            b'"08/06/2026";"08/06/2026";"MYSTERY SHOP";"10,00";""\n'
            b'"10/06/2026";"10/06/2026";"CARTE SUPERMARCHE";"20,00";""\n'
            b'"12/06/2026";"12/06/2026";"BAR ANGELUS";"8,00";""\n'
        )
        (tmp_path / "_inputs" / "export.csv").write_bytes(SAMPLE_CSV)

    def test_import_inputs_adds_only_new_rows(self, seeded_db, client, tmp_path):
        _upload(client)  # archived to tmp_path/_inputs
        mystery = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        client.patch(f"/api/transactions/{mystery['id']}", json={"category_id": courses, "note": "à garder"})
        with connect(seeded_db) as conn:
            before = conn.execute("SELECT id, import_hash FROM transactions ORDER BY id").fetchall()
        self._drop_overlapping_statement(tmp_path)

        resp = client.post("/api/imports/inputs")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["rows_new"] == 2
        by_name = {f["name"]: f for f in body["files"]}
        assert by_name["RELEVE_COMPTE_JOINT_2026_06_08.csv"]["rows_new"] == 0
        assert (
            by_name["RELEVE_COMPTE_JOINT_2026_06_12.csv"]["rows_total"],
            by_name["RELEVE_COMPTE_JOINT_2026_06_12.csv"]["rows_new"],
        ) == (4, 2)
        assert by_name["export.csv"]["error"] == "aucun compte connu dans le nom du fichier"

        with connect(seeded_db) as conn:
            after = conn.execute("SELECT id, import_hash FROM transactions ORDER BY id").fetchall()
        assert after[: len(before)] == before and len(after) == len(before) + 2
        kept = client.get("/api/transactions", params={"manual": True}).json()["items"]
        assert [(t["id"], t["category"], t["note"]) for t in kept] == [(mystery["id"], "courses", "à garder")]
        assert client.post("/api/imports/inputs").json()["rows_new"] == 0  # idempotent

    def test_import_inputs_cli(self, seeded_db, client, tmp_path, monkeypatch):
        import scripts.import_inputs as cli

        monkeypatch.setattr(cli, "INPUTS_DIR", tmp_path / "_inputs")
        monkeypatch.setattr(cli, "CONFIG_DIR", tmp_path / "_config")
        _upload(client)
        self._drop_overlapping_statement(tmp_path)
        assert cli.import_inputs(seeded_db) == 2
        assert cli.import_inputs(seeded_db) == 0
        with pytest.raises(SystemExit):
            cli.import_inputs(tmp_path / "absent.db")

    def test_upload_skips_rows_before_start_date(self, seeded_db, client, tmp_path):
        _write_start_date(tmp_path, "2026-06-07")
        body = _upload(client).json()
        assert (body["rows_total"], body["rows_new"], body["rows_before_start"]) == (2, 2, 2)
        with connect(seeded_db) as conn:
            labels = [lib for (lib,) in conn.execute("SELECT libelle FROM transactions ORDER BY date_valeur")]
        assert labels == ["BAR ANGELUS", "MYSTERY SHOP"]

    def test_upload_entirely_before_start_date(self, seeded_db, client, tmp_path):
        _write_start_date(tmp_path, "2027-01-01")
        resp = _upload(client)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert (body["rows_total"], body["rows_new"], body["rows_before_start"]) == (0, 0, 4)
        assert body["uncategorized_count"] == 0 and body["balance_warnings"] == {}

    def test_import_inputs_skips_rows_before_start_date(self, seeded_db, client, tmp_path):
        (tmp_path / "_inputs").mkdir()
        self._drop_overlapping_statement(tmp_path)
        _write_start_date(tmp_path, "2026-06-10")
        body = client.post("/api/imports/inputs").json()
        statement = next(f for f in body["files"] if f["name"] == "RELEVE_COMPTE_JOINT_2026_06_12.csv")
        assert (statement["rows_total"], statement["rows_new"], statement["rows_before_start"]) == (2, 2, 2)
        assert body["rows_new"] == 2

    @staticmethod
    def _statement_from(day: int) -> bytes:
        """Two new JOINT operations from `day` June 2026 (SAMPLE_CSV ends on 08/06)."""
        return (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            + f'"{day:02d}/06/2026";"{day:02d}/06/2026";"CARTE PHARMACIE";"7,50";""\n'.encode()
            + f'"{day + 1:02d}/06/2026";"{day + 1:02d}/06/2026";"CARTE LIBRAIRIE";"9,00";""\n'.encode()
        )

    GAP_WARNING = (
        "Trou possible : aucune opération entre le 08/06/2026 (dernière en base) et le 20/06/2026 "
        "(début du fichier), soit 11 jours. Un relevé manque-t-il ?"
    )

    @pytest.mark.parametrize(
        ("day", "expected"),
        [(7, None), (9, None), (12, None), (13, "gap"), (20, GAP_WARNING)],
        ids=["overlapping", "contiguous", "at-tolerance", "past-tolerance", "gapped"],
    )
    def test_upload_reports_a_gap_after_the_accounts_last_operation(self, seeded_db, client, day, expected):
        first = _upload(client).json()
        assert first["gap_warning"] is None  # the account's first import
        body = _upload(
            client, filename="RELEVE_COMPTE_JOINT_2026_06_30.csv", content=self._statement_from(day)
        )
        assert body.status_code == 201, body.text
        warning = body.json()["gap_warning"]
        if expected == "gap":
            assert warning is not None and "soit 4 jours" in warning
        else:
            assert warning == expected
        assert body.json()["rows_new"] == 2  # a warning never blocks

    def test_import_inputs_reports_a_gap(self, seeded_db, client, tmp_path):
        _upload(client)
        self._drop_overlapping_statement(tmp_path)  # 07/06 -> 12/06, overlaps
        (tmp_path / "_inputs" / "RELEVE_COMPTE_JOINT_2026_06_30.csv").write_bytes(self._statement_from(20))
        body = client.post("/api/imports/inputs").json()
        by_name = {f["name"]: f for f in body["files"]}
        assert by_name["RELEVE_COMPTE_JOINT_2026_06_12.csv"]["gap_warning"] is None
        gapped = by_name["RELEVE_COMPTE_JOINT_2026_06_30.csv"]
        assert gapped["gap_warning"] == self.GAP_WARNING.replace("08/06/2026", "12/06/2026").replace(
            "11 jours", "7 jours"
        )
        assert gapped["rows_new"] == 2

    def test_coverage_shows_holes_between_statements(self, seeded_db, client, tmp_path):
        _upload(client)  # 05/06 -> 08/06
        self._drop_overlapping_statement(tmp_path)  # 07/06 -> 12/06, overlaps
        (tmp_path / "_inputs" / "RELEVE_COMPTE_JOINT_2026_06_30.csv").write_bytes(self._statement_from(20))
        (tmp_path / "_inputs" / "RELEVE_COMPTE_JOINT_2026_06_14.csv").write_bytes(self._statement_from(16))
        client.post("/api/imports/inputs")

        resp = client.get("/api/imports/coverage")
        assert resp.status_code == 200, resp.text
        by_code = {a["code"]: a for a in resp.json()}
        assert list(by_code) == ["PERSO", "JOINT", "LIVRET", "LOCATIF"]  # ENFANT is external
        joint = by_code["JOINT"]
        assert (joint["first"], joint["last"], joint["operations"], joint["files"]) == (
            "2026-06-05",
            "2026-06-21",
            10,
            4,
        )
        # 16/06 is 4 days after 12/06 (within the tolerance), 20/06 is 3 days after 17/06.
        assert joint["holes"] == []
        assert joint["longest_silence"] == {"start": "2026-06-13", "end": "2026-06-15", "days": 3}
        assert by_code["PERSO"] == {
            "code": "PERSO",
            "label": "Compte perso",
            "first": None,
            "last": None,
            "operations": 0,
            "files": 0,
            "longest_silence": None,
            "holes": [],
        }

        (tmp_path / "_inputs" / "RELEVE_COMPTE_JOINT_2026_06_14.csv").unlink()  # its rows stay in the DB
        joint = {a["code"]: a for a in client.get("/api/imports/coverage").json()}["JOINT"]
        assert joint["holes"] == [{"start": "2026-06-13", "end": "2026-06-19", "days": 7}]
        assert joint["operations"] == 10 and joint["files"] == 3

    def test_coverage_ignores_rows_before_start_date(self, seeded_db, client, tmp_path):
        _upload(client)  # 05/06 -> 08/06, archived
        (tmp_path / "_inputs" / "RELEVE_COMPTE_JOINT_2026_06_30.csv").write_bytes(self._statement_from(20))
        _write_start_date(tmp_path, "2026-06-10")
        joint = {a["code"]: a for a in client.get("/api/imports/coverage").json()}["JOINT"]
        assert joint["files"] == 1 and joint["holes"] == []

    def test_invalid_settings_file_rejected(self, client, tmp_path):
        _write_start_date(tmp_path, "'demain'")
        resp = _upload(client)
        assert resp.status_code == 500
        assert resp.json()["detail"][0].startswith("settings.toml invalide : start_date doit être une date")

    def test_invalid_profiles_file_rejected(self, client, tmp_path):
        config = tmp_path / "_config"
        config.mkdir()
        (config / "bank_profiles.toml").write_text("[[profile]]\nname = 'incomplet'\n", encoding="utf-8")
        resp = _upload(client)
        assert resp.status_code == 500
        assert "bank_profiles.toml" in resp.json()["detail"][0]
