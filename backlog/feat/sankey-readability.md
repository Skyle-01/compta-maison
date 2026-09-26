# Make the money-flow Sankey readable

## Context

The dashboard's "Flux d’argent" Sankey (`frontend/src/app/page.tsx`, `<Sankey>` around line 500 +
`FlowNode`; graph from `frontend/src/lib/moneyFlow.ts::moneyFlow`) is the busiest part of the page.
On a realistic month (a demo run with fictional statements, 2026-09-26) it shows:

- **Crossing links**: every link is the same grey (`stroke: "#475569", strokeOpacity: 0.28`), and
  expense groups → leaves cross each other heavily, so a flow can't be followed from Budget to its
  leaf.
- **Overlapping labels**: mid-column group labels (Transport, Sortie, Enfants) sit on top of the
  links passing through, and their amount line is unreadable. `FlowNode` labels every non-terminal
  node to the left of its bar, which is where the incoming links arrive.
- **Crowded right edge**: small terminal nodes (Reste, Non classé, Bar, Assurance habitation…) stack
  at the bottom with two-line labels that nearly touch (`nodePadding={20}`, height
  `max(360, nodes × 30)`).
- **Redundant columns**: with a single income source, Salaire → Revenus → Budget draws three
  identical bars in a row before anything happens.

## To do / to investigate

- Colour links by their target's role (or source group) at low opacity instead of one grey — e.g.
  red-tinted to expenses, violet to Épargne, teal to Reste; recharts accepts a custom `link` renderer.
- Label placement: put group (middle-column) labels above their bar or inside a white halo
  (`paint-order: stroke`) so crossing links don't cover them; drop the amount line when the node is
  shorter than two text lines (tooltip still has it).
- Skip the Revenus hub when there is only one income source (and no uncategorised income or
  désépargne), linking the source straight to Budget. Keep `moneyFlow.test.ts` passing; the income
  total must still match `data.income`.
- Revisit `foldThreshold` (2.5 % of expenses) and `nodePadding` / height so the terminal column
  breathes; consider sorting leaves by value within each group to reduce crossings (recharts
  `sort` prop / node order in `moneyFlow`).
- Stays a frontend-only transform (see the Money-flow business rule in `.claude/CLAUDE.md`); the
  `Reste`/`Découvert` plug must keep matching the Reste card.

## Progress

- 2026-09-26: noted from a UI review of the running app (demo data).
