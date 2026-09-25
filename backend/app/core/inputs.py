"""The _inputs/ statement archive: reset_db.py rebuilds every transaction from it, so an upload is
copied there under a name that yields the same account string it was hashed with."""

from collections.abc import Sequence
from datetime import date
from pathlib import Path

from app.core.bank_profiles import BankProfile
from app.core.parsing import infer_account


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
