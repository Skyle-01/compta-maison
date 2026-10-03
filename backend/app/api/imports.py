from dataclasses import asdict
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, UploadFile

from app.api.deps import ConfigDir, DbPath, InputsDir
from app.core.bank_profiles import PROFILES_FILENAME, BankProfile, BankProfileError, load_bank_profiles
from app.core.categorize import apply_rules, uncategorized_balance
from app.core.inputs import archive_statement, import_inputs_dir
from app.core.parsing import CsvValidationError, infer_account, parse_statement
from app.core.periods import recompute_budget_months
from app.core.transfers import recompute_transfers
from app.db import connect, import_transactions, load_account_aliases, resolve_account_code
from app.schemas import ImportResult, InputFileResult, InputsImportResult

router = APIRouter(prefix="/api/imports", tags=["imports"])


def _profiles(config_dir: Path) -> list[BankProfile]:
    try:
        return load_bank_profiles(config_dir)
    except BankProfileError as exc:
        raise HTTPException(500, detail=[f"{PROFILES_FILENAME} invalide : {exc}"]) from exc


@router.post("", status_code=201)
def upload_csv(
    file: UploadFile,
    db_path: DbPath,
    config_dir: ConfigDir,
    inputs_dir: InputsDir,
    account: Annotated[str, Form()] = "",
) -> ImportResult:
    profiles = _profiles(config_dir)
    with connect(db_path) as conn:
        aliases = load_account_aliases(conn)
        known_codes = [code for (code,) in conn.execute("SELECT code FROM accounts ORDER BY sort_order")]

    # The account string feeds import_hash. reset_db.py hashes the string inferred from the
    # filename, so prefer it whenever it names the same account as the one picked (the Import page
    # sends the code): manual overrides then reattach to the rebuilt rows.
    inferred = infer_account(file.filename or "", profiles)
    account = account.strip()
    inferred_code = resolve_account_code(inferred, aliases) if inferred else None
    if not account or (inferred_code is not None and inferred_code == resolve_account_code(account, aliases)):
        account = inferred or ""
    if not account:
        raise HTTPException(422, detail=["Aucun compte choisi, et le nom du fichier n’en désigne aucun"])
    if resolve_account_code(account, aliases) is None:
        raise HTTPException(
            422,
            detail=[f"« {account} » ne désigne aucun compte connu ({', '.join(known_codes)})"],
        )

    content = file.file.read()
    try:
        profile, rows = parse_statement(content, profiles)
    except CsvValidationError as exc:
        raise HTTPException(422, detail=exc.errors) from exc
    for row in rows:
        row["account"] = account
    archived_as = archive_statement(inputs_dir, file.filename or "", content, account, profiles)

    rows_new = import_transactions(rows, db_path)
    recompute_budget_months(db_path)
    recompute_transfers(db_path)
    apply_rules(db_path)

    # Budget months the file spans (its account over its value dates), read back after the
    # paycheck-period recompute; also right when every row was a duplicate.
    with connect(db_path) as conn:
        months = [
            m
            for (m,) in conn.execute(
                "SELECT DISTINCT budget_month FROM transactions "
                "WHERE account_id = ? AND date_valeur BETWEEN ? AND ? ORDER BY budget_month",
                (resolve_account_code(account, aliases), rows[0]["Date valeur"], rows[-1]["Date valeur"]),
            )
        ]
    warnings: dict[str, float] = {}
    uncategorized_count = 0
    for month in months:
        stats = uncategorized_balance(db_path, month)
        uncategorized_count += stats["count"]
        if not stats["balanced"]:
            warnings[month] = stats["difference"]

    return ImportResult(
        account=account,
        rows_total=len(rows),
        rows_new=rows_new,
        uncategorized_count=uncategorized_count,
        balance_warnings=warnings,
        profile=profile.name,
        archived_as=archived_as,
    )


@router.post("/inputs")
def import_inputs(db_path: DbPath, config_dir: ConfigDir, inputs_dir: InputsDir) -> InputsImportResult:
    """Import every statement dropped in _inputs/ into the existing DB (already imported rows are
    skipped), then recompute like an upload."""
    results = import_inputs_dir(db_path, inputs_dir, _profiles(config_dir))
    recompute_budget_months(db_path)
    recompute_transfers(db_path)
    apply_rules(db_path)
    return InputsImportResult(
        files=[InputFileResult(**asdict(r)) for r in results],
        rows_new=sum(r.rows_new for r in results),
    )
