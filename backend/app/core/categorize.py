from pathlib import Path
from typing import Any

from app.db import DEFAULT_DB_PATH, connect, euros, real_flow_clause, savings_accounts

UNBALANCED_TOLERANCE_CENTS = 1


def apply_rules(db_path: Path = DEFAULT_DB_PATH) -> None:
    """Re-categorise all non-manual transactions from label_rules.

    Patterns are plain substrings matched case-sensitively against libelle
    (instr mirrors str.contains(regex=False)). Rules are applied by ascending
    priority (ties broken by id); the first matching rule wins.
    """
    with connect(db_path) as conn:
        conn.execute("UPDATE transactions SET category_id = NULL, rule_id = NULL WHERE category_manual = 0")
        rules = conn.execute("SELECT id, category_id, pattern FROM label_rules ORDER BY priority, id").fetchall()
        for rule_id, category_id, pattern in rules:
            conn.execute(
                "UPDATE transactions SET category_id = ?, rule_id = ? "
                "WHERE category_manual = 0 AND category_id IS NULL AND instr(libelle, ?) > 0",
                (category_id, rule_id, pattern),
            )


def uncategorized_balance(db_path: Path = DEFAULT_DB_PATH, month: str | None = None) -> dict[str, Any]:
    """Credit/debit sums of uncategorised, non-transfer transactions. Auto-paired
    transfers are excluded (kind='transfer'), so a residual difference now means a
    genuinely missing rule rather than an unmatched internal movement."""
    query = (
        "SELECT COUNT(*), COALESCE(SUM(credit_cents), 0), COALESCE(SUM(debit_cents), 0) "
        f"FROM transactions WHERE category_id IS NULL AND {real_flow_clause()}"
    )
    params: tuple = ()
    if month:
        query += " AND budget_month = ?"
        params = (month,)
    with connect(db_path) as conn:
        count, credit_cents, debit_cents = conn.execute(query, params).fetchone()
    difference_cents = credit_cents - debit_cents
    return {
        "count": count,
        "credit": euros(credit_cents),
        "debit": euros(debit_cents),
        "difference": euros(difference_cents),
        "balanced": abs(difference_cents) <= UNBALANCED_TOLERANCE_CENTS,
    }


def _node(category_id: int | None, name: str) -> dict[str, Any]:
    return {"id": category_id, "name": name, "credit": 0, "debit": 0, "balance": 0, "children": []}


def _synth_node(name: str) -> dict[str, Any]:
    """A derived (non-category) tree node — épargne/désépargne. Marked so the frontend
    renders it as a plain line (no transaction drill-down, unlike real category nodes)."""
    node = _node(None, name)
    node["synthetic"] = True
    return node


def _sum_children_cents(node: dict[str, Any]) -> None:
    for child in node["children"]:
        _sum_children_cents(child)
        node["credit"] += child["credit"]
        node["debit"] += child["debit"]


def _cents_to_euros(node: dict[str, Any]) -> None:
    node["balance"] = euros(node["credit"] - node["debit"])
    node["credit"] = euros(node["credit"])
    node["debit"] = euros(node["debit"])
    for child in node["children"]:
        _cents_to_euros(child)


def _finalize(node: dict[str, Any]) -> dict[str, Any]:
    """Sum children into parents (exact, in cents), then convert to euros."""
    _sum_children_cents(node)
    _cents_to_euros(node)
    return node


def category_tree(db_path: Path = DEFAULT_DB_PATH, month: str | None = None) -> dict[str, Any]:
    """Build the category tree (total -> top-level groups -> descendants) with per-node
    credit/debit sums for one budget month (or all months if None). Transfers are
    excluded. A node's own transactions count alongside its children's.

    Savings movements are surfaced as derived leaves per savings account: money saved as an
    outflow (debit) leaf under the 'Épargne' group, money withdrawn as an inflow (credit) leaf
    under the 'Déficit' group (both named after the account). Nets are bucketed per account-month
    (see _savings_net_cents): for a single month only one side is non-zero, but the all-months
    view can show both an Épargne and a Déficit leaf for the same account (total saved vs total
    dipped). An imported savings account (LIVRET) carries its account code for drill-down; an
    external one (the kids' Livret A) carries the libellé substring its deposits match instead,
    since those rows live on the checking account that funded them."""
    with connect(db_path) as conn:
        categories = conn.execute("SELECT id, name, parent_id FROM categories ORDER BY parent_id, id").fetchall()
        query = (
            "SELECT category_id, COALESCE(SUM(credit_cents), 0), COALESCE(SUM(debit_cents), 0) "
            f"FROM transactions WHERE category_id IS NOT NULL AND {real_flow_clause()}"
        )
        params: tuple = ()
        if month:
            query += " AND budget_month = ?"
            params = (month,)
        totals = {
            category_id: (credit, debit)
            for category_id, credit, debit in conn.execute(query + " GROUP BY category_id", params)
        }
        unc_query = (
            "SELECT COALESCE(SUM(credit_cents), 0), COALESCE(SUM(debit_cents), 0) "
            f"FROM transactions WHERE category_id IS NULL AND {real_flow_clause()}"
        )
        if month:
            unc_query += " AND budget_month = ?"
        unc_credit, unc_debit = conn.execute(unc_query, params).fetchone()
        savings_nets = _savings_net_cents(conn, month)

    nodes: dict[int, dict[str, Any]] = {}
    for category_id, name, _parent_id in categories:
        node = _node(category_id, name)
        node["credit"], node["debit"] = totals.get(category_id, (0, 0))
        nodes[category_id] = node

    root = _node(None, "total")
    for category_id, _name, parent_id in categories:
        if parent_id is None:
            root["children"].append(nodes[category_id])
        else:
            nodes[parent_id]["children"].append(nodes[category_id])

    unc = _node(None, "uncategorised")
    unc["credit"], unc["debit"] = unc_credit, unc_debit
    root["children"].append(unc)

    # Derived savings leaves. Money saved reads as an outflow (debit) under Épargne; money
    # withdrawn as an inflow (credit) under Déficit. Counted into the totals so the tree stays
    # exact. An account can show both leaves in the all-months view (saved some months, dipped
    # others) — the per-month bucketing in _savings_net_cents keeps the two sides separate.
    synthetic_groups: dict[str, dict[str, Any]] = {}

    def _parent_for(name: str) -> dict[str, Any]:
        """The existing top-level category node named `name`, else a single synthetic group
        appended to the root — so derived leaves share the real group when there is one."""
        cid = next((c for c, n, parent in categories if parent is None and n == name), None)
        if cid is not None:
            return nodes[cid]
        if name not in synthetic_groups:
            group = _synth_node(name)
            synthetic_groups[name] = group
            root["children"].append(group)
        return synthetic_groups[name]

    def _drill(leaf: dict[str, Any], code: str, pattern: str | None) -> None:
        # External accounts (kids) have no rows of their own — their deposits live on the
        # checking account, found by libellé. Imported accounts drill down by account code.
        if pattern:
            leaf["libelle_match"] = pattern
        else:
            leaf["account_id"] = code

    for code, label, pattern, epargne_cents, desepargne_cents in savings_nets:
        if epargne_cents > 0:
            leaf = _synth_node(label)
            leaf["debit"] = epargne_cents
            _drill(leaf, code, pattern)
            _parent_for("Épargne")["children"].append(leaf)
        if desepargne_cents > 0:
            leaf = _synth_node(label)
            leaf["credit"] = desepargne_cents
            _drill(leaf, code, pattern)
            _parent_for("Déficit")["children"].append(leaf)

    return _finalize(root)


def income_and_expenses(db_path: Path = DEFAULT_DB_PATH, month: str | None = None) -> tuple[float, float]:
    """(income, expenses) in euros for one budget month (or all months). Income sums
    credits of kind='income', expenses sum debits of kind='expense'; transfers are
    excluded. Both totals span categorised and uncategorised transactions alike."""
    where = "kind = 'income'"
    where_exp = "kind = 'expense'"
    params: tuple = ()
    if month:
        where += " AND budget_month = ?"
        where_exp += " AND budget_month = ?"
        params = (month,)
    with connect(db_path) as conn:
        income_cents = conn.execute(
            f"SELECT COALESCE(SUM(credit_cents), 0) FROM transactions WHERE {where}", params
        ).fetchone()[0]
        expense_cents = conn.execute(
            f"SELECT COALESCE(SUM(debit_cents), 0) FROM transactions WHERE {where_exp}", params
        ).fetchone()[0]
    return euros(income_cents), euros(expense_cents)


def monthly_totals(db_path: Path = DEFAULT_DB_PATH) -> list[dict[str, Any]]:
    """Per-budget-month totals (euros), oldest first, for trend/comparison.

    income/expenses use the same definition as income_and_expenses (income = Σ credits of
    kind='income', expenses = Σ debits of kind='expense'; transfers excluded); net = income −
    expenses (operating). epargne/desepargne are the per-month savings nets (see _savings_by_month),
    and reste = income − expenses − epargne + desepargne — the savings-inclusive leftover that
    matches the Dashboard 'reste' and the balance-tree total for that month."""
    query = (
        "SELECT budget_month, "
        "COALESCE(SUM(CASE WHEN kind = 'income' THEN credit_cents ELSE 0 END), 0), "
        "COALESCE(SUM(CASE WHEN kind = 'expense' THEN debit_cents ELSE 0 END), 0) "
        "FROM transactions GROUP BY budget_month ORDER BY budget_month"
    )
    with connect(db_path) as conn:
        rows = conn.execute(query).fetchall()
        savings = _savings_by_month(conn)
    result: list[dict[str, Any]] = []
    for month, income_cents, expense_cents in rows:
        epargne_cents, desepargne_cents = savings.get(month, (0, 0))
        result.append(
            {
                "month": month,
                "income": euros(income_cents),
                "expenses": euros(expense_cents),
                "net": euros(income_cents - expense_cents),
                "epargne": euros(epargne_cents),
                "desepargne": euros(desepargne_cents),
                "reste": euros(income_cents - expense_cents - epargne_cents + desepargne_cents),
            }
        )
    return result


def transfers_summary(db_path: Path = DEFAULT_DB_PATH, month: str | None = None) -> dict[str, Any]:
    """Count and total (euros) of auto-paired internal transfers for the month. Single-legged
    external-savings deposits (transfer_group_id IS NULL) are excluded — they aren't internal
    movements between two of our accounts."""
    query = (
        "SELECT COUNT(*), COALESCE(SUM(debit_cents), 0) FROM transactions "
        "WHERE kind = 'transfer' AND debit_cents > 0 AND transfer_group_id IS NOT NULL"
    )
    params: tuple = ()
    if month:
        query += " AND budget_month = ?"
        params = (month,)
    with connect(db_path) as conn:
        count, total_cents = conn.execute(query, params).fetchone()
    return {"count": count, "total": euros(total_cents)}


def _savings_net_cents(conn, month: str | None) -> list[tuple[str, str, str | None, int, int]]:
    """(code, label, deposit_pattern, epargne_cents, desepargne_cents) per `type='savings'`
    account. The net is computed per budget-month, then bucketed by sign: epargne_cents sums the
    months with a positive net (money saved), desepargne_cents sums |net| of the negative months
    (money dipped into). For a single `month` only one bucket is non-zero; for `month=None` an
    account can have both (saved some months, withdrew others) — that is what makes the
    all-months view surface a désépargne it would otherwise net away.

    An imported account (deposit_pattern NULL, e.g. LIVRET): per-month net = Σcredit − Σdebit on
    its own rows (any kind — a paired transfer leg, interest, …; credit in = saving). An external
    account (deposit_pattern set, the kids' Livret A): per-month net = Σdebit − Σcredit of the
    checking-account rows whose libellé matches the pattern (a debit out = a deposit to savings).
    Accounts with no movement are omitted."""
    results: list[tuple[str, str, str | None, int, int]] = []
    for code, label, pattern in savings_accounts(conn):
        epargne = desepargne = 0
        for _bm, net in _savings_month_nets(conn, code, pattern, month):
            if net > 0:
                epargne += net
            elif net < 0:
                desepargne += -net
        if epargne or desepargne:
            results.append((code, label, pattern, epargne, desepargne))
    return results


def _savings_month_nets(conn, code: str, pattern: str | None, month: str | None) -> list[tuple[str, int]]:
    """[(budget_month, net_cents)] for one savings account (net > 0 = money saved that month).
    An imported account (pattern NULL) nets its own rows' Σcredit − Σdebit; an external one
    (pattern set, the kids' Livret A) nets the funding checking-account rows' Σdebit − Σcredit
    matched by libellé. Restricted to `month` when given."""
    if pattern:
        query = (
            "SELECT budget_month, COALESCE(SUM(debit_cents), 0) - COALESCE(SUM(credit_cents), 0) "
            "FROM transactions WHERE instr(libelle, ?) > 0"
        )
        params: list = [pattern]
    else:
        query = (
            "SELECT budget_month, COALESCE(SUM(credit_cents), 0) - COALESCE(SUM(debit_cents), 0) "
            "FROM transactions WHERE account_id = ?"
        )
        params = [code]
    if month:
        query += " AND budget_month = ?"
        params.append(month)
    query += " GROUP BY budget_month"
    return conn.execute(query, params).fetchall()


def _savings_by_month(conn) -> dict[str, tuple[int, int]]:
    """budget_month -> (epargne_cents, desepargne_cents) aggregated across all savings accounts,
    bucketed per account-month by sign so a month nets to money-saved vs money-dipped (mirrors
    _savings_net_cents but keyed by month, for the trend series)."""
    out: dict[str, list[int]] = {}
    for code, _label, pattern in savings_accounts(conn):
        for bm, net in _savings_month_nets(conn, code, pattern, None):
            bucket = out.setdefault(bm, [0, 0])
            if net > 0:
                bucket[0] += net
            elif net < 0:
                bucket[1] += -net
    return {bm: (e, d) for bm, (e, d) in out.items()}
