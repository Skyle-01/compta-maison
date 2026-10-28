from tests.api_helpers import _category_id, _upload
from tests.conftest import import_rows

TRIAGE_CSV = (
    b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
    b'"01/06/2026";"01/06/2026";"CARTE 01/06 BOULANGERIE DUPONT";"4,20";""\n'
    b'"08/06/2026";"08/06/2026";"CARTE 08/06 BOULANGERIE DUPONT";"5,80";""\n'
    b'"09/06/2026";"09/06/2026";"CARTE 09/06 LIBRAIRIE";"30,00";""\n'
    b'"10/06/2026";"10/06/2026";"CARTE LECLERC DRIVE";"40,00";""\n'
)


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

    def test_filter_by_deposit_pattern_ignores_case(self, db, client):
        # The external-savings drill-down: same case-insensitive test as recompute_transfers.
        import_rows(
            db,
            ("2026-06-10", "2026-06-10", "vers Livret Enfant", 25, 0, "JOINT"),
            ("2026-06-11", "2026-06-11", "SUPERMARCHE", 30, 0, "JOINT"),
        )
        body = client.get("/api/transactions", params={"deposit_pattern": "VERS LIVRET ENFANT"}).json()
        assert [t["libelle"] for t in body["items"]] == ["vers Livret Enfant"]

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
        resp = client.patch(f"/api/transactions/{tx['id']}", json={"category_id": courses, "note": "cadeau"})
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
        resp = client.patch(
            f"/api/transactions/{tx['id']}", json={"category_id": _category_id(client, "variable")}
        )
        assert resp.status_code == 422  # 'variable' is a group; leaf-only assignment

    def test_patch_unknown_transaction_is_404(self, seeded_db, client):
        resp = client.patch("/api/transactions/9999", json={"category_id": _category_id(client, "courses")})
        assert resp.status_code == 404
        assert client.patch("/api/transactions/9999", json={"note": "x"}).status_code == 404

    def test_uncategorized_filter_excludes_transfers(self, seeded_db, client):
        perso = (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"10/06/2026";"10/06/2026";"VIR vers COMPTE JOINT";"100,00";""\n'
        )
        joint = (
            b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
            b'"10/06/2026";"10/06/2026";"VIR de COMPTE PERSO";"";"100,00"\n'
            b'"11/06/2026";"11/06/2026";"MYSTERY SHOP";"10,00";""\n'
        )
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


class TestTriage:
    def test_uncategorized_groups(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        groups = client.get("/api/transactions/uncategorized-groups").json()
        assert [(g["key"], g["count"]) for g in groups] == [
            ("CARTE LIBRAIRIE", 1),
            ("CARTE BOULANGERIE DUPONT", 2),
        ]
        bakery = groups[1]
        assert bakery["pattern"] == "BOULANGERIE DUPONT" and bakery["pattern_generic"] is False
        assert (bakery["debit"], bakery["credit"], bakery["accounts"]) == (10.0, 0.0, ["JOINT"])
        assert [t["date_valeur"] for t in bakery["transactions"]] == ["2026-06-08", "2026-06-01"]
        assert bakery["suggestion"] is None
        assert client.get("/api/transactions/uncategorized-groups", params={"month": "2026-01"}).json() == []

    def test_groups_carry_a_suggestion(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        courses = _category_id(client, "courses")
        bakery = client.get("/api/transactions/uncategorized-groups").json()[1]
        client.patch(f"/api/transactions/{bakery['transactions'][0]['id']}", json={"category_id": courses})
        bakery = client.get("/api/transactions/uncategorized-groups").json()[1]
        assert bakery["count"] == 1
        assert bakery["suggestion"] == {"category_id": courses, "count": 1, "token": None}

    def test_rule_preview_reports_rows_other_rules_lose(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        resp = client.get("/api/rules/preview", params={"pattern": "CARTE", "priority": 1})
        assert resp.status_code == 200
        body = resp.json()
        assert body["uncategorized"] == 3
        courses = _category_id(client, "courses")
        assert body["reclassified"] == [
            {
                "rule_id": body["reclassified"][0]["rule_id"],
                "pattern": "LECLERC",
                "category_id": courses,
                "count": 1,
            }
        ]
        same = client.get(
            "/api/rules/preview", params={"pattern": "CARTE", "priority": 1, "category_id": courses}
        )
        assert same.json()["reclassified"] == []
        assert client.get("/api/rules/preview", params={"pattern": "CARTE"}).json()["reclassified"] == []

    def test_groups_carry_transfer_candidates(self, db, client):
        import_rows(
            db,
            ("2026-09-03", "2026-09-03", "VIR INST LOCATAIRE DUPONT", 0, 570, "LOCATIF"),
            ("2026-09-04", "2026-09-04", "VIR de MOI MEME", 0, 570, "LOCATIF"),
            ("2026-09-03", "2026-09-03", "VIR vers LOGEMENT", 570, 0, "PERSO"),
        )
        groups = client.get("/api/transactions/uncategorized-groups").json()
        debit = next(g for g in groups if g["transactions"][0]["libelle"] == "VIR vers LOGEMENT")
        assert [(c["transaction_id"], c["partner"]["libelle"]) for c in debit["transfer_candidates"]] == [
            (debit["transactions"][0]["id"], "VIR INST LOCATAIRE DUPONT"),
            (debit["transactions"][0]["id"], "VIR de MOI MEME"),
        ]
        partner_id = debit["transfer_candidates"][1]["partner"]["id"]
        assert (
            client.post(
                "/api/transactions/transfer-pair",
                json={"transaction_ids": [debit["transactions"][0]["id"], partner_id]},
            ).status_code
            == 200
        )
        groups = client.get("/api/transactions/uncategorized-groups").json()
        assert [(g["transactions"][0]["libelle"], g["transfer_candidates"]) for g in groups] == [
            ("VIR INST LOCATAIRE DUPONT", [])
        ]

    def test_rule_preview_needs_a_pattern(self, client):
        resp = client.get("/api/rules/preview", params={"pattern": ""})
        assert resp.status_code == 422
        assert resp.json()["detail"][0]["msg"] == "Motif : ne peut pas être vide"

    def test_bulk_manual_assignment_and_undo(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        ids = [
            t["id"] for t in client.get("/api/transactions/uncategorized-groups").json()[1]["transactions"]
        ]
        courses = _category_id(client, "courses")
        resp = client.patch("/api/transactions", json={"ids": ids, "category_id": courses, "note": "pain"})
        assert resp.status_code == 200
        assert [(t["category"], t["category_manual"], t["note"]) for t in resp.json()] == [
            ("courses", True, "pain")
        ] * 2
        assert client.get("/api/transactions", params={"uncategorized": True}).json()["total"] == 1

        undo = client.patch("/api/transactions", json={"ids": ids, "category_id": None, "note": None})
        assert [(t["category_id"], t["category_manual"], t["note"]) for t in undo.json()] == [
            (None, False, None)
        ] * 2
        assert client.get("/api/transactions", params={"uncategorized": True}).json()["total"] == 3

    def test_bulk_clear_lets_rules_reclaim_rows(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        drive = client.get("/api/transactions", params={"libelle_contains": "LECLERC"}).json()["items"][0]
        bar = _category_id(client, "bar")
        client.patch("/api/transactions", json={"ids": [drive["id"]], "category_id": bar})
        (cleared,) = client.patch(
            "/api/transactions", json={"ids": [drive["id"]], "category_id": None}
        ).json()
        assert (cleared["category"], cleared["rule_pattern"]) == ("courses", "LECLERC")

    def test_bulk_assignment_errors(self, seeded_db, client):
        _upload(client, content=TRIAGE_CSV)
        tx = client.get("/api/transactions").json()["items"][0]
        group = client.patch(
            "/api/transactions", json={"ids": [tx["id"]], "category_id": _category_id(client, "variable")}
        )
        assert group.status_code == 422
        unknown = client.patch("/api/transactions", json={"ids": [tx["id"]], "category_id": 9999})
        assert unknown.json()["detail"] == ["Catégorie 9999 introuvable"]
        missing = client.patch(
            "/api/transactions",
            json={"ids": [tx["id"], 9998, 9999], "category_id": _category_id(client, "bar")},
        )
        assert missing.status_code == 404
        assert missing.json()["detail"] == ["Opérations introuvables : 9998, 9999"]
        empty = client.patch("/api/transactions", json={"ids": [], "category_id": None})
        assert empty.json()["detail"][0]["msg"] == "Opérations : 1 élément(s) au minimum"
