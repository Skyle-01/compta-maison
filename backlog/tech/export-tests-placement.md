# Where the export tests live

## Context

After `test_api.py` was split by theme, `backend/tests/test_api_export.py` holds `TestExport`, which mixes two things: the config CSVs written by `core/config_export.py` (categories, rules, overrides, round trips, through the `_export` helper) and the `GET /api/transactions/export` endpoint (spreadsheet format, list filters). `test_config_export.py` already covers the core side.

Also, `test_config_export.py` imports `_category_id`, `_upload` and `_upload_transfers` (private names) from `tests/api_helpers.py`.

## To do / to investigate

- Move the config-CSV tests of `TestExport` into `test_config_export.py` and keep only the transactions export endpoint tests in `test_api_export.py` (or in `test_api_transactions.py`).
- Optionally make the shared helpers public (`upload`, `category_id`, `upload_transfers`): about 160 call sites, a mechanical rename.

## Progress

- 2026-10-28: noted while splitting `test_api.py`; the split itself kept every test where its class was, unchanged.
