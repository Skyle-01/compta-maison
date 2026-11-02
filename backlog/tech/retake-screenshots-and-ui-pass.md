# Retake the guide screenshots and check the new UI in a browser

## Context

Three sessions of UI changes on 2026-11-02 were checked by lint, vitest and `next build` only, never rendered: the dashboard lost its « Moyennes mensuelles » section (new `/statistiques` page), Transactions gained an account select, « À classer » gained a « Conflit de règles » group (`RuleConflicts.tsx`) and Catégories reads `?q=` and shows a conflict warning banner. `docs/img/dashboard.png`, `transactions.png` and `a-classer.png` still show the old pages, and the guide has no screenshot for Statistiques.

## To do / to investigate

1. Headless-Edge pass on the demo DB (see the Dev Workflow and the memory note on UI checks): `/statistiques` (month select), `/transactions` (account select + export link), « À classer » with a conflict (add a second rule on a demo label with another category), the `?q=` link into Catégories, the warning banner after saving a conflicting rule.
2. Retake `dashboard.png`, `transactions.png`, `a-classer.png` from the demo data; add `statistiques.png` (route `app/aide/img/[name]/route.ts`) and reference it in `docs/guide.md`.
3. Open question: the Transactions page shows a conflict warning in the 4 s green flash; consider keeping it visible until dismissed.

## Progress

- 2026-11-02: item written at the end of the session that shipped the three changes.
