from app.api.errors import french_message
from tests.api_helpers import _category_id


class TestFrenchValidationErrors:
    """Pydantic's English messages are rewritten (api/errors.py): the pages show `msg` as it is."""

    def test_negative_target(self, seeded_db, client):
        resp = client.put(f"/api/categories/{_category_id(client, 'bar')}/target", json={"budget_target": -5})
        assert resp.status_code == 422
        [error] = resp.json()["detail"]
        assert error["msg"] == "Objectif : la valeur doit être supérieure à 0"
        assert (error["type"], error["loc"]) == ("greater_than", ["body", "budget_target"])  # shape kept

    def test_rule_fields(self, seeded_db, client):
        resp = client.post(
            "/api/rules", json={"category_id": _category_id(client, "bar"), "pattern": "", "priority": 1.5}
        )
        assert [e["msg"] for e in resp.json()["detail"]] == [
            "Motif : ne peut pas être vide",
            "Priorité : un nombre entier est attendu",
        ]

    def test_without_a_field(self, client):
        resp = client.post("/api/rules", content=b"{bad", headers={"Content-Type": "application/json"})
        assert [e["msg"] for e in resp.json()["detail"]] == ["Requête illisible (JSON invalide)"]

    def test_body_not_utf8(self, client):
        resp = client.post(
            "/api/categories", content=b'{"name":"\xe9"}', headers={"Content-Type": "application/json"}
        )
        assert resp.status_code == 400
        assert [e["msg"] for e in resp.json()["detail"]] == [
            "Requête illisible (encodage invalide, UTF-8 attendu)"
        ]

    def test_list_item_and_constraints(self, client):
        resp = client.put("/api/transfer-markers", json={"markers": [1]})
        assert [e["msg"] for e in resp.json()["detail"]] == ["Marqueurs : un texte est attendu"]
        resp = client.post("/api/transactions/transfer-pair", json={"transaction_ids": [1]})
        assert [e["msg"] for e in resp.json()["detail"]] == ["Opérations : 2 élément(s) au minimum"]
        resp = client.put("/api/transactions/1/transfer", json={"mode": "x"})
        assert [e["msg"] for e in resp.json()["detail"]] == [
            "Mode : valeur attendue : 'transfer', 'none' ou 'auto'"
        ]

    def test_unknown_type_and_field(self):
        assert french_message({"type": "uuid_parsing", "loc": ("query", "ref")}) == "ref : valeur invalide"
        assert french_message({"type": "greater_than", "loc": ("body", "x")}) == "x : valeur invalide"
        assert french_message({"type": "less_than_equal", "loc": ("body",), "ctx": {"le": 2.5}}) == (
            "La valeur doit être inférieure ou égale à 2,5"
        )
