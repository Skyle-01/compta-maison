# Tables are clipped at phone width (Settings and Transactions)

## Context

The three tables on `frontend/src/app/settings/page.tsx` (Règles de classement, Modifications
manuelles, Virements manuels) sit in `overflow-hidden rounded-lg border` wrappers. At 390 px wide
the table is ~500 px, so its right-hand columns are cut off and cannot be scrolled to: the ✎ / ✕
actions of rules and manual assignments and the « Auto » button of manual transfers are unreachable
on a phone.

## To do / to investigate

- Make the wrappers scroll horizontally (`overflow-x-auto`, keeping the rounded border), or stack
  the rows as cards below a breakpoint.
- The Transactions table has the same wrapper (`transactions/page.tsx`, `overflow-hidden rounded-lg
  border`): at 390 px only Date and Libellé show; the amount, the category and the Classer /
  Modifier / Dissocier actions are out of reach. Fix both pages the same way.

## Progress

- 2026-09-26: seen in Playwright captures at 390 px (fictional data) while adding the Settings
  table of contents.
- 2026-09-27: confirmed on the Transactions page at 390 px (sprint closeout visual pass).
