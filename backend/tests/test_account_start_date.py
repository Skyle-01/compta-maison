"""The per-account start date: rows valued earlier are not imported, and a new account starting late
in its budget month gets a warning with a suggested date."""

from app.db import connect
from tests.api_helpers import _upload, _write_start_date

HEADER = b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'


def _statement(*rows: tuple[str, str, str, str]) -> bytes:
    """(dd/mm/yyyy, libelle, debit, credit) rows as a default-format statement. The labels used
    here never contain a transfer marker or an account name, so nothing pairs as a transfer."""
    return HEADER + b"".join(
        f'"{d}";"{d}";"{lib}";"{debit}";"{credit}"\n'.encode() for d, lib, debit, credit in rows
    )


# Two salaries: budget month 2026-06 opens on 05/06, 2026-07 on 03/07.
JOINT_SALARIES = _statement(
    ("05/06/2026", "PAIE EMPLOYEUR", "", "2500,00"),
    ("03/07/2026", "PAIE EMPLOYEUR", "", "2500,00"),
)

PERSO_JUNE = _statement(
    ("08/06/2026", "CARTE PHARMACIE", "7,50", ""),
    ("20/06/2026", "CARTE LIBRAIRIE", "9,00", ""),
    ("05/07/2026", "CARTE PRIMEUR", "4,00", ""),
)


def _set_start_date(client, code: str, start_date: str | None) -> None:
    account = next(a for a in client.get("/api/accounts").json() if a["code"] == code)
    body = {k: account[k] for k in ("label", "type", "deposit_pattern", "aliases")}
    assert client.put(f"/api/accounts/{code}", json={**body, "start_date": start_date}).status_code == 200


class TestAccountCutoff:
    def test_upload_skips_rows_before_the_accounts_start_date(self, seeded_db, client):
        _set_start_date(client, "PERSO", "2026-06-20")
        body = _upload(client, "RELEVE_COMPTE_PERSO_2026.csv", content=PERSO_JUNE).json()
        assert (body["rows_total"], body["rows_new"], body["rows_before_start"]) == (2, 2, 1)

    def test_other_accounts_are_not_cut(self, seeded_db, client):
        _set_start_date(client, "PERSO", "2026-06-20")
        body = _upload(client, "RELEVE_COMPTE_JOINT_2026.csv", content=PERSO_JUNE).json()
        assert body["rows_before_start"] == 0

    def test_the_later_of_the_two_dates_wins(self, seeded_db, client, tmp_path):
        _set_start_date(client, "PERSO", "2026-06-01")
        _write_start_date(tmp_path, "2026-06-20")
        body = _upload(client, "RELEVE_COMPTE_PERSO_2026.csv", content=PERSO_JUNE).json()
        assert body["rows_before_start"] == 1  # the books' date, later than the account's

        _set_start_date(client, "PERSO", "2026-07-01")
        body = _upload(client, "RELEVE_COMPTE_PERSO_2026_b.csv", content=PERSO_JUNE).json()
        assert (body["rows_total"], body["rows_before_start"]) == (1, 2)  # the account's date

    def test_import_inputs_and_coverage_use_it(self, seeded_db, client, tmp_path):
        (tmp_path / "_inputs").mkdir()
        (tmp_path / "_inputs" / "RELEVE_COMPTE_PERSO_2026.csv").write_bytes(PERSO_JUNE)
        _set_start_date(client, "PERSO", "2026-06-20")
        coverage = next(c for c in client.get("/api/imports/coverage").json() if c["code"] == "PERSO")
        assert coverage["files"] == 1
        body = client.post("/api/imports/inputs").json()
        assert (body["files"][0]["rows_new"], body["files"][0]["rows_before_start"]) == (2, 1)
        with connect(seeded_db) as conn:
            (first,) = conn.execute("SELECT MIN(date_valeur) FROM transactions").fetchone()
        assert first == "2026-06-20"


class TestStartWarning:
    def _joint(self, client):
        _upload(client, "RELEVE_COMPTE_JOINT_2026.csv", content=JOINT_SALARIES)

    def test_starting_within_the_tolerance_is_not_flagged(self, seeded_db, client):
        self._joint(client)
        assert (
            _upload(client, "RELEVE_COMPTE_PERSO_2026.csv", content=PERSO_JUNE).json()["start_warning"]
            is None
        )

    def test_starting_past_the_tolerance_warns(self, seeded_db, client):
        self._joint(client)
        late = _statement(("20/06/2026", "CARTE LIBRAIRIE", "9,00", ""))
        warning = _upload(client, "RELEVE_COMPTE_PERSO_2026.csv", content=late).json()["start_warning"]
        assert warning == (
            "Le compte démarre le 20/06/2026, 15 jours après l'ouverture du mois budgétaire (05/06/2026) : "
            "ce mois sera incomplet pour lui. Date de départ suggérée : 03/07/2026 (Réglages, Comptes)."
        )

    def test_only_the_first_import_of_an_account_warns(self, seeded_db, client):
        self._joint(client)
        late = _statement(("20/06/2026", "CARTE LIBRAIRIE", "9,00", ""))
        _upload(client, "RELEVE_COMPTE_PERSO_2026.csv", content=late)
        more = _statement(("25/06/2026", "CARTE PRIMEUR", "4,00", ""))
        assert _upload(client, "RELEVE_COMPTE_PERSO_2026_b.csv", content=more).json()["start_warning"] is None

    def test_no_suggestion_when_no_later_month_opens(self, seeded_db, client):
        _upload(
            client,
            "RELEVE_COMPTE_JOINT_2026.csv",
            content=_statement(("05/06/2026", "PAIE EMPLOYEUR", "", "2500,00")),
        )
        late = _statement(("20/06/2026", "CARTE LIBRAIRIE", "9,00", ""))
        warning = _upload(client, "RELEVE_COMPTE_PERSO_2026.csv", content=late).json()["start_warning"]
        assert warning is not None and "suggérée" not in warning

    def test_the_accounts_start_date_silences_it(self, seeded_db, client):
        self._joint(client)
        _set_start_date(client, "PERSO", "2026-07-03")
        body = _upload(client, "RELEVE_COMPTE_PERSO_2026.csv", content=PERSO_JUNE).json()
        assert body["start_warning"] is None and body["rows_before_start"] == 2

    def test_bulk_import_reports_it(self, seeded_db, client, tmp_path):
        self._joint(client)
        (tmp_path / "_inputs").mkdir(exist_ok=True)
        late = _statement(("20/06/2026", "CARTE LIBRAIRIE", "9,00", ""))
        (tmp_path / "_inputs" / "RELEVE_COMPTE_PERSO_2026.csv").write_bytes(late)
        files = client.post("/api/imports/inputs").json()["files"]
        perso = next(f for f in files if f["account"] == "PERSO")
        assert "Date de départ suggérée : 03/07/2026" in perso["start_warning"]
