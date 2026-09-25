"""Rebuild compta.db from a chosen taxonomy source + the _inputs bank statements.

Usage: .venv/Scripts/python backend/scripts/reset_db.py [--source live|defaults|backup] [--from DIR] [--db PATH]

A rebuild = fresh DB + load the accounts + import every _inputs/*.csv (deduped by import_hash) +
load a taxonomy (categories, rules, and manual overrides) from one source:

  --source live      (default) snapshot the current DB's accounts + taxonomy + overrides to
                     _backups/<ts>/, then rebuild from that snapshot. Preserves your current setup
                     across a schema change. Requires an existing DB.
  --source defaults  rebuild from your config dir (--from DIR, else $COMPTA_CONFIG_DIR, else
                     _config/ when it holds a categories.csv), falling back to the fictional
                     example in data/. First-time bootstrap, or reset to your reference setup.
  --source backup    rebuild from a _backups/<ts>/ snapshot (latest, or --from DIR). Disaster
                     recovery when the DB is lost — does not need a live DB.

Transactions always come from _inputs/*.csv (the durable bank-statement archive). The taxonomy
snapshot under _backups/ is therefore taxonomy-only: a full restore point = the latest
_backups/<ts>/ **plus** your current _inputs/. Whenever a DB already exists it is snapshotted to
_backups/<ts>/ before being deleted, so every rebuild leaves a recoverable restore point.

Personal data lives only in gitignored places: _inputs/ (statements), _config/ (your
accounts.csv, categories.csv, rules.csv and optional overrides.csv), _backups/ and compta.db.
A source dir without accounts.csv (a snapshot older than accounts.csv) borrows the one from the
config dir.
"""
import os
import argparse
import csv
import sys
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.api.categories import _load_all  # noqa: E402
from app.api.transactions import OVERRIDES_HEADER, override_rows  # noqa: E402
from app.core.parsing import CsvValidationError, infer_account, parse_csv  # noqa: E402
from app.db import (  # noqa: E402
    DEFAULT_DB_PATH,
    connect,
    get_transfer_markers,
    import_transactions,
    init_db,
    load_account_aliases,
    resolve_account_code,
)
from scripts.import_csv import import_csv, load_accounts_csv, load_transfer_markers_csv  # noqa: E402

REPO_ROOT = BACKEND_DIR.parent
DATA_DIR = REPO_ROOT / "data"
INPUTS_DIR = REPO_ROOT / "_inputs"
BACKUPS_DIR = REPO_ROOT / "_backups"
CONFIG_DIR = Path(os.environ.get("COMPTA_CONFIG_DIR", str(REPO_ROOT / "_config")))


def _defaults_dir() -> Path:
    """The private config dir when it holds a taxonomy, else the fictional example in data/."""
    return CONFIG_DIR if (CONFIG_DIR / "categories.csv").exists() else DATA_DIR


def _import_inputs(db_path: Path) -> int:
    """Import every bank CSV in _inputs/, inferring the account from the filename.
    Files that don't map to a known account or fail to parse are skipped with a note.
    Returns the number of newly inserted transactions (re-runs are deduped by hash)."""
    if not INPUTS_DIR.exists():
        return 0
    with connect(db_path) as conn:
        aliases = load_account_aliases(conn)

    total_new = 0
    for path in sorted(INPUTS_DIR.glob("*.csv")):
        account = infer_account(path.name)
        if not account or resolve_account_code(account, aliases) is None:
            print(f"Skipping {path.name}: no known account in filename")
            continue
        try:
            rows = parse_csv(path.read_bytes())
        except CsvValidationError as exc:
            print(f"Skipping {path.name}: {exc}")
            continue
        for row in rows:
            row["account"] = account
        with connect(db_path) as conn:
            import_id = conn.execute(
                "INSERT INTO imports (filename, account, rows_total, rows_new) VALUES (?, ?, ?, 0)",
                (path.name, account, len(rows)),
            ).lastrowid
        new = import_transactions(rows, db_path, import_id=import_id)
        with connect(db_path) as conn:
            conn.execute("UPDATE imports SET rows_new = ? WHERE id = ?", (new, import_id))
        total_new += new
        print(f"Imported {new}/{len(rows)} new rows from {path.name} -> {account}")
    return total_new


def _write_csv(path: Path, header: list[str], rows: list[list]) -> None:
    """Semicolon-delimited, UTF-8-BOM — matches api.categories.csv_response / _read_csv."""
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";", lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


def export_current(db_path: Path, out_dir: Path) -> tuple[Path, Path, Path]:
    """Dump accounts, categories, rules and manual overrides of the live DB to CSV.
    Returns the (categories, rules, overrides) paths; accounts.csv sits next to them."""
    out_dir.mkdir(parents=True, exist_ok=True)
    accounts_csv = out_dir / "accounts.csv"
    cat_csv = out_dir / "categories.csv"
    rules_csv = out_dir / "rules.csv"
    overrides_csv = out_dir / "overrides.csv"

    with connect(db_path) as conn:
        account_rows = conn.execute(
            "SELECT code, label, type, include_in_full_view, sort_order, deposit_pattern "
            "FROM accounts ORDER BY sort_order, code"
        ).fetchall()
        aliases_by_code: dict[str, list[str]] = {}
        for alias, code in conn.execute("SELECT alias, code FROM account_aliases ORDER BY alias"):
            if alias != code:  # the code is always an alias; keep the CSV tidy
                aliases_by_code.setdefault(code, []).append(alias)
        cats = _load_all(conn)  # sorted by path -> parents precede children
        path_by_id = {c.id: c.path for c in cats}
        rule_rows = conn.execute(
            "SELECT category_id, pattern, priority, is_income_anchor, description "
            "FROM label_rules ORDER BY priority, id"
        ).fetchall()
        overrides = override_rows(conn, path_by_id)
        # A live DB from before transfer markers existed has no such table: skip, default applies.
        has_markers = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transfer_markers'"
        ).fetchone()
        markers = get_transfer_markers(conn) if has_markers else []

    _write_csv(
        accounts_csv,
        ["code", "label", "type", "include_in_full_view", "sort_order", "deposit_pattern", "aliases"],
        [
            [code, label, type_, include, order, pattern or "", "|".join(aliases_by_code.get(code, []))]
            for code, label, type_, include, order, pattern in account_rows
        ],
    )
    _write_csv(cat_csv, ["path"], [[c.path] for c in cats])
    _write_csv(
        rules_csv,
        ["category_path", "pattern", "priority", "is_income_anchor", "description"],
        [
            [path_by_id.get(category_id, ""), pattern, priority, is_income_anchor, description or ""]
            for category_id, pattern, priority, is_income_anchor, description in rule_rows
        ],
    )
    _write_csv(overrides_csv, OVERRIDES_HEADER, overrides)
    if has_markers:  # written even when empty, so a live rebuild keeps "default" as-is
        _write_csv(out_dir / "transfer_markers.csv", ["marker"], [[m] for m in markers])
    print(
        f"Exported {len(account_rows)} accounts, {len(cats)} categories, {len(rule_rows)} rules, {len(overrides)} overrides, "
        f"{len(markers)} transfer markers "
        f"to {out_dir}"
    )
    return cat_csv, rules_csv, overrides_csv


def _latest_backup(root: Path = BACKUPS_DIR) -> Path:
    """Most recent _backups/<ts>/ snapshot directory. Exits if there are none."""
    snaps = sorted((p for p in root.glob("*") if p.is_dir()), reverse=True) if root.exists() else []
    if not snaps:
        sys.exit(f"No snapshots under {root} to restore from. Run with --source defaults instead.")
    return snaps[0]


def _rebuild(
    db_path: Path,
    accounts_csv: Path,
    cat_csv: Path,
    rules_csv: Path,
    overrides_csv: Path | None,
    markers_csv: Path | None = None,
) -> None:
    """Fresh DB: load accounts, import _inputs, then load the taxonomy + overrides from the given
    CSVs. Accounts come first so statement filenames resolve; _inputs is imported *before* the
    taxonomy so overrides reattach by import_hash."""
    if db_path.exists():
        db_path.unlink()
    init_db(db_path)
    load_accounts_csv(accounts_csv, db_path)
    load_transfer_markers_csv(markers_csv, db_path)
    n_new = _import_inputs(db_path)
    # import_csv rebuilds cats/rules from the CSVs, reattaches overrides by import_hash, and
    # recomputes periods + transfers + rules over the freshly imported transactions.
    import_csv(cat_csv, rules_csv, db_path, overrides_csv)
    print(f"Rebuilt {db_path} ({n_new} transactions imported).")


def reset(db_path: Path, source: str, from_dir: Path | None) -> None:
    # Resolve the backup target BEFORE the safety snapshot, so the snapshot can't shadow "latest".
    backup_dir = (from_dir or _latest_backup(BACKUPS_DIR)) if source == "backup" else None

    # Safety snapshot of the existing DB (also the source for --source live).
    snapshot_dir: Path | None = None
    if db_path.exists():
        snapshot_dir = BACKUPS_DIR / datetime.now().strftime("%Y%m%d_%H%M%S")
        export_current(db_path, snapshot_dir)

    if source == "live":
        if snapshot_dir is None:
            sys.exit(
                f"No database at {db_path} to snapshot. Use --source defaults (first run) or "
                f"--source backup (restore from a snapshot)."
            )
        src_dir = snapshot_dir
    elif source == "defaults":
        src_dir = from_dir or _defaults_dir()
        print(f"Rebuilding from {src_dir}")
    else:  # backup
        src_dir = backup_dir  # type: ignore[assignment]
        print(f"Restoring taxonomy from {src_dir}")

    overrides_csv = src_dir / "overrides.csv"
    accounts_csv = src_dir / "accounts.csv"
    if not accounts_csv.exists():
        accounts_csv = _defaults_dir() / "accounts.csv"
        print(f"No accounts.csv in {src_dir}; using {accounts_csv}")
    # Transfer markers are optional (absent = built-in default); a snapshot without the file
    # borrows the config dir's, like accounts.csv.
    markers_csv = next(
        (p for p in (src_dir / "transfer_markers.csv", _defaults_dir() / "transfer_markers.csv") if p.exists()),
        None,
    )
    _rebuild(
        db_path,
        accounts_csv,
        src_dir / "categories.csv",
        src_dir / "rules.csv",
        overrides_csv if overrides_csv.exists() else None,
        markers_csv,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--source",
        choices=["live", "defaults", "backup"],
        default="live",
        help="Taxonomy source for the rebuild (default: live).",
    )
    parser.add_argument(
        "--from",
        dest="from_dir",
        type=Path,
        default=None,
        help="With --source backup: the snapshot dir to restore (default: latest under _backups/). "
        "With --source defaults: the config dir to rebuild from (default: _config/, else data/).",
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    args = parser.parse_args()
    reset(args.db, args.source, args.from_dir)
