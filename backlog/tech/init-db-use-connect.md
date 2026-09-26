# init_db should reuse connect()

## Context

`backend/app/db.py::init_db` opens a connection, runs `with conn` and closes in `finally` by hand,
duplicating `connect()`. The only difference is `PRAGMA foreign_keys = ON`, which doesn't affect
`CREATE … IF NOT EXISTS` (probably a leftover of the removed migration ladder).

## To do / to investigate

- `with connect(db_path) as conn: conn.executescript(SCHEMA)`.

## Progress

- 2026-09-26: verified in scratch (190 tests pass).
