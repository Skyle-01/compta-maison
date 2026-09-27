# Money-flow Sankey: empty band above the income columns

## Context

Since the chart height follows the busiest column (`busiestColumn` in `frontend/src/app/page.tsx`),
the short left-hand columns (income sources, `Revenus`, `Budget`) are laid out low in the card: with
the fictional data (two income sources, ~12 expense leaves) the top third of the card left of the
expense groups is empty on desktop, and on a phone (760 px chart scrolled sideways) the first screen
of the card shows only blank space above Salaire / Revenus, with a "Faites défiler…" hint at the top.

## To do / to investigate

- Check how recharts `<Sankey>` positions nodes vertically with `sort={false}` (node order and
  `nodePadding` per column) and whether the short columns can be centred or top-aligned.
- Keep the non-crossing order `moneyFlow` emits and the Reste/Découvert reconciliation.

## Progress

- 2026-09-27: seen on Playwright captures of the dashboard (desktop and 390 px, fictional data)
  during the backlog-sprint closeout.
