# Dashboard endpoint opens about 8 SQLite connections per request

## Context

`GET /api/dashboard` (`api/dashboard.py::get_dashboard`) calls `category_tree`, `income_and_expenses`, `uncategorized_balance`, `transfers_summary`, `monthly_totals`, `budget_status` and `category_averages(12)` (through `_budget`), and each opens its own `connect(db_path)`, plus one in the endpoint itself for the month list.

Measured on 2026-10-28 on the demo DB (165 transactions, 30 runs each, in-process TestClient):

| Call | Time |
|---|---|
| `GET /api/dashboard` | 8.6 ms |
| `GET /api/dashboard?month=all` | 8.7 ms |
| `GET /api/dashboard/averages` | 3.9 ms |
| `apply_rules` | 8.5 ms |
| `recompute_all` | 18.8 ms |
| one `connect()` + `SELECT 1` | 0.5 ms |

So the connections cost about 4 ms of the 8.6 ms: negligible for a household app, and the figures are for a small DB.

## To do / to investigate

- Not worth changing now. Revisit only if the dashboard feels slow on the real DB: measure it first on a DB several times larger (many months of statements), where the aggregates, not the connections, are likely to dominate.
- If it ever matters: let the `core/categorize.py` aggregates take an optional open connection so the endpoint can share one, rather than changing their signatures everywhere.

## Progress

- 2026-10-28: measured, no change.
