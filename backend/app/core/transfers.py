import sqlite3
from bisect import bisect_left, bisect_right
from collections import defaultdict
from collections.abc import Collection, Mapping, Sequence
from datetime import date
from pathlib import Path
from typing import Literal, NamedTuple

from app.core.triage import label_key
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
    refs: frozenset[str] = frozenset()  # the other accounts whose label the libellé names


def account_refs(libelle: str, own_account: str, labels: Mapping[str, str]) -> frozenset[str]:
    """Codes of the accounts (other than the leg's own) whose label appears in the libellé, ignoring
    case: "VIR de COMPTE PERSO" names the account labelled "Compte perso". Codes and aliases are not
    searched, a short code would turn up inside unrelated labels."""
    text = libelle.casefold()
    return frozenset(
        code for code, label in labels.items() if code != own_account and label and label.casefold() in text
    )


def effective_markers(conn: sqlite3.Connection) -> list[str]:
    """The configured transfer markers, or the built-in default when none are configured."""
    return get_transfer_markers(conn) or list(DEFAULT_TRANSFER_MARKERS)


def _deposit_patterns(conn: sqlite3.Connection) -> list[str]:
    """deposit_pattern of every external savings account (a child's Livret A)."""
    return [pattern for _code, _label, pattern in savings_accounts(conn) if pattern]


def _is_external_deposit(libelle: str, patterns: Sequence[str]) -> bool:
    """Same case-insensitive substring test as the external-savings pass (SQL casefold + instr):
    banks don't keep a payee's casing ('vers LIVRET' for a 'VERS LIVRET' pattern)."""
    label = libelle.casefold()
    return any(pattern.casefold() in label for pattern in patterns)


def has_transfer_marker(libelle: str, markers: Sequence[str]) -> bool:
    """True if the label starts with one of the markers (case-insensitive, leading spaces
    ignored). Unlike rules — substrings anywhere in the label — markers match the start only,
    so a card payment at a merchant containing 'VIR' isn't taken for a virement."""
    if ANY_LABEL in markers:
        return True
    label = libelle.lstrip().casefold()
    return any(label.startswith(marker.casefold()) for marker in markers)


def agreement(debit: Leg, credit: Leg) -> int | None:
    """How many of the two labels name the other leg's account (0-2), or None when a label names
    accounts that exclude the other leg's: "VIR de COMPTE JOINT" is no leg of a transfer from PERSO."""
    if (debit.refs and credit.account_id not in debit.refs) or (
        credit.refs and debit.account_id not in credit.refs
    ):
        return None
    return (credit.account_id in debit.refs) + (debit.account_id in credit.refs)


def _choice(
    leg: Leg,
    options: Sequence[tuple[int, Leg]],
    taken: Collection[int],
    classes: Mapping[int, tuple[str, str]],
) -> Leg | None:
    """`leg`'s pick among its options ((agreement, other leg)) not yet taken: the closest-dated of
    those with the best agreement, or None when these span several (account, label_key) classes.
    Same-class legs are interchangeable (the same transfer seen twice); different classes are an
    ambiguity (the tenant's rent vs your own transfer, same day and amount) left to the user."""
    free = [(score, other) for score, other in options if other.id not in taken]
    if not free:
        return None
    top = max(score for score, _ in free)
    best = [other for score, other in free if score == top]
    if len({classes[other.id] for other in best}) > 1:
        return None
    return min(best, key=lambda other: (abs(other.day - leg.day), other.day, other.id))


def pair_legs(
    debits: Sequence[Leg], credits: Sequence[Leg], window_days: int = TRANSFER_WINDOW_DAYS
) -> list[tuple[int, int]]:
    """Pair each debit with a credit of the same amount on another account within the window, only
    when the choice is unambiguous. A debit and a credit are paired when each is the other's pick
    (see _choice: best `agreement`, then closest date); rounds repeat until no new pair forms, so
    the result doesn't depend on import order. A leg whose candidates stay ambiguous is left unpaired
    for a manual decision: a wrong pair would silently hide an income or an expense. Credits must be
    sorted by (day, id). Returns (debit_id, credit_id) pairs in debit order.

    Credits are bucketed by amount and bisected by day, so building the candidates costs
    O((D + C) log C) plus the candidates inside each window rather than D × C."""
    buckets: dict[int, tuple[list[int], list[Leg]]] = {}
    for leg in credits:
        days, legs = buckets.setdefault(leg.cents, ([], []))
        days.append(leg.day)
        legs.append(leg)

    debit_options: dict[int, list[tuple[int, Leg]]] = defaultdict(list)
    credit_options: dict[int, list[tuple[int, Leg]]] = defaultdict(list)
    for debit in debits:
        bucket = buckets.get(debit.cents)
        if bucket is None:
            continue
        days, legs = bucket
        lo = bisect_left(days, debit.day - window_days)
        hi = bisect_right(days, debit.day + window_days)
        for credit in legs[lo:hi]:
            if credit.account_id == debit.account_id:
                continue
            score = agreement(debit, credit)
            if score is not None:
                debit_options[debit.id].append((score, credit))
                credit_options[credit.id].append((score, debit))

    classes = {leg.id: (leg.account_id, label_key(leg.libelle)) for leg in (*debits, *credits)}
    paired: dict[int, int] = {}  # debit id -> credit id
    taken: set[int] = set()  # paired credit ids
    while True:
        formed = False
        for debit in debits:
            if debit.id in paired or not debit_options[debit.id]:
                continue
            credit = _choice(debit, debit_options[debit.id], taken, classes)
            if credit is None:
                continue
            back = _choice(credit, credit_options[credit.id], paired, classes)
            if back is not None and back.id == debit.id:
                paired[debit.id] = credit.id
                taken.add(credit.id)
                formed = True
        if not formed:
            return [(debit.id, paired[debit.id]) for debit in debits if debit.id in paired]


def _legs(conn: sqlite3.Connection, amount_col: str, markers: Sequence[str]) -> list[Leg]:
    # External-savings deposits are single-legged by design (see recompute_transfers): pairing one
    # with an unrelated same-amount credit would hide that credit from income.
    patterns = _deposit_patterns(conn)
    labels = dict(conn.execute("SELECT code, label FROM accounts").fetchall())
    rows = conn.execute(
        f"SELECT id, account_id, {amount_col}, date_operation, libelle FROM transactions "
        f"WHERE {amount_col} > 0 AND account_id IS NOT NULL AND kind_manual = 0 "
        "ORDER BY date_operation, id"
    ).fetchall()
    legs = []
    for id_, account_id, cents, day, libelle in rows:
        refs = account_refs(libelle, account_id, labels)
        # Naming one of your accounts is as good a sign as a marker ("vers LIVRET A" has no VIR).
        if (has_transfer_marker(libelle, markers) or refs) and not _is_external_deposit(libelle, patterns):
            legs.append(Leg(id_, account_id, cents, date.fromisoformat(day).toordinal(), libelle, refs))
    return legs


def transfer_candidates(db_path: Path, ids: Collection[int]) -> dict[int, list[int]]:
    """For each of `ids` that could be a transfer leg, the operations that could be its other leg,
    likeliest first (best `agreement`, then closest date): the tests of automatic pairing (_legs,
    window, agreement) without asking the match to be unique, since the user picks (the « À classer »
    page). Rows already in a transfer, or carrying a manual transfer decision, take no part."""
    wanted = set(ids)
    if not wanted:
        return {}
    with connect(db_path) as conn:
        markers = effective_markers(conn)
        in_transfer = {id_ for (id_,) in conn.execute("SELECT id FROM transactions WHERE kind = 'transfer'")}
        debits = [leg for leg in _legs(conn, "debit_cents", markers) if leg.id not in in_transfer]
        credits = [leg for leg in _legs(conn, "credit_cents", markers) if leg.id not in in_transfer]

    found: dict[int, list[int]] = {}
    for legs, others, is_debit in ((debits, credits, True), (credits, debits, False)):
        by_cents: dict[int, list[Leg]] = defaultdict(list)
        for other in others:
            by_cents[other.cents].append(other)
        for leg in legs:
            if leg.id not in wanted:
                continue
            ranked = []
            for other in by_cents[leg.cents]:
                distance = abs(other.day - leg.day)
                if other.account_id == leg.account_id or distance > TRANSFER_WINDOW_DAYS:
                    continue
                score = agreement(leg, other) if is_debit else agreement(other, leg)
                if score is not None:
                    ranked.append((-score, distance, other.day, other.id))
            if ranked:
                found[leg.id] = [other_id for *_, other_id in sorted(ranked)]
    return found


def _next_group(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COALESCE(MAX(transfer_group_id), 0) FROM transactions").fetchone()[0] + 1


def recompute_transfers(db_path: Path = DEFAULT_DB_PATH) -> int:
    """Auto-pair internal transfers between canonical accounts and flag both legs.

    A transfer is a debit on one account matched to a credit on a *different* account with the
    same amount, within TRANSFER_WINDOW_DAYS, where BOTH labels start with a transfer marker
    (see effective_markers / has_transfer_marker) or name another of the accounts (account_refs:
    "vers LIVRET A" for the account labelled "Livret A"). Each leg is used at most once, and only
    when the match is unambiguous (see pair_legs): a label naming the other account wins over one
    that names none, and competing legs that nothing tells apart stay unpaired, for the user to
    pair by hand (pair_manually). Both legs get a shared `transfer_group_id` and `kind='transfer'`
    so they drop out of income/expense/balance.

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

        # External savings deposits: a checking-account row whose libellé contains the pattern (any case)
        # of a savings account that has no statement of its own. Mark as transfer (out of
        # expenses); the reset above already restored these to income/expense, so this is safe.
        for _code, _label, pattern in savings_accounts(conn):
            if not pattern:
                continue
            cur = conn.execute(
                "UPDATE transactions SET kind = 'transfer' "
                "WHERE kind_manual = 0 AND kind != 'transfer' AND instr(casefold(libelle), casefold(?)) > 0",
                (pattern,),
            )
            marked += cur.rowcount
        return marked


def _partner_ids(conn: sqlite3.Connection, transaction_id: int) -> list[int]:
    """The other leg(s) sharing this row's transfer group, if any."""
    return [
        pid
        for (pid,) in conn.execute(
            "SELECT p.id FROM transactions t JOIN transactions p "
            "ON p.transfer_group_id = t.transfer_group_id AND p.id != t.id WHERE t.id = ?",
            (transaction_id,),
        )
    ]


def _release(conn: sqlite3.Connection, ids: Sequence[int]) -> None:
    """Hand rows back to automatic detection (recompute_transfers re-derives them)."""
    conn.executemany(
        "UPDATE transactions SET kind_manual = 0, transfer_group_id = NULL WHERE id = ?",
        [(id_,) for id_ in ids],
    )


def pair_manually(db_path: Path, a_id: int, b_id: int) -> int:
    """Force two rows into a manual transfer pair (the user's decision wins over detection: the
    date window and the markers are not checked). Requires one debit and one credit of the same
    amount on two different accounts, neither of them a deposit to an external savings account
    (those follow their deposit_pattern). Any previous partner of either leg goes back to automatic
    detection, so every manual group keeps exactly two legs. Returns the new group id.

    Raises LookupError for an unknown id, ValueError for an invalid pair (French messages, shown
    as they are by the Transactions page)."""
    if a_id == b_id:
        raise ValueError("Un virement associe deux opérations différentes")
    with connect(db_path) as conn:
        rows = {}
        labels = []
        for id_, account_id, debit, credit, libelle in conn.execute(
            "SELECT id, account_id, debit_cents, credit_cents, libelle FROM transactions WHERE id IN (?, ?)",
            (a_id, b_id),
        ):
            rows[id_] = (account_id, debit, credit)
            labels.append(libelle)
        missing = [id_ for id_ in (a_id, b_id) if id_ not in rows]
        if missing:
            raise LookupError(f"Opération {missing[0]} introuvable")
        patterns = _deposit_patterns(conn)
        if any(_is_external_deposit(label, patterns) for label in labels):
            raise ValueError("Un versement vers une épargne externe ne peut pas être associé")
        debits = [id_ for id_, (_acc, debit, _credit) in rows.items() if debit > 0]
        credits = [id_ for id_, (_acc, _debit, credit) in rows.items() if credit > 0]
        if len(debits) != 1 or len(credits) != 1:
            raise ValueError("Un virement associe un débit et un crédit")
        (d_acc, d_cents, _), (c_acc, _, c_cents) = rows[debits[0]], rows[credits[0]]
        if d_acc is None or d_acc == c_acc:
            raise ValueError("Les deux opérations doivent être sur deux comptes différents")
        if d_cents != c_cents:
            raise ValueError("Les deux opérations doivent avoir le même montant")

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

    Deposits to an external savings account always go back to detection, whatever the mode: they
    follow their deposit_pattern, and a manual "not a transfer" would count them both as an
    expense and as savings.

    Raises LookupError for an unknown id."""
    with connect(db_path) as conn:
        if conn.execute("SELECT 1 FROM transactions WHERE id = ?", (transaction_id,)).fetchone() is None:
            raise LookupError(f"Opération {transaction_id} introuvable")
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
        patterns = _deposit_patterns(conn)
        if patterns:
            placeholders = ", ".join("?" * len(touched))
            _release(
                conn,
                [
                    id_
                    for id_, libelle in conn.execute(
                        f"SELECT id, libelle FROM transactions WHERE id IN ({placeholders})", touched
                    )
                    if _is_external_deposit(libelle, patterns)
                ],
            )
    recompute_transfers(db_path)
    return touched
