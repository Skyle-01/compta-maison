"""The config dir's CSVs written from the DB: accounts, categories, rules, manual overrides and
transfer markers, in the format scripts/import_csv.py reads. One writer for the Réglages
« Enregistrer la configuration » button (save_config, into the config dir) and for reset_db.py's
_backups/<ts>/ snapshots (export_config)."""

import csv
import io
import os
import shutil
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.db import connect, euros, get_transfer_markers

# Full category paths use this separator (matches CategoryOut.path); the CSV importer splits on it.
PATH_SEP = " / "

ACCOUNTS_HEADER = ["code", "label", "type", "sort_order", "deposit_pattern", "aliases"]
# categories.csv columns (the config dir, _backups/ snapshots, data/).
CATEGORIES_HEADER = ["path", "budget_target"]
RULES_HEADER = ["category_path", "pattern", "priority", "is_income_anchor", "description"]
OVERRIDES_HEADER = [
    "import_hash",
    "category_path",
    "kind",
    "libelle",
    "note",
    "transfer_pair",
    "account_id",
    "date_operation",
    "debit_cents",
    "credit_cents",
]

# Every file export_config writes; nothing else in the config dir (bank_profiles.toml,
# settings.toml, ...) is ever touched.
CONFIG_FILES = ("accounts.csv", "categories.csv", "rules.csv", "overrides.csv", "transfer_markers.csv")


@dataclass(frozen=True)
class ConfigCounts:
    accounts: int
    categories: int
    rules: int
    overrides: int
    transfer_markers: int


@dataclass(frozen=True)
class ConfigSave:
    counts: ConfigCounts
    backup_dir: Path


def csv_text(header: list[str], rows: list[list]) -> str:
    """Semicolon-delimited CSV, the format scripts/import_csv.py reads (written as UTF-8 with a BOM)."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buf.getvalue()


def write_csv(path: Path, header: list[str], rows: list[list]) -> None:
    """Write through a temp file then replace, so an interrupted write never leaves a truncated CSV."""
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(csv_text(header, rows), encoding="utf-8-sig", newline="")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def category_paths(conn: sqlite3.Connection) -> dict[int, str]:
    """Map each category id to its full ` / `-joined path."""
    by_id = {
        cid: (name, parent_id)
        for cid, name, parent_id in conn.execute("SELECT id, name, parent_id FROM categories")
    }

    def path(category_id: int) -> str:
        chain = []
        current: int | None = category_id
        while current is not None:
            name, current = by_id[current]
            chain.append(name)
        return PATH_SEP.join(reversed(chain))  # root first

    return {cid: path(cid) for cid in by_id}


def account_rows(conn: sqlite3.Connection) -> list[list]:
    """accounts.csv rows, aliases `|`-joined (the code, always an alias, left out)."""
    accounts = conn.execute(
        "SELECT code, label, type, sort_order, deposit_pattern FROM accounts ORDER BY sort_order, code"
    ).fetchall()
    aliases_by_code: dict[str, list[str]] = {}
    for alias, code in conn.execute("SELECT alias, code FROM account_aliases ORDER BY alias"):
        if alias != code:
            aliases_by_code.setdefault(code, []).append(alias)
    return [
        [code, label, type_, order, pattern or "", "|".join(aliases_by_code.get(code, []))]
        for code, label, type_, order, pattern in accounts
    ]


def category_rows(conn: sqlite3.Connection) -> list[list[str]]:
    """categories.csv rows `[path, budget_target]`, sorted by path so parents precede children.
    The target is in euros (`300.00`), empty when unset."""
    targets: dict[int, int] = dict(
        conn.execute("SELECT id, budget_target_cents FROM categories WHERE budget_target_cents IS NOT NULL")
    )
    paths = category_paths(conn)
    return sorted(
        [path, f"{euros(targets[cid]):.2f}" if cid in targets else ""] for cid, path in paths.items()
    )


def rule_rows(conn: sqlite3.Connection, path_by_id: dict[int, str]) -> list[list]:
    """Every rule as rules.csv rows, keyed by category path."""
    rows = conn.execute(
        "SELECT category_id, pattern, priority, is_income_anchor, description FROM label_rules "
        "ORDER BY priority, id"
    ).fetchall()
    return [
        [path_by_id.get(category_id, ""), pattern, priority, is_income_anchor, description or ""]
        for category_id, pattern, priority, is_income_anchor, description in rows
    ]


def override_rows(conn: sqlite3.Connection, path_by_id: dict[int, str]) -> list[list]:
    """Every manual category/kind/note override as overrides.csv rows. Keyed by the stable
    import_hash; `transfer_pair` holds the partner leg's import_hash for a manual transfer pair, so
    the pair is re-linked on restore. The trailing identity columns (account, date, libellé,
    amounts) let a restore find a row whose hash changed, e.g. one uploaded under the account code
    and rebuilt under the filename alias."""
    rows = conn.execute(
        "SELECT t.import_hash, t.category_id, t.category_manual, t.kind, t.kind_manual, t.libelle, "
        "t.note, p.import_hash, t.account_id, t.date_operation, t.debit_cents, t.credit_cents "
        "FROM transactions t "
        "LEFT JOIN transactions p ON t.kind_manual = 1 AND p.kind_manual = 1 "
        "AND p.transfer_group_id = t.transfer_group_id AND p.id != t.id "
        "WHERE t.category_manual = 1 OR t.kind_manual = 1 ORDER BY t.date_valeur, t.id"
    ).fetchall()
    return [
        [
            import_hash,
            path_by_id.get(category_id, "") if category_manual and category_id else "",
            kind if kind_manual else "",
            libelle,
            note or "",
            partner_hash or "",
            account_id or "",
            date_operation,
            debit_cents,
            credit_cents,
        ]
        for (
            import_hash,
            category_id,
            category_manual,
            kind,
            kind_manual,
            libelle,
            note,
            partner_hash,
            account_id,
            date_operation,
            debit_cents,
            credit_cents,
        ) in rows
    ]


def export_config(db_path: Path, out_dir: Path) -> ConfigCounts:
    """Write the CONFIG_FILES of the DB's current state into `out_dir` (created if missing)."""
    with connect(db_path) as conn:
        accounts = account_rows(conn)
        path_by_id = category_paths(conn)
        categories = category_rows(conn)
        rules = rule_rows(conn, path_by_id)
        overrides = override_rows(conn, path_by_id)
        markers = get_transfer_markers(conn)

    out_dir.mkdir(parents=True, exist_ok=True)
    write_csv(out_dir / "accounts.csv", ACCOUNTS_HEADER, accounts)
    write_csv(out_dir / "categories.csv", CATEGORIES_HEADER, categories)
    write_csv(out_dir / "rules.csv", RULES_HEADER, rules)
    write_csv(out_dir / "overrides.csv", OVERRIDES_HEADER, overrides)
    # Written even when empty (= the built-in default), so a rebuild from it keeps the default.
    write_csv(out_dir / "transfer_markers.csv", ["marker"], [[m] for m in markers])
    return ConfigCounts(len(accounts), len(categories), len(rules), len(overrides), len(markers))


def backups_dir(db_path: Path) -> Path:
    """Where a DB's snapshots go: `_backups/` next to it (the repo root for the default compta.db),
    so a throwaway DB (a demo, a test) never adds a snapshot to the real restore points."""
    return db_path.parent / "_backups"


def new_backup_dir(db_path: Path) -> Path:
    """A fresh, empty `_backups/<timestamp>/` (suffixed `_2`, `_3`... within the same second)."""
    root = backups_dir(db_path)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    candidate, n = root / stamp, 1
    while candidate.exists():
        n += 1
        candidate = root / f"{stamp}_{n}"
    candidate.mkdir(parents=True)
    return candidate


def backup_db(db_path: Path, dest: Path) -> None:
    """Copy the DB with SQLite's online backup API (consistent even during a write)."""
    with closing(sqlite3.connect(db_path)) as src, closing(sqlite3.connect(dest)) as dst:
        src.backup(dst)


def save_config(db_path: Path, config_dir: Path) -> ConfigSave:
    """Regenerate the config dir from the DB, after copying the files it replaces and the DB itself
    to a new `_backups/<ts>/`: a save made from a damaged DB never loses the last good config.
    Nothing is written to the config dir if that backup fails."""
    backup = new_backup_dir(db_path)
    for name in CONFIG_FILES:
        if (config_dir / name).exists():
            shutil.copy2(config_dir / name, backup / name)
    backup_db(db_path, backup / "compta.db")
    return ConfigSave(export_config(db_path, config_dir), backup)
