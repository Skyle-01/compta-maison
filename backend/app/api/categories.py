import sqlite3

from fastapi import APIRouter, HTTPException, Response

from app.api.deps import DbPath
from app.core.categorize import apply_rules
from app.core.config_export import category_paths, csv_text
from app.db import connect, euros, to_cents
from app.schemas import CategoryIn, CategoryMoveIn, CategoryOut, CategoryTargetIn

router = APIRouter(prefix="/api/categories", tags=["categories"])


def csv_response(rows: list[list], header: list[str], filename: str) -> Response:
    """A CSV download (see core.config_export.csv_text)."""
    return Response(
        content=csv_text(header, rows).encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _load_all(conn) -> list[CategoryOut]:
    paths = category_paths(conn)
    rows = conn.execute(
        "SELECT c.id, c.name, c.parent_id, c.budget_target_cents, COUNT(r.id) "
        "FROM categories c LEFT JOIN label_rules r ON r.category_id = c.id "
        "GROUP BY c.id"
    ).fetchall()
    out = [
        CategoryOut(
            id=category_id,
            name=name,
            parent_id=parent_id,
            path=paths[category_id],
            is_root=parent_id is None,
            rule_count=rule_count,
            budget_target=euros(target_cents) if target_cents is not None else None,
        )
        for category_id, name, parent_id, target_cents, rule_count in rows
    ]
    return sorted(out, key=lambda c: c.path)


def _name(conn, category_id: int) -> str:
    return conn.execute("SELECT name FROM categories WHERE id = ?", (category_id,)).fetchone()[0]


def reject_group_target(conn, category_id: int) -> None:
    """Leaf-only assignment: raise 422 if `category_id` is an existing non-leaf (has children).

    Unknown ids are left to the caller's existence / FK handling.
    """
    child = conn.execute("SELECT 1 FROM categories WHERE parent_id = ?", (category_id,)).fetchone()
    if child:
        name = _name(conn, category_id)
        raise HTTPException(422, detail=[f"« {name} » est un groupe : choisissez une de ses sous-catégories"])


def reject_populated_parent(conn, parent_id: int | None) -> None:
    """Keep the leaf-only invariant: refuse to nest a child under a category that already
    has transactions, rules or a budget target attached directly (it would become a group
    carrying them)."""
    if parent_id is None:
        return
    has_tx = conn.execute("SELECT 1 FROM transactions WHERE category_id = ?", (parent_id,)).fetchone()
    has_rule = conn.execute("SELECT 1 FROM label_rules WHERE category_id = ?", (parent_id,)).fetchone()
    has_target = conn.execute(
        "SELECT 1 FROM categories WHERE id = ? AND budget_target_cents IS NOT NULL", (parent_id,)
    ).fetchone()
    if has_tx or has_rule or has_target:
        raise HTTPException(
            422,
            detail=[
                f"« {_name(conn, parent_id)} » a déjà des opérations, des règles ou un objectif : "
                "créez-y d’abord une sous-catégorie, qui les reprendra"
            ],
        )


def _get_one(conn, category_id: int) -> CategoryOut:
    for category in _load_all(conn):
        if category.id == category_id:
            return category
    raise HTTPException(404, detail=[f"Catégorie {category_id} introuvable"])


@router.get("")
def list_categories(db_path: DbPath) -> list[CategoryOut]:
    with connect(db_path) as conn:
        return _load_all(conn)


@router.post("", status_code=201)
def create_category(category: CategoryIn, db_path: DbPath) -> CategoryOut:
    with connect(db_path) as conn:
        try:
            cur = conn.execute(
                "INSERT INTO categories (name, parent_id) VALUES (?, ?)",
                (category.name, category.parent_id),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                409,
                detail=[
                    f"« {category.name} » existe déjà à cet endroit, ou la catégorie parente est introuvable"
                ],
            ) from exc
        child_id = cur.lastrowid
        # Subdivide: a populated leaf hands its direct rules + transactions down to the new child,
        # so the parent becomes a clean group (the leaf-only invariant is preserved). For a parent
        # that was already a group these touch 0 rows, so this is a no-op there.
        moved = 0
        if category.parent_id is not None:
            moved += conn.execute(
                "UPDATE label_rules SET category_id = ? WHERE category_id = ?",
                (child_id, category.parent_id),
            ).rowcount
            moved += conn.execute(
                "UPDATE transactions SET category_id = ? WHERE category_id = ?",
                (child_id, category.parent_id),
            ).rowcount
            # The budget target moves down too (groups carry none, so a no-op there as well).
            conn.execute(
                "UPDATE categories SET budget_target_cents = "
                "(SELECT budget_target_cents FROM categories WHERE id = ?) WHERE id = ?",
                (category.parent_id, child_id),
            )
            conn.execute(
                "UPDATE categories SET budget_target_cents = NULL WHERE id = ?", (category.parent_id,)
            )
        result = _get_one(conn, child_id)
    if moved:
        apply_rules(db_path)  # re-derive non-manual rows through the moved rules → child
    return result


@router.put("/{category_id}")
def update_category(category_id: int, category: CategoryIn, db_path: DbPath) -> CategoryOut:
    with connect(db_path) as conn:
        # Reject cycles: the new parent must not be the category itself or one of its descendants.
        current: int | None = category.parent_id
        while current is not None:
            if current == category_id:
                raise HTTPException(
                    422,
                    detail=[
                        "Une catégorie ne peut pas être déplacée sous elle-même ni sous une de ses sous-catégories"
                    ],
                )
            row = conn.execute("SELECT parent_id FROM categories WHERE id = ?", (current,)).fetchone()
            if row is None:
                raise HTTPException(422, detail=[f"Catégorie {category.parent_id} introuvable"])
            current = row[0]
        reject_populated_parent(conn, category.parent_id)
        try:
            cur = conn.execute(
                "UPDATE categories SET name = ?, parent_id = ? WHERE id = ?",
                (category.name, category.parent_id, category_id),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, detail=[f"« {category.name} » existe déjà à cet endroit"]) from exc
        if cur.rowcount == 0:
            raise HTTPException(404, detail=[f"Catégorie {category_id} introuvable"])
        return _get_one(conn, category_id)


def _missing(conn, table: str, ids: list[int]) -> list[int]:
    marks = ",".join("?" * len(ids))
    found = {row[0] for row in conn.execute(f"SELECT id FROM {table} WHERE id IN ({marks})", ids)}
    return [i for i in ids if i not in found]


@router.post("/{category_id}/move", status_code=204)
def move_to_category(category_id: int, move: CategoryMoveIn, db_path: DbPath) -> None:
    """Move rules and manual assignments into the leaf `category_id` (the Catégories page, and its
    undo). A rule takes every operation it classifies along; a manual operation keeps its note.
    Everything is checked before anything moves."""
    rule_ids = sorted(set(move.rule_ids))
    tx_ids = sorted(set(move.transaction_ids))
    if not rule_ids and not tx_ids:
        raise HTTPException(422, detail=["Rien à déplacer : cochez au moins une règle ou une opération"])
    with connect(db_path) as conn:
        _get_one(conn, category_id)  # 404 first
        reject_group_target(conn, category_id)
        if rule_ids and (missing := _missing(conn, "label_rules", rule_ids)):
            raise HTTPException(404, detail=[f"Règles introuvables : {', '.join(map(str, missing))}"])
        if tx_ids:
            if missing := _missing(conn, "transactions", tx_ids):
                raise HTTPException(404, detail=[f"Opérations introuvables : {', '.join(map(str, missing))}"])
            marks = ",".join("?" * len(tx_ids))
            automatic = [
                row[0]
                for row in conn.execute(
                    f"SELECT id FROM transactions WHERE id IN ({marks}) AND category_manual = 0", tx_ids
                )
            ]
            if automatic:
                raise HTTPException(
                    422,
                    detail=[
                        "Seules les opérations classées à la main se déplacent : "
                        f"{', '.join(map(str, automatic))} suivent leur règle"
                    ],
                )
            conn.execute(
                f"UPDATE transactions SET category_id = ? WHERE id IN ({marks})", (category_id, *tx_ids)
            )
        if rule_ids:
            marks = ",".join("?" * len(rule_ids))
            conn.execute(
                f"UPDATE label_rules SET category_id = ? WHERE id IN ({marks})", (category_id, *rule_ids)
            )
    if rule_ids:
        # The income-anchor test ignores the category, so budget months don't move.
        apply_rules(db_path)


@router.put("/{category_id}/target")
def set_category_target(category_id: int, target: CategoryTargetIn, db_path: DbPath) -> CategoryOut:
    """Set (euros, > 0) or clear (null) a leaf's monthly budget target. Groups show the sum of
    their leaves' targets, so they cannot hold one themselves (422)."""
    with connect(db_path) as conn:
        _get_one(conn, category_id)  # 404 first
        reject_group_target(conn, category_id)
        cents = to_cents(target.budget_target) if target.budget_target is not None else None
        if cents is not None and cents <= 0:
            raise HTTPException(422, detail=["Un objectif doit valoir au moins 0,01 €"])
        conn.execute("UPDATE categories SET budget_target_cents = ? WHERE id = ?", (cents, category_id))
        return _get_one(conn, category_id)


@router.delete("/{category_id}", status_code=204)
def delete_category(category_id: int, db_path: DbPath) -> None:
    with connect(db_path) as conn:
        child = conn.execute("SELECT id FROM categories WHERE parent_id = ?", (category_id,)).fetchone()
        if child:
            raise HTTPException(
                409, detail=["Cette catégorie a des sous-catégories : supprimez-les ou déplacez-les d’abord"]
            )
        row = conn.execute("SELECT parent_id FROM categories WHERE id = ?", (category_id,)).fetchone()
        if row is None:
            raise HTTPException(404, detail=[f"Catégorie {category_id} introuvable"])
        parent_id = row[0]
        siblings = (
            conn.execute("SELECT COUNT(*) FROM categories WHERE parent_id = ?", (parent_id,)).fetchone()[0]
            if parent_id is not None
            else 0
        )
        if parent_id is not None and siblings == 1:
            # Last child: roll its rules + manual transactions up to the parent, which becomes a leaf
            # again. Non-manual rows are released by the FK below and re-derived by apply_rules through
            # the rules now on the parent. (Inverse of the subdivide migration.)
            conn.execute(
                "UPDATE label_rules SET category_id = ? WHERE category_id = ?", (parent_id, category_id)
            )
            conn.execute(
                "UPDATE transactions SET category_id = ? WHERE category_id = ? AND category_manual = 1",
                (parent_id, category_id),
            )
            conn.execute(
                "UPDATE categories SET budget_target_cents = "
                "(SELECT budget_target_cents FROM categories WHERE id = ?) WHERE id = ?",
                (category_id, parent_id),
            )
        else:
            # Drop: transactions fall back to auto + uncategorised; rules cascade-delete with the row.
            conn.execute("UPDATE transactions SET category_manual = 0 WHERE category_id = ?", (category_id,))
        conn.execute(
            "DELETE FROM categories WHERE id = ?", (category_id,)
        )  # FK: tx -> NULL, remaining rules cascade
    apply_rules(db_path)
