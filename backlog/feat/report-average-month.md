# Report: show the average month once, move « Les derniers mois » to Statistiques

## Context

Owner feedback (2026-11-12) on the shared report (PDF `/rapport` and the mobile HTML page):

- The « Les derniers mois » table (6 budget months side by side + a « Moyenne » column) is not very useful to the reader, and an export of several months repeats it once per month (one PDF sheet per month, one folded « Les derniers mois en tableau » per month in the HTML page).
- What the owner really values is the average month over the complete months already closed. The report must show it, and only once when several months are exported.
- The table may be kept elsewhere, for example on the Statistiques page.

Today the average only appears as a comparison: under the four cards, in the « Moyenne » column of the statement, and in the « Moyenne » / « Écart » columns of « Le mois en détail ». There is no place where the reader sees the average month for itself.

Why "once" is exact and not an approximation: `core/categorize.py::category_averages` builds its window from `averaging_window(all_months, n_months, partial)`, the latest complete, non-partial budget months, whatever the `month` parameter; `month` only feeds the `month_*` values. Every month of one export is therefore compared with the same average, and the payload of any of them carries it.

Where it lives:

- `frontend/src/lib/reportData.ts::loadReport`: per report month, one `GET /api/dashboard` + one `GET /api/dashboard/averages?months=12&month=X` per statement column (up to 6, `report.ts::statementMonths`), only to fill the statement. With enough history, the « 6 derniers mois clos » shortcut of the Export page so sends 36 averages requests for 11 distinct months.
- `frontend/src/app/rapport/page.tsx`: `Report` lays out one month (synthèse, « Les derniers mois », « Le mois en détail », « Détail par catégorie », the Sankey); `ReportPage` repeats it per requested month.
- `frontend/src/app/rapport/StatementTable.tsx` + `lib/report.ts::buildStatement`: the statement.
- `frontend/src/lib/mobileReport.ts`: `monthArticle` (one `<article>` per month, ending with `statementHtml`) and `buildMobileReport`.
- `frontend/src/app/statistiques/page.tsx`: hosts only `AveragesSection` (« Moyennes mensuelles », period select 3 / 6 / 12 / all).

## To do / to investigate

Three parts; the first two go together (the statement leaves the report and lands on Statistiques), the third is the new section.

### 1. Remove « Les derniers mois » from both report formats

- PDF: drop the « Les derniers mois » sheet from `Report`. HTML: drop the folded « Les derniers mois en tableau » and `statementHtml`, plus the CSS that only it uses in `lib/mobileReportStyle.ts` (`.scroll`, the `table` / `th` / `td` rules, `tr.sec`, `tr.sum`, `tr.fin`, `td.cur`, `td.avgc`, `td.mutedrow`: check each has no other user first).
- `ReportData.columns` (one averages payload per statement month) becomes a single payload for the report month: `loadReport` sends one averages request per month instead of up to 6. `Report` and `monthArticle` read it where they read `columns[columns.length - 1]` today.
- Everything else of a month is unchanged: the cards keep their average and gap, « Le mois en détail » keeps its « Moyenne » and « Écart » columns (a gap is per month by nature), the Reste chart, the budget, the tree, the Sankey.
- `app/export/page.tsx`: `RECENT_MONTHS` is documented as "the statement's width"; the shortcut stays (6 months), reword the comment.

### 2. Add « Un mois moyen », once per export

One section for the whole export, built from the averages payload of the last requested month (already loaded, no extra request).

Content, identical in both formats, from one pure helper in `lib/report.ts` (figures net of refunds like the rest of the report, `netOfRefunds(avg.totals, avg.offset.value)`):

- Heading « Un mois moyen » with the period under it: `periodSummary(avg, REPORT_AVERAGE)` (« sur 12 mois (octobre 2025 - septembre 2026) »), « mois clos uniquement ».
- The equation with the average of each card: Revenus - Dépenses - Épargne = Reste.
- « Où part l'argent en moyenne »: spending per top-level category, largest average first, a bar scaled to the largest category, the target beside a category that has its own (`ownTarget`). A muted « Non classé » line when its average is not zero. Sub-categories (named by their path, as `breakdown` does): folded under each category in the HTML page, absent from the PDF, which stays on one page (each month's « Le mois en détail » already prints every sub-category's average).
- « D'où vient l'argent en moyenne »: in the PDF one line per source (income-side leaf: each salary, each rent), as the statement lists them, since a line per top-level category would say almost nothing; in the HTML page per top-level category with its sources folded, like the monthly block.
- « Épargne » : the average net per savings account (set aside minus withdrawn), only when an account has some.
- The four cards come from one small shared helper (label, value, "higher is better", tone) written for this section and used only by the new code; the three existing screens keep their copies until `backlog/tech/four-cards-block-repeated.md`.
- No month column, no gap, no bold red/green: there is nothing to compare with.

Invariant to keep and to test (product principle "numbers reconcile"): spending rows + « Non classé » = the Dépenses average, income rows + « Non classé » = the Revenus average, savings rows = the Épargne average, and Revenus - Dépenses - Épargne = Reste.

Placement:

- PDF: one portrait sheet after the last month's sheets. A report of one month still opens on that month's answer. `Sheet` prints `reportTitle(month)` in its corner: this sheet has no month, so the corner label must become a prop (or the month optional).
- HTML: one block after the month `<article>`s and before « Comment lire », outside `article[data-month]` so it stays visible whichever month the picker shows. Sub-categories folded in `<details>`, like « Où part l'argent ».
- No complete month yet (`avg.months === 0`): the section is left out; the cards already say « Pas encore de mois clos ».

Leads:

- `breakdown(avg, side)` already builds the group / leaf lines with `average` and `target`, but ranks and filters on the month's value. Generalising what it ranks on lets `BreakdownTable` (PDF) and `breakdownHtml` (HTML) render the average section with their existing rows.
- `buildStatement` already computes the average of the savings rows and of « Non classé »; share those row builders rather than writing them a second time.
- « Comment lire » (PDF list in `rapport/page.tsx`, `HELP` in `mobileReport.ts`): the sentence about the average stays true; add nothing unless a term of the new section needs explaining.

### 3. Statistiques hosts « Les derniers mois »

- A second section under « Moyennes mensuelles »: « Les derniers mois », the statement as the PDF shows it today (income by source, spending by top-level category, savings by account, « Non classé », totals, Reste; the displayed month's column shaded, its notable amounts bold).
- Columns: the 6 budget months ending with the displayed month (`statementMonths`); with « Tous les mois » ticked, the 6 latest months, no column shaded and no bold amount (there is no reference month).
- Data: its own fetch (one averages request per column, stale-answer guard as in `AveragesSection`), plus `history` from the dashboard payload the page already holds (`monthly_totals` is in every payload, `month=all` included).
- `StatementTable` moves out of `app/rapport/` (it has no user left there). It imports `NUM`, `cell`, `CURRENT_COLUMN` and `highlight` from `app/rapport/tableStyles.ts`: move what both sides use to a shared place rather than import across two page folders. Screen size: `text-sm`, not the print `text-xs`.
- The « Moyenne » column stays, over the fixed 12 months of `REPORT_AVERAGE` (its header already says how many months). It does not follow the period select of « Moyennes mensuelles ».
- One line under the table: its Revenus and Dépenses are net of refunds, so they can be lower than the « Moyennes mensuelles » cards right above (gross); the Reste is the same. Without it the page shows two different « Revenus ».
- While moving it: `StatementTable` picks a section's colour and its "higher is better" flag from the French title (`Record<string, ...>` keyed by « Revenus » / « Dépenses » / « Épargne »). A `kind` on `StatementSection` would not depend on a display string.

### 4. Highlights on a month still filling

`report.ts::notable` flags a month's amount that is far from its average, on either side. On the month still filling almost every amount is far below its average, so everything turns bold (green for spending, red for income), which means nothing. On that month, highlight only what is already true: an amount over its target, or already well above its average (red for spending, green for income); never an amount below its average. One rule in `notable` (it needs to know the month is the latest one), applied by every table of both report formats and by the « Où part l'argent » section of « Le mois » (`backlog/feat/month-spending-breakdown.md`, whichever lands first brings the rule).

### Tests, docs, checks

- `lib/report.test.ts`: the new helper (order by average, a zero-average row left out, the reconciliation above, no section without a complete month); `notable` on a month still filling; `buildStatement` tests stay.
- `lib/mobileReport.test.ts`: with two months, « Un mois moyen » appears once and outside the month articles; no « Les derniers mois en tableau ».
- `docs/guide.md`: the PDF and « Page web pour téléphone » paragraphs of « Export » (both list the last-months table), and « Statistiques » (new section). `docs/img/statistiques.png` is not retaken here: it joins `backlog/tech/guide-export-screenshots.md`.
- `.claude/rules/frontend-pages.md`: « Printable report » (data: one averages request per month; pages), « Mobile HTML report » (order), « Statistiques ». `.claude/CLAUDE.md`: the Statistiques entry of « Current State ».
- UI check on the demo DB: a PDF of one month and of three months (the average sheet once, at the end, on one page), the HTML page with the picker, Statistiques at 1400 px with and without « Tous les mois ».

### Out of scope

- A backend endpoint returning a per-month, per-category series: the statement keeps one averages request per column (6 on a local SQLite), enough for one page.
- Any change to the averaging rules or to the Statistiques period select.

### Decisions (owner, 2026-11-12)

- The statement is moved to Statistiques, not deleted: it is the only view of each category month by month.
- The report average stays the last 12 complete months at the time of the export (`REPORT_AVERAGE`), not the whole history.
- « Un mois moyen » is the last sheet of the PDF, so a one-month report still opens on the month's answer.
- PDF: top-level categories only for spending, sources for income. HTML: sub-categories folded.
- The section holds spending, income and savings, with the equation first.
- Each month keeps its comparisons with the average (cards, « Moyenne » and « Écart » of « Le mois en détail »); only the full average table is shown once. The monthly « Où part l'argent » block of the HTML page is unchanged.
- Statistiques: the « Moyenne » column of the statement stays on the fixed 12 months and does not follow the period select.
- Titles: « Un mois moyen », « Où part l'argent en moyenne », « D'où vient l'argent en moyenne », « Épargne ».
- Order of work: this item, then `backlog/feat/month-spending-breakdown.md`, then `backlog/bug/classify-link-opens-read-only-transactions.md`, one commit each; no push by the assistant.

## Progress

- 2026-11-12: spec written from the owner's feedback; open questions settled with the owner the same day (decisions above); nothing implemented.
