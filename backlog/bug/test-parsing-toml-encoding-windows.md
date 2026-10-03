# test_user_profiles_before_default fails on Windows (TOML written in cp1252)

## Context

`backend/tests/test_parsing.py::TestBankProfiles::test_user_profiles_before_default` writes `bank_profiles.toml` with `Path.write_text(...)` and no `encoding`. On Windows with Python 3.12 (the local `.venv`), that writes cp1252, so the `é` of `Libellé` becomes byte `0xE9` and `load_bank_profiles` (tomllib, UTF-8) raises `UnicodeDecodeError`. CI runs on Linux (UTF-8 locale) and passes, so only local Windows runs fail. It is a test bug, not an app bug: the app reads the TOML as UTF-8 as intended.

## To do / to investigate

- Pass `encoding="utf-8"` to that `write_text` (line ~199). The other `write_text` calls in `backend/tests` already set an encoding.
- Optionally check the local `.venv` version: CLAUDE.md says development happens on 3.14, but the `.venv` here is 3.12.10.

## Progress

- 2026-10-03: found during the _inputs/ bulk import session; confirmed it fails on a clean `main` too (git stash), 200 other tests pass.
