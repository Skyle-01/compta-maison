"""Import the bank statements dropped in _inputs/ into the existing compta.db.

Usage: .venv/Scripts/python backend/scripts/import_inputs.py [--db PATH]   (or ./import_inputs.ps1)

Unlike reset_db.py, nothing is deleted: every _inputs/*.csv is read again and only the rows not
yet in the DB are added (already imported statements and overlapping ones are deduped), then
budget months, transfers and rules are recomputed, as after an upload. Manual categories, notes
and transfer decisions are left alone. Safe to run while the server is up.
"""

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.core.bank_profiles import BankProfileError, load_bank_profiles  # noqa: E402
from app.core.categorize import apply_rules  # noqa: E402
from app.core.inputs import import_inputs_dir  # noqa: E402
from app.core.periods import recompute_budget_months  # noqa: E402
from app.core.transfers import recompute_transfers  # noqa: E402
from app.db import DEFAULT_CONFIG_DIR, DEFAULT_DB_PATH, DEFAULT_INPUTS_DIR  # noqa: E402

INPUTS_DIR = DEFAULT_INPUTS_DIR
CONFIG_DIR = DEFAULT_CONFIG_DIR


def import_inputs(db_path: Path) -> int:
    """Import _inputs/ into the DB at `db_path`, printing a line per file. Returns the number of
    new transactions."""
    if not db_path.exists():
        sys.exit(f"No database at {db_path}. Create it first with reset_db.py --source defaults.")
    try:
        profiles = load_bank_profiles(CONFIG_DIR)
    except BankProfileError as exc:
        sys.exit(f"Invalid {CONFIG_DIR / 'bank_profiles.toml'}: {exc}")

    results = import_inputs_dir(db_path, INPUTS_DIR, profiles)
    for r in results:
        if r.error:
            print(f"Skipping {r.name}: {r.error}")
        elif r.rows_new:
            print(f"Imported {r.rows_new}/{r.rows_total} new rows from {r.name} -> {r.account} [{r.profile}]")
    recompute_budget_months(db_path)
    recompute_transfers(db_path)
    apply_rules(db_path)
    n_new = sum(r.rows_new for r in results)
    print(f"{n_new} new transactions from {len(results)} files in {INPUTS_DIR}.")
    return n_new


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    import_inputs(parser.parse_args().db)
