from datetime import date
from pathlib import Path

from app.db import DEFAULT_DB_PATH, connect


def _anchor_month(date_valeur: str) -> str:
    """Budget month an income deposit pays for: deposits from the 15th onward
    pay for the next month."""
    d = date.fromisoformat(date_valeur)
    if d.day >= 15:
        year, month = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
        return f"{year:04d}-{month:02d}"
    return date_valeur[:7]


def recompute_budget_months(db_path: Path = DEFAULT_DB_PATH) -> int:
    """Re-assign every transaction to a paycheck-to-paycheck budget month.

    Anchors are credit transactions matching any rule flagged `is_income_anchor`
    (configured in Settings, e.g. the salary pattern). A budget month starts the
    day the deposit paying for it lands and ends the day before the next one, so
    end-of-month spending follows the paycheck instead of a hard calendar cutoff.
    Transactions before the first known deposit keep their calendar month.
    Without any anchor every transaction is reset to its calendar month (so
    un-flagging the anchor rule reverts cleanly). Returns the number of rows
    whose budget_month changed. Idempotent: anchors derive from dates, not from
    previously stored budget_month values.
    """
    with connect(db_path) as conn:
        anchor_dates = [
            d for (d,) in conn.execute(
                "SELECT DISTINCT t.date_valeur FROM transactions t "
                "WHERE t.credit_cents > 0 AND EXISTS ("
                "  SELECT 1 FROM label_rules r WHERE r.is_income_anchor = 1 AND instr(t.libelle, r.pattern) > 0"
                ")"
            )
        ]
        if not anchor_dates:
            cur = conn.execute(
                "UPDATE transactions SET budget_month = substr(date_valeur, 1, 7) "
                "WHERE budget_month != substr(date_valeur, 1, 7)"
            )
            return cur.rowcount

        starts: dict[str, str] = {}  # budget month -> first deposit date opening it
        for d in sorted(anchor_dates):
            starts.setdefault(_anchor_month(d), d)
        anchors = sorted(starts.items(), key=lambda item: item[1])  # [(month, start_date)]

        changed = 0
        first_start = anchors[0][1]
        cur = conn.execute(
            "UPDATE transactions SET budget_month = substr(date_valeur, 1, 7) "
            "WHERE date_valeur < ? AND budget_month != substr(date_valeur, 1, 7)",
            (first_start,),
        )
        changed += cur.rowcount

        for i, (month, start) in enumerate(anchors):
            if i + 1 < len(anchors):
                next_start = anchors[i + 1][1]
                cur = conn.execute(
                    "UPDATE transactions SET budget_month = ? "
                    "WHERE date_valeur >= ? AND date_valeur < ? AND budget_month != ?",
                    (month, start, next_start, month),
                )
            else:
                cur = conn.execute(
                    "UPDATE transactions SET budget_month = ? "
                    "WHERE date_valeur >= ? AND budget_month != ?",
                    (month, start, month),
                )
            changed += cur.rowcount
        return changed
