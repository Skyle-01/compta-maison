# The top navigation overflows at phone width

## Context

`frontend/src/app/layout.tsx` lays the header nav (compta, Tableau de bord, Transactions, Importer,
Réglages) out as a single non-wrapping flex row with `gap-6 px-6`. At 390 px it is ~430 px wide:
"Tableau de bord" breaks over two lines, "Réglages" is cut off at the right edge (so Settings can't
be reached from the menu on a phone), and every page gets a horizontal scroll (`scrollWidth` 428 on
`/` and `/settings`).

## To do / to investigate

- Let the links wrap (`flex-wrap`, smaller gap under `sm:`), or make the link row scroll
  horizontally (`overflow-x-auto whitespace-nowrap`), or shorten "Tableau de bord" on small screens.
- Check every page at 390 px once done.

## Progress

- 2026-09-26: seen on Playwright captures at 390 px (fictional data) by two sessions of the backlog
  sprint (Transactions page, then `/` and `/settings`); their two items are merged here.
