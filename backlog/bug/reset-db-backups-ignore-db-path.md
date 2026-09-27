# reset_db.py writes snapshots to the repo's _backups/ whatever the DB path

## Context

`scripts/reset_db.py` hard-codes `BACKUPS_DIR = REPO_ROOT / "_backups"`, while the DB follows
`COMPTA_DB` / `--db` and the statements follow `COMPTA_INPUTS_DIR`. Rebuilding a throwaway DB
(the demo database used for UI checks: temp `COMPTA_DB`, `COMPTA_INPUTS_DIR`, `COMPTA_CONFIG_DIR`)
a second time snapshots the demo DB into the owner's real `_backups/<ts>/`. That snapshot is then
the latest one, so a later `reset_db.py --source backup` would restore the fictional demo taxonomy
(and demo accounts) instead of the owner's.

Seen on 2026-09-27 while checking the drop-pre-schema-compat change on a demo DB: `--source live`
on a temp `COMPTA_DB` wrote `<repo>/_backups/<ts>/`.

## To do / to investigate

- Put a DB's snapshots next to it: `<db dir>/_backups/`. With the default `<repo>/compta.db`
  nothing changes; a temp DB keeps its snapshots in its temp dir. No new variable to forget.
- Tests: `isolate_reset_db` monkeypatches `BACKUPS_DIR`; the test DBs already sit in `tmp_path`.
- Update CLAUDE.md (DB path gotcha) and the reset_db docstring / README if they say "repo".

## Progress

- 2026-09-27: found; confirmed `_backups/` is created in the repo root from a temp `COMPTA_DB`.
