import pytest

from app.core.categorize import apply_rules
from app.db import connect, init_db
from scripts.import_csv import import_csv
from tests.api_helpers import _category_id, _export, _upload
from tests.conftest import import_rows


def _targets(db_path) -> dict[str, int | None]:
    with connect(db_path) as conn:
        return dict(conn.execute("SELECT name, budget_target_cents FROM categories").fetchall())


RULES_HEADER_ONLY = "category_path;pattern;priority;is_income_anchor;description\n"


class TestCategories:
    def test_create_toplevel_and_delete(self, client):
        resp = client.post("/api/categories", json={"name": "voyage", "parent_id": None})
        assert resp.status_code == 201
        body = resp.json()
        assert body["parent_id"] is None
        assert body["is_root"] is True
        assert body["path"] == "voyage"
        assert client.delete(f"/api/categories/{body['id']}").status_code == 204

    def test_rename(self, seeded_db, client):
        bar = _category_id(client, "bar")
        sortie = _category_id(client, "sortie")
        resp = client.put(f"/api/categories/{bar}", json={"name": "bistrot", "parent_id": sortie})
        assert resp.status_code == 200
        assert resp.json()["path"].endswith("sortie / bistrot")

    def test_cycle_rejected(self, seeded_db, client):
        sortie = _category_id(client, "sortie")
        bar = _category_id(client, "bar")
        resp = client.put(f"/api/categories/{sortie}", json={"name": "sortie", "parent_id": bar})
        assert resp.status_code == 422
        assert resp.json()["detail"][0].startswith("Une catégorie ne peut pas être déplacée sous elle-même")

    def test_subdivide_migrates_to_child(self, seeded_db, client):
        # Adding a child to a populated leaf moves its rules + transactions down into the new child;
        # the leaf becomes a clean group (leaf-only invariant preserved).
        _upload(client)
        courses = _category_id(client, "courses")
        assert client.post("/api/categories", json={"name": "bio", "parent_id": courses}).status_code == 201

        cats = {c["name"]: c for c in client.get("/api/categories").json()}
        assert cats["courses"]["rule_count"] == 0  # rules moved down
        assert cats["bio"]["rule_count"] == 2  # SUPERMARCHE + LECLERC
        # 'courses' is now a group -> rules can no longer target it.
        resp = client.post("/api/rules", json={"category_id": courses, "pattern": "X"})
        assert resp.status_code == 422
        assert resp.json()["detail"] == ["« courses » est un groupe : choisissez une de ses sous-catégories"]
        # The matching transaction now lives under the new leaf.
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        assert next(t for t in items if "SUPERMARCHE" in t["libelle"])["category"] == "bio"

    def test_delete_category_with_children_blocked(self, seeded_db, client):
        resp = client.delete(f"/api/categories/{_category_id(client, 'sortie')}")
        assert resp.status_code == 409

    def test_delete_last_child_rolls_up(self, seeded_db, client):
        # 'bar' is the only child of 'sortie'; deleting it rolls its rule + transaction up to
        # 'sortie', which becomes a leaf again.
        _upload(client)
        assert client.delete(f"/api/categories/{_category_id(client, 'bar')}").status_code == 204

        cats = {c["name"]: c for c in client.get("/api/categories").json()}
        assert "bar" not in cats
        assert cats["sortie"]["rule_count"] == 1  # ANGELUS rule survived, now on 'sortie'
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        assert next(t for t in items if "ANGELUS" in t["libelle"])["category"] == "sortie"

    def test_delete_non_last_child_drops(self, seeded_db, client):
        # 'courses' is one of 'variable's two children; deleting it drops its rules and uncategorises
        # its transactions (rolling up would make 'variable' a populated parent-with-children).
        _upload(client)
        assert client.delete(f"/api/categories/{_category_id(client, 'courses')}").status_code == 204
        uncategorized = client.get("/api/transactions", params={"uncategorized": True}).json()
        assert any("SUPERMARCHE" in t["libelle"] for t in uncategorized["items"])

    def test_move_rules_and_manual_assignments(self, seeded_db, client):
        _upload(client)
        courses = _category_id(client, "courses")
        marche = client.post(
            "/api/categories", json={"name": "marché", "parent_id": _category_id(client, "variable")}
        )
        marche_id = marche.json()["id"]
        mystery = client.get("/api/transactions", params={"libelle_contains": "MYSTERY"}).json()["items"][0]
        client.patch(f"/api/transactions/{mystery['id']}", json={"category_id": courses, "note": "fleurs"})
        supermarche = next(r for r in client.get("/api/rules").json() if r["pattern"] == "SUPERMARCHE")

        resp = client.post(
            f"/api/categories/{marche_id}/move",
            json={"rule_ids": [supermarche["id"]], "transaction_ids": [mystery["id"]]},
        )
        assert resp.status_code == 204, resp.text

        items = {t["libelle"]: t for t in client.get("/api/transactions").json()["items"]}
        # The rule took its operation along; the manual row kept its note and stays manual.
        assert (items["CARTE SUPERMARCHE"]["category"], items["CARTE SUPERMARCHE"]["rule_pattern"]) == (
            "marché",
            "SUPERMARCHE",
        )
        moved = items["MYSTERY SHOP"]
        assert (moved["category"], moved["category_manual"], moved["note"]) == ("marché", True, "fleurs")
        cats = {c["name"]: c for c in client.get("/api/categories").json()}
        assert (cats["courses"]["rule_count"], cats["marché"]["rule_count"]) == (1, 1)

        # Undo = the same call back to the original leaf.
        back = client.post(
            f"/api/categories/{courses}/move",
            json={"rule_ids": [supermarche["id"]], "transaction_ids": [mystery["id"]]},
        )
        assert back.status_code == 204
        items = {t["libelle"]: t for t in client.get("/api/transactions").json()["items"]}
        assert items["CARTE SUPERMARCHE"]["category"] == items["MYSTERY SHOP"]["category"] == "courses"

    def test_move_errors_change_nothing(self, seeded_db, client):
        _upload(client)
        bar = _category_id(client, "bar")
        rule = client.get("/api/rules").json()[0]
        auto = client.get("/api/transactions", params={"libelle_contains": "SUPERMARCHE"}).json()["items"][0]

        def move(category_id: int, **body):
            return client.post(f"/api/categories/{category_id}/move", json=body)

        group = move(_category_id(client, "variable"), rule_ids=[rule["id"]])
        assert (group.status_code, group.json()["detail"]) == (
            422,
            ["« variable » est un groupe : choisissez une de ses sous-catégories"],
        )
        assert move(9999, rule_ids=[rule["id"]]).status_code == 404
        assert move(bar).json()["detail"] == ["Rien à déplacer : cochez au moins une règle ou une opération"]
        missing = move(bar, rule_ids=[rule["id"], 9999])
        assert (missing.status_code, missing.json()["detail"]) == (404, ["Règles introuvables : 9999"])
        # An operation classified by a rule follows it: it is not movable on its own.
        automatic = move(bar, rule_ids=[rule["id"]], transaction_ids=[auto["id"]])
        assert automatic.status_code == 422
        assert automatic.json()["detail"] == [
            f"Seules les opérations classées à la main se déplacent : {auto['id']} suivent leur règle"
        ]
        assert client.get("/api/rules").json()[0]["category_id"] == rule["category_id"]  # nothing moved

    def test_duplicate_name_same_parent_rejected(self, seeded_db, client):
        variable = _category_id(client, "variable")
        resp = client.post("/api/categories", json={"name": "courses", "parent_id": variable})
        assert resp.status_code == 409
        assert resp.json()["detail"][0].startswith("« courses » existe déjà à cet endroit")


class TestRules:
    def test_rule_create_triggers_recategorization(self, seeded_db, client):
        _upload(client)
        resp = client.post(
            "/api/rules",
            json={"category_id": _category_id(client, "courses"), "pattern": "MYSTERY SHOP"},
        )
        assert resp.status_code == 201
        uncategorized = client.get("/api/transactions", params={"uncategorized": True}).json()
        assert uncategorized["total"] == 0

    def test_rule_delete_uncategorizes(self, seeded_db, client):
        _upload(client)
        rule = client.post(
            "/api/rules",
            json={"category_id": _category_id(client, "courses"), "pattern": "MYSTERY SHOP"},
        ).json()
        client.delete(f"/api/rules/{rule['id']}")
        uncategorized = client.get("/api/transactions", params={"uncategorized": True}).json()
        assert uncategorized["total"] == 1

    def test_priority_decides_winner(self, seeded_db, client):
        _upload(client)
        bar = _category_id(client, "bar")
        # Lower priority number than the seeded SUPERMARCHE rule (2) -> wins
        client.post("/api/rules", json={"category_id": bar, "pattern": "SUPERMARCHE", "priority": 0})
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        groceries = next(t for t in items if "SUPERMARCHE" in t["libelle"])
        assert groceries["category"] == "bar"

    def test_rules_carry_what_they_classify(self, seeded_db, client):
        _upload(client)
        rules = {r["pattern"]: r for r in client.get("/api/rules").json()}
        assert (rules["SUPERMARCHE"]["operation_count"], rules["SUPERMARCHE"]["debit"]) == (1, 63.82)
        assert (rules["EMPLOYEUR"]["operation_count"], rules["EMPLOYEUR"]["credit"]) == (1, 2500.0)
        assert rules["LECLERC"]["operation_count"] == 0
        listed = client.get("/api/transactions", params={"rule_id": rules["SUPERMARCHE"]["id"]}).json()
        assert [t["libelle"] for t in listed["items"]] == ["CARTE SUPERMARCHE"]

        # A manual assignment leaves its rule's count; a created rule reports its own.
        supermarche = listed["items"][0]
        client.patch(
            f"/api/transactions/{supermarche['id']}", json={"category_id": _category_id(client, "bar")}
        )
        assert (
            next(r for r in client.get("/api/rules").json() if r["pattern"] == "SUPERMARCHE")[
                "operation_count"
            ]
            == 0
        )
        created = client.post(
            "/api/rules", json={"category_id": _category_id(client, "bar"), "pattern": "MYSTERY"}
        )
        assert (created.json()["operation_count"], created.json()["debit"]) == (1, 10.0)

    def test_rule_rejects_unknown_category(self, client):
        resp = client.post("/api/rules", json={"category_id": 9999, "pattern": "X"})
        assert resp.status_code == 422

    def test_rule_rejects_group_category(self, seeded_db, client):
        resp = client.post(
            "/api/rules", json={"category_id": _category_id(client, "variable"), "pattern": "X"}
        )
        assert resp.status_code == 422  # 'variable' is a group; rules must target a leaf

    def test_anchor_rule_mutation_moves_periods(self, seeded_db, client):
        # Salary deposit late in June + spending after it
        csv = (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"28/06/2026";"28/06/2026";"VIR EMPLOYEUR SALAIRE";"";"2500,00"\n'
            b'"29/06/2026";"29/06/2026";"CARTE SUPERMARCHE";"50,00";""\n'
        )
        client.post("/api/imports", files={"file": ("RELEVE_COMPTE_JOINT_2026.csv", csv, "text/csv")})
        months = {t["libelle"]: t["budget_month"] for t in client.get("/api/transactions").json()["items"]}
        assert months["CARTE SUPERMARCHE"] == "2026-07"  # paid from the July paycheck

        # Un-flag the anchor: periods fall back to calendar months
        rules = client.get("/api/rules").json()
        anchor = next(r for r in rules if r["is_income_anchor"])
        anchor["is_income_anchor"] = False
        rule_id = anchor.pop("id")
        client.put(f"/api/rules/{rule_id}", json=anchor)
        months = {t["libelle"]: t["budget_month"] for t in client.get("/api/transactions").json()["items"]}
        assert months["CARTE SUPERMARCHE"] == "2026-06"


class TestBudgetTargets:
    def test_set_and_clear(self, seeded_db, client):
        bar = _category_id(client, "bar")
        resp = client.put(f"/api/categories/{bar}/target", json={"budget_target": 45.5})
        assert resp.status_code == 200
        assert resp.json()["budget_target"] == 45.5
        assert _targets(seeded_db)["bar"] == 4550
        cats = {c["name"]: c for c in client.get("/api/categories").json()}
        assert (cats["bar"]["budget_target"], cats["sortie"]["budget_target"]) == (45.5, None)
        resp = client.put(f"/api/categories/{bar}/target", json={"budget_target": None})
        assert resp.json()["budget_target"] is None

    def test_rejections(self, seeded_db, client):
        bar = _category_id(client, "bar")
        assert client.put(f"/api/categories/{bar}/target", json={"budget_target": 0}).status_code == 422
        assert client.put("/api/categories/9999/target", json={"budget_target": 10}).status_code == 404
        # Rounds to 0 cents: rejected rather than stored as a zero target.
        assert client.put(f"/api/categories/{bar}/target", json={"budget_target": 0.001}).status_code == 422

    def test_one_target_per_branch(self, seeded_db, client):
        variable, sortie, bar = (_category_id(client, n) for n in ("variable", "sortie", "bar"))
        assert (
            client.put(f"/api/categories/{sortie}/target", json={"budget_target": 80}).json()["budget_target"]
            == 80
        )
        # Below a targeted group, and above one: refused.
        resp = client.put(f"/api/categories/{bar}/target", json={"budget_target": 10})
        assert resp.status_code == 422
        assert resp.json()["detail"] == ["« sortie » a déjà un objectif, qui couvre « bar »"]
        resp = client.put(f"/api/categories/{variable}/target", json={"budget_target": 500})
        assert resp.status_code == 422
        assert resp.json()["detail"][0].startswith("Des sous-catégories de « variable » ont déjà un objectif")
        # Clearing is always allowed, and frees the branch.
        assert client.put(f"/api/categories/{bar}/target", json={"budget_target": None}).status_code == 200
        client.put(f"/api/categories/{sortie}/target", json={"budget_target": None})
        assert client.put(f"/api/categories/{bar}/target", json={"budget_target": 10}).status_code == 200

    def test_targets_cap_spending_only(self, seeded_db, client):
        import_rows(
            seeded_db,
            ("2026-05-05", "2026-05-05", "VIR EMPLOYEUR", 0, 2000, "PERSO"),
            ("2026-06-05", "2026-06-05", "VIR EMPLOYEUR", 0, 2000, "PERSO"),
        )
        apply_rules(seeded_db)
        resp = client.put(
            f"/api/categories/{_category_id(client, 'salaire')}/target", json={"budget_target": 10}
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == [
            "« salaire » est un revenu : un objectif plafonne une dépense, pas un revenu"
        ]
        epargne = client.post("/api/categories", json={"name": "Épargne", "parent_id": None}).json()["id"]
        livret = client.post("/api/categories", json={"name": "Livret", "parent_id": epargne}).json()["id"]
        assert client.put(f"/api/categories/{livret}/target", json={"budget_target": 10}).status_code == 422
        # The Épargne group's own target is the savings goal, out of the spending caps.
        assert client.put(f"/api/categories/{epargne}/target", json={"budget_target": 300}).status_code == 200
        budget = client.get("/api/dashboard", params={"month": "2026-06"}).json()["budget"]
        # The reference income is the « Revenus » group's only: none here yet.
        assert (budget["savings_target"], budget["groups"], budget["income_reference"]) == (300, [], 0)
        client.put(
            f"/api/categories/{_category_id(client, 'fixe')}", json={"name": "Revenus", "parent_id": None}
        )
        budget = client.get("/api/dashboard", params={"month": "2026-06"}).json()["budget"]
        assert budget["income_reference"] == 2000

    def test_dashboard_without_transactions(self, seeded_db, client):
        """A fresh DB with targets (data/ ships some) but nothing imported yet."""
        client.put(f"/api/categories/{_category_id(client, 'bar')}/target", json={"budget_target": 60})
        resp = client.get("/api/dashboard")
        assert resp.status_code == 200
        budget = resp.json()["budget"]
        assert (budget["months"], budget["target"], budget["actual"]) == (1, 60, 0)

    def test_subdivide_keeps_target_on_parent(self, seeded_db, client):
        courses = _category_id(client, "courses")
        client.put(f"/api/categories/{courses}/target", json={"budget_target": 300})
        client.post("/api/categories", json={"name": "bio", "parent_id": courses})
        targets = _targets(seeded_db)
        assert (targets["courses"], targets["bio"]) == (30000, None)

    def test_delete_last_child_rolls_target_up(self, seeded_db, client):
        bar = _category_id(client, "bar")
        client.put(f"/api/categories/{bar}/target", json={"budget_target": 60})
        client.delete(f"/api/categories/{bar}")
        assert _targets(seeded_db)["sortie"] == 6000

    def test_delete_last_child_keeps_parent_target(self, seeded_db, client):
        client.put(f"/api/categories/{_category_id(client, 'sortie')}/target", json={"budget_target": 80})
        client.delete(f"/api/categories/{_category_id(client, 'bar')}")
        assert _targets(seeded_db)["sortie"] == 8000

    def test_delete_with_siblings_drops_target(self, seeded_db, client):
        courses = _category_id(client, "courses")
        client.put(f"/api/categories/{courses}/target", json={"budget_target": 300})
        client.delete(f"/api/categories/{courses}")
        assert _targets(seeded_db)["variable"] is None

    def test_reparent_keeps_one_target_per_branch(self, seeded_db, client):
        sortie = _category_id(client, "sortie")
        client.put(f"/api/categories/{sortie}/target", json={"budget_target": 80})
        voyage = client.post("/api/categories", json={"name": "voyage", "parent_id": None}).json()["id"]
        client.put(f"/api/categories/{voyage}/target", json={"budget_target": 200})
        resp = client.put(f"/api/categories/{voyage}", json={"name": "voyage", "parent_id": sortie})
        assert resp.status_code == 422
        assert resp.json()["detail"][0].startswith("« sortie » a déjà un objectif, qui couvrirait « voyage »")
        # Without its own target it fits under the targeted group.
        client.put(f"/api/categories/{voyage}/target", json={"budget_target": None})
        resp = client.put(f"/api/categories/{voyage}", json={"name": "voyage", "parent_id": sortie})
        assert resp.status_code == 200

    def test_export_and_round_trip(self, seeded_db, client, tmp_path):
        client.put(f"/api/categories/{_category_id(client, 'bar')}/target", json={"budget_target": 12.5})
        body = (_export(seeded_db, tmp_path) / "categories.csv").read_text(encoding="utf-8-sig")
        assert body.splitlines()[0] == "path;budget_target"
        assert "variable / sortie / bar;12.50\n" in body
        assert "variable / sortie;\n" in body

        cats_csv = tmp_path / "categories.csv"
        cats_csv.write_text(body, encoding="utf-8")
        rules_csv = tmp_path / "rules.csv"
        rules_csv.write_text(RULES_HEADER_ONLY, encoding="utf-8")
        fresh = tmp_path / "fresh.db"
        init_db(fresh)
        import_csv(cats_csv, rules_csv, fresh)
        assert _targets(fresh) == _targets(seeded_db)

    def test_loader_formats(self, tmp_path, capsys):
        rules_csv = tmp_path / "rules.csv"
        rules_csv.write_text(RULES_HEADER_ONLY, encoding="utf-8")
        fresh = tmp_path / "fresh.db"
        init_db(fresh)
        # An older path-only file still loads, with no targets.
        cats_csv = tmp_path / "categories.csv"
        cats_csv.write_text("path\nfixe\nfixe / salaire\n", encoding="utf-8")
        import_csv(cats_csv, rules_csv, fresh)
        assert _targets(fresh) == {"fixe": None, "salaire": None}
        # Comma decimals and thousands spaces are accepted; a group keeps its target, and one below
        # it is dropped (one target per branch).
        cats_csv.write_text(
            "path;budget_target\nvariable;1 234,50\nvariable / courses;100\n", encoding="utf-8"
        )
        import_csv(cats_csv, rules_csv, fresh)
        assert _targets(fresh) == {"variable": 123450, "courses": None}
        assert "Dropping budget target on 'variable / courses'" in capsys.readouterr().out
        cats_csv.write_text("path;budget_target\nvariable;-5\n", encoding="utf-8")
        with pytest.raises(ValueError, match="line 2"):
            import_csv(cats_csv, rules_csv, fresh)

    def test_dashboard_budget(self, seeded_db, client):
        _upload(client)
        client.put(f"/api/categories/{_category_id(client, 'courses')}/target", json={"budget_target": 50})
        body = client.get("/api/dashboard", params={"month": "2026-06"}).json()
        budget = body["budget"]
        assert (budget["months"], budget["target"], budget["actual"]) == (1, 50, 63.82)
        assert budget["untargeted"] == 22.0  # BAR ANGELUS + MYSTERY SHOP
        assert budget["groups"][0]["leaves"] == [
            {"id": _category_id(client, "courses"), "name": "courses", "target": 50, "actual": 63.82}
        ]
        # The budget is read-only context: the cards still reconcile with the tree.
        assert body["reste"] == body["by_category"]["balance"]
        every = client.get("/api/dashboard", params={"month": "all"}).json()["budget"]
        assert (every["months"], every["target"]) == (1, 50)
