import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response

from app.api.categories import category_paths, csv_response, reject_group_target
from app.api.deps import DbPath
from app.core.categorize import apply_rules
from app.core.periods import recompute_budget_months
from app.core.triage import rule_preview
from app.db import connect, euros
from app.schemas import RuleIn, RuleLoss, RuleOut, RulePreview

router = APIRouter(prefix="/api/rules", tags=["rules"])

_COLUMNS = "id, category_id, pattern, priority, is_income_anchor, description"
RULES_HEADER = ["category_path", "pattern", "priority", "is_income_anchor", "description"]

# Each rule with the operations it classifies (apply_rules sets rule_id on non-manual rows only).
_SELECT_WITH_COUNTS = (
    "SELECT r.id, r.category_id, r.pattern, r.priority, r.is_income_anchor, r.description, "
    "COUNT(t.id), COALESCE(SUM(t.debit_cents), 0), COALESCE(SUM(t.credit_cents), 0) "
    "FROM label_rules r LEFT JOIN transactions t ON t.rule_id = r.id"
)


def _to_model(row: tuple) -> RuleOut:
    id_, category_id, pattern, priority, is_income_anchor, description, count, debit, credit = row
    return RuleOut(
        id=id_,
        category_id=category_id,
        pattern=pattern,
        priority=priority,
        is_income_anchor=bool(is_income_anchor),
        description=description,
        operation_count=count,
        debit=euros(debit),
        credit=euros(credit),
    )


def _get_one(db_path: Path, rule_id: int) -> RuleOut:
    with connect(db_path) as conn:
        row = conn.execute(f"{_SELECT_WITH_COUNTS} WHERE r.id = ? GROUP BY r.id", (rule_id,)).fetchone()
    return _to_model(row)


def rule_rows(conn: sqlite3.Connection, path_by_id: dict[int, str]) -> list[list]:
    """Every rule as rules.csv rows, keyed by category path (shared by the Catégories page export and
    reset_db.py's snapshot)."""
    rows = conn.execute(f"SELECT {_COLUMNS} FROM label_rules ORDER BY priority, id").fetchall()
    return [
        [path_by_id.get(category_id, ""), pattern, priority, is_income_anchor, description or ""]
        for _id, category_id, pattern, priority, is_income_anchor, description in rows
    ]


def _refresh(db_path: Path) -> None:
    """Rule changes can move both category assignments and (for anchors) period boundaries."""
    apply_rules(db_path)
    recompute_budget_months(db_path)


@router.get("")
def list_rules(db_path: DbPath, category_id: int | None = None) -> list[RuleOut]:
    query = _SELECT_WITH_COUNTS
    params: tuple = ()
    if category_id is not None:
        query += " WHERE r.category_id = ?"
        params = (category_id,)
    with connect(db_path) as conn:
        rows = conn.execute(query + " GROUP BY r.id ORDER BY r.priority, r.id", params).fetchall()
    return [_to_model(row) for row in rows]


@router.get("/export")
def export_rules(db_path: DbPath) -> Response:
    """Download every rule as CSV, keyed by category path (drop it in a config dir and rebuild
    with reset_db.py --source defaults --from DIR)."""
    with connect(db_path) as conn:
        rows = rule_rows(conn, category_paths(conn))
    return csv_response(rows, RULES_HEADER, "rules.csv")


@router.get("/preview")
def preview_rule(
    db_path: DbPath,
    pattern: Annotated[str, Query(min_length=1)],
    priority: int = 100,
    category_id: int | None = None,
) -> RulePreview:
    """What a rule about to be created would classify: uncategorised operations it matches, and
    rows existing rules would lose to it (rules already on `category_id` left out)."""
    uncategorized, lost = rule_preview(db_path, pattern, priority, category_id)
    return RulePreview(uncategorized=uncategorized, reclassified=[RuleLoss(**vars(r)) for r in lost])


@router.post("", status_code=201)
def create_rule(rule: RuleIn, db_path: DbPath) -> RuleOut:
    try:
        with connect(db_path) as conn:
            reject_group_target(conn, rule.category_id)
            cur = conn.execute(
                "INSERT INTO label_rules (category_id, pattern, priority, is_income_anchor, description) "
                "VALUES (?, ?, ?, ?, ?)",
                (rule.category_id, rule.pattern, rule.priority, int(rule.is_income_anchor), rule.description),
            )
            rule_id = cur.lastrowid
    except sqlite3.IntegrityError as exc:
        raise HTTPException(422, detail=[f"Catégorie {rule.category_id} introuvable"]) from exc
    _refresh(db_path)
    return _get_one(db_path, rule_id)


@router.put("/{rule_id}")
def update_rule(rule_id: int, rule: RuleIn, db_path: DbPath) -> RuleOut:
    try:
        with connect(db_path) as conn:
            reject_group_target(conn, rule.category_id)
            cur = conn.execute(
                "UPDATE label_rules SET category_id = ?, pattern = ?, priority = ?, "
                "is_income_anchor = ?, description = ? WHERE id = ?",
                (
                    rule.category_id,
                    rule.pattern,
                    rule.priority,
                    int(rule.is_income_anchor),
                    rule.description,
                    rule_id,
                ),
            )
            if cur.rowcount == 0:
                raise HTTPException(404, detail=[f"Règle {rule_id} introuvable"])
    except sqlite3.IntegrityError as exc:
        raise HTTPException(422, detail=[f"Catégorie {rule.category_id} introuvable"]) from exc
    _refresh(db_path)
    return _get_one(db_path, rule_id)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db_path: DbPath) -> None:
    with connect(db_path) as conn:
        cur = conn.execute("DELETE FROM label_rules WHERE id = ?", (rule_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail=[f"Règle {rule_id} introuvable"])
    _refresh(db_path)
