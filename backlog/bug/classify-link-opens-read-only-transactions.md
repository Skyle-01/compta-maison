# « Les classer » on « Le mois » opens a page where nothing can be classed

## Context

The amber warning of « Le mois » (« N opérations encore sans catégorie ... Les classer → », `frontend/src/app/page.tsx`, the `Link` to `/transactions?uncategorized=1&month=M`) sends to the Transactions page. Since 2026-11-11 that page is a read-only list: classing, splitting and rule creation live in « À classer », and an uncategorised row there only shows an « À classer » link (`app/transactions/TransactionRow.tsx`). The user who clicks « Les classer » therefore lands on a list and has to click again on one of its rows to reach the page where classing happens.

## To do / to investigate

- Point the link to `/a-classer?month=M`: `FiltersProvider` applies `?month=` on every page (`lib/periodFilter.ts::applyUrl`), and « À classer » opens on the shared month.
- Then check what still uses the `?uncategorized=1` preset of the Transactions page (`app/transactions/page.tsx`, read once through `useSearchParams`): if no link is left, the checkbox stays but the URL preset and its comment can go.
- Update the texts that describe the link: `.claude/rules/frontend-pages.md` (shared filters: « Les classer → » is given as the example relying on `withoutUrlFilters`) and `docs/guide.md` (the paragraph on shared filters names the link).
- `lib/periodFilter.test.ts` uses `?uncategorized=1&month=` as its sample URL: still valid as a generic "other keys stay" case, keep or rename.

## Progress

- 2026-11-12: noticed while reading « Le mois » for the report specs; not fixed.
