---
paths:
  - "backend/app/core/transfers.py"
  - "backend/app/core/triage.py"
  - "backend/app/api/transactions.py"
  - "backend/app/api/rules.py"
  - "backend/tests/test_transfers.py"
  - "backend/tests/test_triage.py"
---

# Transfer pairing and triage: algorithms

The invariants (what a transfer is, manual decisions) are in `.claude/CLAUDE.md`.

## Auto-pairing (`core/transfers.py::recompute_transfers` → `_legs` → `pair_legs`)
- Matched on `date_operation`; credits bucketed by amount and bisected by day; 3-day window, different accounts.
- A leg is eligible when its label starts with a transfer marker or names another account. Each leg's `refs` = the other accounts one of whose names (label or alias, case-insensitive, never the code: a short code would turn up inside unrelated labels) its libellé contains (`account_refs`; a former bank name kept as an alias counts). A non-empty `refs` makes a leg eligible without a marker (`vers LIVRET A`).
- A candidate is excluded when a label names accounts that exclude the other leg's, else scored by `agreement` (how many of the two labels name the other leg's account, 0-2). A leg picks, among the best-scored free candidates, the closest-dated one, **unless** they span several `(account_id, triage.label_key)` classes (the tenant's rent vs your own transfer, same day and amount): then it is ambiguous and stays unpaired for a manual pair.
- A pair forms when each leg is the other's pick, in rounds until stable (independent of import order); each leg used once.
- Markers: case-insensitive **prefix** match on the stripped label (unlike rules); `*` = any label (legacy amount+date pairing); empty table = `DEFAULT_TRANSFER_MARKERS` (`VIR`).
- `transfer_candidates` (for « À classer »): per operation, the possible other legs under the same tests (eligible label, same amount, other account, window, no contradiction, neither leg already a transfer nor `kind_manual`) without requiring a unique match, best `agreement` then closest date first.

## Triage (`core/triage.py`, `GET /api/transactions/uncategorized-groups?month=`)
- Uncategorised non-transfer operations (unpaired transfers included) grouped by `label_key`: the label's words without digits, dates, amounts or month names, accents and case folded; a label left without a significant word keeps its raw text, so it is never merged. All months by default; largest gross total (debits + credits) first.
- `default_pattern`: the longest **digit-free** substring common to every member's raw label, trimmed to whole words, edge month names and punctuation dropped, so it always matches every member with `instr`. `pattern_generic` when it has under 3 letters outside bank vocabulary (`GENERIC_TOKENS`: CARTE, VIR, PRLV, SEPA…).
- `SuggestionIndex` (built from every categorised real flow, whatever the month): the majority category of rows with the same key, else a vote of the key's significant words (each word seen in exactly one category votes for it), and the label's **first** significant word (merchant/payee) must vote for the winner; ≥ 60 % of the votes or nothing.
- `rule_preview` (`GET /api/rules/preview?pattern=&priority=&category_id=`): the uncategorised rows the pattern matches plus, per existing rule, the rule-classified non-manual rows it would take (that rule's `priority` number is larger; a tie keeps the older rule; rules already on `category_id` skipped).
- Bulk `PATCH /api/transactions` `{ids, category_id, note}` (`TransactionsBulkPatch`): same effect as the single PATCH with both fields; `category_id: null` clears and re-runs the rules.
