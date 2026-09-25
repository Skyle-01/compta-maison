from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.api.categories import category_paths, csv_response, reject_group_target
from app.api.deps import get_db_path
from app.core.categorize import apply_rules
from app.db import (
    connect,
    euros,
    real_flow_clause,
    set_transaction_category,
    set_transaction_note,
)
from app.schemas import (
    Transaction,
    TransactionPage,
    TransactionPatch,
)

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

_SELECT = (
    "SELECT t.id, t.date_operation, t.date_valeur, t.budget_month, t.libelle, "
    "t.debit_cents, t.credit_cents, t.account, t.account_id, t.kind, t.category_id, c.name, "
    "t.category_manual, t.note, t.rule_id, lr.pattern "
    "FROM transactions t LEFT JOIN categories c ON c.id = t.category_id "
    "LEFT JOIN label_rules lr ON lr.id = t.rule_id"
)


def _to_model(row: tuple) -> Transaction:
    return Transaction(
        id=row[0],
        date_operation=row[1],
        date_valeur=row[2],
        budget_month=row[3],
        libelle=row[4],
        debit=euros(row[5]),
        credit=euros(row[6]),
        account=row[7],
        account_id=row[8],
        kind=row[9],
        category_id=row[10],
        category=row[11],
        category_manual=bool(row[12]),
        note=row[13],
        rule_id=row[14],
        rule_pattern=row[15],
    )


@router.get("", response_model=TransactionPage)
def list_transactions(
    month: str | None = None,
    account: str | None = None,
    category_id: int | None = None,
    libelle_contains: str | None = None,
    uncategorized: bool = False,
    manual: bool = False,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db_path: Path = Depends(get_db_path),
) -> TransactionPage:
    where = ["1=1"]
    params: list = []
    if month:
        where.append("t.budget_month = ?")
        params.append(month)
    if account:
        where.append("t.account_id = ?")
        params.append(account)
    if category_id is not None:
        where.append("t.category_id = ?")
        params.append(category_id)
    if libelle_contains:
        # Case-sensitive substring, mirroring the rule engine's instr() (core/categorize.py).
        where.append("instr(t.libelle, ?) > 0")
        params.append(libelle_contains)
    if uncategorized:
        # Transfers (incl. single-legged savings deposits) have no spending category by design.
        where.append(f"t.category_id IS NULL AND {real_flow_clause('t.kind')}")
    if manual:
        where.append("t.category_manual = 1")
    clause = " AND ".join(where)

    with connect(db_path) as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM transactions t WHERE {clause}", params).fetchone()[0]
        rows = conn.execute(
            f"{_SELECT} WHERE {clause} ORDER BY t.date_valeur DESC, t.id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return TransactionPage(items=[_to_model(r) for r in rows], total=total)


@router.get("/export-overrides")
def export_overrides(db_path: Path = Depends(get_db_path)) -> Response:
    """Download every manual category/kind override, keyed by the stable import_hash so it
    survives a delete-and-reseed (re-importable via scripts/import_csv.py --overrides)."""
    with connect(db_path) as conn:
        paths = category_paths(conn)
        rows = conn.execute(
            "SELECT import_hash, category_id, category_manual, kind, kind_manual, libelle, note "
            "FROM transactions WHERE category_manual = 1 OR kind_manual = 1 ORDER BY date_valeur, id"
        ).fetchall()
    out = [
        [
            import_hash,
            paths.get(category_id, "") if category_manual and category_id else "",
            kind if kind_manual else "",
            libelle,
            note or "",
        ]
        for import_hash, category_id, category_manual, kind, kind_manual, libelle, note in rows
    ]
    header = ["import_hash", "category_path", "kind", "libelle", "note"]
    return csv_response(out, header, "overrides.csv")


@router.patch("/{transaction_id}", response_model=Transaction)
def patch_transaction(
    transaction_id: int,
    patch: TransactionPatch,
    db_path: Path = Depends(get_db_path),
) -> Transaction:
    # Only the fields the caller actually sent are applied (model_fields_set distinguishes an omitted
    # field from one explicitly set to null) — so a caller can set the category, the note, or both.
    fields = patch.model_fields_set

    if "category_id" in fields:
        if patch.category_id is not None:
            with connect(db_path) as conn:
                known = conn.execute("SELECT 1 FROM categories WHERE id = ?", (patch.category_id,)).fetchone()
                if not known:
                    raise HTTPException(422, detail=[f"Unknown category id: {patch.category_id}"])
                reject_group_target(conn, patch.category_id)
        if not set_transaction_category(transaction_id, patch.category_id, db_path):
            raise HTTPException(404, detail=[f"No transaction with id {transaction_id}"])
        if patch.category_id is None:
            # Cleared override: let the rules engine reclaim the row.
            apply_rules(db_path)

    if "note" in fields:
        if not set_transaction_note(transaction_id, patch.note, db_path):
            raise HTTPException(404, detail=[f"No transaction with id {transaction_id}"])

    with connect(db_path) as conn:
        row = conn.execute(f"{_SELECT} WHERE t.id = ?", (transaction_id,)).fetchone()
    if row is None:
        raise HTTPException(404, detail=[f"No transaction with id {transaction_id}"])
    return _to_model(row)
