import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.categories import category_paths, csv_response, reject_group_target
from app.api.deps import get_db_path
from app.core.categorize import apply_rules
from app.core.periods import recompute_budget_months
from app.db import connect
from app.schemas import RuleIn, RuleOut

router = APIRouter(prefix="/api/rules", tags=["rules"])

_COLUMNS = "id, category_id, pattern, priority, is_income_anchor, description"


def _to_model(row: tuple) -> RuleOut:
    id_, category_id, pattern, priority, is_income_anchor, description = row
    return RuleOut(
        id=id_,
        category_id=category_id,
        pattern=pattern,
        priority=priority,
        is_income_anchor=bool(is_income_anchor),
        description=description,
    )


def _refresh(db_path: Path) -> None:
    """Rule changes can move both category assignments and (for anchors) period boundaries."""
    apply_rules(db_path)
    recompute_budget_months(db_path)


@router.get("", response_model=list[RuleOut])
def list_rules(category_id: int | None = None, db_path: Path = Depends(get_db_path)) -> list[RuleOut]:
    query = f"SELECT {_COLUMNS} FROM label_rules"
    params: tuple = ()
    if category_id is not None:
        query += " WHERE category_id = ?"
        params = (category_id,)
    with connect(db_path) as conn:
        rows = conn.execute(query + " ORDER BY priority, id", params).fetchall()
    return [_to_model(row) for row in rows]


@router.get("/export")
def export_rules(db_path: Path = Depends(get_db_path)) -> Response:
    """Download every rule as CSV, keyed by category path (drop it in a config dir and rebuild
    with reset_db.py --source defaults --from DIR)."""
    with connect(db_path) as conn:
        paths = category_paths(conn)
        rows = conn.execute(f"SELECT {_COLUMNS} FROM label_rules ORDER BY priority, id").fetchall()
    out = [
        [paths.get(category_id, ""), pattern, priority, is_income_anchor, description or ""]
        for _id, category_id, pattern, priority, is_income_anchor, description in rows
    ]
    header = ["category_path", "pattern", "priority", "is_income_anchor", "description"]
    return csv_response(out, header, "rules.csv")


@router.post("", response_model=RuleOut, status_code=201)
def create_rule(rule: RuleIn, db_path: Path = Depends(get_db_path)) -> RuleOut:
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
        raise HTTPException(422, detail=[f"Unknown category id: {rule.category_id}"]) from exc
    _refresh(db_path)
    return RuleOut(id=rule_id, **rule.model_dump())


@router.put("/{rule_id}", response_model=RuleOut)
def update_rule(rule_id: int, rule: RuleIn, db_path: Path = Depends(get_db_path)) -> RuleOut:
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
                raise HTTPException(404, detail=[f"No rule with id {rule_id}"])
    except sqlite3.IntegrityError as exc:
        raise HTTPException(422, detail=[f"Unknown category id: {rule.category_id}"]) from exc
    _refresh(db_path)
    return RuleOut(id=rule_id, **rule.model_dump())


@router.delete("/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db_path: Path = Depends(get_db_path)) -> None:
    with connect(db_path) as conn:
        cur = conn.execute("DELETE FROM label_rules WHERE id = ?", (rule_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail=[f"No rule with id {rule_id}"])
    _refresh(db_path)
