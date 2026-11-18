# A « Règles » page: see, search and clean every rule at once

## Context

Owner feedback (2026-11-12): rules can only be seen in the Catégories tree, one leaf at a time (`app/categories/LeafContents.tsx`, `RuleRow.tsx`). That makes it hard to search them (at least), to spot a mistake, to see duplicates or rules that overlap, to see at a glance which account a rule applies to, and to understand the precedence between rules.

What exists today:

- `GET /api/rules` returns every rule with `operation_count`, `debit`, `credit` (`api/rules.py`, `RuleOut`), but no category path and no hint of a problem. `PUT` / `DELETE /api/rules/{id}` edit and delete; `POST /api/categories/{id}/move` `{rule_ids, transaction_ids}` moves rules (with `undoMoves` on the page for « Annuler »).
- Overlaps are only detected for operations (`categorize.find_conflicts`, on demand, different categories only) and for a rule being saved (`triage.rule_preview`, a warning). Nothing reports an exact duplicate, a redundant rule, a global rule hidden by an account rule, or a rule that classifies nothing.
- Precedence (`apply_rules`): a rule of an account beats a global one on that account's operations; within a level the lowest id wins when the categories agree; two categories at one level = conflict, the operation stays unclassed. Patterns are case-sensitive substrings.
- The Catégories page already owns the rule UI: `RuleRow` (summary line, expand to operations, inline edit, delete), `RuleEditor` (+ `lib/ruleForm.ts`), `RuleOperations`, and in `page.tsx` the `run` / `act` / undo / toast block, `warnOfConflicts`, search (`lib/categorySearch`, `searchTree`, `?q=` via `queryFromSearch`).

## To do / to investigate

A new page « Règles » (`/regles`, nav « Traiter » right after « Catégories »). It is for reading and cleaning rules, not creating them (creation stays in « À classer » and under a leaf in Catégories). Nothing is removed from Catégories.

### Page content

- One flat table, one row per rule: expand arrow (its operations, `RuleOperations`), pattern (mono), category full path, account (`AccountDot` + code, or « Tous »), operation count, net amount, problem badges, ✎ and ✕.
- Default sort: pattern, accents and case folded, so overlapping patterns (`EDF`, `EDF CLIENTS`) sit next to each other. A « Trier par » select: pattern (default), category, account, operations.
- Search (accents and case folded) on pattern, description and category path, reusing `lib/categorySearch` / `fold`. Filters: account (the rules of that account plus the global ones that apply to it), category (a group = its whole subtree), problem (« avec problème », or one type). Not the shared month filter: counts stay over all operations, like Catégories.
- A short legend above the table states the precedence: a rule of an account beats a rule of all accounts; at one level two different categories are a conflict. The account column and the badges' tooltips repeat it.
- Problem badges, each naming the other rule(s) and its click showing the pair: the list narrows to the rule and the rules it refers to, with a removable chip, to compare them side by side.
- Quick move: the category cell is a `CategoryPicker` (leaf-only); picking a leaf moves the rule through `POST /api/categories/{id}/move` with « Annuler » (toast, Alt+Z). Everything else (pattern, account, description, income anchor) goes through the inline editor (`RuleEditor`); a conflict warning after a save is shown as on Catégories (`warnOfConflicts`). Delete asks for confirmation, as on Catégories.
- Empty states: no rule yet (point to « À classer »), no result for the filters.

### Problems detected (backend, on demand, never stored)

New `core/` module (logic only), exposed as `GET /api/rules/issues` returning, per rule id, a list of issues; `GET /api/rules` is left alone so Catégories pays nothing for it. A rule's level = its `account_id` (NULL = global). Case-sensitive substring tests, like `instr` in `apply_rules`.

| Issue | Definition |
|---|---|
| `duplicate` | same pattern, same account, same category, same `is_income_anchor` as a rule of lower id (the later one is flagged: deleting it fixes it) |
| `redundant` | same category and same anchor flag as another rule whose pattern is strictly contained in its own, at its level or global: everything it matches the other one matches too. An equal pattern is `redundant` only for an account rule facing a global one (equal patterns at one level are `duplicate`) |
| `conflict` | rules of different categories at one level that match at least one common non-manual real-flow operation: the other rule and the operation count (same definition as `find_conflicts`) |
| `shadowed` | a global rule whose matches include operations of accounts where an account rule matches: the operation count it loses and the overriding rules; flagged « masquée » when it keeps none |
| `unused` | classifies no operation and is not `shadowed` |

An account rule over a global one in another category is a legitimate override, never a conflict. Two anchors that differ (`is_income_anchor`) are never redundant. Not covered, on purpose: case-insensitive near-duplicates (`Edf` vs `EDF` are different rules for `apply_rules`).

Precisions (spec review, 2026-11-12):

- `redundant` is a test on the patterns, not a simulation. Deleting an account rule hands its operations back to the global level, where a rule of another category may create a conflict (`find_conflicts`, `in_force`): the badge tooltip says the rules overlap, never that deleting is harmless.
- `shadowed` and `unused` count the same operations as `apply_rules` (every non-manual operation, transfers included), so « masquée » and « inutilisée » agree with `operation_count`; only `conflict` is limited to real flows, like `find_conflicts`. `unused` = `operation_count == 0` and not `shadowed`.
- A rule can carry several issues. The only exclusion is `unused` vs `shadowed`; a late duplicate may show `duplicate` and `unused`. The tests pin which combinations are expected.
- Payload: a Pydantic model mapping a rule id to a list of `{kind, rule_ids, count, ...}`, with a flag on `shadowed` for « masquée » (no operation left). It carries no French text: the frontend writes the badge texts. `lib/api.ts` mirrors it in the same commit.

### Code, shared with Catégories (DRY)

The Catégories rule UI is moved or reused, not copied:

1. Move `RuleRow`, `RuleEditor` and `RuleOperations` to `src/components/` (or a `rules/` folder there). `RuleRow` gains an optional `extra` slot (category cell and badges on the new page, nothing in the tree) and its tick box becomes optional (shown only where a selection handler is given: the tree keeps its tick-and-move, the new page does not).
2. Extract the `run` / `act` / undo / toast block of `categories/page.tsx` (error, reload, `notifyUncategorizedChanged`, 8 s toast, Alt+Z) and `warnOfConflicts` into one hook used by both pages: this is the second real use. Do it first, in its own commit, with the Catégories page unchanged for the user.
   `RuleRow` keeps « Classer à part » (passed to `RuleOperations`): the shared hook or the page provides `classAside` with its undo, as `categories/page.tsx` does today. The rows may stay flex lines (no real `<table>`), with the `extra` slot holding the cells.
3. The Catégories tree keeps its « Règles » block and its move bar. Each rule line gains a small link « voir dans Règles » to `/regles?q=<pattern>` (`lib/triage.ts::ruleLink` is the model; the new page reads `?q=` once, like `queryFromSearch`). The « À classer » conflict links stay on `/categories?q=` for now.
4. Pure helpers (search, sort, filters, pair narrowing) in `src/lib/rules.ts` with vitest tests next to it.

Not in this item: creating a rule on the page, ticking several rules to move them (add it if cleaning shows the need: then factor the tree's move bar), editing the account of several rules at once, a merge action (delete the duplicate), disabling a rule without deleting it.

### Tests, docs, checks

- Backend: `tests/test_rule_issues.py` (duplicate, redundant incl. across a global and an account rule, anchor flag differs, conflict with count, account override is no conflict, shadowed with and without remaining operations, unused, case sensitivity) and an API test for `GET /api/rules/issues` (French strings if any, shape). Update `lib/api.ts` in the same commit.
- Demo data: the example `data/rules.csv` needs two or three fictional rules so each issue shows in a UI check, and an `account` column (its header is `category_path;pattern;is_income_anchor;description`; the loader reads `account` as optional) so an account rule can show `shadowed` (the demo test `test_demo_statements_build_a_working_example` and any test pinning the demo rules must keep passing).
- `docs/guide.md`: a « Règles » section and a `GUIDE_ANCHORS` entry (`lib/guide.ts`, the nav test requires it); the Catégories section mentions the link. Screenshot from the demo DB (also listed in `backlog/tech/guide-export-screenshots.md` for retakes).
- `.claude/rules/frontend-pages.md`: a « Règles » section, the Nav line (Traiter group) and the Catégories code layout; `.claude/CLAUDE.md`: the `frontend/` page list and the `api/` router line.
- UI check on the demo DB at 1400 px (headless Edge, see memory): the Nav still fits on one line with the new « Règles » entry, each badge, the pair view, a quick move and its undo, an inline edit that creates a conflict warning, search and the three filters.

Decisions (owner, 2026-11-12): dedicated page rather than a mode of Catégories, in « Traiter » after « Catégories »; flat table sorted by pattern, no grouping; the five issues above; search plus account, category and problem filters, no month filter; actions = inline edit, delete, quick move, operations list, no creation and no multi-select; the Catégories tree keeps its rules (practical), sharing the code with the new page, with a quick move wanted on the new page.

## Progress

- 2026-11-12: spec written from the owner's feedback, open questions settled with the owner the same day; nothing implemented.
- 2026-11-17: done, not committed (nothing user-visible yet): (1) `lib/useChanges.ts` (run / act / undo / Alt+Z / `warnOfConflicts`) extracted from `categories/page.tsx`, with its banners and toast in `components/ChangeNotices.tsx` (`ChangeNotices`, `UndoToast`), Catégories unchanged for the user (checked in headless Edge on the demo DB: rules and tick boxes show, the move bar appears); (2) `RuleRow` (tick box only when `onToggleSelected` is given, `extra` slot after the description), `RuleEditor`, `RuleOperations` and `Net` moved to `components/`; (3) backend: `core/rule_issues.py`, `GET /api/rules/issues` (only rules with an issue appear: `{"<rule id>": [{kind, rule_ids, count, masked}]}`, `count` non-zero for conflict and shadowed, one conflict entry per other rule), `RuleIssue` + `api.ruleIssues()` in `lib/api.ts`, `tests/test_rule_issues.py`, an API test, `data/rules.csv` with an `account` column and 5 fictional rules so the demo shows all five issues (a conflict needs two rules, a shadow needs an account rule).
- 2026-11-17: left to do: `lib/rules.ts` (search, sort, filters, pair narrowing) with vitest tests, the `/regles` page and its nav entry, the « voir dans Règles » link on each rule line of Catégories (`extra`), `docs/guide.md` section + `GUIDE_ANCHORS`, `.claude/rules/frontend-pages.md` section + Nav line, `.claude/CLAUDE.md` (`core/rule_issues.py`, the `api/` router line, the page list), the UI check at 1400 px (Nav on one line, each badge, pair view, quick move and undo, search and filters). The page's own `run`/`act` calls use `useChanges(load, categories)`.
