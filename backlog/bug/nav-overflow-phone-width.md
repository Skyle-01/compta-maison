# The top navigation overflows at phone width

## Context

`frontend/src/app/layout.tsx` lays the nav out as `flex items-center gap-6 px-6` with no wrapping
or scrolling. At 390 px the four links don't fit: "Tableau de bord" breaks over two lines and
"Réglages" is cut off at the right edge, so the Settings page can't be reached from the menu on a
phone.

## To do / to investigate

- Let the links wrap (`flex-wrap`, smaller gap under `sm:`), or make the link row scroll
  horizontally (`overflow-x-auto whitespace-nowrap`), or shorten "Tableau de bord" on small screens.
- Check every page at 390 px once done.

## Progress

- 2026-09-26: seen on a Playwright capture of the Transactions page at 390 px (fictional data).
