import csv
import io
import sqlite3

from fastapi import APIRouter, HTTPException, Response

from app.api.deps import DbPath
from app.core.categorize import apply_rules
from app.db import connect, euros, to_cents
from app.schemas import CategoryIn, CategoryOut, CategoryTargetIn

router = APIRouter(prefix="/api/categories", tags=["categories"])

# Full category paths use this separator (matches CategoryOut.path); the CLI importer splits on it.
PATH_SEP = " / "


def csv_text(header: list[str], rows: list[list]) -> str:
    """Semicolon-delimited CSV, the format scripts/import_csv.py reads (written as UTF-8 with a BOM,
    by csv_response for the Settings exports and by reset_db.py for the _backups/ snapshots)."""
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buf.getvalue()


def csv_response(rows: list[list], header: list[str], filename: str) -> Response:
    """A CSV download (see csv_text)."""
    return Response(
        content=csv_text(header, rows).encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _path_map(conn) -> dict[int, str]:
    """Map each category id to its full ` / `-joined path. Reads only id/name/parent_id, so it also
    works on a database from before the budget-target column (reset_db.py snapshots one)."""
    by_id = {
        cid: (name, parent_id)
        for cid, name, parent_id in conn.execute("SELECT id, name, parent_id FROM categories")
    }

    def path(category_id: int) -> str:
        chain = []
        current: int | None = category_id
        while current is not None:
            name, current = by_id[current]
            chain.append(name)
        return PATH_SEP.join(reversed(chain))  # root first

    return {cid: path(cid) for cid in by_id}


def _load_all(conn) -> list[CategoryOut]:
    paths = _path_map(conn)
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


def category_paths(conn) -> dict[int, str]:
    """Map each category id to its full ` / `-joined path (shared by the export endpoints)."""
    return _path_map(conn)


# categories.csv columns (Settings export, _backups/ snapshots, data/ and _config/).
CATEGORIES_HEADER = ["path", "budget_target"]


def category_rows(conn) -> list[list[str]]:
    """categories.csv rows `[path, budget_target]`, sorted by path so parents precede children.
    The target is in euros (`300.00`), empty when unset — or always empty on a database from before
    the budget-target column (a pre-change live DB snapshotted by reset_db.py)."""
    columns = {row[1] for row in conn.execute("PRAGMA table_info(categories)")}
    targets: dict[int, int] = {}
    if "budget_target_cents" in columns:
        targets = dict(
            conn.execute(
                "SELECT id, budget_target_cents FROM categories WHERE budget_target_cents IS NOT NULL"
            ).fetchall()
        )
    paths = _path_map(conn)
    return sorted(
        [path, f"{euros(targets[cid]):.2f}" if cid in targets else ""] for cid, path in paths.items()
    )


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
                "That parent already has transactions, rules or a budget target; "
                "move them to a leaf before nesting under it"
            ],
        )


def _get_one(conn, category_id: int) -> CategoryOut:
    for category in _load_all(conn):
        if category.id == category_id:
            return category
    raise HTTPException(404, detail=[f"No category with id {category_id}"])


@router.get("")
def list_categories(db_path: DbPath) -> list[CategoryOut]:
    with connect(db_path) as conn:
        return _load_all(conn)


@router.get("/export")
def export_categories(db_path: DbPath) -> Response:
    """Download every category as a CSV of full paths (drop it in a config dir and rebuild with
    reset_db.py --source defaults --from DIR)."""
    with connect(db_path) as conn:
        rows = category_rows(conn)
    return csv_response(rows, CATEGORIES_HEADER, "categories.csv")


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


@router.put("/{category_id}/target")
def set_category_target(category_id: int, target: CategoryTargetIn, db_path: DbPath) -> CategoryOut:
    """Set (euros, > 0) or clear (null) a leaf's monthly budget target. Groups show the sum of
    their leaves' targets, so they cannot hold one themselves (422)."""
    with connect(db_path) as conn:
        _get_one(conn, category_id)  # 404 first
        reject_group_target(conn, category_id)
        cents = to_cents(target.budget_target) if target.budget_target is not None else None
        if cents is not None and cents <= 0:
            raise HTTPException(422, detail=["A budget target must be at least 0.01 €"])
        conn.execute("UPDATE categories SET budget_target_cents = ? WHERE id = ?", (cents, category_id))
        return _get_one(conn, category_id)


@router.delete("/{category_id}", status_code=204)
def delete_category(category_id: int, db_path: DbPath) -> None:
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
