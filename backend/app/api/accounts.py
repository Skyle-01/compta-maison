from fastapi import APIRouter

from app.api.deps import DbPath
from app.db import connect
from app.schemas import Account

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("")
def list_accounts(db_path: DbPath) -> list[Account]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT code, label, type, sort_order FROM accounts ORDER BY sort_order, code"
        ).fetchall()
    return [
        Account(code=code, label=label, type=type_, sort_order=sort_order)
        for code, label, type_, sort_order in rows
    ]
