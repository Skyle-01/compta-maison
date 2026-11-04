from fastapi import APIRouter, HTTPException

from app.api.deps import ConfigDir, DbPath
from app.core.config_export import export_statements, save_config
from app.schemas import ConfigExportResult, StatementsExportResult

router = APIRouter(prefix="/api/config", tags=["config"])


@router.post("/export")
def export_config_dir(db_path: DbPath, config_dir: ConfigDir) -> ConfigExportResult:
    """Regenerate the config dir's CSVs from the DB (for reset_db.py --source defaults), after
    backing up the files it replaces and the DB to _backups/<ts>/."""
    try:
        saved = save_config(db_path, config_dir)
    except OSError as exc:  # e.g. a CSV open in Excel on Windows (os.replace names it filename2)
        raise HTTPException(
            500,
            detail=[
                f"Impossible d’écrire {exc.filename2 or exc.filename or config_dir} : {exc.strerror or exc}"
            ],
        ) from exc
    counts = saved.counts
    return ConfigExportResult(
        config_dir=str(config_dir),
        backup_dir=str(saved.backup_dir),
        accounts=counts.accounts,
        categories=counts.categories,
        rules=counts.rules,
        overrides=counts.overrides,
        transfer_markers=counts.transfer_markers,
    )


@router.post("/export-statements")
def export_statements_dir(db_path: DbPath) -> StatementsExportResult:
    """Write the DB's operations as re-importable bank CSVs (one per account) to a new
    _backups/<ts>/inputs/, a safety net for _inputs/. Never writes to _inputs/."""
    try:
        exported = export_statements(db_path)
    except ValueError as exc:
        raise HTTPException(422, detail=[str(exc)]) from exc
    except OSError as exc:
        raise HTTPException(
            500,
            detail=[
                f"Impossible d'écrire {exc.filename2 or exc.filename or 'le fichier'} : {exc.strerror or exc}"
            ],
        ) from exc
    return StatementsExportResult(
        backup_dir=str(exported.backup_dir) if exported.backup_dir else None,
        files=exported.files,
        operations=exported.operations,
    )
