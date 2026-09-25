import csv
import io
import re
from datetime import datetime

REQUIRED_COLUMNS = ["Date operation", "Date valeur", "Libelle", "Debit", "Credit"]

ACCOUNT_FILENAME_RE = re.compile(r"^RELEVE_(?:COMPTE_)?(?P<account>.+?)_\d{4}")


class CsvValidationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def infer_account(filename: str) -> str | None:
    """Guess the account name from a bank export filename, e.g.
    RELEVE_COMPTE_APPARTEMENT_LOCATIF_2026_06_08.csv -> 'APPARTEMENT LOCATIF'."""
    match = ACCOUNT_FILENAME_RE.match(filename)
    if not match:
        return None
    return match.group("account").replace("_", " ")


# Thousands separators seen in French exports: plain space, no-break space, narrow no-break space.
_THOUSANDS_SEPARATORS = (" ", "\u00a0", "\u202f")


def _parse_amount(value: str) -> float | None:
    """French amount ('1 234,56') to a non-negative float. The Debit/Credit column already
    gives the direction, so a sign some banks put on debits ('-12,00') is dropped.
    Empty/missing -> 0.0; unparseable -> None."""
    cleaned = value.strip()
    for sep in _THOUSANDS_SEPARATORS:
        cleaned = cleaned.replace(sep, "")
    cleaned = cleaned.replace(",", ".")
    if cleaned in ("", "nan"):
        return 0.0
    try:
        return abs(float(cleaned))
    except ValueError:
        return None


def _decode(content: bytes) -> str:
    """UTF-8 (with or without BOM) first; many French bank exports are Windows-1252 instead."""
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("cp1252")


def parse_csv(content: bytes) -> list[dict]:
    """Parse one uploaded bank CSV (semicolon-delimited, comma decimals, dd/mm/yyyy dates).

    Returns a list of row dicts with REQUIRED_COLUMNS (dates as ISO 'YYYY-MM-DD'
    strings, Debit/Credit as floats) plus 'budget_month' (calendar month;
    core.periods reassigns it to paycheck periods after import), sorted by 'Date valeur'.
    Raises CsvValidationError with row-level messages on malformed input.
    """
    try:
        text = _decode(content)
        reader = csv.reader(io.StringIO(text), delimiter=";")
        table = list(reader)
    except Exception as exc:
        raise CsvValidationError([f"Unreadable CSV: {exc}"]) from exc

    if not table:
        raise CsvValidationError(["CSV contains no transactions"])

    header = [c.strip() for c in table[0]]
    missing = [c for c in REQUIRED_COLUMNS if c not in header]
    if missing:
        raise CsvValidationError([f"Missing column(s): {', '.join(missing)}"])
    col = {name: header.index(name) for name in REQUIRED_COLUMNS}

    errors: list[str] = []
    rows: list[dict] = []
    for line_no, raw in enumerate(table[1:], start=2):
        if not any(cell.strip() for cell in raw):
            continue  # blank line
        cell = lambda name: raw[col[name]] if col[name] < len(raw) else ""

        record: dict = {}
        for date_col in ("Date operation", "Date valeur"):
            value = cell(date_col).strip()
            try:
                record[date_col] = datetime.strptime(value, "%d/%m/%Y").strftime("%Y-%m-%d")
            except ValueError:
                errors.append(f"Row {line_no}: invalid date in '{date_col}': {value!r}")
                record[date_col] = None

        for amount_col in ("Debit", "Credit"):
            value = cell(amount_col)
            parsed = _parse_amount(value)
            if parsed is None:
                errors.append(f"Row {line_no}: invalid amount in '{amount_col}': {value!r}")
                parsed = 0.0
            record[amount_col] = parsed

        record["Libelle"] = cell("Libelle")
        rows.append(record)

    if errors:
        raise CsvValidationError(errors)
    if not rows:
        raise CsvValidationError(["CSV contains no transactions"])

    for record in rows:
        record["budget_month"] = record["Date valeur"][:7]
    rows.sort(key=lambda r: r["Date valeur"])
    return rows
