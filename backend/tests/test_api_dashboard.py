import pytest

from app.db import connect
from tests.api_helpers import _upload
from tests.conftest import import_rows


class TestDashboard:
    def test_dashboard_aggregates(self, seeded_db, client):
        _upload(client)
        resp = client.get("/api/dashboard", params={"month": "2026-06"})
        body = resp.json()
        assert body["month"] == "2026-06"
        assert body["months_available"] == ["2026-06"]
        assert body["income"] == 2500.0
        # Totals are by transaction kind, so uncategorised real expenses count too.
        assert body["expenses"] == 85.82  # 63.82 + 12.00 + 10.00 (MYSTERY SHOP)
        assert body["uncategorized"]["count"] == 1
        # The uncategorised residual surfaces as a node in the balance tree.
        unc = next(n for n in body["by_category"]["children"] if n["name"] == "uncategorised")
        assert unc["balance"] == body["uncategorized"]["difference"]
        # Reconciliation: Revenus − Dépenses − Épargne nette = Reste, and Reste == the tree total.
        assert (body["epargne"], body["desepargne"]) == (0.0, 0.0)
        assert body["reste"] == round(body["income"] - body["expenses"], 2) == 2414.18
        assert body["reste"] == body["by_category"]["balance"]
        # History carries this month for the trend/deltas, reste matching the headline.
        assert body["history"][-1]["month"] == "2026-06"
        assert body["history"][-1]["reste"] == body["reste"]

    def test_categorised_epargne_and_deficit_rows_not_double_counted(self, db, client):
        # Real rows categorised under the Épargne / Déficit groups are ordinary income/expenses;
        # only the derived savings-account leaves feed the Épargne card. Before the fix a loan
        # credit under Déficit counted in both income and désépargne (Reste off by its amount).
        with connect(db) as conn:
            epargne = conn.execute("INSERT INTO categories (name) VALUES ('Épargne')").lastrowid
            deficit = conn.execute("INSERT INTO categories (name) VALUES ('Déficit')").lastrowid
            emprunt = conn.execute(
                "INSERT INTO categories (name, parent_id) VALUES ('Emprunt', ?)", (deficit,)
            ).lastrowid
            conn.execute(
                "INSERT INTO label_rules (category_id, pattern) VALUES (?, 'VERSEMENT PEL')", (epargne,)
            )
        import_rows(
            db,
            ("2026-06-02", "2026-06-02", "VIR PRET CONSO", 0, 1000, "PERSO"),
            ("2026-06-03", "2026-06-03", "VERSEMENT PEL", 200, 0, "PERSO"),
            ("2026-06-04", "2026-06-04", "COURSES", 50, 0, "PERSO"),
            ("2026-06-05", "2026-06-05", "VIR de COMPTE", 0, 300, "LIVRET"),  # derived Épargne leaf
        )
        client.post("/api/rules", json={"category_id": emprunt, "pattern": "PRET CONSO"})  # re-applies rules

        body = client.get("/api/dashboard", params={"month": "2026-06"}).json()
        assert (body["income"], body["expenses"]) == (1300.0, 250.0)  # the LIVRET credit is income too
        assert (body["epargne"], body["desepargne"]) == (300.0, 0.0)
        assert body["reste"] == body["by_category"]["balance"] == body["history"][-1]["reste"] == 750.0

    def test_defaults_to_latest_month(self, seeded_db, client):
        _upload(client)
        body = client.get("/api/dashboard").json()
        assert body["month"] == "2026-06"

    def test_all_months(self, seeded_db, client):
        _upload(client)
        may = (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"04/05/2026";"04/05/2026";"CARTE SUPERMARCHE";"40,00";""\n'
        )
        _upload(client, filename="RELEVE_COMPTE_JOINT_2026_05_08.csv", content=may)
        body = client.get("/api/dashboard", params={"month": "all"}).json()
        assert body["month"] == "all"
        assert len(body["history"]) == 2
        assert body["income"] == pytest.approx(sum(h["income"] for h in body["history"]))
        assert body["expenses"] == pytest.approx(sum(h["expenses"] for h in body["history"]))
        assert body["reste"] == pytest.approx(body["by_category"]["balance"])

    def test_averages(self, seeded_db, client):
        _upload(client)
        may = (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"04/05/2026";"04/05/2026";"CARTE SUPERMARCHE";"40,00";""\n'
        )
        _upload(client, filename="RELEVE_COMPTE_JOINT_2026_05_08.csv", content=may)
        body = client.get("/api/dashboard/averages", params={"months": "3", "month": "2026-06"}).json()
        # June is the latest budget month: May is the only complete one.
        assert (body["months"], body["first_month"], body["current_month"]) == (1, "2026-05", "2026-06")
        assert body["totals"]["expenses"] == 40
        variable = next(g for g in body["groups"] if g["name"] == "variable")
        assert (variable["expenses"], variable["month_expenses"]) == (40, 75.82)  # courses 63.82 + bar 12
        every = client.get("/api/dashboard/averages", params={"months": "all", "month": "all"}).json()
        assert every["month"] is None and every["uncategorized"]["month_expenses"] is None

    def test_averages_rejects_an_unknown_period(self, client):
        resp = client.get("/api/dashboard/averages", params={"months": "7"})
        assert resp.status_code == 422
        assert resp.json()["detail"][0]["msg"] == "Période : valeur attendue : '3', '6', '12' ou 'all'"
