"""POST /api/config/export: the Réglages « Enregistrer la configuration » button."""

import sqlite3
from pathlib import Path

from app.core import config_export
from app.core.config_export import (
    CONFIG_FILES,
    account_rows,
    category_paths,
    category_rows,
    export_config,
    override_rows,
    rule_rows,
)
from app.db import connect, get_transfer_markers
from tests.conftest import isolate_reset_db
from tests.test_api import _category_id, _upload, _upload_transfers

PRESERVED = {
    "bank_profiles.toml": b'[profiles.ma_banque]\ndelimiter = ","\n',
    "settings.toml": b"start_date = 2026-03-25\n",
    "notes.txt": "à garder\n".encode(),
}


def _config(tmp_path):
    return tmp_path / "_config"


def _write_preserved(tmp_path) -> None:
    _config(tmp_path).mkdir(exist_ok=True)
    for name, content in PRESERVED.items():
        (_config(tmp_path) / name).write_bytes(content)


def _state(db_path) -> dict:
    """Everything the config files carry, comparable across two DBs (ids differ)."""
    with connect(db_path) as conn:
        paths = category_paths(conn)
        return {
            "accounts": account_rows(conn),
            "categories": category_rows(conn),
            "rules": rule_rows(conn, paths),
            "overrides": sorted(override_rows(conn, paths)),
            "markers": get_transfer_markers(conn),
        }


def test_tests_never_write_the_real_config_dir(client, tmp_path):
    assert client.app.state.config_dir == _config(tmp_path)


def test_writes_the_config_files(seeded_db, client, tmp_path):
    _upload(client)
    mystery = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
    client.patch(
        f"/api/transactions/{mystery['id']}",
        json={"category_id": _category_id(client, "courses"), "note": "à vérifier"},
    )
    client.put("/api/transfer-markers", json={"markers": ["VIR"]})

    resp = client.post("/api/config/export")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["config_dir"] == str(_config(tmp_path))
    assert {k: body[k] for k in ("accounts", "categories", "rules", "overrides", "transfer_markers")} == {
        "accounts": 5,
        "categories": 6,
        "rules": 4,
        "overrides": 1,
        "transfer_markers": 1,
    }

    def read(name: str) -> list[str]:
        return (_config(tmp_path) / name).read_text(encoding="utf-8-sig").splitlines()

    assert read("accounts.csv")[0] == "code;label;type;sort_order;deposit_pattern;aliases"
    assert "ENFANT;Livret enfant;savings;5;VERS LIVRET ENFANT;" in read("accounts.csv")
    assert "variable / sortie / bar;" in read("categories.csv")
    assert "fixe / salaire;EMPLOYEUR;1;1;" in read("rules.csv")
    assert any(
        ";variable / courses;;MYSTERY SHOP;à vérifier;;JOINT;" in line for line in read("overrides.csv")
    )
    assert read("transfer_markers.csv") == ["marker", "VIR"]
    assert not list(_config(tmp_path).glob("*.tmp"))


def test_leaves_other_config_files_alone(seeded_db, client, tmp_path):
    _write_preserved(tmp_path)

    assert client.post("/api/config/export").status_code == 200

    for name, content in PRESERVED.items():
        assert (_config(tmp_path) / name).read_bytes() == content
    assert sorted(p.name for p in _config(tmp_path).iterdir()) == sorted([*PRESERVED, *CONFIG_FILES])


def test_backs_up_the_previous_config_and_the_db(seeded_db, client, tmp_path):
    _upload(client)
    _write_preserved(tmp_path)
    export_config(seeded_db, _config(tmp_path))
    client.post(
        "/api/rules", json={"category_id": _category_id(client, "bar"), "pattern": "PUB", "priority": 9}
    )
    previous = {name: (_config(tmp_path) / name).read_bytes() for name in CONFIG_FILES}

    body = client.post("/api/config/export").json()

    backup = Path(body["backup_dir"])
    assert backup.parent == tmp_path / "_backups"  # next to the DB
    assert {name: (backup / name).read_bytes() for name in CONFIG_FILES} == previous
    assert not (backup / "bank_profiles.toml").exists()  # only the files the save replaces
    with sqlite3.connect(backup / "compta.db") as copy:
        assert copy.execute("SELECT COUNT(*) FROM transactions").fetchone() == (4,)
    assert (_config(tmp_path) / "rules.csv").read_bytes() != previous["rules.csv"]  # now has PUB


def test_first_save_backs_up_only_the_db_and_is_no_restore_source(seeded_db, client, tmp_path, monkeypatch):
    reset_db = isolate_reset_db(tmp_path, monkeypatch)
    older = tmp_path / "_backups" / "20000101_000000"
    export_config(seeded_db, older)

    body = client.post("/api/config/export").json()

    backup = Path(body["backup_dir"])
    assert backup != older
    assert [p.name for p in backup.iterdir()] == ["compta.db"]
    assert reset_db._latest_backup(tmp_path / "_backups") == older  # the DB-only backup is skipped


def test_an_interrupted_save_leaves_no_truncated_csv(seeded_db, client, tmp_path, monkeypatch):
    _config(tmp_path).mkdir()
    for name in CONFIG_FILES:
        (_config(tmp_path) / name).write_text("ancien\n", encoding="utf-8")
    real_replace = config_export.os.replace
    calls = []

    def flaky_replace(src, dst):
        calls.append(dst)
        if len(calls) == 2:
            raise PermissionError(13, "Permission refusée", str(src), None, str(dst))
        real_replace(src, dst)

    monkeypatch.setattr(config_export.os, "replace", flaky_replace)

    resp = client.post("/api/config/export")

    assert resp.status_code == 500
    assert resp.json()["detail"] == [
        f"Impossible d’écrire {_config(tmp_path) / 'categories.csv'} : Permission refusée"
    ]
    assert not list(_config(tmp_path).glob("*.tmp"))
    assert (_config(tmp_path) / "accounts.csv").read_text(encoding="utf-8-sig").startswith("code;")
    for name in CONFIG_FILES[1:]:  # never half-written: still the old content
        assert (_config(tmp_path) / name).read_text(encoding="utf-8") == "ancien\n"


def test_round_trip_through_reset_db_defaults(seeded_db, client, tmp_path, monkeypatch):
    reset_db = isolate_reset_db(tmp_path, monkeypatch)
    _write_preserved(tmp_path)
    (_config(tmp_path) / "bank_profiles.toml").unlink()  # not a valid profile; the statements use the default
    (_config(tmp_path) / "settings.toml").unlink()  # its start date would drop the June rows
    # Every kind of state the config carries: a described rule, a budget target, a manual category
    # with a note, a manual pair, a manual "not a transfer", and explicit transfer markers.
    _upload(client)
    rows = _upload_transfers(client)
    client.post(
        "/api/rules",
        json={
            "category_id": _category_id(client, "bar"),
            "pattern": "GUINNESS",
            "priority": 9,
            "description": "pub du vendredi",
        },
    )
    client.put(f"/api/categories/{_category_id(client, 'bar')}/target", json={"budget_target": 12.5})
    mystery = client.get("/api/transactions", params={"libelle_contains": "MYSTERY"}).json()["items"][0]
    client.patch(
        f"/api/transactions/{mystery['id']}",
        json={"category_id": _category_id(client, "courses"), "note": "remboursé"},
    )
    client.post(
        "/api/transactions/transfer-pair",
        json={
            "transaction_ids": [rows["CARTE 12/06 SUPERMARCHE"]["id"], rows["VIR SEPA RECU /DE AMI"]["id"]]
        },
    )
    client.put(f"/api/transactions/{rows['VIR vers COMPTE JOINT']['id']}/transfer", json={"mode": "none"})
    client.put("/api/transfer-markers", json={"markers": ["VIR"]})
    before = _state(seeded_db)
    assert len(before["overrides"]) == 5  # MYSTERY + the pair's 2 legs + the unpaired 2 legs

    assert client.post("/api/config/export").status_code == 200
    rebuilt = tmp_path / "rebuilt.db"
    reset_db.reset(rebuilt, "defaults", None)

    assert _state(rebuilt) == before
