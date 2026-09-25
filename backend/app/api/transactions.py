import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.api.categories import category_paths, csv_response, reject_group_target
from app.api.deps import get_db_path
from app.core.categorize import apply_rules
from app.core.transfers import pair_manually, set_transfer_mode
from app.db import connect, euros, real_flow_clause
from app.schemas import (
    Transaction,
    TransactionPage,
    TransactionPatch,
    TransferModeIn,
    TransferPairIn,
)

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

_SELECT = (
    "SELECT t.id, t.date_operation, t.date_valeur, t.budget_month, t.libelle, "
    "t.debit_cents, t.credit_cents, t.account, t.account_id, t.kind, t.category_id, c.name, "
    "t.category_manual, t.note, t.rule_id, lr.pattern, t.transfer_group_id, t.kind_manual "
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
        transfer_group_id=row[16],
        kind_manual=bool(row[17]),
    )


OVERRIDES_HEADER = [
    "import_hash",
    "category_path",
    "kind",
    "libelle",
    "note",
    "transfer_pair",
    "account_id",
    "date_operation",
    "debit_cents",
    "credit_cents",
]


def override_rows(conn: sqlite3.Connection, path_by_id: dict[int, str]) -> list[list]:
    """Every manual category/kind/note override as overrides.csv rows (shared by the Settings
    export and reset_db.py's snapshot). Keyed by the stable import_hash; `transfer_pair` holds the
    partner leg's import_hash for a manual transfer pair, so the pair is re-linked on restore.
    The trailing identity columns (account, date, libellé, amounts) let a restore find a row whose
    hash changed, e.g. one uploaded under the account code and rebuilt under the filename alias."""
    rows = conn.execute(
        "SELECT t.import_hash, t.category_id, t.category_manual, t.kind, t.kind_manual, t.libelle, "
        "t.note, p.import_hash, t.account_id, t.date_operation, t.debit_cents, t.credit_cents "
        "FROM transactions t "
        "LEFT JOIN transactions p ON t.kind_manual = 1 AND p.kind_manual = 1 "
        "AND p.transfer_group_id = t.transfer_group_id AND p.id != t.id "
        "WHERE t.category_manual = 1 OR t.kind_manual = 1 ORDER BY t.date_valeur, t.id"
    ).fetchall()
    return [
        [
            import_hash,
            path_by_id.get(category_id, "") if category_manual and category_id else "",
            kind if kind_manual else "",
            libelle,
            note or "",
            partner_hash or "",
            account_id or "",
            date_operation,
            debit_cents,
            credit_cents,
        ]
        for (
            import_hash,
            category_id,
            category_manual,
            kind,
            kind_manual,
            libelle,
            note,
            partner_hash,
            account_id,
            date_operation,
            debit_cents,
            credit_cents,
        ) in rows
    ]


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
    """Download every manual override, keyed by the stable import_hash so it survives a
    delete-and-rebuild (re-importable via scripts/import_csv.py --overrides)."""
    with connect(db_path) as conn:
        rows = override_rows(conn, category_paths(conn))
    return csv_response(rows, OVERRIDES_HEADER, "overrides.csv")


def _load(db_path: Path, ids: list[int]) -> list[Transaction]:
    with connect(db_path) as conn:
        rows = conn.execute(
            f"{_SELECT} WHERE t.id IN ({','.join('?' * len(ids))}) ORDER BY t.date_valeur, t.id", ids
        ).fetchall()
    return [_to_model(r) for r in rows]


@router.post("/transfer-pair", response_model=list[Transaction])
def pair_transfer(pair: TransferPairIn, db_path: Path = Depends(get_db_path)) -> list[Transaction]:
    """Force two operations (one debit, one credit, same amount, two accounts) into a transfer."""
    a_id, b_id = pair.transaction_ids
    try:
        pair_manually(db_path, a_id, b_id)
    except LookupError as exc:
        raise HTTPException(404, detail=[str(exc)]) from exc
    except ValueError as exc:
        raise HTTPException(422, detail=[str(exc)]) from exc
    return _load(db_path, [a_id, b_id])


@router.put("/{transaction_id}/transfer", response_model=list[Transaction])
def set_transfer(
    transaction_id: int, body: TransferModeIn, db_path: Path = Depends(get_db_path)
) -> list[Transaction]:
    """Manual transfer decision on one row (and its partner): transfer / none (unpair) / auto."""
    try:
        touched = set_transfer_mode(db_path, transaction_id, body.mode)
    except LookupError as exc:
        raise HTTPException(404, detail=[str(exc)]) from exc
    return _load(db_path, touched)


@router.patch("/{transaction_id}", response_model=Transaction)
def patch_transaction(
    transaction_id: int,
    patch: TransactionPatch,
    db_path: Path = Depends(get_db_path),
) -> Transaction:
    # Only the fields the caller actually sent are applied (model_fields_set distinguishes an omitted
    # field from one explicitly set to null) — so a caller can set the category, the note, or both.
    fields = patch.model_fields_set
    with connect(db_path) as conn:
        if conn.execute("SELECT 1 FROM transactions WHERE id = ?", (transaction_id,)).fetchone() is None:
            raise HTTPException(404, detail=[f"No transaction with id {transaction_id}"])
        if "category_id" in fields:
            if patch.category_id is not None:
                known = conn.execute("SELECT 1 FROM categories WHERE id = ?", (patch.category_id,)).fetchone()
                if not known:
                    raise HTTPException(422, detail=[f"Unknown category id: {patch.category_id}"])
                reject_group_target(conn, patch.category_id)
            conn.execute(
                "UPDATE transactions SET category_id = ?, category_manual = ?, rule_id = NULL WHERE id = ?",
                (patch.category_id, int(patch.category_id is not None), transaction_id),
            )
        if "note" in fields:
            conn.execute("UPDATE transactions SET note = ? WHERE id = ?", (patch.note, transaction_id))

    if "category_id" in fields and patch.category_id is None:
        apply_rules(db_path)  # cleared override: let the rules engine reclaim the row
    with connect(db_path) as conn:
        row = conn.execute(f"{_SELECT} WHERE t.id = ?", (transaction_id,)).fetchone()
    return _to_model(row)
