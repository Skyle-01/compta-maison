# Fast triage of uncategorised operations (« À classer » page)

## Context

The owner's top priority among the open features. Today an uncategorised operation is handled one row at a time on the Transactions page (`frontend/src/app/transactions/page.tsx`): tick « Sans catégorie uniquement », open the inline editor on a row, pick a leaf in `CategoryPicker` (a plain select), choose « Cette opération » (manual, `PATCH /api/transactions/{id}`) or « Règle (opérations similaires) » (`POST /api/rules`, pattern prefilled by `lib/api.ts::suggestPattern`, live count via `?libelle_contains=&uncategorized=true`), confirm. With 50 rows per page, no grouping, no suggestion and no keyboard flow, this is slow.

Scale on the owner's DB (2026-10-03): 203 uncategorised non-transfer operations, 144 distinct labels, over 12 budget months; 111 rules, 45 categories. Many are recurring merchants whose labels differ only by the dated prefix (`CARTE 12/05 BOULANGERIE DUPONT`, `CARTE 03/06 BOULANGERIE DUPONT`) or by a month in the label (`VIR ... - Avril 2026`). Unpaired outgoing transfers to people are uncategorised too: the owner wants them classed like any other operation (no special transfer action on this page).

Relevant code:
- Rule engine: `backend/app/core/categorize.py::apply_rules` (case-sensitive `instr` substring, rules by ascending `priority` then `id`, first match wins, re-run on every rule mutation, skips `category_manual=1`).
- Uncategorised filter: `api/transactions.py::_filter_clause` (`category_id IS NULL AND real_flow_clause(kind)`).
- Pattern prefill: `lib/api.ts::suggestPattern` (strips `CARTE dd/mm ` and `RET DAB dd/mm/yy `).
- Rule form helpers: `lib/ruleForm.ts` (`DEFAULT_RULE_PRIORITY = 100`, `ruleFormToPayload`).
- Leaf-only targets: `api/categories.py::reject_group_target`, `components/CategoryPicker.tsx`.
- Nav: `frontend/src/app/layout.tsx` (`NAV` array).
- Manual assignments survive rebuilds via `overrides.csv` (see CLAUDE.md Gotchas): bulk manual assignment must keep setting `category_manual=1` (+ optional `note`) so nothing new is needed there.

## Decisions (owner, 2026-10-03)

- A **dedicated page** « À classer » (new nav tab), listing only uncategorised non-transfer operations. The Transactions page stays as it is.
- **Nav tab with a counter**: « À classer (N) », N = uncategorised non-transfer count, refreshed after each action on the page. No other entry point required (the dashboard warning keeps linking to Transactions; no post-import link).
- **Grouping by suggested pattern**: one row per group of similar operations (count, total debit/credit, date range, accounts), expandable to its operations. One action classes the whole group.
- **Order**: groups by total amount, descending (largest absolute total first).
- **Period**: all budget months by default, with an optional month filter (same selector as Transactions).
- **Category suggestion**: a local heuristic (nothing leaves the machine, see README), learned from already categorised operations with similar labels. One keystroke/click accepts it. No LLM.
- **Default action**: a group of 2+ operations defaults to creating a **rule** (editable pattern, live preview); a single operation defaults to a **manual** assignment. The user can switch mode before confirming. Optional description (rule `description` / transaction `note`), as in today's editor.
- **Full keyboard flow**: ↑/↓ to move between groups, type to search a category (fuzzy match on the full path, leaves only), Enter accepts the suggestion or the highlighted category, a key toggles rule/manual, Esc cancels; after a validation the focus moves to the next group.
- **Conflict warning in the preview**: a new rule applies to every non-manual row, so with a lower `priority` number than an existing rule it reclassifies rows that rule already claims. The preview shows « N sans catégorie + M déjà classées par la règle X (Catégorie) seraient reclassées », validation stays allowed.
- **Undo**: the success message (« 5 opérations classées en Variable / Sport ») carries « Annuler » for a few seconds: deletes the created rule, or clears the manual assignments just made (`category_id: null, note: null`, which re-runs the rules).

## To do / to investigate

- Grouping key (backend, `core/`, no FastAPI): normalise each label (strip dated prefixes like `suggestPattern` does, trailing card/reference numbers, month names + years, extra spaces) and group on the result. Check it on the real labels (`_inputs/`, never copy them into the repo) and on `data/demo/`.
- Default rule pattern for a group: the longest common substring of the group's raw labels (guaranteed to match every member, since rules are `instr`), trimmed; fall back to `suggestPattern` for a single row. Watch for too-short/generic results (`VIR `, `CARTE `): flag them or fall back to the normalised key.
- Suggestion heuristic: e.g. tokenise labels (drop generic tokens: CARTE, VIR, INST, PRLV, SEPA, dates, numbers, and words frequent across many categories such as city names), then vote over categorised rows (rule or manual) sharing the group's significant tokens, weighted by token rarity; return the best leaf + a short reason (« comme 4 opérations BOULANGERIE classées en Variable / Courses ») or nothing under a threshold. Pure function, pytest-tested with fictional labels.
- API sketch (to confirm while implementing): `GET /api/transactions/uncategorized-groups?month=` returning groups `{key, pattern, count, debit, credit, first_date, last_date, accounts, transaction_ids, suggestion: {category_id, path, reason} | null}`; a rule preview `GET /api/rules/preview?pattern=&priority=` returning `{uncategorized: n, reclassified: [{rule_id, pattern, category_path, count}]}` (rows with `category_manual=0` whose current rule loses to the new one, i.e. existing `priority` > new priority; a tie goes to the older rule); a bulk manual assignment `PATCH /api/transactions` `{ids, category_id, note}` (one request, one undo). Pydantic models in `schemas.py`, mirrored in `lib/api.ts`, French error messages.
- Category search: a combobox with fuzzy matching on the full path, leaves only (same rule as `CategoryPicker`); maybe extract it as a shared component and reuse it in the Transactions editor later (not required).
- Nav counter: `layout.tsx` is shared by every page; decide how the count refreshes after actions on « À classer » (client nav component + a small event/context, or refetch on route change).
- Respect CLAUDE.md conventions: French UI strings with `’`, text contrast classes, desktop-only layout (~1400 px), `errorMessage(e)` for errors.
- Tests: pytest for grouping, pattern and suggestion (fictional labels), the preview conflict count, the bulk endpoint; vitest for any pure frontend helper (keyboard state, fuzzy filter).
- Update CLAUDE.md (architecture + business rules) and the user guide if `feat/user-guide.md` has landed by then.

Done when:
- The nav shows « À classer (N) » with N equal to `GET /api/transactions?uncategorized=true` `total`.
- On `data/demo/` (copied to `_inputs/`, `reset_db.py --source defaults`), the page lists groups by descending total, each with a default pattern that matches all its members, and a suggestion when a similar categorised operation exists.
- A group can be classed entirely from the keyboard, by rule or manually; the counter and the list update; « Annuler » restores the previous state.
- The rule preview reports rows another rule would lose.
- `pytest`, `ruff check`, `ruff format --check`, `npm run lint`, `npm test`, `npm run build` pass.

## Progress

- 2026-10-03: specified with the owner (decisions above). Not started.
