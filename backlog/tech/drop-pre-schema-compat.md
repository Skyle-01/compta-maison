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

- Once the live DB has been rebuilt after 2026-09-26 (`--source live`, or `--source defaults`
  from exported CSVs), delete both branches, the docstring caveat and the test (~10 lines), and
  the related note in CLAUDE.md's Current State.

## Progress

- 2026-09-26: found in the stack review; blocked on the owner's rebuild.
- 2026-09-27: the owner's old DB may predate the `accounts` table (accounts were then created
  while parsing; they have no accounts.csv). `export_current` then fails with `sqlite3.OperationalError:
  no such table: accounts` before deleting anything, even with `--source defaults`, since any
  existing DB is snapshotted first. Their path: leave the old `compta.db` out of the new clone,
  put the exported categories/rules/overrides CSVs plus a hand-written `accounts.csv` in
  `_config/`, and run `reset_db.py --source defaults`.
- 2026-09-27: unblocked. The owner rebuilt their real DB that way: every statement resolved to
  an account, all manual overrides restored (none skipped). No DB built before 2026-09-26 is left,
  so the compat branches can go; the pre-accounts crash above needs no fix either (no such DB
  remains).
