# Retake the guide screenshots and check the new UI in a browser

## Context

Three sessions of UI changes on 2026-11-02 were checked by lint, vitest and `next build` only, never rendered: the dashboard lost its « Moyennes mensuelles » section (new `/statistiques` page), Transactions gained an account select, « À classer » gained a « Conflit de règles » group (`RuleConflicts.tsx`) and Catégories reads `?q=` and shows a conflict warning banner. `docs/img/dashboard.png`, `transactions.png` and `a-classer.png` still show the old pages, and the guide has no screenshot for Statistiques.

## To do / to investigate

1. Headless-Edge pass on the demo DB (see the Dev Workflow and the memory note on UI checks): `/statistiques` (month select), `/transactions` (account select + export link), « À classer » with a conflict (add a second rule on a demo label with another category), the `?q=` link into Catégories, the warning banner after saving a conflicting rule.
2. Retake `transactions.png`, `a-classer.png`, `categories.png`, `import.png` and `settings.png` from the demo data (`dashboard.png` was done on 2026-11-05, see Progress); add `statistiques.png` (route `app/aide/img/[name]/route.ts`) and reference it in `docs/guide.md`.
3. Open question: the Transactions page shows a conflict warning in the 4 s green flash; consider keeping it visible until dismissed.

## Progress

- 2026-11-02: the split feature (« Scinder » in the Transactions row editor, « Courses + Maison » in the category cell, « scindée, sur N € » in the Catégories manual list) changes `transactions.png` and `categories.png` visibly: retake them from the demo data once a split is set on a demo operation.
- 2026-11-02: item written at the end of the session that shipped the three changes.
- 2026-11-02: the account-scoped rules session ran a headless-Edge pass on the demo DB for its own change only: the account select in the Catégories rule editor (add and inline edit, `RuleRow` badge), the Transactions rule-mode editor and the « À classer » group editor all render and work, and the Transactions match count and the « À classer » preview line follow the chosen account (14 checks, scratch scripts not kept). Still to do: the three points above, and the new account select on the Catégories and « À classer » screenshots.
- 2026-11-02: the account colours session (colour dot before the account code, colour swatches in Réglages « Comptes ») did not retake any screenshot. `docs/img/settings.png`, `transactions.png`, `a-classer.png` and `dashboard.png` (expanded tree leaf) should be retaken from the demo data (`data/accounts.csv` sets `slate` on JOINT, the other accounts take their default colour by position).
- 2026-11-05: the navigation session (menu in three groups with a count badge, « Tableau de bord » renamed « Le mois », new Budget page, tree always open) retook `docs/img/dashboard.png` and added `docs/img/budget.png` from the demo DB, and checked `/`, `/budget` and the old `?month=all` URL in headless Edge. Every other screenshot (`transactions`, `a-classer`, `categories`, `import`, `settings`) still shows the old menu at the top, so the point 2 retake now covers all of them; `statistiques.png` is still missing.
