import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api.categories import _load_all
from app.api.errors import french_message
from app.core.config_export import category_paths, export_config
from app.core.parsing import parse_csv
from app.db import connect, get_transfer_markers, import_transactions, init_db
from app.main import create_app
from scripts.import_csv import import_csv
from tests.conftest import import_rows, isolate_reset_db, make_db
from tests.test_parsing import GOLDEN_HASHES, GOLDEN_ROWS, _csv

SAMPLE_CSV = (
    b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    b'"05/06/2026";"05/06/2026";"VIR EMPLOYEUR SALAIRE";"";"2500,00"\n'
    b'"06/06/2026";"06/06/2026";"CARTE SUPERMARCHE";"63,82";""\n'
    b'"07/06/2026";"07/06/2026";"BAR ANGELUS";"12,00";""\n'
    b'"08/06/2026";"08/06/2026";"MYSTERY SHOP";"10,00";""\n'
)


# A statement in the format of the example profile (data/bank_profiles.toml).
EXAMPLE_PROFILES = Path(__file__).resolve().parents[2] / "data" / "bank_profiles.toml"
PROFILE_FILENAME = "export_COMPTE_PERSO_20260601.csv"
PROFILE_CSV = (
    'Date,Libellé,Montant\n2026-06-01,CARTE BOULANGERIE,-4.20\n2026-06-02,VIR EMPLOYEUR SALAIRE,"2,500.00"\n'
).encode()


def _export(db_path, tmp_path) -> Path:
    """The config CSVs of `db_path` (core.config_export, as the Réglages save writes them)."""
    out = tmp_path / "cfg"
    export_config(db_path, out)
    return out


def _upload(client, filename="RELEVE_COMPTE_JOINT_2026_06_08.csv", account="", content=SAMPLE_CSV):
    return client.post(
        "/api/imports",
        files={"file": (filename, content, "text/csv")},
        data={"account": account},
    )


def _write_profiles(tmp_path) -> Path:
    """Install the example bank profiles in the test's config dir (tmp_path/_config)."""
    config = tmp_path / "_config"
    config.mkdir(exist_ok=True)
    shutil.copy(EXAMPLE_PROFILES, config / "bank_profiles.toml")
    return config


def _write_start_date(tmp_path, start_date: str) -> None:
    """Open the books at `start_date` in the test's config dir (tmp_path/_config)."""
    config = tmp_path / "_config"
    config.mkdir(exist_ok=True)
    (config / "settings.toml").write_text(f"start_date = {start_date}\n", encoding="utf-8")


def _category_id(client, name: str) -> int:
    return next(c["id"] for c in client.get("/api/categories").json() if c["name"] == name)


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


class TestTransactions:
    def test_list_and_filter_uncategorized(self, seeded_db, client):
        _upload(client)
        resp = client.get("/api/transactions", params={"month": "2026-06", "uncategorized": True})
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["libelle"] == "MYSTERY SHOP"

    def test_filter_by_category_id(self, seeded_db, client):
        _upload(client)
        salaire = _category_id(client, "salaire")
        body = client.get("/api/transactions", params={"month": "2026-06", "category_id": salaire}).json()
        assert body["total"] >= 1
        assert all(t["category_id"] == salaire for t in body["items"])
        assert any("EMPLOYEUR" in t["libelle"] for t in body["items"])

    def test_filter_by_libelle_contains(self, seeded_db, client):
        _upload(client)
        body = client.get("/api/transactions", params={"libelle_contains": "MYSTERY"}).json()
        assert body["total"] >= 1
        assert all("MYSTERY" in t["libelle"] for t in body["items"])
        # Case-sensitive, mirroring the rule engine's instr().
        assert client.get("/api/transactions", params={"libelle_contains": "mystery"}).json()["total"] == 0

    def test_filter_by_deposit_pattern_ignores_case(self, db, client):
        # The external-savings drill-down: same case-insensitive test as recompute_transfers.
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "vers Livret Enfant", 25, 0, "JOINT"),
            ("2026-06-11", "2026-06-11", "SUPERMARCHE", 30, 0, "JOINT"),
        )
        body = client.get("/api/transactions", params={"deposit_pattern": "VERS LIVRET ENFANT"}).json()
        assert [t["libelle"] for t in body["items"]] == ["vers Livret Enfant"]

    def test_categorized_transaction_carries_name(self, seeded_db, client):
        _upload(client)
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        salary = next(t for t in items if "EMPLOYEUR" in t["libelle"])
        assert salary["category"] == "salaire"
        assert salary["category_id"] == _category_id(client, "salaire")

    def test_manual_override(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses})
        assert resp.status_code == 200
        assert resp.json()["category"] == "courses"
        assert resp.json()["category_manual"] is True
        assert resp.json()["rule_id"] is None  # a manual override is not rule-backed

    def test_manual_override_with_note(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses, "note": "cadeau"})
        assert resp.status_code == 200
        assert resp.json()["category"] == "courses"
        assert resp.json()["note"] == "cadeau"

    def test_patch_note_only_keeps_category(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses})
        # A note-only patch must not touch the category.
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"note": "annotation"})
        assert resp.status_code == 200
        assert resp.json()["note"] == "annotation"
        assert resp.json()["category"] == "courses"
        assert resp.json()["category_manual"] is True

    def test_clear_manual_assignment_drops_note(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses, "note": "x"})
        # Deleting the assignment: clear category (rules reclaim the row) and the note.
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": None, "note": None})
        assert resp.status_code == 200
        body = resp.json()
        assert body["category_manual"] is False
        assert body["note"] is None

    def test_manual_filter_returns_only_manual_rows(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        client.patch(f"/api/transactions/{tx['id']}", json={"category_id": _category_id(client, "courses")})
        body = client.get("/api/transactions", params={"manual": True}).json()
        assert body["total"] == 1
        assert all(t["category_manual"] for t in body["items"])
        assert body["items"][0]["libelle"] == "MYSTERY SHOP"

    def test_transaction_carries_rule_provenance(self, seeded_db, client):
        _upload(client)
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        salary = next(t for t in items if "EMPLOYEUR" in t["libelle"])
        # Rule-classified (not manual): carries the matching rule's id + pattern for provenance.
        assert salary["category_manual"] is False
        assert salary["rule_id"] is not None
        assert salary["rule_pattern"] and salary["rule_pattern"] in salary["libelle"]

    def test_override_rejects_unknown_category(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions").json()["items"][0]
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": 9999})
        assert resp.status_code == 422

    def test_override_rejects_group_category(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions").json()["items"][0]
        resp = client.patch(
            f"/api/transactions/{tx['id']}", json={"category_id": _category_id(client, "variable")}
        )
        assert resp.status_code == 422  # 'variable' is a group; leaf-only assignment

    def test_patch_unknown_transaction_is_404(self, seeded_db, client):
        resp = client.patch("/api/transactions/9999", json={"category_id": _category_id(client, "courses")})
        assert resp.status_code == 404
        assert client.patch("/api/transactions/9999", json={"note": "x"}).status_code == 404

    def test_uncategorized_filter_excludes_transfers(self, seeded_db, client):
        perso = (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"10/06/2026";"10/06/2026";"VIR vers COMPTE JOINT";"100,00";""\n'
        )
        joint = (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"10/06/2026";"10/06/2026";"VIR de COMPTE PERSO";"";"100,00"\n'
            b'"11/06/2026";"11/06/2026";"MYSTERY SHOP";"10,00";""\n'
        )
        client.post("/api/imports", files={"file": ("RELEVE_COMPTE_PERSO_2026.csv", perso, "text/csv")})
        client.post("/api/imports", files={"file": ("RELEVE_COMPTE_JOINT_2026.csv", joint, "text/csv")})

        # The transfer legs are paired, the real expense is the only actionable uncategorised row.
        assert sum(1 for t in client.get("/api/transactions").json()["items"] if t["kind"] == "transfer") == 2
        uncategorized = client.get("/api/transactions", params={"uncategorized": True}).json()
        libelles = {t["libelle"] for t in uncategorized["items"]}
        assert libelles == {"MYSTERY SHOP"}

    def test_transaction_carries_kind(self, seeded_db, client):
        _upload(client)
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        salary = next(t for t in items if "EMPLOYEUR" in t["libelle"])
        assert salary["kind"] == "income"
        assert salary["account_id"] == "JOINT"
        groceries = next(t for t in items if "SUPERMARCHE" in t["libelle"])
        assert groceries["kind"] == "expense"


TRIAGE_CSV = (
    b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    b'"01/06/2026";"01/06/2026";"CARTE 01/06 BOULANGERIE DUPONT";"4,20";""\n'
    b'"08/06/2026";"08/06/2026";"CARTE 08/06 BOULANGERIE DUPONT";"5,80";""\n'
    b'"09/06/2026";"09/06/2026";"CARTE 09/06 LIBRAIRIE";"30,00";""\n'
    b'"10/06/2026";"10/06/2026";"CARTE LECLERC DRIVE";"40,00";""\n'
)


class TestTriage:
    def test_uncategorized_groups(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        groups = client.get("/api/transactions/uncategorized-groups").json()
        assert [(g["key"], g["count"]) for g in groups] == [
            ("CARTE LIBRAIRIE", 1),
            ("CARTE BOULANGERIE DUPONT", 2),
        ]
        bakery = groups[1]
        assert bakery["pattern"] == "BOULANGERIE DUPONT" and bakery["pattern_generic"] is False
        assert (bakery["debit"], bakery["credit"], bakery["accounts"]) == (10.0, 0.0, ["JOINT"])
        assert [t["date_valeur"] for t in bakery["transactions"]] == ["2026-06-08", "2026-06-01"]
        assert bakery["suggestion"] is None
        assert client.get("/api/transactions/uncategorized-groups", params={"month": "2026-01"}).json() == []

    def test_groups_carry_a_suggestion(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        courses = _category_id(client, "courses")
        bakery = client.get("/api/transactions/uncategorized-groups").json()[1]
        client.patch(f"/api/transactions/{bakery['transactions'][0]['id']}", json={"category_id": courses})
        bakery = client.get("/api/transactions/uncategorized-groups").json()[1]
        assert bakery["count"] == 1
        assert bakery["suggestion"] == {"category_id": courses, "count": 1, "token": None}

    def test_rule_preview_reports_rows_other_rules_lose(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        resp = client.get("/api/rules/preview", params={"pattern": "CARTE", "priority": 1})
        assert resp.status_code == 200
        body = resp.json()
        assert body["uncategorized"] == 3
        courses = _category_id(client, "courses")
        assert body["reclassified"] == [
            {
                "rule_id": body["reclassified"][0]["rule_id"],
                "pattern": "LECLERC",
                "category_id": courses,
                "count": 1,
            }
        ]
        same = client.get(
            "/api/rules/preview", params={"pattern": "CARTE", "priority": 1, "category_id": courses}
        )
        assert same.json()["reclassified"] == []
        assert client.get("/api/rules/preview", params={"pattern": "CARTE"}).json()["reclassified"] == []

    def test_groups_carry_transfer_candidates(self, db, client):
        import_rows(
            db,
            ("2026-09-03", "2026-09-03", "VIR INST LOCATAIRE DUPONT", 0, 570, "LOCATIF"),
            ("2026-09-04", "2026-09-04", "VIR de MOI MEME", 0, 570, "LOCATIF"),
            ("2026-09-03", "2026-09-03", "VIR vers LOGEMENT", 570, 0, "PERSO"),
        )
        groups = client.get("/api/transactions/uncategorized-groups").json()
        debit = next(g for g in groups if g["transactions"][0]["libelle"] == "VIR vers LOGEMENT")
        assert [(c["transaction_id"], c["partner"]["libelle"]) for c in debit["transfer_candidates"]] == [
            (debit["transactions"][0]["id"], "VIR INST LOCATAIRE DUPONT"),
            (debit["transactions"][0]["id"], "VIR de MOI MEME"),
        ]
        partner_id = debit["transfer_candidates"][1]["partner"]["id"]
        assert (
            client.post(
                "/api/transactions/transfer-pair",
                json={"transaction_ids": [debit["transactions"][0]["id"], partner_id]},
            ).status_code
            == 200
        )
        groups = client.get("/api/transactions/uncategorized-groups").json()
        assert [(g["transactions"][0]["libelle"], g["transfer_candidates"]) for g in groups] == [
            ("VIR INST LOCATAIRE DUPONT", [])
        ]

    def test_rule_preview_needs_a_pattern(self, client):
        resp = client.get("/api/rules/preview", params={"pattern": ""})
        assert resp.status_code == 422
        assert resp.json()["detail"][0]["msg"] == "Motif : ne peut pas être vide"

    def test_bulk_manual_assignment_and_undo(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        ids = [
            t["id"] for t in client.get("/api/transactions/uncategorized-groups").json()[1]["transactions"]
        ]
        courses = _category_id(client, "courses")
        resp = client.patch("/api/transactions", json={"ids": ids, "category_id": courses, "note": "pain"})
        assert resp.status_code == 200
        assert [(t["category"], t["category_manual"], t["note"]) for t in resp.json()] == [
            ("courses", True, "pain")
        ] * 2
        assert client.get("/api/transactions", params={"uncategorized": True}).json()["total"] == 1

        undo = client.patch("/api/transactions", json={"ids": ids, "category_id": None, "note": None})
        assert [(t["category_id"], t["category_manual"], t["note"]) for t in undo.json()] == [
            (None, False, None)
        ] * 2
        assert client.get("/api/transactions", params={"uncategorized": True}).json()["total"] == 3

    def test_bulk_clear_lets_rules_reclaim_rows(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        drive = client.get("/api/transactions", params={"libelle_contains": "LECLERC"}).json()["items"][0]
        bar = _category_id(client, "bar")
        client.patch("/api/transactions", json={"ids": [drive["id"]], "category_id": bar})
        (cleared,) = client.patch(
            "/api/transactions", json={"ids": [drive["id"]], "category_id": None}
        ).json()
        assert (cleared["category"], cleared["rule_pattern"]) == ("courses", "LECLERC")

    def test_bulk_assignment_errors(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        tx = client.get("/api/transactions").json()["items"][0]
        group = client.patch(
            "/api/transactions", json={"ids": [tx["id"]], "category_id": _category_id(client, "variable")}
        )
        assert group.status_code == 422
        unknown = client.patch("/api/transactions", json={"ids": [tx["id"]], "category_id": 9999})
        assert unknown.json()["detail"] == ["Catégorie 9999 introuvable"]
        missing = client.patch(
            "/api/transactions",
            json={"ids": [tx["id"], 9998, 9999], "category_id": _category_id(client, "bar")},
        )
        assert missing.status_code == 404
        assert missing.json()["detail"] == ["Opérations introuvables : 9998, 9999"]
        empty = client.patch("/api/transactions", json={"ids": [], "category_id": None})
        assert empty.json()["detail"][0]["msg"] == "Opérations : 1 élément(s) au minimum"


TRANSFER_PERSO = (
    b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    b'"10/06/2026";"10/06/2026";"VIR vers COMPTE JOINT";"100,00";""\n'
    b'"12/06/2026";"12/06/2026";"CARTE 12/06 SUPERMARCHE";"50,00";""\n'
)
TRANSFER_JOINT = (
    b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    b'"10/06/2026";"10/06/2026";"VIR de COMPTE PERSO";"";"100,00"\n'
    b'"13/06/2026";"13/06/2026";"VIR SEPA RECU /DE AMI";"";"50,00"\n'
)


def _upload_transfers(client) -> dict[str, dict]:
    client.post("/api/imports", files={"file": ("RELEVE_COMPTE_PERSO_2026.csv", TRANSFER_PERSO, "text/csv")})
    client.post("/api/imports", files={"file": ("RELEVE_COMPTE_JOINT_2026.csv", TRANSFER_JOINT, "text/csv")})
    return {t["libelle"]: t for t in client.get("/api/transactions").json()["items"]}


class TestTransferApi:
    def test_false_positive_not_paired_and_fields_exposed(self, db, client):
        rows = _upload_transfers(client)
        assert rows["VIR vers COMPTE JOINT"]["kind"] == "transfer"
        assert (
            rows["VIR vers COMPTE JOINT"]["transfer_group_id"]
            == rows["VIR de COMPTE PERSO"]["transfer_group_id"]
        )
        assert rows["VIR vers COMPTE JOINT"]["kind_manual"] is False
        assert rows["CARTE 12/06 SUPERMARCHE"]["kind"] == "expense"  # same amount, not a virement
        assert rows["CARTE 12/06 SUPERMARCHE"]["transfer_group_id"] is None

    def test_transfer_pair_endpoint(self, db, client):
        rows = _upload_transfers(client)
        card, friend = rows["CARTE 12/06 SUPERMARCHE"]["id"], rows["VIR SEPA RECU /DE AMI"]["id"]
        resp = client.post("/api/transactions/transfer-pair", json={"transaction_ids": [card, friend]})
        assert resp.status_code == 200
        legs = resp.json()
        assert {leg["kind"] for leg in legs} == {"transfer"}
        assert legs[0]["transfer_group_id"] == legs[1]["transfer_group_id"] is not None
        assert all(leg["kind_manual"] for leg in legs)

        two_debits = [card, rows["VIR vers COMPTE JOINT"]["id"]]
        assert (
            client.post("/api/transactions/transfer-pair", json={"transaction_ids": two_debits}).status_code
            == 422
        )
        assert (
            client.post("/api/transactions/transfer-pair", json={"transaction_ids": [card, 9999]}).status_code
            == 404
        )
        assert (
            client.post("/api/transactions/transfer-pair", json={"transaction_ids": [card]}).status_code
            == 422
        )

    def test_transfer_mode_unpair_endpoint(self, db, client):
        rows = _upload_transfers(client)
        leg = rows["VIR vers COMPTE JOINT"]["id"]
        resp = client.put(f"/api/transactions/{leg}/transfer", json={"mode": "none"})
        assert resp.status_code == 200
        assert {t["kind"] for t in resp.json()} == {"income", "expense"}
        uncategorized = {
            t["libelle"]
            for t in client.get("/api/transactions", params={"uncategorized": True}).json()["items"]
        }
        assert {"VIR vers COMPTE JOINT", "VIR de COMPTE PERSO"} <= uncategorized
        assert client.put(f"/api/transactions/{leg}/transfer", json={"mode": "bogus"}).status_code == 422
        assert client.put("/api/transactions/9999/transfer", json={"mode": "auto"}).status_code == 404

    def test_manual_transfer_filter(self, db, client):
        rows = _upload_transfers(client)
        assert client.get("/api/transactions", params={"manual_transfer": True}).json()["total"] == 0
        card, friend = rows["CARTE 12/06 SUPERMARCHE"]["id"], rows["VIR SEPA RECU /DE AMI"]["id"]
        client.post("/api/transactions/transfer-pair", json={"transaction_ids": [card, friend]})
        items = client.get("/api/transactions", params={"manual_transfer": True}).json()["items"]
        assert {t["id"] for t in items} == {card, friend}
        assert items[0]["transfer_group_id"] == items[1]["transfer_group_id"] is not None

        client.put(f"/api/transactions/{card}/transfer", json={"mode": "auto"})
        assert client.get("/api/transactions", params={"manual_transfer": True}).json()["total"] == 0

    def test_transfer_markers_endpoints(self, db, client):
        assert client.get("/api/transfer-markers").json() == {"markers": ["VIR"], "is_default": True}
        rows = _upload_transfers(client)
        assert rows["CARTE 12/06 SUPERMARCHE"]["kind"] == "expense"

        resp = client.put("/api/transfer-markers", json={"markers": ["*"]})
        assert resp.json() == {"markers": ["*"], "is_default": False}
        kinds = {t["libelle"]: t["kind"] for t in client.get("/api/transactions").json()["items"]}
        assert kinds["CARTE 12/06 SUPERMARCHE"] == "transfer"  # any label pairs again

        assert client.put("/api/transfer-markers", json={"markers": []}).json()["is_default"] is True


class TestCategories:
    def test_create_toplevel_and_delete(self, client):
        resp = client.post("/api/categories", json={"name": "voyage", "parent_id": None})
        assert resp.status_code == 201
        body = resp.json()
        assert body["parent_id"] is None
        assert body["is_root"] is True
        assert body["path"] == "voyage"
        assert client.delete(f"/api/categories/{body['id']}").status_code == 204

    def test_rename(self, seeded_db, client):
        bar = _category_id(client, "bar")
        sortie = _category_id(client, "sortie")
        resp = client.put(f"/api/categories/{bar}", json={"name": "bistrot", "parent_id": sortie})
        assert resp.status_code == 200
        assert resp.json()["path"].endswith("sortie / bistrot")

    def test_cycle_rejected(self, seeded_db, client):
        sortie = _category_id(client, "sortie")
        bar = _category_id(client, "bar")
        resp = client.put(f"/api/categories/{sortie}", json={"name": "sortie", "parent_id": bar})
        assert resp.status_code == 422
        assert resp.json()["detail"][0].startswith("Une catégorie ne peut pas être déplacée sous elle-même")

    def test_subdivide_migrates_to_child(self, seeded_db, client):
        # Adding a child to a populated leaf moves its rules + transactions down into the new child;
        # the leaf becomes a clean group (leaf-only invariant preserved).
        _upload(client)
        courses = _category_id(client, "courses")
        assert client.post("/api/categories", json={"name": "bio", "parent_id": courses}).status_code == 201

        cats = {c["name"]: c for c in client.get("/api/categories").json()}
        assert cats["courses"]["rule_count"] == 0  # rules moved down
        assert cats["bio"]["rule_count"] == 2  # SUPERMARCHE + LECLERC
        # 'courses' is now a group -> rules can no longer target it.
        resp = client.post("/api/rules", json={"category_id": courses, "pattern": "X"})
        assert resp.status_code == 422
        assert resp.json()["detail"] == ["« courses » est un groupe : choisissez une de ses sous-catégories"]
        # The matching transaction now lives under the new leaf.
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        assert next(t for t in items if "SUPERMARCHE" in t["libelle"])["category"] == "bio"

    def test_delete_category_with_children_blocked(self, seeded_db, client):
        resp = client.delete(f"/api/categories/{_category_id(client, 'sortie')}")
        assert resp.status_code == 409

    def test_delete_last_child_rolls_up(self, seeded_db, client):
        # 'bar' is the only child of 'sortie'; deleting it rolls its rule + transaction up to
        # 'sortie', which becomes a leaf again.
        _upload(client)
        assert client.delete(f"/api/categories/{_category_id(client, 'bar')}").status_code == 204

        cats = {c["name"]: c for c in client.get("/api/categories").json()}
        assert "bar" not in cats
        assert cats["sortie"]["rule_count"] == 1  # ANGELUS rule survived, now on 'sortie'
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        assert next(t for t in items if "ANGELUS" in t["libelle"])["category"] == "sortie"

    def test_delete_non_last_child_drops(self, seeded_db, client):
        # 'courses' is one of 'variable's two children; deleting it drops its rules and uncategorises
        # its transactions (rolling up would make 'variable' a populated parent-with-children).
        _upload(client)
        assert client.delete(f"/api/categories/{_category_id(client, 'courses')}").status_code == 204
        uncategorized = client.get("/api/transactions", params={"uncategorized": True}).json()
        assert any("SUPERMARCHE" in t["libelle"] for t in uncategorized["items"])

    def test_move_rules_and_manual_assignments(self, seeded_db, client):
        _upload(client)
        courses = _category_id(client, "courses")
        marche = client.post(
            "/api/categories", json={"name": "marché", "parent_id": _category_id(client, "variable")}
        )
        marche_id = marche.json()["id"]
        mystery = client.get("/api/transactions", params={"libelle_contains": "MYSTERY"}).json()["items"][0]
        client.patch(f"/api/transactions/{mystery['id']}", json={"category_id": courses, "note": "fleurs"})
        supermarche = next(r for r in client.get("/api/rules").json() if r["pattern"] == "SUPERMARCHE")

        resp = client.post(
            f"/api/categories/{marche_id}/move",
            json={"rule_ids": [supermarche["id"]], "transaction_ids": [mystery["id"]]},
        )
        assert resp.status_code == 204, resp.text

        items = {t["libelle"]: t for t in client.get("/api/transactions").json()["items"]}
        # The rule took its operation along; the manual row kept its note and stays manual.
        assert (items["CARTE SUPERMARCHE"]["category"], items["CARTE SUPERMARCHE"]["rule_pattern"]) == (
            "marché",
            "SUPERMARCHE",
        )
        moved = items["MYSTERY SHOP"]
        assert (moved["category"], moved["category_manual"], moved["note"]) == ("marché", True, "fleurs")
        cats = {c["name"]: c for c in client.get("/api/categories").json()}
        assert (cats["courses"]["rule_count"], cats["marché"]["rule_count"]) == (1, 1)

        # Undo = the same call back to the original leaf.
        back = client.post(
            f"/api/categories/{courses}/move",
            json={"rule_ids": [supermarche["id"]], "transaction_ids": [mystery["id"]]},
        )
        assert back.status_code == 204
        items = {t["libelle"]: t for t in client.get("/api/transactions").json()["items"]}
        assert items["CARTE SUPERMARCHE"]["category"] == items["MYSTERY SHOP"]["category"] == "courses"

    def test_move_errors_change_nothing(self, seeded_db, client):
        _upload(client)
        bar = _category_id(client, "bar")
        rule = client.get("/api/rules").json()[0]
        auto = client.get("/api/transactions", params={"libelle_contains": "SUPERMARCHE"}).json()["items"][0]

        def move(category_id: int, **body):
            return client.post(f"/api/categories/{category_id}/move", json=body)

        group = move(_category_id(client, "variable"), rule_ids=[rule["id"]])
        assert (group.status_code, group.json()["detail"]) == (
            422,
            ["« variable » est un groupe : choisissez une de ses sous-catégories"],
        )
        assert move(9999, rule_ids=[rule["id"]]).status_code == 404
        assert move(bar).json()["detail"] == ["Rien à déplacer : cochez au moins une règle ou une opération"]
        missing = move(bar, rule_ids=[rule["id"], 9999])
        assert (missing.status_code, missing.json()["detail"]) == (404, ["Règles introuvables : 9999"])
        # An operation classified by a rule follows it: it is not movable on its own.
        automatic = move(bar, rule_ids=[rule["id"]], transaction_ids=[auto["id"]])
        assert automatic.status_code == 422
        assert automatic.json()["detail"] == [
            f"Seules les opérations classées à la main se déplacent : {auto['id']} suivent leur règle"
        ]
        assert client.get("/api/rules").json()[0]["category_id"] == rule["category_id"]  # nothing moved

    def test_duplicate_name_same_parent_rejected(self, seeded_db, client):
        variable = _category_id(client, "variable")
        resp = client.post("/api/categories", json={"name": "courses", "parent_id": variable})
        assert resp.status_code == 409
        assert resp.json()["detail"][0].startswith("« courses » existe déjà à cet endroit")


class TestRules:
    def test_rule_create_triggers_recategorization(self, seeded_db, client):
        _upload(client)
        resp = client.post(
            "/api/rules",
            json={"category_id": _category_id(client, "courses"), "pattern": "MYSTERY SHOP"},
        )
        assert resp.status_code == 201
        uncategorized = client.get("/api/transactions", params={"uncategorized": True}).json()
        assert uncategorized["total"] == 0

    def test_rule_delete_uncategorizes(self, seeded_db, client):
        _upload(client)
        rule = client.post(
            "/api/rules",
            json={"category_id": _category_id(client, "courses"), "pattern": "MYSTERY SHOP"},
        ).json()
        client.delete(f"/api/rules/{rule['id']}")
        uncategorized = client.get("/api/transactions", params={"uncategorized": True}).json()
        assert uncategorized["total"] == 1

    def test_priority_decides_winner(self, seeded_db, client):
        _upload(client)
        bar = _category_id(client, "bar")
        # Lower priority number than the seeded SUPERMARCHE rule (2) -> wins
        client.post("/api/rules", json={"category_id": bar, "pattern": "SUPERMARCHE", "priority": 0})
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        groceries = next(t for t in items if "SUPERMARCHE" in t["libelle"])
        assert groceries["category"] == "bar"

    def test_rules_carry_what_they_classify(self, seeded_db, client):
        _upload(client)
        rules = {r["pattern"]: r for r in client.get("/api/rules").json()}
        assert (rules["SUPERMARCHE"]["operation_count"], rules["SUPERMARCHE"]["debit"]) == (1, 63.82)
        assert (rules["EMPLOYEUR"]["operation_count"], rules["EMPLOYEUR"]["credit"]) == (1, 2500.0)
        assert rules["LECLERC"]["operation_count"] == 0
        listed = client.get("/api/transactions", params={"rule_id": rules["SUPERMARCHE"]["id"]}).json()
        assert [t["libelle"] for t in listed["items"]] == ["CARTE SUPERMARCHE"]

        # A manual assignment leaves its rule's count; a created rule reports its own.
        supermarche = listed["items"][0]
        client.patch(
            f"/api/transactions/{supermarche['id']}", json={"category_id": _category_id(client, "bar")}
        )
        assert (
            next(r for r in client.get("/api/rules").json() if r["pattern"] == "SUPERMARCHE")[
                "operation_count"
            ]
            == 0
        )
        created = client.post(
            "/api/rules", json={"category_id": _category_id(client, "bar"), "pattern": "MYSTERY"}
        )
        assert (created.json()["operation_count"], created.json()["debit"]) == (1, 10.0)

    def test_rule_rejects_unknown_category(self, client):
        resp = client.post("/api/rules", json={"category_id": 9999, "pattern": "X"})
        assert resp.status_code == 422

    def test_rule_rejects_group_category(self, seeded_db, client):
        resp = client.post(
            "/api/rules", json={"category_id": _category_id(client, "variable"), "pattern": "X"}
        )
        assert resp.status_code == 422  # 'variable' is a group; rules must target a leaf

    def test_anchor_rule_mutation_moves_periods(self, seeded_db, client):
        # Salary deposit late in June + spending after it
        csv = (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"28/06/2026";"28/06/2026";"VIR EMPLOYEUR SALAIRE";"";"2500,00"\n'
            b'"29/06/2026";"29/06/2026";"CARTE SUPERMARCHE";"50,00";""\n'
        )
        client.post("/api/imports", files={"file": ("RELEVE_COMPTE_JOINT_2026.csv", csv, "text/csv")})
        months = {t["libelle"]: t["budget_month"] for t in client.get("/api/transactions").json()["items"]}
        assert months["CARTE SUPERMARCHE"] == "2026-07"  # paid from the July paycheck

        # Un-flag the anchor: periods fall back to calendar months
        rules = client.get("/api/rules").json()
        anchor = next(r for r in rules if r["is_income_anchor"])
        anchor["is_income_anchor"] = False
        rule_id = anchor.pop("id")
        client.put(f"/api/rules/{rule_id}", json=anchor)
        months = {t["libelle"]: t["budget_month"] for t in client.get("/api/transactions").json()["items"]}
        assert months["CARTE SUPERMARCHE"] == "2026-06"


class TestDashboard:
    def test_dashboard_aggregates(self, seeded_db, client):
        _upload(client)
        resp = client.get("/api/dashboard", params={"month": "2026-06"})
        body = resp.json()
        assert body["month"] == "2026-06"
        assert body["months_available"] == ["2026-06"]
        assert body["income"] == 2500.0
        # Totals are by transaction kind, so uncategorised real expenses count too.
        assert body["expenses"] == 85.82  # 63.82 + 12.00 + 10.00 (MYSTERY SHOP)
        assert body["uncategorized"]["count"] == 1
        # The uncategorised residual surfaces as a node in the balance tree.
        unc = next(n for n in body["by_category"]["children"] if n["name"] == "uncategorised")
        assert unc["balance"] == body["uncategorized"]["difference"]
        # Reconciliation: Revenus − Dépenses − Épargne nette = Reste, and Reste == the tree total.
        assert (body["epargne"], body["desepargne"]) == (0.0, 0.0)
        assert body["reste"] == round(body["income"] - body["expenses"], 2) == 2414.18
        assert body["reste"] == body["by_category"]["balance"]
        # History carries this month for the trend/deltas, reste matching the headline.
        assert body["history"][-1]["month"] == "2026-06"
        assert body["history"][-1]["reste"] == body["reste"]

    def test_categorised_epargne_and_deficit_rows_not_double_counted(self, db, client):
        # Real rows categorised under the Épargne / Déficit groups are ordinary income/expenses;
        # only the derived savings-account leaves feed the Épargne card. Before the fix a loan
        # credit under Déficit counted in both income and désépargne (Reste off by its amount).
        with connect(db) as conn:
            epargne = conn.execute("INSERT INTO categories (name) VALUES ('Épargne')").lastrowid
            deficit = conn.execute("INSERT INTO categories (name) VALUES ('Déficit')").lastrowid
            emprunt = conn.execute(
                "INSERT INTO categories (name, parent_id) VALUES ('Emprunt', ?)", (deficit,)
            ).lastrowid
            conn.execute(
                "INSERT INTO label_rules (category_id, pattern) VALUES (?, 'VERSEMENT PEL')", (epargne,)
            )
        import_rows(
            db,
            ("2026-06-02", "2026-06-02", "VIR PRET CONSO", 0, 1000, "PERSO"),
            ("2026-06-03", "2026-06-03", "VERSEMENT PEL", 200, 0, "PERSO"),
            ("2026-06-04", "2026-06-04", "COURSES", 50, 0, "PERSO"),
            ("2026-06-05", "2026-06-05", "VIR de COMPTE", 0, 300, "LIVRET"),  # derived Épargne leaf
        )
        client.post("/api/rules", json={"category_id": emprunt, "pattern": "PRET CONSO"})  # re-applies rules

        body = client.get("/api/dashboard", params={"month": "2026-06"}).json()
        assert (body["income"], body["expenses"]) == (1300.0, 250.0)  # the LIVRET credit is income too
        assert (body["epargne"], body["desepargne"]) == (300.0, 0.0)
        assert body["reste"] == body["by_category"]["balance"] == body["history"][-1]["reste"] == 750.0

    def test_defaults_to_latest_month(self, seeded_db, client):
        _upload(client)
        body = client.get("/api/dashboard").json()
        assert body["month"] == "2026-06"

    def test_all_months(self, seeded_db, client):
        _upload(client)
        may = (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"04/05/2026";"04/05/2026";"CARTE SUPERMARCHE";"40,00";""\n'
        )
        _upload(client, filename="RELEVE_COMPTE_JOINT_2026_05_08.csv", content=may)
        body = client.get("/api/dashboard", params={"month": "all"}).json()
        assert body["month"] == "all"
        assert len(body["history"]) == 2
        assert body["income"] == pytest.approx(sum(h["income"] for h in body["history"]))
        assert body["expenses"] == pytest.approx(sum(h["expenses"] for h in body["history"]))
        assert body["reste"] == pytest.approx(body["by_category"]["balance"])

    def test_averages(self, seeded_db, client):
        _upload(client)
        may = (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"04/05/2026";"04/05/2026";"CARTE SUPERMARCHE";"40,00";""\n'
        )
        _upload(client, filename="RELEVE_COMPTE_JOINT_2026_05_08.csv", content=may)
        body = client.get("/api/dashboard/averages", params={"months": "3", "month": "2026-06"}).json()
        # June is the latest budget month: May is the only complete one.
        assert (body["months"], body["first_month"], body["current_month"]) == (1, "2026-05", "2026-06")
        assert body["totals"]["expenses"] == 40
        variable = next(g for g in body["groups"] if g["name"] == "variable")
        assert (variable["expenses"], variable["month_expenses"]) == (40, 75.82)  # courses 63.82 + bar 12
        every = client.get("/api/dashboard/averages", params={"months": "all", "month": "all"}).json()
        assert every["month"] is None and every["uncategorized"]["month_expenses"] is None

    def test_averages_rejects_an_unknown_period(self, client):
        resp = client.get("/api/dashboard/averages", params={"months": "7"})
        assert resp.status_code == 422
        assert resp.json()["detail"][0]["msg"] == "Période : valeur attendue : '3', '6', '12' ou 'all'"


class TestExport:
    def test_export_categories_csv(self, seeded_db, tmp_path):
        body = (_export(seeded_db, tmp_path) / "categories.csv").read_text(encoding="utf-8-sig")
        assert body.splitlines()[0] == "path;budget_target"
        assert "fixe / salaire" in body
        assert "variable / sortie / bar" in body

    def test_export_rules_csv(self, seeded_db, tmp_path):
        body = (_export(seeded_db, tmp_path) / "rules.csv").read_text(encoding="utf-8-sig")
        assert body.splitlines()[0] == "category_path;pattern;priority;is_income_anchor;description"
        assert "fixe / salaire;EMPLOYEUR;1;1;" in body
        assert "variable / sortie / bar;ANGELUS;4;0;" in body

    def test_round_trip(self, seeded_db, client, tmp_path):
        def snapshot(db_path):
            with connect(db_path) as conn:
                paths = sorted(c.path for c in _load_all(conn))
                cat_paths = category_paths(conn)
                rules = sorted(
                    (cat_paths[cid], pattern, priority, anchor, description)
                    for cid, pattern, priority, anchor, description in conn.execute(
                        "SELECT category_id, pattern, priority, is_income_anchor, description FROM label_rules"
                    )
                )
            return paths, rules

        # Give a rule a description so the round-trip actually proves descriptions survive.
        client.post(
            "/api/rules",
            json={
                "category_id": _category_id(client, "bar"),
                "pattern": "GUINNESS",
                "priority": 9,
                "is_income_anchor": False,
                "description": "pub du vendredi",
            },
        )

        cfg = _export(seeded_db, tmp_path)
        cats_csv, rules_csv = cfg / "categories.csv", cfg / "rules.csv"

        before = snapshot(seeded_db)

        fresh = tmp_path / "fresh.db"
        init_db(fresh)
        import_csv(cats_csv, rules_csv, fresh)

        assert snapshot(fresh) == before

    def test_export_overrides_csv(self, seeded_db, client, tmp_path):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses})

        body = (_export(seeded_db, tmp_path) / "overrides.csv").read_text(encoding="utf-8-sig")
        assert body.splitlines()[0] == (
            "import_hash;category_path;kind;libelle;note;transfer_pair;"
            "account_id;date_operation;debit_cents;credit_cents"
        )
        line = next(line for line in body.splitlines()[1:] if "MYSTERY SHOP" in line)
        assert (
            ";variable / courses;;MYSTERY SHOP;;;JOINT;2026-06-08;1000;0" in line
        )  # manual, no kind, no note

    def test_export_transactions_for_a_spreadsheet(self, seeded_db, client):
        _upload(client)
        mystery = client.get("/api/transactions", params={"libelle_contains": "MYSTERY"}).json()["items"][0]
        client.patch(f"/api/transactions/{mystery['id']}", json={"note": "à vérifier"})

        resp = client.get("/api/transactions/export", params={"month": "2026-06"})
        assert resp.headers["content-disposition"] == 'attachment; filename="transactions_2026-06.csv"'
        lines = resp.content.decode("utf-8-sig").splitlines()
        assert lines[0] == (
            "Date opération;Date valeur;Mois budgétaire;Compte;Libellé;Débit;Crédit;Type;Catégorie;Note"
        )
        assert lines[1:] == [  # oldest first, French dates and decimals, full category path
            "05/06/2026;05/06/2026;2026-06;JOINT;VIR EMPLOYEUR SALAIRE;;2500,00;revenu;fixe / salaire;",
            "06/06/2026;06/06/2026;2026-06;JOINT;CARTE SUPERMARCHE;63,82;;dépense;variable / courses;",
            "07/06/2026;07/06/2026;2026-06;JOINT;BAR ANGELUS;12,00;;dépense;variable / sortie / bar;",
            "08/06/2026;08/06/2026;2026-06;JOINT;MYSTERY SHOP;10,00;;dépense;;à vérifier",
        ]

    def test_export_transactions_applies_the_list_filters(self, seeded_db, client):
        _upload(client)
        resp = client.get("/api/transactions/export", params={"uncategorized": True})
        assert resp.headers["content-disposition"] == 'attachment; filename="transactions_tout.csv"'
        lines = resp.content.decode("utf-8-sig").splitlines()
        assert [line.split(";")[4] for line in lines[1:]] == ["MYSTERY SHOP"]
        assert len(client.get("/api/transactions/export", params={"month": "2026-07"}).text.splitlines()) == 1

    def test_overrides_round_trip(self, seeded_db, client, tmp_path):
        # Source DB: import, set a manual category + note, and (directly) a manual kind.
        _upload(client)
        mystery = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        client.patch(
            f"/api/transactions/{mystery['id']}",
            json={"category_id": _category_id(client, "courses"), "note": "remboursé par Léa"},
        )
        with connect(seeded_db) as conn:
            conn.execute(
                "UPDATE transactions SET kind = 'income', kind_manual = 1 WHERE libelle = 'BAR ANGELUS'"
            )

        cfg = _export(seeded_db, tmp_path)
        cats, rules, overrides = cfg / "categories.csv", cfg / "rules.csv", cfg / "overrides.csv"

        # Fresh DB with the same transactions (same hashes), then restore everything.
        fresh = make_db(tmp_path / "fresh.db")
        with TestClient(create_app(fresh)) as fresh_client:
            _upload(fresh_client)
        import_csv(cats, rules, fresh, overrides)

        with connect(fresh) as conn:
            cat = conn.execute(
                "SELECT t.category_manual, c.name, t.note FROM transactions t "
                "LEFT JOIN categories c ON c.id = t.category_id WHERE t.libelle = 'MYSTERY SHOP'"
            ).fetchone()
            assert cat == (1, "courses", "remboursé par Léa")  # note survived the round-trip
            bar = conn.execute(
                "SELECT kind, kind_manual FROM transactions WHERE libelle = 'BAR ANGELUS'"
            ).fetchone()
            assert bar == ("income", 1)


class TestTransferOverrides:
    def test_manual_pair_and_unpair_round_trip(self, db, client, tmp_path):
        rows = _upload_transfers(client)
        client.post(
            "/api/transactions/transfer-pair",
            json={
                "transaction_ids": [
                    rows["CARTE 12/06 SUPERMARCHE"]["id"],
                    rows["VIR SEPA RECU /DE AMI"]["id"],
                ]
            },
        )
        client.put(f"/api/transactions/{rows['VIR vers COMPTE JOINT']['id']}/transfer", json={"mode": "none"})
        cfg = _export(db, tmp_path)
        cats, rules, overrides = cfg / "categories.csv", cfg / "rules.csv", cfg / "overrides.csv"
        assert overrides.read_text(encoding="utf-8-sig").count(";") > 0

        fresh = make_db(tmp_path / "fresh.db")
        with TestClient(create_app(fresh)) as fresh_client:
            _upload_transfers(fresh_client)
        import_csv(cats, rules, fresh, overrides)

        with connect(fresh) as conn:
            state = {
                lib: (kind, manual, group)
                for lib, kind, manual, group in conn.execute(
                    "SELECT libelle, kind, kind_manual, transfer_group_id FROM transactions"
                )
            }
        card, friend = state["CARTE 12/06 SUPERMARCHE"], state["VIR SEPA RECU /DE AMI"]
        assert card[:2] == friend[:2] == ("transfer", 1) and card[2] == friend[2] is not None
        assert state["VIR vers COMPTE JOINT"] == ("expense", 1, None)
        assert state["VIR de COMPTE PERSO"] == ("income", 1, None)

    def test_old_overrides_csv_without_transfer_pair_loads(self, seeded_db, client, tmp_path):
        _upload(client)
        with connect(seeded_db) as conn:
            hash_ = conn.execute(
                "SELECT import_hash FROM transactions WHERE libelle = 'MYSTERY SHOP'"
            ).fetchone()[0]
        cfg = _export(seeded_db, tmp_path)
        cats, rules, overrides = cfg / "categories.csv", cfg / "rules.csv", cfg / "overrides.csv"
        overrides.write_text(
            f"import_hash;category_path;kind;libelle;note\n{hash_};variable / courses;;MYSTERY SHOP;vieux\n",
            encoding="utf-8",
        )
        import_csv(cats, rules, seeded_db, overrides)
        with connect(seeded_db) as conn:
            assert conn.execute(
                "SELECT category_manual, note FROM transactions WHERE libelle = 'MYSTERY SHOP'"
            ).fetchone() == (1, "vieux")


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


def _targets(db_path) -> dict[str, int | None]:
    with connect(db_path) as conn:
        return dict(conn.execute("SELECT name, budget_target_cents FROM categories").fetchall())


RULES_HEADER_ONLY = "category_path;pattern;priority;is_income_anchor;description\n"


class TestFrenchValidationErrors:
    """Pydantic's English messages are rewritten (api/errors.py): the pages show `msg` as it is."""

    def test_negative_target(self, seeded_db, client):
        resp = client.put(f"/api/categories/{_category_id(client, 'bar')}/target", json={"budget_target": -5})
        assert resp.status_code == 422
        [error] = resp.json()["detail"]
        assert error["msg"] == "Objectif : la valeur doit être supérieure à 0"
        assert (error["type"], error["loc"]) == ("greater_than", ["body", "budget_target"])  # shape kept

    def test_rule_fields(self, seeded_db, client):
        resp = client.post(
            "/api/rules", json={"category_id": _category_id(client, "bar"), "pattern": "", "priority": 1.5}
        )
        assert [e["msg"] for e in resp.json()["detail"]] == [
            "Motif : ne peut pas être vide",
            "Priorité : un nombre entier est attendu",
        ]

    def test_without_a_field(self, client):
        resp = client.post("/api/rules", content=b"{bad", headers={"Content-Type": "application/json"})
        assert [e["msg"] for e in resp.json()["detail"]] == ["Requête illisible (JSON invalide)"]

    def test_list_item_and_constraints(self, client):
        resp = client.put("/api/transfer-markers", json={"markers": [1]})
        assert [e["msg"] for e in resp.json()["detail"]] == ["Marqueurs : un texte est attendu"]
        resp = client.post("/api/transactions/transfer-pair", json={"transaction_ids": [1]})
        assert [e["msg"] for e in resp.json()["detail"]] == ["Opérations : 2 élément(s) au minimum"]
        resp = client.put("/api/transactions/1/transfer", json={"mode": "x"})
        assert [e["msg"] for e in resp.json()["detail"]] == [
            "Mode : valeur attendue : 'transfer', 'none' ou 'auto'"
        ]

    def test_unknown_type_and_field(self):
        assert french_message({"type": "uuid_parsing", "loc": ("query", "ref")}) == "ref : valeur invalide"
        assert french_message({"type": "greater_than", "loc": ("body", "x")}) == "x : valeur invalide"
        assert french_message({"type": "less_than_equal", "loc": ("body",), "ctx": {"le": 2.5}}) == (
            "La valeur doit être inférieure ou égale à 2,5"
        )


class TestBudgetTargets:
    def test_set_and_clear(self, seeded_db, client):
        bar = _category_id(client, "bar")
        resp = client.put(f"/api/categories/{bar}/target", json={"budget_target": 45.5})
        assert resp.status_code == 200
        assert resp.json()["budget_target"] == 45.5
        assert _targets(seeded_db)["bar"] == 4550
        cats = {c["name"]: c for c in client.get("/api/categories").json()}
        assert (cats["bar"]["budget_target"], cats["sortie"]["budget_target"]) == (45.5, None)
        resp = client.put(f"/api/categories/{bar}/target", json={"budget_target": None})
        assert resp.json()["budget_target"] is None

    def test_rejections(self, seeded_db, client):
        sortie = _category_id(client, "sortie")
        bar = _category_id(client, "bar")
        assert client.put(f"/api/categories/{sortie}/target", json={"budget_target": 10}).status_code == 422
        assert client.put(f"/api/categories/{bar}/target", json={"budget_target": 0}).status_code == 422
        assert client.put("/api/categories/9999/target", json={"budget_target": 10}).status_code == 404
        # Rounds to 0 cents: rejected rather than stored as a zero target.
        assert client.put(f"/api/categories/{bar}/target", json={"budget_target": 0.001}).status_code == 422

    def test_dashboard_without_transactions(self, seeded_db, client):
        """A fresh DB with targets (data/ ships some) but nothing imported yet."""
        client.put(f"/api/categories/{_category_id(client, 'bar')}/target", json={"budget_target": 60})
        resp = client.get("/api/dashboard")
        assert resp.status_code == 200
        budget = resp.json()["budget"]
        assert (budget["months"], budget["target"], budget["actual"]) == (1, 60, 0)

    def test_subdivide_moves_target_down(self, seeded_db, client):
        courses = _category_id(client, "courses")
        client.put(f"/api/categories/{courses}/target", json={"budget_target": 300})
        client.post("/api/categories", json={"name": "bio", "parent_id": courses})
        targets = _targets(seeded_db)
        assert (targets["courses"], targets["bio"]) == (None, 30000)

    def test_delete_last_child_rolls_target_up(self, seeded_db, client):
        bar = _category_id(client, "bar")
        client.put(f"/api/categories/{bar}/target", json={"budget_target": 60})
        client.delete(f"/api/categories/{bar}")
        assert _targets(seeded_db)["sortie"] == 6000

    def test_delete_with_siblings_drops_target(self, seeded_db, client):
        courses = _category_id(client, "courses")
        client.put(f"/api/categories/{courses}/target", json={"budget_target": 300})
        client.delete(f"/api/categories/{courses}")
        assert _targets(seeded_db)["variable"] is None

    def test_reparent_under_targeted_leaf_rejected(self, seeded_db, client):
        courses = _category_id(client, "courses")
        client.put(f"/api/categories/{courses}/target", json={"budget_target": 300})
        created = client.post("/api/categories", json={"name": "voyage", "parent_id": None}).json()
        resp = client.put(f"/api/categories/{created['id']}", json={"name": "voyage", "parent_id": courses})
        assert resp.status_code == 422
        assert resp.json()["detail"][0].startswith(
            "« courses » a déjà des opérations, des règles ou un objectif"
        )

    def test_export_and_round_trip(self, seeded_db, client, tmp_path):
        client.put(f"/api/categories/{_category_id(client, 'bar')}/target", json={"budget_target": 12.5})
        body = (_export(seeded_db, tmp_path) / "categories.csv").read_text(encoding="utf-8-sig")
        assert body.splitlines()[0] == "path;budget_target"
        assert "variable / sortie / bar;12.50\n" in body
        assert "variable / sortie;\n" in body

        cats_csv = tmp_path / "categories.csv"
        cats_csv.write_text(body, encoding="utf-8")
        rules_csv = tmp_path / "rules.csv"
        rules_csv.write_text(RULES_HEADER_ONLY, encoding="utf-8")
        fresh = tmp_path / "fresh.db"
        init_db(fresh)
        import_csv(cats_csv, rules_csv, fresh)
        assert _targets(fresh) == _targets(seeded_db)

    def test_loader_formats(self, tmp_path, capsys):
        rules_csv = tmp_path / "rules.csv"
        rules_csv.write_text(RULES_HEADER_ONLY, encoding="utf-8")
        fresh = tmp_path / "fresh.db"
        init_db(fresh)
        # An older path-only file still loads, with no targets.
        cats_csv = tmp_path / "categories.csv"
        cats_csv.write_text("path\nfixe\nfixe / salaire\n", encoding="utf-8")
        import_csv(cats_csv, rules_csv, fresh)
        assert _targets(fresh) == {"fixe": None, "salaire": None}
        # Comma decimals and thousands spaces are accepted; a target on a group is dropped.
        cats_csv.write_text(
            "path;budget_target\nvariable;100\nvariable / courses;1 234,50\n", encoding="utf-8"
        )
        import_csv(cats_csv, rules_csv, fresh)
        assert _targets(fresh) == {"variable": None, "courses": 123450}
        assert "Dropping budget target on group 'variable'" in capsys.readouterr().out
        cats_csv.write_text("path;budget_target\nvariable;-5\n", encoding="utf-8")
        with pytest.raises(ValueError, match="line 2"):
            import_csv(cats_csv, rules_csv, fresh)

    def test_dashboard_budget(self, seeded_db, client):
        _upload(client)
        client.put(f"/api/categories/{_category_id(client, 'courses')}/target", json={"budget_target": 50})
        body = client.get("/api/dashboard", params={"month": "2026-06"}).json()
        budget = body["budget"]
        assert (budget["months"], budget["target"], budget["actual"]) == (1, 50, 63.82)
        assert budget["untargeted"] == 22.0  # BAR ANGELUS + MYSTERY SHOP
        assert budget["groups"][0]["leaves"] == [
            {"id": _category_id(client, "courses"), "name": "courses", "target": 50, "actual": 63.82}
        ]
        # The budget is read-only context: the cards still reconcile with the tree.
        assert body["reste"] == body["by_category"]["balance"]
        every = client.get("/api/dashboard", params={"month": "all"}).json()["budget"]
        assert (every["months"], every["target"]) == (1, 50)
