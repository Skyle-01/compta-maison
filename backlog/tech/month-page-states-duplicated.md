# « Le mois », Budget and Statistiques repeat the same three guards

## Context

`app/page.tsx`, `app/budget/page.tsx` and `app/statistiques/page.tsx` each start with the same lines around `useMonthDashboard`: the error in red, « Chargement... », then the empty-database message (« Aucune transaction pour l'instant : commencez par importer un relevé bancaire depuis la page Importer. »). The copy in `app/page.tsx` has drifted from the two others: it uses an em dash and a typographic apostrophe.

## To do / to investigate

- One small component (or a render helper returned by `useMonthDashboard`) for the three states, used by the three pages; the page body only runs with a loaded month.
- It fixes the drifted copy on the way; no other text changes.

## Progress

- 2026-11-12: noticed while reading the pages for the report specs.
