# Upload and rebuild hash some rows differently

## Context

Each transaction's `import_hash` includes the raw account string (`backend/app/db.py::_row_hash`),
and manual overrides (category, note, transfer decision) are matched by that hash when the DB is
rebuilt (`overrides.csv`, `scripts/import_csv.py::import_overrides`). The two import paths don't
hash the same account string:

- Import page (`frontend/src/app/import/page.tsx`): the "Compte" dropdown is pre-filled with the
  account *code* (`inferAccountCode`) and sent as `account`; `backend/app/api/imports.py::upload_csv`
  hashes that string as is.
- `backend/scripts/reset_db.py::_import_inputs` hashes the string `infer_account` pulls from the
  filename.

When the filename string isn't the code (`RELEVE_LIVRET_A_…` gives `LIVRET A` for code `LIVRET`,
`RELEVE_COMPTE_APPARTEMENT_LOCATIF_…` gives `APPARTEMENT LOCATIF` for `LOCATIF`), a row imported
from the UI and the same row rebuilt from `_inputs/` get different hashes. An override set on the
UI-imported row is then skipped ("not found") by the next `reset_db.py` rebuild.

Related: uploads aren't copied to `_inputs/`, so a statement imported only through the UI is lost
entirely on rebuild.

Duplicates are not the problem: `import_transactions` also dedups on the resolved account
(`account_id`, date, label, amounts, occurrence), so the same statement under two account strings
isn't imported twice.

## To do / to investigate

- Never change the `_row_hash` formula (see CLAUDE.md): fix the string that goes in, not the hash.
- Backend option: in `upload_csv`, when the given account resolves to the same code as the
  filename-inferred string, use the inferred string (what `reset_db.py` does). Frontend
  alternative: send an empty account when the user kept the pre-filled value, so the backend infers
  it from the filename.
- Save each upload to `_inputs/` under its original filename (never overwrite a different file with
  the same name), so a rebuild includes it.
- Existing databases already hold UI-imported rows hashed with the code. Either accept that their
  overrides are lost once, or teach `import_overrides` a fallback: when a hash isn't found, match on
  (`account_id`, `date_operation`, `libelle`, amounts, occurrence). The override CSV would then need
  those columns (it has `libelle` only). Decide before fixing.
- Test: upload `RELEVE_LIVRET_A_2026_06_08.csv` through the API with account `LIVRET`, set a manual
  category, run `reset_db.reset(db, "live", None)` and check the override survived (see
  `TestResetDb` in `backend/tests/test_api.py`).

## Progress

- 2026-09-25: found while planning bank profiles; not fixed.
