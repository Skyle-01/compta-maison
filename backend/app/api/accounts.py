from pathlib import Path

from fastapi import APIRouter, Depends

from app.api.deps import get_db_path
from app.db import connect
from app.schemas import Account

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=list[Account])
def list_accounts(db_path: Path = Depends(get_db_path)) -> list[Account]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT code, label, type, sort_order FROM accounts ORDER BY sort_order, code"
        ).fetchall()
    return [
        Account(code=code, label=label, type=type_, sort_order=sort_order)
        for code, label, type_, sort_order in rows
    ]
