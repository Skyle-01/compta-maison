# compta

A small, local household-accounting web app. Drop in French bank CSV exports, let substring rules
categorise the transactions, review what's left, and explore a monthly dashboard (money-flow
Sankey, balance tree, savings). FastAPI + SQLite backend, Next.js frontend. Everything runs on
your machine; nothing is sent anywhere.

## Your data stays out of git

| Path | Holds | Tracked? |
| --- | --- | --- |
| `data/` | a **fictional** example config (accounts, categories, rules) | yes |
| `_config/` | **your** config: `accounts.csv`, `categories.csv`, `rules.csv` (+ optional `overrides.csv`) | no |
| `_inputs/` | your bank statement CSVs | no |
| `_backups/` | automatic snapshots taken before each rebuild | no |
| `compta.db` | the SQLite database | no |

Every folder starting with `_` is gitignored.

## Setup

```bash
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt      # .venv/bin/pip on Linux/macOS
npm install --prefix frontend
```

1. Put your bank exports in `_inputs/`. Files are named like
   `RELEVE_COMPTE_JOINT_2026_06_08.csv`: the part between `RELEVE_[COMPTE_]` and the date is the
   account name.
2. Copy `data/*.csv` to `_config/` and edit them:
   - `accounts.csv`: one line per account. `aliases` (`|`-separated) must match the account
     name taken from your statement filenames. `type` is `checking` or `savings`. Set
     `deposit_pattern` only for a savings account with no statement of its own: its deposits are
     the checking-account lines containing that text.
   - `categories.csv`: one full category path per line (`Variable / Courses`).
   - `rules.csv`: `category_path;pattern;priority;is_income_anchor;description`. A pattern is a
     plain, case-sensitive substring of the bank label. The rule flagged `is_income_anchor=1`
     (your salary) starts each budget month.
3. Build the database: `.venv/Scripts/python backend/scripts/reset_db.py --source defaults`.
4. Run it: `./dev.ps1` (Windows), or `uvicorn app.main:app --port 8000` from `backend/` plus
   `npm run dev --prefix frontend`. Open http://localhost:3000.

After that, edit categories and rules from the app's Settings page. To rebuild while keeping them
(for example after a schema change), run `reset_db.py` with no arguments. It snapshots the current
setup to `_backups/<timestamp>/` first. `--source backup` restores the latest snapshot. Copy a
snapshot's files into `_config/` to make it your new reference setup.

## Tests

```bash
.venv/Scripts/python -m pytest backend/tests
npm run build --prefix frontend
```

## License

See [LICENSE](LICENSE).
