# English error for a request body that isn't valid UTF-8

## Context

API error messages must be French (CLAUDE.md, Conventions → Language). `backend/app/main.py` only registers `french_validation_errors` (`api/errors.py`) for `RequestValidationError`. A JSON body that isn't valid UTF-8 never reaches validation: FastAPI raises its own `HTTPException(400, "There was an error parsing the body")`, which comes back in English, and as a plain string `detail` rather than a list.

Seen on 2026-10-04 while seeding the demo DB: `curl -X POST http://127.0.0.1:8000/api/categories -H 'Content-Type: application/json' -d '{"name":"Supermarché","parent_id":25}'` from Git Bash on Windows (the shell passed the accent in a legacy code page) returned `400 {"detail":"There was an error parsing the body"}`. Sending the same body from a UTF-8 file (`--data-binary @body.json`) worked.

The frontend always sends UTF-8 (`JSON.stringify` + `fetch`), so this only reaches scripts and manual `curl` calls. The page would still show the message as is, through `lib/api.ts::errorDetails`.

## To do / to investigate

- Decide whether it matters enough: no browser path triggers it today.
- If yes: a handler for Starlette's `HTTPException` that rewrites this one detail (match on the status code + FastAPI's raise site, not on the English text, as `french_validation_errors` does with error `type`), e.g. « Requête illisible (encodage invalide, UTF-8 attendu) », kept as a list like the routers' details. Check what `fastapi.routing` raises in the installed version first.
- Test in `backend/tests/test_api.py::TestFrenchValidationErrors` with `content=b'{"name":"\xe9"}'`.

Done when:
- A non-UTF-8 JSON body gets a French `detail` (pytest).
- `pytest`, `ruff check`, `ruff format --check` pass.

## Progress
