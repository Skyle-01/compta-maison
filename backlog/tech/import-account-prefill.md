# Import page re-implements account inference

## Context

`frontend/src/app/import/page.tsx::inferAccountCode` pre-fills the account from the file name with
its own rules: the default `RELEVE_[COMPTE_]<ACCOUNT>_<yyyy>` pattern only (no bank profiles), and
it also matches account labels, which the backend never does. The backend already infers the
account when the form sends none, and prefers the inferred string whenever it names the same
account as the one picked (`api/imports.py::upload_csv`). So the two can disagree, and the front
duplicates logic that lives in the backend.

## To do / to investigate

- Option: drop the pre-fill and default the select to an explicit "deduce from the file name"
  entry (empty value), letting the backend decide. It is a visible UX change: the owner decides.
- Alternative: keep the pre-fill but have it call a backend endpoint that runs `infer_account` +
  `resolve_account_code` with the real profiles and aliases.

## Progress

- 2026-09-25: noted by the consolidation review; nothing done.
