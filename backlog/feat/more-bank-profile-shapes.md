# More bank CSV shapes

## Context

`_config/bank_profiles.toml` (`backend/app/core/bank_profiles.py`, `core/parsing.py::detect_profile`
and `parse_statement`) covers files with a header row, named columns, and either one signed amount
column or debit and credit columns. Not covered:

- exports without a header row (positional columns);
- an unsigned amount whose direction is in a separate column ("Sens" = D/C);
- a label split over several columns;
- the Import page's account pre-fill (`inferAccountCode` in `frontend/src/app/import/page.tsx`)
  only mirrors the default filename pattern, not the profiles' `filename_pattern`.

## To do / to investigate

- Wait for a real export that needs it, and design the TOML keys from it.
- Pre-fill: a `GET /api/imports/infer-account?filename=…` running `infer_account` with the profiles
  and resolving the account code.
- Never change how the default profile or an existing profile parses a file: parsed values feed
  `import_hash` (see `TestDefaultFormatFrozen` in `backend/tests/test_parsing.py`).
