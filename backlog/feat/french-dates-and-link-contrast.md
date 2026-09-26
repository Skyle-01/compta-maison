# French date display and more visible row actions in transaction tables

## Context

Two readability nits on the Transactions page (`frontend/src/app/transactions/page.tsx`), which
also apply to the other transaction lists:

- **ISO dates in a French UI**: rows show the raw `tx.date_valeur` string (`2026-09-21`), while the
  rest of the interface is French (`frenchMonth`, `formatEuro`). Same raw rendering in
  `app/settings/page.tsx` (Modifications manuelles ~line 789, Virements manuels ~line 945) and the
  dashboard drill-down (`app/page.tsx` ~line 336). Note the column shows the *value* date and the
  list is ordered by `date_valeur` (`api/transactions.py`), whereas transfer pairing uses
  `date_operation` — worth deciding which one the "Date" column should show.
- **Low-contrast actions**: "Modifier", "Dissocier", "Auto" and the provenance badges are
  `text-xs text-zinc-400` (lines ~301–317, 422–439, 496) on white — light enough to be missed and
  below WCAG AA contrast for small text.

## To do / to investigate

- Add a `frenchDate` helper next to `frenchMonth` in `lib/api.ts` (`Intl.DateTimeFormat("fr-FR")`,
  e.g. `21/09/2026`, or `21 sept.` when the month is already selected) with a vitest case, and use
  it in every place listed above.
- Darken the action links to at least `text-zinc-500` (or `zinc-600`), keeping hover to
  `zinc-900`; keep the badges subtle but readable.

## Progress

- 2026-09-26: noted from a UI review of the running app (demo data).
