# Make the upload route sync

## Context

`backend/app/api/imports.py::upload_csv` is the only `async def` route (the other 20 are sync
`def`). It is async only to `await file.read()`, but everything else it calls is blocking: TOML
read, several SQLite connections, `archive_statement` (reads every CSV in `_inputs/` to compare
bytes), `import_transactions` (one SELECT + INSERT per row) and the three full-table recompute
passes. FastAPI runs `async def` routes on the event loop and `def` routes in Starlette's
threadpool, so an import blocks every other request for its whole duration.

## To do / to investigate

- `async def upload_csv` → `def upload_csv`, and `content = await file.read()` →
  `content = file.file.read()` (FastAPI 0.141 documents `UploadFile.file` as the standard,
  non-async file object; the form is parsed and spooled before the route runs).
- Check: pytest (`TestImports`, `TestUploadMatchesRebuild`), OpenAPI unchanged.

## Progress

- 2026-09-26: found in the stack review; verified in a scratch copy (OpenAPI byte-identical,
  190 tests pass).
