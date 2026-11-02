"""An operation split across two categories (the 2nd part in transaction_splits)."""

from fastapi.testclient import TestClient

from app.core.categorize import budget_status, category_tree
from app.db import connect
from app.main import create_app
from scripts.import_csv import import_csv

from .api_helpers import _category_id, _export, _upload
from .conftest import make_db


def _tx(client, libelle: str) -> dict:
    items = client.get("/api/transactions", params={"limit": 1000}).json()["items"]
    return next(t for t in items if t["libelle"] == libelle)


def _split(client, libelle: str, category: str, amount: float):
    """Split the operation `libelle` (SUPERMARCHE, 63.82 EUR, in courses) with `amount` in `category`."""
    return client.patch(
        f"/api/transactions/{_tx(client, libelle)['id']}",
        json={"split_category_id": _category_id(client, category), "split_amount": amount},
    )


def _leaf_totals(tree: dict) -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}

    def walk(node):
        out[node["name"]] = (node["credit"], node["debit"])
        for child in node["children"]:
            walk(child)

    walk(tree)
    return out


def test_split_moves_the_part_and_keeps_the_totals(seeded_db, client):
    _upload(client)
    before = _leaf_totals(category_tree(seeded_db, "2026-06"))

    response = _split(client, "CARTE SUPERMARCHE", "bar", 20)

    assert response.status_code == 200
    body = response.json()
    assert body["split_category"] == "bar" and body["split_amount"] == 20
    assert body["category_manual"] is True and body["debit"] == 63.82  # the list shows the whole
    after = _leaf_totals(category_tree(seeded_db, "2026-06"))
    assert after["courses"][1] == before["courses"][1] - 20
    assert after["bar"][1] == before["bar"][1] + 20
    assert after["total"] == before["total"]  # Revenus - Depenses stays exact


def test_split_feeds_the_budget(seeded_db, client):
    _upload(client)
    client.put(f"/api/categories/{_category_id(client, 'bar')}/target", json={"budget_target": 50})
    _split(client, "CARTE SUPERMARCHE", "bar", 20)

    status = budget_status(seeded_db, "2026-06")
    spent = {leaf["name"]: leaf["actual"] for group in status["groups"] for leaf in group["leaves"]}
    assert spent["sortie / bar"] == 32.0  # 12 + the 20 split part


def test_split_refusals(seeded_db, client):
    _upload(client)
    mystery = _tx(client, "MYSTERY SHOP")
    bar = _category_id(client, "bar")

    def refused(tx_id, **body):
        response = client.patch(f"/api/transactions/{tx_id}", json=body)
        assert response.status_code == 422, body
        return response.json()["detail"]

    refused(mystery["id"], split_category_id=bar, split_amount=3)  # no 1st category
    tx = _tx(client, "CARTE SUPERMARCHE")
    refused(tx["id"], split_category_id=_category_id(client, "courses"), split_amount=3)  # same category
    refused(tx["id"], split_category_id=_category_id(client, "variable"), split_amount=3)  # a group
    refused(tx["id"], split_category_id=bar, split_amount=0)
    refused(tx["id"], split_category_id=bar, split_amount=63.82)
    refused(tx["id"], split_category_id=bar)  # no amount
    assert _tx(client, "CARTE SUPERMARCHE")["split_category_id"] is None

    pair = client.put(f"/api/transactions/{tx['id']}/transfer", json={"mode": "transfer"})
    assert pair.status_code == 200
    assert "virement" in refused(tx["id"], split_category_id=bar, split_amount=3)[0]


def test_changing_the_category_or_a_bulk_patch_drops_the_split(seeded_db, client):
    _upload(client)
    _split(client, "CARTE SUPERMARCHE", "bar", 20)
    tx_id = _tx(client, "CARTE SUPERMARCHE")["id"]

    client.patch(f"/api/transactions/{tx_id}", json={"category_id": _category_id(client, "courses")})
    assert _tx(client, "CARTE SUPERMARCHE")["split_category_id"] is None

    _split(client, "CARTE SUPERMARCHE", "bar", 20)
    client.patch("/api/transactions", json={"ids": [tx_id], "category_id": _category_id(client, "bar")})
    assert _tx(client, "CARTE SUPERMARCHE")["split_category_id"] is None

    _split(client, "CARTE SUPERMARCHE", "courses", 20)
    client.patch(f"/api/transactions/{tx_id}", json={"split_category_id": None})
    assert _tx(client, "CARTE SUPERMARCHE")["split_category_id"] is None


def test_clearing_the_category_of_a_split_row_drops_it_and_reruns_the_rules(seeded_db, client):
    _upload(client)
    _split(client, "CARTE SUPERMARCHE", "bar", 20)
    tx_id = _tx(client, "CARTE SUPERMARCHE")["id"]

    client.patch(f"/api/transactions/{tx_id}", json={"category_id": None})

    row = _tx(client, "CARTE SUPERMARCHE")
    assert row["split_category_id"] is None and row["category"] == "courses"  # the SUPERMARCHE rule again


def test_list_filter_and_export_use_the_part(seeded_db, client):
    _upload(client)
    _split(client, "CARTE SUPERMARCHE", "bar", 20)

    bar = _category_id(client, "bar")
    items = client.get("/api/transactions", params={"category_id": bar}).json()["items"]
    shown = {t["libelle"]: (t["debit"], t["total"]) for t in items}
    assert shown == {"BAR ANGELUS": (12.0, None), "CARTE SUPERMARCHE": (20.0, 63.82)}
    courses = client.get("/api/transactions", params={"category_id": _category_id(client, "courses")})
    assert [(t["debit"], t["total"]) for t in courses.json()["items"]] == [(43.82, 63.82)]

    export = client.get("/api/transactions/export").content.decode("utf-8-sig").splitlines()
    lines = [line for line in export if "CARTE SUPERMARCHE" in line]
    assert len(lines) == 2
    assert ";43,82;" in lines[0] and "variable / courses" in lines[0]
    assert ";20,00;" in lines[1] and "variable / sortie / bar" in lines[1]
    filtered = client.get("/api/transactions/export", params={"category_id": bar}).content.decode("utf-8-sig")
    assert filtered.count("CARTE SUPERMARCHE") == 1


def test_a_row_that_becomes_a_transfer_loses_its_split(seeded_db, client):
    _upload(client)
    _split(client, "CARTE SUPERMARCHE", "bar", 20)
    tx_id = _tx(client, "CARTE SUPERMARCHE")["id"]

    client.put(f"/api/transactions/{tx_id}/transfer", json={"mode": "transfer"})

    with connect(seeded_db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM transaction_splits").fetchone()[0] == 0


def test_deleting_categories_of_a_split(seeded_db, client):
    _upload(client)
    bar, courses = _category_id(client, "bar"), _category_id(client, "courses")
    sortie = _category_id(client, "sortie")

    _split(client, "CARTE SUPERMARCHE", "bar", 20)
    # bar is the last child of sortie: the 2nd part rolls up to sortie, which becomes a leaf again.
    assert client.delete(f"/api/categories/{bar}").status_code == 204
    assert _tx(client, "CARTE SUPERMARCHE")["split_category_id"] == sortie

    # With a sibling left, deleting the 2nd part's category leaves the operation whole.
    client.post("/api/categories", json={"name": "resto", "parent_id": sortie})
    resto = _category_id(client, "resto")
    client.post("/api/categories", json={"name": "cafe", "parent_id": sortie})
    _split(client, "CARTE SUPERMARCHE", "resto", 20)
    assert client.delete(f"/api/categories/{resto}").status_code == 204
    row = _tx(client, "CARTE SUPERMARCHE")
    assert row["split_category_id"] is None and row["category_id"] == courses

    _split(client, "CARTE SUPERMARCHE", "cafe", 20)
    assert client.delete(f"/api/categories/{courses}").status_code == 204  # the 1st part's
    with connect(seeded_db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM transaction_splits").fetchone()[0] == 0


def test_subdividing_a_leaf_moves_its_2nd_parts_down(seeded_db, client):
    _upload(client)
    _split(client, "CARTE SUPERMARCHE", "bar", 20)
    bar = _category_id(client, "bar")

    child = client.post("/api/categories", json={"name": "cocktails", "parent_id": bar}).json()

    row = _tx(client, "CARTE SUPERMARCHE")
    assert row["split_category_id"] == child["id"]


def test_moving_a_split_row_puts_it_whole_in_the_target(seeded_db, client):
    _upload(client)
    _split(client, "CARTE SUPERMARCHE", "bar", 20)
    tx_id = _tx(client, "CARTE SUPERMARCHE")["id"]

    moved = client.post(
        f"/api/categories/{_category_id(client, 'bar')}/move",
        json={"rule_ids": [], "transaction_ids": [tx_id]},
    )

    assert moved.status_code == 204
    row = _tx(client, "CARTE SUPERMARCHE")
    assert row["category"] == "bar" and row["split_category_id"] is None


def test_split_overrides_round_trip(seeded_db, client, tmp_path):
    _upload(client)
    _split(client, "CARTE SUPERMARCHE", "bar", 20)
    cfg = _export(seeded_db, tmp_path)
    assert "variable / sortie / bar;2000" in (cfg / "overrides.csv").read_text(encoding="utf-8-sig")

    fresh = make_db(tmp_path / "fresh.db")
    with TestClient(create_app(fresh)) as fresh_client:
        _upload(fresh_client)
        import_csv(cfg / "categories.csv", cfg / "rules.csv", fresh, cfg / "overrides.csv")
        row = _tx(fresh_client, "CARTE SUPERMARCHE")
    assert row["category"] == "courses" and row["split_category"] == "bar" and row["split_amount"] == 20
