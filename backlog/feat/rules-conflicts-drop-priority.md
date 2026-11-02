# Drop rule priority and flag rule conflicts

## Context

Rules are substring patterns applied by `apply_rules` (`core/categorize.py`) in `ORDER BY priority, id`, first match wins. The owner does not use priority as a lever and would rather be told when an operation matches several rules with different categories, a real problem to fix by hand or by correcting a rule. Checked on the live DB on 2026-11-02: none of the 1552 distinct labels matches more than one rule, so priority decides nothing today. `_config/rules.csv` holds 133 rules, 61 at the default 100 and 72 with explicit values (1, 2, 3...), a leftover.

Decisions taken with the owner:

- Remove the `priority` column everywhere: `label_rules` schema, `api/rules.py`, `schemas.py`, `rule_preview` (`core/triage.py`, which reasons on priority today), `config_export.py` (`RULES_HEADER`), `import_csv.py` (the loader ignores a legacy `priority` column; the owner's file is cleaned by the next « Enregistrer la configuration »), `lib/ruleForm.ts`, `RuleEditor`, `RuleRow`, `GroupEditor`, `CategoryEditor`, `lib/api.ts`, the guide line « Priorité plus basse = passe d'abord ».
- Conflict = one operation matched by two or more rules of the **same level** with **different categories**. Two rules with the same category are not a conflict. (With account-scoped rules, see `account-scoped-rules.md`, an account rule always beats a global one and that is not a conflict; until then every rule is global.)
- `apply_rules` leaves a conflicted operation uncategorised (no implicit winner); a manual assignment (`category_manual=1`) still wins as today.
- Where it shows: in the rule editor, at preview (`rule_preview`) and on save, « N opérations correspondent aussi à la règle X (catégorie Y) »; and a « Conflit de règles » group in « À classer » showing the rules in cause on each operation. No banner in Catégories.

## To do / to investigate

1. Core: a conflict finder (operations with several same-level matching rules and distinct categories), used by `apply_rules` (skip them), `rule_preview` and the triage.
2. Schema change: rebuild with `reset_db.py --source live` (no migration ladder); update tests, including `TestDefaultFormatFrozen` is untouched (hash does not involve rules).
3. Frontend: remove the priority field, add the conflict message and the triage group; `docs/guide.md`, `.claude/rules/frontend-pages.md`, `.claude/rules/config-files.md` (rules.csv format), CLAUDE.md (Rule definition).
4. Resolving a conflict from « À classer » (decided 2026-11-02): classing the operation by hand, plus a link to each rule in cause (in Catégories) to fix it; no delete or disable button in the group. The French wording of the messages is decided while implementing.

## Progress

- 2026-11-02: item written after a design review with the owner; no code yet. Ships before `account-scoped-rules.md`, which builds on this model.
