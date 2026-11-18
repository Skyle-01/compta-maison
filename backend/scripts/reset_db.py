"""Rebuild compta.db from a chosen taxonomy source + the inputs bank statements.

Usage: .venv/Scripts/python backend/scripts/reset_db.py [--source live|defaults|backup] [--from DIR] [--db PATH]

A rebuild = fresh DB + load the accounts + import every inputs/*.csv (deduped by import_hash) +
load a taxonomy (categories, rules, and manual overrides) from one source:

  --source live      (default) snapshot the current DB's accounts + taxonomy + overrides to
                     backups/<ts>/, then rebuild from that snapshot. Preserves your current setup
                     across a schema change. Requires an existing DB.
  --source defaults  rebuild from your config dir (--from DIR, else $COMPTA_CONFIG_DIR, else
                     config/ of the data folder when it holds a categories.csv), falling back to the fictional
                     example in data/. First-time bootstrap, or reset to your reference setup.
  --source backup    rebuild from a backups/<ts>/ snapshot (latest, or --from DIR). Disaster
                     recovery when the DB is lost — does not need a live DB.

Transactions always come from inputs/*.csv (the durable bank-statement archive). The taxonomy
snapshot under backups/ is therefore taxonomy-only: a full restore point = the latest
backups/<ts>/ **plus** your current inputs/. Whenever a DB already exists it is snapshotted to
backups/<ts>/ first, so every rebuild leaves a recoverable restore point; the new DB is built in
<db>.tmp and replaces the old one only when the whole rebuild succeeded.
backups/ sits next to the DB (--db, else $COMPTA_DB, else compta.db in the data folder).

Personal data lives in one data folder outside the tracked files ($COMPTA_DATA_DIR, else the folder
chosen in the app; the script exits when neither is set): inputs/ (statements), config/ (your accounts.csv, categories.csv,
rules.csv, optional overrides.csv, transfer_markers.csv, bank_profiles.toml and settings.toml),
backups/ and compta.db. $COMPTA_DB, $COMPTA_CONFIG_DIR and $COMPTA_INPUTS_DIR each override one
of them. Bank profiles and the start date
(settings.toml) are always read from the config dir, whatever --source is: they describe which
statement rows to import and how to parse them, not DB state.
A source dir without accounts.csv (a snapshot older than accounts.csv) borrows the one from the
config dir.
"""

import argparse
import os
import sys
from datetime import date
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.core.bank_profiles import BankProfile, BankProfileError, load_bank_profiles  # noqa: E402
from app.core.config_export import backups_dir, export_config, new_backup_dir  # noqa: E402
from app.core.inputs import import_inputs_dir  # noqa: E402
from app.core.settings import SETTINGS_FILENAME, SettingsError, load_start_date  # noqa: E402
from app.db import NOT_CONFIGURED, init_db, locate_paths  # noqa: E402
from scripts.import_csv import import_csv, load_accounts_csv, load_transfer_markers_csv  # noqa: E402

REPO_ROOT = BACKEND_DIR.parent
DATA_DIR = REPO_ROOT / "data"
PATHS, PROBLEM = locate_paths()
# None until the data folder is configured: the entry point exits before using them.
INPUTS_DIR = PATHS.inputs if PATHS else None
CONFIG_DIR = PATHS.config if PATHS else None


def _defaults_dir() -> Path:
    """The private config dir when it holds a taxonomy, else the fictional example in data/."""
    return CONFIG_DIR if (CONFIG_DIR / "categories.csv").exists() else DATA_DIR


def _load_profiles() -> list[BankProfile]:
    """Bank profiles from the config dir — the same ones the server uses, whatever --source is,
    so an upload and a rebuild parse a statement (and hash its rows) identically."""
    try:
        return load_bank_profiles(CONFIG_DIR)
    except BankProfileError as exc:
        sys.exit(f"Invalid {CONFIG_DIR / 'bank_profiles.toml'}: {exc}")


def _load_start_date() -> date | None:
    """The books' start date from the config dir (core.settings), whatever --source is, like the
    bank profiles: it says which statement rows to import, not DB state."""
    try:
        return load_start_date(CONFIG_DIR)
    except SettingsError as exc:
        sys.exit(f"Invalid {CONFIG_DIR / SETTINGS_FILENAME}: {exc}")


def _import_inputs(db_path: Path, profiles: list[BankProfile], start_date: date | None) -> int:
    """Import every bank CSV in inputs/ (see core.inputs.import_inputs_dir), printing a line per
    file. Returns the number of newly inserted transactions (re-runs are deduped by hash)."""
    results = import_inputs_dir(db_path, INPUTS_DIR, profiles, start_date)
    for r in results:
        if r.error:
            print(f"Skipping {r.name}: {r.error}")
        else:
            print(f"Imported {r.rows_new}/{r.rows_total} new rows from {r.name} -> {r.account} [{r.profile}]")
    before_start = sum(r.rows_before_start for r in results)
    if before_start:
        print(
            f"Left out {before_start} rows valued before the start date (books: {start_date}, or the account's)."
        )
    return sum(r.rows_new for r in results)


def snapshot(db_path: Path) -> Path:
    """Dump the live DB's accounts, taxonomy, overrides and transfer markers to a new
    backups/<ts>/ (core.config_export), the restore point taken before every rebuild."""
    out_dir = new_backup_dir(db_path)
    c = export_config(db_path, out_dir)
    print(
        f"Exported {c.accounts} accounts, {c.categories} categories, {c.rules} rules, {c.overrides} overrides, "
        f"{c.transfer_markers} transfer markers to {out_dir}"
    )
    return out_dir


def _latest_backup(root: Path) -> Path:
    """Most recent backups/<ts>/ snapshot directory. Exits if there are none. A backup without a
    categories.csv (the Réglages save taken while the config dir was empty holds only compta.db)
    is no taxonomy source, so it is skipped."""
    snaps = sorted((p for p in root.glob("*") if (p / "categories.csv").exists()), reverse=True)
    if not snaps:
        sys.exit(f"No snapshots under {root} to restore from. Run with --source defaults instead.")
    return snaps[0]


def _rebuild(
    db_path: Path,
    accounts_csv: Path,
    cat_csv: Path,
    rules_csv: Path,
    overrides_csv: Path | None,
    markers_csv: Path | None,
    profiles: list[BankProfile],
    start_date: date | None,
) -> None:
    """Fresh DB: load accounts, import inputs, then load the taxonomy + overrides from the given
    CSVs. Accounts come first so statement filenames resolve; inputs is imported *before* the
    taxonomy so overrides reattach by import_hash.

    Built in `<db>.tmp` beside the target and moved over it only once everything loaded: a failure
    (SystemExit included) leaves the previous database untouched and removes the temporary file."""
    tmp_path = db_path.with_name(db_path.name + ".tmp")
    tmp_path.unlink(missing_ok=True)
    try:
        init_db(tmp_path)
        load_accounts_csv(accounts_csv, tmp_path)
        load_transfer_markers_csv(markers_csv, tmp_path)
        n_new = _import_inputs(tmp_path, profiles, start_date)
        # import_csv rebuilds cats/rules from the CSVs, reattaches overrides by import_hash, and
        # recomputes periods + transfers + rules over the freshly imported transactions.
        import_csv(cat_csv, rules_csv, tmp_path, overrides_csv)
        os.replace(tmp_path, db_path)
    finally:
        tmp_path.unlink(missing_ok=True)
    print(f"Rebuilt {db_path} ({n_new} transactions imported).")


def reset(db_path: Path, source: str, from_dir: Path | None) -> None:
    # A broken bank_profiles.toml or settings.toml stops here, before the snapshot and the delete.
    profiles = _load_profiles()
    start_date = _load_start_date()
    # Resolve the backup target BEFORE the safety snapshot, so the snapshot can't shadow "latest".
    backups = backups_dir(db_path)
    backup_dir = (from_dir or _latest_backup(backups)) if source == "backup" else None

    # Safety snapshot of the existing DB (also the source for --source live).
    snapshot_dir: Path | None = None
    if db_path.exists():
        snapshot_dir = snapshot(db_path)

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
        (
            p
            for p in (src_dir / "transfer_markers.csv", _defaults_dir() / "transfer_markers.csv")
            if p.exists()
        ),
        None,
    )
    _rebuild(
        db_path,
        accounts_csv,
        src_dir / "categories.csv",
        src_dir / "rules.csv",
        overrides_csv if overrides_csv.exists() else None,
        markers_csv,
        profiles,
        start_date,
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
        help="With --source backup: the snapshot dir to restore (default: latest under the DB's backups/). "
        "With --source defaults: the config dir to rebuild from (default: config/, else data/).",
    )
    parser.add_argument("--db", type=Path, default=PATHS.db if PATHS else None)
    args = parser.parse_args()
    if PATHS is None or args.db is None:
        sys.exit(PROBLEM or NOT_CONFIGURED)
    reset(args.db, args.source, args.from_dir)
