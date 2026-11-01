# Per-account cutoff date, import warning, partial months out of the averages

## Context

Importing an account whose statements start mid budget month (the second holder's account, first operation 2026-08-03, while the budget month 2026-08 opens with the owner's salary on 2026-07-28) mixes two regimes inside that month: her contributions are transfers and her own spending appears, but her salary of the previous month is missing, so the month's Reste is artificially low. It also skews the 6/12-month and « tout » averages. Measured on the live DB: Dépenses step up by about 1 200 EUR a month once her account is in, Revenus stay comparable, 2026-08 is the broken month.

Decisions taken with the owner:

- A **cutoff per account**: a fixed calendar date (value date), not a second anchor and not tied to an operation. Rows of that account valued earlier are not imported, exactly like the global `start_date` of `settings.toml` (`parsing.rows_since`), and the effective cutoff of an account is the later of the two. Budget months stay cut by the owner's salary only. The owner picks the value date of the paycheck that opens the month the account should start in (28/08 for 2026-09 here). It is a date, not a month, because budget months are derived after the import from the salaries already in the DB: filtering by month would depend on the order of the files at a rebuild.
- Persisted as an optional `start_date` column (ISO date) of `accounts.csv`, edited in Réglages « Comptes ». Like the global one, moving it needs a rebuild (rows already imported are not deleted); the statements stay in `_inputs/`.
- **Warning at import, no silent discard.** On an account's first import (nothing in the DB yet, like `gap_warning`), when the first kept value date falls more than `GAP_TOLERANCE_DAYS` after the opening of its budget month, say so and suggest the date opening the next one. Warn only.
- **Partial months** (choice « C »): a budget month is partial while an imported checking account has not started, i.e. the account's effective start (its `start_date`, else its first value date) is later than the month's opening date + `GAP_TOLERANCE_DAYS`. The monthly averages ignore partial months (`averaging_window`), and the month list and « Reste mois par mois » mark them « partiel ». Generic: no rule about a particular account, it applies to any account added later. Consequence today: the window starts at 2026-09 and grows every month.

## To do / to investigate

1. Schema: `accounts.start_date TEXT` (rebuild with `reset_db.py --source defaults` after « Enregistrer la configuration »: the old DB has no such column, so save the config BEFORE this lands); `accounts.csv` column + `account_rows`/`ACCOUNTS_HEADER`/`import_accounts` (ISO date, error with the line number); helper `db.set_account_start_date`; `PUT /api/accounts/{code}` + `GET` carry it; Réglages form field and table column.
2. Import: effective cutoff in `upload_csv`, `import_inputs_dir` and `account_coverage` (read from the DB), counted in `rows_before_start`.
3. Warning: extract the budget months' opening dates from `periods.recompute_budget_months` (`budget_starts`), `inputs.start_warning`, a `start_warning` field on `ImportResult` / `InputFileResult`, amber on the Import page.
4. Partial months: derive them in core (one function), exclude them in `averaging_window`, expose them on the dashboard / averages payloads, « partiel » in the month select and `ResteTrend`. Decide whether « Tous les mois » totals stay untouched (yes: only the averages ignore them).
5. `docs/guide.md` (Réglages, Importer, Moyennes mensuelles), `.claude/CLAUDE.md` (Account, Start date, Monthly averages), `.claude/rules/config-files.md` (accounts.csv format), `data/accounts.csv` header; retake the guide's screenshots of Réglages from the demo data.
6. Then, on the live data: set account B's `start_date` to 2026-08-28, rebuild, check September onward.

## Progress

- 2026-11-01: design agreed with the owner (cutoff per account, warning with a suggested date, partial months out of the averages). Nothing implemented yet.
- 2026-11-02: first half done (items 1 to 3 and their docs: `accounts.start_date`, effective cutoff at import, `start_warning`). Left: partial months (item 4), the Réglages screenshot retake, then the live data (item 6).
