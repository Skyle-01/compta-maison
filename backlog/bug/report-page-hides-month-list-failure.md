# The report page says « Aucune transaction » when the month list fails to load

## Context

`app/rapport/page.tsx::ReportPage` reads the month list from `useFilters()` (`ready`, `months`). `components/FiltersProvider.tsx` fetches it with `api.dashboard()` and, on failure, sets `{ ...NO_MONTHS, loaded: true }` (comment: "the pages report the failure themselves"). So `ready` becomes true with an empty list and the report page prints « Aucune transaction pour l'instant : rien à mettre dans un rapport. » for an unreachable backend, as if the database were empty. Before 2026-11-17 the page fetched the list itself and printed the error. The Export page (`app/export/page.tsx`) reads the same provider and has the same behaviour.

## To do / to investigate

- Let the provider keep the error (for example an `error: string | null` next to `ready`), and have the pages that rely on it for their month list (report, Export) show `errorMessage` instead of the empty-database message. The other pages already show their own fetch error through `useMonthDashboard`.
- Check that « Le mois », Budget and Statistiques are unchanged (they report their own dashboard failure).
- Update `.claude/rules/frontend-pages.md` (shared filters: what `ready` means when the fetch fails).

## Progress

- 2026-11-17: found by the closeout audit after the report page was moved onto `useFilters()`; not fixed.
