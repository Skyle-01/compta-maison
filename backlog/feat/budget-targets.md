# Budget targets per category

## Context

Compare what is spent in a category with a target amount. Nothing exists yet: `categories` only has
`id`, `name`, `parent_id` (`backend/app/db.py`), and the dashboard (`backend/app/api/dashboard.py`,
`frontend/src/app/page.tsx`) shows actuals only.

This is not the per-category month-over-month comparison, which was tried and dropped.

## To do / to investigate

- Where the target lives: a `budget_target_cents` column on `categories`, as a monthly amount. Leaf
  only, with groups showing the sum of their leaves?
- Schema change: there is no migration ladder, so rebuild with `reset_db.py --source live`. The
  target must survive snapshots, so it goes into the `categories.csv` format
  (`api/categories.py::category_paths` / `csv_response`, `scripts/import_csv.py::import_categories`),
  read with a default so older files still load.
- Settings: edit the target from the Catégories tree.
- Dashboard: actual vs target per category for the selected month. Decide how categories that mix
  income and expenses (Salaire under Fixe) are treated.
