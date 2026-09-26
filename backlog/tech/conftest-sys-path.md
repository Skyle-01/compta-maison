# Drop the sys.path insertion in conftest.py

## Context

`backend/tests/conftest.py` inserts `backend/` into `sys.path` (with `# noqa: E402` on the
following imports). pytest already does it: in the default `prepend` import mode, because
`tests/__init__.py` exists, pytest puts the first ancestor without `__init__.py` (`backend/`) on
`sys.path` before importing conftest — which is also why `from tests.test_parsing import …` works.

## To do / to investigate

- Delete the `import sys`, `BACKEND_DIR` and `sys.path.insert` lines and the two `noqa`.
- It would only break under `--import-mode=importlib`; then add `pythonpath = ["."]` under
  `[tool.pytest.ini_options]` instead.
- `scripts/reset_db.py`'s own insertion stays (needed for `python backend/scripts/reset_db.py`).

## Progress

- 2026-09-26: verified in scratch: 190 pass from the repo root, from `backend/` (CI) and on a
  single file; ruff clean.
