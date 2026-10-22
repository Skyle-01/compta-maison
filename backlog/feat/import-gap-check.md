# Detect gaps between imported statements

## Context

When new statements are imported (`./import_inputs.ps1`, the Import page button `POST /api/imports/inputs`, or an upload `POST /api/imports`), nothing checks that the new file starts where the data already in the DB for that account ends. If the owner skips a week when exporting, the missing operations simply never appear: the dedupe (`import_hash`) makes overlaps invisible, and nothing flags a hole (raised by the owner on 2026-10-22). The Nav's « Dernière opération » only tells whether the books are recent, not whether they are complete.

Code involved: `core/inputs.py::import_inputs_dir` (returns `InputFileResult` per file), `api/imports.py::upload_csv` (`ImportResult` in `schemas.py`), `core/parsing.py`, `db.import_transactions`, the Import page (`frontend/src/app/import/page.tsx`).

## To do / to investigate

- Main check, per account, at import: compare the file's date range (min/max `date_valeur`) with the rows already in the DB for its `account_id`. Overlap or contiguity (file min ≤ previous max + 1 day, maybe a small tolerance for weekends) is fine; otherwise report a gap (from, to, number of days) on the import result, as a French warning shown on the Import page. Compute the previous max **before** inserting the file's rows.
- Advise exporting statements with some overlap: the dedupe makes it safe, and it makes the check reliable.
- Stronger check if the bank CSV carries a running balance: previous closing balance + Σ flows = new opening balance. Ties in with `feat/account-balances.md`. Never touch the row hash inputs (`TestDefaultFormatFrozen`).
- Possibly a per-account coverage view (covered date ranges, holes) built from the DB alone, e.g. on the Import page or in Réglages. Weaker heuristic: unusually long stretches without any operation on a busy account.
- Out of scope: external savings accounts (`deposit_pattern`, no statement of their own).
- Open question for the owner: warn only, or also block? (Default: warn, never block, like the other import warnings.)

Done when:
- An import whose file starts after a hole on its account reports the gap; contiguous and overlapping files report nothing.
- Backend tests cover the contiguous, overlapping and gapped cases (both `import_inputs_dir` and `upload_csv`); `lib/api.ts` mirrors the new response field; pytest, ruff, `npm run lint`, `npm test`, `npm run build` pass.

## Progress

- 2026-10-22: item opened.
