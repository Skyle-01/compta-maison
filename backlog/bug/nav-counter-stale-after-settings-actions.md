# « À classer (N) » counter stale after actions on Settings and Import

## Context

The nav counter (`frontend/src/components/Nav.tsx`) refetches `GET /api/transactions?uncategorized=true&limit=1` on every route change and on the `compta:uncategorized-changed` window event (`lib/api.ts::notifyUncategorizedChanged`). Only the « À classer » page and the Transactions page (`submitEditor`, `transferAction`) dispatch the event.

Actions that change the uncategorised count without leaving the page therefore leave N stale until the next navigation:
- Settings (`frontend/src/app/settings/page.tsx`): creating, editing or deleting a rule, deleting a category (its rows become uncategorised), clearing a manual assignment (« Modifications manuelles »), the Auto action of « Virements manuels », editing transfer markers (re-pairs transfers).
- Import page (`frontend/src/app/import/page.tsx`): an upload or « Importer les nouveaux relevés » adds uncategorised rows.

## To do / to investigate

- Call `notifyUncategorizedChanged()` after each successful mutation listed above (the pattern used in `transactions/page.tsx`).
- Check by hand on the demo DB (`data/demo/` + `reset_db.py --source defaults` with `COMPTA_DB` on a throwaway path): delete a rule in Settings, the counter must change without navigating.

## Progress

- 2026-10-03: spotted while building the « À classer » page. Not started.
