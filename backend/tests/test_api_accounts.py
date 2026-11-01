from tests.api_helpers import _upload


def _put(client, code, **body):
    return client.put(f"/api/accounts/{code}", json={"label": "Compte B", "type": "checking", **body})


def _kinds(client) -> dict[str, str]:
    return {t["libelle"]: t["kind"] for t in client.get("/api/transactions").json()["items"]}


class TestAccountsApi:
    def test_list_exposes_aliases_and_deposit_pattern(self, client):
        accounts = {a["code"]: a for a in client.get("/api/accounts").json()}
        assert accounts["PERSO"]["aliases"] == ["COMPTE PERSO"]
        assert accounts["ENFANT"]["deposit_pattern"] == "VERS LIVRET ENFANT"
        assert accounts["PERSO"]["deposit_pattern"] is None

    def test_create_appends_the_account(self, client):
        resp = _put(client, "b", aliases=[" compte bb ", "", "Autre"])
        assert resp.status_code == 200
        assert resp.json() == {
            "code": "B",
            "label": "Compte B",
            "type": "checking",
            "sort_order": 6,
            "deposit_pattern": None,
            "aliases": ["AUTRE", "COMPTE BB"],
        }
        assert client.get("/api/accounts").json()[-1]["code"] == "B"

    def test_update_replaces_label_and_aliases_keeping_the_order(self, client):
        _put(client, "B", aliases=["OLD"])
        resp = _put(client, "B", label="Nouveau nom", aliases=["NEW"])
        assert (resp.json()["label"], resp.json()["aliases"], resp.json()["sort_order"]) == (
            "Nouveau nom",
            ["NEW"],
            6,
        )

    def test_alias_equal_to_the_label_is_not_stored(self, client):
        assert _put(client, "B", aliases=["compte b"]).json()["aliases"] == []

    def test_a_name_designates_one_account(self, client):
        for body in ({"aliases": ["compte joint"]}, {"label": "Livret A"}):
            resp = _put(client, "B", **body)
            assert resp.status_code == 422
            assert "désigne déjà le compte" in resp.json()["detail"]
        assert "B" not in {a["code"] for a in client.get("/api/accounts").json()}

    def test_code_is_a_name_too(self, client):
        assert _put(client, "joint", label="Autre").status_code == 200  # the account JOINT itself
        assert _put(client, "B", aliases=["PERSO"]).status_code == 422

    def test_type_never_changes(self, client):
        resp = _put(client, "PERSO", type="savings")
        assert resp.status_code == 422
        assert "type" in resp.json()["detail"]

    def test_deposit_pattern_is_for_savings_only(self, client):
        assert _put(client, "B", deposit_pattern="VERS B").status_code == 422
        resp = _put(client, "B", type="savings", deposit_pattern="  VERS B ")
        assert resp.json()["deposit_pattern"] == "VERS B"

    def test_blank_label_is_rejected_in_french(self, client):
        resp = _put(client, "B", label="")
        assert resp.status_code == 422
        assert resp.json()["detail"][0]["msg"].startswith("Libellé :")

    def test_new_alias_pairs_the_transfer_already_imported(self, client):
        # No transfer marker starts these labels: a leg pairs only if its label names another account,
        # and PERSO's names "COMPTE ZED", which no account is called yet.
        _put(client, "Z", label="Autre")
        _upload(
            client,
            "RELEVE_COMPTE_PERSO_2026.csv",
            content=(
                b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
                b'"10/06/2026";"10/06/2026";"MISE DE COMPTE ZED";"100,00";""\n'
            ),
        )
        _upload(
            client,
            "RELEVE_COMPTE_Z_2026.csv",
            content=(
                b'"Date operation";"Date valeur";"Libelle";"Debit";"Credit"\n'
                b'"10/06/2026";"10/06/2026";"RECU DE COMPTE PERSO";"";"100,00"\n'
            ),
        )
        assert set(_kinds(client).values()) == {"expense", "income"}

        _put(client, "Z", label="Autre", aliases=["COMPTE ZED"])
        assert set(_kinds(client).values()) == {"transfer"}
