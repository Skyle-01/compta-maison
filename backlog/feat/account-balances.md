# Account balances (in the app and the printable report)

## Context

The app only tracks flows: income, expenses, savings and the Reste, per budget month. It never knows how much money sits on an account. The printable report (`/rapport`, `frontend/src/app/rapport/page.tsx`, helpers in `lib/report.ts`) is meant to share « l’état des comptes » with the household, and readers will naturally ask « combien il reste sur le compte joint / le livret ? ». Today the report says nothing about it (raised on 2026-10-05 while designing the report, left out of its scope).

## To do / to investigate

- Source of a balance, to decide with the owner:
  - the bank CSVs: check whether the exports carry a running balance column or a « Solde au … » line (the parser, `core/parsing.py` / `core/bank_profiles.py`, skips them today; a new optional profile column would be needed). Never touch the row hash inputs (`TestDefaultFormatFrozen`).
  - or a manual opening balance per account (a new `accounts.csv` column, loaded by `import_csv.py::import_accounts`), the balance then being opening + Σ credits − Σ debits of the account's rows since the start date (`settings.toml` `start_date`).
- External savings accounts (`deposit_pattern`, no statement) only have derived deposits: their balance needs a manual opening value anyway.
- Where to show it: a « Soldes » block on the report's first page (balance at the end of the month, change over the month), maybe a dashboard card later.
- Schema change = rebuild with `reset_db.py --source live` (no migrations).

Done when:
- The owner picked a source and the report shows each account's balance at the end of the chosen month, consistent with the bank statement on the demo data.
- Backend tests cover the balance computation; `npm run lint`, `npm test`, `npm run build`, pytest and ruff pass.

## Progress

- 2026-10-05: item opened when the printable report landed without balances.
