---
paths:
  - "backend/scripts/**"
  - "backend/app/core/config_export.py"
  - "backend/app/core/inputs.py"
  - "backend/app/core/parsing.py"
  - "backend/app/core/bank_profiles.py"
  - "backend/app/api/imports.py"
  - "backend/app/api/config.py"
  - "backend/tests/test_config_export.py"
  - "backend/tests/test_parsing.py"
  - "data/**"
---

# Statements, config files and snapshots: formats

The rebuild model (transactions from `_inputs/`, snapshots config-only) and the frozen-hash rule are in `.claude/CLAUDE.md`.

## Bank CSVs
- The built-in `DEFAULT_PROFILE` is semicolon-delimited, comma-decimal, dd/mm/yyyy, quoted fields; UTF-8 or Windows-1252; amounts may carry space/NBSP thousands separators and a sign (dropped: the Debit/Credit column gives the direction).
- Other layouts come from `bank_profiles.toml` in the config dir (example in `data/`). `detect_profile` tries user profiles in file order, then the default; the first whose columns all sit on one of the first 30 lines wins, and a row error never falls through to the next profile. A missing value-date column falls back to the operation date; a signed `amount` column splits into Debit (negative) / Credit, never `-0.0`.

## Uploads match rebuilds (`api/imports.py::upload_csv`, `core/inputs.py`)
The account string feeds `import_hash`, so when the picked account (the Import page sends the code) resolves to the same code as the filename-inferred string, the upload uses the inferred string, exactly like `reset_db.py`. Each upload is copied to `_inputs/` (`archive_statement`): under its own name when that infers the account, else `RELEVE_<account>_<today>_<name>.csv`; a clash with a different file gets ` (2)`…, identical bytes are reused; `ImportResult.archived_as` is `None` when no name would re-infer the account. `import_inputs_dir` rescans every file on purpose (no manifest: the dedupe makes a rescan idempotent).
- Gap check (`core/inputs.py::gap_warning`): both import paths read the account's last value date (`last_value_date`) **before** inserting a file; when the file's first kept value date is more than `GAP_TOLERANCE_DAYS` (4) later, `gap_warning` (French, on `ImportResult` / `InputFileResult`) is shown in amber on the Import page and printed by `import_inputs.py`. Warn only, never block. Only the import that creates a hole flags it (a rescan overlaps), and a quiet account can warn.

## CSV formats (`data/`, the config dir, `_backups/<ts>/`: one shape)
Written by `core/config_export.py` (`csv_text`, `category_paths`, `account_rows`/`category_rows`/`rule_rows`/`override_rows` + headers, `export_config`), loaded by `scripts/import_csv.py`. Optional columns are read with `row.get` so older files and snapshots still load.
- `accounts.csv` = `code;label;type;sort_order;deposit_pattern;aliases` (unknown columns ignored). `type` = `checking`|`savings`; `deposit_pattern` only for external savings; `aliases` = `|`-separated other names besides the label (the code is always one): import strings and names seen in transfer labels (a former bank name; not a holder's name, which several accounts share). An alias used for filenames must match the account part `infer_account` pulls from the filename (`RELEVE_[COMPTE_]<ACCOUNT>_<yyyy>…`, or a bank profile's `filename_pattern` `account` group; underscores → spaces), exactly or as a contained substring.
- `categories.csv` = `path;budget_target`: full ` / `-joined paths (get-or-created node by node; names must not contain a literal ` / `) + the optional monthly target in euros (`450.00`, empty = none; `,` decimals and spaces accepted, ≤ 0 rejected with the line number; a target below a targeted category is dropped, one per branch).
- `rules.csv` = `category_path;pattern;priority;is_income_anchor;description` (priority and anchor stored explicitly).
- `overrides.csv` = `import_hash;category_path;kind;libelle;note;transfer_pair;account_id;date_operation;debit_cents;credit_cents`. `resolve_overrides` matches each row by `import_hash`, falling back to its identity columns (account, date, libellé, amounts; identical operations matched in order, never twice): rows uploaded before the upload/rebuild hash fix were hashed with the account code, not the filename alias. `transfer_pair` = the partner leg's `import_hash` for a manual pair (self-join in `override_rows`). `import_overrides` runs before the recompute tail, clears any auto group on a manual-kind row, and `restore_manual_pairs` re-links pairs. Rows found neither way are skipped with a count.

## Saving the config dir (`POST /api/config/export` → `config_export.py::save_config`)
- Writes the five `CONFIG_FILES` (`accounts.csv`, `categories.csv`, `rules.csv`, `overrides.csv`, `transfer_markers.csv`) into `app.state.config_dir`; never touches any other file there (`bank_profiles.toml`, `settings.toml`, ...). No download (the server writes the disk), no automatic save (button only, by choice).
- First copies the files it is about to replace and the DB (sqlite3 backup API) to a new `_backups/<ts>/` (`_2`... within the same second); nothing reaches the config dir if that backup fails. Each CSV goes to a `.tmp` then `os.replace` (an `OSError`, e.g. a CSV open in Excel, is a French 500).
- A backup taken while the config dir had no `categories.csv` holds only `compta.db`: `reset_db.py::_latest_backup` skips dirs without `categories.csv`.
- A pre-accounts.csv snapshot borrows `accounts.csv` from the config dir.
