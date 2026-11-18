# External savings deposits also match the rows of imported accounts

## Context

An external savings account (a `type='savings'` account with a `deposit_pattern`, no statement of its own, e.g. `ENFANT` in the example data) is documented as funded by the **checking-account rows** whose libellé contains the pattern (case-insensitive). Two places apply the pattern to **every** row, whatever its account:

- `backend/app/core/transfers.py:272-275` (final pass of `recompute_transfers`): `UPDATE transactions SET kind = 'transfer' WHERE kind_manual = 0 AND kind != 'transfer' AND instr(casefold(libelle), casefold(?)) > 0`. A row of an imported savings account (LIVRET) whose libellé contains the pattern becomes `kind='transfer'` and leaves the income/expense totals.
- `backend/app/core/categorize.py:589-594` (`_savings_month_nets`, external branch): the deposit query has no account filter, so the same row also reduces the external account's net.

Failing case (reproduced by a scratch script on 2026-11-18): pattern `ENFANT`; PERSO debit 1.00 EUR "VIR ENFANT" (kind transfer) and LIVRET credit 0.20 EUR "INTERETS ENFANT LIVRET" (kind income), budget month 2026-05. `_savings_net_cents` gives ENFANT 0.80 (its debit minus the LIVRET credit) and `monthly_totals` an `epargne` of 1.00 EUR; the documented result is ENFANT 1.00, LIVRET 0.20, `epargne` 1.20 EUR. A paired checking-to-LIVRET transfer whose label contains the pattern would count once as an ENFANT deposit and again as a LIVRET credit (inferred, not reproduced).

Owner decision (2026-11-18): keep both directions (net = Σdebit - Σcredit of the matching rows, a refund lowers the deposit, as documented); only restrict the rows to checking accounts.

## To do / to investigate

- Restrict both queries to checking accounts, for example `account_id IN (SELECT code FROM accounts WHERE type = 'checking')`. Prefer one shared SQL fragment or helper next to `savings_accounts` rather than two copies, since the two places must keep agreeing (`transfers.py` marks the rows, `categorize.py` sums them).
- Four readers apply the pattern with no account filter and must all get the same rule (settled by the spec review): the SQL in `transfers.py:272-275`, the SQL in `categorize.py:589-593`, the drill-down `GET /api/transactions?deposit_pattern=` (`api/transactions.py:117-121`) and the Python helper `core/transfers.py::_is_external_deposit` (`:65-69`), used by `_legs`, `pair_manually` and `set_transfer_mode`. One shared definition near `db.savings_accounts`; `_is_external_deposit` then needs the row's account, which `set_transfer_mode` must select. Accepted side effect: a LIVRET row containing the pattern becomes eligible for pairing and for `pair_manually` again, which is consistent with the decision above.
- Out of scope: the paired checking-to-LIVRET transfer whose label contains the pattern. The checking debit still counts as an ENFANT deposit and the LIVRET credit as LIVRET's net after this fix; it is a pattern overlapping a transfer label, a configuration matter. The sentence above is background, not an acceptance criterion.
- Tests (in `test_categorize.py` / `test_transfers.py`, fictional accounts `PERSO`, `LIVRET`, `ENFANT`): the failing case above (LIVRET row stays `kind='income'`, ENFANT net 1.00, `epargne` 1.20); a checking row with the pattern still becomes a transfer; the drill-down returns checking rows only.
- Update the `.claude/CLAUDE.md` savings bullet only if its wording does not already say "checking-account rows" (it does today: no change expected).

## Progress

- 2026-11-18: found by the code review; reproduced for the savings net, the second `transfers.py` pass read directly. Decision on the direction recorded above. Not fixed.
