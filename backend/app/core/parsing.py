import csv
import io
from collections.abc import Sequence
from datetime import datetime

from app.core.bank_profiles import DEFAULT_PROFILE, BankProfile

# Canonical keys of a parsed row, whatever the bank's own column names.
REQUIRED_COLUMNS = ["Date operation", "Date valeur", "Libelle", "Debit", "Credit"]

# How far down a file the header row is looked for (some banks start with account/balance lines).
HEADER_SCAN_LINES = 30


class CsvValidationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def infer_account(filename: str, profiles: Sequence[BankProfile] = (DEFAULT_PROFILE,)) -> str | None:
    """Guess the account name from a bank export filename with the first profile pattern that
    matches, e.g. RELEVE_COMPTE_APPARTEMENT_LOCATIF_2026_06_08.csv -> 'APPARTEMENT LOCATIF'.
    Not stripped: the string is part of import_hash."""
    for profile in profiles:
        match = profile.filename_pattern.search(filename) if profile.filename_pattern else None
        if match and match.group("account"):
            return match.group("account").replace("_", " ")
    return None


# Thousands separators seen in French exports: plain space, no-break space, narrow no-break space.
_THOUSANDS_SEPARATORS = (" ", " ", " ")


def _parse_number(value: str, decimal: str) -> float | None:
    """'1 234,56' (decimal ',') or '1,234.56' (decimal '.') to a signed float.
    Empty/missing -> 0.0; unparseable -> None."""
    cleaned = value.strip()
    for sep in _THOUSANDS_SEPARATORS:
        cleaned = cleaned.replace(sep, "")
    # With a comma decimal this is exactly the historical parsing, which import_hash depends on.
    cleaned = cleaned.replace(",", ".") if decimal == "," else cleaned.replace(",", "")
    if cleaned in ("", "nan"):
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_amount(value: str, decimal: str = ",") -> float | None:
    """Amount of a Debit or Credit column, as a non-negative float. The column already gives the
    direction, so a sign some banks put on debits ('-12,00') is dropped."""
    parsed = _parse_number(value, decimal)
    return None if parsed is None else abs(parsed)


def _decode(content: bytes, encodings: Sequence[str]) -> str:
    """Try each encoding in turn (UTF-8 first; many French bank exports are Windows-1252)."""
    for encoding in encodings[:-1]:
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode(encodings[-1])


def _header_line(table: list[list[str]], columns: list[str]) -> tuple[int, list[str]]:
    """Index of the first line (within HEADER_SCAN_LINES) holding every column, and the columns
    still missing from the closest line when none does (index -1)."""
    best: list[str] | None = None
    for idx, line in enumerate(table[:HEADER_SCAN_LINES]):
        header = {cell.strip() for cell in line}
        missing = [c for c in columns if c not in header]
        if not missing:
            return idx, []
        if best is None or len(missing) < len(best):
            best = missing
    return -1, best or columns


def detect_profile(
    content: bytes, profiles: Sequence[BankProfile]
) -> tuple[BankProfile, list[list[str]], int]:
    """The first profile whose columns all appear on one of the file's first lines, with the file
    read as a table in that profile's encoding and delimiter, and the header line's index."""
    failures: list[tuple[BankProfile, str]] = []
    for profile in profiles:
        try:
            text = _decode(content, profile.encodings)
            table = list(csv.reader(io.StringIO(text), delimiter=profile.delimiter))
        except (UnicodeDecodeError, csv.Error) as exc:
            failures.append((profile, f"Unreadable CSV: {exc}"))
            continue
        if not table:
            raise CsvValidationError(["CSV contains no transactions"])
        idx, missing = _header_line(table, profile.required_columns)
        if idx >= 0:
            return profile, table, idx
        failures.append((profile, f"Missing column(s): {', '.join(missing)}"))

    if len(failures) == 1:
        raise CsvValidationError([failures[0][1]])
    raise CsvValidationError(
        ["No bank profile matches this file."] + [f"{p.name}: {reason}" for p, reason in failures]
    )


def parse_statement(content: bytes, profiles: Sequence[BankProfile]) -> tuple[BankProfile, list[dict]]:
    """Parse one bank statement with the first matching profile (see detect_profile).

    Returns the profile and a list of row dicts keyed by REQUIRED_COLUMNS (dates as ISO
    'YYYY-MM-DD' strings, Debit/Credit as non-negative floats), sorted by 'Date valeur'.
    A profile without a value-date column uses the operation date. Raises CsvValidationError with
    row-level messages (real file line numbers) on malformed input.
    """
    profile, table, header_idx = detect_profile(content, profiles)
    header = [cell.strip() for cell in table[header_idx]]
    col = {name: header.index(name) for name in profile.required_columns}

    def cell(raw: list[str], name: str) -> str:
        return raw[col[name]] if col[name] < len(raw) else ""

    errors: list[str] = []
    rows: list[dict] = []
    for line_no, raw in enumerate(table[header_idx + 1 :], start=header_idx + 2):
        if not any(value.strip() for value in raw):
            continue  # blank line

        record: dict = {}
        for key, column in (("Date operation", profile.date_operation), ("Date valeur", profile.date_valeur)):
            if column is None:
                record[key] = record["Date operation"]
                continue
            value = cell(raw, column).strip()
            try:
                record[key] = datetime.strptime(value, profile.date_format).strftime("%Y-%m-%d")
            except ValueError:
                errors.append(f"Row {line_no}: invalid date in '{column}': {value!r}")
                record[key] = None

        if profile.amount:
            value = cell(raw, profile.amount)
            signed = _parse_number(value, profile.decimal)
            if signed is None:
                errors.append(f"Row {line_no}: invalid amount in '{profile.amount}': {value!r}")
                signed = 0.0
            # Literal 0.0 on the unused side (never -0.0, whose text would change import_hash).
            record["Debit"] = -signed if signed < 0 else 0.0
            record["Credit"] = signed if signed > 0 else 0.0
        else:
            for key, column in (("Debit", profile.debit), ("Credit", profile.credit)):
                value = cell(raw, column)
                parsed = _parse_amount(value, profile.decimal)
                if parsed is None:
                    errors.append(f"Row {line_no}: invalid amount in '{column}': {value!r}")
                    parsed = 0.0
                record[key] = parsed

        record["Libelle"] = cell(raw, profile.libelle)  # raw, unstripped: part of import_hash
        rows.append(record)

    if errors:
        raise CsvValidationError(errors)
    if not rows:
        raise CsvValidationError(["CSV contains no transactions"])

    rows.sort(key=lambda r: r["Date valeur"])
    return profile, rows


def parse_csv(content: bytes, profiles: Sequence[BankProfile] = (DEFAULT_PROFILE,)) -> list[dict]:
    """parse_statement without the matched profile (the default format unless profiles given)."""
    return parse_statement(content, profiles)[1]
