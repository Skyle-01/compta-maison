# Annotated dependencies, no redundant response_model

## Context

- All 16 routes declaring `response_model=X` also return `-> X`; FastAPI infers the response model
  from the return annotation (`response_model` exists to override it).
- Dependencies are written `db_path: Path = Depends(get_db_path)` (23×), plus `Query(...)` defaults
  (`transactions.py`) and `Form("")` (`imports.py`). Ruff B008 flags calls in defaults, so
  `backend/pyproject.toml` whitelists them in `[tool.ruff.lint.flake8-bugbear]`.
- The installed ruff (0.16.9) has stable rules for both: `ruff check --select FAST` reports
  16 FAST001 + 26 FAST002.

## To do / to investigate

- In `api/deps.py`: `DbPath = Annotated[Path, Depends(get_db_path)]`, `ConfigDir`, `InputsDir`.
- Signatures: `db_path: DbPath`; `limit: Annotated[int, Query(ge=1, le=1000)] = 100`,
  `offset: Annotated[int, Query(ge=0)] = 0`; `account: Annotated[str, Form()] = ""`.
- Python syntax: in `get_dashboard`, `list_rules`, `list_transactions` and `upload_csv`, `db_path`
  must move before the defaulted params (FastAPI binds by name, nothing observable changes).
- Drop the 16 `response_model=`; delete `[tool.ruff.lint.flake8-bugbear]`.
- Optional: add `"FAST"` to ruff `select` so it stays that way.
- Check: ruff, pytest, diff `create_app().openapi()` before/after.

## Progress

- 2026-09-26: found in the stack review; verified in scratch (OpenAPI byte-identical, 190 tests
  pass, ruff clean without the bugbear block; +65/−68 lines over the routers).
