# Split or index the Settings page

## Context

`frontend/src/app/settings/page.tsx` (~1040 lines) renders everything on one scrolling page, in this
order: Catégories (the full tree), Règles de classement (the whole rule table — 47 rows in the
fictional example, more with real data), Virements internes (transfer markers), Modifications
manuelles, Virements manuels. With the example data the page is ~4 300 px tall at 1400 px wide; the
sections at the bottom are only found by scrolling past the entire rule table. Each section title is
an `<h1>` (lines ~547, 596, 737, 917, 1015), so the page has five top-level headings.

## To do / to investigate

- Options, lightest first: a sticky in-page table of contents with anchors (`id` on each
  `<section>`); tabs within the page (keep the active one in the URL hash so links like the
  dashboard's "Modifier les objectifs" can land on Catégories); or separate routes under
  `settings/` (App Router — check `node_modules/next/dist/docs/` first).
- Make section titles `<h2>` under a single page `<h1>` ("Réglages").
- Consider collapsing the rule table by default or paginating it once the search box is empty.

## Progress

- 2026-09-26: noted from a UI review of the running app (demo data).
