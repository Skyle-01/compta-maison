# Revisit generating TS types from OpenAPI (not now)

## Context

`frontend/src/lib/api.ts` mirrors `backend/app/schemas.py` by hand. The 2026-09-26 stack review
compared all 17 interfaces with `schemas.py` and the dict builders in `core/categorize.py`
(`_node`, `uncategorized_balance`, `transfers_summary`, `monthly_totals`, `budget_status`): no
missing, extra or differently typed field (TS is narrower on `kind` / `type`, compatible).

Generation (e.g. openapi-typescript) is not worth it today: four `Dashboard` payloads
(`by_category`, `uncategorized`, `transfers`, `history`) are `dict[str, Any]`, so it would emit
`unknown` for the most complex shapes; it would first need ~25 lines of new Pydantic models
(recursive tree node included), plus a dependency and a build step.

## To do / to investigate

- Reconsider if real drift appears, or if those payloads get Pydantic models for another reason.
- Until then: when changing a response shape, update `api.ts` in the same commit.

## Progress

- 2026-09-26: decided to keep the hand-written client.
