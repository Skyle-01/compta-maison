# Budget section: balance the group cards

## Context

`BudgetSection` (`frontend/src/app/page.tsx`, ~line 224) lays the targeted groups out in
`grid gap-4 md:grid-cols-2`. Grid rows stretch every card to the tallest one in the row, so a group
with one targeted leaf sits in a card as tall as its neighbour's: with the example targets, "Fixe"
(Streaming only) gets a mostly empty card next to "Variable" (five leaves). The more uneven the
groups, the more white space.

## To do / to investigate

- Stop the stretch (`items-start` on the grid) as the minimal fix, or switch to a masonry-like flow
  (`md:columns-2` with `break-inside-avoid` on each card) so short groups stack under each other.
- Alternative: a single-column list when there are ≤ 2 groups, or put a leafless / single-leaf group
  on one line.
- Check the "Tous les mois" view and phone width (single column) still look right.

## Progress

- 2026-09-26: noted from a UI review of the running app (demo data).
