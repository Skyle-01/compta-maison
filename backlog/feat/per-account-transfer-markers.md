# Per-account transfer markers

## Context

Auto-pairing only pairs two operations whose labels both start with a transfer marker
(`backend/app/core/transfers.py::has_transfer_marker`, default `VIR`). Markers are global: the
`transfer_markers` table, `transfer_markers.csv`, Settings. With accounts at two banks that label
transfers differently, both prefixes go in the global list, which is usually enough.

## To do / to investigate

- Only worth doing if global markers cause wrong pairs in practice.
- It would need an account column on `transfer_markers`, in `transfer_markers.csv` and in the
  snapshot (`scripts/reset_db.py::export_current`), and `_legs` filtering each leg with its own
  account's markers.
