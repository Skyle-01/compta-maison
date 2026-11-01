# Import the second holder's checking account

## Context

A household checking account (account B, the second holder's) had no statements, so the only trace of it was the rule `Revenus / <second holder>` (pattern = her name as it appears in the transfer labels) classing her transfers to the joint account as income. Her CSV statements are now available (3 months, then imported every month). Decisions taken with the owner:

- No notion of user or owner: the account identifies her operations, and the owner classes them with her from « À classer » (categories completed on the way).
- Budget months stay anchored on the owner's salary (its employer label) only. Her salary (her employer label) is a plain credit, no `is_income_anchor`: a second anchor changes nothing when both land at the end of the month (the earliest deposit of a budget month wins) and would make recent months incomparable with older ones (her statements only exist for the last 3 months). Watch case: if her salary lands before the owner's (e.g. the 29th vs the 30th), it falls into the previous budget month's income.
- The rule `Revenus / <second holder>` stays for months without her statements. Where her statements exist, the transfer pairs with her account's matching debit and becomes `kind='transfer'`; the totals read `kind`, so it leaves the income even though the rule left it a category (from reading `categorize.py`, to verify).
- The monthly averages over 6/12 months mix months with and without her account until enough months have been imported: note it in the guide.

Statement format (sample, account number anonymised): 6 preamble lines (`Numéro Compte`, `Type`, `Compte tenu en`, `Date`, `Solde (EUROS)`, a blank `;;`), header `Date;Libellé;Montant(EUROS)` on line 7, one signed amount column (`-50`, `-3,10`, `1200,00`), dd/mm/yyyy, Windows-1252, no value date, hundreds of trailing `;;` lines. File name `<account number><digits>.csv`, no `RELEVE_` prefix.

## To do / to investigate

1. Profile `_config/bank_profiles.toml` (`amount`, no `date_valeur`, `filename_pattern` extracting the account number) + a test on a fictional CSV of the same layout (preamble, `;;` tail, integer amount, cp1252 `Libellé`). Never change how it reads statements once some are imported (the hash).
2. Create account B (checking, its code is the account number in the statement file name) from Réglages « Comptes » (the row is already in `_config/accounts.csv`), with her name as alias. Note: a leg pairs when its label starts with a transfer marker (`VIR` by default) OR names another account, so the alias only matters for labels without a marker.
3. Her revenue categories (her salary) and starter rules; the rest in « À classer ».
4. Rebuild on the real data and check: the transfer pairs (her side's label must start with `VIR`, else add a marker), her salary lands in the right budget month, the coverage table shows no hole.
5. `docs/guide.md`: note on the averages mixing months with and without her account.

## Progress

- 2026-11-01: spec agreed with the owner; step 1 done (profile `ccp-signe` in `_config/bank_profiles.toml`, tests in `test_parsing.py`). `import_inputs.py` skipped the 3 files: the live DB had no such account (accounts load from `accounts.csv` only on a rebuild). Decision: build account management in Réglages first (`PUT /api/accounts/{code}`, `AccountsSection`), then create the account from the UI and import. DB backup taken before the import in `_backups/pre_import_<ts>/`.
- 2026-11-01: steps 2 and 4 done on the live DB: account created from Réglages, 198 rows imported (2026-08-03 to 2026-11-01), no coverage hole, 6 transfer legs paired from August (on two of the owner's accounts), her salary lands in 2026-09, 2026-10 and 2026-11 with the owner's (same day or within 3 days, no second anchor needed). Left: step 3 (her 116 uncategorised operations and her revenue categories, to do with her in « À classer »), step 5 (superseded by `account-cutoff-and-partial-months.md`: the averages must ignore the months where her account had not started), and the 2026-08 month, partial for her account until its cutoff is set to 2026-08-28. Two operations to ask her about: an unpaired transfer to another account of hers (2026-08-24) and a small credit from a relative (2026-09-25). Her last transfer (2026-11-01) pairs once the owner's account statement beyond 2026-10-16 is imported.
