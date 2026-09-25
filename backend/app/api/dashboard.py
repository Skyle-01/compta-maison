from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import get_db_path
from app.core.categorize import (
    category_tree,
    income_and_expenses,
    monthly_totals,
    transfers_summary,
    uncategorized_balance,
)
from app.db import connect
from app.schemas import Dashboard

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _savings_leaves(node: dict[str, Any]) -> list[dict[str, Any]]:
    """Every derived savings leaf (synthetic, childless) in the tree, wherever it hangs."""
    if node.get("synthetic") and not node["children"]:
        return [node]
    return [leaf for child in node["children"] for leaf in _savings_leaves(child)]


@router.get("", response_model=Dashboard)
def get_dashboard(month: str | None = None, db_path: Path = Depends(get_db_path)) -> Dashboard:
    with connect(db_path) as conn:
        months = [
            m
            for (m,) in conn.execute(
                "SELECT DISTINCT budget_month FROM transactions ORDER BY budget_month DESC"
            )
        ]
    if month is None and months:
        month = months[0]

    tree = category_tree(db_path, month)
    income, expenses = income_and_expenses(db_path, month)

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
        net=round(income - expenses, 2),
        epargne=epargne,
        desepargne=desepargne,
        reste=reste,
        by_category=tree,
        uncategorized=uncategorized_balance(db_path, month),
        transfers=transfers_summary(db_path, month),
        history=monthly_totals(db_path),
    )
