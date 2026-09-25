from pathlib import Path

import pytest

from app.core.bank_profiles import (
    DEFAULT_PROFILE,
    BankProfileError,
    load_bank_profiles,
    parse_bank_profiles,
)
from app.core.parsing import REQUIRED_COLUMNS, CsvValidationError, infer_account, parse_csv, parse_statement
from app.db import _row_hash

EXAMPLE_DIR = Path(__file__).resolve().parents[2] / "data"


def _csv(*rows: str) -> bytes:
    header = '"Date operation";"Date valeur";"Libelle";"Debit";"Credit"'
    return "\n".join([header, *rows]).encode("utf-8")


class TestParseCsv:
    def test_parses_french_format(self):
        rows = parse_csv(_csv('"06/06/2026";"06/06/2026";"CARTE U EXPRESS";"63,82";""'))
        assert len(rows) == 1
        assert rows[0]["Debit"] == 63.82
        assert rows[0]["Credit"] == 0.0
        assert rows[0]["Date valeur"] == "2026-06-06"

    def test_thousands_separators(self):
        rows = parse_csv(_csv(
            '"06/06/2026";"06/06/2026";"A";"1 234,56";""',
            '"06/06/2026";"06/06/2026";"B";"";"2\u00a0500,00"',
            '"06/06/2026";"06/06/2026";"C";"10\u202f000,00";""',
        ))
        assert [(r["Debit"], r["Credit"]) for r in rows] == [(1234.56, 0.0), (0.0, 2500.0), (10000.0, 0.0)]

    def test_signed_debit_is_made_positive(self):
        # The column carries the direction; a leading minus must not produce a negative debit.
        rows = parse_csv(_csv('"06/06/2026";"06/06/2026";"CARTE";"-12,00";""'))
        assert rows[0]["Debit"] == 12.0

    def test_windows_1252_export(self):
        content = _csv('"06/06/2026";"06/06/2026";"CAFÉ DU PORT";"3,50";""').decode().encode("cp1252")
        assert parse_csv(content)[0]["Libelle"] == "CAFÉ DU PORT"

    def test_sorted_by_date_valeur(self):
        rows = parse_csv(_csv(
            '"06/06/2026";"06/06/2026";"B";"1,00";""',
            '"01/06/2026";"01/06/2026";"A";"1,00";""',
        ))
        assert [r["Libelle"] for r in rows] == ["A", "B"]

    def test_budget_month_is_calendar_month(self):
        # Paycheck periods are applied later by core.periods, not at parse time.
        rows = parse_csv(_csv('"28/06/2026";"28/06/2026";"VIR EMPLOYEUR";"";"2500,00"'))
        assert rows[0]["budget_month"] == "2026-06"

    def test_missing_column_rejected(self):
        content = '"Date operation";"Libelle";"Debit"\n"06/06/2026";"X";"1,00"'.encode()
        with pytest.raises(CsvValidationError, match="Missing column"):
            parse_csv(content)

    def test_invalid_date_reported_with_row(self):
        with pytest.raises(CsvValidationError, match="Row 2.*Date valeur"):
            parse_csv(_csv('"06/06/2026";"not a date";"X";"1,00";""'))

    def test_invalid_amount_reported_with_row(self):
        with pytest.raises(CsvValidationError, match="Row 2.*Debit"):
            parse_csv(_csv('"06/06/2026";"06/06/2026";"X";"abc";""'))

    def test_empty_csv_rejected(self):
        with pytest.raises(CsvValidationError, match="no transactions"):
            parse_csv(_csv())


class TestInferAccount:
    def test_compte_pattern(self):
        assert infer_account("RELEVE_COMPTE_APPARTEMENT_LOCATIF_2026_06_08_12_50_51.csv") == "APPARTEMENT LOCATIF"
        assert infer_account("RELEVE_COMPTE_JOINT_2026_06_08_12_50_48.csv") == "JOINT"

    def test_livret_pattern(self):
        assert infer_account("RELEVE_LIVRET_A_2026_06_08_12_50_52.csv") == "LIVRET A"

    def test_unknown_filename(self):
        assert infer_account("export.csv") is None

    def test_profile_filename_pattern(self):
        profiles = load_bank_profiles(EXAMPLE_DIR)
        assert infer_account("export_COMPTE_PERSO_20260601.csv", profiles) == "COMPTE PERSO"

    def test_default_pattern_still_tried_after_user_patterns(self):
        profiles = load_bank_profiles(EXAMPLE_DIR)
        assert infer_account("RELEVE_COMPTE_JOINT_2026_06_08.csv", profiles) == "JOINT"


# The default format feeds import_hash: these rows and hashes were computed before bank profiles
# existed and must never change, or re-imported statements would duplicate and overrides detach.
GOLDEN_ROWS = (
    '"05/06/2026";"05/06/2026";"VIR EMPLOYEUR SALAIRE";"";"2500,00"',
    '"06/06/2026";"07/06/2026";"CARTE SUPERMARCHE ";"1 234,56";""',
    '"06/06/2026";"06/06/2026";"CARTE U EXPRESS";"-8,05";""',
    '"06/06/2026";"06/06/2026";"CARTE U EXPRESS";"-8,05";""',
)
GOLDEN_PARSED = [
    {"Date operation": "2026-06-05", "Date valeur": "2026-06-05", "Libelle": "VIR EMPLOYEUR SALAIRE",
     "Debit": 0.0, "Credit": 2500.0, "budget_month": "2026-06"},
    {"Date operation": "2026-06-06", "Date valeur": "2026-06-06", "Libelle": "CARTE U EXPRESS",
     "Debit": 8.05, "Credit": 0.0, "budget_month": "2026-06"},
    {"Date operation": "2026-06-06", "Date valeur": "2026-06-06", "Libelle": "CARTE U EXPRESS",
     "Debit": 8.05, "Credit": 0.0, "budget_month": "2026-06"},
    {"Date operation": "2026-06-06", "Date valeur": "2026-06-07", "Libelle": "CARTE SUPERMARCHE ",
     "Debit": 1234.56, "Credit": 0.0, "budget_month": "2026-06"},
]
GOLDEN_HASHES = [
    "50ac16dc2e892efc513aeef6acb71b694f0fdb8a10ef1fd124101fa2799cf7a7",
    "d5107ef171c0087a58e6e4efda13f84aa931470a86f1f3ff7e0c09aa81ba4b7b",
    "db124548ce73692707c86d7d229a0c91ed5a853eddf6c8fb4b2c12ce1f413de4",
    "4f43c25be697fb87f2bdceb1c860bfe1c6d9e33b26d3f996aa51b767e9f85bd0",
]


def _golden_hashes(rows: list[dict]) -> list[str]:
    seen: dict[tuple, int] = {}
    hashes = []
    for r in rows:
        identity = ("JOINT", r["Date operation"], r["Libelle"], r["Debit"], r["Credit"])
        hashes.append(_row_hash(*identity, seen.get(identity, 0)))
        seen[identity] = seen.get(identity, 0) + 1
    return hashes


class TestDefaultFormatFrozen:
    def test_default_rows_and_hashes_frozen(self):
        rows = parse_csv(_csv(*GOLDEN_ROWS))
        assert rows == GOLDEN_PARSED
        assert _golden_hashes(rows) == GOLDEN_HASHES

    def test_default_unchanged_with_user_profiles(self):
        _profile, rows = parse_statement(_csv(*GOLDEN_ROWS), load_bank_profiles(EXAMPLE_DIR))
        assert _profile is DEFAULT_PROFILE
        assert rows == GOLDEN_PARSED
        assert _golden_hashes(rows) == GOLDEN_HASHES

    def test_default_cp1252_row_unchanged(self):
        content = _csv('"06/06/2026";"06/06/2026";"CAFÉ DU PORT";"3,50";""').decode().encode("cp1252")
        rows = parse_statement(content, load_bank_profiles(EXAMPLE_DIR))[1]
        assert rows == parse_csv(content) and rows[0]["Libelle"] == "CAFÉ DU PORT"


def _toml(**keys: str) -> str:
    """One [[profile]] table; values are written as TOML literal strings."""
    return "[[profile]]\n" + "".join(f"{key} = '{value}'\n" for key, value in keys.items())


# A signed-amount profile, like the example in data/bank_profiles.toml.
SIGNED = {"name": "signe", "date_operation": "Date", "libelle": "Libellé", "amount": "Montant",
          "delimiter": ",", "date_format": "%Y-%m-%d", "decimal": "."}


class TestBankProfiles:
    def test_missing_file_gives_default_only(self, tmp_path):
        assert load_bank_profiles(tmp_path) == [DEFAULT_PROFILE]

    def test_user_profiles_before_default(self, tmp_path):
        (tmp_path / "bank_profiles.toml").write_text(_toml(**SIGNED) + _toml(**{**SIGNED, "name": "autre"}))
        assert [p.name for p in load_bank_profiles(tmp_path)] == ["signe", "autre", "default"]

    def test_example_file_in_data_is_valid(self):
        profiles = load_bank_profiles(EXAMPLE_DIR)
        assert [p.name for p in profiles] == ["banque-exemple", "default"]

    @pytest.mark.parametrize(
        ("keys", "message"),
        [
            ({**SIGNED, "debit": "Débit", "credit": "Crédit"}, "either amount"),
            ({k: v for k, v in SIGNED.items() if k != "amount"}, "either amount"),
            ({k: v for k, v in SIGNED.items() if k != "amount"} | {"debit": "Débit"}, "either amount"),
            ({**SIGNED, "delimeter": ";"}, "unknown key"),
            ({**SIGNED, "filename_pattern": "^export_(.+)"}, "account"),
            ({**SIGNED, "filename_pattern": "^export_(?P<account>"}, "filename_pattern"),
            ({**SIGNED, "encoding": "klingon"}, "encoding"),
            ({**SIGNED, "delimiter": ";;"}, "single character"),
            ({**SIGNED, "decimal": "x"}, "decimal"),
            ({**SIGNED, "name": "default"}, "reserved"),
            ({k: v for k, v in SIGNED.items() if k != "libelle"}, "libelle"),
        ],
    )
    def test_rejects_invalid_profile(self, keys, message):
        with pytest.raises(BankProfileError, match=message):
            parse_bank_profiles(_toml(**keys))

    def test_rejects_duplicate_names(self):
        with pytest.raises(BankProfileError, match="duplicate"):
            parse_bank_profiles(_toml(**SIGNED) + _toml(**SIGNED))

    def test_rejects_bad_toml(self):
        with pytest.raises(BankProfileError, match="TOML"):
            parse_bank_profiles("[[profile]\nname = ")


def _signed_csv(*rows: str, preamble: tuple[str, ...] = ()) -> bytes:
    return "\n".join([*preamble, "Date,Libellé,Montant", *rows]).encode("utf-8")


class TestProfileParsing:
    profiles = [parse_bank_profiles(_toml(**SIGNED))[0], DEFAULT_PROFILE]

    def test_signed_amount_column(self):
        profile, rows = parse_statement(
            _signed_csv('2026-06-01,A,-12.50', '2026-06-02,B,"1,200.00"', '2026-06-03,C,-0.00'), self.profiles
        )
        assert profile.name == "signe"
        pairs = [(r["Debit"], r["Credit"]) for r in rows]
        assert pairs == [(12.5, 0.0), (0.0, 1200.0), (0.0, 0.0)]
        assert all(str(v) == "0.0" for pair in pairs for v in pair if v == 0)  # never "-0.0"

    def test_comma_decimal_signed(self):
        profile = parse_bank_profiles(_toml(**{**SIGNED, "delimiter": ";", "decimal": ","}))[0]
        content = "Date;Libellé;Montant\n2026-06-01;A;-1 234,56\n".encode()
        assert parse_csv(content, [profile])[0]["Debit"] == 1234.56

    def test_missing_value_date_uses_operation_date(self):
        rows = parse_csv(_signed_csv("2026-06-28,A,-1.00"), self.profiles)
        assert rows[0]["Date valeur"] == rows[0]["Date operation"] == "2026-06-28"
        assert rows[0]["budget_month"] == "2026-06"

    def test_header_after_preamble(self):
        preamble = ("Compte n° 000,,", "Solde,,100.00", "")
        rows = parse_csv(_signed_csv("2026-06-01,A,-1.00", preamble=preamble), self.profiles)
        assert [r["Libelle"] for r in rows] == ["A"]
        with pytest.raises(CsvValidationError, match="Row 5: invalid date in 'Date'"):
            parse_csv(_signed_csv("01/06/2026,A,-1.00", preamble=preamble), self.profiles)

    def test_first_matching_profile_wins(self):
        first = parse_bank_profiles(_toml(**{**SIGNED, "name": "premier"}) + _toml(**SIGNED))
        profile, _rows = parse_statement(_signed_csv("2026-06-01,A,-1.00"), [*first, DEFAULT_PROFILE])
        assert profile.name == "premier"

    def test_default_file_skips_non_matching_profile(self):
        profile, rows = parse_statement(_csv(*GOLDEN_ROWS), self.profiles)
        assert profile is DEFAULT_PROFILE and rows == GOLDEN_PARSED

    def test_no_match_lists_missing_columns_per_profile(self):
        with pytest.raises(CsvValidationError) as exc:
            parse_csv(b"Foo,Bar\n1,2\n", self.profiles)
        assert exc.value.errors[0] == "No bank profile matches this file."
        assert exc.value.errors[1].startswith("signe: Missing column(s): Date, Libellé, Montant")
        assert exc.value.errors[2].startswith("default: Missing column(s): Date operation")

    def test_row_error_does_not_fall_through(self):
        # The header is the signed profile's: its date error is reported, not the default's columns.
        with pytest.raises(CsvValidationError, match="invalid date in 'Date'"):
            parse_csv(_signed_csv("pas une date,A,-1.00"), self.profiles)

    def test_output_keys_canonical(self):
        rows = parse_csv(_signed_csv("2026-06-01,A,-1.00"), self.profiles)
        assert set(rows[0]) == {*REQUIRED_COLUMNS, "budget_month"}

    def test_debit_credit_profile_with_own_names(self):
        profile = parse_bank_profiles(_toml(
            name="deux", date_operation="Date opération", date_valeur="Date valeur", libelle="Libellé",
            debit="Débit", credit="Crédit",
        ))[0]
        content = (
            '"Date opération";"Date valeur";"Libellé";"Débit";"Crédit"\n'
            '"01/06/2026";"02/06/2026";"A";"-5,00";""\n'
        ).encode("cp1252")
        rows = parse_csv(content, [profile, DEFAULT_PROFILE])
        assert (rows[0]["Debit"], rows[0]["Date valeur"]) == (5.0, "2026-06-02")
