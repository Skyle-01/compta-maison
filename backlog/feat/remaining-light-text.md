# Remaining zinc-400 text outside Settings

## Context

Settings and the transaction lists now use zinc-600 for actions and zinc-500 for informative text
(zinc-400 is 2.6:1 on white, below WCAG AA). A few places still use `text-zinc-400` for text a
user reads or clicks:

- `components/CategoryPicker.tsx`: the « — sans catégorie — » option (an action) and « Aucun
  résultat ».
- `app/transactions/page.tsx`: the rule editor's live match count next to the pattern.
- `app/page.tsx`: the stat cards' « stable vs <mois> » delta line, the budget rows' « / <objectif> »
  and the `ok` tone of `TONE_TEXT`, the balance tree's ▸/▾ toggles and its « Chargement… » /
  empty drill-down lines, « Aucun revenu ni dépense catégorisée pour l’instant. ».

(The `md:hidden` hint above the Sankey is phone-only: ignore it, the app is desktop-only.)

## To do / to investigate

- Apply the same rule (actions zinc-600 + hover zinc-900, informative zinc-500), keeping what is
  deliberately subtle (a « stable » delta) readable; check each on the demo database at 1400 px.
- When done, drop the pointer to this file at the end of CLAUDE.md's « Text contrast » convention.

## Progress

- 2026-09-27: listed with `grep -rn text-zinc-400 frontend/src` after the Settings contrast fix.
