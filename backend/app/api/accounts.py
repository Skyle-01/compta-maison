import sqlite3

from fastapi import APIRouter, HTTPException

from app.api.deps import DbPath
from app.core.recompute import recompute_all
from app.db import (
    ACCOUNT_TYPES,
    account_aliases_by_code,
    account_names,
    claim_names,
    connect,
    set_account_start_date,
    upsert_accounts,
)
from app.schemas import Account, AccountIn

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def _accounts(conn: sqlite3.Connection) -> list[Account]:
    aliases = account_aliases_by_code(conn)
    rows = conn.execute(
        "SELECT code, label, type, sort_order, deposit_pattern, start_date FROM accounts "
        "ORDER BY sort_order, code"
    ).fetchall()
    return [
        Account(
            code=code,
            label=label,
            type=type_,
            sort_order=sort_order,
            deposit_pattern=pattern,
            aliases=aliases.get(code, []),
            start_date=start,
        )
        for code, label, type_, sort_order, pattern, start in rows
    ]


@router.get("")
def list_accounts(db_path: DbPath) -> list[Account]:
    with connect(db_path) as conn:
        return _accounts(conn)


@router.put("/{code}")
def save_account(code: str, body: AccountIn, db_path: DbPath) -> Account:
    """Create the account, or update its label, aliases, deposit pattern and start date (its code and
    type never change). Aliases and the deposit pattern decide which operations are transfers:
    re-derive them. A moved start date only applies to later imports (rows already in stay)."""
    code = code.strip().upper()
    label = body.label.strip()
    pattern = (body.deposit_pattern or "").strip() or None
    if not code or not label:
        raise HTTPException(status_code=422, detail="Le code et le libellé du compte sont obligatoires")
    if body.type not in ACCOUNT_TYPES:
        raise HTTPException(status_code=422, detail="Type : « checking » ou « savings » attendu")
    if pattern and body.type != "savings":
        raise HTTPException(
            status_code=422, detail="Le motif de dépôt est réservé aux comptes d'épargne externes"
        )
    aliases = [a for a in body.aliases if a.strip()]

    with connect(db_path) as conn:
        existing = conn.execute("SELECT type, sort_order FROM accounts WHERE code = ?", (code,)).fetchone()
        if existing and existing[0] != body.type:
            raise HTTPException(
                status_code=422, detail="Le type d'un compte ne peut pas changer après sa création"
            )
        owner = {name: other for name, other in account_names(conn) if other != code}
        clash = claim_names(owner, code, [code, label, *aliases])
        if clash:
            raise HTTPException(status_code=422, detail=f"« {clash[0]} » désigne déjà le compte {clash[1]}")
        if existing:
            sort_order = existing[1]
        else:
            sort_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM accounts").fetchone()[0]
        # The code is always one of its own aliases; the label is not stored as one.
        names = dict.fromkeys(
            [code, *(a.strip().upper() for a in aliases if a.strip().upper() != label.upper())]
        )
        conn.execute("DELETE FROM account_aliases WHERE code = ?", (code,))
        upsert_accounts(
            conn, [(code, label, body.type, sort_order, pattern)], [(name, code) for name in names]
        )
        set_account_start_date(conn, code, body.start_date)
    recompute_all(db_path)
    with connect(db_path) as conn:
        return next(account for account in _accounts(conn) if account.code == code)
