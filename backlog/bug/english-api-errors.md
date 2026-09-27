# Backend error messages reach the French UI in English

## Context

The pages show a failed request with `errorMessage(e)` (`frontend/src/lib/api.ts`), which prints
the response's `detail` strings as they come (validation objects by their `msg`). Every
`HTTPException` detail in `backend/app/api/*.py` is English (23 of them, e.g. `'Salaire' already
exists under that parent` on a duplicate rename, `This category has subcategories; delete or move
them first`, `Unknown category id: 12`), and so are Pydantic's validation messages (`Input should
be greater than 0` for a negative budget target sent to `PUT /api/categories/{id}/target`). The
rest of the UI is French, and since Settings now shows each error in its section (sticky under the
table of contents) the English text is more prominent.

Reproduced on the demo database (2026-09-27): renaming « Fixe / Impôt » to « Salaire » returns
409 `'Salaire' already exists under that parent`; the API rejects `{"budget_target": -5}` with
`Input should be greater than 0`.

## To do / to investigate

- Decide where the French lives: in the backend details (simplest, the API has a single French
  client; tests asserting on the English strings would change) or in a frontend mapping (keeps
  the API English but has to recognise messages, brittle).
- Pydantic's own messages: map the few validation errors the UI can trigger (a type/`gt` error on
  a known field) to a French message, or validate in the frontend before sending (the budget
  target already is: `parseTarget`).
- Import errors (`api/imports.py`, `core/parsing.py`) are shown on the Import page too: check
  them in the same pass.

## Progress

- 2026-09-27: found while fixing the off-screen Settings errors.
