import hashlib
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

DEFAULT_DB_PATH = Path(os.environ.get("COMPTA_DB", str(Path(__file__).resolve().parents[2] / "compta.db")))
# The private config dir (accounts, taxonomy, bank_profiles.toml), gitignored.
DEFAULT_CONFIG_DIR = Path(
    os.environ.get("COMPTA_CONFIG_DIR", str(Path(__file__).resolve().parents[2] / "_config"))
)
# The bank-statement archive (gitignored): reset_db.py rebuilds every transaction from it, and the
# Import page copies each upload there.
DEFAULT_INPUTS_DIR = Path(
    os.environ.get("COMPTA_INPUTS_DIR", str(Path(__file__).resolve().parents[2] / "_inputs"))
)

# Accounts are user data, not code: they are loaded from an `accounts.csv` (see
# scripts/import_csv.py::import_accounts) by reset_db.py — from the private `_config/` dir, a
# `_backups/<ts>/` snapshot, or the fictional example in `data/`. init_db seeds none.

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    code                 TEXT PRIMARY KEY,
    label                TEXT NOT NULL,
    type                 TEXT NOT NULL,                 /* 'checking' | 'savings' */
    sort_order           INTEGER NOT NULL DEFAULT 0,
    deposit_pattern      TEXT                           /* external savings: libellé substring identifying its deposits */
);

CREATE TABLE IF NOT EXISTS account_aliases (
    alias TEXT PRIMARY KEY,
    code  TEXT NOT NULL REFERENCES accounts(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
    id        INTEGER PRIMARY KEY,
    name      TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id),
    UNIQUE (parent_id, name)
);

CREATE TABLE IF NOT EXISTS label_rules (
    id               INTEGER PRIMARY KEY,
    category_id      INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    pattern          TEXT NOT NULL,
    priority         INTEGER NOT NULL DEFAULT 100,
    is_income_anchor INTEGER NOT NULL DEFAULT 0,
    description      TEXT
);

/* Label prefixes identifying a virement for transfer auto-pairing (core/transfers.py).
   Empty = the built-in default (DEFAULT_TRANSFER_MARKERS); '*' = any label. */
CREATE TABLE IF NOT EXISTS transfer_markers (
    marker TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS transactions (
    id                INTEGER PRIMARY KEY,
    date_operation    TEXT NOT NULL,
    date_valeur       TEXT NOT NULL,
    budget_month      TEXT NOT NULL,
    libelle           TEXT NOT NULL,
    debit_cents       INTEGER NOT NULL DEFAULT 0,
    credit_cents      INTEGER NOT NULL DEFAULT 0,
    account           TEXT NOT NULL,                          /* raw string; feeds import_hash */
    account_id        TEXT REFERENCES accounts(code),         /* canonical, for display/grouping */
    kind              TEXT NOT NULL DEFAULT 'expense',        /* 'income' | 'expense' | 'transfer' */
    kind_manual       INTEGER NOT NULL DEFAULT 0,
    /* kind='transfer' is excluded from income/expense/category totals (see real_flow_clause).
       Paired internal transfers also share a transfer_group_id; single-legged external-savings
       deposits are kind='transfer' with transfer_group_id IS NULL (that's the "internal pair" flag). */
    transfer_group_id INTEGER,
    category_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    category_manual   INTEGER NOT NULL DEFAULT 0,
    note              TEXT,                                   /* free-text user annotation for a manual assignment */
    rule_id           INTEGER,
    import_hash       TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_budget_month ON transactions(budget_month);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, date_operation);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_group_id);
"""


def euros(cents: int) -> float:
    return cents / 100.0


def to_cents(amount: float) -> int:
    return int(round(amount * 100))


def real_flow_clause(col: str = "kind") -> str:
    """SQL predicate selecting only real flows (income/expense) — i.e. excluding ALL transfers:
    both paired internal transfers and single-legged external-savings deposits, which share
    kind='transfer'. Use transfer_group_id IS NOT NULL to single out *paired* internal pairs."""
    return f"{col} IN ('income', 'expense')"


def savings_accounts(conn: sqlite3.Connection) -> list[tuple[str, str, str | None]]:
    """(code, label, deposit_pattern) for every type='savings' account, ordered for display.
    deposit_pattern is non-null only for external accounts (no imported statement; their
    deposits are checking-account rows whose libellé contains the pattern)."""
    return conn.execute(
        "SELECT code, label, deposit_pattern FROM accounts WHERE type = 'savings' ORDER BY sort_order, code"
    ).fetchall()


def upsert_accounts(
    conn: sqlite3.Connection,
    accounts: list[tuple[str, str, str, int, str | None]],
    aliases: list[tuple[str, str]],
) -> None:
    """Insert or update canonical accounts and their import aliases.

    accounts: (code, label, type, sort_order, deposit_pattern).
    deposit_pattern is set only for *external* savings accounts that have no imported statement
    (e.g. a child's Livret A): their deposits are detected by this libellé substring on a
    checking account rather than by rows of their own. None for imported accounts.
    aliases: (alias, code) — import strings (from filenames or manual entry) mapped to a code.
    Upserts rather than replaces so transactions already pointing at an account stay valid."""
    conn.executemany(
        "INSERT INTO accounts (code, label, type, sort_order, deposit_pattern) "
        "VALUES (?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET label = excluded.label, "
        "type = excluded.type, sort_order = excluded.sort_order, deposit_pattern = excluded.deposit_pattern",
        accounts,
    )
    conn.executemany(
        "INSERT INTO account_aliases (alias, code) VALUES (?, ?) "
        "ON CONFLICT(alias) DO UPDATE SET code = excluded.code",
        [(alias.strip().upper(), code) for alias, code in aliases],
    )


def get_transfer_markers(conn: sqlite3.Connection) -> list[str]:
    """The configured transfer markers, in the order they were saved (may be empty)."""
    return [m for (m,) in conn.execute("SELECT marker FROM transfer_markers ORDER BY rowid")]


def replace_transfer_markers(conn: sqlite3.Connection, markers: list[str]) -> list[str]:
    """Replace the transfer markers (blanks dropped, duplicates removed keeping the first).
    An empty list means "use the built-in default". Returns the stored list."""
    cleaned = list(dict.fromkeys(m.strip() for m in markers if m.strip()))
    conn.execute("DELETE FROM transfer_markers")
    conn.executemany("INSERT INTO transfer_markers (marker) VALUES (?)", [(m,) for m in cleaned])
    return cleaned


def load_account_aliases(conn: sqlite3.Connection) -> dict[str, str]:
    """alias (uppercased) -> canonical account code."""
    return {alias.upper(): code for alias, code in conn.execute("SELECT alias, code FROM account_aliases")}


def resolve_account_code(raw: str, aliases: dict[str, str]) -> str | None:
    """Map a raw import account string to a canonical code: exact alias match first,
    then the longest alias contained in the string. None if nothing matches."""
    key = raw.strip().upper()
    if key in aliases:
        return aliases[key]
    contained = [(alias, code) for alias, code in aliases.items() if alias in key]
    if contained:
        return max(contained, key=lambda pair: len(pair[0]))[1]
    return None


def _row_hash(
    account: str, date_op: str, libelle: str, debit: float, credit: float, occurrence: int = 0
) -> str:
    """Identity of one operation. Amounts are hashed as euro floats (not cents) and
    `occurrence` stays out of the key when 0 so hashes of rows imported by earlier
    versions remain valid. Never change this formula for occurrence 0.
    `occurrence` distinguishes genuinely identical rows within one statement."""
    key = f"{account}|{date_op}|{libelle}|{debit}|{credit}"
    if occurrence:
        key += f"|{occurrence}"
    return hashlib.sha256(key.encode()).hexdigest()


@contextmanager
def connect(db_path: Path = DEFAULT_DB_PATH) -> Iterator[sqlite3.Connection]:
    """Connection with foreign keys on; commits on success, rolls back on error, always closes."""
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Schema initialisation
# ---------------------------------------------------------------------------


def init_db(db_path: Path = DEFAULT_DB_PATH) -> None:
    """Create the schema if absent. Idempotent. Seeds no accounts (they're user data — see
    upsert_accounts; reset_db.py loads them from accounts.csv).

    Early-dev: there is no migration ladder — the schema is a single version. If the
    shape changes, rebuild with scripts/reset_db.py (snapshots taxonomy+overrides first).
    """
    conn = sqlite3.connect(db_path)
    try:
        with conn:
            conn.executescript(SCHEMA)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Imports and assignments
# ---------------------------------------------------------------------------


def import_transactions(rows: list[dict], db_path: Path = DEFAULT_DB_PATH) -> int:
    """Insert rows into the transactions table, skipping duplicates.

    Each row must carry the keys produced by core.parsing.parse_csv plus 'account'.
    Returns the number of newly inserted rows.

    A row is a duplicate when its import_hash exists, or when the resolved account already holds
    as many identical operations (same date, libellé, amounts) as this one's occurrence — so the
    same statement imported under two raw account strings that map to one account (e.g. inferred
    'JOINT' from the filename, then typed 'Compte joint') isn't imported twice.
    """
    inserted = 0
    occurrences: dict[tuple, int] = {}
    with connect(db_path) as conn:
        aliases = load_account_aliases(conn)
        for row in rows:
            date_op = str(row["Date operation"])[:10]
            date_val = str(row["Date valeur"])[:10]
            libelle = str(row["Libelle"])
            debit, credit = float(row["Debit"]), float(row["Credit"])
            account = str(row["account"])
            identity = (account, date_op, libelle, debit, credit)
            occurrence = occurrences.get(identity, 0)
            occurrences[identity] = occurrence + 1
            h = _row_hash(*identity, occurrence)
            kind = "income" if credit > 0 else "expense"
            account_id = resolve_account_code(account, aliases)
            debit_cents, credit_cents = to_cents(debit), to_cents(credit)
            if account_id is not None:
                # Counts rows inserted earlier in this same call too, which is what keeps two
                # genuinely identical operations of one file (occurrence 0 and 1) both importable.
                existing = conn.execute(
                    "SELECT COUNT(*) FROM transactions WHERE account_id = ? AND date_operation = ? "
                    "AND libelle = ? AND debit_cents = ? AND credit_cents = ?",
                    (account_id, date_op, libelle, debit_cents, credit_cents),
                ).fetchone()[0]
                if existing > occurrence:
                    continue  # already imported (possibly under another alias of the account)
            try:
                conn.execute(
                    "INSERT INTO transactions "
                    "(date_operation, date_valeur, budget_month, libelle, debit_cents, credit_cents, "
                    "account, account_id, kind, import_hash) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        date_op,
                        date_val,
                        date_val[:7],  # calendar month; core.periods reassigns paycheck periods
                        libelle,
                        debit_cents,
                        credit_cents,
                        account,
                        account_id,
                        kind,
                        h,
                    ),
                )
                inserted += 1
            except sqlite3.IntegrityError:
                pass  # duplicate — skip
    return inserted
