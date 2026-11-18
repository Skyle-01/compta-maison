from fastapi import APIRouter, HTTPException

from app.api.deps import AccountFilter, DbPath
from app.core.recurrences import Recurrence as FoundRecurrence
from app.core.recurrences import recurrences
from app.db import connect, euros
from app.schemas import Recurrence, RecurrenceOperation, Recurrences, RecurrenceStatus

router = APIRouter(prefix="/api/recurrences", tags=["recurrences"])


def _status(flag: dict) -> RecurrenceStatus:
    if flag["kind"] != "price_change":
        return RecurrenceStatus(kind=flag["kind"])
    return RecurrenceStatus(
        kind="price_change",
        old_amount=euros(flag["old_cents"]),
        new_amount=euros(flag["new_cents"]),
        since=flag["since"],
    )


def _to_model(found: FoundRecurrence) -> Recurrence:
    return Recurrence(
        **{
            k: v
            for k, v in vars(found).items()
            if k not in ("typical_cents", "last_cents", "status", "last_operations")
        },
        typical_amount=euros(found.typical_cents),
        last_amount=euros(found.last_cents),
        status=[_status(flag) for flag in found.status],
        last_operations=[
            RecurrenceOperation(id=o["id"], date=o["date"], amount=euros(o["amount_cents"]))
            for o in found.last_operations
        ],
    )


@router.get("")
def list_recurrences(db_path: DbPath, account: AccountFilter = None) -> Recurrences:
    """The monthly recurring flows (salary, rent, subscriptions, bills) with what looks wrong
    (missing, ended, price change, doubled), computed on demand from every operation. The two totals
    count the fixed flows that have not ended, what leaves or enters the budget by itself."""
    if account is not None:
        with connect(db_path) as conn:
            if not conn.execute("SELECT 1 FROM accounts WHERE code = ?", (account,)).fetchone():
                raise HTTPException(422, detail=[f"Compte {account} introuvable"])
    found = recurrences(db_path, account)
    counted = [r for r in found if r.amount_kind == "fixed" and r.next_expected is not None]

    def total(side: str) -> float:
        return round(euros(sum(r.typical_cents for r in counted if r.side == side)), 2)

    return Recurrences(
        items=[_to_model(r) for r in found],
        monthly_expenses=total("debit"),
        monthly_income=total("credit"),
    )
