import pytest

from app.core.parsing import CsvValidationError, infer_account, parse_csv


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
