# Handle an operation whose label and date changed between two exports

## Context

A bank can export an operation while it is still pending, then export it again with another label and another date once booked (seen once: `VIREMENT INSTANTANE DEBIT` dated the 1st, then `VIREMENT INSTANTANE A <PAYEE> <Month>` dated the 2nd, same amount). `_row_hash` includes the date and the label, so both are imported and the operation counts twice. The app has no way to delete a transaction (rows only come from `inputs/`), and the stale one shows up in « À classer » as a phantom, even offering the real transfer partner.

Handled by hand the one time it happened (2026-11-12): the stale line was removed from the old statement in `inputs/` and the DB rebuilt with `reset_db.py`. It is not seen again, because the bank no longer exports the pending version and the new exports carry the booked row, deduped by its hash.

## To do / to investigate

Nothing to do unless it happens again often. If it does, options, from the simplest:

- Keep the manual fix (edit the old CSV, rebuild), and document it in `docs/guide.md`.
- An « ignored » marker on a row, persisted in `overrides.csv` like the other manual decisions and excluded from every total (a new concept, to weigh against YAGNI).
- A warning at import when a new row has the same account and amount, a date within 2 days and a different label from a row no longer present in the newest statement (needs a clear rule, the risk of false positives is real).

## Progress

- 2026-11-12: written up; fixed by hand in the live data.
