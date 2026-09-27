# Dashboard: the green « ▲/▼ … vs <mois> » deltas are below WCAG AA

## Context

`DeltaLine` (`frontend/src/app/page.tsx`) writes a card's month-over-month change in `text-xs`,
green when the change is good (`text-green-600`) and red when it is bad (`text-red-600`). On the
white cards Tailwind 4's `green-600` (`oklch(62.7% 0.194 149.214)`) is 3.2:1, below the 4.5:1 AA
needs for small text; `red-600` is 4.8:1 and passes. The card values and the balance tree already
use `text-green-700` (4.9:1).

Seen on the demo database at 1400 px (2026-09-27): « ▼ 124,71 € vs août » under Dépenses and
« ▲ 750,00 € vs août » under Épargne are noticeably paler than the red delta under Reste.

## To do / to investigate

- `text-green-600` -> `text-green-700` (and `text-red-600` -> `text-red-700` to keep the pair
  balanced, as the tree does), then check the four cards on the demo database at 1400 px.
- `grep -rn "text-green-[3-6]00" frontend/src` for other small green text (none else on
  2026-09-27).

## Progress

- 2026-09-27: found while checking the remaining-light-text fix; contrast computed from the
  Tailwind theme's oklch values.
