# Frontend tests

## Context

The frontend has no tests. Low priority: the UI still changes a lot.

## To do / to investigate

- At most vitest on pure logic that can break silently: the helpers in `frontend/src/lib/api.ts`
  (`frenchMonth`, `suggestPattern`, `formatEuro`) and the Sankey transform `moneyFlow` in
  `frontend/src/app/page.tsx`, whose totals must match `income` and `reste` (see the Money-flow rule
  in `.claude/CLAUDE.md`). `moneyFlow` would move to its own module first.
- Add the run to CI (`.github/workflows/ci.yml`).
