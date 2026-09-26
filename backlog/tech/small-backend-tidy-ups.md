# Small backend tidy-ups from the stack review

## Context

- `TransferMode = Literal["transfer", "none", "auto"]` is defined in `core/transfers.py` and
  again inline in `schemas.py::TransferModeIn.mode`: two places to update when a mode is added.
- CLAUDE.md says amounts are converted to euros "only at the API boundary", but six public
  functions of `core/categorize.py` return euros and `api/dashboard.py::get_dashboard` does rounded
  float arithmetic (`round(..., 2)`) for épargne / désépargne / reste. Moving the conversion out
  of core would rewrite every categorize test, so the doc is what should change.

## To do / to investigate

- `schemas.py`: `mode: TransferMode` imported from `app.core.transfers` (core has no FastAPI
  import, so this keeps the layering).
- Reword the CLAUDE.md Conventions line to say `core/categorize.py`'s dashboard aggregates return
  euros.

## Progress

- 2026-09-26: found in the stack review.
