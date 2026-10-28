from tests.api_helpers import _upload


class TestExport:
    def test_export_transactions_for_a_spreadsheet(self, seeded_db, client):
        _upload(client)
        mystery = client.get("/api/transactions", params={"libelle_contains": "MYSTERY"}).json()["items"][0]
        client.patch(f"/api/transactions/{mystery['id']}", json={"note": "à vérifier"})

        resp = client.get("/api/transactions/export", params={"month": "2026-06"})
        assert resp.headers["content-disposition"] == 'attachment; filename="transactions_2026-06.csv"'
        lines = resp.content.decode("utf-8-sig").splitlines()
        assert lines[0] == (
            "Date opération;Date valeur;Mois budgétaire;Compte;Libellé;Débit;Crédit;Type;Catégorie;Note"
        )
        assert lines[1:] == [  # oldest first, French dates and decimals, full category path
            "05/06/2026;05/06/2026;2026-06;JOINT;VIR EMPLOYEUR SALAIRE;;2500,00;revenu;fixe / salaire;",
            "06/06/2026;06/06/2026;2026-06;JOINT;CARTE SUPERMARCHE;63,82;;dépense;variable / courses;",
            "07/06/2026;07/06/2026;2026-06;JOINT;BAR ANGELUS;12,00;;dépense;variable / sortie / bar;",
            "08/06/2026;08/06/2026;2026-06;JOINT;MYSTERY SHOP;10,00;;dépense;;à vérifier",
        ]

    def test_export_transactions_applies_the_list_filters(self, seeded_db, client):
        _upload(client)
        resp = client.get("/api/transactions/export", params={"uncategorized": True})
        assert resp.headers["content-disposition"] == 'attachment; filename="transactions_tout.csv"'
        lines = resp.content.decode("utf-8-sig").splitlines()
        assert [line.split(";")[4] for line in lines[1:]] == ["MYSTERY SHOP"]
        assert len(client.get("/api/transactions/export", params={"month": "2026-07"}).text.splitlines()) == 1
