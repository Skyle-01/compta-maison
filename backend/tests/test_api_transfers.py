from fastapi.testclient import TestClient

from app.db import connect
from app.main import create_app
from scripts.import_csv import import_csv
from tests.api_helpers import _export, _upload, _upload_transfers
from tests.conftest import make_db


class TestTransferApi:
    def test_false_positive_not_paired_and_fields_exposed(self, db, client):
        rows = _upload_transfers(client)
        assert rows["VIR vers COMPTE JOINT"]["kind"] == "transfer"
        assert (
            rows["VIR vers COMPTE JOINT"]["transfer_group_id"]
            == rows["VIR de COMPTE PERSO"]["transfer_group_id"]
        )
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
        assert (
            client.post("/api/transactions/transfer-pair", json={"transaction_ids": two_debits}).status_code
            == 422
        )
        assert (
            client.post("/api/transactions/transfer-pair", json={"transaction_ids": [card, 9999]}).status_code
            == 404
        )
        assert (
            client.post("/api/transactions/transfer-pair", json={"transaction_ids": [card]}).status_code
            == 422
        )

    def test_transfer_mode_unpair_endpoint(self, db, client):
        rows = _upload_transfers(client)
        leg = rows["VIR vers COMPTE JOINT"]["id"]
        resp = client.put(f"/api/transactions/{leg}/transfer", json={"mode": "none"})
        assert resp.status_code == 200
        assert {t["kind"] for t in resp.json()} == {"income", "expense"}
        uncategorized = {
            t["libelle"]
            for t in client.get("/api/transactions", params={"uncategorized": True}).json()["items"]
        }
        assert {"VIR vers COMPTE JOINT", "VIR de COMPTE PERSO"} <= uncategorized
        assert client.put(f"/api/transactions/{leg}/transfer", json={"mode": "bogus"}).status_code == 422
        assert client.put("/api/transactions/9999/transfer", json={"mode": "auto"}).status_code == 404

    def test_manual_transfer_filter(self, db, client):
        rows = _upload_transfers(client)
        assert client.get("/api/transactions", params={"manual_transfer": True}).json()["total"] == 0
        card, friend = rows["CARTE 12/06 SUPERMARCHE"]["id"], rows["VIR SEPA RECU /DE AMI"]["id"]
        client.post("/api/transactions/transfer-pair", json={"transaction_ids": [card, friend]})
        items = client.get("/api/transactions", params={"manual_transfer": True}).json()["items"]
        assert {t["id"] for t in items} == {card, friend}
        assert items[0]["transfer_group_id"] == items[1]["transfer_group_id"] is not None

        client.put(f"/api/transactions/{card}/transfer", json={"mode": "auto"})
        assert client.get("/api/transactions", params={"manual_transfer": True}).json()["total"] == 0

    def test_transfer_markers_endpoints(self, db, client):
        assert client.get("/api/transfer-markers").json() == {"markers": ["VIR"], "is_default": True}
        rows = _upload_transfers(client)
        assert rows["CARTE 12/06 SUPERMARCHE"]["kind"] == "expense"

        resp = client.put("/api/transfer-markers", json={"markers": ["*"]})
        assert resp.json() == {"markers": ["*"], "is_default": False}
        kinds = {t["libelle"]: t["kind"] for t in client.get("/api/transactions").json()["items"]}
        assert kinds["CARTE 12/06 SUPERMARCHE"] == "transfer"  # any label pairs again

        assert client.put("/api/transfer-markers", json={"markers": []}).json()["is_default"] is True


class TestTransferOverrides:
    def test_manual_pair_and_unpair_round_trip(self, db, client, tmp_path):
        rows = _upload_transfers(client)
        client.post(
            "/api/transactions/transfer-pair",
            json={
                "transaction_ids": [
                    rows["CARTE 12/06 SUPERMARCHE"]["id"],
                    rows["VIR SEPA RECU /DE AMI"]["id"],
                ]
            },
        )
        client.put(f"/api/transactions/{rows['VIR vers COMPTE JOINT']['id']}/transfer", json={"mode": "none"})
        cfg = _export(db, tmp_path)
        cats, rules, overrides = cfg / "categories.csv", cfg / "rules.csv", cfg / "overrides.csv"
        assert overrides.read_text(encoding="utf-8-sig").count(";") > 0

        fresh = make_db(tmp_path / "fresh.db")
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
        _upload(client)
        with connect(seeded_db) as conn:
            hash_ = conn.execute(
                "SELECT import_hash FROM transactions WHERE libelle = 'MYSTERY SHOP'"
            ).fetchone()[0]
        cfg = _export(seeded_db, tmp_path)
        cats, rules, overrides = cfg / "categories.csv", cfg / "rules.csv", cfg / "overrides.csv"
        overrides.write_text(
            f"import_hash;category_path;kind;libelle;note\n{hash_};variable / courses;;MYSTERY SHOP;vieux\n",
            encoding="utf-8",
        )
        import_csv(cats, rules, seeded_db, overrides)
        with connect(seeded_db) as conn:
            assert conn.execute(
                "SELECT category_manual, note FROM transactions WHERE libelle = 'MYSTERY SHOP'"
            ).fetchone() == (1, "vieux")
