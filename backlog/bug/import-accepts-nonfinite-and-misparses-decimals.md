# Imports accept NaN/inf and a dot-decimal profile misreads commas; a failed rebuild leaves no database

## Context

Three related weaknesses on the way a statement or a config CSV becomes a database. All three were reproduced or read on 2026-11-18.

1. **Non-finite amounts in a statement.** `backend/app/core/parsing.py:40-53` (`_parse_number`): an empty string and the lowercase `nan` give 0.0 (deliberate, part of the frozen hash path), but `NaN`, `-nan`, `inf`, `Infinity` pass through `float()` unchanged. `to_cents` (called in `import_transactions`, `db.py:400`) then raises `ValueError` (nan) or `OverflowError` (inf), and `import_transactions` only catches `sqlite3.IntegrityError` (`db.py:431`), so the upload ends in a 500. `api/imports.py:90` archives the file into `inputs/` **before** the insert, so the poisoned file stays there and every later rebuild (`reset_db.py`, `import_inputs.py`, the Import page's « Importer les nouveaux relevés ») hits it again.
2. **`decimal = "."` strips every comma.** `parsing.py:47`: `cleaned.replace(",", "")` turns `12,50` into `1250.0`. A bank profile declared with a dot decimal on a file that uses comma decimals multiplies the amounts by 100 without any error. The comma-decimal path (`cleaned.replace(",", ".")`) is the historical one that `import_hash` depends on and must not change.
3. **`budget_target` = `inf` in `categories.csv`.** `backend/scripts/import_csv.py:119-121` (`_parse_target`) catches `ValueError` only; `to_cents(float('inf'))` raises `OverflowError`.

Related: `backend/scripts/reset_db.py:132-140` (`_rebuild`) deletes `compta.db` before loading the accounts, the statements and the taxonomy. A failure anywhere after the `unlink` (case 1 or 3, an invalid `accounts.csv`) leaves no database. It is recoverable (the snapshot taken first holds the config and the overrides, transactions come from `inputs/`: fix the cause, then `reset_db.py --source backup`), but the app is down meanwhile.

Owner decisions (2026-11-18): fix all four points; keep the diff minimal.

## To do / to investigate

- `_parse_number`: after `float(cleaned)`, return `None` (the existing "unparseable" result, which the callers already turn into a French line error) when `not math.isfinite(result)`. Keep the `cleaned in ("", "nan")` branch exactly as is. `TestDefaultFormatFrozen` (`test_parsing.py`) must stay green untouched.
- Dot decimal: a comma is valid only as a thousands separator, that is between a leading group of 1 to 3 digits and groups of exactly 3 digits (`1,200.00`), else return `None`. A value without a comma goes through `float()` as today, and a leading sign stays accepted: `test_parsing.py:291` uses `-12.50`, `"1,200.00"` and `-0.00` with a dot decimal and must stay green. A regex that anchors on `^\d{1,3}(,\d{3})*(\.\d+)?$` alone is wrong (it rejects the sign and `1234.56`). Do not touch the `decimal == ","` path.
- `_parse_target` (`import_csv.py`): reject non-finite values with the existing line-numbered error, and catch `OverflowError` where `to_cents` is called there, if any other call can overflow.
- Archive order in `upload_csv`: settled by the spec review, no move. `archive_statement` (`api/imports.py:90`) already runs after `parse_statement` (`:82`), so once `_parse_number` rejects non-finite values a NaN or inf file gets a 422 before it is archived, and `.claude/rules/config-files.md` ("Each upload is copied to `inputs/`") stays true. The "archives nothing" test passes through the parsing fix alone.
- `reset_db.py::_rebuild`: build into a temporary database in the same folder as the target (for example `<db>.tmp`), then replace the live file with `os.replace` only on success; remove the temporary file on any failure, `SystemExit` included (try/finally). `_rebuild` derives nothing else from `db_path` (inputs come from the global `INPUTS_DIR`, the snapshot is taken earlier in `reset()`). The snapshot stays as it is. Check that the demo scratch DB (`COMPTA_DB`) and the `backups/` location (`config_export.backups_dir`) still follow the final path, and that `test_reset_db.py` (rebuild equality) passes unchanged.
- Tests: `NaN` and `inf` in a Debit/Credit cell give a French line error and archive nothing (`test_parsing.py`, `test_api_imports.py`); `12,50` with `decimal = "."` is an error, `1,234.56` still parses; `inf` in `categories.csv` is a line error (`test_reset_db.py` or the loader's test); a rebuild that fails after the first step leaves the previous `compta.db` readable and unchanged.

## Progress

- 2026-11-18: found by the code review. Reproduced: `_parse_number('NaN', ',')` is nan, `'inf'` is inf, `_parse_number('12,50', '.')` is 1250.0, `to_cents(nan)` raises `ValueError`, `to_cents(inf)` raises `OverflowError`. The `reset_db` ordering and the archive order read directly from the code. Not fixed.
