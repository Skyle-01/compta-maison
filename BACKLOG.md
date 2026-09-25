# Backlog

## Before going public (privacy)

- [x] 2026-09-25 — **Working tree anonymised.** Accounts moved out of code into `accounts.csv`;
  `data/` is now a fictional example; personal config lives in the gitignored `_config/` (picked up
  by `reset_db.py --source defaults`); tests and docs use fictional accounts and labels.
- [x] 2026-09-25 — **Clean history.** Restarted as a fresh repo (compta-maison) from the anonymised
  tree; the old repo, whose history holds real data, is archived.

## Pending technical debt (do before new features)

- [ ] Genuine uncategorised expenses/income remain across historical months (e.g. ~16 ops / ~497 € in
  May 2026). Transfers no longer pollute this — they're tagged + excluded. Add rules via Settings
  until the dashboard warnings clear; use the dashboard warning's **"Les classer →"** link (jumps to
  Transactions pre-filtered to that month, uncategorised only).
- [ ] Frontend has no tests. Low priority (the UI still changes a lot): at most vitest on
  `lib/api.ts` + the `moneyFlow` Sankey transform.

## Features

### Medium priority

- [ ] **Budget targets** — `budget_target` column on categories, actual-vs-target variance on the
  dashboard.
- [ ] **List manual transfer decisions in Settings** — pairs/unpairs made on the Transactions page
  are exported with the overrides but not listed in "Modifications manuelles".
- [ ] **Per-account transfer markers** — only if a multi-bank household needs different prefixes.
- [ ] **Upload vs rebuild account string** — the Import page sends the dropdown's account *code*,
  while `reset_db.py` hashes the raw filename string (e.g. `LIVRET A` vs `LIVRET`). The hashes then
  differ, so overrides made on UI-imported rows don't reattach after a rebuild. Uploads also aren't
  copied into `_inputs/`. Fix without touching existing hashes (e.g. send the inferred string, and
  save uploads to `_inputs/`).
- [ ] **More bank profile shapes** — header-less exports (positional columns), a separate "Sens"
  (D/C) column, labels split over several columns, and a `GET /api/imports/infer-account` so the
  Import page pre-fill uses the profiles' `filename_pattern`.
- [ ] **Export to Excel** — openpyxl report.

### Backburner

- [ ] **Bank API ingestion** — Budget Insight / Powens instead of manual CSV download.

## Done

- [x] 2026-09-25 — **Bank profiles.** Other CSV layouts via `_config/bank_profiles.toml` (columns,
  separator, date format, decimal mark, encodings, signed amount or debit/credit, filename pattern);
  header auto-detection within the first 30 lines, user profiles before the built-in default; the
  default format's parsing and `import_hash` are pinned by golden tests.

- [x] 2026-09-25 — **Stricter transfer detection + manual pair/unpair.** Both legs must start with a
  transfer marker (`transfer_markers` table / `transfer_markers.csv`, default `VIR`, `*` = any);
  pairing is bucketed + bisected instead of quadratic; Transactions page can pair two rows, mark a
  single row as transfer, unpair, or go back to auto. Manual pairs round-trip via the new
  `transfer_pair` column of `overrides.csv`.

- [x] 2026-06-16 — **French UI complete.** Localised the Import + Settings pages and the shared
  `CategoryPicker` (the last English chrome); the whole frontend is now French. Code, comments, and
  docs stay English (convention recorded in CLAUDE.md).
- [x] 2026-06-16 — **One-click rule suggestions.** `suggest_pattern` (date-stripped, mirrors the
  frontend) + `uncategorized_suggestions` + `GET /api/transactions/uncategorized-suggestions`; the
  dashboard `SuggestionsPanel` lists the top uncategorised patterns with an inline `CategoryPicker`
  and creates a rule in place, then refreshes. 97 tests.
- [x] 2026-06-16 — **Dashboard clarity + depth rework.** Full French frontend (dashboard +
  transactions + nav; code/docs stay English). Reconciled the headline numbers into four cards —
  **Revenus − Dépenses − Épargne = Reste**, where Reste == the Sankey *Reste* == the balance-tree
  *Total* — killing the old Net-vs-Reste discrepancy. Plain-language hero summary; per-card
  month-over-month deltas + a Reste sparkline (new `monthly_totals` and `epargne`/`desepargne`/
  `reste`/`history` on `/api/dashboard`). Sankey readability (tiny leaves folded into "Autres",
  wider labels, "Non classé"); balance tree demoted to a collapsed `<details>`; softer uncategorised
  warning with a deep-link to the filtered transactions view. 91 tests.
- [x] 2026-06-14 — **Money-flow Sankey** replaced the per-category bar chart (income sources →
  Revenus → Budget → expense groups → leaves, with Épargne and a Reste/Découvert balancing branch).
- [x] 2026-06-14 — **Consolidated épargne handling.** External savings accounts (e.g. a child's Livret A)
  derived from checking-account deposits; dropped the redundant manual savings categories
  (`livret A …`, `desepargne`) and the `vers/de LIVRET` rules — those flows now derive from the
  accounts. (Closed the old "redundant savings categories" debt item.)
- [x] 2026-06-13 — Collapsed migrations to a single schema (`SCHEMA`, `user_version=1`, no ladder —
  early dev; reset = delete `compta.db` + `seed.py`); `seed.py` now also imports every `_inputs/*.csv`
  (account inferred from filename, deduped); transfer UX (⇄ tag in the transactions list,
  "uncategorised only" filter excludes transfers). Live DB re-seeded to 707 tx incl. LIVRET (56
  transfer pairs). 69 tests.
- [x] 2026-06-13 — Accounts + transfers + flow model: canonical `accounts` table + aliases with enforced imports; transaction flow `kind` (income/expense/transfer) + auto-paired
  internal transfers excluded from totals/balance; flat flow-agnostic category tree (credit/debit
  roots removed); dropped the unused `recurring` rule column; removed pandas (stdlib CSV); `dev.ps1`
  runner.
- [x] 2026-06-13 — Schema v2: integer category ids (rename/re-parent supported), single parent-driven
  tree, rule priorities, `is_income_anchor` rules replacing the hardcoded employer constant,
  integer-cents amounts, `PRAGMA user_version` migration ladder with in-place v1→v2 upgrade. 63 tests.
- [x] 2026-06-12 — Paycheck budget periods (salary deposit opens the month), occurrence-aware dedup
  hash (identical same-day operations kept, overlapping uploads still deduped), light-theme contrast
  fix. 52 tests.
- [x] 2026-06-12 — Full web refactor: FastAPI backend (`backend/`), Next.js 16 frontend (`frontend/`),
  SQLite as source of truth for categories/rules, seed script, 44 tests. CLI and rich terminal report
  removed.
- [x] 2026-06-08 — Initial refactor: modules, SQLite layer, hash dedup, rich report, 15 tests.
