# « Aucune catégorie pour l’instant. » flashes while the Catégories page loads

## Context

`frontend/src/app/categories/page.tsx` starts with `categories = []` and renders « Aucune catégorie pour l’instant. » until `load()` resolves (categories, rules and every manual assignment, `listAllManual`). On the demo DB under `npm run dev` the empty message stayed on screen for about 1 to 4 s (seen in a headless Edge run on 2026-10-04), which reads as "your categories are gone". The old Settings tree had the same behaviour.

## To do / to investigate

- Track a « not loaded yet » state (e.g. `categories: Category[] | null`) and show nothing, or « Chargement… » in `text-zinc-500`, until the first load ends; keep « Aucune catégorie pour l’instant. » for a real empty tree. A failed first load already shows the red banner.
- Check the other pages for the same pattern only if they are cheap to fix in the same change (minimal diff).

Done when:
- Reloading `/categories` never shows « Aucune catégorie pour l’instant. » on a DB that has categories (check in a browser on the demo DB).
- `npm run lint`, `npm test`, `npm run build` pass.

## Progress
