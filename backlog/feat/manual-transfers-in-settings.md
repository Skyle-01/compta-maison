# List manual transfer decisions in Settings

## Context

Transfer decisions made on the Transactions page (pair two operations, unpair, mark one operation as
a transfer; `kind_manual=1`, see `backend/app/core/transfers.py::pair_manually` and
`set_transfer_mode`) are exported with the overrides (`transfer_pair` column of `overrides.csv`) but
can't be reviewed in one place. Settings → "Modifications manuelles" only lists `category_manual=1`
rows (`GET /api/transactions?manual=true`).

## To do / to investigate

- API: list `kind_manual=1` rows too, with the partner of a manual pair (extend `manual=true`, or a
  separate filter).
- Settings: show them by type (manual pair, "pas un virement", single-legged transfer) with an
  "Auto" action (`PUT /api/transactions/{id}/transfer` with `{"mode": "auto"}`).
