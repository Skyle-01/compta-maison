# Rules scoped to an account

## Context

The same label can appear on two accounts and belong to different categories depending on the account. Today every rule is global (`label_rules` has no account). Decisions taken with the owner (2026-11-02):

- Nullable `account_id` on `label_rules` (canonical account code), NULL = all accounts, which is also the default. One account per rule, no multi-selection: a rule for two accounts out of three is two rules (YAGNI, no link table). Account codes never change, so the reference is stable.
- Hierarchy: an account rule **always** beats a global rule. When both match with different categories it is the intended override, not a conflict. Two rules of the same level (two globals, or two for the same account) with different categories remain a conflict (shipped 2026-11-02: `priority` is gone, `categorize.find_conflicts` and `triage.rule_preview` are the code to extend with the account level).
- The rule editor gets an account field; default « Tous les comptes », also when creating a rule from an « À classer » group. The group does not split by account; the field is visible to restrict.
- No uniqueness constraint on `pattern` exists, so the same pattern on two accounts needs no schema change beyond the new column.

## To do / to investigate

1. Schema: `label_rules.account_id` (rebuild with `reset_db.py --source live`); `rules.csv` gets an `account` column (code, empty = all), read by `import_csv.py::import_rules` and written by `config_export.py`.
2. `apply_rules`: apply account rules first, then global ones to what is still uncategorised; the conflict finder works per level.
3. `rule_preview` and the triage suggestions: only operations of the rule's account when it is scoped; a suggestion from a group does not pre-select an account.
4. API (`api/rules.py`, `schemas.py`) and frontend (`ruleForm.ts` + tests, `RuleEditor`, `RuleRow` shows the account, `lib/api.ts`).
5. Docs: `docs/guide.md`, `.claude/rules/config-files.md` (rules.csv format), `.claude/rules/transfers-triage.md` if the triage changes, CLAUDE.md (Rule definition).
6. `is_income_anchor` on a scoped rule (decided 2026-11-02): allowed, and `core/periods.py::budget_starts` honours the account (a scoped anchor only counts for credits of that account; today the pattern is matched against every credit). Test: the same salary label on two accounts with the anchor scoped to one.

## Progress

- 2026-11-02: item written after a design review with the owner; no code yet.
- 2026-11-02: the conflict model is in place. `find_conflicts(conn)` (core/categorize.py) joins transactions to `label_rules` on `instr` and flags 2+ categories; `apply_rules` assigns by lowest id then blanks the conflicted ids; `rule_preview(db_path, pattern, category_id, rule_id)` compares against `label_rules` directly; `GET /api/transactions/rule-conflicts` and `RuleConflicts.tsx` show them. The account level must enter all of these (join condition, preview, the conflicts payload), plus `rules.csv`/`config_export`/`import_csv` and `_COLUMNS`-style SELECTs in `api/rules.py`. Live DB was rebuilt for the priority drop; this item needs its own `reset_db.py --source live`.
