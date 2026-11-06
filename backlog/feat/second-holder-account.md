# Finish the second holder's checking account

## Context

The second holder's checking account (account B) is imported and wired in: profile, account with its `start_date` (2026-08-28 in `_config/accounts.csv`), transfer pairs, her salary landing in the right budget months, no coverage hole, months before her start ignored by the averages (partial months). What is left is data work on the live DB, not code.

Decisions kept from the spec, still relevant while categorising:

- No notion of user or owner: the account identifies her operations, and the owner classes them with her from « À classer » (categories completed on the way).
- Budget months stay anchored on the owner's salary only; her salary is a plain credit, no `is_income_anchor`. Watch case: if her salary lands before the owner's, it falls into the previous budget month's income.
- The rule `Revenus / <second holder>` stays for months without her statements; where her statements exist, the transfer pairs with her account's matching debit and becomes `kind='transfer'`, so it leaves the income totals.

## To do / to investigate

1. Classify her uncategorised operations (116 on 2026-11-01) in « À classer », with her: her revenue categories (her salary) and starter rules. Not to be done alone.
2. Two operations to ask her about: an unpaired transfer to another account of hers (2026-08-24) and a small credit from a relative (2026-09-25).
3. Look at the dashboard on the live DB: « partiel » flagged in the month select, September onward reads right (the averages start at 2026-09).
4. Her last transfer (2026-11-01) pairs once the owner's account statement beyond 2026-10-16 is imported: check it after the next import.

Done when 1 and 2 are done and 3 and 4 are checked; delete this file in the commit that records it (no code change expected).

## Progress

- 2026-11-06: reduced to the remaining data work; the profile, account, import, pairing and partial-months parts are done (see git history of this file for the earlier log).
