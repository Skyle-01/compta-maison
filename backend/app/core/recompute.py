from pathlib import Path

from app.core.categorize import apply_rules
from app.core.periods import recompute_budget_months
from app.core.transfers import recompute_transfers
from app.db import DEFAULT_DB_PATH


def recompute_all(db_path: Path = DEFAULT_DB_PATH) -> int:
    """Re-derive everything computed from the transactions after an import or a rebuild: budget
    months, transfers, then rule categories. Returns the number of transfer legs flagged."""
    recompute_budget_months(db_path)
    n_transfer_legs = recompute_transfers(db_path)
    apply_rules(db_path)
    return n_transfer_legs
