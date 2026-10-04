# Monthly averages per top-level category over a period

## Context

The dashboard shows one budget month (or « Tous les mois », a sum) but no average: the owner wants the average monthly value of every top-level category (`parent_id IS NULL`: Revenus, Logement, Locatif, Vie courante, Épargne, Déficit… in their config) over a chosen period, to know what a "normal" month costs and to set realistic budget targets.

Relevant code:
- `backend/app/core/categorize.py`: `category_tree` (per-month tree, derived savings leaves via `_savings_net_cents`), `monthly_totals` (per-month income/expenses/epargne/desepargne/reste, already in the dashboard `history`), `budget_status` (targets, `months` multiplier for « Tous les mois »).
- `backend/app/api/dashboard.py` (`ALL_MONTHS`, payload assembly), `frontend/src/app/page.tsx` (dashboard sections), `frontend/src/lib/moneyFlow.ts` (per-leaf gating of income vs expense: an income source is a leaf with net credit, an expense a leaf with net debit).
- Income is mixed into expense groups (rents under Locatif), so a group's net is not its spending.
- Budget months are paycheck-anchored (`core/periods.py`): the latest budget month in the data is always the one still filling (it closes only when the next income anchor is imported, which opens a newer month).

## Decisions (owner, 2026-10-03)

- **Measure**: expenses and income **separated** per top-level category, like the Sankey: leaves with net debit feed the group's average spending, leaves with net credit its average income. Rents never lower Locatif’s spending.
- **Periods**: 3, 6 and 12 last months, and the whole history (selector).
- **The current (latest) budget month is excluded**: « 6 derniers mois » = the 6 complete budget months before it; « Tout l’historique » = every budget month except it.
- **Placement**: a dashboard section « Moyennes mensuelles » with its period selector: one row per top-level category, expandable to its sub-categories and leaves, plus the gap between the displayed month and the average (hidden in « Tous les mois »).
- **Extra rows**: « Non classé » (gross, both sides, so the totals match Revenus/Dépenses); the averages of the four cards (Revenus, Dépenses, Épargne, Reste, from the same data as `history`); for a leaf with a budget target, the target next to its average (a group shows the Σ of its leaves' targets, as on the Catégories page).

## To do / to investigate

- Gating granularity: decide whether a leaf's side (income vs expense) is decided on its net over the whole period (recommended: a one-off refund month doesn't turn a spending leaf into income) or per month as the Sankey does; document the choice in CLAUDE.md.
- Divisor: the number of budget months in the period (a month with no row for a category counts as 0). With fewer complete months than requested (e.g. 12 asked, 8 known), average over what exists and say so in the UI (« sur 8 mois »).
- Savings: Épargne / Déficit are the derived per-month nets (`_savings_by_month`), averaged like the cards; check they reconcile with the averaged `epargne`/`desepargne` of `monthly_totals`.
- Reconciliation check: Σ group average expenses + Non classé expenses = average Dépenses card; same for income. Add a pytest for it.
- API: likely a separate endpoint (`GET /api/dashboard/averages?months=3|6|12|all`) so switching the period doesn't refetch the whole dashboard; amounts in euros like the other dashboard aggregates (`core/categorize.py` convention), response model in `schemas.py`, mirrored in `lib/api.ts`.
- « Écart » for the displayed month: month value − average, coloured with the existing delta convention (`text-green-700`/`text-red-700`, spending above average = red). Decide whether the displayed month is inside the averaging window (it is when it's a past month): recommended to keep the window fixed (complete months before the latest) and accept the overlap, simpler to explain.
- Frontend: pure helpers (tree flattening, gap tone) in `src/lib/` with vitest; French strings, desktop layout, text contrast rules from CLAUDE.md.
- Update CLAUDE.md (dashboard business rules) and the user guide if `feat/user-guide.md` has landed.

Done when:
- The dashboard shows « Moyennes mensuelles » with the 4 period choices; each top-level category shows average spending and, if any, average income; rows expand to leaves; Non classé and the four card averages are shown; targeted leaves show their target.
- On the demo data, the averaged totals equal the mean of the matching `history` entries (pytest).
- The latest budget month is excluded from every period (pytest).
- `pytest`, `ruff check`, `ruff format --check`, `npm run lint`, `npm test`, `npm run build` pass.

## Progress

- 2026-10-03: specified with the owner (decisions above). Not started.
