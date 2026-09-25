from bisect import bisect_left, bisect_right
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Literal, NamedTuple

from app.db import DEFAULT_DB_PATH, connect, get_transfer_markers, savings_accounts

TRANSFER_WINDOW_DAYS = 3
# Label prefixes that mark a bank line as a virement. French banks start transfer labels with
# "VIR" ("VIR vers …", "VIREMENT …", "VIR SEPA …"): a convention, not personal data. Used when
# the transfer_markers table is empty.
DEFAULT_TRANSFER_MARKERS: tuple[str, ...] = ("VIR",)
# A marker that accepts any label — restores pairing on amount + date alone.
ANY_LABEL = "*"

TransferMode = Literal["transfer", "none", "auto"]


class Leg(NamedTuple):
    id: int
    account_id: str
    cents: int
    day: int  # date.toordinal() of date_operation
    libelle: str


def effective_markers(conn) -> list[str]:
    """The configured transfer markers, or the built-in default when none are configured."""
    return get_transfer_markers(conn) or list(DEFAULT_TRANSFER_MARKERS)


def has_transfer_marker(libelle: str, markers: Sequence[str]) -> bool:
    """True if the label starts with one of the markers (case-insensitive, leading spaces
    ignored). Unlike rules — substrings anywhere in the label — markers match the start only,
    so a card payment at a merchant containing 'VIR' isn't taken for a virement."""
    if ANY_LABEL in markers:
        return True
    label = libelle.lstrip().casefold()
    return any(label.startswith(marker.casefold()) for marker in markers)


def pair_legs(
    debits: Sequence[Leg], credits: Sequence[Leg], window_days: int = TRANSFER_WINDOW_DAYS
) -> list[tuple[int, int]]:
    """Greedy pairing: each debit, in the given order, claims the closest-dated unused credit of
    the same amount on another account within the window (earliest credit wins a tie). Credits
    must be sorted by (day, id). Returns (debit_id, credit_id) pairs.

    Credits are bucketed by amount and bisected by day, so the cost is O((D + C) log C) plus the
    candidates inside each window rather than D × C."""
    buckets: dict[int, tuple[list[int], list[Leg]]] = {}
    for leg in credits:
        days, legs = buckets.setdefault(leg.cents, ([], []))
        days.append(leg.day)
        legs.append(leg)

    used: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for debit in debits:
        bucket = buckets.get(debit.cents)
        if bucket is None:
            continue
        days, legs = bucket
        lo = bisect_left(days, debit.day - window_days)
        hi = bisect_right(days, debit.day + window_days)
        best: tuple[int, int] | None = None  # (day distance, credit id)
        for credit in legs[lo:hi]:
            if credit.id in used or credit.account_id == debit.account_id:
                continue
            distance = abs(credit.day - debit.day)
            if best is None or distance < best[0]:
                best = (distance, credit.id)
        if best is not None:
            used.add(best[1])
            pairs.append((debit.id, best[1]))
    return pairs


def _legs(conn, amount_col: str, markers: Sequence[str]) -> list[Leg]:
    rows = conn.execute(
        f"SELECT id, account_id, {amount_col}, date_operation, libelle FROM transactions "
        f"WHERE {amount_col} > 0 AND account_id IS NOT NULL AND kind_manual = 0 "
        "ORDER BY date_operation, id"
    ).fetchall()
    return [
        Leg(id_, account_id, cents, date.fromisoformat(day).toordinal(), libelle)
        for id_, account_id, cents, day, libelle in rows
        if has_transfer_marker(libelle, markers)
    ]


def _next_group(conn) -> int:
    return conn.execute("SELECT COALESCE(MAX(transfer_group_id), 0) FROM transactions").fetchone()[0] + 1


def recompute_transfers(db_path: Path = DEFAULT_DB_PATH) -> int:
    """Auto-pair internal transfers between canonical accounts and flag both legs.

    A transfer is a debit on one account matched to a credit on a *different* account with the
    same amount, within TRANSFER_WINDOW_DAYS, where BOTH labels start with a transfer marker
    (see effective_markers / has_transfer_marker). Each leg is used at most once; earlier debits
    claim the closest-dated eligible credit first. Both legs get a shared `transfer_group_id` and
    `kind='transfer'` so they drop out of income/expense/balance.

    Only non-manual rows are touched (kind_manual=1 — a manual pair, unpair or single-row
    decision — is left as the user set it). Idempotent.

    A final pass marks deposits to *external* savings accounts (a child's Livret A, which have a
    `deposit_pattern` but no imported statement) as `kind='transfer'` too, so they drop out of
    expenses just like deposits to an imported savings account. These stay single-legged (no
    transfer_group_id), are not subject to the markers, and are surfaced as derived Épargne
    leaves by category_tree.

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
        markers = effective_markers(conn)
        pairs = pair_legs(_legs(conn, "debit_cents", markers), _legs(conn, "credit_cents", markers))
        first_group = _next_group(conn)
        conn.executemany(
            "UPDATE transactions SET transfer_group_id = ?, kind = 'transfer' WHERE id IN (?, ?)",
            [(first_group + i, debit_id, credit_id) for i, (debit_id, credit_id) in enumerate(pairs)],
        )
        marked = 2 * len(pairs)

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


def _partner_ids(conn, transaction_id: int) -> list[int]:
    """The other leg(s) sharing this row's transfer group, if any."""
    return [
        pid
        for (pid,) in conn.execute(
            "SELECT p.id FROM transactions t JOIN transactions p "
            "ON p.transfer_group_id = t.transfer_group_id AND p.id != t.id WHERE t.id = ?",
            (transaction_id,),
        )
    ]


def _release(conn, ids: Sequence[int]) -> None:
    """Hand rows back to automatic detection (recompute_transfers re-derives them)."""
    conn.executemany(
        "UPDATE transactions SET kind_manual = 0, transfer_group_id = NULL WHERE id = ?",
        [(id_,) for id_ in ids],
    )


def pair_manually(db_path: Path, a_id: int, b_id: int) -> int:
    """Force two rows into a manual transfer pair (the user's decision wins over detection: the
    date window and the markers are not checked). Requires one debit and one credit of the same
    amount on two different accounts. Any previous partner of either leg goes back to automatic
    detection, so every manual group keeps exactly two legs. Returns the new group id.

    Raises LookupError for an unknown id, ValueError for an invalid pair."""
    if a_id == b_id:
        raise ValueError("A transfer needs two different operations")
    with connect(db_path) as conn:
        rows = {
            id_: (account_id, debit, credit)
            for id_, account_id, debit, credit in conn.execute(
                "SELECT id, account_id, debit_cents, credit_cents FROM transactions WHERE id IN (?, ?)",
                (a_id, b_id),
            )
        }
        missing = [id_ for id_ in (a_id, b_id) if id_ not in rows]
        if missing:
            raise LookupError(f"No transaction with id {missing[0]}")
        debits = [id_ for id_, (_acc, debit, _credit) in rows.items() if debit > 0]
        credits = [id_ for id_, (_acc, _debit, credit) in rows.items() if credit > 0]
        if len(debits) != 1 or len(credits) != 1:
            raise ValueError("A transfer pairs one debit with one credit")
        (d_acc, d_cents, _), (c_acc, _, c_cents) = rows[debits[0]], rows[credits[0]]
        if d_acc is None or d_acc == c_acc:
            raise ValueError("The two operations must be on two different accounts")
        if d_cents != c_cents:
            raise ValueError("The two operations must have the same amount")

        partners = [p for id_ in (a_id, b_id) for p in _partner_ids(conn, id_) if p not in (a_id, b_id)]
        _release(conn, partners)
        group = _next_group(conn)
        conn.execute(
            "UPDATE transactions SET kind = 'transfer', kind_manual = 1, transfer_group_id = ? "
            "WHERE id IN (?, ?)",
            (group, a_id, b_id),
        )
    recompute_transfers(db_path)
    return group


def set_transfer_mode(db_path: Path, transaction_id: int, mode: TransferMode) -> list[int]:
    """Manual transfer decision on one row; returns the ids it touched.

    - "none": not a transfer — the row and its group partner (if any) go back to their
      amount-derived income/expense, flagged manual so detection won't pair them again.
    - "transfer": the row alone is a transfer (single-legged, e.g. money sent to an account whose
      statement isn't imported); a previous partner goes back to automatic detection.
    - "auto": drop any manual decision on the row and its partner; detection decides again.

    Raises LookupError for an unknown id."""
    with connect(db_path) as conn:
        if conn.execute("SELECT 1 FROM transactions WHERE id = ?", (transaction_id,)).fetchone() is None:
            raise LookupError(f"No transaction with id {transaction_id}")
        partners = _partner_ids(conn, transaction_id)
        if mode == "none":
            touched = [transaction_id, *partners]
            conn.executemany(
                "UPDATE transactions SET kind_manual = 1, transfer_group_id = NULL, "
                "kind = CASE WHEN credit_cents > 0 THEN 'income' ELSE 'expense' END WHERE id = ?",
                [(id_,) for id_ in touched],
            )
        elif mode == "transfer":
            touched = [transaction_id, *partners]
            _release(conn, partners)
            conn.execute(
                "UPDATE transactions SET kind = 'transfer', kind_manual = 1, transfer_group_id = NULL "
                "WHERE id = ?",
                (transaction_id,),
            )
        else:
            touched = [transaction_id, *partners]
            _release(conn, touched)
    recompute_transfers(db_path)
    return touched
