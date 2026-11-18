# « Récurrents »: find the subscriptions and fixed charges, flag a price change, a missing or a doubled charge

## Context

The app tells the owner what each label is (rules) and what each category may cost (budget targets), but not what is paid or received every month without thinking about it, nor when such a flow changes. Questions it cannot answer today: did the electricity bill or a subscription go up, is a cancelled subscription still charged, was the rent or the salary received this month, was something charged twice. Today the owner would have to read the Transactions list month by month.

Everything needed already exists: every real-flow operation has a value date, an account, a sign and a `kind`; `core/triage.py::label_key` already turns two labels of the same payee into one key (words without digits, dates, amounts or month names; a label left with no significant word keeps its raw text, so generic labels like `VIR 1234` are never merged); `core/periods.py` knows the partial months and `GAP_TOLERANCE_DAYS`; `core/rule_issues.py` and `GET /api/rules/issues` are the model for an on-demand diagnostic (computed from the current rows, never stored, no schema change, no French text in the payload).

The app tracks flows only, never balances (owner decision 2026-10-26): this page lists flows and the date the next one is expected. It never projects a balance or a « reste » to come.

## To do / to investigate

A new page « Récurrents » (`/recurrents`, nav « Analyser » right after « Budget »), read-only like Statistiques.

### Detection (new `core/recurrences.py`, logic only, on demand)

Input: the operations with `kind` income or expense (transfers left out) of every account, all months.

- Group by `(account_id, label_key(libelle), side)` where side = debit or credit. One group = one candidate.
- A candidate is **recurring (monthly)** when it has at least 3 occurrences in 3 distinct calendar months of the value date, the median gap between two consecutive occurrences is 25 to 35 days, and no month holds more than one occurrence in most of its months (at least 80 % of the months it appears in have exactly one; a shop visited weekly is not recurring). A group that fails is simply not listed.
- Amount, judged on the whole series in occurrence order, tolerance max(2 %, 0.50 EUR) around a run's median. A **run** is two or more consecutive amounts within the tolerance; an amount that belongs to no run is **isolated**. An isolated amount that is not the last one is a one-off (a bonus in a salary, a regularisation): ignored for the type and never flagged. `fixed` when the runs, one-offs set aside, are one run, or two consecutive runs (a step: a price rise, a raise; the later run starts at the date of the change). An isolated **last** amount is a candidate step: the series stays `fixed` and gets `price_change` (old = the run's median, new = that amount), which the next occurrence confirms (it becomes a run) or cancels (the series returns to the old amount, the flag goes). `variable` when there are more runs, or no run at all (electricity bill), listed only when every amount stays within 35 % of the median (a wider spread is a shop, not a bill).
- Per recurring, computed as of each account's own latest value date `L` (not the global one: an account whose statement is late must not make its flows « missing »), with `last` = its last value date and `gap` = the median gap: the `status` flags, a list because they can combine:
  - `missing`: `L > last + gap + 5 days` and not `ended`. One missed occurrence.
  - `ended`: `L > last + 2 x gap + 5 days` (cancelled subscription, or the bank changed the label: the two cases look alike, the tooltip says both).
  - `price_change`: a `fixed` recurring that is two runs (a step) or ends on an isolated last amount (a candidate step); the payload carries the old and new amounts (the medians of the runs, or the isolated amount) and the date of the change (the start of the later run, or the date of the isolated amount). Dropped once the new run is older than 6 months. Never for a `variable` one.
  - `doubled`: the latest month holds two occurrences while the usual count is one.
- Not in this item (YAGNI, add on real need): quarterly and yearly cadences (they need 2 or more years of history, the books start in 2026), a « new recurring » flag, a manual « this is not recurring » exclusion (it would need stored state; revisit after a few weeks of real use), label-drift matching (a changed label shows as `ended` plus a new recurring).

### API

`GET /api/recurrences?account=` returns `{items: [...], monthly_expenses, monthly_income}` (euros, converted in the router as elsewhere). Each item: `label` (the most frequent raw libellé of the group), `account_id`, `side`, `category_id` (the majority one, null when unclassified), `amount_kind` (`fixed` | `variable`), `typical_amount` (median), `last_amount`, `occurrences` (count), `first_date`, `last_date`, `next_expected` (ISO date, null once `ended`), `status` (list of `{kind, ...}` with the old and new amount for `price_change`), `last_operations` (the last 12 as `{id, date, amount}`, so the page needs no second request). `monthly_expenses` / `monthly_income` = the sum of the typical amounts (the later run for a stepped one) of the non-`ended` **fixed** recurring of each side: « what comes out of the budget by itself ». Pydantic models in `schemas.py`, mirrored by hand in `lib/api.ts` in the same commit. The payload carries no French text.

### Page

- Summary line: « N flux récurrents : X € de dépenses et Y € de revenus par mois ».
- One list, largest typical amount first within a side (expenses then income), one line per recurring: label, `AccountDot` + code, category path (an unclassified one links to « À classer »), typical amount (« variable » when so), count and last date, next expected date, status badges (amber: `missing`, `price_change` with « 12,00 € → 14,50 € », `doubled`; grey: `ended`). ▸ expands the `last_operations`.
- Filters: the shared account filter (`AccountSelect purpose="filter"`, like Transactions), a status select (« Tous », « Avec écart », one status) and a « Avec les montants variables » checkbox, **off by default**: the default list is the fixed flows (and the totals count only them), because a variable one cannot be told from a shop visited about monthly (the demo's `CARTE LECLERC` and `CARTE LIBRAIRIE DU CENTRE` on JOINT pass every test above, gaps of 27 to 32 days, one visit per month). Ticking it adds the bills (EDF) and those shops. No month filter: it reads the whole history. The API returns both kinds (`amount_kind`), the page filters.
- Empty states: not enough history (« Pas assez d'historique : il faut au moins 3 mois d'opérations »), nothing to flag.
- « Le mois »: one muted line under the budget summary, « N écarts sur vos flux récurrents → », hidden at zero, linking to `/recurrents` (same pattern as `BudgetGlance`, the dashboard payload stays untouched: the line does its own `GET /api/recurrences`).
- Pure helpers (sort, status filter, summary and badge texts) in `src/lib/recurrences.ts` with vitest tests next to it.

### Tests, demo data, docs, checks

- Backend `tests/test_recurrences.py` (fixtures of fictional labels, like `test_rule_issues.py`): detected after 3 months, not at 2; a weekly shop is not recurring; two payees with the same words on different accounts stay apart; fixed vs variable; each status alone and combined (`missing` then `ended` after the second miss; `price_change` for fixed only; `doubled`); `missing` judged on the account's own latest date (a late statement flags nothing); transfers and unclassified operations handled (an unclassified recurring is listed, `category_id` null); partial first month does not break the gap median. API test: shape, `?account=`, French validation of a bad account.
- Demo data: the six demo months (Apr-Sep 2026) already hold the rent, the loans, the salary, Netflix, Free Mobile and EDF (checked in the spec review: each gets one `label_key`; EDF comes out `variable`; the salary is 2650 three times, 3050 in June, then 2650 twice, so with the one-off rule it is `fixed` at 2650 with no flag, and the test fixture should pin that case). Add to the fictional statements one subscription that stops: its last payment must be before about 2026-07-10, because PERSO's latest value date is 2026-09-15 and `ended` needs `L > last + 2 x gap + 5 days`; and a price rise on an existing subscription (Netflix, if its amounts are flat). New labels must match an existing rule in `data/rules.csv` (use `SPOTIFY` for the stopped one; that rule then classifies something, but `unused` still shows through SFR, Orange, KFC, CASTORAMA and RATP), because `test_reset_db.py` asserts that the uncategorised rows stay under a fifth of the expenses and that all five rule-issue kinds appear in the demo. No test pins the demo's row counts. Rebuild the demo DB afterwards (see Dev Workflow) and keep `test_demo_statements_build_a_working_example` green.
- `docs/guide.md`: a « Récurrents » section, a `GUIDE_ANCHORS` entry (`lib/guide.ts`, the nav test requires it), the « Le mois » section mentions the line; screenshot from the demo DB. `.claude/rules/frontend-pages.md`: a section and the Nav line; `.claude/CLAUDE.md`: `core/recurrences.py` in the architecture, the router line, the page list.
- UI check at 1400 px on the demo DB (headless Edge, see memory): Nav still on one line with the new entry, each badge, the expanded operations, account and status filters, the « Le mois » line and its link.

### Open decisions for the owner (one round, recommended answer first)

1. Own page or a section of Budget? Recommended: own page « Récurrents » in « Analyser » after « Budget » (a table with filters does not fit the Budget cards).
2. Monthly cadence only in the first version? Recommended: yes; quarterly and yearly once two years of history exist.
3. Price-change tolerance max(2 %, 0.50 EUR) and a 5-day lateness before `missing`? Recommended: yes, as written; both are named constants, easy to retune after a look at real data.
4. Include received flows (salary, rent received, benefits) next to the spending? Recommended: yes: a missing salary or rent is the most useful alert.
5. The « Le mois » line for the flagged count? Recommended: yes, hidden at zero; drop it if it adds noise.
6. A next expected date is a forecast of a flow, not of a balance: acceptable under the « flows only » rule? Recommended: yes; no projected balance or « reste » anywhere.
7. No « not recurring » exclusion in the first version? Recommended: none until real data shows false positives (it needs stored state and a rebuild story through the config CSVs).
8. Variable amounts hidden by default behind a checkbox, because shops visited about monthly look like bills? Recommended: yes; the useful variable one (the electricity bill) is one tick away, and the default list stays almost free of noise.

## Progress

- 2026-11-18: spec written from a review of the existing building blocks (`label_key`, `rule_issues`, `periods`); nothing implemented, decisions above not asked yet.
- 2026-11-18: independent spec review (verdict BLOCKED, fixed here): `price_change` could never fire because a new price made the series `variable` (now the one-step rule), `ended` had no test (now `L > last + 2 x gap + 5 days`), two demo shops pass the detection (hence the hidden-by-default variable list, decision 8), and the demo additions must match existing rules and respect two `test_reset_db.py` constraints. Re-reviewed the same day: the `ended` test, the hidden variable list and the demo constraints were resolved; the price-change rule was still open for the demo (the salary has three runs: 2650 x3, 3050, 2650 x2), fixed by the one-off rule above (an isolated non-last amount is ignored, an isolated last amount is a candidate `price_change`). That last edit is not re-reviewed: a quick scoped check of the amount rule against the demo's salary, EDF and Netflix series is enough before implementing.
