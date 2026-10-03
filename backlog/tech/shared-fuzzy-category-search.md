# One category search for every picker

## Context

Two category pickers now coexist:
- `frontend/src/components/CategoryPicker.tsx` (Transactions editor, Settings rule editor): case-insensitive `includes` on `shortPath`, with the leaf-only filter computed inline.
- The « À classer » page (`frontend/src/app/a-classer/page.tsx`): keyboard-driven search using `lib/triage.ts::searchCategories` (fuzzy subsequence match on the full path, accent-folded, word-start bonus) and `lib/triage.ts::leafCategories`.

The leaf-only rule is therefore written twice (`CategoryPicker` and `leafCategories`), and the Transactions editor still has the weaker search with no ↑/↓ highlight.

## To do / to investigate

- Make `CategoryPicker` use `leafCategories` and `searchCategories` (and ↑/↓ + Enter on the highlighted result), keeping its props and its empty « sans catégorie » entry.
- Optionally move `fold`/`fuzzyScore`/`searchCategories`/`leafCategories` out of `lib/triage.ts` into a `lib/categorySearch.ts` once two pages use them; keep their vitest tests.
- Check the Transactions editor and the Settings rule editor by hand at ~1400 px.

## Progress

- 2026-10-03: noted while building the « À classer » page (the backlog item had left it as "not required"). Not started.
