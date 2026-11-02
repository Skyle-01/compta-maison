# New "Statistiques" page holding the monthly averages

## Context

The dashboard is crowded. The « Moyennes mensuelles » section (`components/AveragesSection`, its own fetch of `GET /api/dashboard/averages`, used only by `app/page.tsx`) moves to a new page, first step to lighten the dashboard. The page may be enriched later; for now it only hosts the averages. Decisions taken with the owner (2026-11-02):

- Route `/statistiques`, nav entry « Statistiques » right after « Tableau de bord » (`lib/nav.ts`).
- The page keeps a month select like the dashboard's (the averages endpoint takes `month=` for its `month_*` columns), so no loss of function and no backend change.

## To do / to investigate

1. New page `src/app/statistiques/page.tsx` with the month select and `AveragesSection`; remove the section from `app/page.tsx`.
2. Nav entry, a heading in `docs/guide.md` and a `GUIDE_ANCHORS` entry (`lib/guide.ts`, checked by `guide.test.ts`), a « ? » `HelpLink` on the page.
3. Guide: move the averages text from the dashboard section to the new page; retake the screenshots from the demo data.
4. Update `.claude/rules/frontend-pages.md` (dashboard and new page behaviour) and the CLAUDE.md architecture lines that mention `AveragesSection` as dashboard-only.
5. Check the report (`/rapport`) does not depend on the section (it reuses ResteTrend, BudgetSection, MoneyFlowChart, Gap, not AveragesSection).

## Progress

- 2026-11-02: item written after the owner's list of improvements; no code yet.
