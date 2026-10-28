from fastapi.testclient import TestClient

from app.api.categories import _load_all
from app.core.config_export import category_paths
from app.db import connect, init_db
from app.main import create_app
from scripts.import_csv import import_csv
from tests.api_helpers import _category_id, _export, _upload
from tests.conftest import make_db


class TestExport:
    def test_export_categories_csv(self, seeded_db, tmp_path):
        body = (_export(seeded_db, tmp_path) / "categories.csv").read_text(encoding="utf-8-sig")
        assert body.splitlines()[0] == "path;budget_target"
        assert "fixe / salaire" in body
        assert "variable / sortie / bar" in body

    def test_export_rules_csv(self, seeded_db, tmp_path):
        body = (_export(seeded_db, tmp_path) / "rules.csv").read_text(encoding="utf-8-sig")
        assert body.splitlines()[0] == "category_path;pattern;priority;is_income_anchor;description"
        assert "fixe / salaire;EMPLOYEUR;1;1;" in body
        assert "variable / sortie / bar;ANGELUS;4;0;" in body

    def test_round_trip(self, seeded_db, client, tmp_path):
        def snapshot(db_path):
            with connect(db_path) as conn:
                paths = sorted(c.path for c in _load_all(conn))
                cat_paths = category_paths(conn)
                rules = sorted(
                    (cat_paths[cid], pattern, priority, anchor, description)
                    for cid, pattern, priority, anchor, description in conn.execute(
                        "SELECT category_id, pattern, priority, is_income_anchor, description FROM label_rules"
                    )
                )
            return paths, rules

        # Give a rule a description so the round-trip actually proves descriptions survive.
        client.post(
            "/api/rules",
            json={
                "category_id": _category_id(client, "bar"),
                "pattern": "GUINNESS",
                "priority": 9,
                "is_income_anchor": False,
                "description": "pub du vendredi",
            },
        )

        cfg = _export(seeded_db, tmp_path)
        cats_csv, rules_csv = cfg / "categories.csv", cfg / "rules.csv"

        before = snapshot(seeded_db)

        fresh = tmp_path / "fresh.db"
        init_db(fresh)
        import_csv(cats_csv, rules_csv, fresh)

        assert snapshot(fresh) == before

    def test_export_overrides_csv(self, seeded_db, client, tmp_path):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses})

        body = (_export(seeded_db, tmp_path) / "overrides.csv").read_text(encoding="utf-8-sig")
        assert body.splitlines()[0] == (
            "import_hash;category_path;kind;libelle;note;transfer_pair;"
            "account_id;date_operation;debit_cents;credit_cents"
        )
        line = next(line for line in body.splitlines()[1:] if "MYSTERY SHOP" in line)
        assert (
            ";variable / courses;;MYSTERY SHOP;;;JOINT;2026-06-08;1000;0" in line
        )  # manual, no kind, no note

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

    def test_overrides_round_trip(self, seeded_db, client, tmp_path):
        # Source DB: import, set a manual category + note, and (directly) a manual kind.
        _upload(client)
        mystery = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        client.patch(
            f"/api/transactions/{mystery['id']}",
            json={"category_id": _category_id(client, "courses"), "note": "remboursé par Léa"},
        )
        with connect(seeded_db) as conn:
            conn.execute(
                "UPDATE transactions SET kind = 'income', kind_manual = 1 WHERE libelle = 'BAR ANGELUS'"
            )

        cfg = _export(seeded_db, tmp_path)
        cats, rules, overrides = cfg / "categories.csv", cfg / "rules.csv", cfg / "overrides.csv"

        # Fresh DB with the same transactions (same hashes), then restore everything.
        fresh = make_db(tmp_path / "fresh.db")
        with TestClient(create_app(fresh)) as fresh_client:
            _upload(fresh_client)
        import_csv(cats, rules, fresh, overrides)

        with connect(fresh) as conn:
            cat = conn.execute(
                "SELECT t.category_manual, c.name, t.note FROM transactions t "
                "LEFT JOIN categories c ON c.id = t.category_id WHERE t.libelle = 'MYSTERY SHOP'"
            ).fetchone()
            assert cat == (1, "courses", "remboursé par Léa")  # note survived the round-trip
            bar = conn.execute(
                "SELECT kind, kind_manual FROM transactions WHERE libelle = 'BAR ANGELUS'"
            ).fetchone()
            assert bar == ("income", 1)
