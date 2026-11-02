import sqlite3
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


# Days a statement may start after the account's last operation, or an account after the opening
# of a budget month, without being flagged: a weekend plus a bank holiday.
GAP_TOLERANCE_DAYS = 4


def budget_starts(conn: sqlite3.Connection) -> dict[str, str]:
    """Budget month -> the date (ISO) of the first deposit opening it, oldest first. Anchors are
    the credits matching a rule flagged `is_income_anchor` (a rule scoped to an account only
    counts for that account's credits); empty without any. Months before the first deposit are
    calendar months and have no entry."""
    anchor_dates = [
        d
        for (d,) in conn.execute(
            "SELECT DISTINCT t.date_valeur FROM transactions t "
            "WHERE t.credit_cents > 0 AND EXISTS ("
            "  SELECT 1 FROM label_rules r WHERE r.is_income_anchor = 1 AND instr(t.libelle, r.pattern) > 0"
            "  AND (r.account_id IS NULL OR r.account_id = t.account_id)"
            ")"
        )
    ]
    starts: dict[str, str] = {}
    for d in sorted(anchor_dates):
        starts.setdefault(_anchor_month(d), d)
    return dict(sorted(starts.items(), key=lambda item: item[1]))


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
        starts = budget_starts(conn)
        if not starts:
            cur = conn.execute(
                "UPDATE transactions SET budget_month = substr(date_valeur, 1, 7) "
                "WHERE budget_month != substr(date_valeur, 1, 7)"
            )
            return cur.rowcount

        anchors = list(starts.items())  # [(month, opening date)]

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
                    "UPDATE transactions SET budget_month = ? WHERE date_valeur >= ? AND budget_month != ?",
                    (month, start, month),
                )
            changed += cur.rowcount
        return changed


def partial_months(conn: sqlite3.Connection) -> set[str]:
    """Budget months in which an imported checking account had not started: its effective start
    (its own `start_date`, else its first value date) falls more than GAP_TOLERANCE_DAYS after the
    month's opening (the paycheck opening it, the 1st for a calendar month). The month then lacks
    that account's flows (and the salary it receives), so its totals are not comparable with the
    others and the averages leave it out. Generic: any account added later counts the same way."""
    starts = [
        date.fromisoformat(start)
        for (start,) in conn.execute(
            "SELECT COALESCE(a.start_date, (SELECT MIN(substr(t.date_valeur, 1, 10)) "
            "FROM transactions t WHERE t.account_id = a.code)) FROM accounts a WHERE a.type = 'checking'"
        )
        if start is not None
    ]
    if not starts:
        return set()
    openings = budget_starts(conn)
    latest_start = max(starts)
    partial = set()
    for (month,) in conn.execute("SELECT DISTINCT budget_month FROM transactions"):
        opening = date.fromisoformat(openings.get(month, f"{month}-01"))
        if (latest_start - opening).days > GAP_TOLERANCE_DAYS:
            partial.add(month)
    return partial
