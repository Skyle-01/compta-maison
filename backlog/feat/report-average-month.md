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
- « Où part l'argent en moyenne »: spending per top-level category, largest average first, a bar scaled to the largest category, its sub-categories below (named by their path, as `breakdown` does), the target beside a category that has its own (`ownTarget`). A muted « Non classé » line when its average is not zero.
- « D'où vient l'argent en moyenne »: the same for income.
- « Épargne » : the average net per savings account (set aside minus withdrawn), only when an account has some.
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
- Columns: the 6 budget months ending with the displayed month (`statementMonths`); with « Tous les mois » ticked, ending with the latest month, no column shaded.
- Data: its own fetch (one averages request per column, stale-answer guard as in `AveragesSection`), plus `history` from the dashboard payload the page already holds (`monthly_totals` is in every payload, `month=all` included).
- `StatementTable` moves out of `app/rapport/` (it has no user left there). It imports `NUM`, `cell`, `CURRENT_COLUMN` and `highlight` from `app/rapport/tableStyles.ts`: move what both sides use to a shared place rather than import across two page folders. Screen size: `text-sm`, not the print `text-xs`.
- The « Moyenne » column stays, over the fixed 12 months of `REPORT_AVERAGE` (its header already says how many months). It does not follow the period select of « Moyennes mensuelles ».
- One line under the table: its Revenus and Dépenses are net of refunds, so they can be lower than the « Moyennes mensuelles » cards right above (gross); the Reste is the same. Without it the page shows two different « Revenus ».
- While moving it: `StatementTable` picks a section's colour and its "higher is better" flag from the French title (`Record<string, ...>` keyed by « Revenus » / « Dépenses » / « Épargne »). A `kind` on `StatementSection` would not depend on a display string.

### Tests, docs, checks

- `lib/report.test.ts`: the new helper (order by average, a zero-average row left out, the reconciliation above, no section without a complete month); `buildStatement` tests stay.
- `lib/mobileReport.test.ts`: with two months, « Un mois moyen » appears once and outside the month articles; no « Les derniers mois en tableau ».
- `docs/guide.md`: the PDF and « Page web pour téléphone » paragraphs of « Export » (both list the last-months table), and « Statistiques » (new section; retake `docs/img/statistiques.png` on the demo data).
- `.claude/rules/frontend-pages.md`: « Printable report » (data: one averages request per month; pages), « Mobile HTML report » (order), « Statistiques ». `.claude/CLAUDE.md`: the Statistiques entry of « Current State ».
- UI check on the demo DB: a PDF of one month and of three months (the average sheet once, at the end, on one page), the HTML page with the picker, Statistiques at 1400 px with and without « Tous les mois ».

### Out of scope

- A backend endpoint returning a per-month, per-category series: the statement keeps one averages request per column (6 on a local SQLite), enough for one page.
- Any change to the averaging rules or to the Statistiques period select.

### Open questions for the owner

- PDF placement of « Un mois moyen »: last (proposed, so a one-month report still opens on the month's answer) or first (the reference before the months)?
- Statistiques: keep the « Moyenne » column of « Les derniers mois » (proposed, moved as it is) or drop it, since « Moyennes mensuelles » sits right above?

## Progress

- 2026-11-12: spec written from the owner's feedback; nothing implemented.
