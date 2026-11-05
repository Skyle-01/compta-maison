# Retake the guide screenshots and check the new UI in a browser

## Context

Three sessions of UI changes on 2026-11-02 were checked by lint, vitest and `next build` only, never rendered: the dashboard lost its « Moyennes mensuelles » section (new `/statistiques` page), Transactions gained an account select, « À classer » gained a « Conflit de règles » group (`RuleConflicts.tsx`) and Catégories reads `?q=` and shows a conflict warning banner. The guide screenshots were all retaken on 2026-11-05 (including the new `statistiques.png`); what is left is the browser check of the conflict features and one open question, below.

## To do / to investigate

1. Headless-Edge pass on the demo DB (see the Dev Workflow and the memory note on UI checks): `/statistiques` (month select), `/transactions` (account select + export link), « À classer » with a conflict (add a second rule on a demo label with another category), the `?q=` link into Catégories, the warning banner after saving a conflicting rule.
2. Open question: the Transactions page shows a conflict warning in the 4 s green flash; consider keeping it visible until dismissed.

## Progress

- 2026-11-02: the split feature (« Scinder » in the Transactions row editor, « Courses + Maison » in the category cell, « scindée, sur N € » in the Catégories manual list) changes `transactions.png` and `categories.png` visibly: retake them from the demo data once a split is set on a demo operation.
- 2026-11-02: item written at the end of the session that shipped the three changes.
- 2026-11-02: the account-scoped rules session ran a headless-Edge pass on the demo DB for its own change only: the account select in the Catégories rule editor (add and inline edit, `RuleRow` badge), the Transactions rule-mode editor and the « À classer » group editor all render and work, and the Transactions match count and the « À classer » preview line follow the chosen account (14 checks, scratch scripts not kept). The screenshots part was done on 2026-11-05 (see below).
- 2026-11-02: the account colours session (colour dot before the account code, colour swatches in Réglages « Comptes ») did not retake any screenshot. `docs/img/settings.png`, `transactions.png`, `a-classer.png` and `dashboard.png` (expanded tree leaf) should be retaken from the demo data (`data/accounts.csv` sets `slate` on JOINT, the other accounts take their default colour by position).
- 2026-11-05: the navigation session (menu in three groups with a count badge, « Tableau de bord » renamed « Le mois », new Budget page, tree always open) retook `docs/img/dashboard.png` and added `docs/img/budget.png` from the demo DB, and checked `/`, `/budget` and the old `?month=all` URL in headless Edge. Every other screenshot (`transactions`, `a-classer`, `categories`, `import`, `settings`) still showed the old menu at the top, so the point 2 retake covered all of them; `statistiques.png` is still missing.
- 2026-11-05: the shared month/account filter session retook `dashboard.png`, `budget.png`, `transactions.png` and `a-classer.png` from the demo DB (new filter bar; the menu is the new one) and checked the filters in headless Edge, on `next dev` and on `next build` + `next start` (sharing across pages, « Tous les mois », deep link, account filter on « À classer »). Still to retake: `categories.png`, `import.png`, `settings.png` (old menu); `statistiques.png` is still missing.
- 2026-11-05: retook `categories.png` (Courses expanded, with a split operation set on the scratch demo DB), `import.png`, `settings.png` and added `statistiques.png` (referenced in `docs/guide.md`), all from the demo DB in headless Edge on `next dev`. All guide screenshots now show the new menu. Left of point 1: the « Conflit de règles » group in « À classer », the `?q=` link into Catégories and the conflict banner after saving a rule were not re-checked; the open question (point 2 above) is still open.
