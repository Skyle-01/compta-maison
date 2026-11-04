"""POST /api/config/export-statements: the Réglages « Exporter les opérations en CSV » button."""

from pathlib import Path

import pytest

from app.core.bank_profiles import DEFAULT_PROFILE
from app.core.config_export import export_statements
from app.core.parsing import infer_account, parse_statement
from app.db import connect, import_transactions
from tests.conftest import import_rows, make_db

# (date_operation, date_valeur, libelle, debit, credit, account): fictional, with the awkward cases.
ROWS = [
    ("2026-04-01", "2026-04-01", "VIR EMPLOYEUR SALAIRE", 0.0, 2500.0, "PERSO"),
    ("2026-04-02", "2026-04-03", "CB SUPERMARCHE", 12.34, 0.0, "PERSO"),
    # Two genuinely identical operations on the same day.
    ("2026-04-02", "2026-04-02", "CB BOULANGERIE", 1.2, 0.0, "PERSO"),
    ("2026-04-02", "2026-04-02", "CB BOULANGERIE", 1.2, 0.0, "PERSO"),
    # Trailing space, quote and semicolon in the libellé (all part of the hash).
    ("2026-04-05", "2026-04-05", 'PRLV "EDF"; REGUL ', 80.0, 0.0, "JOINT"),
    ("2026-04-06", "2026-04-06", "VIR REMBOURSEMENT", 0.0, 1234.5, "JOINT"),
    # A raw account name with a space.
    ("2026-04-07", "2026-04-07", "LOYER T3", 0.0, 650.0, "APPARTEMENT T3"),
]


def _hashes(db_path: Path) -> list[str]:
    with connect(db_path) as conn:
        return sorted(h for (h,) in conn.execute("SELECT import_hash FROM transactions"))


def _inputs_of(result) -> Path:
    return result.backup_dir / "inputs"


def _reimport(files_dir: Path, db_path: Path) -> None:
    """What a rebuild does with a statement: infer the account from the file name, parse, import."""
    for path in sorted(files_dir.glob("*.csv")):
        _, rows = parse_statement(path.read_bytes(), [DEFAULT_PROFILE])
        account = infer_account(path.name, [DEFAULT_PROFILE])
        import_transactions([{**row, "account": account} for row in rows], db_path)


def test_round_trip_gives_the_same_import_hashes(db, tmp_path):
    import_rows(db, *ROWS)
    result = export_statements(db)

    assert (result.files, result.operations) == (3, len(ROWS))
    other = make_db(tmp_path / "other.db")
    _reimport(_inputs_of(result), other)

    assert _hashes(other) == _hashes(db)
    assert len(_hashes(other)) == len(ROWS)


def test_one_file_per_raw_account_in_the_default_layout(db):
    import_rows(db, *ROWS)
    inputs = _inputs_of(export_statements(db))

    names = sorted(p.name for p in inputs.glob("*.csv"))
    assert [infer_account(n, [DEFAULT_PROFILE]) for n in names] == ["APPARTEMENT T3", "JOINT", "PERSO"]
    assert all(n.startswith("RELEVE_") for n in names)
    perso = next(p for p in inputs.glob("RELEVE_PERSO_*.csv"))
    lines = perso.read_text(encoding="utf-8-sig").splitlines()
    assert lines[0] == '"Date operation";"Date valeur";"Libelle";"Debit";"Credit"'
    # Sorted by value date, empty cell for a zero amount, comma decimals, dd/mm/yyyy.
    assert lines[1] == '"01/04/2026";"01/04/2026";"VIR EMPLOYEUR SALAIRE";"";"2500,00"'
    assert lines[-1] == '"02/04/2026";"03/04/2026";"CB SUPERMARCHE";"12,34";""'


def test_a_file_name_that_does_not_give_the_account_back_is_an_error(db):
    # infer_account strips the optional COMPTE_ prefix of a statement name.
    import_rows(db, ("2026-04-01", "2026-04-01", "VIR EMPLOYEUR", 0.0, 10.0, "COMPTE JOINT"))

    with pytest.raises(ValueError, match="COMPTE JOINT"):
        export_statements(db)
    assert not (db.parent / "_backups").exists()


def test_nothing_is_written_to_the_inputs_dir(db, tmp_path):
    import_rows(db, *ROWS)
    inputs = tmp_path / "_inputs"
    inputs.mkdir()

    result = export_statements(db)

    assert list(inputs.iterdir()) == []
    assert _inputs_of(result).parent.parent == db.parent / "_backups"
    assert list(_inputs_of(result).glob("*.tmp")) == []


def test_empty_db_writes_nothing(db):
    result = export_statements(db)

    assert (result.backup_dir, result.files, result.operations) == (None, 0, 0)
    assert not (db.parent / "_backups").exists()


def test_route(client, db):
    import_rows(db, *ROWS)

    body = client.post("/api/config/export-statements").json()

    assert (body["files"], body["operations"]) == (3, len(ROWS))
    assert Path(body["backup_dir"], "inputs").is_dir()


def test_route_reports_the_unusable_file_name_in_french(client, db):
    import_rows(db, ("2026-04-01", "2026-04-01", "VIR EMPLOYEUR", 0.0, 10.0, "COMPTE JOINT"))

    resp = client.post("/api/config/export-statements")

    assert resp.status_code == 422
    assert "COMPTE JOINT" in resp.json()["detail"][0]
