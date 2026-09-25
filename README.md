# compta

A small, local household-accounting web app. Drop in French bank CSV exports, let substring rules
categorise the transactions, review what's left, and explore a monthly dashboard (money-flow
Sankey, balance tree, savings). FastAPI + SQLite backend, Next.js frontend. Everything runs on
your machine; nothing is sent anywhere.

## Your data stays out of git

| Path | Holds | Tracked? |
| --- | --- | --- |
| `data/` | a **fictional** example config (accounts, categories, rules, transfer markers, bank profiles) | yes |
| `_config/` | **your** config: `accounts.csv`, `categories.csv`, `rules.csv` (+ optional `transfer_markers.csv`, `overrides.csv`, `bank_profiles.toml`) | no |
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
   account name. If your bank uses another CSV layout or file name, see
   [Other banks](#other-banks).
2. Copy `data/*.csv` to `_config/` and edit them:
   - `accounts.csv`: one line per account. `aliases` (`|`-separated) must match the account
     name taken from your statement filenames. `type` is `checking` or `savings`. Set
     `deposit_pattern` only for a savings account with no statement of its own: its deposits are
     the checking-account lines containing that text.
   - `categories.csv`: one full category path per line (`Variable / Courses`).
   - `rules.csv`: `category_path;pattern;priority;is_income_anchor;description`. A pattern is a
     plain, case-sensitive substring of the bank label. The rule flagged `is_income_anchor=1`
     (your salary) starts each budget month.
   - `transfer_markers.csv` (optional): one `marker` per line. A debit and a credit of the same
     amount on two of your accounts, at most 3 days apart, are paired as an internal transfer
     (left out of income and expenses) only if **both** labels start with one of these prefixes
     (case-insensitive). The default is `VIR`; `*` accepts any label.
3. Build the database: `.venv/Scripts/python backend/scripts/reset_db.py --source defaults`.
4. Run it: `./dev.ps1` (Windows), or `uvicorn app.main:app --port 8000` from `backend/` plus
   `npm run dev --prefix frontend`. Open http://localhost:3000.

After that, edit categories, rules and transfer markers from the app's Settings page. On the
Transactions page, tick two operations to pair them as a transfer, or use "Dissocier" on a wrong
pair; these manual decisions are kept across rebuilds. To rebuild while keeping them
(for example after a schema change), run `reset_db.py` with no arguments. It snapshots the current
setup to `_backups/<timestamp>/` first. `--source backup` restores the latest snapshot. Copy a
snapshot's files into `_config/` to make it your new reference setup.

## Other banks

The built-in format is `"Date operation";"Date valeur";"Libelle";"Debit";"Credit"`, separated by
`;`, dates `dd/mm/yyyy`, comma decimals (`1 234,56`), UTF-8 or Windows-1252. For any other export,
copy `data/bank_profiles.toml` to `_config/` and describe your bank's file there: column names,
separator, date format, decimal mark, encodings, and either one signed amount column (negative =
debit) or separate debit and credit columns. The example file documents every key.

- Each file is tried against your profiles in order, then the built-in format. The first profile
  whose columns all appear on one of the first 30 lines wins, so lines above the header (account
  number, balance) are fine. Put a narrower profile before a broader one.
- Without a value-date column, the operation date is used.
- `filename_pattern` is a regular expression with an `account` group that finds the account in the
  file name (`_` become spaces); the result must be one of the aliases in `accounts.csv`. It is
  needed to rebuild from `_inputs/`. When uploading from the Import page you can also pick the
  account by hand.
- The server and `reset_db.py` both read `bank_profiles.toml` from `_config/` (or
  `$COMPTA_CONFIG_DIR`), so an upload and a rebuild read a file the same way.
- Once statements are imported with a profile, don't change how it reads them (columns, dates,
  amounts). Each operation is identified by its parsed values, so a change imports the rows again
  and your manual changes no longer reattach after a rebuild.

## Tests

```bash
.venv/Scripts/python -m pytest backend/tests
npm run build --prefix frontend
```

## License

See [LICENSE](LICENSE).
