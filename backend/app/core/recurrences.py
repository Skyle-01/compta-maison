import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from app.core.triage import label_key
from app.db import connect, real_flow_clause

# A monthly recurring: at least this many occurrences in as many distinct calendar months, a median
# gap in this range (days), and exactly one occurrence in this share of the months it appears in.
MIN_OCCURRENCES = 3
MONTHLY_GAP_DAYS = (25, 35)
MIN_SINGLE_MONTH_SHARE = 0.8
# An amount belongs to a run when it is within max(2 %, 0.50 EUR) of the run's median.
TOLERANCE_RATE = 0.02
TOLERANCE_MIN_CENTS = 50
# A variable amount (a bill) must stay within this share of its median, else it is a shop.
VARIABLE_SPREAD = 0.35
# Days of lateness tolerated beyond the usual gap before a flow is missing (one gap) or ended (two).
LATE_DAYS = 5
# A price change is no longer flagged once the new price is older than this.
PRICE_CHANGE_DAYS = 183
LAST_OPERATIONS = 12


@dataclass
class Recurrence:
    """One recurring flow: the operations of one account, one side (debit or credit) and one label key."""

    label: str
    account_id: str
    side: str  # "debit" | "credit"
    category_id: int | None
    amount_kind: str  # "fixed" | "variable"
    typical_cents: int
    last_cents: int
    occurrences: int
    first_date: str
    last_date: str
    next_expected: str | None  # None once ended
    # Flags that can combine: {"kind": "missing" | "ended" | "doubled"} or {"kind": "price_change",
    # "old_cents", "new_cents", "since"}.
    status: list[dict[str, Any]] = field(default_factory=list)
    last_operations: list[dict[str, Any]] = field(
        default_factory=list
    )  # newest first: id, date, amount_cents


def _median_cents(amounts: list[int]) -> int:
    return round(statistics.median(amounts))


def _tolerance(median: int) -> int:
    return max(round(median * TOLERANCE_RATE), TOLERANCE_MIN_CENTS)


def _within(amount: int, median: int) -> bool:
    return abs(amount - median) <= _tolerance(median)


def _scan(amounts: list[int]) -> list[list[int]]:
    """Split the series into runs of indexes: an amount joins the current run when it is within the
    tolerance of that run's median so far, else it starts a new one. A scan (not a pairwise
    comparison) keeps a steady drift, 86, 88, 90, from being cut into steps."""
    runs: list[list[int]] = []
    for i, amount in enumerate(amounts):
        if runs and _within(amount, _median_cents([amounts[j] for j in runs[-1]])):
            runs[-1].append(i)
        else:
            runs.append([i])
    return runs


@dataclass
class _Shape:
    amount_kind: str
    typical_cents: int
    step: (
        tuple[int, int, int] | None
    )  # (old cents, new cents, index of the first occurrence at the new price)


def _shape(amounts: list[int]) -> _Shape | None:
    """The amount type of a series (see the spec): one-offs set aside, adjacent runs merged, a last
    isolated amount a candidate step. None when it is a variable series too spread out to be a bill."""
    runs = _scan(amounts)
    candidate = runs[-1][0] if len(runs[-1]) == 1 else None  # the last amount, when isolated
    body: list[list[int]] = []  # the runs of 2+ amounts, isolated ones before the last are one-offs
    for run in runs:
        if len(run) < 2:
            continue
        if body and _within(
            _median_cents([amounts[i] for i in run]), _median_cents([amounts[i] for i in body[-1]])
        ):
            body[-1] = body[-1] + run
        else:
            body.append(run)
    if (
        candidate is not None
        and body
        and _within(amounts[candidate], _median_cents([amounts[i] for i in body[-1]]))
    ):
        body[-1] = body[-1] + [candidate]
        candidate = None

    medians = [_median_cents([amounts[i] for i in run]) for run in body]
    if len(body) == 1 and candidate is None:
        return _Shape("fixed", medians[0], None)
    if len(body) == 1:
        return _Shape("fixed", medians[0], (medians[0], amounts[candidate], candidate))
    if len(body) == 2 and candidate is None:
        return _Shape("fixed", medians[1], (medians[0], medians[1], min(body[1])))

    # More runs, or none (an electricity bill): variable, kept only when it stays near its median.
    typical = _median_cents(amounts)
    if all(abs(a - typical) <= VARIABLE_SPREAD * typical for a in amounts):
        return _Shape("variable", typical, None)
    return None


def _is_monthly(dates: list[date]) -> bool:
    months = Counter((d.year, d.month) for d in dates)
    if len(dates) < MIN_OCCURRENCES or len(months) < MIN_OCCURRENCES:
        return False
    gaps = [(b - a).days for a, b in zip(dates, dates[1:], strict=False)]
    if not MONTHLY_GAP_DAYS[0] <= statistics.median(gaps) <= MONTHLY_GAP_DAYS[1]:
        return False
    single = sum(1 for count in months.values() if count == 1)
    return single / len(months) >= MIN_SINGLE_MONTH_SHARE


def _recurrence(key: tuple[str, str, str], rows: list[tuple], latest: date) -> Recurrence | None:
    """`rows` = (id, libelle, date, amount_cents, category_id) in date order; `latest` = the account's
    own latest value date, the reference of `missing` and `ended`."""
    account_id, _, side = key
    dates = [r[2] for r in rows]
    if not _is_monthly(dates):
        return None
    amounts = [r[3] for r in rows]
    shape = _shape(amounts)
    if shape is None:
        return None

    gap = statistics.median((b - a).days for a, b in zip(dates, dates[1:], strict=False))
    last = dates[-1]
    ended = latest > last + timedelta(days=2 * gap + LATE_DAYS)
    status: list[dict[str, Any]] = []
    if ended:
        status.append({"kind": "ended"})
    elif latest > last + timedelta(days=gap + LATE_DAYS):
        status.append({"kind": "missing"})
    if shape.step:
        old, new, index = shape.step
        if latest - dates[index] <= timedelta(days=PRICE_CHANGE_DAYS):
            status.append(
                {
                    "kind": "price_change",
                    "old_cents": old,
                    "new_cents": new,
                    "since": dates[index].isoformat(),
                }
            )
    if sum(1 for d in dates if (d.year, d.month) == (last.year, last.month)) >= 2:
        status.append({"kind": "doubled"})

    categories = Counter(r[4] for r in rows if r[4] is not None)
    return Recurrence(
        label=Counter(r[1] for r in rows).most_common(1)[0][0],
        account_id=account_id,
        side=side,
        category_id=categories.most_common(1)[0][0] if categories else None,
        amount_kind=shape.amount_kind,
        typical_cents=shape.typical_cents,
        last_cents=amounts[-1],
        occurrences=len(rows),
        first_date=dates[0].isoformat(),
        last_date=last.isoformat(),
        next_expected=None if ended else (last + timedelta(days=round(gap))).isoformat(),
        status=status,
        last_operations=[
            {"id": r[0], "date": r[2].isoformat(), "amount_cents": r[3]}
            for r in reversed(rows[-LAST_OPERATIONS:])
        ],
    )


def recurrences(db_path: Path, account: str | None = None) -> list[Recurrence]:
    """The monthly recurring flows of the real-flow operations (transfers left out), all months,
    expenses first then income, largest typical amount first. Computed on demand, never stored.
    `account` narrows the list to one account (each flow belongs to one account anyway)."""
    with connect(db_path) as conn:
        latest = {
            account_id: date.fromisoformat(value)
            for account_id, value in conn.execute(
                "SELECT account_id, MAX(date_valeur) FROM transactions GROUP BY account_id"
            )
        }
        operations = conn.execute(
            "SELECT id, libelle, date_valeur, debit_cents, credit_cents, account_id, category_id "
            f"FROM transactions WHERE {real_flow_clause()} ORDER BY date_valeur, id"
        ).fetchall()
    groups: dict[tuple[str, str, str], list[tuple]] = defaultdict(list)
    for id_, libelle, value_date, debit, credit, account_id, category_id in operations:
        if account is not None and account_id != account:
            continue
        side = "debit" if debit > 0 else "credit"
        groups[(account_id, label_key(libelle), side)].append(
            (id_, libelle, date.fromisoformat(value_date), debit or credit, category_id)
        )
    found = [r for key, rows in groups.items() if (r := _recurrence(key, rows, latest[key[0]]))]
    return sorted(found, key=lambda r: (r.side != "debit", -r.typical_cents, r.account_id, r.label))
