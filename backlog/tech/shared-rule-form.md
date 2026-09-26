# Share the rule form state between Settings and Transactions

## Context

Settings models a rule edit as one `RuleForm` object with `emptyRuleForm` / `ruleFormToPayload`
(trimmed pattern, `Number(priority) || 100`, blank description → null)
(`frontend/src/app/settings/page.tsx`). The Transactions categorise editor keeps the same fields in
five `useState`s (`editCategory`, `editNote`, `editPattern`, `editPriority`, `editAnchor`), resets
them with seven setters in `openEditor`, and rebuilds the same payload normalisation inline in
`submitEditor`. Two places define the rule defaults.

## To do / to investigate

- Move `RuleForm`, `emptyRuleForm`, `ruleFormToPayload` to `src/lib` (vitest-testable).
- Transactions: one `form` state + `editMode`; manual mode sends
  `{ category_id: form.category_id, note: form.description.trim() || null }`; the preview effect
  depends on `form.pattern`.
- Keep both layouts: they differ on purpose, `RuleEditor` itself can't be reused without a UI
  change.
- Payloads compared field by field: identical. About −12 lines; worth doing next time either editor
  changes.

## Progress

- 2026-09-26: found in the stack review (medium confidence, modest payoff).
