# Overlapping statements duplicate an operation whose label or date changed between exports

## Context

Importing overlapping statements (upload, `import_inputs.py`, the Import page's « Importer les nouveaux relevés » button, or `reset_db.py`) relies on `db.py::import_transactions` to skip rows already in the DB: same `import_hash` (account string, operation date, libellé, debit, credit, occurrence) or, per resolved account, as many identical operations (date, libellé, amounts) as the row's occurrence. If the bank exports the same operation differently in two statements (a pending card payment re-labelled once posted, a date shifted by a day, extra spaces), both versions are kept and the operation counts twice in the dashboard.

Not observed yet: it was raised as a theoretical limit while building the bulk import of `_inputs/`.

## To do / to investigate

- Check the real statements in `_inputs/` for overlaps where the same amount appears twice on the same account within a few days with close labels (a read-only SQL query on `compta.db` is enough).
- If it happens, options: a fuzzy duplicate report in the UI (same account and amount, dates within N days, similar libellé) that the user confirms, rather than silent auto-deletion. Never change `_row_hash` for occurrence 0 (see CLAUDE.md gotchas).

## Progress

- 2026-10-03: item created; no occurrence confirmed.
