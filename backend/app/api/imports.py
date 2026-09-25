from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from app.api.deps import get_config_dir, get_db_path, get_inputs_dir
from app.core.bank_profiles import PROFILES_FILENAME, BankProfileError, load_bank_profiles
from app.core.categorize import apply_rules, uncategorized_balance
from app.core.inputs import archive_statement
from app.core.parsing import CsvValidationError, infer_account, parse_statement
from app.core.periods import recompute_budget_months
from app.core.transfers import recompute_transfers
from app.db import connect, import_transactions, load_account_aliases, resolve_account_code
from app.schemas import ImportResult

router = APIRouter(prefix="/api/imports", tags=["imports"])


@router.post("", response_model=ImportResult, status_code=201)
async def upload_csv(
    file: UploadFile,
    account: str = Form(""),
    db_path: Path = Depends(get_db_path),
    config_dir: Path = Depends(get_config_dir),
    inputs_dir: Path = Depends(get_inputs_dir),
) -> ImportResult:
    try:
        profiles = load_bank_profiles(config_dir)
    except BankProfileError as exc:
        raise HTTPException(500, detail=[f"Invalid {PROFILES_FILENAME}: {exc}"]) from exc
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
        raise HTTPException(422, detail=["No account given and none inferable from the filename"])
    if resolve_account_code(account, aliases) is None:
        raise HTTPException(
            422,
            detail=[f"Account {account!r} doesn't map to a known account ({', '.join(known_codes)})"],
        )

    content = await file.read()
    try:
        profile, rows = parse_statement(content, profiles)
    except CsvValidationError as exc:
        raise HTTPException(422, detail=exc.errors) from exc
    for row in rows:
        row["account"] = account
    archived_as = archive_statement(inputs_dir, file.filename or "", content, account, profiles)

    with connect(db_path) as conn:
        cur = conn.execute(
            "INSERT INTO imports (filename, account, rows_total, rows_new) VALUES (?, ?, ?, 0)",
            (file.filename, account, len(rows)),
        )
        import_id = cur.lastrowid

    rows_new = import_transactions(rows, db_path, import_id=import_id)
    with connect(db_path) as conn:
        conn.execute("UPDATE imports SET rows_new = ? WHERE id = ?", (rows_new, import_id))

    recompute_budget_months(db_path)
    recompute_transfers(db_path)
    apply_rules(db_path)

    # Months affected by this file, read back after the paycheck-period recompute.
    with connect(db_path) as conn:
        months = [
            m
            for (m,) in conn.execute(
                "SELECT DISTINCT budget_month FROM transactions WHERE import_id = ? ORDER BY budget_month",
                (import_id,),
            )
        ]
    if not months:  # everything was a duplicate — fall back to the file's own months
        months = sorted({row["budget_month"] for row in rows})
    warnings: dict[str, float] = {}
    uncategorized_count = 0
    for month in months:
        stats = uncategorized_balance(db_path, month)
        uncategorized_count += stats["count"]
        if not stats["balanced"]:
            warnings[month] = stats["difference"]

    return ImportResult(
        import_id=import_id,
        account=account,
        rows_total=len(rows),
        rows_new=rows_new,
        uncategorized_count=uncategorized_count,
        balance_warnings=warnings,
        profile=profile.name,
        archived_as=archived_as,
    )
