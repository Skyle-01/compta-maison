# The top navigation overflows at phone width

## Context

The header nav in `frontend/src/app/layout.tsx` (compta, Tableau de bord, Transactions, Importer,
Réglages) is a single non-wrapping flex row with `gap-6 px-6`. At 390 px wide it is ~430 px: the
« Réglages » link is cut off and every page gets a horizontal scroll (`scrollWidth` 428 on `/` and
`/settings`).

## To do / to investigate

- Let the row wrap or scroll (`flex-wrap` / `overflow-x-auto`), or tighten the gaps below `sm`.

## Progress

- 2026-09-26: seen in Playwright captures at 390 px (fictional data).
