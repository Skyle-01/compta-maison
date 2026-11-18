from pathlib import Path

from app.core.categorize import apply_rules_in
from app.core.periods import recompute_budget_months_in
from app.core.transfers import recompute_transfers_in
from app.db import connect


def recompute_all(db_path: Path) -> int:
    """Re-derive everything computed from the transactions after an import or a rebuild: budget
    months, transfers, then rule categories. The three steps share one transaction: a failure in
    any of them rolls the others back, so no half-applied state is ever visible (rows committed
    earlier by the caller, e.g. the import, stay). Returns the number of transfer legs flagged."""
    with connect(db_path) as conn:
        recompute_budget_months_in(conn)
        n_transfer_legs = recompute_transfers_in(conn)
        apply_rules_in(conn)
    return n_transfer_legs
