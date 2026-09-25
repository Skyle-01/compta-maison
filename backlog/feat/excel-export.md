# Excel export

## Context

Idea: an Excel report. Today the only exports are the Settings CSVs (categories, rules, manual
overrides).

## To do / to investigate

- Decide what it contains: the transactions of a month, the dashboard totals, the monthly history
  (`core/categorize.py::monthly_totals`)?
- `openpyxl` would be a new runtime dependency (the backend is stdlib apart from FastAPI). A CSV
  export of transactions may be enough.
