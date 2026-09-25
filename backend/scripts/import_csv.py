"""Restore categories and rules from CSVs exported via the Settings page.

Usage:
    python backend/scripts/import_csv.py --categories categories.csv --rules rules.csv [--accounts accounts.csv] [--db path]

Wipes and rebuilds the category tree and rules from the two self-contained CSVs (the same
format the /api/categories/export and /api/rules/export endpoints produce), then re-applies
rules and recomputes budget months + transfers over whatever transactions already exist.

With --transfer-markers, also replaces the transfer markers from a transfer_markers.csv.

With --accounts, also upserts the accounts (and their import aliases) from an accounts.csv.

With --overrides, also restores manual category/kind overrides (from
/api/transactions/export-overrides), matched to transactions by their stable import_hash (or, for
a hash no longer in the DB, by account + date + libellé + amounts).

It does NOT import transactions (no _inputs handling) — that's reset_db.py's job. For a full
rebuild (fresh DB + _inputs + taxonomy + overrides from defaults/live/a backup) use reset_db.py;
this script just layers a given set of taxonomy CSVs onto whatever transactions already exist.
"""

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.api.categories import PATH_SEP  # noqa: E402
from app.core.categorize import apply_rules  # noqa: E402
from app.core.periods import recompute_budget_months  # noqa: E402
from app.core.transfers import recompute_transfers  # noqa: E402
from app.db import DEFAULT_DB_PATH, connect, init_db, replace_transfer_markers, upsert_accounts  # noqa: E402

REPO_ROOT = BACKEND_DIR.parent

ACCOUNT_TYPES = ("checking", "savings")
ALIAS_SEP = "|"


def _read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return [
            {k: (v or "").strip() for k, v in row.items()} for row in csv.DictReader(handle, delimiter=";")
        ]


def import_accounts(conn, rows: list[dict]) -> int:
    """Upsert accounts from accounts.csv rows; returns how many were loaded.

    Columns: code;label;type;sort_order;deposit_pattern;aliases (other columns are ignored).
    `type` is checking|savings; `deposit_pattern` (optional) marks an external savings account;
    `aliases` is a `|`-separated list of import strings (e.g. the account part of a statement
    filename) mapped to this code. The code itself is always an alias."""
    accounts: list[tuple] = []
    aliases: list[tuple[str, str]] = []
    for line_no, row in enumerate(rows, start=2):
        code = row["code"].upper()
        if not code:
            continue
        if row["type"] not in ACCOUNT_TYPES:
            raise ValueError(
                f"accounts.csv line {line_no}: type must be one of {ACCOUNT_TYPES}, got {row['type']!r}"
            )
        accounts.append(
            (
                code,
                row["label"] or code,
                row["type"],
                int(row["sort_order"]) if row.get("sort_order") else 0,
                row.get("deposit_pattern") or None,
            )
        )
        names = [code] + [a.strip() for a in (row.get("aliases") or "").split(ALIAS_SEP)]
        aliases.extend((name, code) for name in names if name)
    upsert_accounts(conn, accounts, aliases)
    return len(accounts)


def load_accounts_csv(accounts_csv: Path, db_path: Path) -> int:
    """Create the schema if needed and upsert the accounts from one accounts.csv."""
    init_db(db_path)
    with connect(db_path) as conn:
        n = import_accounts(conn, _read_csv(accounts_csv))
    print(f"Loaded {n} accounts from {accounts_csv}")
    return n


def load_transfer_markers_csv(markers_csv: Path | None, db_path: Path) -> int:
    """Replace the transfer markers from a transfer_markers.csv (one `marker` column). None
    leaves the table empty, i.e. the built-in default applies. Returns how many were loaded."""
    init_db(db_path)
    markers = [row["marker"] for row in _read_csv(markers_csv)] if markers_csv else []
    with connect(db_path) as conn:
        stored = replace_transfer_markers(conn, markers)
    if markers_csv:
        print(f"Loaded {len(stored)} transfer markers from {markers_csv}")
    return len(stored)


def import_categories(conn, rows: list[dict]) -> dict[str, int]:
    """Get-or-create each category along its full path; returns {path: id}. Assumes names
    don't contain the ` / ` separator (the export format's only constraint)."""
    path_to_id: dict[str, int] = {}
    for row in rows:
        path = row["path"]
        if not path:
            continue
        parent_id: int | None = None
        chain: list[str] = []
        for name in path.split(PATH_SEP):
            chain.append(name)
            key = PATH_SEP.join(chain)
            if key not in path_to_id:
                existing = conn.execute(
                    "SELECT id FROM categories WHERE name = ? AND parent_id IS ?", (name, parent_id)
                ).fetchone()
                path_to_id[key] = (
                    existing[0]
                    if existing
                    else conn.execute(
                        "INSERT INTO categories (name, parent_id) VALUES (?, ?)", (name, parent_id)
                    ).lastrowid
                )
            parent_id = path_to_id[key]
    return path_to_id


def import_rules(conn, rows: list[dict], path_to_id: dict[str, int]) -> int:
    """Insert each rule under the category named by its path; skip (with a note) unknown paths."""
    count = 0
    for row in rows:
        category_id = path_to_id.get(row["category_path"])
        if category_id is None:
            print(f"Skipping rule for unknown category path: {row['category_path']!r}")
            continue
        conn.execute(
            "INSERT INTO label_rules (category_id, pattern, priority, is_income_anchor, description) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                category_id,
                row["pattern"],
                int(row["priority"]) if row["priority"] else 100,
                1 if row["is_income_anchor"] == "1" else 0,
                row["description"] or None,
            ),
        )
        count += 1
    return count


def resolve_overrides(conn: sqlite3.Connection, rows: list[dict]) -> dict[str, int]:
    """Map each override row's import_hash to the transaction it applies to.

    By import_hash first. A hash not in the DB falls back to the row's identity columns (account,
    operation date, libellé, amounts): a row uploaded under the account code used to hash
    differently from the same row rebuilt from _inputs/ under the filename alias. Identical
    operations are matched in order, never twice. Rows found neither way are left out; files
    older than the identity columns match by hash only."""
    ids: dict[str, int] = {}
    pending: list[dict] = []
    for row in rows:
        found = conn.execute(
            "SELECT id FROM transactions WHERE import_hash = ?", (row["import_hash"],)
        ).fetchone()
        if found:
            ids[row["import_hash"]] = found[0]
        else:
            pending.append(row)
    claimed = set(ids.values())
    for row in pending:
        if not (row.get("account_id") and row.get("date_operation") and row.get("debit_cents")):
            continue
        candidates = conn.execute(
            "SELECT id FROM transactions WHERE account_id = ? AND date_operation = ? AND libelle = ? "
            "AND debit_cents = ? AND credit_cents = ? ORDER BY id",
            (
                row["account_id"],
                row["date_operation"],
                row["libelle"],
                int(row["debit_cents"]),
                int(row["credit_cents"] or 0),
            ),
        ).fetchall()
        free = next((id_ for (id_,) in candidates if id_ not in claimed), None)
        if free is not None:
            ids[row["import_hash"]] = free
            claimed.add(free)
    return ids


def import_overrides(
    conn, rows: list[dict], path_to_id: dict[str, int], ids_by_hash: dict[str, int]
) -> tuple[int, int]:
    """Re-apply manual category/kind overrides to the transactions resolve_overrides found.
    Returns (applied, skipped). A skipped row = a transaction not in this DB (statement not
    imported) or an override pointing at an unknown category path."""
    applied = skipped = 0
    for row in rows:
        id_ = ids_by_hash.get(row["import_hash"])
        if id_ is None:
            skipped += 1
            continue
        touched = False
        if row["category_path"]:
            category_id = path_to_id.get(row["category_path"])
            if category_id is None:
                print(f"Skipping category override for unknown path: {row['category_path']!r}")
            else:
                conn.execute(
                    "UPDATE transactions SET category_id = ?, category_manual = 1, rule_id = NULL WHERE id = ?",
                    (category_id, id_),
                )
                touched = True
        # note column is optional (older exports predate it); row.get tolerates its absence.
        if row.get("note"):
            conn.execute("UPDATE transactions SET note = ? WHERE id = ?", (row["note"], id_))
            touched = True
        if row["kind"]:
            # Drop any auto pairing the fresh import made; manual pairs are re-linked afterwards
            # by restore_manual_pairs from the transfer_pair column.
            conn.execute(
                "UPDATE transactions SET kind = ?, kind_manual = 1, transfer_group_id = NULL WHERE id = ?",
                (row["kind"], id_),
            )
            touched = True
        applied += touched
    return applied, skipped


def restore_manual_pairs(
    conn: sqlite3.Connection, rows: list[dict], ids_by_hash: dict[str, int]
) -> tuple[int, int]:
    """Re-link manual transfer pairs from the overrides' `transfer_pair` column (the partner leg's
    import_hash). Runs after import_overrides, which already made both legs manual transfers.
    Returns (restored, unmatched); an unmatched leg (partner not re-imported) stays a single-leg
    manual transfer, still out of the totals. Older files without the column restore no pairs."""
    pairs = {
        frozenset((row["import_hash"], row["transfer_pair"]))
        for row in rows
        if row.get("transfer_pair") and row["transfer_pair"] != row["import_hash"]
    }
    restored = unmatched = 0
    next_group = (
        conn.execute("SELECT COALESCE(MAX(transfer_group_id), 0) FROM transactions").fetchone()[0] + 1
    )
    for pair in pairs:
        ids = [
            ids_by_hash[hash_]
            for hash_ in pair
            if hash_ in ids_by_hash
            and conn.execute(
                "SELECT 1 FROM transactions WHERE id = ? AND kind_manual = 1 AND kind = 'transfer'",
                (ids_by_hash[hash_],),
            ).fetchone()
        ]
        if len(ids) != 2:
            unmatched += 1
            continue
        conn.execute("UPDATE transactions SET transfer_group_id = ? WHERE id IN (?, ?)", (next_group, *ids))
        next_group += 1
        restored += 1
    return restored, unmatched


def import_csv(
    categories_csv: Path, rules_csv: Path, db_path: Path, overrides_csv: Path | None = None
) -> None:
    init_db(db_path)
    categories = _read_csv(categories_csv)
    rules = _read_csv(rules_csv)
    overrides = _read_csv(overrides_csv) if overrides_csv else []

    with connect(db_path) as conn:
        conn.execute("UPDATE transactions SET category_id = NULL, category_manual = 0, rule_id = NULL")
        conn.execute("DELETE FROM label_rules")
        conn.execute("DELETE FROM categories")
        path_to_id = import_categories(conn, categories)
        n_rules = import_rules(conn, rules, path_to_id)
        # Manual overrides are applied before the recompute tail: apply_rules skips category_manual=1
        # rows and recompute_transfers leaves kind_manual=1 legs alone, so the overrides survive.
        ids_by_hash = resolve_overrides(conn, overrides)
        n_over, n_skip = import_overrides(conn, overrides, path_to_id, ids_by_hash)
        n_pairs, n_unpaired = restore_manual_pairs(conn, overrides, ids_by_hash)
        n_cat = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]

    recompute_budget_months(db_path)
    n_transfer_legs = recompute_transfers(db_path)
    apply_rules(db_path)
    summary = f"Imported {n_cat} categories and {n_rules} rules into {db_path}"
    if overrides_csv:
        summary += f"; restored {n_over} overrides ({n_skip} skipped — transaction not found)"
        if n_pairs or n_unpaired:
            summary += f", {n_pairs} manual transfer pairs ({n_unpaired} with a missing leg)"
    print(summary + f"; {n_transfer_legs} transfer legs flagged")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--categories", type=Path, default=REPO_ROOT / "categories.csv")
    parser.add_argument("--rules", type=Path, default=REPO_ROOT / "rules.csv")
    parser.add_argument("--overrides", type=Path, default=None)
    parser.add_argument("--accounts", type=Path, default=None)
    parser.add_argument("--transfer-markers", type=Path, default=None)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    args = parser.parse_args()
    if args.accounts:
        load_accounts_csv(args.accounts, args.db)
    if args.transfer_markers:
        load_transfer_markers_csv(args.transfer_markers, args.db)
    import_csv(args.categories, args.rules, args.db, args.overrides)
