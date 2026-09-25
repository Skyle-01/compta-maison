# Clean up before making the repo public

## Context

The repo is meant to become public. Its history is clean (a fresh repo started from the anonymised
tree) and `data/` is fictional, but some leftovers remain.

## To do / to investigate

- `frontend/README.md` is the create-next-app boilerplate: point it to the root README, or delete it.
- `frontend/public/{file,globe,next,vercel,window}.svg` are unused (nothing in `frontend/src`
  references them).
- `LICENSE` is GPL-3.0 but there is no copyright notice: add one to the README (and optionally
  `"license"` in `frontend/package.json`).
- `.claude/` is tracked (`CLAUDE.md`, `agents/`, `settings.json`): decide what stays public, and
  check `settings.json` for local paths.
- `.gitignore` is the only text file with CRLF line endings: consider a `.gitattributes`
  (`* text=auto`).
- Optional: `.github/dependabot.yml` for pip, npm and GitHub Actions.
- Last check before switching the visibility: search the tree for real names, account numbers,
  merchants and places.
