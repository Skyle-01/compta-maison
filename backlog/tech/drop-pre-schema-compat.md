# Drop the pre-2026-09-26 schema checks once the live DB is rebuilt

## Context

So that `reset_db.py --source live` can snapshot a DB built before the latest schema changes:
- `api/categories.py::category_rows` checks `PRAGMA table_info(categories)` for
  `budget_target_cents`;
- `scripts/reset_db.py::export_current` checks `sqlite_master` for the `transfer_markers` table
  (and only writes `transfer_markers.csv` when it exists);
- `_path_map`'s docstring mentions it; `test_snapshot_of_db_without_the_column` covers it.

This is how "no migration ladder" works, so it is load-bearing until the owner's `compta.db` has
been rebuilt.

## To do / to investigate

- Once the live DB has been rebuilt with `reset_db.py --source live` after 2026-09-26, delete both
  branches, the docstring caveat and the test (~10 lines), and the related note in CLAUDE.md's
  Current State.

## Progress

- 2026-09-26: found in the stack review; blocked on the owner's rebuild.
