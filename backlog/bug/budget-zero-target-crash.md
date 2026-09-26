# Dashboard crashes on a zero budget target

## Context

`core/categorize.py::budget_status` orders groups and leaves by `actual / target`, so a target of
0 cents raises `ZeroDivisionError` and `GET /api/dashboard` returns 500 (the whole dashboard, not
just the Budget section). Two ways to get a zero target:

- **No transactions yet**: `api/dashboard.py::get_dashboard` passes
  `n_months = len(months)` when `period is None`, and `months == []` on an empty DB, so every target
  × 0 = 0. Reproduced: a fresh DB with one targeted category, `GET /api/dashboard` → raises. This
  hits a first-time bootstrap from `data/` (which ships targets) with an empty `_inputs/`.
- **Sub-cent input**: `schemas.CategoryTargetIn` only checks `gt=0` in euros, so
  `PUT /api/categories/{id}/target {"budget_target": 0.001}` stores `to_cents(0.001) == 0`.
  (The CSV loader already rejects ≤ 0 cents.)

## To do / to investigate

- In `get_dashboard`, pass `n_months = max(1, len(months))` (or skip the budget when there is no
  month) and make `budget_status`'s sort key tolerate `target == 0` (for example, treat the ratio as 0).
- In `set_category_target`, reject a value whose cents are ≤ 0 with a 422.
- Tests: a dashboard on an empty DB with a target (`tests/test_api.py::TestBudgetTargets`), plus
  PUT 0.001 → 422.

## Progress

- 2026-09-26: found by the session-closeout audit right after the budget-targets feature
  (f84619a); both paths reproduced.
