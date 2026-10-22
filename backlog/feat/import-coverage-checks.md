# Stronger checks that imported statements cover every day

## Context

Since 2026-10-22 an import flags a file that starts more than 4 days after its account's last operation (`core/inputs.py::gap_warning`, shown on the Import page). That check is a heuristic: it only sees the import that creates a hole (a later rescan of `_inputs/` overlaps), it can't see a hole between two files imported out of date order, and a quiet account (a livret) can warn for nothing.

## To do / to investigate

- Balance check if the bank CSV carries a running balance: previous closing balance + Σ flows = new opening balance. Ties in with `feat/account-balances.md`. Never touch the row hash inputs (`TestDefaultFormatFrozen`).
- A per-account coverage view (covered date ranges, holes) built from the DB alone, e.g. on the Import page or in Réglages, so a hole stays visible after the import that created it. Weaker heuristic: unusually long stretches without any operation on a busy account.
- Out of scope: external savings accounts (`deposit_pattern`, no statement of their own).

## Progress

- 2026-10-22: split from the finished import gap warning.
