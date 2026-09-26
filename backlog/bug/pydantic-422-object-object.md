# Pydantic validation errors would show as "[object Object]"

## Context

`frontend/src/lib/api.ts::request` maps `body.detail` with `String`. The routers raise
`HTTPException(detail=[str, ...])`, which fits, but FastAPI's own request-validation 422s send
`detail` as a list of objects (`{type, loc, msg, input, ...}`), which would render as
`[object Object]`. Unreachable today because the UI validates the constrained fields
(`CategoryIn.name`, `RuleIn.pattern`, `CategoryTargetIn.budget_target`) before sending.

Related: pages show `String(e)` for an `ApiError`, which prefixes "Error: " (English) to the
message; the Import page uses `err.message` instead.

## To do / to investigate

- In `request`, map object items to their `msg` (e.g. `typeof d === "string" ? d : d.msg`).
- Decide whether pages should show `e.message` rather than `String(e)`.

## Progress

- 2026-09-26: noticed in the stack review (latent, no user-visible case yet).
