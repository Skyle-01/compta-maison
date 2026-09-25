SAMPLE_CSV = (
    '"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    '"05/06/2026";"05/06/2026";"VIR EMPLOYEUR SALAIRE";"";"2500,00"\n'
    '"06/06/2026";"06/06/2026";"CARTE SUPERMARCHE";"63,82";""\n'
    '"07/06/2026";"07/06/2026";"BAR ANGELUS";"12,00";""\n'
    '"08/06/2026";"08/06/2026";"MYSTERY SHOP";"10,00";""\n'
).encode("utf-8")


def _upload(client, filename="RELEVE_COMPTE_JOINT_2026_06_08.csv", account=""):
    return client.post(
        "/api/imports",
        files={"file": (filename, SAMPLE_CSV, "text/csv")},
        data={"account": account},
    )


def _category_id(client, name: str) -> int:
    return next(c["id"] for c in client.get("/api/categories").json() if c["name"] == name)


class TestImports:
    def test_upload_imports_and_categorizes(self, seeded_db, client):
        resp = _upload(client)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["account"] == "JOINT"  # inferred from filename
        assert body["rows_total"] == 4
        assert body["rows_new"] == 4
        assert body["uncategorized_count"] == 1  # MYSTERY SHOP
        assert body["balance_warnings"] == {"2026-06": -10.0}

    def test_reupload_is_idempotent(self, seeded_db, client):
        _upload(client)
        resp = _upload(client)
        assert resp.json()["rows_new"] == 0

    def test_explicit_account_overrides_filename(self, seeded_db, client):
        resp = _upload(client, account="PERSO")
        assert resp.json()["account"] == "PERSO"

    def test_invalid_csv_rejected(self, client):
        resp = client.post(
            "/api/imports",
            files={"file": ("RELEVE_COMPTE_JOINT_2026.csv", b"not;a;bank;csv", "text/csv")},
        )
        assert resp.status_code == 422

    def test_missing_account_rejected(self, client):
        resp = client.post(
            "/api/imports",
            files={"file": ("export.csv", SAMPLE_CSV, "text/csv")},
        )
        assert resp.status_code == 422

    def test_unknown_account_rejected(self, client):
        resp = client.post(
            "/api/imports",
            files={"file": ("export.csv", SAMPLE_CSV, "text/csv")},
            data={"account": "WEIRD"},
        )
        assert resp.status_code == 422


class TestTransactions:
    def test_list_and_filter_uncategorized(self, seeded_db, client):
        _upload(client)
        resp = client.get("/api/transactions", params={"month": "2026-06", "uncategorized": True})
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["libelle"] == "MYSTERY SHOP"

    def test_filter_by_category_id(self, seeded_db, client):
        _upload(client)
        salaire = _category_id(client, "salaire")
        body = client.get("/api/transactions", params={"month": "2026-06", "category_id": salaire}).json()
        assert body["total"] >= 1
        assert all(t["category_id"] == salaire for t in body["items"])
        assert any("EMPLOYEUR" in t["libelle"] for t in body["items"])

    def test_filter_by_libelle_contains(self, seeded_db, client):
        _upload(client)
        body = client.get("/api/transactions", params={"libelle_contains": "MYSTERY"}).json()
        assert body["total"] >= 1
        assert all("MYSTERY" in t["libelle"] for t in body["items"])
        # Case-sensitive, mirroring the rule engine's instr().
        assert client.get("/api/transactions", params={"libelle_contains": "mystery"}).json()["total"] == 0

    def test_categorized_transaction_carries_name(self, seeded_db, client):
        _upload(client)
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        salary = next(t for t in items if "EMPLOYEUR" in t["libelle"])
        assert salary["category"] == "salaire"
        assert salary["category_id"] == _category_id(client, "salaire")

    def test_manual_override(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses})
        assert resp.status_code == 200
        assert resp.json()["category"] == "courses"
        assert resp.json()["category_manual"] is True
        assert resp.json()["rule_id"] is None  # a manual override is not rule-backed

    def test_manual_override_with_note(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        resp = client.patch(
            f"/api/transactions/{tx['id']}", json={"category_id": courses, "note": "cadeau"}
        )
        assert resp.status_code == 200
        assert resp.json()["category"] == "courses"
        assert resp.json()["note"] == "cadeau"

    def test_patch_note_only_keeps_category(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses})
        # A note-only patch must not touch the category.
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"note": "annotation"})
        assert resp.status_code == 200
        assert resp.json()["note"] == "annotation"
        assert resp.json()["category"] == "courses"
        assert resp.json()["category_manual"] is True

    def test_clear_manual_assignment_drops_note(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses, "note": "x"})
        # Deleting the assignment: clear category (rules reclaim the row) and the note.
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": None, "note": None})
        assert resp.status_code == 200
        body = resp.json()
        assert body["category_manual"] is False
        assert body["note"] is None

    def test_manual_filter_returns_only_manual_rows(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        client.patch(f"/api/transactions/{tx['id']}", json={"category_id": _category_id(client, "courses")})
        body = client.get("/api/transactions", params={"manual": True}).json()
        assert body["total"] == 1
        assert all(t["category_manual"] for t in body["items"])
        assert body["items"][0]["libelle"] == "MYSTERY SHOP"

    def test_transaction_carries_rule_provenance(self, seeded_db, client):
        _upload(client)
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        salary = next(t for t in items if "EMPLOYEUR" in t["libelle"])
        # Rule-classified (not manual): carries the matching rule's id + pattern for provenance.
        assert salary["category_manual"] is False
        assert salary["rule_id"] is not None
        assert salary["rule_pattern"] and salary["rule_pattern"] in salary["libelle"]

    def test_override_rejects_unknown_category(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions").json()["items"][0]
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": 9999})
        assert resp.status_code == 422

    def test_override_rejects_group_category(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions").json()["items"][0]
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": _category_id(client, "variable")})
        assert resp.status_code == 422  # 'variable' is a group; leaf-only assignment

    def test_uncategorized_filter_excludes_transfers(self, seeded_db, client):
        perso = (
            '"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            '"10/06/2026";"10/06/2026";"VIR vers COMPTE JOINT";"100,00";""\n'
        ).encode()
        joint = (
            '"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            '"10/06/2026";"10/06/2026";"VIR de COMPTE PERSO";"";"100,00"\n'
            '"11/06/2026";"11/06/2026";"MYSTERY SHOP";"10,00";""\n'
        ).encode()
        client.post("/api/imports", files={"file": ("RELEVE_COMPTE_PERSO_2026.csv", perso, "text/csv")})
        client.post("/api/imports", files={"file": ("RELEVE_COMPTE_JOINT_2026.csv", joint, "text/csv")})

        # The transfer legs are paired, the real expense is the only actionable uncategorised row.
        assert sum(1 for t in client.get("/api/transactions").json()["items"] if t["kind"] == "transfer") == 2
        uncategorized = client.get("/api/transactions", params={"uncategorized": True}).json()
        libelles = {t["libelle"] for t in uncategorized["items"]}
        assert libelles == {"MYSTERY SHOP"}

    def test_transaction_carries_kind(self, seeded_db, client):
        _upload(client)
        items = client.get("/api/transactions", params={"month": "2026-06"}).json()["items"]
        salary = next(t for t in items if "EMPLOYEUR" in t["libelle"])
        assert salary["kind"] == "income"
        assert salary["account_id"] == "JOINT"
        groceries = next(t for t in items if "SUPERMARCHE" in t["libelle"])
        assert groceries["kind"] == "expense"


TRANSFER_PERSO = (
    '"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    '"10/06/2026";"10/06/2026";"VIR vers COMPTE JOINT";"100,00";""\n'
    '"12/06/2026";"12/06/2026";"CARTE 12/06 SUPERMARCHE";"50,00";""\n'
).encode()
TRANSFER_JOINT = (
    '"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    '"10/06/2026";"10/06/2026";"VIR de COMPTE PERSO";"";"100,00"\n'
    '"13/06/2026";"13/06/2026";"VIR SEPA RECU /DE AMI";"";"50,00"\n'
).encode()


def _upload_transfers(client) -> dict[str, dict]:
    client.post("/api/imports", files={"file": ("RELEVE_COMPTE_PERSO_2026.csv", TRANSFER_PERSO, "text/csv")})
    client.post("/api/imports", files={"file": ("RELEVE_COMPTE_JOINT_2026.csv", TRANSFER_JOINT, "text/csv")})
    return {t["libelle"]: t for t in client.get("/api/transactions").json()["items"]}


class TestTransferApi:
    def test_false_positive_not_paired_and_fields_exposed(self, db, client):
        rows = _upload_transfers(client)
        assert rows["VIR vers COMPTE JOINT"]["kind"] == "transfer"
        assert rows["VIR vers COMPTE JOINT"]["transfer_group_id"] == rows["VIR de COMPTE PERSO"]["transfer_group_id"]
        assert rows["VIR vers COMPTE JOINT"]["kind_manual"] is False
        assert rows["CARTE 12/06 SUPERMARCHE"]["kind"] == "expense"  # same amount, not a virement
        assert rows["CARTE 12/06 SUPERMARCHE"]["transfer_group_id"] is None

    def test_transfer_pair_endpoint(self, db, client):
        rows = _upload_transfers(client)
        card, friend = rows["CARTE 12/06 SUPERMARCHE"]["id"], rows["VIR SEPA RECU /DE AMI"]["id"]
        resp = client.post("/api/transactions/transfer-pair", json={"transaction_ids": [card, friend]})
        assert resp.status_code == 200
        legs = resp.json()
        assert {leg["kind"] for leg in legs} == {"transfer"}
        assert legs[0]["transfer_group_id"] == legs[1]["transfer_group_id"] is not None
        assert all(leg["kind_manual"] for leg in legs)

        two_debits = [card, rows["VIR vers COMPTE JOINT"]["id"]]
        assert client.post("/api/transactions/transfer-pair", json={"transaction_ids": two_debits}).status_code == 422
        assert client.post("/api/transactions/transfer-pair", json={"transaction_ids": [card, 9999]}).status_code == 404
        assert client.post("/api/transactions/transfer-pair", json={"transaction_ids": [card]}).status_code == 422

    def test_transfer_mode_unpair_endpoint(self, db, client):
        rows = _upload_transfers(client)
        leg = rows["VIR vers COMPTE JOINT"]["id"]
        resp = client.put(f"/api/transactions/{leg}/transfer", json={"mode": "none"})
        assert resp.status_code == 200
        assert {t["kind"] for t in resp.json()} == {"income", "expense"}
        uncategorized = {t["libelle"] for t in client.get("/api/transactions", params={"uncategorized": True}).json()["items"]}
        assert {"VIR vers COMPTE JOINT", "VIR de COMPTE PERSO"} <= uncategorized
        assert client.put(f"/api/transactions/{leg}/transfer", json={"mode": "bogus"}).status_code == 422
        assert client.put("/api/transactions/9999/transfer", json={"mode": "auto"}).status_code == 404

    def test_transfer_markers_endpoints(self, db, client):
        assert client.get("/api/transfer-markers").json() == {"markers": ["VIR"], "is_default": True}
        rows = _upload_transfers(client)
        assert rows["CARTE 12/06 SUPERMARCHE"]["kind"] == "expense"

        resp = client.put("/api/transfer-markers", json={"markers": ["*"]})
        assert resp.json() == {"markers": ["*"], "is_default": False}
        kinds = {t["libelle"]: t["kind"] for t in client.get("/api/transactions").json()["items"]}
        assert kinds["CARTE 12/06 SUPERMARCHE"] == "transfer"  # any label pairs again

        assert client.put("/api/transfer-markers", json={"markers": []}).json()["is_default"] is True


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
        assert client.post("/api/rules", json={"category_id": courses, "pattern": "X"}).status_code == 422
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

    def test_duplicate_name_same_parent_rejected(self, seeded_db, client):
        variable = _category_id(client, "variable")
        resp = client.post("/api/categories", json={"name": "courses", "parent_id": variable})
        assert resp.status_code == 409


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

    def test_rule_rejects_unknown_category(self, client):
        resp = client.post("/api/rules", json={"category_id": 9999, "pattern": "X"})
        assert resp.status_code == 422

    def test_rule_rejects_group_category(self, seeded_db, client):
        resp = client.post("/api/rules", json={"category_id": _category_id(client, "variable"), "pattern": "X"})
        assert resp.status_code == 422  # 'variable' is a group; rules must target a leaf

    def test_anchor_rule_mutation_moves_periods(self, seeded_db, client):
        # Salary deposit late in June + spending after it
        csv = (
            '"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            '"28/06/2026";"28/06/2026";"VIR EMPLOYEUR SALAIRE";"";"2500,00"\n'
            '"29/06/2026";"29/06/2026";"CARTE SUPERMARCHE";"50,00";""\n'
        ).encode()
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
        from app.db import connect, import_transactions

        with connect(db) as conn:
            epargne = conn.execute("INSERT INTO categories (name) VALUES ('Épargne')").lastrowid
            deficit = conn.execute("INSERT INTO categories (name) VALUES ('Déficit')").lastrowid
            emprunt = conn.execute(
                "INSERT INTO categories (name, parent_id) VALUES ('Emprunt', ?)", (deficit,)
            ).lastrowid
            conn.execute("INSERT INTO label_rules (category_id, pattern) VALUES (?, 'VERSEMENT PEL')", (epargne,))
        rows = [
            ("2026-06-02", "VIR PRET CONSO", 0, 1000, "PERSO"),
            ("2026-06-03", "VERSEMENT PEL", 200, 0, "PERSO"),
            ("2026-06-04", "COURSES", 50, 0, "PERSO"),
            ("2026-06-05", "VIR de COMPTE", 0, 300, "LIVRET"),  # derived Épargne leaf
        ]
        import_transactions(
            [
                {"Date operation": d, "Date valeur": d, "Libelle": lib, "Debit": deb, "Credit": cre, "account": acc}
                for d, lib, deb, cre, acc in rows
            ],
            db,
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

class TestExport:
    def test_export_categories_csv(self, seeded_db, client):
        resp = client.get("/api/categories/export")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/csv")
        assert "categories.csv" in resp.headers["content-disposition"]
        body = resp.content.decode("utf-8-sig")
        assert body.splitlines()[0] == "path"
        assert "fixe / salaire" in body
        assert "variable / sortie / bar" in body

    def test_export_rules_csv(self, seeded_db, client):
        body = client.get("/api/rules/export").content.decode("utf-8-sig")
        assert body.splitlines()[0] == "category_path;pattern;priority;is_income_anchor;description"
        assert "fixe / salaire;EMPLOYEUR;1;1;" in body
        assert "variable / sortie / bar;ANGELUS;4;0;" in body

    def test_round_trip(self, seeded_db, client, tmp_path):
        from app.api.categories import _load_all, category_paths
        from app.db import connect, init_db
        from scripts.import_csv import import_csv

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
            json={"category_id": _category_id(client, "bar"), "pattern": "GUINNESS",
                  "priority": 9, "is_income_anchor": False, "description": "pub du vendredi"},
        )

        cats_csv = tmp_path / "categories.csv"
        rules_csv = tmp_path / "rules.csv"
        cats_csv.write_bytes(client.get("/api/categories/export").content)
        rules_csv.write_bytes(client.get("/api/rules/export").content)

        before = snapshot(seeded_db)

        fresh = tmp_path / "fresh.db"
        init_db(fresh)
        import_csv(cats_csv, rules_csv, fresh)

        assert snapshot(fresh) == before

    def test_export_overrides_csv(self, seeded_db, client):
        _upload(client)
        tx = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        courses = _category_id(client, "courses")
        client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses})

        body = client.get("/api/transactions/export-overrides").content.decode("utf-8-sig")
        assert body.splitlines()[0] == "import_hash;category_path;kind;libelle;note;transfer_pair"
        line = next(line for line in body.splitlines()[1:] if "MYSTERY SHOP" in line)
        assert ";variable / courses;;MYSTERY SHOP;" in line  # manual category, no kind override, no note

    def test_overrides_round_trip(self, seeded_db, client, tmp_path):
        from app.db import connect, init_db, upsert_accounts
        from app.main import create_app
        from fastapi.testclient import TestClient
        from scripts.import_csv import import_csv
        from tests.conftest import TEST_ACCOUNT_ALIASES, TEST_ACCOUNTS

        # Source DB: import, set a manual category + note, and (directly) a manual kind.
        _upload(client)
        mystery = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        client.patch(
            f"/api/transactions/{mystery['id']}",
            json={"category_id": _category_id(client, "courses"), "note": "remboursé par Léa"},
        )
        with connect(seeded_db) as conn:
            conn.execute("UPDATE transactions SET kind = 'income', kind_manual = 1 WHERE libelle = 'BAR ANGELUS'")

        cats = tmp_path / "categories.csv"
        rules = tmp_path / "rules.csv"
        overrides = tmp_path / "overrides.csv"
        cats.write_bytes(client.get("/api/categories/export").content)
        rules.write_bytes(client.get("/api/rules/export").content)
        overrides.write_bytes(client.get("/api/transactions/export-overrides").content)

        # Fresh DB with the same transactions (same hashes), then restore everything.
        fresh = tmp_path / "fresh.db"
        init_db(fresh)
        with connect(fresh) as conn:
            upsert_accounts(conn, TEST_ACCOUNTS, TEST_ACCOUNT_ALIASES)
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

    def test_refresh_export_matches_api(self, seeded_db, client, tmp_path):
        # reset_db.py snapshots the DB to CSV directly; the bytes must match the API export
        # endpoints exactly so the snapshot round-trips through import_csv.
        from app.db import connect
        from scripts.reset_db import export_current

        _upload(client)
        mystery = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        client.patch(
            f"/api/transactions/{mystery['id']}",
            json={"category_id": _category_id(client, "courses"), "note": "à vérifier"},
        )
        with connect(seeded_db) as conn:
            conn.execute("UPDATE transactions SET kind = 'income', kind_manual = 1 WHERE libelle = 'BAR ANGELUS'")

        cat_csv, rules_csv, overrides_csv = export_current(seeded_db, tmp_path / "snap")
        assert cat_csv.read_bytes() == client.get("/api/categories/export").content
        assert rules_csv.read_bytes() == client.get("/api/rules/export").content
        assert overrides_csv.read_bytes() == client.get("/api/transactions/export-overrides").content


class TestTransferOverrides:
    def test_manual_pair_and_unpair_round_trip(self, db, client, tmp_path):
        from app.db import connect, init_db, upsert_accounts
        from app.main import create_app
        from fastapi.testclient import TestClient
        from scripts.import_csv import import_csv
        from tests.conftest import TEST_ACCOUNT_ALIASES, TEST_ACCOUNTS

        rows = _upload_transfers(client)
        client.post(
            "/api/transactions/transfer-pair",
            json={"transaction_ids": [rows["CARTE 12/06 SUPERMARCHE"]["id"], rows["VIR SEPA RECU /DE AMI"]["id"]]},
        )
        client.put(f"/api/transactions/{rows['VIR vers COMPTE JOINT']['id']}/transfer", json={"mode": "none"})
        body = client.get("/api/transactions/export-overrides").content
        assert body.decode("utf-8-sig").count(";") > 0
        cats, rules, overrides = tmp_path / "c.csv", tmp_path / "r.csv", tmp_path / "o.csv"
        cats.write_bytes(client.get("/api/categories/export").content)
        rules.write_bytes(client.get("/api/rules/export").content)
        overrides.write_bytes(body)

        fresh = tmp_path / "fresh.db"
        init_db(fresh)
        with connect(fresh) as conn:
            upsert_accounts(conn, TEST_ACCOUNTS, TEST_ACCOUNT_ALIASES)
        with TestClient(create_app(fresh)) as fresh_client:
            _upload_transfers(fresh_client)
        import_csv(cats, rules, fresh, overrides)

        with connect(fresh) as conn:
            state = {
                lib: (kind, manual, group)
                for lib, kind, manual, group in conn.execute(
                    "SELECT libelle, kind, kind_manual, transfer_group_id FROM transactions"
                )
            }
        card, friend = state["CARTE 12/06 SUPERMARCHE"], state["VIR SEPA RECU /DE AMI"]
        assert card[:2] == friend[:2] == ("transfer", 1) and card[2] == friend[2] is not None
        assert state["VIR vers COMPTE JOINT"] == ("expense", 1, None)
        assert state["VIR de COMPTE PERSO"] == ("income", 1, None)

    def test_old_overrides_csv_without_transfer_pair_loads(self, seeded_db, client, tmp_path):
        from app.db import connect
        from scripts.import_csv import import_csv

        _upload(client)
        with connect(seeded_db) as conn:
            hash_ = conn.execute("SELECT import_hash FROM transactions WHERE libelle = 'MYSTERY SHOP'").fetchone()[0]
        cats, rules, overrides = tmp_path / "c.csv", tmp_path / "r.csv", tmp_path / "o.csv"
        cats.write_bytes(client.get("/api/categories/export").content)
        rules.write_bytes(client.get("/api/rules/export").content)
        overrides.write_text(
            f"import_hash;category_path;kind;libelle;note\n{hash_};variable / courses;;MYSTERY SHOP;vieux\n",
            encoding="utf-8",
        )
        import_csv(cats, rules, seeded_db, overrides)
        with connect(seeded_db) as conn:
            assert conn.execute(
                "SELECT category_manual, note FROM transactions WHERE libelle = 'MYSTERY SHOP'"
            ).fetchone() == (1, "vieux")


class TestResetDb:
    """reset_db.py rebuilds the DB from _inputs/ + a taxonomy source, preserving manual overrides."""

    def _isolate(self, tmp_path, monkeypatch):
        """Point reset_db at a temp _inputs/ (holding the sample statement) and _backups/."""
        import scripts.reset_db as reset_db

        inputs = tmp_path / "_inputs"
        inputs.mkdir()
        # Same filename _upload uses, so the inferred account (and thus import_hash) matches.
        (inputs / "RELEVE_COMPTE_JOINT_2026_06_08.csv").write_bytes(SAMPLE_CSV)
        backups = tmp_path / "_backups"
        monkeypatch.setattr(reset_db, "INPUTS_DIR", inputs)
        monkeypatch.setattr(reset_db, "BACKUPS_DIR", backups)
        monkeypatch.setattr(reset_db, "CONFIG_DIR", tmp_path / "_config")  # absent unless a test writes it
        return reset_db, backups

    @staticmethod
    def _mystery_row(db_path):
        from app.db import connect

        with connect(db_path) as conn:
            return conn.execute(
                "SELECT t.category_manual, c.name, t.note FROM transactions t "
                "LEFT JOIN categories c ON c.id = t.category_id WHERE t.libelle = 'MYSTERY SHOP'"
            ).fetchone()

    @staticmethod
    def _accounts(db_path):
        from app.db import connect

        with connect(db_path) as conn:
            return conn.execute(
                "SELECT code, label, deposit_pattern FROM accounts ORDER BY sort_order, code"
            ).fetchall()

    @staticmethod
    def _count(db_path, table):
        from app.db import connect

        with connect(db_path) as conn:
            return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def test_defaults_falls_back_to_example_data(self, tmp_path, monkeypatch):
        reset_db, _backups = self._isolate(tmp_path, monkeypatch)
        db_path = tmp_path / "new.db"

        reset_db.reset(db_path, "defaults", None)  # no _config/ -> the fictional data/ example

        assert [code for code, *_ in self._accounts(db_path)] == ["PERSO", "JOINT", "LIVRET", "LOCATIF", "ENFANT"]
        assert self._count(db_path, "label_rules") > 0
        assert self._count(db_path, "transactions") == 4  # the sample statement resolved to JOINT

    def test_defaults_prefers_private_config_dir(self, tmp_path, monkeypatch):
        reset_db, _backups = self._isolate(tmp_path, monkeypatch)
        config = tmp_path / "_config"
        config.mkdir()
        (config / "accounts.csv").write_text(
            "code;label;type;include_in_full_view;sort_order;deposit_pattern;aliases\n"
            "MAIN;Mon compte;checking;1;1;;JOINT\n",
            encoding="utf-8",
        )
        (config / "categories.csv").write_text("path\nVariable\nVariable / Courses\n", encoding="utf-8")
        (config / "rules.csv").write_text(
            "category_path;pattern;priority;is_income_anchor;description\n"
            "Variable / Courses;SUPERMARCHE;1;0;\n",
            encoding="utf-8",
        )
        db_path = tmp_path / "new.db"

        reset_db.reset(db_path, "defaults", None)

        assert self._accounts(db_path) == [("MAIN", "Mon compte", None)]
        # The statement filename (RELEVE_COMPTE_JOINT_…) resolved through the private alias.
        from app.db import connect

        with connect(db_path) as conn:
            assert conn.execute("SELECT DISTINCT account_id FROM transactions").fetchall() == [("MAIN",)]
            assert conn.execute("SELECT COUNT(*) FROM transactions WHERE category_id IS NOT NULL").fetchone()[0] == 1

    def test_live_snapshots_and_preserves_overrides(self, seeded_db, client, tmp_path, monkeypatch):
        reset_db, backups = self._isolate(tmp_path, monkeypatch)
        _upload(client)
        mystery = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        client.patch(
            f"/api/transactions/{mystery['id']}",
            json={"category_id": _category_id(client, "courses"), "note": "cadeau"},
        )

        reset_db.reset(seeded_db, "live", None)

        # A restore point was written under _backups/<ts>/, and the override survived the rebuild.
        snaps = list(backups.glob("*"))
        assert len(snaps) == 1 and (snaps[0] / "overrides.csv").exists()
        assert self._mystery_row(seeded_db) == (1, "courses", "cadeau")
        # Accounts (and their aliases) are part of the snapshot and survive the rebuild too.
        assert (snaps[0] / "accounts.csv").exists()
        assert self._accounts(seeded_db)[0] == ("PERSO", "Compte perso", None)
        assert ("ENFANT", "Livret enfant", "VERS LIVRET ENFANT") in self._accounts(seeded_db)

    def test_live_rebuild_keeps_transfer_markers(self, seeded_db, client, tmp_path, monkeypatch):
        reset_db, backups = self._isolate(tmp_path, monkeypatch)
        client.put("/api/transfer-markers", json={"markers": ["*"]})

        reset_db.reset(seeded_db, "live", None)

        snap = next(backups.glob("*"))
        assert (snap / "transfer_markers.csv").read_text(encoding="utf-8-sig").splitlines() == ["marker", "*"]
        from app.db import connect, get_transfer_markers

        with connect(seeded_db) as conn:
            assert get_transfer_markers(conn) == ["*"]

    def test_backup_restores_without_live_db(self, seeded_db, client, tmp_path, monkeypatch):
        reset_db, backups = self._isolate(tmp_path, monkeypatch)
        _upload(client)
        mystery = client.get("/api/transactions", params={"uncategorized": True}).json()["items"][0]
        client.patch(
            f"/api/transactions/{mystery['id']}",
            json={"category_id": _category_id(client, "courses"), "note": "cadeau"},
        )
        reset_db.export_current(seeded_db, backups / "20260101_000000")
        seeded_db.unlink()  # simulate a lost DB

        reset_db.reset(seeded_db, "backup", None)  # restore from the latest snapshot + _inputs

        assert seeded_db.exists()
        assert self._mystery_row(seeded_db) == (1, "courses", "cadeau")
