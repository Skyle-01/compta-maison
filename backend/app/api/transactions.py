import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response

from app.api.categories import csv_response, reject_group_target
from app.api.deps import AccountFilter, DbPath
from app.core.categorize import apply_rules
from app.core.config_export import category_paths
from app.core.transfers import pair_manually, set_transfer_mode, transfer_candidates
from app.core.triage import conflicted_operations, uncategorized_groups
from app.db import connect, euros, real_flow_clause, to_cents
from app.schemas import (
    CategorySuggestion,
    ConflictedOperation,
    ConflictRule,
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
    "t.category_manual, t.note, t.rule_id, lr.pattern, t.transfer_group_id, t.kind_manual, "
    "s.category_id, sc.name, s.amount_cents "
    "FROM transactions t LEFT JOIN categories c ON c.id = t.category_id "
    "LEFT JOIN label_rules lr ON lr.id = t.rule_id "
    "LEFT JOIN transaction_splits s ON s.transaction_id = t.id "
    "LEFT JOIN categories sc ON sc.id = s.category_id"
)


def _parts(
    category_id: int | None, debit: int, credit: int, split_category: int | None, split_cents: int | None
) -> list[tuple[int | None, int, int]]:
    """(category, debit, credit) of each part of an operation, in cents: the 1st part keeps what
    the 2nd one (taken off the debit, or the credit of a credit) leaves."""
    if split_category is None or split_cents is None:
        return [(category_id, debit, credit)]
    if debit > 0:
        return [(category_id, debit - split_cents, 0), (split_category, split_cents, 0)]
    return [(category_id, 0, credit - split_cents), (split_category, 0, split_cents)]


def _to_model(row: tuple, part_category: int | None = None) -> Transaction:
    """`part_category` (the list's category filter) makes a split operation show that part's amount
    instead of the whole, `total` then carrying the whole."""
    debit, credit, total = row[5], row[6], None
    if row[20] is not None and part_category is not None:
        (_, debit, credit) = next(
            p for p in _parts(row[10], row[5], row[6], row[18], row[20]) if p[0] == part_category
        )
        total = euros(max(row[5], row[6]))
    return Transaction(
        id=row[0],
        date_operation=row[1],
        date_valeur=row[2],
        budget_month=row[3],
        libelle=row[4],
        debit=euros(debit),
        credit=euros(credit),
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
        split_category_id=row[18],
        split_category=row[19],
        split_amount=euros(row[20]) if row[20] is not None else None,
        total=total,
    )


def _filter_clause(
    month: str | None,
    account: str | None,
    category_id: int | None,
    libelle_contains: str | None,
    uncategorized: bool,
    manual: bool,
    manual_transfer: bool,
    deposit_pattern: str | None = None,
    rule_id: int | None = None,
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
        # Either part of a split operation matches (the list then shows that part's amount).
        where.append("t.id IN (SELECT transaction_id FROM transaction_parts WHERE category_id = ?)")
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
    if rule_id is not None:
        where.append("t.rule_id = ?")
        params.append(rule_id)
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
    account: AccountFilter = None,
    category_id: int | None = None,
    libelle_contains: str | None = None,
    uncategorized: bool = False,
    manual: bool = False,
    manual_transfer: bool = False,
    deposit_pattern: str | None = None,
    rule_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> TransactionPage:
    clause, params = _filter_clause(
        month,
        account,
        category_id,
        libelle_contains,
        uncategorized,
        manual,
        manual_transfer,
        deposit_pattern,
        rule_id,
    )
    with connect(db_path) as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM transactions t WHERE {clause}", params).fetchone()[0]
        rows = conn.execute(
            f"{_SELECT} WHERE {clause} ORDER BY t.date_valeur DESC, t.id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return TransactionPage(items=[_to_model(r, category_id) for r in rows], total=total)


@router.get("/uncategorized-groups")
def list_uncategorized_groups(
    db_path: DbPath, month: str | None = None, account: AccountFilter = None
) -> list[UncategorizedGroup]:
    """Uncategorised operations (of one account when `account` is set) grouped by similar label,
    largest total first, each with a default rule pattern, a category suggestion and the operations
    that could pair with them as a transfer, whatever their account (the « À classer » page)."""
    groups = uncategorized_groups(db_path, month, account)
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


@router.get("/rule-conflicts")
def list_rule_conflicts(
    db_path: DbPath, month: str | None = None, account: AccountFilter = None
) -> list[ConflictedOperation]:
    """Operations matched by rules of different categories, left uncategorised, with the rules in
    cause (the « Conflit de règles » group of « À classer »)."""
    found = conflicted_operations(db_path, month, account)
    by_id = {t.id: t for t in _load(db_path, [i for i, _ in found])}
    return [
        ConflictedOperation(
            transaction=by_id[i],
            rules=[ConflictRule(rule_id=r, pattern=p, category_id=c) for r, p, c in rules],
        )
        for i, rules in found
    ]


# The spreadsheet export is for a person opening it in Excel (French locale), unlike the
# import_csv.py-shaped Catégories page exports: French headers, dd/mm/yyyy dates, comma decimals.
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
    account: AccountFilter = None,
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
            "t.debit_cents, t.credit_cents, t.kind, t.category_id, t.note, s.category_id, s.amount_cents "
            "FROM transactions t LEFT JOIN transaction_splits s ON s.transaction_id = t.id "
            f"WHERE {clause} ORDER BY t.date_valeur, t.id",
            params,
        ).fetchall()
    # One line per part of a split operation; under a category filter only the matching part.
    out = [
        [
            _french_date(date_operation),
            _french_date(date_valeur),
            budget_month,
            account_id or "",
            libelle,
            _french_amount(part_debit),
            _french_amount(part_credit),
            _KIND_LABELS.get(kind, kind),
            paths.get(part_category, "") if part_category else "",
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
            category_id_1,
            note,
            split_category,
            split_cents,
        ) in rows
        for part_category, part_debit, part_credit in _parts(
            category_id_1, debit_cents, credit_cents, split_category, split_cents
        )
        if category_id is None or part_category == category_id
    ]
    return csv_response(out, EXPORT_HEADER, f"transactions_{month or 'tout'}.csv")


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


def _set_split(conn: sqlite3.Connection, transaction_id: int, category_id: int, amount: float | None) -> None:
    """Give an operation a 2nd part (leaf `category_id`, `amount` euros), its 1st part keeping the
    rest. Manual by nature, like any hand assignment. 422 unless the operation is a real flow with
    a 1st category and the amount is strictly between 0 and the operation's."""
    first_category, kind, debit, credit = conn.execute(
        "SELECT category_id, kind, debit_cents, credit_cents FROM transactions WHERE id = ?",
        (transaction_id,),
    ).fetchone()
    if kind == "transfer":
        raise HTTPException(422, detail=["Un virement ne se scinde pas : il n'a pas de catégorie"])
    if first_category is None:
        raise HTTPException(422, detail=["Choisissez d'abord la catégorie de l'opération, puis scindez-la"])
    if amount is None:
        raise HTTPException(422, detail=["Indiquez le montant de la deuxième part"])
    _check_leaf(conn, category_id)
    if category_id == first_category:
        raise HTTPException(422, detail=["Les deux parts doivent avoir des catégories différentes"])
    cents, total = to_cents(amount), max(debit, credit)
    if not 0 < cents < total:
        raise HTTPException(
            422,
            detail=[f"La deuxième part doit être comprise entre 0 et {total / 100:.2f} €".replace(".", ",")],
        )
    conn.execute(
        "INSERT OR REPLACE INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, ?)",
        (transaction_id, category_id, cents),
    )
    conn.execute(
        "UPDATE transactions SET category_manual = 1, rule_id = NULL WHERE id = ?", (transaction_id,)
    )


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
        # A bulk assignment sets one category and clears any split.
        conn.execute(f"DELETE FROM transaction_splits WHERE transaction_id IN ({marks})", ids)
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
            # The 1st category changes (or clears): any split is dropped, a new one can come with it.
            conn.execute("DELETE FROM transaction_splits WHERE transaction_id = ?", (transaction_id,))
            conn.execute(
                "UPDATE transactions SET category_id = ?, category_manual = ?, rule_id = NULL WHERE id = ?",
                (patch.category_id, int(patch.category_id is not None), transaction_id),
            )
        if "split_category_id" in fields:
            if patch.split_category_id is None:
                conn.execute("DELETE FROM transaction_splits WHERE transaction_id = ?", (transaction_id,))
            else:
                _set_split(conn, transaction_id, patch.split_category_id, patch.split_amount)
        if "note" in fields:
            conn.execute("UPDATE transactions SET note = ? WHERE id = ?", (patch.note, transaction_id))

    if "category_id" in fields and patch.category_id is None:
        apply_rules(db_path)  # cleared override: let the rules engine reclaim the row
    with connect(db_path) as conn:
        row = conn.execute(f"{_SELECT} WHERE t.id = ?", (transaction_id,)).fetchone()
    return _to_model(row)
