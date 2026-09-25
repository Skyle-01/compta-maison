from datetime import date
from pathlib import Path

from app.db import DEFAULT_DB_PATH, connect, savings_accounts

TRANSFER_WINDOW_DAYS = 3


def recompute_transfers(db_path: Path = DEFAULT_DB_PATH) -> int:
    """Auto-pair internal transfers between canonical accounts and flag both legs.

    A transfer is a debit on one account matched to a credit on a *different* account
    with the same amount, within TRANSFER_WINDOW_DAYS. Each leg is used at most once;
    earlier debits claim the closest-dated eligible credit first. Both legs get a shared
    `transfer_group_id` and `kind='transfer'` so they drop out of income/expense/balance.

    Only non-manual rows are touched (kind_manual=1 is left as the user set it). Idempotent.

    A final pass marks deposits to *external* savings accounts (the kids' Livret A, which have a
    `deposit_pattern` but no imported statement) as `kind='transfer'` too, so they drop out of
    expenses just like LIVRET deposits. These stay single-legged (no transfer_group_id) and are
    surfaced as derived Épargne leaves by category_tree.

    Returns the number of legs flagged as transfers — the freshly-paired internal legs plus the
    external-savings deposits (re)marked on this run (the reset above restores everything to
    income/expense first, so the count is stable across runs, not strictly "newly changed").
    """
    with connect(db_path) as conn:
        # Reset prior auto-pairings back to their amount-derived flow before re-pairing.
        conn.execute(
            "UPDATE transactions SET transfer_group_id = NULL, "
            "kind = CASE WHEN credit_cents > 0 THEN 'income' ELSE 'expense' END "
            "WHERE kind_manual = 0"
        )

        debits = conn.execute(
            "SELECT id, account_id, debit_cents, date_operation FROM transactions "
            "WHERE debit_cents > 0 AND account_id IS NOT NULL AND kind_manual = 0 "
            "ORDER BY date_operation, id"
        ).fetchall()
        credits = conn.execute(
            "SELECT id, account_id, credit_cents, date_operation FROM transactions "
            "WHERE credit_cents > 0 AND account_id IS NOT NULL AND kind_manual = 0 "
            "ORDER BY date_operation, id"
        ).fetchall()

        next_group = (conn.execute(
            "SELECT COALESCE(MAX(transfer_group_id), 0) FROM transactions"
        ).fetchone()[0]) + 1

        used_credits: set[int] = set()
        marked = 0
        for debit_id, debit_account, amount_cents, debit_date in debits:
            best: tuple[int, int] | None = None  # (day_distance, credit_id)
            d_date = date.fromisoformat(debit_date)
            for credit_id, credit_account, credit_cents, credit_date in credits:
                if credit_id in used_credits:
                    continue
                if credit_account == debit_account or credit_cents != amount_cents:
                    continue
                distance = abs((date.fromisoformat(credit_date) - d_date).days)
                if distance > TRANSFER_WINDOW_DAYS:
                    continue
                if best is None or distance < best[0]:
                    best = (distance, credit_id)
            if best is None:
                continue
            credit_id = best[1]
            used_credits.add(credit_id)
            conn.execute(
                "UPDATE transactions SET transfer_group_id = ?, kind = 'transfer' WHERE id IN (?, ?)",
                (next_group, debit_id, credit_id),
            )
            next_group += 1
            marked += 2

        # External savings deposits: a checking-account row whose libellé matches the pattern
        # of a savings account that has no statement of its own. Mark as transfer (out of
        # expenses); the reset above already restored these to income/expense, so this is safe.
        for _code, _label, pattern in savings_accounts(conn):
            if not pattern:
                continue
            cur = conn.execute(
                "UPDATE transactions SET kind = 'transfer' "
                "WHERE kind_manual = 0 AND kind != 'transfer' AND instr(libelle, ?) > 0",
                (pattern,),
            )
            marked += cur.rowcount
        return marked
