# User guide (« Aide » page)

## Context

There is no user documentation. The README (English) covers installation, `_config/` files, rebuilds and other banks, aimed at whoever sets the app up. CLAUDE.md is for developers. Features such as budget targets, rules vs manual assignments, transfer pairing, « Tous les mois » or the savings derivation are only discoverable by trying the UI. The owner wants a guide that explains every feature and its how-tos.

## Decisions (owner, 2026-10-03)

- **Form**: a Markdown source in the repo (`docs/guide.md`, readable on GitHub), rendered in a new « Aide » nav tab of the app, with « ? » links on each page pointing to the matching section (anchor).
- **Language and audience**: French, for the person using the app. Installation and `_config/` setup stay in the README (English); the guide links to it.
- **Screenshots** taken from the fictional demo data (`data/demo/` copied to `_inputs/`, `reset_db.py --source defaults`), never from real data. Retake them when the UI changes.
- **Sync rule in CLAUDE.md**: any user-visible feature change updates the guide in the same commit (like `lib/api.ts` for response shapes).
- **Coverage test**: a test fails when the guide drifts, e.g. every « ? » anchor used in the frontend exists as a heading in `docs/guide.md`, and every `NAV` page (`frontend/src/app/layout.tsx`) has a section.

## To do / to investigate

- Features to cover (check the UI and CLAUDE.md "Business rules" / "Current State" when writing, this list may be stale):
  - Concepts: accounts (checking / savings / external savings with `deposit_pattern`), budget months anchored on the salary, income / expense / transfer kinds, the leaf-only category tree.
  - Import: upload with account inference, « Importer les nouveaux relevés », deduplication, archive in `_inputs/`.
  - Dashboard: hero, the four cards and how they reconcile (Revenus − Dépenses − Épargne = Reste), deltas and the Reste sparkline, Budget section, Money-flow Sankey, balance tree and drill-down, « Tous les mois », uncategorised warning.
  - Transactions: filters, categorising (manual vs rule, live count, description/note), ⚙/✎ badges, transfer pairing / « Marquer comme virement » / Dissocier / Auto, CSV export.
  - Catégories page: categories (create, rename, re-parent, delete and what happens to rules/rows), budget targets (« ＋ objectif »), rules (priority, income anchor, search, edit), manual assignments, moving rules and manual assignments between leaves, « Classer à part ».
  - Settings: transfer markers, « Virements manuels », « Sauvegarde » (« Enregistrer la configuration » into `_config/`).
  - Savings: épargne / désépargne and why an account can show both in « Tous les mois ».
  - Backups and rebuilds (« Enregistrer la configuration », `reset_db.py` sources, `_backups/`), as a short "how to" pointing to the README for details.
  - Later features: « À classer » (`feat/quick-categorisation.md`) and « Moyennes mensuelles » (`feat/category-averages.md`) if they have landed; otherwise the sync rule adds them when they do.
- Rendering: the frontend has no Markdown dependency (`next`, `react`, `recharts` only). Options: add `react-markdown` (+ heading ids for anchors), or a build-time conversion; check Next 16 docs in `frontend/node_modules/next/dist/docs/` for reading a file outside `src/` from a server component (`docs/guide.md` lives at the repo root). Images under `docs/img/`, served to the app somehow (copy to `public/` or import); pick the simplest that keeps the GitHub view working.
- How-to style: task-oriented sections (« Fixer un objectif de budget », « Créer une règle depuis une opération », « Associer deux opérations en virement »…), each with the exact French UI labels in « ».
- Coverage test location: vitest in `frontend/src/lib/` (reads `docs/guide.md` and the anchor list); keep the anchor list in one exported constant used by the « ? » links.
- Add the sync rule to CLAUDE.md Conventions, and the `docs/` folder to its Architecture tree.

Done when:
- `docs/guide.md` exists in French and covers every item of the list above that exists in the app at that time.
- The « Aide » tab renders it, anchors work, every page has a « ? » link to its section.
- Screenshots come from the demo data only.
- The coverage test passes and fails when an anchor is removed (checked once by hand).
- CLAUDE.md has the sync rule.
- `npm run lint`, `npm test`, `npm run build` pass.

## Progress

- 2026-10-03: specified with the owner (decisions above). Not started.
