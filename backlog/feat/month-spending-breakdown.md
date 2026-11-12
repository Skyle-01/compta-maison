# « Le mois »: add the « Où part l'argent » view of the mobile report

## Context

Owner feedback (2026-11-12): the « Où part l'argent » block of the mobile HTML report is the view the owner likes most, and it does not exist in the app. It shows one line per top-level category (name, the month's amount, a bar scaled to the largest category), largest first, and a tap unfolds the sub-categories.

It is built by `lib/mobileReport.ts::breakdownHtml` from `lib/report.ts::breakdown(avg, "expenses")`, where `avg` is `GET /api/dashboard/averages?months=12&month=M`. The PDF renders the same lines as a table (`app/rapport/BreakdownTable.tsx`).

« Le mois » (`frontend/src/app/page.tsx`) shows spending only through the Sankey (« Flux d'argent ») and the balance tree (« Détail par catégorie », signed balances with every operation). Neither answers "which categories cost the most this month" at a glance.

## To do / to investigate

A new section « Où part l'argent » on « Le mois », between the notes under the Reste chart (budget line, transfers, unclassed warning) and « Flux d'argent ». Nothing is removed from the page.

Content, the same as the mobile block:

- One line per top-level category with spending this month or on average, largest month amount first: name, amount, a bar scaled to the largest category. Neutral bar (dark grey on a `zinc-100` track, as in the mobile page), no bar on the sub-categories.
- A category with sub-categories unfolds (folded by default) to one line per sub-category, named by its path below the category: amount, then « moyenne X » and « objectif Y » when they exist. A category without sub-category is a plain line, no chevron.
- A notable amount is bold red or green with the report's rule (`report.ts::notable`: over its own target, or at least 20 euros and 20 % away from its average).
- Empty month: « Aucune dépense classée ce mois-ci. »

Data and code:

- Reuse `breakdown(avg, "expenses")`: the figures then match both reports. The section fetches the averages itself for the shared month (`api.averages(REPORT_AVERAGE, month)`, stale-answer guard as in `components/AveragesSection.tsx`), so the page's dashboard payload is untouched.
- A new component in `src/components/` (the third renderer of `breakdown`, after the PDF table and the HTML string: three media, one helper). Native `<details>` / `<summary>` keeps the unfolding keyboard-accessible without state.
- Text colours follow the contrast rules of `.claude/rules/frontend-pages.md` (`zinc-500` for « moyenne » / « objectif », `green-700` / `red-700` for notable amounts).

One thing to handle: `breakdown` is net of refunds, the « Dépenses » card of the page is gross. When the month has refunds (`avg.offset.month_value` not zero), the lines add up to less than the card. Show one muted line under the list in that case, for example « Chaque catégorie est nette de ses remboursements : le total peut être plus bas que la carte Dépenses. » Unclassed debits are not listed either; the amber warning of the page already reports them.

Tests, docs, checks:

- Pure helpers only are unit-tested here, and `breakdown` already is: no new test unless a helper is added.
- `docs/guide.md` « Le mois »: one bullet for the section; retake `docs/img/dashboard.png` on the demo data (see `backlog/tech/guide-export-screenshots.md`, same image).
- `.claude/rules/frontend-pages.md` « Le mois »: one bullet.
- UI check on the demo DB at 1400 px: a month with refunds (the note shows), the month still filling, a database with no complete month (no « moyenne »).

Out of scope: « D'où vient l'argent » (the Sankey already shows the few income sources; `breakdown(avg, "income")` makes it cheap to add if wanted later), any link from a line to its operations.

## Progress

- 2026-11-12: spec written from the owner's feedback; nothing implemented.
