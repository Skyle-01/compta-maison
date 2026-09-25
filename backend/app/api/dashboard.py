from pathlib import Path

from fastapi import APIRouter, Depends

from typing import Any

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


def _top_level(tree: dict[str, Any], name: str) -> dict[str, Any] | None:
    return next((c for c in tree["children"] if c["name"] == name), None)


@router.get("", response_model=Dashboard)
def get_dashboard(month: str | None = None, db_path: Path = Depends(get_db_path)) -> Dashboard:
    with connect(db_path) as conn:
        months = [m for (m,) in conn.execute(
            "SELECT DISTINCT budget_month FROM transactions ORDER BY budget_month DESC"
        )]
    if month is None and months:
        month = months[0]

    tree = category_tree(db_path, month)
    income, expenses = income_and_expenses(db_path, month)

    # Savings are derived in the tree: money set aside reads as a debit under the 'Épargne'
    # top-level group, money pulled from reserves as a credit under 'Déficit'. Surface them once so
    # the cards, hero summary, and Sankey share a single source instead of re-deriving.
    epargne_node = _top_level(tree, "Épargne")
    deficit_node = _top_level(tree, "Déficit")
    epargne = epargne_node["debit"] if epargne_node else 0.0
    desepargne = deficit_node["credit"] if deficit_node else 0.0
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
