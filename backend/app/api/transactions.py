import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response

from app.api.categories import category_paths, csv_response, reject_group_target
from app.api.deps import DbPath
from app.core.categorize import apply_rules
from app.core.transfers import pair_manually, set_transfer_mode, transfer_candidates
from app.core.triage import uncategorized_groups
from app.db import connect, euros, real_flow_clause
from app.schemas import (
    CategorySuggestion,
    Transaction,
    TransactionPage,
    TransactionPatch,
    TransactionsBulkPatch,
    TransferCandidate,
    TransferModeIn,
    TransferPairIn,
    UncategorizedGroup,
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


def _filter_clause(
    month: str | None,
    account: str | None,
    category_id: int | None,
    libelle_contains: str | None,
    uncategorized: bool,
    manual: bool,
    manual_transfer: bool,
    deposit_pattern: str | None = None,
) -> tuple[str, list]:
    """The WHERE clause (over `transactions t`) and params shared by the list and the export."""
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
    if deposit_pattern:
        # An external savings account's deposits: the same case-insensitive test as
        # recompute_transfers and the derived Épargne leaves (the dashboard drill-down).
        where.append("instr(casefold(t.libelle), casefold(?)) > 0")
        params.append(deposit_pattern)
    if uncategorized:
        # Transfers (incl. single-legged savings deposits) have no spending category by design.
        where.append(f"t.category_id IS NULL AND {real_flow_clause('t.kind')}")
    if manual:
        where.append("t.category_manual = 1")
    if manual_transfer:
        # Manual transfer decisions; both legs of a manual pair are flagged, so the caller can
        # rebuild the pair from transfer_group_id.
        where.append("t.kind_manual = 1")
    return " AND ".join(where), params


@router.get("")
def list_transactions(
    db_path: DbPath,
    month: str | None = None,
    account: str | None = None,
    category_id: int | None = None,
    libelle_contains: str | None = None,
    uncategorized: bool = False,
    manual: bool = False,
    manual_transfer: bool = False,
    deposit_pattern: str | None = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> TransactionPage:
    clause, params = _filter_clause(
        month, account, category_id, libelle_contains, uncategorized, manual, manual_transfer, deposit_pattern
    )
    with connect(db_path) as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM transactions t WHERE {clause}", params).fetchone()[0]
        rows = conn.execute(
            f"{_SELECT} WHERE {clause} ORDER BY t.date_valeur DESC, t.id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return TransactionPage(items=[_to_model(r) for r in rows], total=total)


@router.get("/uncategorized-groups")
def list_uncategorized_groups(db_path: DbPath, month: str | None = None) -> list[UncategorizedGroup]:
    """Uncategorised operations grouped by similar label, largest total first, each with a default
    rule pattern, a category suggestion and the operations that could pair with them as a transfer
    (the « À classer » page)."""
    groups = uncategorized_groups(db_path, month)
    ids = [i for g in groups for i in g.transaction_ids]
    candidates = transfer_candidates(db_path, ids)
    partner_ids = {p for partners in candidates.values() for p in partners}
    by_id = {t.id: t for t in _load(db_path, [*ids, *partner_ids])}
    return [
        UncategorizedGroup(
            key=g.key,
            pattern=g.pattern,
            pattern_generic=g.pattern_generic,
            count=len(g.transaction_ids),
            debit=euros(g.debit_cents),
            credit=euros(g.credit_cents),
            first_date=g.first_date,
            last_date=g.last_date,
            accounts=g.accounts,
            transactions=[by_id[i] for i in g.transaction_ids],
            suggestion=CategorySuggestion(**vars(g.suggestion)) if g.suggestion else None,
            transfer_candidates=[
                TransferCandidate(transaction_id=i, partner=by_id[p])
                for i in g.transaction_ids
                for p in candidates.get(i, [])
            ],
        )
        for g in groups
    ]


# The spreadsheet export is for a person opening it in Excel (French locale), unlike the
# import_csv.py-shaped Settings exports: French headers, dd/mm/yyyy dates, comma decimals.
EXPORT_HEADER = [
    "Date opération",
    "Date valeur",
    "Mois budgétaire",
    "Compte",
    "Libellé",
    "Débit",
    "Crédit",
    "Type",
    "Catégorie",
    "Note",
]
_KIND_LABELS = {"income": "revenu", "expense": "dépense", "transfer": "virement"}


def _french_date(iso: str) -> str:
    year, month, day = iso.split("-")
    return f"{day}/{month}/{year}"


def _french_amount(cents: int) -> str:
    return f"{cents / 100:.2f}".replace(".", ",") if cents else ""


@router.get("/export")
def export_transactions(
    db_path: DbPath,
    month: str | None = None,
    account: str | None = None,
    category_id: int | None = None,
    libelle_contains: str | None = None,
    uncategorized: bool = False,
) -> Response:
    """Download the transactions matching the list filters (no pagination), oldest first."""
    clause, params = _filter_clause(
        month, account, category_id, libelle_contains, uncategorized, manual=False, manual_transfer=False
    )
    with connect(db_path) as conn:
        paths = category_paths(conn)
        rows = conn.execute(
            "SELECT t.date_operation, t.date_valeur, t.budget_month, t.account_id, t.libelle, "
            "t.debit_cents, t.credit_cents, t.kind, t.category_id, t.note "
            f"FROM transactions t WHERE {clause} ORDER BY t.date_valeur, t.id",
            params,
        ).fetchall()
    out = [
        [
            _french_date(date_operation),
            _french_date(date_valeur),
            budget_month,
            account_id or "",
            libelle,
            _french_amount(debit_cents),
            _french_amount(credit_cents),
            _KIND_LABELS.get(kind, kind),
            paths.get(category_id, "") if category_id else "",
            note or "",
        ]
        for (
            date_operation,
            date_valeur,
            budget_month,
            account_id,
            libelle,
            debit_cents,
            credit_cents,
            kind,
            category_id,
            note,
        ) in rows
    ]
    return csv_response(out, EXPORT_HEADER, f"transactions_{month or 'tout'}.csv")


@router.get("/export-overrides")
def export_overrides(db_path: DbPath) -> Response:
    """Download every manual override, keyed by the stable import_hash so it survives a
    delete-and-rebuild (restored by reset_db.py from an overrides.csv next to the taxonomy)."""
    with connect(db_path) as conn:
        rows = override_rows(conn, category_paths(conn))
    return csv_response(rows, OVERRIDES_HEADER, "overrides.csv")


def _load(db_path: Path, ids: list[int]) -> list[Transaction]:
    if not ids:
        return []
    with connect(db_path) as conn:
        rows = conn.execute(
            f"{_SELECT} WHERE t.id IN ({','.join('?' * len(ids))}) ORDER BY t.date_valeur, t.id", ids
        ).fetchall()
    return [_to_model(r) for r in rows]


@router.post("/transfer-pair")
def pair_transfer(pair: TransferPairIn, db_path: DbPath) -> list[Transaction]:
    """Force two operations (one debit, one credit, same amount, two accounts) into a transfer."""
    a_id, b_id = pair.transaction_ids
    try:
        pair_manually(db_path, a_id, b_id)
    except LookupError as exc:
        raise HTTPException(404, detail=[str(exc)]) from exc
    except ValueError as exc:
        raise HTTPException(422, detail=[str(exc)]) from exc
    return _load(db_path, [a_id, b_id])


@router.put("/{transaction_id}/transfer")
def set_transfer(transaction_id: int, body: TransferModeIn, db_path: DbPath) -> list[Transaction]:
    """Manual transfer decision on one row (and its partner): transfer / none (unpair) / auto."""
    try:
        touched = set_transfer_mode(db_path, transaction_id, body.mode)
    except LookupError as exc:
        raise HTTPException(404, detail=[str(exc)]) from exc
    return _load(db_path, touched)


def _check_leaf(conn: sqlite3.Connection, category_id: int) -> None:
    """422 unless `category_id` is an existing leaf category (manual assignment target)."""
    if conn.execute("SELECT 1 FROM categories WHERE id = ?", (category_id,)).fetchone() is None:
        raise HTTPException(422, detail=[f"Catégorie {category_id} introuvable"])
    reject_group_target(conn, category_id)


@router.patch("")
def patch_transactions(patch: TransactionsBulkPatch, db_path: DbPath) -> list[Transaction]:
    """Set (or clear) the manual category and note of several operations at once: a whole group
    on the « À classer » page, and its undo. Clearing re-runs the rules, as for a single row."""
    ids = sorted(set(patch.ids))
    marks = ",".join("?" * len(ids))
    with connect(db_path) as conn:
        found = {row[0] for row in conn.execute(f"SELECT id FROM transactions WHERE id IN ({marks})", ids)}
        if missing := [i for i in ids if i not in found]:
            raise HTTPException(404, detail=[f"Opérations introuvables : {', '.join(map(str, missing))}"])
        if patch.category_id is not None:
            _check_leaf(conn, patch.category_id)
        conn.execute(
            f"UPDATE transactions SET category_id = ?, category_manual = ?, rule_id = NULL, note = ? "
            f"WHERE id IN ({marks})",
            (patch.category_id, int(patch.category_id is not None), patch.note, *ids),
        )
    if patch.category_id is None:
        apply_rules(db_path)
    return _load(db_path, ids)


@router.patch("/{transaction_id}")
def patch_transaction(
    transaction_id: int,
    patch: TransactionPatch,
    db_path: DbPath,
) -> Transaction:
    # Only the fields the caller actually sent are applied (model_fields_set distinguishes an omitted
    # field from one explicitly set to null) — so a caller can set the category, the note, or both.
    fields = patch.model_fields_set
    with connect(db_path) as conn:
        if conn.execute("SELECT 1 FROM transactions WHERE id = ?", (transaction_id,)).fetchone() is None:
            raise HTTPException(404, detail=[f"Opération {transaction_id} introuvable"])
        if "category_id" in fields:
            if patch.category_id is not None:
                _check_leaf(conn, patch.category_id)
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
