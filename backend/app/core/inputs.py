"""The _inputs/ statement archive: reset_db.py rebuilds every transaction from it, so an upload is
copied there under a name that yields the same account string it was hashed with. Statements
dropped there by hand are imported in bulk by import_inputs_dir."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import pairwise
from pathlib import Path

from app.core.bank_profiles import BankProfile
from app.core.parsing import CsvValidationError, infer_account, parse_statement, rows_since
from app.db import connect, import_transactions, load_account_aliases, resolve_account_code


def archive_filename(filename: str, account: str, profiles: Sequence[BankProfile], today: date) -> str | None:
    """The name to archive an upload under: its own when the filename already yields `account`,
    else `RELEVE_<account>_<today>_<filename>` (the default pattern). None when no name does,
    e.g. an account string with an underscore (inference turns `_` into spaces)."""
    name = Path(filename.replace("\\", "/")).name or "releve.csv"
    if not name.lower().endswith(".csv"):
        name += ".csv"  # reset_db.py only reads *.csv
    if infer_account(name, profiles) == account:
        return name
    name = f"RELEVE_{account.replace(' ', '_')}_{today:%Y_%m_%d}_{name}"
    return name if infer_account(name, profiles) == account else None


def archive_statement(
    inputs_dir: Path,
    filename: str,
    content: bytes,
    account: str,
    profiles: Sequence[BankProfile],
    today: date | None = None,
) -> str | None:
    """Copy an uploaded statement into `inputs_dir` so a rebuild imports it with the same account
    string (hence the same import_hash). Never overwrites a different file: a name clash gets a
    ` (2)`, ` (3)`… suffix. A file already there with the same bytes and account is reused.
    Returns the archived file name, or None when the upload can't be archived faithfully."""
    name = archive_filename(filename, account, profiles, today or date.today())
    if name is None:
        return None
    inputs_dir.mkdir(parents=True, exist_ok=True)
    for existing in sorted(inputs_dir.glob("*.csv")):
        if infer_account(existing.name, profiles) == account and existing.read_bytes() == content:
            return existing.name
    stem, suffix = name[: -len(".csv")], name[-len(".csv") :]
    candidate, n = name, 2
    while (inputs_dir / candidate).exists():
        candidate, n = f"{stem} ({n}){suffix}", n + 1
    if infer_account(candidate, profiles) != account:  # a profile pattern anchored at the end
        return None
    (inputs_dir / candidate).write_bytes(content)
    return candidate


@dataclass(frozen=True)
class InputFileResult:
    name: str
    account: str | None
    rows_total: int = 0
    rows_new: int = 0
    profile: str | None = None
    error: str | None = None
    rows_before_start: int = 0
    gap_warning: str | None = None


# Days a statement may start after the account's last operation without being flagged: a weekend
# plus a bank holiday.
GAP_TOLERANCE_DAYS = 4


def last_value_date(db_path: Path, account_code: str) -> str | None:
    """The account's latest value date already in the DB (ISO), None when it has no rows."""
    with connect(db_path) as conn:
        (last,) = conn.execute(
            "SELECT MAX(date_valeur) FROM transactions WHERE account_id = ?", (account_code,)
        ).fetchone()
    return last


def gap_warning(last: str | None, rows: list[dict]) -> str | None:
    """French warning when the statement's first value date falls more than GAP_TOLERANCE_DAYS
    after `last` (read before inserting it). Overlapping or contiguous files, an account's first
    import and a file left empty by the start date give None. A heuristic: only the import that
    creates a hole flags it (a rescan of _inputs then overlaps), and a quiet account can warn."""
    if last is None or not rows:
        return None
    previous = date.fromisoformat(last[:10])
    first = date.fromisoformat(min(row["Date valeur"] for row in rows)[:10])
    if (first - previous).days <= GAP_TOLERANCE_DAYS:
        return None
    return (
        f"Trou possible : aucune opération entre le {previous:%d/%m/%Y} (dernière en base) et le "
        f"{first:%d/%m/%Y} (début du fichier), soit {(first - previous).days - 1} jours. "
        "Un relevé manque-t-il ?"
    )


@dataclass(frozen=True)
class Silence:
    """Days with no operation (in the DB) or covered by no statement (in _inputs), `start` to
    `end` inclusive (ISO)."""

    start: str
    end: str
    days: int


def _silence(before: date, after: date) -> Silence:
    """The days strictly between two dates."""
    return Silence(str(before + timedelta(days=1)), str(after - timedelta(days=1)), (after - before).days - 1)


@dataclass(frozen=True)
class AccountCoverage:
    code: str
    label: str
    first: str | None  # value dates of the account's first and last operations in the DB
    last: str | None
    operations: int
    files: int  # _inputs statements of the account with rows since the start date
    longest_silence: Silence | None  # in the DB: a quiet stretch, maybe a missing statement
    holes: list[Silence]  # between _inputs statements that don't overlap, as gap_warning judges them


def account_coverage(
    db_path: Path, inputs_dir: Path, profiles: Sequence[BankProfile], start_date: date | None = None
) -> list[AccountCoverage]:
    """Per account with statements (external savings excluded), what the DB and _inputs/ cover.
    A statement covers its first to last value date; consecutive ones whose ranges are more than
    GAP_TOLERANCE_DAYS apart leave a hole that no file covers, which stays visible after the
    import that created it. Unreadable files and files of no known account are left out (the
    Import page's bulk import reports them)."""
    with connect(db_path) as conn:
        aliases = load_account_aliases(conn)
        accounts = conn.execute(
            "SELECT code, label FROM accounts WHERE deposit_pattern IS NULL ORDER BY sort_order, code"
        ).fetchall()
        days_by_account: dict[str, list[date]] = {code: [] for code, _ in accounts}
        operations = dict.fromkeys(days_by_account, 0)
        for code, day, count in conn.execute(
            "SELECT account_id, substr(date_valeur, 1, 10) AS day, COUNT(*) FROM transactions "
            "GROUP BY account_id, day ORDER BY day"
        ):
            if code in days_by_account:
                days_by_account[code].append(date.fromisoformat(day))
                operations[code] += count

    ranges: dict[str, list[tuple[date, date]]] = {code: [] for code in days_by_account}
    for path in sorted(inputs_dir.glob("*.csv")) if inputs_dir.exists() else []:
        account = infer_account(path.name, profiles)
        code = resolve_account_code(account, aliases) if account else None
        if code not in ranges:
            continue
        try:
            _, rows = parse_statement(path.read_bytes(), profiles)
        except CsvValidationError:
            continue
        rows, _ = rows_since(rows, start_date)
        if rows:  # sorted by value date
            ranges[code].append(
                (
                    date.fromisoformat(rows[0]["Date valeur"][:10]),
                    date.fromisoformat(rows[-1]["Date valeur"][:10]),
                )
            )

    result = []
    for code, label in accounts:
        days = days_by_account[code]
        longest = max(pairwise(days), key=lambda pair: pair[1] - pair[0], default=None)
        holes = []
        covered_until: date | None = None
        for first, last in sorted(ranges[code]):
            if covered_until is not None and (first - covered_until).days > GAP_TOLERANCE_DAYS:
                holes.append(_silence(covered_until, first))
            covered_until = last if covered_until is None else max(covered_until, last)
        result.append(
            AccountCoverage(
                code,
                label,
                str(days[0]) if days else None,
                str(days[-1]) if days else None,
                operations[code],
                len(ranges[code]),
                _silence(*longest) if longest and (longest[1] - longest[0]).days > 1 else None,
                holes,
            )
        )
    return result


def import_inputs_dir(
    db_path: Path, inputs_dir: Path, profiles: Sequence[BankProfile], start_date: date | None = None
) -> list[InputFileResult]:
    """Import every bank CSV in `inputs_dir` into the existing DB, inferring the account from the
    filename, minus the rows valued before `start_date` (core.settings). Re-importing a file adds
    nothing (import_transactions dedupes), so the whole folder can be rescanned after dropping new
    statements in. A file that maps to no known account or fails to parse is reported with its
    error and skipped. The caller recomputes periods, transfers and rules afterwards."""
    if not inputs_dir.exists():
        return []
    with connect(db_path) as conn:
        aliases = load_account_aliases(conn)

    results = []
    for path in sorted(inputs_dir.glob("*.csv")):
        account = infer_account(path.name, profiles)
        code = resolve_account_code(account, aliases) if account else None
        if not account or code is None:
            results.append(
                InputFileResult(path.name, account, error="aucun compte connu dans le nom du fichier")
            )
            continue
        try:
            profile, rows = parse_statement(path.read_bytes(), profiles)
        except CsvValidationError as exc:
            results.append(InputFileResult(path.name, account, error=str(exc)))
            continue
        rows, before_start = rows_since(rows, start_date)
        for row in rows:
            row["account"] = account
        gap = gap_warning(last_value_date(db_path, code), rows)  # before the insert
        new = import_transactions(rows, db_path)
        results.append(
            InputFileResult(
                path.name,
                account,
                len(rows),
                new,
                profile.name,
                rows_before_start=before_start,
                gap_warning=gap,
            )
        )
    return results
