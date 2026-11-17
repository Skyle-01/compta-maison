# The PDF and the mobile HTML report derive the same figures twice

## Context

Both report formats promise the same figures ("built from the same data and helpers"), but the layer between `ReportData` and the markup is written twice:

- `app/rapport/page.tsx::Report` and `lib/mobileReport.ts::monthArticle` open with the same block: the averages payload of the month, `netOfRefunds` on the month and on the average totals, `epargneNet`, the `history` slice for the Reste chart (`filter(h.month <= month).slice(-REPORT_TREND_MONTHS)`), `periodSummary`, `unclassifiedNote`, `partialInReport`, the in-progress flag. A change made on one side only makes the two files disagree, and nothing tests that they agree.
- The four cards are listed twice with the same labels, signs and "higher is better" flags (`ReportStat` x 4 in the PDF, `equationRow` x 4 in the HTML).
- `components/tableStyles.ts::cell` and `lib/mobileReport.ts::amount` are the same function (nothing for null, a dash for zero, else `formatEuro`).
- The sentence about partial months exists in two wordings (JSX in `rapport/page.tsx`, a template string in `mobileReport.ts`).
- « Comment lire »: the PDF says the average covers `REPORT_TREND_MONTHS` months. That constant is the width of the Reste chart, not the averaging period (`REPORT_AVERAGE`); both are 12 today, so the text is right by coincidence. The HTML `HELP` hardcodes « 12 ».

## To do / to investigate

- One pure helper in `lib/report.ts` (for example `monthFigures(report, month, available)`) returning what both renderers need: net month totals, net average totals or null, the four cards as a list (label, value, average, goodIsUp), the trend history, the summary strings, the partial months. Unit-test it once; the two renderers only lay out.
- Keep one `cell` / `amount` in `lib/` and import it from both.
- Build the average's sentence from `REPORT_AVERAGE` in both formats.
- The statement has left both renderers and `ReportData` now carries one `averages` payload (`columns` is gone), so the shared helper is smaller; `reportCards` and `averageMonth` already hold the cards and the average month.

## Progress

- 2026-11-12: noticed while reading the report code for the average-month spec.
