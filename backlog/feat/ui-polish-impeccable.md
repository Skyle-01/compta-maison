# UI polish with /impeccable

## Context

The pages work, but their visual rendering can improve: hierarchy, spacing, density, and consistency between the dashboard (`frontend/src/app/page.tsx`), Transactions, « À classer », Catégories, Réglages, Import and the printable report (`/rapport`). Each page grew feature by feature, so styles drifted (raised by the owner on 2026-10-22). The `impeccable` skill is meant for this kind of design pass.

## To do / to investigate

- Run `/impeccable` page by page, on the demo DB (command in `.claude/CLAUDE.md`, Dev Workflow), never on the real data.
- Constraints to hand to it:
  - desktop-only (~1400 px), no phone-width work;
  - light theme only (`globals.css` pins `color-scheme: light`);
  - French UI strings, typographic apostrophe in the code (`react/no-unescaped-entities`);
  - the contrast rules in `.claude/rules/frontend-pages.md` (no `zinc-400`/`zinc-300` for readable text, `green-700`/`red-700` for amounts);
  - `/rapport` must keep its A4 pages (`.sheet` / `.sheet-landscape`, `@page`) and print cleanly;
  - shared components (`components/BudgetSection`, `ResteTrend`, `MoneyFlowChart`) are reused by the report: check both places after changing one.
- Screenshots before/after with headless Edge (no Playwright here; see the `ui-checks-headless-edge` memory).
- Keep behaviour unchanged: a visual pass, not a feature change.

Done when:
- Each page has been through the pass, one commit per page (or per shared component).
- `npm run lint`, `npm test`, `npm run build` pass; the report still prints on A4.

## Progress

- 2026-10-22: item opened.
