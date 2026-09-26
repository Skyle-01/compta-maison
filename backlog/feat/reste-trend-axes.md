# Give the "Reste mois par mois" sparkline some reference points

## Context

`ResteTrend` (`frontend/src/app/page.tsx`, ~line 143) draws the per-month `reste` from the
dashboard `history` as a 72 px `LineChart` with the X axis hidden (`<XAxis dataKey="month" hide />`),
no Y axis and no labels. Only a hover tooltip gives month and amount, and the dashed zero line
carries no label. At a glance the reader sees a curve going up and down but can't tell which months
it covers, where the current month sits in euros, or whether a dip goes negative.

## To do / to investigate

- Show short month labels under the points (`frenchMonthShort`, maybe only first/last/current when
  there are many months) and the value of the current month's point (and possibly min/max).
- Label the zero reference line (or tint the area below zero) so a deficit month stands out.
- Keep it compact: a sparkline, not a full chart; check it still fits at phone width
  (`grid-cols-2` cards above it).
- Hidden when `history.length < 2` — keep that.

## Progress

- 2026-09-26: noted from a UI review of the running app (demo data).
