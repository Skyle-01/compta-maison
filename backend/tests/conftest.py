from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import scripts.reset_db as reset_db_module
from app.db import connect, import_transactions, init_db, upsert_accounts
from app.main import create_app

# Fictional accounts every test db starts with (a real db loads them from accounts.csv).
TEST_ACCOUNTS = [
    ("PERSO", "Compte perso", "checking", 1, None),
    ("JOINT", "Compte joint", "checking", 2, None),
    ("LIVRET", "Livret A", "savings", 3, None),
    ("LOCATIF", "Appartement locatif", "checking", 4, None),
    ("ENFANT", "Livret enfant", "savings", 5, "VERS LIVRET ENFANT"),
]
TEST_ACCOUNT_ALIASES = [(code, code) for code, *_ in TEST_ACCOUNTS] + [
    ("COMPTE PERSO", "PERSO"),
    ("COMPTE JOINT", "JOINT"),
    ("LIVRET A", "LIVRET"),
    ("APPARTEMENT LOCATIF", "LOCATIF"),
]


@pytest.fixture(autouse=True)
def _no_private_config(tmp_path, monkeypatch):
    """Keep the developer's private _config/ (e.g. bank_profiles.toml) out of every app a test
    creates, and keep uploads out of their _inputs/; tests that need a config write it to
    tmp_path/_config, uploads land in tmp_path/_inputs."""
    monkeypatch.setattr("app.main.DEFAULT_CONFIG_DIR", tmp_path / "_config")
    monkeypatch.setattr("app.main.DEFAULT_INPUTS_DIR", tmp_path / "_inputs")


def cat_id(db_path: Path, name: str) -> int:
    with connect(db_path) as conn:
        return conn.execute("SELECT id FROM categories WHERE name = ?", (name,)).fetchone()[0]


# The row dict keys parse_csv hands to import_transactions.
ROW_COLUMNS = ["Date operation", "Date valeur", "Libelle", "Debit", "Credit", "account"]


def import_rows(db_path: Path, *rows: tuple) -> int:
    """Import `(date_operation, date_valeur, libelle, debit, credit, account)` tuples as parsed rows."""
    return import_transactions([dict(zip(ROW_COLUMNS, row, strict=True)) for row in rows], db_path)


def make_db(path: Path) -> Path:
    """A fresh schema holding the test accounts."""
    init_db(path)
    with connect(path) as conn:
        upsert_accounts(conn, TEST_ACCOUNTS, TEST_ACCOUNT_ALIASES)
    return path


def isolate_reset_db(tmp_path: Path, monkeypatch):
    """Point reset_db.py's _inputs/, _backups/ and config dir at tmp_path (the same _inputs/ the app
    archives uploads to, see _no_private_config); returns the module."""
    monkeypatch.setattr(reset_db_module, "INPUTS_DIR", tmp_path / "_inputs")
    monkeypatch.setattr(reset_db_module, "BACKUPS_DIR", tmp_path / "_backups")
    monkeypatch.setattr(reset_db_module, "CONFIG_DIR", tmp_path / "_config")  # absent unless a test writes it
    return reset_db_module


@pytest.fixture
def db(tmp_path):
    return make_db(tmp_path / "test.db")


@pytest.fixture
def client(db):
    app = create_app(db)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def seeded_db(db):
    """A db with a small flat category tree and matching rules.

    fixe -> salaire ; variable -> courses, sortie -> bar  (no credit/debit roots;
    flow lives on each transaction's `kind`). The salaire/EMPLOYEUR rule is the
    income anchor for paycheck periods.
    """
    with connect(db) as conn:

        def add(name: str, parent_id: int | None) -> int:
            return conn.execute(
                "INSERT INTO categories (name, parent_id) VALUES (?, ?)", (name, parent_id)
            ).lastrowid

        fixe = add("fixe", None)
        salaire = add("salaire", fixe)
        variable = add("variable", None)
        courses = add("courses", variable)
        sortie = add("sortie", variable)
        bar = add("bar", sortie)

        conn.executemany(
            "INSERT INTO label_rules (category_id, pattern, priority, is_income_anchor) VALUES (?, ?, ?, ?)",
            [
                (salaire, "EMPLOYEUR", 1, 1),
                (courses, "SUPERMARCHE", 2, 0),
                (courses, "LECLERC", 3, 0),
                (bar, "ANGELUS", 4, 0),
            ],
        )
    return db
