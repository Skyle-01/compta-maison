from typing import Any, Literal

from fastapi import APIRouter

from app.api.deps import DbPath
from app.core.categorize import (
    INCOME_GROUP,
    budget_status,
    category_averages,
    category_tree,
    income_and_expenses,
    monthly_totals,
    transfers_summary,
    uncategorized_balance,
)
from app.db import connect
from app.schemas import CategoryAverages, Dashboard

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

# `?month=all`: every budget month at once (savings then show both an Épargne and a Déficit leaf
# for an account that saved some months and withdrew others; see category_tree).
ALL_MONTHS = "all"


def _savings_leaves(node: dict[str, Any]) -> list[dict[str, Any]]:
    """Every derived savings leaf (synthetic, childless) in the tree, wherever it hangs."""
    if node.get("synthetic") and not node["children"]:
        return [node]
    return [leaf for child in node["children"] for leaf in _savings_leaves(child)]


@router.get("")
def get_dashboard(db_path: DbPath, month: str | None = None) -> Dashboard:
    with connect(db_path) as conn:
        months = [
            m
            for (m,) in conn.execute(
                "SELECT DISTINCT budget_month FROM transactions ORDER BY budget_month DESC"
            )
        ]
    if month is None and months:
        month = months[0]
    period = None if month == ALL_MONTHS else month

    tree = category_tree(db_path, period)
    income, expenses = income_and_expenses(db_path, period)

    # Savings are derived in the tree: money set aside is a debit leaf under 'Épargne', money pulled
    # from reserves a credit leaf under 'Déficit'. Sum only those derived leaves — not the whole
    # top-level nodes, whose real categorised rows are already in income/expenses and would
    # otherwise be counted twice. One source for the cards, hero summary, and Sankey.
    leaves = _savings_leaves(tree)
    epargne = round(sum(leaf["debit"] for leaf in leaves), 2)
    desepargne = round(sum(leaf["credit"] for leaf in leaves), 2)
    # The headline leftover, defined so the four cards reconcile exactly:
    # Revenus − Dépenses − Épargne nette = Reste. For normal data (kind follows the credit/debit
    # sign) this also equals the balance-tree total (tree['balance']) and the Sankey 'Reste'.
    reste = round(income - expenses - epargne + desepargne, 2)

    return Dashboard(
        month=month,
        months_available=months,
        income=income,
        expenses=expenses,
        epargne=epargne,
        desepargne=desepargne,
        reste=reste,
        by_category=tree,
        uncategorized=uncategorized_balance(db_path, period),
        transfers=transfers_summary(db_path, period),
        history=monthly_totals(db_path),
        # With no data yet there is no month: count one so targets still show at face value.
        budget=_budget(db_path, period, max(1, len(months)) if period is None else 1, epargne - desepargne),
    )


def _budget(db_path: DbPath, period: str | None, n_months: int, savings: float) -> dict[str, Any]:
    """budget_status plus what balances it: the reference income (the net average month of the
    INCOME_GROUP top-level category over the last 12 complete budget months: no rent received nor
    savings withdrawn) and the net savings of the period."""
    groups = category_averages(db_path, 12, None)["groups"]
    income = next((g["income"] - g["expenses"] for g in groups if g["name"] == INCOME_GROUP), 0.0)
    return {
        **budget_status(db_path, period, n_months),
        "income_reference": round(income, 2),
        "savings_actual": round(savings, 2),
    }


@router.get("/averages")
def get_averages(
    db_path: DbPath, months: Literal["3", "6", "12", "all"] = "6", month: str | None = None
) -> CategoryAverages:
    """Average month per category over the last `months` complete budget months (see
    category_averages), compared with the dashboard's `month` (none for every month)."""
    n_months = None if months == ALL_MONTHS else int(months)
    return CategoryAverages(**category_averages(db_path, n_months, None if month == ALL_MONTHS else month))
