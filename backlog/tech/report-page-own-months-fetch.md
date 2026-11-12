# The report page fetches the month list the layout already holds

## Context

`app/rapport/page.tsx::ReportPage` calls `api.dashboard()` in an effect only to read `months_available`, keeps it in an `available` state and parses the request from it. `FiltersProvider` (mounted in `layout.tsx`, so around this page too) already loads that list on every route change and exposes it as `useFilters()` `{ ready, months }`; the Export page next door reads it that way. The report page so sends one more dashboard request, of the latest month, whose whole payload but one field is thrown away, and carries an extra state and effect.

## To do / to investigate

- Read `ready` and `months` from `useFilters()`, parse the request once `ready` is true, drop the `available` state and the first effect.
- Check the three states still render: no month at all (« Aucune transaction pour l'instant : rien à mettre dans un rapport. »), loading, a failed load (the provider's fetch failing leaves `ready` false: decide what the page shows then, today it prints the error).

## Progress

- 2026-11-12: noticed while reading the report code.
