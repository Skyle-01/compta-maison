# Filter the Transactions page by account

## Context

With a second checking account imported, the Transactions list mixes accounts and cannot be narrowed to one. The backend is already ready: `GET /api/transactions` accepts `account` (filter on `account_id`, `api/transactions.py`), and the CSV export takes an `account_id` too. Only the page lacks a control.

## To do / to investigate

1. A select « Tous les comptes » / one entry per account (label from `GET /api/accounts`) next to the existing filters of `app/transactions`, combined with the month and the other filters.
2. Check the CSV export button passes the same account filter, so the export matches what is on screen.
3. Update `.claude/rules/frontend-pages.md` (Transactions filters) and `docs/guide.md` (retake the screenshot if the filters bar is visible).
4. Related: the account colour item (`account-colors.md`) adds a dot per row; the filter is useful on its own and goes first.

## Progress

- 2026-11-02: item written; confirmed the backend already filters by account, so this is frontend only.
