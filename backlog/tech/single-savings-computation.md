# Compute savings once per month

## Context

`GET /api/dashboard` always answers for one budget month: without `?month=` it picks the latest,
and the frontend always sends one from `months_available`. `month=None` only happens on an empty
DB. Yet savings are computed twice, and one of the two paths only exists for an all-months view
the UI no longer offers:

- `core/categorize.py::_savings_net_cents` buckets each savings account's nets per budget month
  so that an all-months tree can show both an Épargne and a Déficit leaf for one account
  (see its docstring and the Savings business rule in `.claude/CLAUDE.md`).
- `core/categorize.py::_savings_by_month` does the same bucketing keyed by month for `history`.
- `api/dashboard.py::_savings_leaves` walks the tree again to sum `epargne`/`desepargne`, figures
  `history` already holds for that month.

## To do / to investigate

- Decide first (owner's call): is an all-months ("Tous les mois") dashboard option ever coming
  back? If yes, leave this alone.
- Otherwise: one query of nets per (account, budget month); the tree keeps the requested month,
  `history` aggregates by month; the dashboard reads `epargne`/`desepargne` from its `history`
  entry and `_savings_leaves` goes. Drop the all-months paragraphs from docstrings and CLAUDE.md.
- Risk: this is the reconciliation invariant (cards = Sankey = tree total). Tests in
  `test_categorize.py` calling `category_tree(..., month=None)` must pass a month or go.

## Progress

- 2026-09-25: found by the consolidation review; not approved yet, so not done.
