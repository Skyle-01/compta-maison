# Consolidate duplicated test helpers into conftest

## Context

- The "row tuples → parser row dicts → `import_transactions`" helper exists five times:
  `_import` in `tests/test_categorize.py`, `test_periods.py`, `test_transfers.py` (identical),
  `_make_df` in `test_db.py` (a pandas-era name), and inline in `test_api.py`
  (`TestDashboard::test_categorised_epargne_and_deficit_rows_not_double_counted`). Each re-encodes
  the parser's row keys (`"Date operation"`, `"Libelle"`, `"Debit"`, …), so a change to that shape
  means five edits.
- "Fresh DB + test accounts" repeats the `db` fixture body twice in `test_api.py`
  (`test_overrides_round_trip`, `test_manual_pair_and_unpair_round_trip`).
- `TestResetDb._isolate` and `TestUploadMatchesRebuild._reset_db` do the same three
  `monkeypatch.setattr(reset_db, ...)`.
- About 20 function-local imports in `test_api.py` re-import names already imported at module top
  (`connect` alone 10×).
- `test_migration.py` is misnamed (no migrations exist): it tests `init_db` / `upsert_accounts`,
  i.e. `db.py`, like `test_db.py`.

## To do / to investigate

- conftest: one `import_rows(db, *rows)`, one `make_db(path)` (used by the `db` fixture), one
  fixture pointing `reset_db`'s `INPUTS_DIR` / `BACKUPS_DIR` / `CONFIG_DIR` at `tmp_path`.
- Drop the redundant local imports; fold `test_migration.py` into `test_db.py`.
- Tests only: run the full pytest suite.

## Progress

- 2026-09-26: found in the stack review (~30 lines + ~20 imports to remove).
