"""Bank CSV formats ("profiles").

The built-in DEFAULT_PROFILE is the historical format (semicolons, comma decimals, dd/mm/yyyy,
"Date operation;Date valeur;Libelle;Debit;Credit"). Other banks are described in an optional
`bank_profiles.toml` in the config dir (see data/bank_profiles.toml for a commented example).
Statements are matched against the user's profiles in file order, then the default.
"""

import codecs
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

PROFILES_FILENAME = "bank_profiles.toml"


class BankProfileError(ValueError):
    """bank_profiles.toml is unreadable or describes an invalid profile (French message: the Import
    page shows it)."""


@dataclass(frozen=True)
class BankProfile:
    name: str
    date_operation: str
    libelle: str
    date_valeur: str | None = None  # absent: the operation date stands in
    debit: str | None = None  # two unsigned columns...
    credit: str | None = None
    amount: str | None = None  # ...or one signed column (negative = debit)
    delimiter: str = ";"
    encodings: tuple[str, ...] = ("utf-8-sig", "cp1252")
    date_format: str = "%d/%m/%Y"
    decimal: str = ","
    filename_pattern: re.Pattern[str] | None = None  # must have an (?P<account>...) group

    @property
    def required_columns(self) -> list[str]:
        columns = [self.date_operation, self.date_valeur, self.libelle]
        columns += [self.amount] if self.amount else [self.debit, self.credit]
        return [c for c in columns if c]


# Never change: its parsing feeds import_hash for every statement already imported.
DEFAULT_PROFILE = BankProfile(
    name="default",
    date_operation="Date operation",
    date_valeur="Date valeur",
    libelle="Libelle",
    debit="Debit",
    credit="Credit",
    filename_pattern=re.compile(r"^RELEVE_(?:COMPTE_)?(?P<account>.+?)_\d{4}"),
)

_STR_KEYS = (
    "name",
    "date_operation",
    "libelle",
    "date_valeur",
    "debit",
    "credit",
    "amount",
    "delimiter",
    "date_format",
    "decimal",
    "filename_pattern",
)
_KEYS = {*_STR_KEYS, "encoding"}


def profile_from_dict(data: dict) -> BankProfile:
    """Validate one [[profile]] table. Raises BankProfileError naming the problem."""
    name = data.get("name")
    label = f"profil « {name} »" if name else "un profil"
    unknown = sorted(set(data) - _KEYS)
    if unknown:
        raise BankProfileError(f"{label} : clé(s) inconnue(s) {', '.join(unknown)}")
    for key in _STR_KEYS:
        if key in data and not isinstance(data[key], str):
            raise BankProfileError(f"{label} : {key} doit être un texte")
    if not name:
        raise BankProfileError("chaque profil doit avoir un nom (name)")
    for key in ("date_operation", "libelle"):
        if not data.get(key):
            raise BankProfileError(f"{label} : {key} (le nom de la colonne) est obligatoire")

    has_amount = bool(data.get("amount"))
    has_debit, has_credit = bool(data.get("debit")), bool(data.get("credit"))
    if (has_amount and (has_debit or has_credit)) or (not has_amount and not (has_debit and has_credit)):
        raise BankProfileError(f"{label} : indiquez soit amount, soit debit et credit")

    delimiter = data.get("delimiter", ";")
    if len(delimiter) != 1:
        raise BankProfileError(f"{label} : delimiter doit être un seul caractère")
    decimal = data.get("decimal", ",")
    if decimal not in (",", "."):
        raise BankProfileError(f"{label} : decimal doit valoir ',' ou '.'")

    encodings = data.get("encoding", ["utf-8-sig", "cp1252"])
    if isinstance(encodings, str):
        encodings = [encodings]
    if not encodings or not all(isinstance(e, str) for e in encodings):
        raise BankProfileError(f"{label} : encoding doit être un texte ou une liste de textes")
    for encoding in encodings:
        try:
            codecs.lookup(encoding)
        except LookupError as exc:
            raise BankProfileError(f"{label} : encoding inconnu « {encoding} »") from exc

    pattern = None
    if data.get("filename_pattern"):
        try:
            pattern = re.compile(data["filename_pattern"])
        except re.error as exc:
            raise BankProfileError(f"{label} : filename_pattern invalide ({exc})") from exc
        if "account" not in pattern.groupindex:
            raise BankProfileError(f"{label} : filename_pattern doit contenir un groupe (?P<account>...)")

    return BankProfile(
        name=name,
        date_operation=data["date_operation"],
        libelle=data["libelle"],
        date_valeur=data.get("date_valeur") or None,
        debit=data.get("debit") or None,
        credit=data.get("credit") or None,
        amount=data.get("amount") or None,
        delimiter=delimiter,
        encodings=tuple(encodings),
        date_format=data.get("date_format", "%d/%m/%Y"),
        decimal=decimal,
        filename_pattern=pattern,
    )


def parse_bank_profiles(text: str) -> list[BankProfile]:
    """Parse a bank_profiles.toml document: an array of [[profile]] tables."""
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise BankProfileError(f"TOML invalide ({exc})") from exc
    unknown = sorted(set(data) - {"profile"})
    if unknown:
        raise BankProfileError(
            f"clé(s) inconnue(s) {', '.join(unknown)} (seules des tables [[profile]] sont attendues)"
        )
    tables = data.get("profile", [])
    if not isinstance(tables, list) or not all(isinstance(t, dict) for t in tables):
        raise BankProfileError("les profils doivent être des tables [[profile]]")

    profiles = [profile_from_dict(t) for t in tables]
    seen: set[str] = set()
    for profile in profiles:
        if profile.name == DEFAULT_PROFILE.name:
            raise BankProfileError(f"le nom « {profile.name} » est réservé au format intégré")
        if profile.name in seen:
            raise BankProfileError(f"nom de profil en double : « {profile.name} »")
        seen.add(profile.name)
    return profiles


def load_bank_profiles(config_dir: Path) -> list[BankProfile]:
    """The user's profiles from <config_dir>/bank_profiles.toml, then DEFAULT_PROFILE. Read on
    every call, so edits apply without restarting the server."""
    path = config_dir / PROFILES_FILENAME
    if not path.exists():
        return [DEFAULT_PROFILE]
    return [*parse_bank_profiles(path.read_text(encoding="utf-8")), DEFAULT_PROFILE]
