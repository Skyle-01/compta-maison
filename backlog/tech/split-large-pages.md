# Split the large page files into components

## Context

The Catégories page was split into components (`app/categories/`) and `AveragesSection` left `app/page.tsx`. Three page files are still single blocks:

- `app/a-classer/page.tsx` (578 lines): one `TriagePage` component of about 500 lines mixing the group list, the active group's editor (rule preview, category search), the transfer candidates, the keyboard handling and the toast.
- `app/transactions/page.tsx` (512 lines): one `TransactionsPage` component of about 475 lines with the filters, the per-row categorisation editor, the transfer pairing and the CSV export link.
- `app/rapport/page.tsx` (647 lines): sheet pieces (`Sheet`, `ReportStat`), the statement table (`StatementLine`, `StatementTable`), the breakdown tables (`Bar`, `BreakdownRow`, `BreakdownTable`), `MonthDetail`, `TreeRows`, `Report` and the loading page.

## To do / to investigate

- Same approach as the Catégories split: state and data loading stay on the page, presentational pieces move beside it or to `components/`, no behaviour change, the headless Edge check on the demo DB before and after (compare the DOM text).
- `a-classer` and `transactions` carry keyboard and focus logic (↑/↓, Enter, Alt+M, Alt+Z): split the markup first, leave the handlers on the page.
- `rapport`: `StatementTable` and `BreakdownTable` are the natural first moves; check the A4 page count with `Page.printToPDF` after.
- No vitest coverage exists for these pages (UI is checked by hand), so each split is its own commit.

## Progress

- 2026-10-28: sizes measured, nothing changed. `app/page.tsx` went from 706 to 379 lines by moving `AveragesSection` to `components/AveragesSection.tsx`.
