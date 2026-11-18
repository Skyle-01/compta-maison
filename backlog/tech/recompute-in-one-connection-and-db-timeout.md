# The recompute tail commits in three steps and the database has no lock timeout

## Context

`backend/app/core/recompute.py:8-14` (`recompute_all`) calls `recompute_budget_months(db_path)`, `recompute_transfers(db_path)` and `apply_rules(db_path)` in turn. Each opens its own `connect()` (`db.py:337-349`), which commits when its block ends, and `upload_csv` (`api/imports.py:95-96`) has already committed the inserted rows. So:

- A failure in step 2 or 3 leaves the imported rows saved with budget months updated but transfers or rule categories stale, and a 500 for the caller. Another request reading in between sees the mixed state. The rule routes (`api/rules.py`) do the same after their own commit.
- `sqlite3.connect(db_path)` (`db.py:340`) uses the default 5 s timeout and no WAL. FastAPI runs the `def` routes in a thread pool, so an upload and a rule edit from two browser tabs can overlap; the one that waits more than 5 s fails with « database is locked » (inferred, not reproduced). Single user, so the impact is limited.

Owner decision (2026-11-18): include it in the correction series, minimal change.

## To do / to investigate

- Smallest change first: give `sqlite3.connect` a longer timeout (for example `timeout=30`). Do not add WAL unless a test or a reproduction shows the lock still fails; WAL adds `-wal`/`-shm` files next to the database that the backup and `COMPTA_DB` handling (`config_export.backups_dir`, the sqlite backup API in `save_config`) would have to account for.
- Atomic recompute: the three steps take a `db_path` today (no core function has a default `db_path`, a convention of the project). Decide between (a) a variant of each taking an open connection, `recompute_all` opening one `connect()` around the three calls, the `db_path` versions staying as thin wrappers for their other callers (`api/rules.py`, `pair_manually`, `set_transfer_mode`), and (b) leaving the three commits and documenting that a re-run is idempotent (it is: `recompute_transfers` resets then re-derives). Pick (b) if (a) needs more than a few lines per function; say which in the progress notes.
- Check `recompute_transfers`' own manual-decision paths (`pair_manually`, `set_transfer_mode`, `transfers.py:331-405`): each commits its decision before calling `recompute_transfers` in a second connection, so a failure leaves the decision stored without the split cleanup. Same treatment as `recompute_all`, or leave it and note why.
- Expect (a) (settled by the spec review): each step is one `with connect(db_path)` around its whole body (`periods.py:57`, `categorize.py:47`, `transfers.py:250`), so the extraction is short, and the public `db_path` signatures stay for the roughly 60 direct callers (mostly tests). The import is not rolled back: `upload_csv` commits `import_transactions` (`api/imports.py:95`) before `recompute_all` (`:96`) and only the three steps share the new connection. The rule routes (`api/rules.py::_refresh`) get the same treatment or a note saying why not.
- Tests: with (a), make one step raise and assert that none of the three steps is half applied while the imported rows stay committed; with the timeout only, no new test (a unit test of a constant adds nothing). The timeout is the one-line `sqlite3.connect(db_path, timeout=30)` at `db.py:340`, no WAL.

## Progress

- 2026-11-18: found by the code review (read from the code, not reproduced). Decision recorded above. Not changed.
