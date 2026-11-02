import sqlite3
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app.api.categories import reject_group_target
from app.api.deps import DbPath
from app.core.categorize import apply_rules
from app.core.periods import recompute_budget_months
from app.core.triage import rule_preview
from app.db import connect, euros
from app.schemas import RuleConflict, RuleIn, RuleOut, RulePreview

router = APIRouter(prefix="/api/rules", tags=["rules"])

# Each rule with the operations it classifies (apply_rules sets rule_id on non-manual rows only).
_SELECT_WITH_COUNTS = (
    "SELECT r.id, r.category_id, r.pattern, r.is_income_anchor, r.description, "
    "COUNT(t.id), COALESCE(SUM(t.debit_cents), 0), COALESCE(SUM(t.credit_cents), 0) "
    "FROM label_rules r LEFT JOIN transactions t ON t.rule_id = r.id"
)


def _to_model(row: tuple) -> RuleOut:
    id_, category_id, pattern, is_income_anchor, description, count, debit, credit = row
    return RuleOut(
        id=id_,
        category_id=category_id,
        pattern=pattern,
        is_income_anchor=bool(is_income_anchor),
        description=description,
        operation_count=count,
        debit=euros(debit),
        credit=euros(credit),
    )


def _get_one(db_path: Path, rule_id: int, with_conflicts: bool = False) -> RuleOut:
    with connect(db_path) as conn:
        row = conn.execute(f"{_SELECT_WITH_COUNTS} WHERE r.id = ? GROUP BY r.id", (rule_id,)).fetchone()
    rule = _to_model(row)
    if with_conflicts:
        _, overlaps = rule_preview(db_path, rule.pattern, rule.category_id, rule_id)
        rule.conflicts = [RuleConflict(**vars(o)) for o in overlaps]
    return rule


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
        rows = conn.execute(query + " GROUP BY r.id ORDER BY r.id", params).fetchall()
    return [_to_model(row) for row in rows]


@router.get("/preview")
def preview_rule(
    db_path: DbPath,
    pattern: Annotated[str, Query(min_length=1)],
    category_id: int | None = None,
    rule_id: int | None = None,
) -> RulePreview:
    """What a rule about to be saved would do: the uncategorised operations it would classify and
    the other rules (of another category) it would conflict with. `rule_id` = the rule being edited."""
    uncategorized, overlaps = rule_preview(db_path, pattern, category_id, rule_id)
    return RulePreview(uncategorized=uncategorized, conflicts=[RuleConflict(**vars(o)) for o in overlaps])


@router.post("", status_code=201)
def create_rule(rule: RuleIn, db_path: DbPath) -> RuleOut:
    try:
        with connect(db_path) as conn:
            reject_group_target(conn, rule.category_id)
            cur = conn.execute(
                "INSERT INTO label_rules (category_id, pattern, is_income_anchor, description) "
                "VALUES (?, ?, ?, ?)",
                (rule.category_id, rule.pattern, int(rule.is_income_anchor), rule.description),
            )
            rule_id = cur.lastrowid
    except sqlite3.IntegrityError as exc:
        raise HTTPException(422, detail=[f"Catégorie {rule.category_id} introuvable"]) from exc
    _refresh(db_path)
    return _get_one(db_path, rule_id, with_conflicts=True)


@router.put("/{rule_id}")
def update_rule(rule_id: int, rule: RuleIn, db_path: DbPath) -> RuleOut:
    try:
        with connect(db_path) as conn:
            reject_group_target(conn, rule.category_id)
            cur = conn.execute(
                "UPDATE label_rules SET category_id = ?, pattern = ?, is_income_anchor = ?, description = ? "
                "WHERE id = ?",
                (
                    rule.category_id,
                    rule.pattern,
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
    return _get_one(db_path, rule_id, with_conflicts=True)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db_path: DbPath) -> None:
    with connect(db_path) as conn:
        cur = conn.execute("DELETE FROM label_rules WHERE id = ?", (rule_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, detail=[f"Règle {rule_id} introuvable"])
    _refresh(db_path)
