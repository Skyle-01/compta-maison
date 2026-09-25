import csv
import io
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.deps import get_db_path
from app.core.categorize import apply_rules
from app.db import connect
from app.schemas import CategoryIn, CategoryOut

router = APIRouter(prefix="/api/categories", tags=["categories"])

# Full category paths use this separator (matches CategoryOut.path); the CLI importer splits on it.
PATH_SEP = " / "


def csv_response(rows: list[list], header: list[str], filename: str) -> Response:
    """Render rows as a semicolon-delimited, UTF-8-BOM CSV download (matches import_csv.py's format)."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return Response(
        content=buf.getvalue().encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _load_all(conn) -> list[CategoryOut]:
    rows = conn.execute(
        "SELECT c.id, c.name, c.parent_id, COUNT(r.id) "
        "FROM categories c LEFT JOIN label_rules r ON r.category_id = c.id "
        "GROUP BY c.id"
    ).fetchall()
    by_id = {row[0]: row for row in rows}

    def lineage(category_id: int) -> list[tuple]:
        chain = []
        current: int | None = category_id
        while current is not None:
            row = by_id[current]
            chain.append(row)
            current = row[2]
        return list(reversed(chain))  # root first

    out = []
    for category_id, name, parent_id, rule_count in rows:
        chain = lineage(category_id)
        out.append(CategoryOut(
            id=category_id,
            name=name,
            parent_id=parent_id,
            path=" / ".join(row[1] for row in chain),
            is_root=parent_id is None,
            rule_count=rule_count,
        ))
    return sorted(out, key=lambda c: c.path)


def category_paths(conn) -> dict[int, str]:
    """Map each category id to its full ` / `-joined path (shared by the export endpoints)."""
    return {c.id: c.path for c in _load_all(conn)}


def reject_group_target(conn, category_id: int) -> None:
    """Leaf-only assignment: raise 422 if `category_id` is an existing non-leaf (has children).

    Unknown ids are left to the caller's existence / FK handling.
    """
    child = conn.execute("SELECT 1 FROM categories WHERE parent_id = ?", (category_id,)).fetchone()
    if child:
        raise HTTPException(
            422, detail=[f"Category {category_id} is a group; assign rules/transactions to a leaf instead"]
        )


def reject_populated_parent(conn, parent_id: int | None) -> None:
    """Keep the leaf-only invariant: refuse to nest a child under a category that already
    has transactions or rules attached directly (it would become an unassignable group)."""
    if parent_id is None:
        return
    has_tx = conn.execute("SELECT 1 FROM transactions WHERE category_id = ?", (parent_id,)).fetchone()
    has_rule = conn.execute("SELECT 1 FROM label_rules WHERE category_id = ?", (parent_id,)).fetchone()
    if has_tx or has_rule:
        raise HTTPException(
            422,
            detail=["That parent already has transactions or rules; move them to a leaf before nesting under it"],
        )


def _get_one(conn, category_id: int) -> CategoryOut:
    for category in _load_all(conn):
        if category.id == category_id:
            return category
    raise HTTPException(404, detail=[f"No category with id {category_id}"])


@router.get("", response_model=list[CategoryOut])
def list_categories(db_path: Path = Depends(get_db_path)) -> list[CategoryOut]:
    with connect(db_path) as conn:
        return _load_all(conn)


@router.get("/export")
def export_categories(db_path: Path = Depends(get_db_path)) -> Response:
    """Download every category as a CSV of full paths (re-importable via scripts/import_csv.py)."""
    with connect(db_path) as conn:
        cats = _load_all(conn)  # already sorted by path -> parents precede children
    rows = [[c.path] for c in cats]
    return csv_response(rows, ["path"], "categories.csv")


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(category: CategoryIn, db_path: Path = Depends(get_db_path)) -> CategoryOut:
    with connect(db_path) as conn:
        try:
            cur = conn.execute(
                "INSERT INTO categories (name, parent_id) VALUES (?, ?)",
                (category.name, category.parent_id),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                409, detail=[f"'{category.name}' already exists under that parent, or the parent is unknown"]
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
        result = _get_one(conn, child_id)
    if moved:
        apply_rules(db_path)  # re-derive non-manual rows through the moved rules → child
    return result


@router.put("/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, category: CategoryIn, db_path: Path = Depends(get_db_path)) -> CategoryOut:
    with connect(db_path) as conn:
        # Reject cycles: the new parent must not be the category itself or one of its descendants.
        current: int | None = category.parent_id
        while current is not None:
            if current == category_id:
                raise HTTPException(422, detail=["A category cannot be moved under itself"])
            row = conn.execute("SELECT parent_id FROM categories WHERE id = ?", (current,)).fetchone()
            if row is None:
                raise HTTPException(422, detail=[f"No category with id {category.parent_id}"])
            current = row[0]
        reject_populated_parent(conn, category.parent_id)
        try:
            cur = conn.execute(
                "UPDATE categories SET name = ?, parent_id = ? WHERE id = ?",
                (category.name, category.parent_id, category_id),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, detail=[f"'{category.name}' already exists under that parent"]) from exc
        if cur.rowcount == 0:
            raise HTTPException(404, detail=[f"No category with id {category_id}"])
        return _get_one(conn, category_id)


@router.delete("/{category_id}", status_code=204)
def delete_category(category_id: int, db_path: Path = Depends(get_db_path)) -> None:
    with connect(db_path) as conn:
        child = conn.execute("SELECT id FROM categories WHERE parent_id = ?", (category_id,)).fetchone()
        if child:
            raise HTTPException(409, detail=["This category has subcategories; delete or move them first"])
        row = conn.execute("SELECT parent_id FROM categories WHERE id = ?", (category_id,)).fetchone()
        if row is None:
            raise HTTPException(404, detail=[f"No category with id {category_id}"])
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
            conn.execute("UPDATE label_rules SET category_id = ? WHERE category_id = ?", (parent_id, category_id))
            conn.execute(
                "UPDATE transactions SET category_id = ? WHERE category_id = ? AND category_manual = 1",
                (parent_id, category_id),
            )
        else:
            # Drop: transactions fall back to auto + uncategorised; rules cascade-delete with the row.
            conn.execute("UPDATE transactions SET category_manual = 0 WHERE category_id = ?", (category_id,))
        conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))  # FK: tx -> NULL, remaining rules cascade
    apply_rules(db_path)
