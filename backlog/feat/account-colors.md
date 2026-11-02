# One colour per account

## Context

With several accounts, rows in Transactions and the account details in the dashboard tree are hard to tell apart. Decisions taken with the owner (2026-11-02):

- A fixed palette of about 8 colours chosen for the light theme and the contrast rules of `.claude/rules/frontend-pages.md`, stored by name (`blue`, `green`...) in a new `accounts.color` column. No free hex input.
- An account without a colour gets a default from the palette by `sort_order`, so nothing needs configuring.
- Shown as a dot before the account code in: Transactions, the account details of the dashboard tree, and « À classer ». Not (yet) in the Import coverage table.
- Set in Réglages « Comptes » (`PUT /api/accounts/{code}`, `api/accounts.py`), written by « Enregistrer la configuration » (`accounts.csv`, `config_export.py`), read by `import_csv.py::import_accounts`.

## To do / to investigate

1. Schema: `accounts.color` nullable (rebuild with `reset_db.py --source live`), `AccountOut`/update schemas, `lib/api.ts`.
2. A small `lib/accountColors.ts` (palette, default by position) with a vitest next to it; a dot component reused by the three pages.
3. Réglages « Comptes »: colour picker (the palette as swatches).
4. `docs/guide.md` and `.claude/rules/frontend-pages.md`; retake screenshots; CLAUDE.md (Account definition).
5. Lowest priority of the five items: much of the need is covered once the account filter exists (`transactions-account-filter.md`).

## Progress

- 2026-11-02: item written after the owner's list of improvements; no code yet.
